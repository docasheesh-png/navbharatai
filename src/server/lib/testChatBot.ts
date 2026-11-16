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
import { ROUTER_ONE_DEFAULT_BASE_URL, ROUTER_ONE_DEFAULT_MODEL, routerOneApiKey, routerOneBaseUrl, routerOneModels } from '../AI/RouterOne/routerOne';
import { ROUTER_ONE_AUTO_MODEL } from '../AI/RouterOne/routerOneCatalog';
import { routerOnePublicPrices } from '../AI/RouterOne/publicPriceSource';
import type { CatalogueRateBand } from '../AI/RouterOne/catalogueMath';
import { buildTestChatDiagnostic } from './testChatBotDiagnostics';
import { isOfficialChatUrl, OfficialTestChatError, runOfficialAnthropicTest, runOfficialOpenAiCompatTest, runOfficialVertexTest } from './testChatBotOfficial';
import { nemotronBaseUrl, nemotronKey, nemotronSuperModel } from '../AgentV3/nemotron';
import { vertexGenAI, vertexProjectId } from './vertexGenAI';
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

type ProviderKind = 'qubax' | 'mitrify' | 'freechain' | 'openrouter' | 'glm-vision' | 'gemini-flash' | 'kimi' | 'grok' | 'anthropic' | 'surplus' | 'router-one'
  | 'glm-builder' | 'nemotron' | 'bedrock-glm' | 'vertex' | 'non-chat';
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
  'glm-builder': { label: 'Z.AI GLM (builder models)', kind: 'glm-builder' },
  nemotron: { label: 'NVIDIA Nemotron (builder)', kind: 'nemotron', internalRouting: true },
  'bedrock-glm': { label: 'AWS Bedrock GLM', kind: 'bedrock-glm' },
  'vertex-gemini': { label: 'Google Vertex AI Gemini', kind: 'vertex' },
  'sarvam-speech': { label: 'Sarvam AI (speech only)', kind: 'non-chat' },
  'pollinations-image': { label: 'Pollinations (images only)', kind: 'non-chat' },
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
// A request to list a provider for testing is not approval of unknown costs or terms.
const BLUESMINDS_TEST_PENDING = 'BluesMinds testing was requested, but free/paid cost and provider terms are not verified. No paid test budget is authorized; dispatch remains unavailable.';

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

// Router One (admin 2026-11-15: "jaise mai other api provider test karta hu ... usi list me, router one bhi test ho
// jaye"). It was listed but never called because this page had no per-request spending ceiling for it. The ceiling now
// comes from Router One's own POSTED public tariff on router.one — the same source the builder's catalogue ranks on — so
// nothing is invented: no posted price for the model means no call.
export const ROUTER_ONE_TEST_CHAT_URL = `${ROUTER_ONE_DEFAULT_BASE_URL}/chat/completions`;
/**
 * Router One's default models are reasoning models: at the page's 1,024-token bound deepseek-v4.1-flash spent
 * every token thinking and returned an empty answer (admin report 2026-11-15). This call gets room to think and
 * answer, and the reserve is quoted for exactly this bound.
 */
export const ROUTER_ONE_TEST_MAX_TOKENS = 8_192;
export const ROUTER_ONE_PRICE_UNAVAILABLE = 'Router One’s posted price for this model could not be read from router.one, so this page has no spending ceiling for it and did not call it. Choose a model listed on router.one/models, or try again in a few minutes.';
function routerOneOfficialEndpoint(): boolean {
  return routerOneBaseUrl().replace(/\/+$/, '') === ROUTER_ONE_DEFAULT_BASE_URL;
}
/** The first priced model on the Router One path. Router One's own "auto" router has no posted price, so it is skipped. */
function routerOneTestModel(): string {
  return routerOneModels().find(model => model !== ROUTER_ONE_AUTO_MODEL) ?? ROUTER_ONE_DEFAULT_MODEL;
}
/** Highest posted band, so a long conversation that lands in a pricier band is still inside the reserve. */
export function routerOneTariffCeilingNanoUsd(messages: TestChatAction['messages'], bands: readonly CatalogueRateBand[]): number {
  const priceIn = Math.max(0, ...bands.map(band => Number(band.inputUsdPerMillion)));
  const priceOut = Math.max(0, ...bands.map(band => Number(band.outputUsdPerMillion)));
  if (!bands.length || !Number.isFinite(priceIn) || !Number.isFinite(priceOut) || priceIn + priceOut <= 0) return 0;
  return quoteTokens(messages, priceIn, priceOut, ROUTER_ONE_TEST_MAX_TOKENS);
}

