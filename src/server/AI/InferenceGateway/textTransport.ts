/**
 * Server-only, single-dispatch text transport. This is NOT a public router or an
 * admission authority. Its caller must authenticate the exact durable claim and
 * reviewed account/configuration immediately before dispatch. No legacy guard is
 * relaxed, no SDK retry/fallback exists, and credentials are resolved only here.
 */
import { createHash } from 'node:crypto';
import { realRateFor } from '../../AgentV3/providerRates';
import { CHAT_INPUT_WEIGHT } from '../freeTierCostCeiling';
import { maximumCostNanoUsd, usdToNanoUsd } from '../FreeChain/spendCap';
import type { AIProviderResponse, ProviderUsage } from '../Router/ProviderTypes';
import { isCount, isIdentifier, isPositiveCount, supportsCapability } from './capabilities';
import type { AuthenticatedRejection, DispatchBinding, DispatchClaim } from './executor';
import { isInferenceExecutorTimeout } from './executor';
import { gatewayRetryAfterUntil } from './retryAfter';
import { evidenceBinding, profileRejection, withoutEvidence } from './profiles';
import type { ProviderProfile, RoutingRequest } from './types';

/** Domain-separated generation binding only. Never use a key/hash as an account or quota scope. */
export function gatewayTextCredentialBinding(credential: string): string {
  return createHash('sha256').update('navbharatai-inference-gateway-text-credential-v1\0').update(credential).digest('hex');
}

export type GatewayTextProvider = 'GLM' | 'GEMINI' | 'GROQ' | 'CLOUDFLARE' | 'DEEPSEEK';
export interface GatewayTextRateCard {
  readonly version: string;
  readonly inputNanoUsdPerMillion: number;
  readonly outputNanoUsdPerMillion: number;
  /** Optional reviewed cache reservation bound; never an exact invoice-settlement rate. */
  readonly cachedInputNanoUsdPerMillion?: number;
  readonly verifiedAtMs: number;
  readonly expiresAtMs: number;
}
/** Trusted server catalog data only, never accepted from a client request. */
export interface GatewayTextTransportConfig {
  readonly provider: GatewayTextProvider;
  readonly baseURL: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly streamUsage: boolean;
  readonly credentialEnv: string;
  /** Non-secret generation binding reviewed with the actual account, not a quota identity. */
  readonly credentialBinding: string;
  readonly rateCard?: GatewayTextRateCard;
}
export interface GatewayTextPayload {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly schema?: unknown;
  readonly images?: readonly string[];
  readonly modelOverride?: string;
  readonly streaming: boolean;
}
export interface GatewayTextAuthorization {
  readonly profile: ProviderProfile;
  readonly transport: GatewayTextTransportConfig;
  readonly claim: DispatchClaim;
  readonly request: RoutingRequest;
}
export interface GatewayTextInput extends Omit<GatewayTextPayload, 'streaming'>, GatewayTextAuthorization {
  readonly signal: AbortSignal;
  readonly onChunk?: (text: string) => void | Promise<void>;
  readonly markOutputVisible: () => Promise<void>;
  /** Persist a transport-bound contradiction before cleanup can trigger cancellation. */
  readonly reportCostAnomaly: (error: GatewayTextTransportError) => Promise<void>;
  /** Synchronous deployment/strict-policy recheck after the durable async gate, immediately before fetch. */
  readonly assertDispatchPolicy: () => void;
  /**
   * Server-owned durable, exclusive dispatch fence. Must reject replays and verify
   * current account/quality/terms/privacy, exact config (including credentialEnv),
   * payer, price and all holds. Matching JSON alone MUST NOT return true.
   */
  readonly authorizeClaim: (authorization: GatewayTextAuthorization) => Promise<boolean>;
}
export interface GatewayTextResponse extends AIProviderResponse {
  readonly completeUsage: boolean;
  readonly cachedInputTokens?: number;
  readonly finishReason: 'stop' | 'length';
  readonly outputVisible: boolean;
}
export interface GatewayTextUsage {
  readonly binding: DispatchBinding;
  readonly final: true;
  readonly outcome: { readonly kind: 'completed' };
  readonly outputVisible: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly actualNanoUsd: number;
  readonly rateCardVersion?: string;
}
/** Complete authenticated usage priced at reviewed maximums, NOT actual billed money. */
export interface GatewayTextConservativeUsage extends Omit<GatewayTextUsage, 'actualNanoUsd' | 'rateCardVersion'> {
  readonly chargeBasis: 'conservative-ceiling';
  readonly conservativeCeilingNanoUsd: number;
  readonly rateCardVersion: string;
}
export type GatewayTextErrorCode = 'CONFIGURATION' | 'POLICY_BLOCKED' | 'INVALID_REQUEST'
  | 'AUTH' | 'RATE_LIMIT' | 'QUOTA_EXHAUSTED' | 'MODEL_UNAVAILABLE' | 'SERVER' | 'NETWORK'
  | 'TIMEOUT' | 'ABORTED' | 'SAFETY_REFUSAL' | 'EMPTY_RESPONSE';
