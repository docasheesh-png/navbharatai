/** Server-only Brave Search transport. Each physical request needs the shared gateway hold.
 * Official pricing: https://api-dashboard.search.brave.com/documentation/pricing
 * Monthly credit is NOT assumed. This adapter books a liability ceiling, never invoice spend. */
import { createHash } from 'node:crypto';
import { gatewayRetryAfterUntil } from './retryAfter';
import { isInferenceExecutorTimeout, type DispatchClaim, type DispatchBinding } from './executor';
import type { ProviderProfile, RoutingRequest } from './types';
import { evidenceBinding, profileRejection, withoutEvidence } from './profiles';
import { isIdentifier, isPositiveCount, supportsCapability } from './capabilities';
import { gatewayTextCredentialBinding, GatewayTextTransportError, type GatewayTransportHealth } from './textTransport';

export interface GatewayGroundingConfig {
  readonly kind: 'grounding-search'; readonly provider: 'BRAVE'; readonly model: 'brave-search-v1';
  readonly baseURL: 'https://api.search.brave.com/res/v1/web/search';
  readonly credentialEnv: string; readonly credentialBinding: string;
  readonly timeoutMs: number; readonly maxQueryBytes: number; readonly maxResults: number;
  readonly rateCard: { readonly version: string; readonly requestNanoUsd: number; readonly verifiedAtMs: number; readonly expiresAtMs: number };
}
export interface GatewayGroundingPayload {
  readonly kind: 'grounding-search'; readonly query: string; readonly maxResults: number; readonly domains?: readonly string[];
}
export interface GatewayGroundingAuthorization {
  readonly profile: ProviderProfile; readonly transport: GatewayGroundingConfig;
  readonly claim: DispatchClaim; readonly request: RoutingRequest;
}
export interface GatewayGroundingInput extends GatewayGroundingAuthorization, GatewayGroundingPayload {
  readonly signal: AbortSignal;
  readonly authorizeClaim: (authorization: GatewayGroundingAuthorization) => Promise<boolean>;
  readonly assertDispatchPolicy: () => void;
}
export interface GatewayGroundingResult {
  readonly provider: 'BRAVE'; readonly model: 'brave-search-v1';
  readonly results: readonly { readonly title: string; readonly url: string; readonly description: string }[];
}
export interface GatewayGroundingUsage {
  readonly binding: DispatchBinding; readonly final: true; readonly outcome: { readonly kind: 'completed' };
  readonly outputVisible: false; readonly requests: 1; readonly chargeBasis: 'conservative-ceiling';
  readonly conservativeCeilingNanoUsd: number; readonly rateCardVersion: string;
}
const proofs = new WeakMap<object, { claim: string; usage: GatewayGroundingUsage }>();
export function gatewayGroundingPayloadDigest(p: GatewayGroundingPayload): string {
  return createHash('sha256').update(evidenceBinding({ kind: p.kind, query: p.query, maxResults: p.maxResults, domains: p.domains ?? null })).digest('hex');
}
export function readGatewayGroundingUsage(result: unknown, claim: DispatchClaim): GatewayGroundingUsage | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const proof = proofs.get(result); return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined;
}
function fail(code: ConstructorParameters<typeof GatewayTextTransportError>[0]): never { throw new GatewayTextTransportError(code); }
function valid(a: GatewayGroundingInput): void {
  const { transport: t, profile: p, claim: c, request: r } = a; const now = Date.now();
  if (a.kind !== 'grounding-search' || !t || t.kind !== a.kind || t.provider !== 'BRAVE' || t.model !== 'brave-search-v1'
    || t.baseURL !== 'https://api.search.brave.com/res/v1/web/search' || !/^INFERENCE_GATEWAY_[A-Z0-9_]{1,80}$/.test(t.credentialEnv)
    || !isPositiveCount(t.timeoutMs) || t.timeoutMs > 30000 || !isPositiveCount(t.maxQueryBytes) || t.maxQueryBytes > 4000
    || !isPositiveCount(t.maxResults) || t.maxResults > 20 || typeof a.query !== 'string' || !a.query.trim()
    || Buffer.byteLength(a.query, 'utf8') > t.maxQueryBytes || !isPositiveCount(a.maxResults) || a.maxResults > t.maxResults
    || a.domains !== undefined) fail('INVALID_REQUEST');
  const rate = t.rateCard;
  if (!rate || !isIdentifier(rate.version) || !isPositiveCount(rate.requestNanoUsd) || rate.requestNanoUsd < 5000000
    || !Number.isSafeInteger(rate.verifiedAtMs) || !Number.isSafeInteger(rate.expiresAtMs)
    || rate.verifiedAtMs > now || now >= rate.expiresAtMs || rate.expiresAtMs - rate.verifiedAtMs > 86400000) fail('CONFIGURATION');
  if (!r || !p || !c?.binding || profileRejection(p, r) || r.capability.kind !== 'grounding-search'
    || r.capability.queries !== 1 || r.capability.domainFiltering || !r.capability.citations || r.capability.maxResults !== a.maxResults
    || p.providerId !== t.provider || p.modelId !== t.model || p.adapterId !== 'gateway-brave-search-v1'
    || !p.capabilities.some(support => supportsCapability(r.capability, support))
    || p.charging !== 'metered' || r.mode === 'strict-free' || !['chat', 'professional'].includes(r.surface)
    || r.cancellation.cancelled || r.outputVisible || now >= r.deadlineAtMs || a.signal.aborted) fail('POLICY_BLOCKED');
  const b = c.binding;
  if (c.intentBinding !== evidenceBinding(b) || !isIdentifier(c.claimId) || b.profileId !== p.id || b.profileVersion !== p.version
    || b.providerId !== p.providerId || b.modelId !== p.modelId || b.modelRevision !== p.modelRevision || b.adapterId !== p.adapterId
    || b.profileBinding !== evidenceBinding(withoutEvidence(p)) || b.requestBinding !== evidenceBinding(withoutEvidence(r))
    || b.key.payloadDigest !== gatewayGroundingPayloadDigest(a) || b.key.payloadDigest !== r.payloadDigest
    || b.key.logicalRequestId !== r.logicalRequestId || b.key.principalId !== r.principalId || b.key.tenantId !== r.tenantId
    || b.physicalAttemptId !== r.nextPhysicalAttemptId || b.budgetScopeId !== r.budgetScopeId
    || evidenceBinding(b.payer) !== evidenceBinding(r.payer) || !b.budget || b.budget.amountNanoUsd < rate.requestNanoUsd
    || b.budget.rateCardVersion !== rate.version || b.budget.budgetScopeId !== r.budgetScopeId || evidenceBinding(b.budget.payer) !== evidenceBinding(r.payer)) fail('POLICY_BLOCKED');
}
function credential(t: GatewayGroundingConfig): string {
  const value = process.env[t.credentialEnv]?.trim();
  if (!value || value.includes(',') || gatewayTextCredentialBinding(value) !== t.credentialBinding) fail('CONFIGURATION');
  return value;
}
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  void promise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new GatewayTextTransportError('ABORTED')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
const health = new WeakMap<object, { claim: string; proof: GatewayTransportHealth }>();
export function readGatewayGroundingHealth(error: unknown, claim: DispatchClaim): GatewayTransportHealth | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try { const entry = health.get(error); return entry?.claim === evidenceBinding(claim) ? entry.proof : undefined; } catch { return undefined; }
}
export async function executeGatewayGrounding(original: GatewayGroundingInput): Promise<GatewayGroundingResult> {
  // Snapshot reviewed data before any asynchronous dependency can mutate the caller's objects.
  const snapshot = JSON.parse(evidenceBinding({ profile: original.profile, transport: original.transport, claim: original.claim,
    request: original.request, kind: original.kind, query: original.query, maxResults: original.maxResults, ...(original.domains === undefined ? {} : { domains: original.domains }) }));
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(snapshot);
  const input: GatewayGroundingInput = Object.freeze({ ...original, ...snapshot });
  valid(input); const key = credential(input.transport);
  const controller = new AbortController(); const abort = () => controller.abort();
  input.signal.addEventListener('abort', abort, { once: true }); if (input.signal.aborted) abort();
  const timer = setTimeout(abort, Math.min(input.transport.timeoutMs, input.request.attemptTimeoutMs, input.request.deadlineAtMs - Date.now()));
  let physical = false; let healthKind: GatewayTransportHealth['kind'] | undefined; let cooldownUntilMs: number | undefined; let healthReceivedAtMs: number | undefined;
  try {
    if (await bounded(input.authorizeClaim(input), controller.signal) !== true) fail('POLICY_BLOCKED');
    valid(input); if (credential(input.transport) !== key || controller.signal.aborted) fail('ABORTED');
    input.assertDispatchPolicy();
    const url = new URL(input.transport.baseURL); url.searchParams.set('q', input.query); url.searchParams.set('count', String(input.maxResults));
    physical = true;
    const response = await bounded(fetch(url, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', 'X-Subscription-Token': key } }), controller.signal);
    if ([401,403].includes(response.status)) healthKind = 'auth'; else if (response.status >= 500) healthKind = 'transient';
    if (response.status === 429) {
      healthReceivedAtMs = Date.now();
      const until = gatewayRetryAfterUntil(response.headers.get('retry-after'), healthReceivedAtMs);
      healthKind = until === null ? 'cooldown-unavailable' : 'transient';
      if (typeof until === 'number') cooldownUntilMs = until;
    }
    if (!response.ok) { try { void response.body?.cancel().catch(() => {}); } catch { /* cleanup only */ } }
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'SERVER');
    if (!response.body) fail('EMPTY_RESPONSE');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const part = await bounded(reader.read(), controller.signal); if (part.done) break; size += part.value.byteLength; if (size > 1000000) fail('INVALID_REQUEST'); chunks.push(part.value); }
    } finally { void reader.cancel().catch(() => {}); }
    if (controller.signal.aborted) fail('ABORTED');
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { type?: string; web?: { results?: unknown[] }; error?: unknown };
    if (!body || body.error || !Array.isArray(body.web?.results) || body.web.results.length > 20) fail('INVALID_REQUEST');
    const results = body.web.results.slice(0, input.maxResults).map(row => {
      if (!row || typeof row !== 'object') fail('INVALID_REQUEST');
      const r = row as Record<string, unknown>;
      if (typeof r.title !== 'string' || r.title.length > 2000 || typeof r.url !== 'string' || r.url.length > 8192
        || typeof r.description !== 'string' || r.description.length > 20000) fail('INVALID_REQUEST');
      const url = new URL(r.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('INVALID_REQUEST');
      return Object.freeze({ title: r.title, url: r.url, description: r.description });
    });
    const result: GatewayGroundingResult = Object.freeze({ provider: 'BRAVE', model: 'brave-search-v1', results: Object.freeze(results) });
    // A completed response proves one request, not whether the provider applied a credit.
    // An expired reviewed tariff cannot release a previously held amount.
    if (Date.now() < input.transport.rateCard.expiresAtMs) proofs.set(result, { claim: evidenceBinding(input.claim), usage: Object.freeze({
      binding: input.claim.binding, final: true, outcome: { kind: 'completed' as const }, outputVisible: false, requests: 1,
      chargeBasis: 'conservative-ceiling', conservativeCeilingNanoUsd: input.transport.rateCard.requestNanoUsd,
      rateCardVersion: input.transport.rateCard.version,
    }) });
    return result;
  } catch (error) {
    const failure = error instanceof GatewayTextTransportError ? error : new GatewayTextTransportError(controller.signal.aborted ? 'ABORTED' : 'NETWORK');
    if (physical && (!input.signal.aborted || isInferenceExecutorTimeout(input.signal.reason)) && (healthKind || controller.signal.aborted || !(error instanceof GatewayTextTransportError))) health.set(failure, { claim: evidenceBinding(input.claim), proof: Object.freeze({ binding: input.claim.binding, kind: healthKind ?? 'transient', receivedAtMs: healthReceivedAtMs ?? Date.now(), ...(cooldownUntilMs === undefined ? {} : { cooldownUntilMs }) }) });
    throw failure;
  } finally { clearTimeout(timer); input.signal.removeEventListener('abort', abort); controller.abort(); }
}
