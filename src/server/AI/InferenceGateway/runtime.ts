/** Server-only composition. OFF is the only route back to a legacy text path. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { verifyFirebaseToken } from '../../lib/authMiddleware';
import { takeGuestInferenceAdmission, isGuestInferenceAdmission, wasGatewayGuestSelected, type GuestInferenceAdmission } from '../../lib/guestDailyQuota';
import { assertAiAvailable } from '../../lib/aiMaintenance';
import { getServerDb } from '../../lib/serverDb';
import { adminEmailList } from '../../lib/adminEmails';
import { parseEnvFlag } from '../../lib/envFlag';
import { strictFreeRequired } from '../inferencePolicy';
import { InferenceGatewayTerminalError, runWithGatewaySelection, isGatewayDispatchSelected } from './dispatchBoundary';
import { resolveGatewayFundingAuthority } from './fundingAuthority';
import { FreeChainStore } from '../FreeChain/store';
import { freeChainConfig } from '../FreeChain/config';
import { readData, readPaidPolicy } from '../FreeChain/paidLedger';
import { publishDeploymentPaidLimit } from '../FreeChain/deploymentBudget';
import { freeChainAdmissionQueue } from '../FreeChain/admissionQueue';
import type { AIProviderResponse } from '../Router/ProviderTypes';
import type { InferenceGatewayContext } from './context';
import type { Surface } from './types';
import { createInferenceExecutor } from './executor';
import { FirestoreInferenceLedger } from './firestoreLedger';
import { GatewayAuthorityStore } from './authorityStore';
import { executeGatewayText, gatewayTextPayloadDigest } from './textTransport';
import { executeGatewayOpenRouter } from './openRouterTransport';
import { createGatewayFreePricingProof } from './pricingEvidence';
import { executeGatewayEmbedding, gatewayEmbeddingPayloadDigest, type GatewayEmbeddingResult } from './embeddingTransport';
import { executeGatewayGrounding, gatewayGroundingPayloadDigest, type GatewayGroundingResult } from './groundingTransport';
import { executeGatewayVision, gatewayVisionPayloadDigest, type GatewayVisionPayload } from './visionTransport';
import type { GatewayEmbeddingPayload, GatewayGroundingPayload } from './capabilityInvocation';

export interface GatewayTextInput {
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  schema?: object;
  images?: string[];
  modelOverride?: string;
}
export type GatewayTextResult = AIProviderResponse & { ok: boolean; reason?: 'stalled' };
export { maintainGatewayQuotaWindows } from './authorityStore';
export { InferenceGatewayTerminalError } from './dispatchBoundary';
export function isGatewayTerminalError(error: unknown): error is InferenceGatewayTerminalError {
  return error instanceof InferenceGatewayTerminalError;
}
interface GatewayIngressIdentity { readonly uid: string | null; readonly guest?: GuestInferenceAdmission; readonly selectedGuest?: boolean; }
export type GatewayGuestContext = Pick<GuestInferenceAdmission, 'kind' | 'principalId' | 'expiresAtMs'>;
const identities = new AsyncLocalStorage<Readonly<GatewayIngressIdentity>>();
interface ContextState {
  context: Readonly<InferenceGatewayContext>;
  identity: Readonly<GatewayIngressIdentity> | undefined;
  selected: boolean;
  validInheritance: boolean;
}
const contexts = new AsyncLocalStorage<ContextState>();
const entryLeases = new AsyncLocalStorage<{ active: boolean; uid: string; identity: ContextState['identity']; waitedMs: number; signal?: AbortSignal }>();
const privacyRank = { public: 0, personal: 1, confidential: 2, health: 3 };
const qualityRank = { weak: 0, standard: 1, normal: 2, strong: 3, professional: 4, clinical: 5 };
const FREE_SURFACES = new Set<Surface>(['chat', 'professional']);
/** Master OFF is the deployment default. An invalid ON configuration never silently falls back. */
export function inferenceGatewayEnabled(surface?: Surface): boolean {
  if (parseEnvFlag(process.env.INFERENCE_GATEWAY_ENABLED) !== true) return false;
  if (!surface) return true;
  if (!FREE_SURFACES.has(surface)) return false;
  const configured = process.env.INFERENCE_GATEWAY_SURFACES;
  return !configured?.trim() || configured.split(',').map(s => s.trim()).includes(surface);
}
/** Verify the actual ingress token; a plain UID, req.body field or context is never an identity proof. */
export async function runWithAuthenticatedInferenceGatewayRequest<T>(req: Request, fn: (uid: string | null, guest?: GatewayGuestContext) => T): Promise<Awaited<T>> {
  const selectedGuest = wasGatewayGuestSelected(req);
  if (!inferenceGatewayEnabled() && !selectedGuest) return await fn(null);
  const uid = await verifyFirebaseToken(req);
  const guest = uid ? null : takeGuestInferenceAdmission(req);
  const view = guest ? Object.freeze({ kind: guest.kind, principalId: guest.principalId, expiresAtMs: guest.expiresAtMs }) : undefined;
  return await identities.run(Object.freeze({ uid, selectedGuest, ...(guest ? { guest } : {}) }), () => fn(uid, view));
}
export function runWithInferenceGatewayContext<T>(context: InferenceGatewayContext, fn: () => T): T {
  const parent = contexts.getStore();
  const validExclusions = context.excludedModelIds === undefined || (Array.isArray(context.excludedModelIds)
    && context.excludedModelIds.length <= 8 && context.excludedModelIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256));
  const validInheritance = validExclusions && (!parent || (parent.validInheritance
    && (parent.context.excludedModelIds ?? []).every(id => context.excludedModelIds?.includes(id))
    && parent.context.principalId === context.principalId && parent.context.tenantId === context.tenantId
    && parent.context.funding === context.funding && context.deadlineAtMs <= parent.context.deadlineAtMs
    && privacyRank[context.dataClass] >= privacyRank[parent.context.dataClass]
    && qualityRank[context.qualityTier] >= qualityRank[parent.context.qualityTier]
    && !(parent.context.mode === 'strict-free' && context.mode !== 'strict-free')));
  const selected = parent?.selected || identities.getStore()?.selectedGuest === true || inferenceGatewayEnabled(context.surface);
  return runWithGatewaySelection(selected, () => contexts.run({ context: Object.freeze({ ...context, ...(Array.isArray(context.excludedModelIds) ? { excludedModelIds: Object.freeze([...context.excludedModelIds]) } : {}), signal: parent?.context.signal && context.signal
      ? AbortSignal.any([parent.context.signal, context.signal]) : parent?.context.signal ?? context.signal }), identity: parent?.identity ?? identities.getStore(),
    selected, validInheritance }, fn));
}
export function currentInferenceGatewayContext(): InferenceGatewayContext | undefined { return contexts.getStore()?.context; }
export function isGatewayRouteSelected(): boolean { return contexts.getStore()?.selected === true; }