const ERROR_CODES = new Set<GatewayTextErrorCode>(['CONFIGURATION', 'POLICY_BLOCKED', 'INVALID_REQUEST', 'AUTH',
  'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'MODEL_UNAVAILABLE', 'SERVER', 'NETWORK', 'TIMEOUT', 'ABORTED', 'SAFETY_REFUSAL', 'EMPTY_RESPONSE']);
/** Never stores provider bodies, request payloads, credentials, causes or raw errors. */
export class GatewayTextTransportError extends Error {
  readonly code: GatewayTextErrorCode;
  readonly status?: number;
  constructor(code: GatewayTextErrorCode, status?: number) {
    const safeCode = ERROR_CODES.has(code) ? code : 'NETWORK';
    super(`Inference request unavailable (${safeCode}).`);
    this.name = safeCode === 'ABORTED' ? 'AbortError' : 'GatewayTextTransportError';
    this.code = safeCode;
    this.status = Number.isInteger(status) && status! >= 400 && status! <= 599 ? status : undefined;
    Object.freeze(this);
  }
}

const ENDPOINTS: Record<GatewayTextProvider, RegExp> = {
  GLM: /^https:\/\/api\.z\.ai\/api\/paas\/v4\/?$/,
  GEMINI: /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\/?$/,
  GROQ: /^https:\/\/api\.groq\.com\/openai\/v1\/?$/,
  CLOUDFLARE: /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-fA-F0-9]{32}\/ai\/v1\/?$/,
  DEEPSEEK: /^https:\/\/api\.deepseek\.com\/v1\/?$/,
};
const CONFIG_KEYS = ['provider', 'baseURL', 'model', 'maxOutputTokens', 'timeoutMs', 'streamUsage', 'credentialEnv', 'credentialBinding', 'rateCard'];
const RATE_KEYS = ['version', 'inputNanoUsdPerMillion', 'outputNanoUsdPerMillion', 'cachedInputNanoUsdPerMillion', 'verifiedAtMs', 'expiresAtMs'];
const SAFETY_REASONS = new Set(['content_filter', 'safety', 'blocklist', 'prohibited_content', 'spii', 'recitation', 'sensitive']);
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
type Raw = Record<string, unknown>;
const raw = (v: unknown): Raw | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : undefined;
const count = (v: unknown): number | undefined => typeof v === 'number' && isCount(v) ? v : undefined;
function fail(code: GatewayTextErrorCode): never { throw new GatewayTextTransportError(code); }
const equal = (a: unknown, b: unknown): boolean => evidenceBinding(a) === evidenceBinding(b);
function immutable<T>(value: T): T {
  const copy = JSON.parse(evidenceBinding(value)) as T;
  function freeze(v: unknown): void {
    if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  }
  freeze(copy); return copy;
}

/** Exact full-payload binding shared with ingress; no trimming or silent feature removal. */
export function gatewayTextPayloadDigest(input: GatewayTextPayload): string {
  return createHash('sha256').update(evidenceBinding({ prompt: input.prompt,
    systemPrompt: input.systemPrompt ?? null, schema: input.schema ?? null,
    images: input.images ?? null, modelOverride: input.modelOverride ?? null,
    streaming: input.streaming })).digest('hex');
}

/** JSON-shaped lookalikes and serialized copies can never mint accounting proof. */
const measured = new WeakMap<object, { claim: string; usage: GatewayTextUsage }>();
export function readGatewayTextUsage(result: unknown, claim: DispatchClaim): GatewayTextUsage | undefined {
  if (!result || typeof result !== 'object') return undefined;
  try {
    const proof = measured.get(result);
    return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined;
  } catch { return undefined; }
}

const ceilings = new WeakMap<object, { claim: string; usage: GatewayTextConservativeUsage }>();
export function readGatewayTextConservativeUsage(result: unknown, claim: DispatchClaim): GatewayTextConservativeUsage | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const proof = ceilings.get(result); return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined;
}
export interface GatewayTextCostAnomaly {
  readonly binding: DispatchBinding;
  readonly kind: 'free-cost-contradiction' | 'paid-liability-contradiction';
  readonly receivedAtMs: number;
}
const anomalies = new WeakMap<object, { claim: string; proof: GatewayTextCostAnomaly }>();
/** No billed amount is inferred. Only a contradictory transport response is authenticated. */
export function readGatewayTextCostAnomaly(error: unknown, claim: DispatchClaim): GatewayTextCostAnomaly | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const proof = anomalies.get(error); return proof?.claim === evidenceBinding(claim) ? proof.proof : undefined;
}

