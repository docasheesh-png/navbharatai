/**
 * Pure planner: returns one proposed physical attempt, never a dispatch permit.
 * No network, env lookup, billing write, credential resolution or caller integration.
 * Snapshot eligibility can race. The executor must atomically acquire every
 * hold below, recheck trusted evidence and limits at dispatch, persist the attempt,
 * and retain reservations after uncertain dispatch. Planning alone proves none of it.
 */
import { isCapabilityRequestValid, isCount, isIdentifier, isPositiveCount, supportsCapability } from './capabilities';
import { evidenceBinding, hasCurrentEvidence, profileRejection, quotaLedgerKey, samePayer, validPayer,
  validQuotaDimension, withoutEvidence } from './profiles';
import type { BudgetAuthorization, Candidate, CandidateRejection, EvidenceAuthority, PlanningInput,
  PlanningResult, RejectionReason, RoutingRequest, SelectionPlan } from './types';

const surfaces = ['chat', 'professional', 'doctor', 'sda', 'builder', 'developer-api', 'published-app', 'image-generation', 'image-enhancement'];
const qualityTiers = ['standard', 'weak', 'normal', 'strong', 'professional', 'clinical'];
const dataClasses = ['public', 'personal', 'confidential', 'health'];
const DISPATCH_CHECKS = Object.freeze([
  'revalidate-authenticated-request-and-payload', 'revalidate-profile-terms-capabilities-and-quality',
  'atomic-shared-quota-reservation', 'recheck-deadline-and-cancellation', 'persist-physical-attempt-before-network',
  'enforce-adapter-usage-ceilings', 'retain-unknown-dispatch-reservations', 'no-fallback-after-visible-output',
  'same-tenant-credential-resolution', 'reject-unapproved-provider-substitution',
]);
function validStrings(values: readonly string[]): boolean {
  return Array.isArray(values) && values.length > 0 && values.every(isIdentifier) && new Set(values).size === values.length;
}
function requestRejection(r: RoutingRequest, now: number): PlanningResult | undefined {
  const blocked = (reason: Extract<PlanningResult, { kind: 'blocked' }>['reason']): PlanningResult => ({ kind: 'blocked', reason, rejected: [] });
  if (!r || !isCount(now) || ![r.logicalRequestId, r.nextPhysicalAttemptId, r.principalId, r.tenantId, r.policyRevision,
    r.termsPolicyId, r.budgetScopeId].every(isIdentifier) || !/^[a-f0-9]{64}$/.test(r.payloadDigest)
    || !surfaces.includes(r.surface) || !['strict-free', 'free-first-authorized-paid'].includes(r.mode)
    || !r.quality || !qualityTiers.includes(r.quality.tier) || !isIdentifier(r.quality.gateId) || !isIdentifier(r.quality.gateVersion)
    || !isCapabilityRequestValid(r.capability) || !r.privacy || !dataClasses.includes(r.privacy.dataClass)
    || !isIdentifier(r.privacy.policyId) || !validStrings(r.privacy.allowedProcessingRegions) || !isCount(r.privacy.maxRetentionHours)
    || typeof r.privacy.allowTraining !== 'boolean' || typeof r.privacy.allowHumanReview !== 'boolean'
    || !isCount(r.createdAtMs) || r.createdAtMs > now || !isCount(r.deadlineAtMs)
    || !isCount(r.maxQueueWaitMs) || !isCount(r.queueWaitConsumedMs) || r.queueWaitConsumedMs > r.maxQueueWaitMs
    || !isCount(r.queueEnteredAtMs) || r.queueEnteredAtMs < r.createdAtMs || r.queueEnteredAtMs > now
    || !isCount(r.queueEnteredAtMs + r.maxQueueWaitMs - r.queueWaitConsumedMs)
    || !isPositiveCount(r.firstOutputTimeoutMs) || !isPositiveCount(r.attemptTimeoutMs)
    || r.firstOutputTimeoutMs > r.attemptTimeoutMs || !r.cancellation || !isIdentifier(r.cancellation.id)
    || typeof r.cancellation.cancelled !== 'boolean' || typeof r.outputVisible !== 'boolean'
    || !Number.isInteger(r.maxPhysicalAttempts) || r.maxPhysicalAttempts < 1 || r.maxPhysicalAttempts > 4
    || !Array.isArray(r.attempts)) return blocked('malformed');
  if (!validPayer(r.payer) || (r.payer.kind === 'tenant' && (r.payer.tenantId !== r.tenantId
    || !['developer-api', 'published-app'].includes(r.surface)))) return blocked('payer');
  if (r.attempts.some(a => !a || !isIdentifier(a.physicalAttemptId) || !isIdentifier(a.profileId)
    || !['definite-failure', 'uncertain', 'completed'].includes(a.outcome) || typeof a.outputVisible !== 'boolean'
    || (a.outcome === 'definite-failure' ? !['retryable-provider-failure', 'safety-refusal', 'policy-denied', 'invalid-request'].includes(a.failureClass)
      : a.failureClass !== undefined))
    || new Set([...r.attempts.map(a => a.physicalAttemptId), r.nextPhysicalAttemptId]).size !== r.attempts.length + 1) return blocked('malformed');
  if (r.cancellation.cancelled) return blocked('cancelled');
  if (r.outputVisible || r.attempts.some(a => a.outputVisible)) return blocked('output-visible');
  if (r.attempts.some(a => a.outcome === 'definite-failure' && a.failureClass !== 'retryable-provider-failure')) return blocked('terminal-failure');
  if (r.attempts.some(a => a.outcome === 'uncertain')) return blocked('uncertain-outcome');
  if (r.attempts.some(a => a.outcome === 'completed')) return blocked('already-completed');
  if (r.attempts.length >= r.maxPhysicalAttempts) return blocked('attempt-limit');
  if (r.deadlineAtMs <= now) return blocked('deadline');
  return undefined;
}
interface EvaluatedCandidate {
  candidate: Candidate;
  quotaHeadroom: number;
  reservations: SelectionPlan['quotaReservations'];
  paidHold?: SelectionPlan['budgetReservation'];
}
function budgetEligible(b: BudgetAuthorization | undefined, r: RoutingRequest, profileId: string,
  ceiling: number, authority: EvidenceAuthority, now: number): b is BudgetAuthorization {
  return !!b && hasCurrentEvidence(authority, b.evidenceRef, 'budget', withoutEvidence(b), now)
    && isIdentifier(b.id) && b.principalId === r.principalId && b.tenantId === r.tenantId
    && b.logicalRequestId === r.logicalRequestId && samePayer(b.payer, r.payer) && b.surface === r.surface
    && b.budgetScopeId === r.budgetScopeId && validStrings(b.allowedProfileIds) && b.allowedProfileIds.includes(profileId)
    && isIdentifier(b.periodId) && isCount(b.periodStartsAtMs) && isCount(b.periodEndsAtMs)
    && b.periodStartsAtMs <= now && now < b.periodEndsAtMs
    && [b.maxAttemptNanoUsd, b.remainingLogicalRequestNanoUsd, b.remainingPeriodNanoUsd, b.periodLimitNanoUsd].every(isCount)
    && b.remainingPeriodNanoUsd <= b.periodLimitNanoUsd
    && ceiling <= Math.min(b.maxAttemptNanoUsd, b.remainingLogicalRequestNanoUsd, b.remainingPeriodNanoUsd);
}
function evaluate(c: Candidate, input: PlanningInput, requestBinding: string): EvaluatedCandidate | RejectionReason {
  const { request: r, nowMs: now, authority, budget } = input;
  const { profile: p, quota: q, availability: a, price } = c;
  if (!p || !q || !a) return 'malformed';
  if (!hasCurrentEvidence(authority, p.evidenceRef, 'profile', withoutEvidence(p), now)) return 'evidence';
  const profileReason = profileRejection(p, r);
  if (profileReason) return profileReason;
  // A free label cannot override contradictory pricing, even a stale/malformed/zero quote.
  if (p.charging === 'verified-free-no-overage' && price !== undefined) return 'price';
  if (!Array.isArray(p.capabilities) || !p.capabilities.some(s => supportsCapability(r.capability, s))) return 'capability';
  const profileBinding = evidenceBinding(withoutEvidence(p));
  if (q.requestBinding !== requestBinding || a.requestBinding !== requestBinding
    || q.profileVersion !== p.version || a.profileVersion !== p.version
    || q.profileBinding !== profileBinding || a.profileBinding !== profileBinding
    || q.logicalRequestId !== r.logicalRequestId || q.profileId !== p.id || a.profileId !== p.id
    || !hasCurrentEvidence(authority, q.evidenceRef, 'quota', withoutEvidence(q), now)
    || !hasCurrentEvidence(authority, a.evidenceRef, 'availability', withoutEvidence(a), now)) return 'evidence';
  if (!Array.isArray(q.dimensions) || q.dimensions.length !== p.quotaDimensions.length
    || q.dimensions.some(d => !validQuotaDimension(d, p.providerId) || !isPositiveCount(d.required)
      || !isCount(d.remaining) || d.required > d.remaining)) return 'quota';
  const dimensions = new Map(q.dimensions.map(d => [quotaLedgerKey(d), d]));
  if (dimensions.size !== q.dimensions.length || p.quotaDimensions.some(d => !dimensions.has(quotaLedgerKey(d)))) return 'quota';
  if (![a.coolingUntilMs, a.predictedQueueMs, a.predictedFirstOutputMs, a.predictedCompletionMs].every(isCount)) return 'malformed';
  if (a.coolingUntilMs > now) return 'cooldown';
  const queueDeadline = Math.min(r.queueEnteredAtMs + r.maxQueueWaitMs - r.queueWaitConsumedMs, r.deadlineAtMs);
  const dispatchAt = now + a.predictedQueueMs;
  if (!isCount(dispatchAt) || dispatchAt > queueDeadline || dispatchAt >= r.deadlineAtMs
    || a.predictedFirstOutputMs > r.firstOutputTimeoutMs || a.predictedCompletionMs > r.attemptTimeoutMs
    || a.predictedCompletionMs < a.predictedFirstOutputMs || !isPositiveCount(a.predictedCompletionMs)
    || !isCount(dispatchAt + a.predictedCompletionMs) || dispatchAt + a.predictedCompletionMs > r.deadlineAtMs
    || (r.capability.kind === 'voice-session' && (a.predictedCompletionMs < r.capability.maxDurationMs
      || r.capability.maxDurationMs > r.attemptTimeoutMs))) return 'deadline';
  let paidHold: SelectionPlan['budgetReservation'];
  if (p.charging === 'metered') {
    if (r.mode === 'strict-free') return 'strict-free';
    if (!price || price.requestBinding !== requestBinding || price.profileBinding !== profileBinding || price.logicalRequestId !== r.logicalRequestId
      || price.profileId !== p.id || price.profileVersion !== p.version || !isIdentifier(price.rateCardVersion)
      || price.currency !== 'USD' || price.coverage !== 'all-request-usage' || !isCount(price.estimatedNanoUsd)
      || !isPositiveCount(price.ceilingNanoUsd) || price.estimatedNanoUsd > price.ceilingNanoUsd
      || evidenceBinding(price.capability) !== evidenceBinding(r.capability)
      || !hasCurrentEvidence(authority, price.evidenceRef, 'price', withoutEvidence(price), now)) return 'price';
    if (!budgetEligible(budget, r, p.id, price.ceilingNanoUsd, authority, now)) return 'budget';
    paidHold = { authorizationId: budget.id, budgetScopeId: budget.budgetScopeId, periodId: budget.periodId,
      payer: budget.payer, amountNanoUsd: price.ceilingNanoUsd, rateCardVersion: price.rateCardVersion };
  }
  return { candidate: c, quotaHeadroom: Math.min(...q.dimensions.map(d => (d.remaining - d.required) / d.required)),
    reservations: q.dimensions.map(d => ({ ledgerKey: quotaLedgerKey(d), amount: d.required })), ...(paidHold ? { paidHold } : {}) };
}
/**
 * Lexicographic policy: verified eligible free capacity first; quota headroom then
 * latency for free candidates; estimated total cost then conservative ceiling for
 * paid candidates. Reviewed priority only breaks operational/cost ties, before the
 * stable profile ID fallback. Quality/capability/privacy are eligibility gates,
 * never traded for price or preference. Failed admission means replan with fresh
 * snapshots, not blind fallback.
 */