function verifiedPrincipal(state: ContextState): string | undefined {
  const { identity, context } = state;
  if (identity?.uid && identity.uid === context.principalId) return identity.uid;
  const guest = identity?.guest;
  if (!identity?.uid && isGuestInferenceAdmission(guest) && context.surface === 'chat'
    && context.funding === 'platform-free-fallback' && context.principalId === guest.principalId && context.tenantId === guest.principalId
    && /^chat:text(?::(?:embedding|grounding|vision-image|vision-pdf))?$/.test(context.policyKey)
    && context.deadlineAtMs <= guest.expiresAtMs) return guest.principalId;
  return undefined;
}

/** Selected inference permission is NOT permission to load another account's private data. */
export function assertGatewayAccountAccess(userId: string): void {
  if (!isGatewayDispatchSelected()) return; // Existing unselected account paths retain their own guards.
  const state = contexts.getStore();
  if (!state?.selected || !state.validInheritance || !state.identity?.uid || state.identity.uid !== userId
    || state.context.principalId !== userId || state.context.tenantId !== userId
    || !verifiedPrincipal(state) || !inferenceGatewayEnabled(state.context.surface)
    || state.context.signal?.aborted || !Number.isSafeInteger(state.context.deadlineAtMs) || state.context.deadlineAtMs <= Date.now()) {
    throw new InferenceGatewayTerminalError('account-data-unverified');
  }
}