const rejected = new WeakMap<object, { claim: string; proof: Omit<AuthenticatedRejection, 'evidenceRef'> }>();
export interface GatewayTransportHealth {
  readonly binding: DispatchBinding;
  readonly kind: 'auth' | 'transient' | 'cooldown-unavailable';
  readonly receivedAtMs: number;
  readonly cooldownUntilMs?: number;
}
const health = new WeakMap<object, { claim: string; proof: GatewayTransportHealth }>();
/** Health observations never certify rejected generation, final cost or permission to retry. */
export function readGatewayTextHealth(error: unknown, claim: DispatchClaim): GatewayTransportHealth | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try { const entry = health.get(error); return entry?.claim === evidenceBinding(claim) ? entry.proof : undefined; } catch { return undefined; }
}
/** Only a received explicit HTTP429 rejection, never a network/timeout/string-shaped error. */
export function readGatewayTextRejection(error: unknown, claim: DispatchClaim): Omit<AuthenticatedRejection, 'evidenceRef'> | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const proof = rejected.get(error); return proof?.claim === evidenceBinding(claim) ? proof.proof : undefined;
}

function validRates(transport: GatewayTextTransportConfig, profile: ProviderProfile, now: number): boolean {
  const rate = transport.rateCard;
  if (profile.charging === 'verified-free-no-overage') return rate === undefined;
  if (profile.charging !== 'metered' || transport.provider !== 'DEEPSEEK' || transport.model !== 'deepseek-flash'
    || !rate || Object.keys(rate).some(key => !RATE_KEYS.includes(key)) || !isIdentifier(rate.version)
    || !isCount(rate.verifiedAtMs) || !isCount(rate.expiresAtMs) || rate.verifiedAtMs > now || rate.expiresAtMs <= now
    || !isPositiveCount(rate.inputNanoUsdPerMillion) || !isPositiveCount(rate.outputNanoUsdPerMillion)) return false;
  try {
    const minimum = realRateFor('DEEPSEEK', transport.model);
    const ceiling = realRateFor('KIMI', 'kimi-k2.7');
    if (rate.inputNanoUsdPerMillion < usdToNanoUsd(minimum.inputPerMTok)
      || rate.outputNanoUsdPerMillion < usdToNanoUsd(minimum.outputPerMTok)) return false;
    if (rate.cachedInputNanoUsdPerMillion !== undefined && (!isCount(rate.cachedInputNanoUsdPerMillion)
      || minimum.cacheReadPerMTok === undefined || rate.cachedInputNanoUsdPerMillion < usdToNanoUsd(minimum.cacheReadPerMTok)
      || rate.cachedInputNanoUsdPerMillion > rate.inputNanoUsdPerMillion)) return false;
    return maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000, rate.inputNanoUsdPerMillion, rate.outputNanoUsdPerMillion)
      <= maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000, usdToNanoUsd(ceiling.inputPerMTok), usdToNanoUsd(ceiling.outputPerMTok));
  } catch { return false; }
}

function validate(authorization: GatewayTextAuthorization, payload: GatewayTextPayload, now: number): void {
  const { transport: t, profile: p, claim: c, request: r } = authorization;
  if (!t || Object.keys(t).some(key => !CONFIG_KEYS.includes(key)) || !Object.hasOwn(ENDPOINTS, t.provider)
    || typeof t.baseURL !== 'string' || !ENDPOINTS[t.provider].test(t.baseURL)
    || typeof t.model !== 'string' || !/^[a-zA-Z0-9@][a-zA-Z0-9_./:@-]{0,255}$/.test(t.model)
    || !isPositiveCount(t.maxOutputTokens) || t.maxOutputTokens > 131072
    || !isPositiveCount(t.timeoutMs) || t.timeoutMs > 600000 || typeof t.streamUsage !== 'boolean'
    || typeof t.credentialBinding !== 'string' || !/^[a-f0-9]{64}$/.test(t.credentialBinding)
    || typeof t.credentialEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(t.credentialEnv)) fail('CONFIGURATION');
  if (!r || !p || !c || !c.binding || !isIdentifier(c.id) || !isIdentifier(c.claimId)
    || !isCount(c.queueWaitConsumedAtDispatchMs) || c.intentBinding !== evidenceBinding(c.binding)
    || profileRejection(p, r) || r.surface === 'image-generation' || r.surface === 'image-enhancement'
    || r.outputVisible || r.cancellation?.cancelled !== false || !isCount(r.deadlineAtMs) || now >= r.deadlineAtMs
    || !isPositiveCount(r.attemptTimeoutMs) || !validRates(t, p, now)) fail('POLICY_BLOCKED');
  const b = c.binding;
  if (b.profileId !== p.id || b.profileVersion !== p.version || b.providerId !== p.providerId
    || b.modelId !== p.modelId || b.modelRevision !== p.modelRevision || b.adapterId !== p.adapterId
    || p.providerId !== t.provider || p.modelId !== t.model || b.key.logicalRequestId !== r.logicalRequestId
    || b.key.principalId !== r.principalId || b.key.tenantId !== r.tenantId || b.key.payloadDigest !== r.payloadDigest
    || b.physicalAttemptId !== r.nextPhysicalAttemptId || b.budgetScopeId !== r.budgetScopeId
    || !equal(b.payer, r.payer) || b.profileBinding !== evidenceBinding(withoutEvidence(p))
    || b.requestBinding !== evidenceBinding(withoutEvidence(r)) || r.payloadDigest !== gatewayTextPayloadDigest(payload)) fail('POLICY_BLOCKED');
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim()
    || (payload.systemPrompt !== undefined && typeof payload.systemPrompt !== 'string')
    || payload.schema !== undefined || (payload.images !== undefined && (!Array.isArray(payload.images) || payload.images.length !== 0))
    || (payload.modelOverride !== undefined && payload.modelOverride !== t.model)
    || r.capability.kind !== 'text' || r.capability.streaming !== payload.streaming
    || r.capability.systemPrompt !== !!payload.systemPrompt
    || !p.capabilities.some(support => supportsCapability(r.capability, support))) fail('INVALID_REQUEST');
  const capability = r.capability;
  if (capability.outputTokens > t.maxOutputTokens) fail('INVALID_REQUEST');
  // Conservative size guard, not a tokenizer-independent token bound. No history
  // is truncated; money reserves the full reviewed context and overruns quarantine.
  if (Buffer.byteLength(payload.prompt, 'utf8') + Buffer.byteLength(payload.systemPrompt ?? '', 'utf8') + 256 > capability.inputTokens) fail('INVALID_REQUEST');
  if (p.charging === 'metered') {
    const rate = t.rateCard!;
    if (r.mode !== 'free-first-authorized-paid' || !b.budget || b.budget.rateCardVersion !== rate.version
      || !b.priceBinding || !b.budgetAuthorizationBinding
      || b.budget.amountNanoUsd < maximumCostNanoUsd(capability.inputTokens, capability.outputTokens,
        rate.inputNanoUsdPerMillion, rate.outputNanoUsdPerMillion)) fail('POLICY_BLOCKED');
  } else if (b.budget || b.priceBinding) fail('POLICY_BLOCKED');
}