export function planInference(input: PlanningInput): PlanningResult {
  try {
    const rejected: CandidateRejection[] = [];
    const { request: r, authority, nowMs: now, candidates } = input;
    const invalid = requestRejection(r, now);
    if (invalid) return invalid;
    if (!hasCurrentEvidence(authority, r.evidenceRef, 'request', withoutEvidence(r), now)) return { kind: 'blocked', reason: 'evidence', rejected };
    if (r.surface === 'image-generation' || r.surface === 'image-enhancement') return { kind: 'excluded', reason: 'image-pipeline-preserved' };
    if (!Array.isArray(candidates) || candidates.length > 256) return { kind: 'blocked', reason: 'malformed', rejected };
    const ids = candidates.map(c => c?.profile?.id);
    if (new Set(ids).size !== ids.length) return { kind: 'blocked', reason: 'malformed', rejected };
    const requestBinding = evidenceBinding(withoutEvidence(r));
    const eligible: EvaluatedCandidate[] = [];
    for (const c of candidates) {
      try {
        const result = evaluate(c, input, requestBinding);
        if (typeof result === 'string') rejected.push({ profileId: c?.profile?.id ?? 'invalid-profile', reason: result });
        else eligible.push(result);
      } catch { rejected.push({ profileId: c?.profile?.id ?? 'invalid-profile', reason: 'malformed' }); }
    }
    eligible.sort((a, b) => {
      const paid = Number(!!a.paidHold) - Number(!!b.paidHold);
      if (paid) return paid;
      if (a.paidHold && b.paidHold) {
        const cost = a.candidate.price!.estimatedNanoUsd - b.candidate.price!.estimatedNanoUsd
          || a.paidHold.amountNanoUsd - b.paidHold.amountNanoUsd;
        if (cost) return cost;
      } else if (a.quotaHeadroom !== b.quotaHeadroom) return b.quotaHeadroom - a.quotaHeadroom;
      const latency = (a.candidate.availability.predictedQueueMs + a.candidate.availability.predictedFirstOutputMs)
        - (b.candidate.availability.predictedQueueMs + b.candidate.availability.predictedFirstOutputMs);
      if (latency) return latency;
      const priority = (a.candidate.profile.reviewedPriority ?? 1000) - (b.candidate.profile.reviewedPriority ?? 1000);
      if (priority) return priority;
      return a.candidate.profile.id < b.candidate.profile.id ? -1 : a.candidate.profile.id > b.candidate.profile.id ? 1 : 0;
    });
    const selected = eligible[0];
    if (!selected) return { kind: 'blocked', reason: 'no-eligible-candidate', rejected };
    return { kind: 'plan', authorizedToDispatch: false, logicalRequestId: r.logicalRequestId,
      physicalAttemptId: r.nextPhysicalAttemptId, profileId: selected.candidate.profile.id,
      profileVersion: selected.candidate.profile.version, adapterId: selected.candidate.profile.adapterId,
      capabilityKind: r.capability.kind, payer: r.payer, deadlineAtMs: r.deadlineAtMs,
      queueUntilMs: Math.min(r.queueEnteredAtMs + r.maxQueueWaitMs - r.queueWaitConsumedMs, r.deadlineAtMs), firstOutputTimeoutMs: r.firstOutputTimeoutMs,
      attemptTimeoutMs: r.attemptTimeoutMs, cancellationId: r.cancellation.id,
      remainingPhysicalAttempts: r.maxPhysicalAttempts - r.attempts.length - 1,
      quotaReservations: selected.reservations, ...(selected.paidHold ? { budgetReservation: selected.paidHold } : {}),
      mandatoryDispatchChecks: [...DISPATCH_CHECKS, ...(selected.paidHold
        ? ['revalidate-current-price-and-scoped-budget', 'atomic-shared-budget-hold', 'reconcile-trustworthy-final-usage-only'] : [])], rejected };
  } catch { return { kind: 'blocked', reason: 'malformed', rejected: [] }; }
}
