import type { Firestore } from 'firebase-admin/firestore';
import { readTestChatAction, TEST_CHAT_MAX_OUTPUT_TOKENS, TEST_CHAT_MAX_RESPONSE_CHARS,
  TEST_CHAT_PROVIDER_IDS,
  type TestChatAction, type TestChatDiagnostic, type TestChatProviderId, type TestChatProviderStatus,
  type TestChatReply, type TestChatStatus } from '../../lib/testChatBot';
import { nanoUsdToDecimal, qubaxModelOverride, qubaxRequestCeilingNanoUsd, readQubaxFeedSummary, readQubaxMarketPlan, type QubaxMarketChoice } from './qubaxMarket';
import { qubaxConfig, QubaxError, runApprovedQubaxChat } from './qubax';
import { refreshQubaxPriceFeed } from './qubaxPriceFeedRuntime';
import { createMitrifyClient, mitrifyConfig, MitrifyError } from './mitrify';
import { getServerDb } from './serverDb';
import { assertAiAvailable } from './aiMaintenance';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { freeChainConfig, isPaidRung, type ProviderId, type RungConfig } from '../AI/FreeChain/config';
import { FreeChainStore } from '../AI/FreeChain/store';
import { reserveMonthly, settleMonthly } from '../AI/FreeChain/masterPlan';
import { maximumCostNanoUsd, usdToNanoUsd } from '../AI/FreeChain/spendCap';
import { OpenAiCompatProvider, FreeChainProviderError, type AdapterConfig, type AdminCapturedProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
import { runRegistryRung } from '../AI/FreeChain/providers/openRouterRegistryRung';
import { strictFreeText } from '../AI/LiveRegistry/runtime';
import { exactModelId, zero } from '../AI/LiveRegistry/eligibility';
import { catalogJson, OPENROUTER_MODELS_URL } from '../AI/LiveRegistry/sync';
import { FreeRoutingError } from '../AI/LiveRegistry/dispatcher';
import { realRateFor } from '../AgentV3/providerRates';
import { ROUTER_ONE_DEFAULT_MODEL } from '../AI/RouterOne/routerOne';
import { buildTestChatDiagnostic } from './testChatBotDiagnostics';
import { OfficialTestChatError, runOfficialAnthropicTest, runOfficialOpenAiCompatTest } from './testChatBotOfficial';
import { testChatRequestId, testChatUid } from './testChatPayload';

type UnavailableReason = 'disabled' | 'configuration' | 'storage' | 'approval-or-budget' | 'budget' | 'no-model' | 'tries-exhausted' | 'capacity' | 'capability' | 'invalid' | 'unconfirmed';
const SKIP_REASON: Record<string, UnavailableReason> = {
  'qubax-disabled-or-unconfigured': 'configuration',
  'qubax-configuration': 'configuration',
  'qubax-capability-excluded': 'capability',
  'qubax-capacity': 'capacity',
  'qubax-price-or-quality-unverified': 'no-model',
  'qubax-budget': 'budget',
  'qubax-tries-exhausted': 'tries-exhausted',
};
export class TestChatUnavailable extends Error {
  constructor(readonly reason: UnavailableReason, readonly status = 503, readonly diagnostic?: TestChatDiagnostic) { super(reason); }
}

type ProviderKind = 'qubax' | 'mitrify' | 'freechain' | 'openrouter' | 'glm-vision' | 'gemini-flash' | 'kimi' | 'grok' | 'anthropic' | 'surplus' | 'router-one';
const FREECHAIN_ADAPTER: Record<Exclude<ProviderId, never>, AdapterConfig['provider']> = {
  glm47: 'GLM', glm45: 'GLM', gemini: 'GEMINI', groq: 'GROQ', cloudflare: 'CLOUDFLARE', openrouter: 'OPENAI',
  deepseek: 'DEEPSEEK', nvidia: 'NVIDIA', modelscope: 'MODELSCOPE', llm7: 'LLM7', bluesminds: 'BLUESMINDS',
  requesty: 'REQUESTY', glmflashx: 'GLM', gpt5nano: 'OPENAI', llama8b: 'DEEPINFRA', dsv4flash: 'DEEPINFRA',
  geminipaid: 'GEMINI', cheapinf: 'CHEAPERINFERENCE',
};
const META: Record<TestChatProviderId, {
  label: string; kind: ProviderKind; rungId?: ProviderId; privacyUrl?: string; internalRouting?: boolean;
}> = {
  'glm-4.5-flash': { label: 'Z.AI GLM-4.5 Flash', kind: 'freechain', rungId: 'glm45' },
  'glm-4.7-flash': { label: 'Z.AI GLM-4.7 Flash', kind: 'freechain', rungId: 'glm47' },
  groq: { label: 'Groq', kind: 'freechain', rungId: 'groq' },
  'cloudflare-workers-ai': { label: 'Cloudflare Workers AI', kind: 'freechain', rungId: 'cloudflare' },
  'openrouter-verified-free': { label: 'OpenRouter verified-free', kind: 'openrouter', rungId: 'openrouter', internalRouting: true },
  mitrify: { label: 'Mitrify', kind: 'mitrify', internalRouting: true },
  qubax: { label: 'Qubax', kind: 'qubax', privacyUrl: 'https://qubax.ai/legal/privacy', internalRouting: true },
  'cheaperinference-beam': { label: 'CheaperInference', kind: 'freechain', rungId: 'cheapinf' },
  'deepinfra-llama-3.1-8b-turbo': { label: 'DeepInfra Llama 3.1 8B Turbo', kind: 'freechain', rungId: 'llama8b' },
  'deepinfra-deepseek-v4-flash': { label: 'DeepInfra DeepSeek V4 Flash', kind: 'freechain', rungId: 'dsv4flash' },
  'openai-gpt-5-nano': { label: 'OpenAI GPT-5 Nano', kind: 'freechain', rungId: 'gpt5nano' },
  'glm-4.7-flashx': { label: 'Z.AI GLM-4.7 FlashX', kind: 'freechain', rungId: 'glmflashx' },
  'gemini-2.5-flash-lite-paid': { label: 'Gemini 2.5 Flash-Lite (paid)', kind: 'freechain', rungId: 'geminipaid' },
  'gemini-2.5-flash-lite-free': { label: 'Gemini 2.5 Flash-Lite (free path)', kind: 'freechain', rungId: 'gemini' },
  'deepseek-flash': { label: 'DeepSeek Flash', kind: 'freechain', rungId: 'deepseek', privacyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html' },
  'nvidia-nemotron': { label: 'NVIDIA Nemotron', kind: 'freechain', rungId: 'nvidia' },
  modelscope: { label: 'ModelScope', kind: 'freechain', rungId: 'modelscope' },
  llm7: { label: 'LLM7', kind: 'freechain', rungId: 'llm7' },
  bluesminds: { label: 'BluesMinds', kind: 'freechain', rungId: 'bluesminds' },
  requesty: { label: 'Requesty', kind: 'freechain', rungId: 'requesty' },
  'glm-4.6v-flash': { label: 'Z.AI GLM-4.6V-Flash', kind: 'glm-vision' },
  'gemini-2.5-flash': { label: 'Gemini 2.5 Flash', kind: 'gemini-flash' },
  surplus: { label: 'Surplus', kind: 'surplus', internalRouting: true },
  'router-one': { label: 'Router One', kind: 'router-one', internalRouting: true },
  'anthropic-claude': { label: 'Anthropic Claude', kind: 'anthropic' },
  kimi: { label: 'Kimi / Moonshot', kind: 'kimi' },
  'xai-grok': { label: 'xAI Grok', kind: 'grok' },
};
const BLOCKING_REASONS = new Set([
  'unconfigured', 'disabled', 'terms-non-production', 'terms-unverified', 'terms-shared-access',
  'account-unconfigured', 'model-unverified', 'rate-card-unverified',
]);
const REASON_TEXT: Record<string, string> = {
  unconfigured: 'No API credential is set on the server.',
  disabled: 'This provider is disabled on the server.',
  'terms-non-production': 'This provider is registered but not approved for production use.',
  'terms-unverified': 'This provider’s terms have not been verified.',
  'terms-shared-access': 'Shared access is not permitted for this provider.',
  'account-unconfigured': 'The server account for this provider is not configured.',
  'model-unverified': 'The configured model is not on the server allowlist.',
  'rate-card-unverified': 'The paid rate card for this provider is not verified, so this test will not invent a price or dispatch.',
};
const MISSING_KEY = 'No API credential is set on the server.';

function firstPresent(env: NodeJS.ProcessEnv, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim() ?? '';
    if (value && !/[\s,]/.test(value)) return value;
  }
  return '';
}
function chainConfig() {
  try { return freeChainConfig(); } catch { return null; }
}
function extraBodyFor(id: ProviderId): AdapterConfig['extraBody'] {
  if (id === 'gemini' || id === 'geminipaid') return { reasoning_effort: 'none' };
  if (id === 'gpt5nano') return { reasoning_effort: 'minimal' };
  if (id === 'cheapinf') return { reasoning_effort: 'low' };
  return undefined;
}
function rungOf(id: ProviderId): RungConfig | undefined {
  return chainConfig()?.rungs?.find(r => r.id === id);
}
function present(value: string): boolean { return !!value && !/[\s,]/.test(value); }
function requestedModel(action: TestChatAction): string | null {
  const model = action.model?.trim() ?? '';
  return model && model.length <= 200 && !/[\s,]/.test(model) ? model : null;
}
const MITRIFY_GATEWAY_TIMEOUT = 'The provider gateway timed out (HTTP 504) before a complete reply arrived. This admin test selected a model from Mitrify’s live /v1/models list first. The time-out is a provider-side gateway time-out, not a missing key.';
function mitrifyOutputTokens(): number {
  const cap = freeChainConfig()?.features.replyMaxTokens;
  const shared = Number.isSafeInteger(cap) && (cap as number) >= 64 ? (cap as number) : 250;
  return Math.min(TEST_CHAT_MAX_OUTPUT_TOKENS, shared);
}
function readMitrifyStreamEvent(wire: Uint8Array): { text?: string; model?: string; usage?: { inputTokens: number; outputTokens: number } } {
  const payload = new TextDecoder().decode(wire).split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (!payload || payload === '[DONE]') return {};
  const data = JSON.parse(payload);
  const text = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.message?.content;
  const tokens = data?.usage;
  return {
    ...(typeof text === 'string' && text ? { text } : {}),
    ...(typeof data?.model === 'string' && data.model.trim() ? { model: data.model } : {}),
    ...(Number.isSafeInteger(tokens?.prompt_tokens) && Number.isSafeInteger(tokens?.completion_tokens)
      ? { usage: { inputTokens: tokens.prompt_tokens as number, outputTokens: tokens.completion_tokens as number } } : {}),
  };
}
type ListedMitrifyModel = { id: string; prompt: number | null; completion: number | null };
function mitrifyCatalogPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  return null;
}
function parseMitrifyListedModels(payload: unknown): ListedMitrifyModel[] {
  const rows = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data : [];
  const out: ListedMitrifyModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; object?: unknown; type?: unknown; pricing?: { prompt?: unknown; completion?: unknown; input?: unknown; output?: unknown } };
    if (typeof rec.id !== 'string') continue;
    const id = rec.id.trim();
    if (!id || id.length > 200 || /[\s,]/.test(id) || /:\/\//.test(id) || /^https?:/i.test(id) || seen.has(id)) continue;
    const kind = `${typeof rec.object === 'string' ? rec.object : ''} ${typeof rec.type === 'string' ? rec.type : ''} ${id}`.toLowerCase();
    if (/(^|[^a-z])(embed|embedding|image|audio|tts|whisper|moderation|rerank)([^a-z]|$)/.test(kind) && !/(chat|instruct|completion)/.test(kind)) continue;
    seen.add(id);
    const pricing = rec.pricing && typeof rec.pricing === 'object' ? rec.pricing : {};
    out.push({
      id,
      prompt: mitrifyCatalogPrice(pricing.prompt ?? pricing.input),
      completion: mitrifyCatalogPrice(pricing.completion ?? pricing.output),
    });
  }
  return out;
}
function pickListedMitrifyModel(listed: readonly ListedMitrifyModel[], preferred: string | null): string | null {
  if (!listed.length) return null;
  const ids = new Set(listed.map(item => item.id));
  if (preferred) return ids.has(preferred) ? preferred : null;
  const priced = listed.filter(item => item.prompt != null && item.completion != null);
  const pool = priced.length
    ? [...priced].sort((a, b) => ((a.prompt as number) + (a.completion as number)) - ((b.prompt as number) + (b.completion as number)) || a.id.localeCompare(b.id))
    : [...listed].sort((a, b) => Number(b.id === 'mitrify/auto-cheap') - Number(a.id === 'mitrify/auto-cheap') || a.id.localeCompare(b.id));
  return pool[0]?.id ?? null;
}
async function loadMitrifyListedModels(signal: AbortSignal, sink: (detail: { status: number; body: string; requestId?: string }) => void): Promise<ListedMitrifyModel[]> {
  const cfg = mitrifyConfig();
  if (!present(cfg.apiKey)) throw new MitrifyError('MITRIFY_CONFIGURATION');
  let base: URL;
  try { base = new URL(cfg.baseURL); } catch { throw new MitrifyError('MITRIFY_CONFIGURATION'); }
  const response = await fetch(`${base.href.replace(/\/$/, '')}/models`, {
    method: 'GET', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch { body = ''; }
    sink({
      status: response.status, body: body.slice(0, 4000),
      requestId: response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('x-mitrify-request-id') || undefined,
    });
    throw new MitrifyError(response.status === 401 ? 'MITRIFY_CONFIGURATION' : `MITRIFY_HTTP_${response.status}`, response.status);
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
  return parseMitrifyListedModels(await response.json());
}
function catalogTokenFree(value: unknown): boolean {
  return zero(value) || value === 0;
}
function isPublicCatalogFreeModel(model: unknown): model is { id: string } {
  if (!model || typeof model !== 'object') return false;
  const row = model as { id?: unknown; pricing?: { prompt?: unknown; completion?: unknown; request?: unknown }; architecture?: { input_modalities?: unknown; output_modalities?: unknown } };
  if (typeof row.id !== 'string' || !exactModelId(row.id) || !row.id.endsWith(':free')) return false;
  if (!catalogTokenFree(row.pricing?.prompt) || !catalogTokenFree(row.pricing?.completion)) return false;
  if (row.pricing?.request !== undefined && !catalogTokenFree(row.pricing.request)) return false;
  const input = row.architecture?.input_modalities;
  const output = row.architecture?.output_modalities;
  if (Array.isArray(input) && !input.includes('text')) return false;
  if (Array.isArray(output) && !output.includes('text')) return false;
  return true;
}
function registryDispatchUnavailable(error: unknown): boolean {
  if (error instanceof FreeRoutingError) return error.code === 'FREE_REGISTRY_NOT_CONFIGURED';
  return error instanceof Error && error.message === 'FREE_CHAIN_REGISTRY_UNAVAILABLE';
}
async function pickAdminOpenRouterFreeModel(input: { preferred: string | null; listed: readonly string[]; signal: AbortSignal }): Promise<string | null> {
  const raw = await catalogJson(OPENROUTER_MODELS_URL, null, fetch, input.signal);
  const rows = raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data) ? (raw as { data: unknown[] }).data : [];
  const free = rows.filter(isPublicCatalogFreeModel).map(row => row.id);
  if (!free.length) return null;
  const allowed = new Set(free);
  if (input.preferred) return allowed.has(input.preferred) ? input.preferred : null;
  const listedFree = input.listed.filter(id => allowed.has(id));
  const pool = listedFree.length ? listedFree : [...free].sort((a, b) => a.localeCompare(b));
  return pool[0] ?? null;
}
function adminQubaxFallback(modelId: string, now: number): QubaxMarketChoice {
  return {
    modelId, inputNanoUsdPerMillion: 1, outputNanoUsdPerMillion: 1,
    officialInputNanoUsdPerMillion: null, officialOutputNanoUsdPerMillion: null,
    discountBps: null, contextTokens: 1, successRateBps: 0, maxLatencyMs: 1,
    probedAtMs: now, expiresAtMs: now + 60_000, backup: true,
  };
}
function describeQubaxFeed(feed: { fresh: boolean; observedAtMs: number | null; pricedRows: number; officialMatches: number; discountEligible: number; probePassing: number }, refreshStatus?: string): string {
  const observed = feed.observedAtMs != null ? new Date(feed.observedAtMs).toISOString() : 'never';
  const refresh = refreshStatus ? ` Last feed refresh: ${refreshStatus}.` : '';
  return `Price feed ${feed.fresh ? `fresh ${observed}` : `not fresh (last observation ${observed})`}. ${feed.pricedRows} priced Qubax rows, ${feed.officialMatches} at a 90%+ Qubax discount, ${feed.discountEligible} within the try cap, ${feed.probePassing} probe-ready.${refresh}`;
}

function providerStatus(id: TestChatProviderId): TestChatProviderStatus {
  const meta = META[id];
  const base = { id, label: meta.label, privacyUrl: meta.privacyUrl ?? null, internalRouting: meta.internalRouting === true };
  if (meta.kind === 'qubax') {
    let configured = false, enabled = false;
    try { const cfg = qubaxConfig(); configured = !!cfg.apiKey; enabled = cfg.enabled; } catch { /* Invalid config fails closed. */ }
    const ceiling = qubaxRequestCeilingNanoUsd(process.env);
    return { ...base, configured, enabled, model: null, billed: true, approvalRequired: !ceiling,
      ceilingUsd: ceiling ? nanoUsdToDecimal(ceiling) : null,
      ...(configured && enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'This provider is disabled on the server.' }) };
  }
  if (meta.kind === 'mitrify') {
    let configured = false, model: string | null = null;
    try { const cfg = mitrifyConfig(); configured = present(cfg.apiKey); model = cfg.model || null; } catch { configured = false; }
    const enabled = configured;
    return { ...base, configured, enabled, model, billed: true, approvalRequired: false,
      note: 'This admin test calls Mitrify when its server key is set. At send time it reads Mitrify’s live /v1/models list and calls only a listed model (the cheapest priced row when the catalog includes prices). A typed model is accepted only if that list contains it. This does not turn on the user-chat chain flag or mint a payload approval.',
      ...(enabled ? {} : { unavailableReason: MISSING_KEY }) };
  }
  if (meta.kind === 'surplus') {
    const configured = !!firstPresent(process.env, ['SURPLUS_API_KEY']);
    return { ...base, configured, enabled: false, model: null, billed: true, approvalRequired: false,
      unavailableReason: configured
        ? 'Surplus is a builder marketplace with no verified per-request spending ceiling on this test page, and its production transport retries. This test will not call it (no invented cap, no reused retry path).'
        : MISSING_KEY };
  }
  if (meta.kind === 'router-one') {
    const configured = !!firstPresent(process.env, ['ROUTER_ONE_API_KEY']);
    const listed = String(process.env.ROUTER_ONE_MODEL ?? '').split(',').map(s => s.trim()).filter(Boolean);
    return { ...base, configured, enabled: false, model: listed[0] || ROUTER_ONE_DEFAULT_MODEL, billed: true, approvalRequired: false,
      unavailableReason: configured
        ? 'Router One has no verified per-request spending ceiling on this test page, so it will not be called (no invented cap).'
        : MISSING_KEY };
  }
  if (meta.kind === 'kimi') {
    const configured = !!firstPresent(process.env, ['KIMI_API_KEY']);
    const baseUrl = (process.env.KIMI_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
    const official = baseUrl === 'https://api.moonshot.ai/v1' || baseUrl === 'https://api.moonshot.cn/v1';
    const enabled = configured && official;
    return { ...base, configured, enabled, model: 'kimi-k2.7', billed: true, approvalRequired: false,
      ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'This test page only calls the official Moonshot endpoints.' }) };
  }
  if (meta.kind === 'grok') {
    const configured = !!firstPresent(process.env, ['XAI_API_KEY', 'GROK_API_KEY']);
    return { ...base, configured, enabled: configured, model: 'grok-3-fast', billed: true, approvalRequired: false,
      ...(configured ? {} : { unavailableReason: MISSING_KEY }) };
  }
  if (meta.kind === 'anthropic') {
    const configured = !!firstPresent(process.env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
    return { ...base, configured, enabled: configured, model: 'claude-sonnet-4-6', billed: true, approvalRequired: false,
      ...(configured ? {} : { unavailableReason: MISSING_KEY }) };
  }
  if (meta.kind === 'glm-vision') {
    const configured = !!firstPresent(process.env, ['GLM_API_KEY', 'FREE_CHAIN_GLM_API_KEY']);
    return { ...base, configured, enabled: configured, model: 'glm-4.6v-flash', billed: false, approvalRequired: false,
      ...(configured ? {} : { unavailableReason: MISSING_KEY }) };
  }
  if (meta.kind === 'gemini-flash') {
    const configured = !!firstPresent(process.env, ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'FREE_CHAIN_GEMINI_API_KEY']);
    return { ...base, configured, enabled: configured, model: 'gemini-2.5-flash', billed: true, approvalRequired: false,
      ...(configured ? {} : { unavailableReason: MISSING_KEY }) };
  }
  const rung = meta.rungId ? rungOf(meta.rungId) : undefined;
  const configured = !!rung?.configured;
  const reason = rung?.reason;
  const cheapinfUserFlag = meta.rungId === 'cheapinf' && configured && (reason === 'disabled' || reason === 'terms-shared-access');
  const blocked = !configured || (!!reason && BLOCKING_REASONS.has(reason) && !cheapinfUserFlag);
  const note = reason === 'privacy'
    ? 'User chat may skip this provider for private turns; this admin test still calls only the selected provider.'
    : reason === 'free-plan-review-required'
      ? 'The free-plan review used by user chat is missing or expired; this admin test still calls only the selected provider.'
      : meta.kind === 'openrouter'
        ? 'A send uses the same LiveRegistry verified-free ranking as main chat when that registry is configured (strictFreeText / runRegistryRung). If it is not, this page fetches OpenRouter’s public catalog at send time and calls only a model whose catalog price is 0/0 and whose id ends with :free. The reply names the chosen model. This does not change user-chat routing.'
        : meta.rungId === 'cheapinf'
          ? 'This admin test can call CheaperInference when its key is set, using the same model string main chat would use. It does not change the user-chat sharing mode.'
        : undefined;
  const listed = chainConfig()?.openRouterModels ?? [];
  const model = (meta.kind === 'openrouter' ? (listed[0] ?? rung?.model ?? '') : rung?.model) || null;
  const enabled = !blocked && configured;
  return {
    ...base, configured, enabled, model: model || null, billed: !!(meta.rungId && isPaidRung(meta.rungId)), approvalRequired: false,
    ...(note ? { note } : {}),
    ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY
      : REASON_TEXT[reason ?? ''] ?? 'This provider is not available for dispatch.' }),
  };
}