interface UsageReading { usage: ProviderUsage; cachedInputTokens?: number; liabilityComplete: boolean; reasoningTokens?: number; }
function readUsage(value: unknown): UsageReading | undefined {
  const u = raw(value); const inputTokens = count(u?.prompt_tokens); const outputTokens = count(u?.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined || !isCount(inputTokens + outputTokens)) return undefined;
  if (u?.total_tokens !== undefined && u.total_tokens !== inputTokens + outputTokens) return undefined;
  const cachedRaw = u?.prompt_cache_hit_tokens ?? raw(u?.prompt_tokens_details)?.cached_tokens ?? u?.cached_tokens;
  const cachedInputTokens = count(cachedRaw);
  if (cachedRaw !== undefined && (cachedInputTokens === undefined || cachedInputTokens > inputTokens)) return undefined;
  if (u?.prompt_cache_miss_tokens !== undefined && (count(u.prompt_cache_miss_tokens) === undefined
    || cachedInputTokens === undefined || Number(u.prompt_cache_miss_tokens) + cachedInputTokens !== inputTokens)) return undefined;
  const promptDetails = raw(u?.prompt_tokens_details); const completionDetails = raw(u?.completion_tokens_details);
  const cacheValues = [u?.prompt_cache_hit_tokens, promptDetails?.cached_tokens, u?.cached_tokens].filter(v => v !== undefined);
  if (cacheValues.some(v => count(v) === undefined || v !== cachedInputTokens)) return undefined;
  const reasoningTokens = count(completionDetails?.reasoning_tokens);
  if (completionDetails?.reasoning_tokens !== undefined && (reasoningTokens === undefined || reasoningTokens > outputTokens)) return undefined;
  // Narrow documented DeepSeek text-only response classes. Unknown fields never
  // authorize release: e.g. audio/prediction/tool meters need separate review.
  const liabilityComplete = !!u && u.total_tokens === inputTokens + outputTokens
    && count(u.prompt_cache_hit_tokens) !== undefined && count(u.prompt_cache_miss_tokens) !== undefined
    && !!promptDetails && promptDetails.cached_tokens === u.prompt_cache_hit_tokens
    && Object.keys(u).every(k => ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens',
      'prompt_cache_miss_tokens', 'prompt_tokens_details', 'completion_tokens_details', 'cost'].includes(k))
    && Object.keys(promptDetails).every(k => k === 'cached_tokens')
    && (u.completion_tokens_details === undefined || (!!completionDetails
      && Object.keys(completionDetails).every(k => k === 'reasoning_tokens')));
  return { usage: { inputTokens, outputTokens }, liabilityComplete,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }), ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }) };
}
/** Round explicit reporting UP, including sub-nanodollar decimal reports. */
function reportedNanoUsd(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && isCount(Math.ceil(value * 1_000_000_000))
    ? Math.ceil(value * 1_000_000_000) : undefined;
  if (typeof value !== 'string' || value.length > 80) return undefined;
  const parts = /^(\d+)(?:\.(\d+))?$/.exec(value); if (!parts) return undefined;
  const decimals = parts[2] ?? '';
  const amount = BigInt(parts[1]) * 1_000_000_000n + BigInt(decimals.slice(0, 9).padEnd(9, '0'))
    + (/[1-9]/.test(decimals.slice(9)) ? 1n : 0n);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : undefined;
}
function conservativeCost(a: GatewayTextAuthorization, usage: UsageReading, sawReasoning: boolean): number | undefined {
  if (a.profile.charging !== 'metered' || a.transport.provider !== 'DEEPSEEK' || a.transport.model !== 'deepseek-flash'
    || !usage.liabilityComplete || usage.usage.inputTokens === 0 || usage.usage.outputTokens === 0 || (sawReasoning && usage.reasoningTokens === undefined)
    || !validRates(a.transport, a.profile, Date.now())) return undefined;
  // Completion includes reasoning; never subtract it. All input is priced uncached,
  // even authenticated cache hits, so no discount is mistaken for charge authority.
  const rates = a.transport.rateCard!;
  return maximumCostNanoUsd(usage.usage.inputTokens, usage.usage.outputTokens,
    rates.inputNanoUsdPerMillion, rates.outputNanoUsdPerMillion);
}