/** Acquire before expensive prompt/memory work. Private proof prevents forged or borrowed leases. */
export async function runWithInferenceGatewayEntryAdmission<T>(fn: () => Promise<T>): Promise<T> {
  const state = contexts.getStore(); if (!state?.selected) return await fn();
  if (!state.validInheritance || !verifiedPrincipal(state)) {
    throw new InferenceGatewayTerminalError('context-unverified');
  }
  const inherited = entryLeases.getStore();
  if (inherited?.active && inherited.uid === state.context.principalId && inherited.identity === state.identity) {
    if (inherited.signal?.aborted || state.context.signal?.aborted) throw new InferenceGatewayTerminalError('cancelled');
    if (!inferenceGatewayEnabled(state.context.surface)) throw new InferenceGatewayTerminalError('disabled-after-selection');
    if (state.context.deadlineAtMs <= Date.now()) throw new InferenceGatewayTerminalError('deadline');
    return await fn();
  }
  const { context } = state;
  const admission = await freeChainAdmissionQueue.acquire({ uid: context.principalId, signal: context.signal,
    maxWaitMs: Math.min(5000, Math.max(0, context.deadlineAtMs - Date.now())) });
  if (!admission.admitted) throw new InferenceGatewayTerminalError(`admission-${admission.reason}`);
  const lease = { active: true, uid: context.principalId, identity: state.identity, waitedMs: admission.waitedMs, signal: context.signal };
  try {
    if (context.signal?.aborted) throw new InferenceGatewayTerminalError('cancelled');
    if (!verifiedPrincipal(state)) throw new InferenceGatewayTerminalError('context-unverified');
    if (!inferenceGatewayEnabled(context.surface)) throw new InferenceGatewayTerminalError('disabled-after-selection');
    if (!Number.isSafeInteger(context.deadlineAtMs) || context.deadlineAtMs <= Date.now()) throw new InferenceGatewayTerminalError('deadline');
    return await entryLeases.run(lease, fn);
  } finally { lease.active = false; admission.release(); }
}

/** An unresolved control-plane write may finish later; it never grants a provider dispatch. */
async function boundedControl<T>(operation: () => Promise<T>, deadlineAtMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new InferenceGatewayTerminalError('cancelled');
  const remaining = Math.min(5000, deadlineAtMs - Date.now());
  if (remaining <= 0) throw new InferenceGatewayTerminalError('deadline');
  return await new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (error: unknown, value?: T) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value as T); };
    const abort = () => finish(new InferenceGatewayTerminalError('cancelled'));
    const timer = setTimeout(() => finish(new InferenceGatewayTerminalError('control-plane-timeout')), remaining);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    void Promise.resolve().then(operation).then(value => finish(undefined, value), error => finish(error));
  });
}

type GatewayInvocationInput = (GatewayTextInput & { kind: 'text' })
  | ((GatewayEmbeddingPayload | GatewayGroundingPayload | GatewayVisionPayload) & { signal?: AbortSignal });