// ─── Builder and fallback engines (admin 2026-11-15) ────────────────────────────────────────────────────
// Each reads the SAME env the builder reads, so a green test here means the builder's own key, endpoint and
// model answer. Only official hosts are called (isOfficialChatUrl); a custom proxy URL leaves the entry
// disabled with the reason, never silently pointed somewhere else.
const firstModel = (raw: string | undefined, fallback: string): string =>
  String(raw ?? '').split(',').map(v => v.trim()).find(Boolean) || fallback;
function kimiBase(): string { return (process.env.KIMI_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/+$/, ''); }
function glmBuilderBase(): string { return (process.env.GLM_BASE_URL?.trim() || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, ''); }
function bedrockBase(): string { return `https://bedrock-runtime.${(process.env.BEDROCK_REGION || 'us-west-2').trim()}.amazonaws.com/openai/v1`; }
const SURPLUS_TEST_URL = 'https://api.surplusintelligence.ai/min90/v1/chat/completions';
const SURPLUS_DEFAULT_MODEL = 'deepseek-v4.1-flash';
/** Each non-chat service names what it actually does, so the list is a complete census without a fake button. */
const NON_CHAT_REASON: Partial<Record<TestChatProviderId, string>> = {
  'sarvam-speech': 'Sarvam AI is used only for text-to-speech (Voice AI). It has no chat endpoint, so it cannot be tested in a chat.',
  'pollinations-image': 'Pollinations is used only for image generation. It has no chat endpoint here, so it cannot be tested in a chat.',
};
const NON_CHAT_KEY: Partial<Record<TestChatProviderId, string>> = {
  'sarvam-speech': 'SARVAM_API_KEY', 'pollinations-image': 'POLLINATIONS_API_KEY',
};
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
const MITRIFY_CATALOG_MIN_USD_PER_MTOK = 0.001;
function mitrifyCatalogPrice(value: unknown): number | null {
  let amount: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) amount = value;
  else if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) amount = Number(value);
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount < MITRIFY_CATALOG_MIN_USD_PER_MTOK) return null;
  try { usdToNanoUsd(amount); return amount; } catch { return null; }
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
    if (/(^|[^a-z])(embed|embedding|image|audio|tts|whisper|moderation|rerank|flux|sdxl|stable-diffusion)([^a-z]|$)/.test(kind) && !/(chat|instruct|completion)/.test(kind)) continue;
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
const MITRIFY_CATALOG_MAX_BYTES = 1_000_000;
const MITRIFY_CATALOG_TIMEOUT_MS = 12_000;
const MITRIFY_CATALOG_ERROR_BYTES = 4_000;
function hasUsableMitrifyPrices(row: ListedMitrifyModel): boolean {
  if (row.prompt == null || row.completion == null) return false;
  if (!(row.prompt > 0) || !(row.completion > 0)) return false;
  if (row.prompt < MITRIFY_CATALOG_MIN_USD_PER_MTOK || row.completion < MITRIFY_CATALOG_MIN_USD_PER_MTOK) return false;
  try { usdToNanoUsd(row.prompt); usdToNanoUsd(row.completion); return true; } catch { return false; }
}
function describeListedMitrifyIds(ids: readonly string[]): string {
  const shown = ids.slice(0, 20);
  return `${shown.join(', ')}${ids.length > shown.length ? ` (+${ids.length - shown.length} more)` : ''}` || '(none)';
}
type MitrifyCatalogPick =
  | { kind: 'picked'; model: ListedMitrifyModel; priced: boolean }
  | { kind: 'empty' }
  | { kind: 'not-listed'; ids: string[] }
  | { kind: 'no-prices'; ids: string[] };
