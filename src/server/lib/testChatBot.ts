import type { Firestore } from 'firebase-admin/firestore';
import { readTestChatAction, TEST_CHAT_MAX_OUTPUT_TOKENS, TEST_CHAT_MAX_RESPONSE_CHARS,
  TEST_CHAT_PROVIDER_IDS,
  type TestChatAction, type TestChatDiagnostic, type TestChatProviderId, type TestChatProviderStatus,
  type TestChatReply, type TestChatStatus } from '../../lib/testChatBot';
import { nanoUsdToDecimal, qubaxModelOverride, qubaxRequestCeilingNanoUsd, readQubaxMarketPlan } from './qubaxMarket';
import { qubaxConfig, QubaxError, runApprovedQubaxChat } from './qubax';
import { mitrifyChainEnabled, mitrifyConfig, MitrifyError, runApprovedMitrifyChain } from './mitrify';
import { getServerDb } from './serverDb';
import { assertAiAvailable } from './aiMaintenance';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { freeChainConfig, isPaidRung, type ProviderId, type RungConfig } from '../AI/FreeChain/config';
import { FreeChainStore } from '../AI/FreeChain/store';
import { reserveMonthly, settleMonthly } from '../AI/FreeChain/masterPlan';
import { maximumCostNanoUsd, usdToNanoUsd } from '../AI/FreeChain/spendCap';
import { OpenAiCompatProvider, FreeChainProviderError, type AdapterConfig, type AdminCapturedProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
import { runRegistryRung } from '../AI/FreeChain/providers/openRouterRegistryRung';
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
    const enabled = configured && mitrifyChainEnabled();
    return { ...base, configured, enabled, model, billed: true, approvalRequired: true,
      note: 'Each send still needs a reviewed exact-payload approval and a supplier-enforced ceiling. This page does not create that approval.',
      ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY : 'Mitrify chain dispatch is not enabled on the server.' }) };
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
  const blocked = !configured || (!!reason && BLOCKING_REASONS.has(reason));
  const note = reason === 'privacy'
    ? 'User chat may skip this provider for private turns; this admin test still calls only the selected provider.'
    : reason === 'free-plan-review-required'
      ? 'The free-plan review used by user chat is missing or expired; this admin test still calls only the selected provider.'
      : undefined;
  const listed = chainConfig()?.openRouterModels ?? [];
  const model = (meta.kind === 'openrouter' ? (listed[0] ?? rung?.model ?? '') : rung?.model) || null;
  const openrouterReady = meta.kind !== 'openrouter' || listed.length > 0;
  const enabled = !blocked && configured && openrouterReady;
  return {
    ...base, configured, enabled, model: model || null, billed: !!(meta.rungId && isPaidRung(meta.rungId)), approvalRequired: false,
    ...(note ? { note } : {}),
    ...(enabled ? {} : { unavailableReason: !configured ? MISSING_KEY
      : !openrouterReady ? 'No verified-free OpenRouter model is configured on the server.'
      : REASON_TEXT[reason ?? ''] ?? 'This provider is not available for dispatch.' }),
  };
}

