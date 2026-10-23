/** Single-attempt Vertex embedding transport. The caller owns durable admission and settlement.
 * Official contract: https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/text-embeddings-api
 * Character pricing is distinct from tokens. Neither a vector nor token_count proves invoice cost.
 */
import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { supportsCapability } from './capabilities';
import { evidenceBinding, profileRejection, withoutEvidence } from './profiles';
import type { DispatchBinding, DispatchClaim } from './executor';
import { isInferenceExecutorTimeout } from './executor';
import type { GatewayTransportHealth } from './textTransport';
import { gatewayRetryAfterUntil } from './retryAfter';
import type { ProviderProfile, RoutingRequest } from './types';

export const VERTEX_EMBEDDING_MODEL = 'text-embedding-004';
export const VERTEX_EMBEDDING_DIMENSIONS = 768;
export const VERTEX_EMBEDDING_VECTOR_SPACE = 'vertex:text-embedding-004:default-task:trim-v1:768';
export interface GatewayEmbeddingConfig {
  readonly kind: 'embedding'; readonly provider: 'VERTEX'; readonly model: typeof VERTEX_EMBEDDING_MODEL;
  readonly project: string; readonly location: string; readonly credentialPrincipal: string;
  readonly vectorSpaceId: typeof VERTEX_EMBEDDING_VECTOR_SPACE;
  readonly maxInputBytes: number; readonly timeoutMs: number;
  readonly rateCard: { readonly version: string; readonly maxNanoUsdPerCharacter: number;
    readonly verifiedAtMs: number; readonly expiresAtMs: number };
}
export function gatewayEmbeddingCredentialBinding(value: { project: string; credentialPrincipal: string }): string {
  return createHash('sha256').update('navbharatai-gateway-vertex-embedding-account-v1\0').update(evidenceBinding({ project: value.project, credentialPrincipal: value.credentialPrincipal })).digest('hex');
}
export interface GatewayEmbeddingAuthorization {
  readonly profile: ProviderProfile; readonly request: RoutingRequest;
  readonly claim: DispatchClaim; readonly transport: GatewayEmbeddingConfig;
}
export interface GatewayEmbeddingInput extends GatewayEmbeddingAuthorization {
  readonly text: string; readonly signal: AbortSignal;
  readonly authorizeClaim: (authorization: GatewayEmbeddingAuthorization) => Promise<boolean>;
  readonly assertDispatchPolicy: () => void;
  readonly reportCostAnomaly: (error: GatewayEmbeddingError) => Promise<void>;
}
export interface GatewayEmbeddingResult {
  readonly provider: 'VERTEX'; readonly dimensions: 768;
  readonly values: readonly number[]; readonly model: typeof VERTEX_EMBEDDING_MODEL;
  readonly vectorSpaceId: typeof VERTEX_EMBEDDING_VECTOR_SPACE;
  readonly inputTokens?: number;
}
export interface GatewayEmbeddingUsage {
  readonly binding: DispatchBinding; readonly final: true;
  readonly outcome: { readonly kind: 'completed' }; readonly outputVisible: false;
  readonly inputTokens: number; readonly submittedBytes: number;
  readonly chargeBasis: 'conservative-ceiling'; readonly conservativeCeilingNanoUsd: number;
  readonly rateCardVersion: string;
}
export class GatewayEmbeddingError extends Error {
  constructor(readonly code: 'CONFIGURATION' | 'POLICY_BLOCKED' | 'AUTH' | 'ABORTED' | 'TIMEOUT' | 'PROVIDER' | 'INVALID_RESPONSE') {
    super(`Embedding unavailable (${code}).`); this.name = 'GatewayEmbeddingError';
  }
}
function fail(code: GatewayEmbeddingError['code']): never { throw new GatewayEmbeddingError(code); }
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const same = (a: unknown, b: unknown) => evidenceBinding(a) === evidenceBinding(b);
export interface GatewayEmbeddingCostAnomaly { readonly binding: DispatchBinding; readonly kind: 'paid-liability-contradiction'; readonly receivedAtMs: number; }
const anomalies = new WeakMap<object, { claim: string; proof: GatewayEmbeddingCostAnomaly }>();
export function readGatewayEmbeddingCostAnomaly(error: unknown, claim: DispatchClaim): GatewayEmbeddingCostAnomaly | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = anomalies.get(error); return value?.claim === evidenceBinding(claim) ? value.proof : undefined;
}
const health = new WeakMap<object, { claim: string; proof: GatewayTransportHealth }>();
export function readGatewayEmbeddingHealth(error: unknown, claim: DispatchClaim): GatewayTransportHealth | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try { const entry = health.get(error); return entry?.claim === evidenceBinding(claim) ? entry.proof : undefined; } catch { return undefined; }
}
const proofs = new WeakMap<object, { claim: string; usage: GatewayEmbeddingUsage }>();
export function readGatewayEmbeddingUsage(result: unknown, claim: DispatchClaim): GatewayEmbeddingUsage | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const proof = proofs.get(result); return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined;
}
export function gatewayEmbeddingPayloadDigest(text: string): string {
  return createHash('sha256').update(evidenceBinding({ text, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE })).digest('hex');
}
/** UTF-8 bytes upper-bound Unicode character units without assuming provider tokenization. */
export function gatewayEmbeddingMaximumNanoUsd(text: string, rate: number): number {
  if (!count(rate) || rate < 25) fail('CONFIGURATION');
  const amount = Buffer.byteLength(text, 'utf8') * rate;
  if (!count(amount)) fail('CONFIGURATION'); return amount;
}
function validate(input: GatewayEmbeddingInput): void {
  const { transport: t, profile: p, request: r, claim: c } = input; const now = Date.now();
  if (t.kind !== 'embedding' || t.provider !== 'VERTEX' || t.model !== VERTEX_EMBEDDING_MODEL || t.vectorSpaceId !== VERTEX_EMBEDDING_VECTOR_SPACE
    || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(t.project) || !/^[a-z]+-[a-z]+\d$/.test(t.location)
    || !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(t.credentialPrincipal)
    || !count(t.maxInputBytes) || t.maxInputBytes < 1 || t.maxInputBytes > 65536
    || !count(t.timeoutMs) || t.timeoutMs < 1 || t.timeoutMs > 30000
    || !t.rateCard || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(t.rateCard.version)
    || !count(t.rateCard.verifiedAtMs) || !count(t.rateCard.expiresAtMs)
    || t.rateCard.verifiedAtMs > now || t.rateCard.expiresAtMs <= now) fail('CONFIGURATION');
  const capability = r.capability; const b = c.binding;
  if (typeof input.text !== 'string' || !input.text.trim() || input.text !== input.text.trim()
    || Buffer.byteLength(input.text, 'utf8') > t.maxInputBytes || capability.kind !== 'embedding'
    || capability.dimensions !== 768 || capability.vectorSpaceId !== t.vectorSpaceId
    || capability.inputTokens !== 2048 || p.providerId !== 'VERTEX' || p.modelId !== t.model
    || p.adapterId !== 'gateway-vertex-embedding-v1' || p.charging !== 'metered' || r.mode === 'strict-free' || !['chat', 'professional'].includes(r.surface)
    || profileRejection(p, r) || !p.capabilities.some(support => supportsCapability(capability, support))
    || !p.quotaDimensions.some(d => d.scope.kind === 'project' && d.scope.providerId === 'VERTEX' && d.scope.id === t.project)
    || !p.privacy.processingRegions.includes(t.location) || r.outputVisible || r.cancellation.cancelled || !count(r.deadlineAtMs) || now >= r.deadlineAtMs
    || !count(r.attemptTimeoutMs) || r.attemptTimeoutMs < 1
    || c.intentBinding !== evidenceBinding(b) || b.profileBinding !== evidenceBinding(withoutEvidence(p))
    || b.requestBinding !== evidenceBinding(withoutEvidence(r)) || !same(b.payer, r.payer)
    || b.profileId !== p.id || b.profileVersion !== p.version || b.providerId !== p.providerId
    || b.modelId !== p.modelId || b.modelRevision !== p.modelRevision || b.adapterId !== p.adapterId
    || b.physicalAttemptId !== r.nextPhysicalAttemptId || b.key.logicalRequestId !== r.logicalRequestId
    || b.key.principalId !== r.principalId || b.key.tenantId !== r.tenantId
    || b.budgetScopeId !== r.budgetScopeId || b.key.payloadDigest !== r.payloadDigest
    || r.payloadDigest !== gatewayEmbeddingPayloadDigest(input.text)
    || !b.budget || b.budget.budgetScopeId !== r.budgetScopeId || b.budget.rateCardVersion !== t.rateCard.version
    || b.budget.amountNanoUsd < gatewayEmbeddingMaximumNanoUsd(input.text, t.rateCard.maxNanoUsdPerCharacter)) fail('POLICY_BLOCKED');
}
async function adc(): Promise<{ token: string; principal: string; project: string }> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const credentials = await auth.getCredentials(); const token = await auth.getAccessToken(); const project = await auth.getProjectId();
  if (!token || !credentials.client_email) fail('AUTH');
  return { token, principal: credentials.client_email, project };
}
/** Ports are server-owned dependencies, never request body/configuration. */
export async function executeGatewayEmbedding(input: GatewayEmbeddingInput,
  ports: { accessToken?: typeof adc; fetch?: typeof fetch } = {}): Promise<GatewayEmbeddingResult> {
  validate(input);
  if (input.signal.aborted) fail('ABORTED');
  const snapshot = <T>(value: T): T => {
    const result = JSON.parse(evidenceBinding(value)) as T;
    const freeze = (v: unknown): void => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
    freeze(result); return result;
  };
  input = { ...input, transport: snapshot(input.transport), profile: snapshot(input.profile), request: snapshot(input.request), claim: snapshot(input.claim) };
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const end = Math.min(input.request.deadlineAtMs, Date.now() + Math.min(input.transport.timeoutMs, input.request.attemptTimeoutMs));
  let timedOut = false; let physical = false; let healthKind: GatewayTransportHealth['kind'] | undefined; let cooldownUntilMs: number | undefined; let healthReceivedAtMs: number | undefined;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(0, end - Date.now()));
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    // Observe before checking cancellation, including rejected cleanup/auth promises.
    void promise.catch(() => {});
    if (signal.aborted) fail(timedOut || isInferenceExecutorTimeout(input.signal.reason) ? 'TIMEOUT' : 'ABORTED');
    let abort!: () => void;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(new GatewayEmbeddingError(timedOut || isInferenceExecutorTimeout(input.signal.reason) ? 'TIMEOUT' : 'ABORTED'));
      signal.addEventListener('abort', abort, { once: true });
    })]); } finally { signal.removeEventListener('abort', abort); }
  };
  try {
    const credentials = await bounded((ports.accessToken ?? adc)());
    if (credentials.project !== input.transport.project || credentials.principal !== input.transport.credentialPrincipal || typeof credentials.token !== 'string'
      || !credentials.token || /[\r\n]/.test(credentials.token)) fail('AUTH');
    if (!await bounded(input.authorizeClaim(input))) fail('POLICY_BLOCKED');
    validate(input); input.assertDispatchPolicy();
    if (signal.aborted || Date.now() >= end) fail(timedOut || isInferenceExecutorTimeout(input.signal.reason) ? 'TIMEOUT' : 'ABORTED');
    const t = input.transport;
    physical = true;
    const response = await bounded((ports.fetch ?? fetch)(`https://${t.location}-aiplatform.googleapis.com/v1/projects/${t.project}/locations/${t.location}/publishers/google/models/${t.model}:predict`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ content: input.text }], parameters: { autoTruncate: false, outputDimensionality: 768 } }),
    }));
    if (!response.ok) {
      healthReceivedAtMs = Date.now();
      if ([401, 403].includes(response.status)) healthKind = 'auth';
      else if (response.status >= 500) healthKind = 'transient';
      else if (response.status === 429) {
        const until = gatewayRetryAfterUntil(response.headers.get('retry-after'), healthReceivedAtMs);
        healthKind = until === null ? 'cooldown-unavailable' : 'transient'; cooldownUntilMs = until ?? undefined;
      }
      void response.body?.cancel().catch(() => {}); fail('PROVIDER');
    }
    const reader = response.body?.getReader(); if (!reader) fail('INVALID_RESPONSE');
    let raw = ''; let bytes = 0; const decoder = new TextDecoder();
    try { while (true) { const chunk = await bounded(reader.read()); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 262144) fail('INVALID_RESPONSE'); raw += decoder.decode(chunk.value, { stream: true });
    } raw += decoder.decode(); } finally { void reader.cancel().catch(() => {}); }
    const body = JSON.parse(raw) as { metadata?: { billable_character_count?: unknown }; predictions?: { embeddings?: { values?: unknown; statistics?: { token_count?: unknown; truncated?: unknown } } }[] };
    const billedCharacters = body.metadata?.billable_character_count;
    if (billedCharacters !== undefined && (!count(billedCharacters) || billedCharacters > Buffer.byteLength(input.text, 'utf8'))) {
      const error = new GatewayEmbeddingError('INVALID_RESPONSE');
      anomalies.set(error, { claim: evidenceBinding(input.claim), proof: Object.freeze({ binding: input.claim.binding, kind: 'paid-liability-contradiction', receivedAtMs: Date.now() }) });
      // Preserve the authenticated contradiction even when cancellation interrupts persistence.
      try { await bounded(input.reportCostAnomaly(error)); } catch { /* Caller can retry durable quarantine using this proof. */ }
      throw error;
    }
    if (!Array.isArray(body.predictions) || body.predictions.length !== 1) fail('INVALID_RESPONSE');
    const embedding = body.predictions[0].embeddings; const values = embedding?.values;
    if (!Array.isArray(values) || values.length !== 768 || !values.every(v => typeof v === 'number' && Number.isFinite(v))
      || embedding?.statistics?.truncated !== false) fail('INVALID_RESPONSE');
    const tokens = embedding.statistics.token_count;
    const result: GatewayEmbeddingResult = Object.freeze({ provider: 'VERTEX', dimensions: 768, values: Object.freeze([...values]), model: VERTEX_EMBEDDING_MODEL,
      vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE, ...(count(tokens) && tokens > 0 && tokens <= 2048 ? { inputTokens: tokens } : {}) });
    // A valid vector alone is insufficient for money settlement. Missing statistics keeps the hold.
    if (result.inputTokens !== undefined && Date.now() < t.rateCard.expiresAtMs) {
      proofs.set(result, { claim: evidenceBinding(input.claim), usage: Object.freeze({ binding: input.claim.binding,
        final: true, outcome: { kind: 'completed' as const }, outputVisible: false, inputTokens: result.inputTokens,
        submittedBytes: Buffer.byteLength(input.text, 'utf8'), chargeBasis: 'conservative-ceiling',
        conservativeCeilingNanoUsd: gatewayEmbeddingMaximumNanoUsd(input.text, t.rateCard.maxNanoUsdPerCharacter), rateCardVersion: t.rateCard.version }) });
    }
    return result;
  } catch (error) {
    const failure = error instanceof GatewayEmbeddingError ? error : new GatewayEmbeddingError(signal.aborted
      ? timedOut || isInferenceExecutorTimeout(input.signal.reason) ? 'TIMEOUT' : 'ABORTED' : 'PROVIDER');
    if (physical && (!input.signal.aborted || isInferenceExecutorTimeout(input.signal.reason)) && !readGatewayEmbeddingCostAnomaly(error, input.claim)
      && (healthKind || failure.code === 'TIMEOUT' || !(error instanceof GatewayEmbeddingError))) {
      health.set(failure, { claim: evidenceBinding(input.claim), proof: Object.freeze({ binding: input.claim.binding,
        kind: healthKind ?? 'transient', receivedAtMs: healthReceivedAtMs ?? Date.now(), ...(cooldownUntilMs === undefined ? {} : { cooldownUntilMs }) }) });
    }
    throw failure;
  } finally { clearTimeout(timer); controller.abort(); }
}
