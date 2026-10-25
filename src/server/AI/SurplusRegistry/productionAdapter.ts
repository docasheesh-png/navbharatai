import { surplusUnattemptedEvidence } from './failureEvidence';
import { createHash } from 'node:crypto';
import { parseEnvFlag } from '../../lib/envFlag';
import { getServerDb } from '../../lib/serverDb';
import { persistSurplusReceipt, reserveSurplusAttempt, resolveSurplusUnattempted, type SurplusPilotAuthority } from './receiptStore';
import { planSurplusDispatchCandidate } from './selector';
import { SurplusStore } from './store';
import { refreshSurplusRegistry, surplusRegistryConfig } from './runtime';
import { createSurplusBuildTransport } from './transport';
import { evaluateSurplusReceipt, normalizeSurplusUsage, isSurplusOfficialTariffApplicable, type SurplusCallBinding, type SurplusOfficialTariff } from './receiptPolicy';
import type { SurplusReviewedAdapter, SurplusReviewedState, SurplusCapabilityReview } from './buildSession';
import type { TurnResult } from '../../AgentV3/ClaudeClient';
import type { OpenAiCompletionLike } from '../../AgentV3/providers/OpenAiToolAdapter';
import type { SurplusTurnPermit } from '../../AgentV3/providers/SurplusTurnRunner';
import { synthesizeLiveReviews, surplusLiveKey, type LiveProductionReviews, type LiveUsageMapping } from './liveAdmission';