function pickListedMitrifyModel(listed: readonly ListedMitrifyModel[], preferred: string | null): MitrifyCatalogPick {
  if (!listed.length) return { kind: 'empty' };
  const ids = listed.map(item => item.id);
  const priced = listed.filter(hasUsableMitrifyPrices);
  if (preferred) {
    const row = listed.find(item => item.id === preferred);
    if (!row) return { kind: 'not-listed', ids };
    if (priced.length) return hasUsableMitrifyPrices(row) ? { kind: 'picked', model: row, priced: true } : { kind: 'no-prices', ids };
    return preferred === 'mitrify/auto-cheap' ? { kind: 'picked', model: row, priced: false } : { kind: 'no-prices', ids };
  }
  if (priced.length) {
    const [model] = [...priced].sort((a, b) => ((a.prompt as number) + (a.completion as number)) - ((b.prompt as number) + (b.completion as number)) || a.id.localeCompare(b.id));
    return { kind: 'picked', model, priced: true };
  }
  const auto = listed.find(item => item.id === 'mitrify/auto-cheap');
  return auto ? { kind: 'picked', model: auto, priced: false } : { kind: 'no-prices', ids };
}
async function readCappedUtf8(response: Response, maxBytes: number, onTooLarge: () => never): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) onTooLarge();
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) onTooLarge();
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
async function readCappedErrorBody(response: Response): Promise<string> {
  if (!response.body) {
    try { return (await response.text()).slice(0, MITRIFY_CATALOG_ERROR_BYTES); } catch { return ''; }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const next = part.value;
      if (size + next.byteLength > MITRIFY_CATALOG_ERROR_BYTES) {
        chunks.push(next.subarray(0, MITRIFY_CATALOG_ERROR_BYTES - size));
        break;
      }
      chunks.push(next);
      size += next.byteLength;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
async function loadMitrifyListedModels(signal: AbortSignal, sink: (detail: { status: number; body: string; requestId?: string }) => void): Promise<ListedMitrifyModel[]> {
  const cfg = mitrifyConfig();
  if (!present(cfg.apiKey)) throw new MitrifyError('MITRIFY_CONFIGURATION');
  let base: URL;
  try { base = new URL(cfg.baseURL); } catch { throw new MitrifyError('MITRIFY_CONFIGURATION'); }
  const catalogController = new AbortController();
  const timer = setTimeout(() => catalogController.abort(), MITRIFY_CATALOG_TIMEOUT_MS);
  const onParentAbort = () => catalogController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });
  if (signal.aborted) catalogController.abort();
  try {
    const response = await fetch(`${base.href.replace(/\/$/, '')}/models`, {
      method: 'GET', redirect: 'error', signal: catalogController.signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      sink({
        status: response.status, body: await readCappedErrorBody(response),
        requestId: response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('x-mitrify-request-id') || undefined,
      });
      throw new MitrifyError(response.status === 401 ? 'MITRIFY_CONFIGURATION' : `MITRIFY_HTTP_${response.status}`, response.status);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
    const raw = await readCappedUtf8(response, MITRIFY_CATALOG_MAX_BYTES, () => { throw new MitrifyError('MITRIFY_CATALOG_TOO_LARGE'); });
    try { return parseMitrifyListedModels(JSON.parse(raw)); }
    catch { throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status); }
  } catch (error) {
    if (error instanceof MitrifyError) throw error;
    if (signal.aborted) throw new MitrifyError('MITRIFY_CANCELLED');
    if (catalogController.signal.aborted) throw new MitrifyError('MITRIFY_CATALOG_TIMEOUT');
    throw new MitrifyError('MITRIFY_NETWORK');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
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
    return { ...base, configured, enabled, model: null, billed: true, approvalRequired: false,
      ceilingUsd: ceiling ? nanoUsdToDecimal(ceiling) : null,
      ...(configured && enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'This provider is disabled on the server.' }) };
  }
  if (meta.kind === 'mitrify') {
    let configured = false, model: string | null = null;
    try { const cfg = mitrifyConfig(); configured = present(cfg.apiKey); model = cfg.model || null; } catch { configured = false; }
    const enabled = configured;
    return { ...base, configured, enabled, model, billed: true, approvalRequired: false,
      note: 'This admin test calls Mitrify when its server key is set. At send time it reads Mitrify’s live /v1/models list with a size cap and a short timeout, then calls only a listed chat model: the cheapest row whose prompt and completion are both greater than 0 and at least $0.001/MTok, or mitrify/auto-cheap if that alias is listed and the catalog has no usable prices. Zero, negative, and tiny per-token-looking prices do not count. Image-like ids (flux, sdxl, stable-diffusion) are excluded. Otherwise it fails closed and names the listed ids. Catalog prices are used for the shared-budget reserve when present. This does not turn on the user-chat chain flag or mint a payload approval.',
      ...(enabled ? {} : { unavailableReason: MISSING_KEY }) };
  }
  if (meta.kind === 'surplus') {
    const configured = !!firstPresent(process.env, ['SURPLUS_API_KEY']);
    return { ...base, configured, enabled: configured, model: SURPLUS_DEFAULT_MODEL, billed: true, approvalRequired: false,
      note: 'One direct call to Surplus’s min90 chat endpoint (its price-first route), never the builder transport that retries. Surplus publishes no per-model price this page can read, so the reserve uses the Claude Sonnet rate card for the 1,024-token bound — deliberately above any min90 price; it is a ceiling, not the bill.',
      ...(configured ? {} : { unavailableReason: MISSING_KEY }) };
  }
  if (meta.kind === 'router-one') {
    const configured = present(routerOneApiKey());
    const enabled = configured && routerOneOfficialEndpoint();
    return { ...base, configured, enabled, model: routerOneTestModel(), billed: true, approvalRequired: false,
      note: 'At send time this page reads Router One’s posted public price for the selected model from router.one (the same tariff the builder ranks on), reserves the highest posted band for this page’s 1,024-token bound against the shared paid budget, then makes one call with no retry. If no posted price can be read, it does not call. A typed model is priced the same way; Router One’s own "auto" router has no posted price and is not called.',
      ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'This test page only calls the official Router One endpoint.' }) };
  }
  if (meta.kind === 'kimi') {
    const configured = !!firstPresent(process.env, ['KIMI_API_KEY']);
    // The builder's own KIMI_BASE_URL, which may be the Kimi Code host (api.kimi.com) as well as Moonshot.
    const enabled = configured && isOfficialChatUrl(`${kimiBase()}/chat/completions`);
    return { ...base, configured, enabled, model: firstModel(process.env.KIMI_MODEL, 'kimi-k2.7'), billed: true, approvalRequired: false,
      ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'This test page only calls the official Kimi / Moonshot endpoints.' }) };
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
  if (meta.kind === 'glm-builder') {
    const configured = !!firstPresent(process.env, ['GLM_API_KEY']);
    const enabled = configured && isOfficialChatUrl(`${glmBuilderBase()}/chat/completions`);
    return { ...base, configured, enabled, model: 'glm-5.3', billed: true, approvalRequired: false,
      note: 'The builder’s GLM key and endpoint. Type any GLM model id the builder uses (for example glm-5.3 or glm-4.7-flashx); it is priced from the in-repo rate card.',
      ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'This test page only calls the official Z.AI endpoint.' }) };
  }
  if (meta.kind === 'nemotron') {
    const configured = present(nemotronKey());
    const enabled = configured && isOfficialChatUrl(`${nemotronBaseUrl().replace(/\/+$/, '')}/chat/completions`);
    return { ...base, configured, enabled, model: nemotronSuperModel(), billed: true, approvalRequired: false,
      note: 'The builder’s Nemotron key, host and model (super by default; type the ultra id to test it).',
      ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'This test page only calls the official OpenRouter or NVIDIA endpoints.' }) };
  }
  if (meta.kind === 'bedrock-glm') {
    const configured = !!firstPresent(process.env, ['BEDROCK_API_KEY']);
    const enabled = configured && isOfficialChatUrl(`${bedrockBase()}/chat/completions`);
    return { ...base, configured, enabled, model: firstModel(process.env.BEDROCK_GLM_MODEL, 'zai.glm-5'), billed: true, approvalRequired: false,
      note: 'The builder’s Bedrock cheap-floor rung, through Bedrock’s OpenAI-compatible endpoint in the configured region.',
      ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'The configured Bedrock region is not a valid AWS region name.' }) };
  }
  if (meta.kind === 'vertex') {
    const configured = !!vertexProjectId();
    return { ...base, configured, enabled: configured, model: 'gemini-2.5-pro', billed: true, approvalRequired: false,
      note: 'Engineer AI’s Vertex fallback, through the server’s own Google identity (no API key). Type gemini-2.5-flash to test the cheaper model.',
      ...(configured ? {} : { unavailableReason: 'No Google Cloud project is configured on the server.' }) };
  }
  if (meta.kind === 'non-chat') {
    const keyName = NON_CHAT_KEY[id];
    return { ...base, configured: !!(keyName && firstPresent(process.env, [keyName])), enabled: false, model: null, billed: false, approvalRequired: false,
      unavailableReason: NON_CHAT_REASON[id] ?? 'This service has no chat endpoint.' };
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
  // Preserve only the pre-existing, named CheaperInference admin-test exception.
  // Do not generalize it to providers with unverified terms or unknown test costs.
  const cheapinfUserFlag = meta.rungId === 'cheapinf' && configured
    && (reason === 'disabled' || reason === 'terms-shared-access') && !!rung?.model;
  const bluesmindsPending = meta.rungId === 'bluesminds';
  const blocked = bluesmindsPending || !configured
    || (!!reason && BLOCKING_REASONS.has(reason) && !cheapinfUserFlag)
    || (configured && !rung?.model && meta.kind !== 'openrouter');
  const note = bluesmindsPending
    ? BLUESMINDS_TEST_PENDING
    : reason === 'privacy'
    ? 'User chat may skip this provider for private turns; this admin test still calls only the selected provider.'
    : reason === 'free-plan-review-required'
      ? 'The free-plan review used by user chat is missing or expired; this admin test still calls only the selected provider.'
      : meta.kind === 'openrouter'
        ? 'A send uses the same LiveRegistry verified-free ranking as main chat when that registry is configured (strictFreeText / runRegistryRung). If it is not, this page fetches OpenRouter’s public catalog at send time and calls only a model whose catalog price is 0/0 and whose id ends with :free. The reply names the chosen model. This does not change user-chat routing.'
        : meta.rungId === 'cheapinf'
          ? 'This admin test can call CheaperInference when its key is set, using the same model string main chat would use. It does not change the user-chat sharing mode.'
        : undefined;
  const modelMissing = configured && !rung?.model && meta.kind !== 'openrouter';
  const listed = chainConfig()?.openRouterModels ?? [];
  const model = (meta.kind === 'openrouter' ? (listed[0] ?? rung?.model ?? '') : rung?.model) || null;
  const enabled = !blocked && configured;
  return {
    ...base, configured, enabled, model: model || null, billed: !!(meta.rungId && isPaidRung(meta.rungId)), approvalRequired: false,
    ...(note ? { note } : {}),
    ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY
      : modelMissing ? REASON_TEXT['model-unverified']
      : bluesmindsPending ? BLUESMINDS_TEST_PENDING
      : REASON_TEXT[reason ?? ''] ?? 'This provider is not available for dispatch.' }),
  };
}