function actualCost(a: GatewayTextAuthorization, _usage: UsageReading): number | undefined {
  if (a.profile.charging === 'verified-free-no-overage') return 0;
  // A reviewed maximum tariff is admission authority, NOT the exact billed tariff
  // (time-window discounts, caches and invoice adjustments may differ). Do not mint
  // final money evidence from token counts multiplied by a conservative upper bound.
  // A separately typed complete-usage ceiling may reduce unused reservation, but
  // this actual-charge reader never certifies that upper bound as an invoice.
  return undefined;
}
function remoteError(value: unknown, provider: GatewayTextProvider, status?: number): GatewayTextTransportError {
  const outer = raw(value); const nested = raw(outer?.error);
  const enums = [outer?.code, outer?.type, nested?.code, nested?.type, nested?.status]
    .flatMap(v => typeof v === 'string' ? [v.toLowerCase()] : typeof v === 'number' ? [String(v)] : []);
  const has = (...codes: string[]) => enums.some(v => codes.includes(v));
  let code: GatewayTextErrorCode = 'NETWORK';
  const typedRefusal = [outer, nested].some(envelope => !!envelope?.refusal || (Array.isArray(envelope?.choices) && envelope.choices.some(value => {
    const choice = raw(value); const reason = choice?.finish_reason;
    return !!raw(choice?.message)?.refusal || !!raw(choice?.delta)?.refusal
      || (typeof reason === 'string' && SAFETY_REASONS.has(reason.toLowerCase()));
  })));
  if (typedRefusal || has('content_filter', 'content_policy_violation', 'safety', 'safety_refusal', 'prohibited_content') || (provider === 'GLM' && has('1301'))) code = 'SAFETY_REFUSAL';
  else if (has('insufficient_quota', 'quota_exceeded', 'quota_exhausted', 'billing_hard_limit_reached')
    || (provider === 'GLM' && has('1113', '1308', '1310', '1313')) || (provider === 'DEEPSEEK' && status === 402)) code = 'QUOTA_EXHAUSTED';
  else if (status === 401 || status === 403) code = 'AUTH';
  else if (status === 429 || has('rate_limit_exceeded', 'resource_exhausted') || (provider === 'GLM' && has('1302'))) code = 'RATE_LIMIT';
  else if (status === 404 || has('model_not_found', 'model_not_available')) code = 'MODEL_UNAVAILABLE';
  else if (status === 408 || status === 504) code = 'TIMEOUT';
  else if ((status !== undefined && status >= 500) || (provider === 'GLM' && has('1305'))) code = 'SERVER';
  else if (status !== undefined) code = 'INVALID_REQUEST';
  return new GatewayTextTransportError(code, status);
}
function checkedFinish(value: unknown, refusal: unknown): 'stop' | 'length' | undefined {
  if ((typeof value === 'string' && SAFETY_REASONS.has(value.toLowerCase())) || refusal) fail('SAFETY_REFUSAL');
  if (value === 'stop' || value === 'length') return value;
  if (value === 'tool_calls' || value === 'function_call' || value === 'model_context_window_exceeded') fail('INVALID_REQUEST');
  if (value !== null && value !== undefined) fail('NETWORK');
  return undefined;
}

