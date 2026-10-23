import { randomUUID } from 'node:crypto';
/** Gateway adapter over the existing strict registry dispatcher. No new catalog,
 * credentials client, quota ledger, inner retry or paid fallback is introduced. */
import { strictFreeText, registryConfig } from '../LiveRegistry/runtime';
import { FreeRoutingError, createRegistryGatewayHooks, readRegistryGatewayRejection, readRegistryGatewayUsage, readRegistryGatewayHealth } from '../LiveRegistry/dispatcher';
import { isVerifiedFreeProof } from '../LiveRegistry/proof';
import { exactModelId } from '../LiveRegistry/eligibility';
import { isCount, isIdentifier, isPositiveCount } from './capabilities';
import { evidenceBinding, profileRejection, withoutEvidence } from './profiles';
import { isInferenceExecutorTimeout, type AuthenticatedRejection, type DispatchClaim } from './executor';
import type { ProviderProfile, RoutingRequest } from './types';
import { gatewayTextCredentialBinding, gatewayTextPayloadDigest, GatewayTextTransportError, type GatewayTextPayload, type GatewayTextResponse, type GatewayTextUsage, type GatewayTextCostAnomaly, type GatewayTransportHealth } from './textTransport';

export interface GatewayOpenRouterConfig {
  readonly provider: 'OPENROUTER'; readonly model: string; readonly endpointTag: string;
  readonly registryVersion: string; readonly maxOutputTokens: number;
  readonly timeoutMs: number; readonly credentialEnv: string; readonly credentialBinding: string;
}
export interface GatewayOpenRouterAuthorization {
  readonly profile: ProviderProfile; readonly transport: GatewayOpenRouterConfig;
  readonly claim: DispatchClaim; readonly request: RoutingRequest;
}
export interface GatewayOpenRouterInput extends Omit<GatewayTextPayload, 'streaming'>, GatewayOpenRouterAuthorization {
  readonly signal: AbortSignal;
  readonly onChunk?: (text: string) => void | Promise<void>;
  readonly markOutputVisible: () => Promise<void>;
  readonly reportCostAnomaly: (error: unknown) => Promise<void>;
  readonly assertDispatchPolicy: () => void;
  readonly authorizeClaim: (authorization: GatewayOpenRouterAuthorization) => Promise<boolean>;
}
const measured = new WeakMap<object, { claim: string; usage: GatewayTextUsage }>();
export function readGatewayOpenRouterUsage(result: unknown, claim: DispatchClaim): GatewayTextUsage | undefined {
  if (!result || typeof result !== 'object') return undefined;
  try { const proof = measured.get(result); return proof?.claim === evidenceBinding(claim) ? proof.usage : undefined; } catch { return undefined; }
}
const health = new WeakMap<object, { claim: string; proof: GatewayTransportHealth }>();
export function readGatewayOpenRouterHealth(error: unknown, claim: DispatchClaim): GatewayTransportHealth | undefined {
 if (!error || typeof error !== 'object') return undefined;
 try { const entry = health.get(error); return entry?.claim === evidenceBinding(claim) ? entry.proof : undefined; } catch { return undefined; }
}
const rejections = new WeakMap<object, { claim: string; proof: AuthenticatedRejection }>();
export function readGatewayOpenRouterRejection(error: unknown, claim: DispatchClaim): AuthenticatedRejection | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try { const entry = rejections.get(error); return entry?.claim === evidenceBinding(claim) ? entry.proof : undefined; } catch { return undefined; }
}
const anomalies = new WeakMap<object, { claim: string; proof: GatewayTextCostAnomaly }>();
export function readGatewayOpenRouterCostAnomaly(error: unknown, claim: DispatchClaim): GatewayTextCostAnomaly | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try { const proof = anomalies.get(error); return proof?.claim === evidenceBinding(claim) ? proof.proof : undefined; } catch { return undefined; }
}
function immutable<T>(value: T): T {
  const result = JSON.parse(evidenceBinding(value)) as T;
  const freeze = (v: unknown): void => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(result); return result;
}
function fail(): never { throw new GatewayTextTransportError('POLICY_BLOCKED'); }
function validate(a: GatewayOpenRouterAuthorization, payload: GatewayTextPayload): void {
  const { profile: p, transport: t, claim: c, request: r } = a; const now = Date.now();
  if (!t || Object.keys(t).some(k => !['provider', 'model', 'endpointTag', 'registryVersion', 'maxOutputTokens', 'timeoutMs', 'credentialEnv', 'credentialBinding'].includes(k))
    || t.provider !== 'OPENROUTER' || !exactModelId(t.model) || !/^[a-zA-Z0-9_./:-]{1,150}$/.test(t.endpointTag)
    || !isIdentifier(t.registryVersion) || !isPositiveCount(t.maxOutputTokens) || t.maxOutputTokens > 8192
    || !isPositiveCount(t.timeoutMs) || t.timeoutMs > 600000 || !/^INFERENCE_GATEWAY_[A-Z0-9_]{1,80}$/.test(t.credentialEnv)) fail();
  if (!r || !p || !c || !c.binding || !isIdentifier(c.id) || !isIdentifier(c.claimId)
    || !isCount(c.queueWaitConsumedAtDispatchMs) || c.intentBinding !== evidenceBinding(c.binding)
    || profileRejection(p, r) || r.outputVisible || r.cancellation?.cancelled !== false || !isCount(r.deadlineAtMs) || now >= r.deadlineAtMs
    || !isPositiveCount(r.attemptTimeoutMs) || r.capability.kind !== 'text' || p.charging !== 'verified-free-no-overage'
    || p.adapterId !== 'gateway-openrouter-text-v1' || p.providerId !== 'OPENROUTER' || p.modelId !== t.model
    || r.surface === 'image-generation' || r.surface === 'image-enhancement') fail();
  const b = c.binding;
  if (b.profileId !== p.id || b.profileVersion !== p.version || b.providerId !== p.providerId || b.modelId !== p.modelId
    || b.modelRevision !== p.modelRevision || b.adapterId !== p.adapterId || b.key.logicalRequestId !== r.logicalRequestId
    || b.key.principalId !== r.principalId || b.key.tenantId !== r.tenantId || b.key.payloadDigest !== r.payloadDigest
    || b.physicalAttemptId !== r.nextPhysicalAttemptId || b.budgetScopeId !== r.budgetScopeId
    || evidenceBinding(b.payer) !== evidenceBinding(r.payer) || b.profileBinding !== evidenceBinding(withoutEvidence(p))
    || b.requestBinding !== evidenceBinding(withoutEvidence(r)) || r.payloadDigest !== gatewayTextPayloadDigest(payload)
    || b.budget || b.priceBinding) fail();
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim() || (payload.systemPrompt !== undefined && typeof payload.systemPrompt !== 'string')
    || payload.schema !== undefined || (payload.images !== undefined && (!Array.isArray(payload.images) || payload.images.length))
    || (payload.modelOverride !== undefined && payload.modelOverride !== t.model)
    || r.capability.streaming !== payload.streaming || r.capability.systemPrompt !== !!payload.systemPrompt
    || r.capability.outputTokens > t.maxOutputTokens
    || Buffer.byteLength(payload.prompt + (payload.systemPrompt ?? ''), 'utf8') + 256 > r.capability.inputTokens) fail();
}
export async function executeGatewayOpenRouter(input: GatewayOpenRouterInput): Promise<GatewayTextResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined; let externalAbort: (() => void) | undefined;
  const controller = new AbortController(); let physicalDispatch = false; let timedOut = false; let dispatchedClaim: DispatchClaim | undefined; let anomalyFailure: GatewayTextTransportError | undefined;
  try {
    if (!input?.signal || typeof input.authorizeClaim !== 'function' || typeof input.markOutputVisible !== 'function' || typeof input.reportCostAnomaly !== 'function'
      || typeof input.assertDispatchPolicy !== 'function' || (input.onChunk !== undefined && typeof input.onChunk !== 'function')) fail();
    const a = immutable({ profile: input.profile, transport: input.transport, claim: input.claim, request: input.request });
    const payload: GatewayTextPayload = { prompt: input.prompt, systemPrompt: input.systemPrompt, schema: input.schema,
      images: input.images === undefined ? undefined : [...input.images], modelOverride: input.modelOverride, streaming: !!input.onChunk };
    validate(a, payload);
    externalAbort = () => controller.abort(); input.signal.addEventListener('abort', externalAbort, { once: true });
    if (input.signal.aborted) controller.abort();
    const timeoutAt = Math.min(a.request.deadlineAtMs, Date.now() + Math.min(a.transport.timeoutMs, a.request.attemptTimeoutMs));
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(0, timeoutAt - Date.now()));
    const active = () => {
      if (Date.now() >= timeoutAt) { timedOut = true; controller.abort(); }
      if (controller.signal.aborted) throw new GatewayTextTransportError(input.signal.aborted ? 'ABORTED' : 'TIMEOUT');
    };
    const bounded = async <T>(promise: Promise<T>): Promise<T> => {
      void promise.catch(() => {}); active(); let abort: (() => void) | undefined;
      try { return await Promise.race([promise, new Promise<never>((_, reject) => {
        abort = () => reject(new GatewayTextTransportError(input.signal.aborted ? 'ABORTED' : 'TIMEOUT'));
        controller.signal.addEventListener('abort', abort, { once: true }); if (controller.signal.aborted) abort();
      })]); } finally { if (abort) controller.signal.removeEventListener('abort', abort); }
    };
    const assertCurrent = () => {
      active(); validate(a, payload);
      // The existing catalog was verified using the existing registry account.
      // A distinct credential cannot silently borrow that account's availability.
      const cfg = registryConfig(); const key = process.env[a.transport.credentialEnv];
      if (!cfg.enabled || !cfg.apiKey || !key || a.transport.credentialBinding !== gatewayTextCredentialBinding(key) || key !== cfg.apiKey || key.length > 4096 || /[\s,]/.test(key)) fail();
      input.assertDispatchPolicy();
    };
    assertCurrent(); let authorized = false; let visible = false;
    const result = await bounded(strictFreeText({ prompt: payload.prompt, systemPrompt: payload.systemPrompt,
      maxOutputTokens: a.request.capability.kind === 'text' ? a.request.capability.outputTokens : 0,
      signal: controller.signal, maxAttempts: 1, allowedModelIds: [a.transport.model], preferredModelId: a.transport.model,
      ...(input.onChunk ? { onChunk: async (text: string) => { active(); await bounded(Promise.resolve(input.onChunk!(text))); } } : {}),
      gateway: createRegistryGatewayHooks({ modelId: a.transport.model, endpointTag: a.transport.endpointTag, registryVersion: a.transport.registryVersion,
        authorizeDispatch: async selected => {
          active(); if (authorized || selected.modelId !== a.transport.model || selected.endpointTag !== a.transport.endpointTag || selected.registryVersion !== a.transport.registryVersion) fail();
          authorized = true; const allowed = await bounded(input.authorizeClaim(a)); active(); if (allowed === true) dispatchedClaim = a.claim; return allowed === true;
        },
        assertDispatchPolicy: assertCurrent,
        onPhysicalDispatch: () => { physicalDispatch = true; },
        onCostAnomaly: async () => {
          if (!dispatchedClaim) fail();
          anomalyFailure = new GatewayTextTransportError('POLICY_BLOCKED');
          anomalies.set(anomalyFailure, { claim: evidenceBinding(dispatchedClaim), proof: immutable({ binding: dispatchedClaim.binding, kind: 'free-cost-contradiction', receivedAtMs: Date.now() }) });
          await input.reportCostAnomaly(anomalyFailure);
          throw anomalyFailure;
        },
        beforeVisibleOutput: async () => { active(); if (!visible) { await bounded(input.markOutputVisible()); visible = true; } active(); },
      }),
    }));
    active();
    if (!authorized || !visible || result.model !== a.transport.model || !isVerifiedFreeProof(result.pricingProof, a.transport.model)
      || result.pricingProof.registryVersion !== a.transport.registryVersion || !['stop', 'length'].includes(result.finishReason)) fail();
    const usage = readRegistryGatewayUsage(result);
    const response: GatewayTextResponse = Object.freeze({ content: result.content, latencyMs: result.latencyMs, provider: 'OPENROUTER',
      model: result.model, pricingProof: result.pricingProof, completeUsage: !!usage, outputVisible: visible, finishReason: result.finishReason as 'stop' | 'length',
      ...(usage ? { usage } : {}) });
    if (usage) measured.set(response, { claim: evidenceBinding(a.claim), usage: immutable({ binding: a.claim.binding, final: true,
      outcome: { kind: 'completed' }, outputVisible: visible, ...usage, actualNanoUsd: 0 }) });
    return response;
  } catch (error) {
    if (anomalyFailure) {
      const failure = input?.signal?.aborted ? new GatewayTextTransportError('ABORTED') : timedOut ? new GatewayTextTransportError('TIMEOUT') : anomalyFailure;
      const proof = anomalies.get(anomalyFailure); if (proof) anomalies.set(failure, proof);
      throw failure;
    }
    const executorTimeout = isInferenceExecutorTimeout(input?.signal?.reason);
    if (input?.signal?.aborted && !executorTimeout) throw new GatewayTextTransportError('ABORTED');
    const observed = readRegistryGatewayHealth(error);
    const healthFailure = (code: 'AUTH' | 'NETWORK' | 'TIMEOUT') => {
      const failure = new GatewayTextTransportError(code);
      if (physicalDispatch && dispatchedClaim && (observed || timedOut || executorTimeout)) health.set(failure, { claim: evidenceBinding(dispatchedClaim), proof: immutable({ binding: dispatchedClaim.binding, kind: observed?.kind ?? 'transient', receivedAtMs: observed?.receivedAtMs ?? Date.now() }) });
      return failure;
    };
    if (timedOut || executorTimeout) throw healthFailure('TIMEOUT');
    if (error instanceof GatewayTextTransportError) throw error;
    if (error instanceof FreeRoutingError) {
      if (error.code === 'SAFETY_REFUSAL') throw new GatewayTextTransportError('SAFETY_REFUSAL');
      if (error.code === 'REQUEST_ABORTED') throw new GatewayTextTransportError('ABORTED');
      if (error.code.includes('429')) {
        const failure = new GatewayTextTransportError('RATE_LIMIT');
        if (physicalDispatch && dispatchedClaim && observed?.kind === 'cooldown-unavailable') health.set(failure, { claim: evidenceBinding(dispatchedClaim), proof: immutable({ binding: dispatchedClaim.binding, ...observed }) });
        const actual = readRegistryGatewayRejection(error);
        if (actual && dispatchedClaim) rejections.set(failure, { claim: evidenceBinding(dispatchedClaim), proof: immutable({
          evidenceRef: randomUUID(), binding: dispatchedClaim.binding, kind: 'http-rejected', status: 429,
          generationRejected: true, outputVisible: false, receivedAtMs: actual.receivedAtMs, ...(actual.cooldownUntilMs === undefined ? {} : { cooldownUntilMs: actual.cooldownUntilMs }),
        }) });
        throw failure;
      }
      if (error.code.includes('401') || error.code.includes('403')) throw healthFailure('AUTH');
      if (error.code.includes('402')) throw new GatewayTextTransportError('QUOTA_EXHAUSTED');
    }
    throw healthFailure('NETWORK');
  } finally { if (timer !== undefined) clearTimeout(timer); if (externalAbort) input.signal.removeEventListener('abort', externalAbort); controller.abort(); }
}