/** Admin status refreshes the market feed. The lease stops a stampede. A failure still returns the last status. */
export async function loadTestChatStatus(): Promise<TestChatStatus> {
  const status = testChatStatus();
  const ceiling = qubaxRequestCeilingNanoUsd(process.env);
  const override = qubaxModelOverride(process.env);
  if (!ceiling || override.mode === 'invalid') return status;
  try {
    const db = getServerDb();
    if (!db) return status;
    await refreshQubaxPriceFeed(process.env);
    const [plan, feed] = await Promise.all([readQubaxMarketPlan(db, override, Date.now()), readQubaxFeedSummary(db, Date.now())]);
    const choice = plan.eligible[0] ?? plan.backup;
    const providers = status.providers.map(p => {
      if (p.id !== 'qubax') return p;
      if (!choice) return { ...p, model: null, ceilingUsd: nanoUsdToDecimal(ceiling), selection: 'none' as const, approvalRequired: false };
      return {
        ...p, model: choice.modelId, ceilingUsd: nanoUsdToDecimal(ceiling), approvalRequired: false,
        selection: choice.backup ? 'backup' as const : 'performance' as const,
        inputUsdPerMillion: nanoUsdToDecimal(choice.inputNanoUsdPerMillion),
        outputUsdPerMillion: nanoUsdToDecimal(choice.outputNanoUsdPerMillion),
        officialInputUsdPerMillion: choice.officialInputNanoUsdPerMillion === null ? null : nanoUsdToDecimal(choice.officialInputNanoUsdPerMillion),
        officialOutputUsdPerMillion: choice.officialOutputNanoUsdPerMillion === null ? null : nanoUsdToDecimal(choice.officialOutputNanoUsdPerMillion),
        discountBps: choice.discountBps,
      };
    });
    return { ...status, feed, approvalRequired: providers.some(p => p.approvalRequired), providers };
  } catch { return status; }
}
export function testChatStatus(): TestChatStatus {
  const providers = TEST_CHAT_PROVIDER_IDS.map(providerStatus);
  return { providers, approvalRequired: providers.some(p => p.approvalRequired), noFallback: true };
}