/** Reading this status never probes the provider, performs inference or reveals a credential. */
export async function loadTestChatStatus(): Promise<TestChatStatus> {
  const status = testChatStatus();
  const ceiling = qubaxRequestCeilingNanoUsd(process.env);
  const override = qubaxModelOverride(process.env);
  if (!ceiling || override.mode === 'invalid') return status;
  try {
    const db = getServerDb();
    if (!db) return status;
    const plan = await readQubaxMarketPlan(db, override, Date.now());
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
    return { ...status, approvalRequired: providers.some(p => p.approvalRequired), providers };
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
  let captured: AdminCapturedProviderError | { status: number; body: string; requestId?: string } | undefined;
  const qubaxAttempts: Array<{ model: string; status: number | null; code: string; latencyMs: number; body?: string; requestId?: string }> = [];
  try {
    if (meta.kind === 'qubax') {
      const result = await runApprovedQubaxChat({
        db, uid, requestId, signal: bounded, privateTurn: true, healthTurn: true,
        body: { messages: action.messages, max_tokens: TEST_CHAT_MAX_OUTPUT_TOKENS, stream: false },
        revalidate,
        onHttpError: detail => { captured = detail; },
        onAttemptError: detail => { if (qubaxAttempts.length < 8) qubaxAttempts.push(detail); },
        reserve: async (maximumNanoUsd, attemptKey) => {
          await revalidate();
          const receipt = await reserveShared(db, attemptKey ?? requestId, uid, maximumNanoUsd);
          return receipt ? { releaseUndispatched: receipt.releaseUndispatched } : null;
        },
      });
      if (result.kind === 'skipped') {
        const reason = SKIP_REASON[result.reason] ?? 'unconfirmed';
        const last = qubaxAttempts.at(-1);
        throw new TestChatUnavailable(reason, 409, buildTestChatDiagnostic({
          extraSecrets, provider: action.provider, model: last?.model ?? status.model,
          latencyMs: Math.max(0, Date.now() - startedAt), httpStatus: last?.status ?? null,
          providerCode: last?.code ?? result.reason, rawErrorBody: last?.body ?? null,
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
      const result = await runApprovedMitrifyChain({
        db, uid, requestId, signal: bounded, privateTurn: true, healthTurn: true, maxHttpAttempts: 1,
        body: { messages: action.messages, max_tokens: TEST_CHAT_MAX_OUTPUT_TOKENS, stream: false },
        revalidate,
        onHttpError: detail => { captured = detail; },
        reserve: async maximumNanoUsd => {
          await revalidate();
          const receipt = await reserveShared(db, requestId, uid, maximumNanoUsd);
          return receipt ? { releaseUndispatched: receipt.releaseUndispatched } : null;
        },
      });
      if (result.kind === 'skipped') throw new TestChatUnavailable('approval-or-budget', 409);
      return finish(action, result.content, result.model, startedAt, result.usage);
    }
    if (meta.kind === 'surplus' || meta.kind === 'router-one') throw new TestChatUnavailable('disabled');

    if (meta.kind === 'openrouter') {
      const models = chainConfig()?.openRouterModels ?? [];
      if (!models.length) throw new TestChatUnavailable('configuration');
      const prompt = action.messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
      const result = await runRegistryRung({ prompt, maxOutputTokens: TEST_CHAT_MAX_OUTPUT_TOKENS, signal: bounded }, models, models[0]);
      return finish(action, result.content, result.model, startedAt, result.usage);
    }

    if (meta.kind === 'kimi' || meta.kind === 'grok' || meta.kind === 'anthropic' || meta.kind === 'gemini-flash') {
      const model = status.model || (meta.kind === 'kimi' ? 'kimi-k2.7' : meta.kind === 'grok' ? 'grok-3-fast' : meta.kind === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash');
      const rateProvider = meta.kind === 'kimi' ? 'KIMI' : meta.kind === 'grok' ? 'GROK' : meta.kind === 'anthropic' ? 'ANTHROPIC' : 'GEMINI';
      let rate;
      try { rate = realRateFor(rateProvider, model); } catch { throw new TestChatUnavailable('budget', 409); }
      const ceiling = quoteTokens(action.messages, rate.inputPerMTok, rate.outputPerMTok);
      let receipt: Awaited<ReturnType<typeof reserveShared>> = null;
      if (ceiling > 0) {
        receipt = await reserveShared(db, requestId, uid, ceiling);
        if (!receipt) throw new TestChatUnavailable('budget', 409);
      }
      if (meta.kind === 'anthropic') {
        const key = firstPresent(process.env, ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
        const result = await releaseIfUnused(receipt, () => runOfficialAnthropicTest({ apiKey: key, model, messages: action.messages, signal: bounded }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
      if (meta.kind === 'kimi') {
        const base = (process.env.KIMI_BASE_URL?.trim() || 'https://api.moonshot.ai/v1').replace(/\/+$/, '');
        const result = await releaseIfUnused(receipt, () => runOfficialOpenAiCompatTest({
          url: `${base}/chat/completions`, apiKey: firstPresent(process.env, ['KIMI_API_KEY']), model, messages: action.messages, signal: bounded,
        }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
      if (meta.kind === 'grok') {
        const result = await releaseIfUnused(receipt, () => runOfficialOpenAiCompatTest({
          url: 'https://api.x.ai/v1/chat/completions',
          apiKey: firstPresent(process.env, ['XAI_API_KEY', 'GROK_API_KEY']), model, messages: action.messages, signal: bounded,
        }));
        return finish(action, result.content, result.model, startedAt, result.usage);
      }
    }

    const adapter = compatAdapter(action.provider, detail => { captured = detail; });
    if (!adapter) throw new TestChatUnavailable('configuration');
    let paidReceipt: Awaited<ReturnType<typeof reserveShared>> = null;
    if (adapter.rung && isPaidRung(adapter.rung.id) && adapter.rung.priceIn > 0 && adapter.rung.priceOut > 0) {
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
    if (error instanceof MitrifyError) {
      const cap = captured && 'status' in captured ? captured : undefined;
      return fail('unconfirmed', 503, {
        model: status.model, latencyMs: latency, httpStatus: cap?.status ?? (error.status || null), providerCode: error.code,
        rawErrorBody: cap && 'body' in cap ? cap.body : null,
        providerRequestId: cap && 'requestId' in cap ? cap.requestId ?? null : null,
        aborted: error.code === 'MITRIFY_CANCELLED', extraSecrets,
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

function compatAdapter(id: TestChatProviderId, sink: (detail: AdminCapturedProviderError) => void): { provider: OpenAiCompatProvider; rung?: RungConfig } | null {
  const meta = META[id];
  if (meta.kind === 'glm-vision') {
    const key = firstPresent(process.env, ['GLM_API_KEY', 'FREE_CHAIN_GLM_API_KEY']);
    if (!key) return null;
    return {
      provider: new OpenAiCompatProvider({
        provider: 'GLM', key, model: 'glm-4.6v-flash', baseURL: 'https://api.z.ai/api/paas/v4',
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
      provider: adapterName, key: rung.key, envName: rung.keyEnv, model: rung.model, baseURL: rung.baseURL,
      priority: 0, maxOutputTokens: TEST_CHAT_MAX_OUTPUT_TOKENS, timeoutMs: 60_000, streamUsage: rung.streamUsage,
      extraBody: extraBodyFor(meta.rungId), adminErrorDetail: sink,
    }),
  };
}