/** One HTTP POST. Neither redirects nor retries can send credentials elsewhere. */
export async function executeGatewayText(input: GatewayTextInput): Promise<GatewayTextResponse> {
  const started = Date.now();
  let controller: AbortController | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  let abortExternal: (() => void) | undefined; let timedOut = false; let dispatchedClaim: DispatchClaim | undefined;
  try {
    if (!input || typeof input.authorizeClaim !== 'function' || typeof input.markOutputVisible !== 'function' || typeof input.reportCostAnomaly !== 'function' || typeof input.assertDispatchPolicy !== 'function'
      || !input.signal || typeof input.signal.addEventListener !== 'function'
      || (input.onChunk !== undefined && typeof input.onChunk !== 'function')
      || (input.images !== undefined && !Array.isArray(input.images))) fail('INVALID_REQUEST');
    if (input.signal.aborted) fail('ABORTED');
    const a = immutable({ profile: input.profile, transport: input.transport, request: input.request, claim: input.claim });
    const payload = { prompt: input.prompt, systemPrompt: input.systemPrompt, schema: input.schema,
      images: input.images === undefined ? undefined : [...input.images], modelOverride: input.modelOverride, streaming: !!input.onChunk };
    validate(a, payload, Date.now());
    const { transport: t, request } = a;
    controller = new AbortController();
    const signal = controller.signal;
    abortExternal = () => controller!.abort();
    input.signal.addEventListener('abort', abortExternal, { once: true });
    if (input.signal.aborted) controller.abort();
    const timeoutAtMs = Math.min(Date.now() + Math.min(t.timeoutMs, request.attemptTimeoutMs), request.deadlineAtMs);
    timer = setTimeout(() => { timedOut = true; controller!.abort(); }, Math.max(0, timeoutAtMs - Date.now()));
    const assertActive = () => {
      if (Date.now() >= timeoutAtMs) { timedOut = true; controller!.abort(); }
      if (signal.aborted) fail(input.signal.aborted ? 'ABORTED' : 'TIMEOUT');
    };
    const bounded = async <T>(operation: Promise<T>): Promise<T> => {
      // The promise already exists. Observe it even if an expired/aborted scope
      // makes assertActive throw before Promise.race can attach its handlers.
      void operation.catch(() => {});
      assertActive();
      let onAbort: (() => void) | undefined;
      try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
          onAbort = () => reject(new GatewayTextTransportError(input.signal.aborted ? 'ABORTED' : 'TIMEOUT'));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        })]);
      } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
    };
    const messages = [...(payload.systemPrompt ? [{ role: 'system', content: payload.systemPrompt }] : []), { role: 'user', content: payload.prompt }];
    const body = JSON.stringify({ model: t.model, messages, stream: payload.streaming,
      ...(t.provider === 'GROQ' ? { max_completion_tokens: request.capability.kind === 'text' ? request.capability.outputTokens : 0 }
        : { max_tokens: request.capability.kind === 'text' ? request.capability.outputTokens : 0 }),
      ...(['GLM', 'DEEPSEEK'].includes(t.provider) ? { thinking: { type: 'disabled' } } : {}),
      ...(t.provider === 'GEMINI' ? { reasoning_effort: 'none' } : {}),
      ...(payload.streaming && t.streamUsage ? { stream_options: { include_usage: true } } : {}) });
    // This callback is an exclusive durable dispatch gate, not a JSON boolean from ingress.
    if (await bounded(input.authorizeClaim(a)) !== true) fail('POLICY_BLOCKED');
    assertActive(); validate(a, payload, Date.now());
    const key = process.env[t.credentialEnv];
    if (typeof key !== 'string' || !key || key.length > 4096 || /[\s,]/.test(key)) fail('CONFIGURATION');
    if (gatewayTextCredentialBinding(key) !== t.credentialBinding) fail('POLICY_BLOCKED');
    input.assertDispatchPolicy();
    dispatchedClaim = a.claim;
    const response = await bounded(globalThis.fetch(`${t.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal, body,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: payload.streaming ? 'text/event-stream' : 'application/json' },
    }));
    assertActive();
    const responseError = async (body: unknown): Promise<GatewayTextTransportError> => {
      const envelope = raw(body);
      const extension = raw(envelope?.x_groq);
      const sources = [envelope, raw(envelope?.error), extension, raw(extension?.error)];
      for (const source of sources) await rememberUsage(source?.usage);
      const error = remoteError(body, t.provider, response.status);
      const receivedAtMs = Date.now();
      const cooldownUntilMs = gatewayRetryAfterUntil(response.headers.get('retry-after'), receivedAtMs);
      if (response.status === 429 && error.code === 'RATE_LIMIT' && cooldownUntilMs === null) health.set(error, { claim: evidenceBinding(a.claim),
        proof: immutable({ binding: a.claim.binding, kind: 'cooldown-unavailable', receivedAtMs }) });
      // A contradictory generated-content/usage envelope is not proof of rejected generation.
      if (response.status === 429 && error.code === 'RATE_LIMIT' && cooldownUntilMs !== null
        && sources.every(source => source?.choices === undefined && source?.usage === undefined)) rejected.set(error, { claim: evidenceBinding(a.claim), proof: immutable({
        binding: a.claim.binding, kind: 'http-rejected', status: 429, generationRejected: true, outputVisible: false, receivedAtMs,
        ...(cooldownUntilMs === undefined ? {} : { cooldownUntilMs }),
      }) });
      return error;
    };
    if (!response.body) throw remoteError(undefined, t.provider, response.status);
    const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0; let content = ''; let usage: UsageReading | undefined;
    let finishReason: 'stop' | 'length' | undefined; let outputVisible = false; let committed = false;
    let sawReasoning = false; let paidUsageSeen: unknown; let paidUsageAmbiguous = false; let maximumReportedCost = 0;
    const nextText = async (): Promise<string | undefined> => {
      assertActive(); const part = await bounded(reader.read()); assertActive();
      if (part.done) { const tail = decoder.decode(); return tail || undefined; }
      bytes += part.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) fail('NETWORK');
      return decoder.decode(part.value, { stream: true });
    };
    const costAnomaly = async (kind: GatewayTextCostAnomaly['kind']): Promise<never> => {
      const error = new GatewayTextTransportError('POLICY_BLOCKED');
      anomalies.set(error, { claim: evidenceBinding(a.claim), proof: immutable({ binding: a.claim.binding, kind, receivedAtMs: Date.now() }) });
      try { await bounded(input.reportCostAnomaly(error)); } catch { /* Preserve proof for runtime journal retry. */ }
      throw error;
    };
    const rememberUsage = async (v: unknown, exactModel = false): Promise<boolean> => {
      if (v === undefined || v === null) return false;
      const reportedCost = raw(v)?.cost;
      const nano = reportedCost === undefined ? undefined : reportedNanoUsd(reportedCost);
      if (a.profile.charging === 'verified-free-no-overage' && reportedCost !== undefined && nano !== 0) {
        return costAnomaly('free-cost-contradiction');
      }
      usage = readUsage(v);
      if (a.profile.charging === 'metered') {
        if (reportedCost !== undefined && (nano === undefined || nano > (a.claim.binding.budget?.amountNanoUsd ?? 0))) {
          return costAnomaly('paid-liability-contradiction');
        }
        maximumReportedCost = Math.max(maximumReportedCost, nano ?? 0);
        if (paidUsageSeen !== undefined && !equal(paidUsageSeen, v)) paidUsageAmbiguous = true;
        paidUsageSeen = v;
        if (usage) {
          usage.liabilityComplete &&= exactModel && !paidUsageAmbiguous;
          const capability = a.request.capability;
          if (capability.kind !== 'text' || usage.usage.inputTokens > capability.inputTokens || usage.usage.outputTokens > capability.outputTokens) {
            return costAnomaly('paid-liability-contradiction');
          }
          const ceiling = conservativeCost(a, usage, sawReasoning);
          if (ceiling !== undefined && maximumReportedCost > ceiling) return costAnomaly('paid-liability-contradiction');
        }
      }
      return !!usage;
    };
    const processPacket = async (packet: unknown, stream: boolean) => {
      const obj = raw(packet); if (!obj) fail('NETWORK');
      const extension = raw(obj.x_groq);
      // Billing contradiction survives every coexisting response-error/model marker.
      const hasUsage = await rememberUsage(obj.usage, obj.model === t.model); const hasExtensionUsage = await rememberUsage(extension?.usage, obj.model === t.model);
      await rememberUsage(raw(obj.error)?.usage); await rememberUsage(raw(extension?.error)?.usage);
      if (obj.error) throw remoteError(obj, t.provider);
      if (obj.model !== undefined && obj.model !== t.model) fail('POLICY_BLOCKED');
      if (extension?.error) throw remoteError(extension, t.provider);
      if (!Array.isArray(obj.choices) || obj.choices.length > 1) fail('NETWORK');
      const choice = raw(obj.choices[0]); if (!choice) { if (!stream || !usage) fail('NETWORK'); return; }
      if (choice.index !== undefined && choice.index !== 0) fail('NETWORK');
      const message = raw(stream ? choice.delta : choice.message); if (!message) fail('NETWORK');
      const reason = checkedFinish(choice.finish_reason, message.refusal);
      if (message.reasoning_content !== undefined && message.reasoning_content !== null) {
        if (typeof message.reasoning_content !== 'string') fail('NETWORK');
        if (message.reasoning_content) sawReasoning = true;
      }
      if (message.tool_calls !== undefined || message.function_call !== undefined) fail('INVALID_REQUEST');
      if (message.content !== undefined && message.content !== null && typeof message.content !== 'string') fail('NETWORK');
      const text = typeof message.content === 'string' ? message.content : '';
      if (finishReason && (text || (reason && reason !== finishReason))) fail('NETWORK');
      finishReason = reason ?? finishReason;
      if (text) {
        if (!hasUsage && !hasExtensionUsage) usage = undefined;
        content += text;
        if (stream && (committed || text.trim())) {
          if (!outputVisible) { await bounded(input.markOutputVisible()); outputVisible = true; }
          assertActive(); await bounded(Promise.resolve(input.onChunk!(committed ? text : content))); committed = true;
        }
      }
    };
    try {
      if (!response.ok || !payload.streaming) {
        let text = ''; for (;;) { const piece = await nextText(); if (piece === undefined) break; text += piece; }
        let json: unknown; try { json = JSON.parse(text); } catch { throw remoteError(undefined, t.provider, response.ok ? undefined : response.status); }
        if (!response.ok) throw await responseError(json);
        await processPacket(json, false);
      } else {
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) fail('NETWORK');
        let buffer = ''; let data: string[] = []; let done = false;
        const event = async () => {
          if (!data.length) return;
          const text = data.join('\n'); data = [];
          if (text === '[DONE]') { done = true; return; }
          if (done) fail('NETWORK');
          let json: unknown; try { json = JSON.parse(text); } catch { fail('NETWORK'); }
          await processPacket(json, true);
        };
        streamLoop: for (;;) {
          const piece = await nextText(); if (piece === undefined) break;
          buffer += piece; if (buffer.length > MAX_FRAME_BYTES) fail('NETWORK');
          let newline: number;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
            if (!line) { await event(); if (done) break streamLoop; }
            else if (line.startsWith('data:')) { data.push(line.slice(5).replace(/^ /, '')); if (data.join('\n').length > MAX_FRAME_BYTES) fail('NETWORK'); }
          }
        }
        // A truncated final frame is not a final provider/accounting record.
        if (data.length || !done) fail('NETWORK');
      }
      assertActive();
      if (!content.trim()) fail('EMPTY_RESPONSE');
      if (!finishReason) fail('NETWORK');
      const ceiling = usage ? conservativeCost(a, usage, sawReasoning) : undefined;
      if (ceiling !== undefined && maximumReportedCost > ceiling) await costAnomaly('paid-liability-contradiction');
      if (!outputVisible) { await bounded(input.markOutputVisible()); outputVisible = true; assertActive(); }
      const result: GatewayTextResponse = Object.freeze({ content, latencyMs: Date.now() - started,
        provider: t.provider, model: t.model, completeUsage: !!usage, finishReason, outputVisible,
        ...(usage ? { usage: Object.freeze(usage.usage), ...(usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: usage.cachedInputTokens }) } : {}) });
      if (usage) {
        const cost = actualCost(a, usage);
        if (cost !== undefined) measured.set(result, { claim: evidenceBinding(a.claim), usage: immutable({
          binding: a.claim.binding, final: true, outcome: { kind: 'completed' }, outputVisible,
          ...usage.usage, ...(usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: usage.cachedInputTokens }), actualNanoUsd: cost,
          ...(t.rateCard ? { rateCardVersion: t.rateCard.version } : {}),
        }) });
      }
      if (usage && ceiling !== undefined) ceilings.set(result, { claim: evidenceBinding(a.claim), usage: immutable({
        binding: a.claim.binding, final: true, outcome: { kind: 'completed' }, outputVisible, ...usage.usage,
        ...(usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: usage.cachedInputTokens }),
        chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: ceiling, rateCardVersion: t.rateCard!.version,
      }) });
      return result;
    } finally {
      // Cancellation is cleanup, not a second generation deadline. Observe every
      // rejection immediately without delaying a validated [DONE]/terminal result.
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Synchronous cleanup failure is observed too. */ }
      try { reader.releaseLock(); } catch { /* A cancelled pending read may still own the lock. */ }
    }
  } catch (error) {
    const sanitized = input?.signal?.aborted ? new GatewayTextTransportError(isInferenceExecutorTimeout(input.signal.reason) ? 'TIMEOUT' : 'ABORTED')
      : timedOut ? new GatewayTextTransportError('TIMEOUT')
      : error instanceof GatewayTextTransportError ? error : new GatewayTextTransportError('NETWORK');
    // Cleanup cancellation changes the caller-visible error, not an already
    // authenticated billing contradiction or the durable quarantine obligation.
    const anomaly = error && typeof error === 'object' ? anomalies.get(error) : undefined;
    if (anomaly) anomalies.set(sanitized, anomaly);
    const observedHealth = error && typeof error === 'object' ? health.get(error) : undefined;
    if (observedHealth && !anomaly) health.set(sanitized, observedHealth);
    if (dispatchedClaim && !anomaly && ['AUTH', 'SERVER', 'NETWORK', 'TIMEOUT'].includes(sanitized.code)) {
      health.set(sanitized, { claim: evidenceBinding(dispatchedClaim), proof: immutable({ binding: dispatchedClaim.binding,
        kind: sanitized.code === 'AUTH' ? 'auth' : 'transient', receivedAtMs: Date.now() }) });
    }
    throw sanitized;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortExternal) input.signal.removeEventListener('abort', abortExternal);
    controller?.abort();
  }
}