function needsSharedPaidConfig(id: TestChatProviderId): boolean {
  const meta = META[id];
  if (meta.kind === 'qubax' || meta.kind === 'mitrify' || meta.kind === 'kimi' || meta.kind === 'grok' || meta.kind === 'anthropic' || meta.kind === 'gemini-flash') return true;
  return !!(meta.rungId && isPaidRung(meta.rungId));
}

function quoteTokens(messages: TestChatAction['messages'], priceIn: number, priceOut: number): number {
  const inputTokens = Buffer.byteLength(JSON.stringify(messages), 'utf8') + 256;
  return maximumCostNanoUsd(inputTokens, TEST_CHAT_MAX_OUTPUT_TOKENS, usdToNanoUsd(priceIn), usdToNanoUsd(priceOut));
}

function secretsFor(id: TestChatProviderId): string[] {
  const meta = META[id];
  const found: string[] = [];
  const push = (value: string) => { if (value && value.length >= 8) found.push(value); };
  if (meta.kind === 'qubax') { try { push(qubaxConfig().apiKey); } catch { /* ignore */ } }
  if (meta.kind === 'mitrify') { try { push(mitrifyConfig().apiKey); } catch { /* ignore */ } }
  if (meta.rungId) { const key = rungOf(meta.rungId)?.key; if (key) push(key); }
  push(firstPresent(process.env, ['GLM_API_KEY', 'FREE_CHAIN_GLM_API_KEY']));
  push(firstPresent(process.env, ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'FREE_CHAIN_GEMINI_API_KEY']));
  push(firstPresent(process.env, ['KIMI_API_KEY']));
  push(firstPresent(process.env, ['XAI_API_KEY', 'GROK_API_KEY']));
  push(firstPresent(process.env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']));
  return found;
}

async function reserveShared(db: Firestore, requestId: string, uid: string, maximumNanoUsd: number) {
  const cfg = freeChainConfig();
  if (!Number.isSafeInteger(maximumNanoUsd) || maximumNanoUsd <= 0) return null;
  const month = cfg.features.monthlyCap ? await reserveMonthly(db, cfg.features.monthlyCapNanoUsd, maximumNanoUsd) : null;
  if (cfg.features.monthlyCap && !month) return null;
  let hold;
  try {
    hold = await new FreeChainStore(db).reservePaid({ requestId, uid, maxCostNanoUsd: maximumNanoUsd,
      capNanoUsd: cfg.paidCapNanoUsd, perUserLimit: cfg.paidPerUserDaily });
  } catch (error) {
    if (month) await settleMonthly(db, month, maximumNanoUsd, 0);
    throw error;
  }
  if (hold && !hold.mayDispatch) {
    if (month) await settleMonthly(db, month, maximumNanoUsd, 0);
    throw new TestChatUnavailable('unconfirmed', 409);
  }
  if (!hold) { if (month) await settleMonthly(db, month, maximumNanoUsd, 0); return null; }
  return { hold, month, maximumNanoUsd, releaseUndispatched: async () => {
    await new FreeChainStore(db).settlePaid(hold, 0);
    if (month) await settleMonthly(db, month, maximumNanoUsd, 0);
  } };
}

function unusedHoldSafe(error: unknown): boolean {
  if (error instanceof OfficialTestChatError) return error.providerCode === 'url-not-allowlisted' || error.providerCode === 'configuration';
  if (error instanceof FreeChainProviderError) return error.code === 'CONFIGURATION';
  if (error instanceof MitrifyError) return error.code === 'MITRIFY_CONFIGURATION' || error.code === 'MITRIFY_UNSUPPORTED_REQUEST' || error.code === 'MITRIFY_BODY_TOO_LARGE';
  return false;
}
async function releaseIfUnused<T>(receipt: Awaited<ReturnType<typeof reserveShared>>, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (receipt && unusedHoldSafe(error)) {
      try { await receipt.releaseUndispatched(); } catch { /* Do not mask the original error. */ }
    }
    throw error;
  }
}