/** @deprecated Review Firestore seed is no longer required for live Surplus; kept for admin/legacy references. */
export const SURPLUS_REVIEWS_DOCUMENT = 'live_ai_registry/surplus-builder-reviews';
export type SurplusUsageMapping = LiveUsageMapping;
export type SurplusProductionReviews = LiveProductionReviews;
type WireResponse = { body: unknown; headers: Record<string, string>; receivedAt: number; status: number };
const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const count = (x: unknown): string | null => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? String(x) : null;
function envelope(raw: unknown): { wire: WireResponse; body: Record<string, unknown>; telemetry: Record<string, unknown> } {
  const wire = raw as WireResponse, original = object(wire?.body), nested = object(original.data);
  const body = nested.error ? { ...original, error: nested.error } : original;
  const supplied = object(original.surplus ?? nested.surplus), h = wire?.headers ?? {};
  const conflicts = [['provider', 'x-si-provider-family'], ['served_by', 'x-si-served-by'], ['route_objective', 'x-si-route-objective']].some(([field, header]) => supplied[field] !== undefined && h[header] !== undefined && supplied[field] !== h[header]);
  return { wire, body, telemetry: {
    conflicts,
    provider: supplied.provider ?? h['x-si-provider-family'], served_by: supplied.served_by ?? h['x-si-served-by'],
    truncated: h['x-si-truncated'] === '1' || supplied.truncated === true ? true : supplied.truncated ?? false,
    adapted_params: supplied.adapted_params ?? (h['x-si-adapted-params'] ? h['x-si-adapted-params'].split(',').map(s => s.trim()) : []),
    objective: supplied.route_objective ?? h['x-si-route-objective'],
  } };
}
/** Live admission: Standard key present + AGENTV3_SURPLUS_BUILDER on. No Firestore review seed. */
function assertLive(env: NodeJS.ProcessEnv): string {
  if (parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) !== true) throw new Error('Surplus builder is disabled');
  const key = surplusLiveKey(env);
  if (!key) throw new Error('Surplus API key missing or invalid for live builder');
  return key;
}
function reviewedEvidence(config: SurplusProductionReviews, review: SurplusCapabilityReview, now: number) {
  const mappings = config.usageMappings.filter(m => m && m.model === review.model
    && ['prompt_tokens_details.cached_tokens', 'prompt_cache_hit_tokens'].includes(m.cacheRead)
    && m.cacheWrite === 'unsupported' && ['included-in-completion-output-rate', 'completion_tokens_details.reasoning_tokens'].includes(m.reasoning)
    && m.additionalCharges === 'none' && m.expiresAt > now);
  if (mappings.length !== 1) throw new Error('Surplus usage mapping missing for live model');
  const mapping = mappings[0];
  const tariffs = config.tariffs.filter(t => isSurplusOfficialTariffApplicable(t, {
    modelId: review.model, modelVersion: review.modelVersion, mappingReviewId: mapping.reviewId, startedAt: now, receivedAt: now,
  }, now));
  if (tariffs.length !== 1) throw new Error('Surplus tariff missing for live model');
  return { mapping, tariff: tariffs[0] };
}
export function createProductionSurplusAdapter(env: NodeJS.ProcessEnv = process.env): SurplusReviewedAdapter {
  // State authority and call authority are object identities, never mutable "latest" data.
  const states = new WeakMap<object, SurplusProductionReviews & SurplusReviewedState>();
  const permits = new WeakMap<object, { review: SurplusCapabilityReview; startedAt: number | null; config: SurplusProductionReviews;
    mapping: SurplusUsageMapping; tariff: SurplusOfficialTariff; state: SurplusReviewedState; canContinue?: boolean }>();
  return {
    async readState() {
      assertLive(env);
      const db = getServerDb();
      if (!db) throw new Error('Surplus metadata store unavailable');
      // Metadata refresh has a durable 5–10 minute lease; no inference occurs here.
      await refreshSurplusRegistry();
      const snapshot = await new SurplusStore(db).read(surplusRegistryConfig(env).models);
      const now = Date.now();
      // Live path: synthesize admission from key + observed snapshot. No Firestore review seed.
      const data = synthesizeLiveReviews(env, snapshot, now);
      if (!data.capabilities.length) throw new Error('Surplus live admission has no observed models yet');
      const state: SurplusReviewedState = { ...data, snapshot };
      states.set(state, structuredClone({ ...data, snapshot }));
      return state;
    },
    routing(review) { return { provider: review.providerId, si_route: { objective: 'price' } }; },
    bind(permit, state, review) {
      const config = states.get(state);
      if (!config || permits.has(permit)) throw new Error('Unissued or replayed Surplus authority');
      const matches = config.capabilities.filter(c => c.reviewId === review.reviewId && c.model === permit.model && c.providerId === permit.providerId);
      if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(review)) throw new Error('Surplus capability binding mismatch');
      const bound = structuredClone(config), evidence = reviewedEvidence(bound, matches[0], Date.now());
      permits.set(permit, { config: bound, review: structuredClone(matches[0]), startedAt: null, state: structuredClone(config), ...evidence });
    },
    async dispatch(request, signal, permit) {
      const record = permits.get(permit), now = Date.now();
      if (!record || record.startedAt !== null) throw new Error('Unissued or replayed Surplus dispatch');
      assertLive(env);
      if (record.review.expiresAt <= now || permit.endpoint !== record.review.endpoint || request.model !== permit.model
          || request.provider !== permit.providerId || object(request.si_route).objective !== 'price') throw new Error('Expired or mismatched Surplus dispatch');
      reviewedEvidence(record.config, record.review, now);
      const recheck = () => {
        if (!surplusRegistryConfig(env).models.includes(permit.model)) throw new Error('Surplus model no longer configured');
        const snapshot = record.state.snapshot ? { ...record.state.snapshot, offers: record.state.snapshot.offers.filter(o => o.model === permit.model) } : null;
        // Converted wire bytes deliberately overestimate tokens. This is reservation evidence only.
        const workload = { input: Buffer.byteLength(JSON.stringify([request.messages, request.tools ?? []]), 'utf8'),
          output: permit.maxTokens, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
        if (workload.input + workload.output > record.review.contextTokens || workload.output > record.review.maxOutputTokens) {
          throw new Error('Surplus converted request exceeds reviewed capability');
        }
        const plan = planSurplusDispatchCandidate(snapshot, record.state.reviews, workload, Date.now(), record.state.floorContract);
        if (plan.status !== 'estimated_candidate' || !plan.selection || plan.snapshotVersion !== permit.priceGeneration
            || plan.selection.model !== permit.model || plan.selection.providerId !== permit.providerId) {
          throw new Error('Surplus dispatch observation or route review expired');
        }
        return plan.selection;
      };
      const selection = recheck();
      record.startedAt = now; // An uncertain call cannot be replayed, including a transport failure.
      const db = getServerDb();
      if (!db || typeof permit.estimatedMicroUsd !== 'string' || !/^[0-9]{1,18}(?:\.[0-9]{1,6})?$/.test(permit.estimatedMicroUsd)) throw new Error('Surplus durable reservation unavailable');
      const dispatchEnv = { ...env };
      await reserveSurplusAttempt(db, { buildId: permit.buildId, callId: permit.callId, accountId: record.config.account.accountId,
        credentialSha256: record.config.account.credentialSha256, model: permit.model, providerId: permit.providerId,
        endpoint: permit.endpoint, policyVersion: permit.policyVersion, priceGeneration: permit.priceGeneration,
        estimatedMicroUsd: selection.estimatedMicroUsd, controlRevision: record.state.snapshot?.controlRevision ?? 0, reviewRevision: record.config.revision, pilot: record.config.pilot, now });
      // Reservation I/O may outlive review validity or observe a credential rotation. Fail closed.
      assertLive(env);
      reviewedEvidence(record.config, record.review, Date.now());
      recheck();
      permit.assertCurrent?.();
      if (signal.aborted || record.review.expiresAt <= Date.now()) throw new Error('Surplus dispatch expired or stopped');
      // Capture this reviewed credential generation, never a key retained by an older transport.
      return createSurplusBuildTransport(dispatchEnv)(request, signal);
    },
    identify(raw) {
      const { wire, body, telemetry } = envelope(raw);
      if (!wire || wire.status < 200 || wire.status >= 300 || body.error || !Array.isArray(body.choices)
          || telemetry.conflicts || typeof telemetry.truncated !== 'boolean' || typeof body.model !== 'string' || typeof telemetry.provider !== 'string' || telemetry.served_by !== 'marketplace'
          || (telemetry.objective !== undefined && telemetry.objective !== 'price')
          || !Array.isArray(telemetry.adapted_params) || telemetry.adapted_params.length || wire.headers?.['x-si-adapted-params']?.trim()) throw new Error('Surplus response route or capabilities did not match');
      const completion = structuredClone(body) as unknown as OpenAiCompletionLike;
      if (telemetry.truncated === true && completion.choices?.[0]) completion.choices[0].finish_reason = 'length';
      return { model: body.model, providerId: telemetry.provider, completion };
    },
    async receipt(raw, permit, result: TurnResult) {
      const record = permits.get(permit);
      if (!record || record.startedAt === null) throw new Error('Unissued Surplus receipt');
      const { wire, body, telemetry } = envelope(raw), usage = object(body.usage), cfg = record.config;
      const mapping = record.mapping.expiresAt > wire?.receivedAt && record.mapping.expiresAt > Date.now() ? record.mapping : null;
      const tariff = record.tariff;
      const input = count(usage.prompt_tokens), output = count(usage.completion_tokens);
      const cacheRead = mapping?.cacheRead === 'prompt_tokens_details.cached_tokens' ? count(object(usage.prompt_tokens_details).cached_tokens)
        : mapping?.cacheRead === 'prompt_cache_hit_tokens' ? count(usage.prompt_cache_hit_tokens) : null;
      const reasoning = mapping?.reasoning === 'included-in-completion-output-rate' ? '0'
        : mapping?.reasoning === 'completion_tokens_details.reasoning_tokens' ? count(object(usage.completion_tokens_details).reasoning_tokens) : null;
      const normalized = mapping && input !== null && output !== null && cacheRead !== null && reasoning !== null && mapping.cacheWrite === 'unsupported'
        ? normalizeSurplusUsage({ mappingReviewId: mapping.reviewId, inputIncludesCache: true, outputIncludesReasoning: true,
          tokens: { input, output, cacheRead, cacheWrite: '0', reasoning } }) : null;
      const binding: SurplusCallBinding = { buildId: permit.buildId, callId: permit.callId, accountId: cfg.account.accountId,
        modelId: permit.model, modelVersion: record.review.modelVersion, providerId: permit.providerId,
        endpoint: permit.endpoint, offerId: null, startedAt: record.startedAt };
      const requestId = typeof body.id === 'string' && body.id ? body.id : permit.callId;
      const decision = evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding,
        disposition: result.truncated ? 'partially_discarded' : result.text || result.toolUses.length ? 'accepted' : 'failed',
        tariff, now: Date.now(), receipt: {
          ...binding, modelId: typeof body.model === 'string' ? body.model : '',
          providerId: typeof telemetry.provider === 'string' ? telemetry.provider : '',
          modelVersion: body.model === permit.model ? record.review.modelVersion : '',
          kind: 'validated-surplus-response', receiptId: requestId, requestId,
          identitySource: typeof body.id === 'string' && body.id ? 'provider-response-id' : 'server-dispatch-id',
          currency: 'USD', buyerCostMicro: usage.buyer_cost_micro as number | string, costSource: 'usage.buyer_cost_micro',
          responseComplete: true, receivedAt: wire?.receivedAt,
          evidenceSha256: createHash('sha256').update(JSON.stringify([body, wire?.headers, permit.priceGeneration, permit.policyVersion])).digest('hex'),
          additionalCharges: mapping?.additionalCharges === 'none' ? 'none' : 'unknown', usage: normalized,
        },
      });
      const db = getServerDb();
      if (!db) throw new Error('Surplus receipt audit store unavailable');
      const persisted = await persistSurplusReceipt(db, { buildId: permit.buildId, callId: permit.callId, accountId: cfg.account.accountId,
        model: permit.model, providerId: permit.providerId, endpoint: permit.endpoint, policyVersion: permit.policyVersion,
        priceGeneration: permit.priceGeneration, reportedAt: wire?.receivedAt, usage: normalized,
        invoiceReconciliation: 'not-reconciled', decision });
      record.canContinue = persisted?.canContinue === true;
      return decision;
    },
    async failure(raw, permit, result, failure) {
      const record = permits.get(permit);
      if (!record || record.startedAt === null || raw === undefined) return { canRetry: false };
      const preRoute = surplusUnattemptedEvidence(raw);
      if (preRoute) {
        const db = getServerDb();
        if (!db) return { canRetry: false };
        const persisted = await resolveSurplusUnattempted(db, { buildId: permit.buildId, callId: permit.callId,
          accountId: record.config.account.accountId, model: permit.model, providerId: permit.providerId,
          endpoint: permit.endpoint, policyVersion: permit.policyVersion, priceGeneration: permit.priceGeneration, ...preRoute });
        return { canRetry: persisted.canContinue === true };
      }
      const receipt = await this.receipt(raw, permit, result);
      // A fully returned, identity-verified empty completion is not a policy refusal or unknown timeout.
      let verifiedEmpty = false;
      if (failure.reason === 'empty_completion') {
        try {
          const response = this.identify(raw), choice = response.completion.choices?.[0];
          verifiedEmpty = response.model === permit.model && response.providerId === permit.providerId
            && choice?.finish_reason === 'stop' && choice.message?.role === 'assistant'
            && (!('refusal' in choice.message) || choice.message.refusal == null)
            && !choice.message.content?.trim() && !choice.message.tool_calls?.length;
        } catch { /* no route-identity guess */ }
      }
      return { receipt, canRetry: verifiedEmpty && record.canContinue === true && receipt?.status === 'absorbed' && receipt.actualCostUsd !== null && receipt.officialCeilingUsd !== null };
    },
  };
}