type GatewayInvocationResult = (AIProviderResponse | GatewayEmbeddingResult | GatewayGroundingResult) & { ok: boolean; reason?: 'stalled'; inferenceGateway?: AIProviderResponse['inferenceGateway'] };
export async function maybeGatewayText(input: GatewayTextInput): Promise<GatewayTextResult | null> {
  return await runGatewayInvocation({ ...input, kind: 'text' }) as GatewayTextResult | null;
}
async function auxiliary<T>(kind: 'embedding' | 'grounding' | 'vision-image' | 'vision-pdf', fn: () => Promise<T>): Promise<T> {
  const state = contexts.getStore();
  if (!state?.selected) return await fn();
  return await runWithInferenceGatewayContext({ ...state.context, policyKey: `${state.context.policyKey}:${kind}` }, fn);
}
export async function maybeGatewayEmbedding(text: string, options: { signal?: AbortSignal } = {}): Promise<GatewayEmbeddingResult | null> {
  return await auxiliary('embedding', () => runGatewayInvocation({ kind: 'embedding', text, signal: options.signal })) as GatewayEmbeddingResult | null;
}
export async function maybeGatewayGrounding(query: string, options: { maxResults: number; signal?: AbortSignal }): Promise<GatewayGroundingResult | null> {
  return await auxiliary('grounding', () => runGatewayInvocation({ kind: 'grounding-search', query, maxResults: options.maxResults, signal: options.signal })) as GatewayGroundingResult | null;
}
export async function maybeGatewayVision(payload: GatewayVisionPayload, options: { signal?: AbortSignal } = {}): Promise<GatewayTextResult | null> {
  return await auxiliary(payload.attachments.some(a => a.mimeType === 'application/pdf') ? 'vision-pdf' : 'vision-image', () => runGatewayInvocation({ ...payload, signal: options.signal })) as GatewayTextResult | null;
}
async function runGatewayInvocation(input: GatewayInvocationInput): Promise<GatewayInvocationResult | null> {
  const state = contexts.getStore();
  if (!state?.selected) return null;
  const context = state.context;
  let releaseAdmission: (() => void) | undefined;
  // Everything below is terminal. OFF/revocation after selection does not authorize a legacy escape.
  try {
    if (!inferenceGatewayEnabled(context.surface)) throw new InferenceGatewayTerminalError('disabled-after-selection');
    if (!state.validInheritance) throw new InferenceGatewayTerminalError('context-unverified');
    const principal = verifiedPrincipal(state);
    const funding = resolveGatewayFundingAuthority(context, principal);
    if (funding.kind === 'unavailable') throw new InferenceGatewayTerminalError(funding.reason);
    if (input.kind === 'text' && (input.schema !== undefined || input.images?.length || input.modelOverride !== undefined)) {
      throw new InferenceGatewayTerminalError('capability-integration-unavailable');
    }
    if (!Number.isSafeInteger(context.deadlineAtMs) || context.deadlineAtMs <= Date.now()) throw new InferenceGatewayTerminalError('deadline');
    if ((input.kind === 'text' || input.kind === 'vision-pdf') && (typeof input.prompt !== 'string' || !input.prompt.trim() || (input.systemPrompt !== undefined && typeof input.systemPrompt !== 'string'))) {
      throw new InferenceGatewayTerminalError('invalid-request');
    }
    const signal = context.signal && input.signal ? AbortSignal.any([context.signal, input.signal]) : context.signal ?? input.signal;
    if (signal?.aborted) throw new InferenceGatewayTerminalError('cancelled');
    await boundedControl(assertAiAvailable, context.deadlineAtMs, signal);
    if (signal?.aborted) throw new InferenceGatewayTerminalError('cancelled');
    const lease = entryLeases.getStore();
    const admission = lease?.active && lease.uid === context.principalId && lease.identity === state.identity
      ? { admitted: true as const, waitedMs: lease.waitedMs, release: () => {} }
      : await freeChainAdmissionQueue.acquire({ uid: context.principalId, signal, maxWaitMs: Math.min(5000, Math.max(0, context.deadlineAtMs - Date.now())) });
    if (!admission.admitted) throw new InferenceGatewayTerminalError(`admission-${admission.reason}`);
    releaseAdmission = admission.release;
    const db = getServerDb();
    if (!db) throw new InferenceGatewayTerminalError('authority-store-unavailable');
    const deployment = freeChainConfig();
    if (deployment.errors.includes('FREE_CHAIN_PAID_DAILY_CAP_USD')) throw new InferenceGatewayTerminalError('invalid-paid-cap');
    const paidPolicyObserved = !!await boundedControl(async () => readPaidPolicy(readData(await db.doc('free_chat_chain/paid_budget_policy').get())), context.deadlineAtMs, signal);
    if (paidPolicyObserved) {
      const legacyStore = new FreeChainStore(db);
      await boundedControl(() => publishDeploymentPaidLimit(db, deployment.paidCapNanoUsd,
        () => legacyStore.observePaidBudgetPolicy(deployment.paidCapNanoUsd, Date.now(), true)), context.deadlineAtMs, signal);
    }
    const onChunk = input.kind === 'text' ? input.onChunk : undefined;
    const payload = input.kind === 'text' ? { ...input, streaming: !!onChunk } : input;
    const key = { logicalRequestId: randomUUID(), principalId: context.principalId, tenantId: context.tenantId,
      payloadDigest: payload.kind === 'embedding' ? gatewayEmbeddingPayloadDigest(payload.text)
        : payload.kind === 'grounding-search' ? gatewayGroundingPayloadDigest(payload)
        : payload.kind === 'vision-pdf' ? gatewayVisionPayloadDigest(payload) : gatewayTextPayloadDigest(payload) };
    const store = new GatewayAuthorityStore(db, context, key, payload, strictFreeRequired() || context.mode === 'strict-free', signal, admission.waitedMs, paidPolicyObserved);
    const issued = await boundedControl(() => store.issue(), context.deadlineAtMs, signal);
    const ledger = new FirestoreInferenceLedger(db, { now: Date.now,
      principal: { principalId: context.principalId, tenantId: context.tenantId }, platformScope: issued.platformScope,
      adminEmails: adminEmailList, requireConfigurationBinding: true });
    let response: AIProviderResponse | GatewayEmbeddingResult | GatewayGroundingResult | undefined;
    let committed = '';
    let selectedProvider: string | undefined;
    let selectedModel: string | undefined;
    const executor = createInferenceExecutor({ evidence: store.evidence, scopes: [issued.scope], controlPlaneTimeoutMs: 5000,
      clock: { now: Date.now, schedule: (at, callback) => { const timer = setTimeout(callback, Math.max(0, at - Date.now())); return () => clearTimeout(timer); } },
      readTrusted: (executionKey, reservation) => store.readTrusted(executionKey, reservation), ledger,
      waitReady: async (_reservation, _until, waitingSignal) => { if (waitingSignal.aborted) throw new Error('Cancelled'); },
      adapter: { dispatch: async (intent, claim, dispatchSignal, markOutputVisible) => {
        await assertAiAvailable();
        const transport = store.transportFor(intent.candidate.profile.id);
        selectedProvider = transport.provider; selectedModel = intent.candidate.profile.modelId;
        let authorizationStarted = false;
        const adapterInput = { ...input, profile: intent.candidate.profile,
          claim, request: intent.request, signal: dispatchSignal, markOutputVisible,
          reportCostAnomaly: (error: unknown) => store.recordTrustedCostAnomaly(error, claim),
          ...(onChunk ? { onChunk: (chunk: string) => { committed += chunk; onChunk(chunk); } } : {}),
          assertDispatchPolicy: () => {
            if (dispatchSignal.aborted || (authorizationStarted && !store.isDispatchClaimCurrent(claim))) throw new InferenceGatewayTerminalError('dispatch-authority-expired');
            if (!verifiedPrincipal(state) || !inferenceGatewayEnabled(context.surface) || (strictFreeRequired() && intent.request.mode !== 'strict-free')) {
              throw new InferenceGatewayTerminalError('dispatch-policy-changed');
            }
          },
          authorizeClaim: async () => {
            authorizationStarted = true;
            if (!verifiedPrincipal(state) || !inferenceGatewayEnabled(context.surface) || (strictFreeRequired() && intent.request.mode !== 'strict-free')) return false;
            const allowed = await store.authorizeClaim(claim);
            return allowed && !dispatchSignal.aborted && !!verifiedPrincipal(state) && inferenceGatewayEnabled(context.surface) && (!strictFreeRequired() || intent.request.mode === 'strict-free');
          } };
        try {
          const result = transport.kind === 'embedding' && input.kind === 'embedding'
            ? await executeGatewayEmbedding({ ...adapterInput, text: input.text, transport })
            : transport.kind === 'grounding-search' && input.kind === 'grounding-search'
            ? await executeGatewayGrounding({ ...adapterInput, ...input, signal: dispatchSignal, transport })
            : transport.kind === 'vision-pdf' && input.kind === 'vision-pdf'
            ? await executeGatewayVision({ ...adapterInput, payload: input, transport })
            : (transport.kind === undefined || transport.kind === 'text') && input.kind === 'text'
            ? transport.provider === 'OPENROUTER'
              ? await executeGatewayOpenRouter({ ...adapterInput, ...input, signal: dispatchSignal, transport,
                  ...(onChunk ? { onChunk: (chunk: string) => { committed += chunk; onChunk(chunk); } } : {}) })
              : await executeGatewayText({ ...adapterInput, ...input, signal: dispatchSignal, transport,
                  ...(onChunk ? { onChunk: (chunk: string) => { committed += chunk; onChunk(chunk); } } : {}) })
            : (() => { throw new InferenceGatewayTerminalError('capability-transport-mismatch'); })();
          const gatewayPricingProof = 'content' in result ? createGatewayFreePricingProof(result, claim) : undefined;
          response = gatewayPricingProof && 'content' in result ? { ...result, gatewayPricingProof } : result;
          const usageEvidenceRef = await store.recordTrustedUsage(result, claim);
          return { binding: claim.binding, outcome: { kind: 'completed' as const }, outputVisible: 'outputVisible' in result ? result.outputVisible : false,
            ...(usageEvidenceRef ? { usageEvidenceRef } : {}) };
        } catch (error) {
          await store.recordTrustedCostAnomaly(error, claim);
          await store.recordTrustedHealth(error, claim);
          const rejectionEvidenceRef = await store.recordTrustedRejection(error, claim);
          if (rejectionEvidenceRef) return { binding: claim.binding, outcome: { kind: 'definite-failure' as const,
            failureClass: 'retryable-provider-failure' as const }, outputVisible: false, rejectionEvidenceRef };
          throw error;
        } finally { store.closeDispatchClaim(claim); }
      } },
      readAuthoritativeUsage: (claim, reference) => store.readAuthoritativeUsage(claim, reference),
      readAuthoritativeRejection: (claim, reference) => store.readAuthoritativeRejection(claim, reference),
    });
    const cancel = () => { void ledger.cancel(key, issued.cancellationId).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      let outcome = await executor.execute(key, signal);
      // Only an explicit transaction denial proves no new dispatch right exists.
      // Refresh current quota/budget evidence before at most two more admissions.
      for (let replans = 0; replans < 2 && outcome.kind === 'stopped' && outcome.reason === 'admission-denied-replan-required'; replans++) {
        outcome = await executor.execute(key, signal);
      }
      if (outcome.kind === 'completed' && response && (!('content' in response) || response.content.trim())) return { ...response, ok: true, inferenceGateway: { version: 1, logicalRequestId: key.logicalRequestId, accounting: 'separate-ledger' } };
      if (committed && selectedProvider && selectedModel) return { content: committed, provider: selectedProvider as AIProviderResponse['provider'],
        model: selectedModel, latencyMs: Date.now() - issued.createdAtMs, ok: true, reason: 'stalled',
        inferenceGateway: { version: 1, logicalRequestId: key.logicalRequestId, accounting: 'separate-ledger' } };
      throw new InferenceGatewayTerminalError(outcome.kind === 'stopped' || outcome.kind === 'pending-reconciliation'
        ? outcome.reason : outcome.reason ?? 'terminal-provider-failure');
    } finally { signal?.removeEventListener('abort', cancel); }
  } catch (error) {
    if (isGatewayTerminalError(error)) throw error;
    // Raw SDK/storage errors can contain credentials or prompt material. Do not retain their cause.
    throw new InferenceGatewayTerminalError('trusted-runtime-unavailable');
  } finally { releaseAdmission?.(); }
}