export async function runTestChat(value: TestChatAction, actor: string, signal: AbortSignal): Promise<TestChatReply> {
  const action = readTestChatAction(value);
  if (!action) throw new TestChatUnavailable('invalid', 400);
  const status = testChatStatus().providers.find(p => p.id === action.provider);
  if (!status) throw new TestChatUnavailable('invalid', 400);
  if (!status.enabled) throw new TestChatUnavailable('disabled');
  if (!status.configured) throw new TestChatUnavailable('configuration');
  const db = getServerDb();
  if (!db) throw new TestChatUnavailable('storage');
  const cfg = freeChainConfig();
  if (needsSharedPaidConfig(action.provider) && cfg.errors.some(e => /PAID_DAILY_CAP|MONTHLY_CAP|PAID_PER_USER/.test(e))) {
    throw new TestChatUnavailable('budget', 409);
  }
  const uid = testChatUid(actor);
  const requestId = testChatRequestId(action);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const startedAt = Date.now();
  const extraSecrets = secretsFor(action.provider);
  const fail = (reason: UnavailableReason, statusCode: number, extra: Omit<Parameters<typeof buildTestChatDiagnostic>[0], 'provider'>): never => {
    throw new TestChatUnavailable(reason, statusCode, buildTestChatDiagnostic({
      extraSecrets, ...extra, provider: action.provider,
    }));
  };
  const revalidate = async () => {
    bounded.throwIfAborted();
    await assertAiAvailable();
    assertLegacyInferenceAllowed('admin-test-chat-bot');
    const latest = testChatStatus().providers.find(p => p.id === action.provider);
    if (!latest?.enabled) throw new TestChatUnavailable('disabled');
    if (!latest?.configured) throw new TestChatUnavailable('configuration');
  };
  await revalidate();
  const meta = META[action.provider];
  let dispatchedModel = status.model;
  let captured: AdminCapturedProviderError | { status: number; body: string; requestId?: string } | undefined;
  const qubaxAttempts: Array<{ model: string; status: number | null; code: string; latencyMs: number; body?: string; requestId?: string }> = [];
  try {
    if (meta.kind === 'qubax') {
      let refreshStatus: string | undefined;
      const override = qubaxModelOverride(process.env);
      const planEmpty = async () => {
        if (override.mode === 'invalid') return true;
        const plan = await readQubaxMarketPlan(db, override, Date.now());
        return !plan.eligible.length && !plan.backup;
      };
      if (await planEmpty()) {
        const refreshed = await refreshQubaxPriceFeed();
        refreshStatus = refreshed.status;
      }
      const adminModel = requestedModel(action);
      const stillEmpty = await planEmpty();
      const adminFallbackTries = stillEmpty && adminModel ? [adminQubaxFallback(adminModel, Date.now())] : undefined;
      const result = await runApprovedQubaxChat({
        db, uid, requestId, signal: bounded, privateTurn: true, healthTurn: true,
        body: { messages: action.messages, max_tokens: TEST_CHAT_MAX_OUTPUT_TOKENS, stream: false },
        revalidate,
        onHttpError: detail => { captured = detail; },
        onAttemptError: detail => { if (qubaxAttempts.length < 8) qubaxAttempts.push(detail); },
        ...(adminFallbackTries ? { adminFallbackTries } : {}),
        reserve: async (maximumNanoUsd, attemptKey) => {
          await revalidate();
          const receipt = await reserveShared(db, attemptKey ?? requestId, uid, maximumNanoUsd);
          return receipt ? { releaseUndispatched: receipt.releaseUndispatched } : null;
        },
      });
      if (result.kind === 'skipped') {
        const reason = SKIP_REASON[result.reason] ?? 'unconfirmed';
        const last = qubaxAttempts.at(-1);
        let detailBody = last?.body ?? null;
        if (result.reason === 'qubax-price-or-quality-unverified') {
          const feed = await readQubaxFeedSummary(db, Date.now());
          detailBody = describeQubaxFeed(feed, refreshStatus);
        }
        throw new TestChatUnavailable(reason, 409, buildTestChatDiagnostic({
          extraSecrets, provider: action.provider, model: last?.model ?? status.model,
          latencyMs: Math.max(0, Date.now() - startedAt), httpStatus: last?.status ?? null,
          providerCode: last?.code ?? result.reason, rawErrorBody: detailBody,
          providerRequestId: last?.requestId ?? null, finalOutcome: reason,
          attempts: qubaxAttempts.map(item => ({
            model: item.model, latencyMs: item.latencyMs, httpStatus: item.status,
            providerCode: item.code, rawErrorBody: item.body ?? null, providerRequestId: item.requestId ?? null,
          })),
        }));
      }
      return finish(action, result.content, result.model, startedAt, result.usage);
    }
    if (meta.kind === 'mitrify') {
      let listed: ListedMitrifyModel[];
      try {
        listed = await loadMitrifyListedModels(bounded, detail => { captured = detail; });
      } catch (error) {
        if (error instanceof MitrifyError) throw error;
        throw new MitrifyError(bounded.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_NETWORK');
      }
      const preferred = requestedModel(action);
      const picked = pickListedMitrifyModel(listed, preferred);
      if (!picked) {
        return fail('no-model', 503, {
          model: preferred ?? status.model, latencyMs: Math.max(0, Date.now() - startedAt),
          providerCode: preferred ? 'MITRIFY_MODEL_NOT_LISTED' : 'MITRIFY_CATALOG_EMPTY',
          providerMessage: preferred
            ? 'The typed model is not in Mitrify’s live /v1/models list, so this admin test did not call it.'
            : 'Mitrify’s live /v1/models list has no usable chat model for this admin test.',
          extraSecrets,
        });
      }
      dispatchedModel = picked;
      const ceiling = quoteTokens(action.messages, 1, 1);
      const receipt = ceiling > 0 ? await reserveShared(db, requestId, uid, ceiling) : null;
      if (ceiling > 0 && !receipt) throw new TestChatUnavailable('budget', 409);
      let content = '';
      let reported = picked;
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      const maxTokens = mitrifyOutputTokens();
      await releaseIfUnused(receipt, async () => {
        await revalidate();
        return createMitrifyClient({ ...process.env, MITRIFY_MODEL: picked }, metadata => console.info('[MITRIFY]', JSON.stringify(metadata)), {
          onHttpError: detail => { captured = detail; },
        }).chat({
          messages: action.messages, max_tokens: maxTokens, stream: true,
        }, {
          signal: bounded, maxAttempts: 1, beforeAttempt: async () => { await revalidate(); },
          onChunk: (wire: Uint8Array) => {
            const event = readMitrifyStreamEvent(wire);
            if (event.text) content += event.text;
            if (event.model) reported = event.model;
            if (event.usage) usage = event.usage;
          },
        });
      });
      return finish(action, content, reported, startedAt, usage);
    }
    if (meta.kind === 'surplus' || meta.kind === 'router-one') throw new TestChatUnavailable('disabled');

    if (meta.kind === 'openrouter') {
      const listed = chainConfig()?.openRouterModels ?? [];
      const admin = requestedModel(action);
      const prompt = action.messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
      const request = { prompt, maxOutputTokens: TEST_CHAT_MAX_OUTPUT_TOKENS, signal: bounded };
      try {
        const result = admin
          ? await runRegistryRung(request, [admin], admin)
          : listed.length
            ? await runRegistryRung(request, listed, listed[0])
            : await strictFreeText({ ...request, maxAttempts: 1 as const });
        return finish(action, result.content, result.model, startedAt, result.usage);
      } catch (error) {
        if (!registryDispatchUnavailable(error)) throw error;
      }
      const picked = await pickAdminOpenRouterFreeModel({ preferred: admin, listed, signal: bounded });
      if (!picked) {
        return fail('no-model', 503, {
          model: admin ?? listed[0] ?? status.model, latencyMs: Math.max(0, Date.now() - startedAt),
          providerCode: 'FREE_REGISTRY_NOT_CONFIGURED',
          providerMessage: 'LiveRegistry is not configured, and the public OpenRouter catalog has no zero-price :free text model for this admin test.',
          extraSecrets,
        });
      }
      const key = firstPresent(process.env, ['OPENROUTER_API_KEY']) || rungOf('openrouter')?.key || '';
      const result = await runOfficialOpenAiCompatTest({
        url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: key, model: picked, messages: action.messages, signal: bounded,
      });
      return finish(action, result.content, result.model || picked, startedAt, result.usage);
    }

    let officialReceipt: Awaited<ReturnType<typeof reserveShared>> = null;
    if (meta.kind === 'kimi' || meta.kind === 'grok' || meta.kind === 'anthropic' || meta.kind === 'gemini-flash') {
      const model = status.model || (meta.kind === 'kimi' ? 'kimi-k2.7' : meta.kind === 'grok' ? 'grok-3-fast' : meta.kind === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash');
      const rateProvider = meta.kind === 'kimi' ? 'KIMI' : meta.kind === 'grok' ? 'GROK' : meta.kind === 'anthropic' ? 'ANTHROPIC' : 'GEMINI';
      let rate;
      try { rate = realRateFor(rateProvider, model); } catch { throw new TestChatUnavailable('budget', 409); }
      const ceiling = quoteTokens(action.messages, rate.inputPerMTok, rate.outputPerMTok);
      if (ceiling > 0) {
        officialReceipt = await reserveShared(db, requestId, uid, ceiling);
        if (!officialReceipt) throw new TestChatUnavailable('budget', 409);
      }
      if (meta.kind === 'anthropic') {
        const key = firstPresent(process.env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
        const result = await releaseIfUnused(officialReceipt, () => runOfficialAnthropicTest({ apiKey: key, model, messages: action.messages, signal: bounded }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
      if (meta.kind === 'kimi') {
        const base = (process.env.KIMI_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
        const result = await releaseIfUnused(officialReceipt, () => runOfficialOpenAiCompatTest({
          url: `${base}/chat/completions`, apiKey: firstPresent(process.env, ['KIMI_API_KEY']), model, messages: action.messages, signal: bounded,
        }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
      if (meta.kind === 'grok') {
        const result = await releaseIfUnused(officialReceipt, () => runOfficialOpenAiCompatTest({
          url: 'https://api.x.ai/v1/chat/completions',
          apiKey: firstPresent(process.env, ['XAI_API_KEY', 'GROK_API_KEY']), model, messages: action.messages, signal: bounded,
        }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
    }

    const adapter = compatAdapter(action.provider, detail => { captured = detail; }, requestedModel(action));
    if (!adapter) {
      if (officialReceipt) {
        try { await officialReceipt.releaseUndispatched(); } catch { /* keep the configuration error */ }
      }
      throw new TestChatUnavailable('configuration');
    }
    let paidReceipt: Awaited<ReturnType<typeof reserveShared>> = officialReceipt;
    if (!paidReceipt && adapter.rung && isPaidRung(adapter.rung.id) && adapter.rung.priceIn > 0 && adapter.rung.priceOut > 0) {
      paidReceipt = await reserveShared(db, requestId, uid, quoteTokens(action.messages, adapter.rung.priceIn, adapter.rung.priceOut));
      if (!paidReceipt) throw new TestChatUnavailable('budget', 409);
    }
    const result = await releaseIfUnused(paidReceipt, () => adapter.provider.executeTurn({
      prompt: action.messages.at(-1)?.content ?? '',
      messages: action.messages,
      signal: bounded,
    }));
    return finish(action, result.content, result.model, startedAt, result.usage);
  } catch (error) {
    if (error instanceof TestChatUnavailable) throw error;
    const latency = Math.max(0, Date.now() - startedAt);
    if (error instanceof OfficialTestChatError) {
      return fail('unconfirmed', 503, {
        model: status.model, latencyMs: latency, classification: error.classificationHint, httpStatus: error.httpStatus,
        providerCode: error.providerCode, providerType: error.providerType, providerRequestId: error.providerRequestId,
        providerMessage: error.providerMessage, rawErrorBody: error.rawErrorBody, extraSecrets,
      });
    }
    if (error instanceof FreeChainProviderError) {
      const cap = captured && 'httpStatus' in captured ? captured : undefined;
      return fail('unconfirmed', 503, {
        model: status.model, latencyMs: latency, httpStatus: cap?.httpStatus ?? error.status ?? null,
        providerCode: cap?.providerCode ?? error.code, providerType: cap?.providerType ?? null,
        providerRequestId: cap?.requestId ?? null, providerMessage: cap?.providerMessage ?? null,
        rawErrorBody: cap?.rawErrorBody ?? null, empty: error.code === 'EMPTY_RESPONSE', aborted: error.code === 'ABORTED',
        timeout: error.code === 'TIMEOUT', extraSecrets,
      });
    }
    if (error instanceof QubaxError) {
      const cap = captured && 'status' in captured ? captured : undefined;
      const last = qubaxAttempts.at(-1);
      return fail('unconfirmed', 503, {
        model: last?.model ?? status.model, latencyMs: latency, httpStatus: last?.status ?? cap?.status ?? (error.status || null),
        providerCode: last?.code ?? error.code, rawErrorBody: last?.body ?? (cap && 'body' in cap ? cap.body : null),
        providerRequestId: last?.requestId ?? (cap && 'requestId' in cap ? cap.requestId ?? null : null),
        aborted: error.code === 'QUBAX_CANCELLED', extraSecrets, finalOutcome: 'unconfirmed',
        attempts: qubaxAttempts.map(item => ({
          model: item.model, latencyMs: item.latencyMs, httpStatus: item.status,
          providerCode: item.code, rawErrorBody: item.body ?? null, providerRequestId: item.requestId ?? null,
        })),
      });
    }
    if (error instanceof FreeRoutingError) {
      const reason = error.code === 'NO_VERIFIED_FREE_MODEL' ? 'no-model' : 'unconfirmed';
      return fail(reason, error.status || 503, {
        model: status.model, latencyMs: latency, providerCode: error.code, extraSecrets,
      });
    }
    if (error instanceof Error && error.message === 'FREE_CHAIN_REGISTRY_UNAVAILABLE') {
      return fail('configuration', 503, { model: status.model, latencyMs: latency, providerCode: 'FREE_CHAIN_REGISTRY_UNAVAILABLE', extraSecrets });
    }
    if (error instanceof MitrifyError) {
      const cap = captured && 'status' in captured ? captured : undefined;
      const httpStatus = cap?.status ?? (error.status || null);
      const gatewayTimeout = httpStatus === 504 || error.code === 'MITRIFY_HTTP_504';
      return fail('unconfirmed', 503, {
        model: dispatchedModel, latencyMs: latency, httpStatus, providerCode: error.code,
        rawErrorBody: cap && 'body' in cap ? cap.body : null,
        providerRequestId: cap && 'requestId' in cap ? cap.requestId ?? null : null,
        aborted: error.code === 'MITRIFY_CANCELLED', extraSecrets,
        ...(gatewayTimeout ? { providerMessage: MITRIFY_GATEWAY_TIMEOUT } : {}),
      });
    }
    return fail('unconfirmed', 503, { model: status.model, latencyMs: latency, extraSecrets });
  }
}

function finish(action: TestChatAction, content: string, model: string, startedAt: number, usage?: { inputTokens: number; outputTokens: number }): TestChatReply {
  if (!content.trim() || content.length > TEST_CHAT_MAX_RESPONSE_CHARS || model.length > 200) {
    throw new TestChatUnavailable('unconfirmed', 503, buildTestChatDiagnostic({
      provider: action.provider, model: model.length <= 200 ? model : null,
      latencyMs: Math.max(0, Date.now() - startedAt), empty: !content.trim(), extraSecrets: secretsFor(action.provider),
    }));
  }
  return { requestId: action.requestId, provider: action.provider, content, model,
    latencyMs: Math.max(0, Date.now() - startedAt), ...(usage ? { usage } : {}), noFallback: true };
}

function compatAdapter(id: TestChatProviderId, sink: (detail: AdminCapturedProviderError) => void, modelOverride?: string | null): { provider: OpenAiCompatProvider; rung?: RungConfig } | null {
  const meta = META[id];
  if (meta.kind === 'glm-vision') {
    const key = firstPresent(process.env, ['GLM_API_KEY', 'FREE_CHAIN_GLM_API_KEY']);
    if (!key) return null;
    return {
      provider: new OpenAiCompatProvider({
        provider: 'GLM', key, model: modelOverride || 'glm-4.6v-flash', baseURL: 'https://api.z.ai/api/paas/v4',
        priority: 0, maxOutputTokens: TEST_CHAT_MAX_OUTPUT_TOKENS, timeoutMs: 60_000, streamUsage: false, adminErrorDetail: sink,
      }),
    };
  }
  if (meta.kind === 'gemini-flash') {
    const key = firstPresent(process.env, ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'FREE_CHAIN_GEMINI_API_KEY']);
    if (!key) return null;
    return {
      provider: new OpenAiCompatProvider({
        provider: 'GEMINI', key, model: 'gemini-2.5-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        priority: 0, maxOutputTokens: TEST_CHAT_MAX_OUTPUT_TOKENS, timeoutMs: 60_000, streamUsage: true,
        extraBody: { reasoning_effort: 'none' }, adminErrorDetail: sink,
      }),
    };
  }
  if (meta.kind !== 'freechain' || !meta.rungId || meta.rungId === 'openrouter') return null;
  const rung = rungOf(meta.rungId);
  if (!rung?.configured || !rung.key || !rung.model || !rung.baseURL) return null;
  const adapterName = FREECHAIN_ADAPTER[meta.rungId];
  return {
    rung,
    provider: new OpenAiCompatProvider({
      provider: adapterName, key: rung.key, envName: rung.keyEnv, model: modelOverride || rung.model, baseURL: rung.baseURL,
      priority: 0, maxOutputTokens: TEST_CHAT_MAX_OUTPUT_TOKENS, timeoutMs: 60_000, streamUsage: rung.streamUsage,
      extraBody: extraBodyFor(meta.rungId), adminErrorDetail: sink,
    }),
  };
}