const STATUS_TEXT_MAX = 400;
function clipStatusText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/\u0000/g, '').trim();
  if (!text) return undefined;
  return text.length <= STATUS_TEXT_MAX ? text : `${text.slice(0, STATUS_TEXT_MAX - 1)}…`;
}
function publishable(row: TestChatProviderStatus): TestChatProviderStatus {
  const unavailableReason = clipStatusText(row.unavailableReason);
  const note = clipStatusText(row.note);
  const next = { ...row };
  if (unavailableReason) next.unavailableReason = unavailableReason; else delete next.unavailableReason;
  if (note) next.note = note; else delete next.note;
  return next;
}
function unreadProvider(id: TestChatProviderId): TestChatProviderStatus {
  return { id, label: META[id].label, configured: false, enabled: false, model: null, approvalRequired: false, billed: false,
    unavailableReason: 'This provider’s status could not be read.' };
}
/** Admin status reads stored market diagnostics only. Failed reads retain configuration status. */
export async function loadTestChatStatus(): Promise<TestChatStatus> {
  const status = testChatStatus();
  const ceiling = qubaxRequestCeilingNanoUsd(process.env);
  const override = qubaxModelOverride(process.env);
  if (!ceiling || override.mode === 'invalid') return status;
  try {
    const db = getServerDb();
    if (!db) return status;
    // Status is observation only. Refresh can schedule paid probes; leave it to
    // scheduled collection or an explicit send, never opening/refreshing this page.
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
  const providers = TEST_CHAT_PROVIDER_IDS.map(id => {
    try { return publishable(providerStatus(id)); } catch { return unreadProvider(id); }
  });
  return { providers, approvalRequired: providers.some(p => p.approvalRequired === true), noFallback: true };
}

function needsSharedPaidConfig(id: TestChatProviderId): boolean {
  const meta = META[id];
  if (meta.kind === 'qubax' || meta.kind === 'mitrify' || meta.kind === 'kimi' || meta.kind === 'grok' || meta.kind === 'anthropic' || meta.kind === 'gemini-flash' || meta.kind === 'router-one'
    || meta.kind === 'surplus' || meta.kind === 'glm-builder' || meta.kind === 'nemotron' || meta.kind === 'bedrock-glm' || meta.kind === 'vertex') return true;
  return !!(meta.rungId && isPaidRung(meta.rungId));
}

function quoteTokens(messages: TestChatAction['messages'], priceIn: number, priceOut: number, outputTokens = TEST_CHAT_MAX_OUTPUT_TOKENS): number {
  const inputTokens = Buffer.byteLength(JSON.stringify(messages), 'utf8') + 256;
  return maximumCostNanoUsd(inputTokens, outputTokens, usdToNanoUsd(priceIn), usdToNanoUsd(priceOut));
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
  push(routerOneApiKey());
  push(firstPresent(process.env, ['SURPLUS_API_KEY']));
  push(firstPresent(process.env, ['GLM_API_KEY']));
  push(nemotronKey());
  push(firstPresent(process.env, ['BEDROCK_API_KEY']));
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
      const selection = pickListedMitrifyModel(listed, preferred);
      if (selection.kind !== 'picked') {
        const ids = selection.kind === 'empty' ? [] : selection.ids;
        return fail('no-model', 503, {
          model: preferred ?? status.model, latencyMs: Math.max(0, Date.now() - startedAt),
          providerCode: selection.kind === 'not-listed' ? 'MITRIFY_MODEL_NOT_LISTED' : selection.kind === 'empty' ? 'MITRIFY_CATALOG_EMPTY' : 'MITRIFY_NO_PRICES',
          providerMessage: selection.kind === 'not-listed'
            ? 'The typed model is not in Mitrify’s live /v1/models list, so this admin test did not call it.'
            : selection.kind === 'empty'
              ? 'Mitrify’s live /v1/models list has no usable chat model for this admin test.'
              : `Mitrify’s live /v1/models list has no usable prices, so this admin test did not pick an alphabetical model. Listed ids: ${describeListedMitrifyIds(ids)}.`,
          extraSecrets,
        });
      }
      const picked = selection.model.id;
      dispatchedModel = picked;
      const ceiling = quoteTokens(
        action.messages,
        selection.priced ? selection.model.prompt as number : 1,
        selection.priced ? selection.model.completion as number : 1,
      );
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
    if (meta.kind === 'non-chat') throw new TestChatUnavailable('disabled');

    if (meta.kind === 'router-one') {
      const model = requestedModel(action) || status.model || ROUTER_ONE_DEFAULT_MODEL;
      dispatchedModel = model;
      let ceiling = 0;
      try { ceiling = routerOneTariffCeilingNanoUsd(action.messages, (await routerOnePublicPrices.snapshot(model)).bands); }
      catch { ceiling = 0; }
      if (ceiling <= 0) {
        return fail('budget', 409, { model, latencyMs: Math.max(0, Date.now() - startedAt),
          providerCode: 'ROUTER_ONE_PRICE_UNAVAILABLE', providerMessage: ROUTER_ONE_PRICE_UNAVAILABLE, extraSecrets });
      }
      const receipt = await reserveShared(db, requestId, uid, ceiling);
      if (!receipt) throw new TestChatUnavailable('budget', 409);
      const result = await releaseIfUnused(receipt, () => runOfficialOpenAiCompatTest({
        url: ROUTER_ONE_TEST_CHAT_URL, apiKey: routerOneApiKey(), model, messages: action.messages, signal: bounded,
        // Streamed, as the builder calls it: a non-streamed Router One reply waited past the 90-second bound.
        stream: true,
        maxTokens: ROUTER_ONE_TEST_MAX_TOKENS,
      }));
      return finish(action, result.content, result.model || model, startedAt, result.usage);
    }

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
    if (meta.kind === 'kimi' || meta.kind === 'grok' || meta.kind === 'anthropic' || meta.kind === 'gemini-flash'
      || meta.kind === 'surplus' || meta.kind === 'glm-builder' || meta.kind === 'nemotron' || meta.kind === 'bedrock-glm' || meta.kind === 'vertex') {
      // A typed model is honoured for every official adapter (admin 2026-11-15: test every model the builder
      // uses — kimi-k3, Claude Opus/Haiku, glm-5.3 …). Gemini Flash stays fixed: its compat adapter pins the model.
      const model = (meta.kind !== 'gemini-flash' ? requestedModel(action) : null) || status.model
        || (meta.kind === 'kimi' ? 'kimi-k2.7' : meta.kind === 'grok' ? 'grok-3-fast' : meta.kind === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash');
      dispatchedModel = model;
      const rateProvider = meta.kind === 'kimi' ? 'KIMI' : meta.kind === 'grok' ? 'GROK' : meta.kind === 'anthropic' ? 'ANTHROPIC'
        : meta.kind === 'glm-builder' ? 'GLM' : meta.kind === 'nemotron' ? 'NEMOTRON' : meta.kind === 'bedrock-glm' ? 'BEDROCK-GLM'
        : meta.kind === 'vertex' ? 'VERTEX' : 'GEMINI';
      let rate;
      // Surplus has no rate card (realRateFor refuses it by design); its reserve is the Sonnet card — a ceiling.
      try { rate = meta.kind === 'surplus' ? realRateFor('ANTHROPIC', 'sonnet') : realRateFor(rateProvider, model); } catch { throw new TestChatUnavailable('budget', 409); }
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
        const result = await releaseIfUnused(officialReceipt, () => runOfficialOpenAiCompatTest({
          url: `${kimiBase()}/chat/completions`, apiKey: firstPresent(process.env, ['KIMI_API_KEY']), model, messages: action.messages, signal: bounded,
        }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
      if (meta.kind === 'glm-builder' || meta.kind === 'nemotron' || meta.kind === 'bedrock-glm' || meta.kind === 'surplus') {
        const target = meta.kind === 'glm-builder' ? { url: `${glmBuilderBase()}/chat/completions`, apiKey: firstPresent(process.env, ['GLM_API_KEY']) }
          : meta.kind === 'nemotron' ? { url: `${nemotronBaseUrl().replace(/\/+$/, '')}/chat/completions`, apiKey: nemotronKey() }
          : meta.kind === 'bedrock-glm' ? { url: `${bedrockBase()}/chat/completions`, apiKey: firstPresent(process.env, ['BEDROCK_API_KEY']) }
          : { url: SURPLUS_TEST_URL, apiKey: firstPresent(process.env, ['SURPLUS_API_KEY']) };
        const result = await releaseIfUnused(officialReceipt, () => runOfficialOpenAiCompatTest({
          ...target, model, messages: action.messages, signal: bounded,
          ...(meta.kind === 'nemotron' ? { allowPaid: true } : {}),
          ...(meta.kind === 'surplus' ? { extraBody: { si_route: { objective: 'price' } } } : {}),
        }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
      if (meta.kind === 'vertex') {
        const result = await releaseIfUnused(officialReceipt, () => runOfficialVertexTest({
          client: vertexGenAI() as unknown as Parameters<typeof runOfficialVertexTest>[0]['client'], model, messages: action.messages, signal: bounded,
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
        ...(error.code === 'MITRIFY_CATALOG_TOO_LARGE' ? { providerMessage: 'Mitrify’s /v1/models response exceeded the admin catalog size cap, so this test did not call chat.' } : {}),
        ...(error.code === 'MITRIFY_CATALOG_TIMEOUT' ? { providerMessage: 'Mitrify’s /v1/models list did not arrive within the admin catalog timeout, so this test did not call chat.' } : {}),
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

