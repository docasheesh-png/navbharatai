import { describe, expect, it } from 'vitest';
import { planInference } from './policy';
import { evidenceBinding, PRODUCTION_PROFILES, quotaLedgerKey, withoutEvidence } from './profiles';
import type {
  BudgetAuthorization, Candidate, CapabilityRequest, CapabilitySupport, EvidenceKind, EvidenceRecord,
  PlanningInput, PlanningResult, ProviderProfile, RoutingRequest, SelectionPlan,
} from './types';

// Synthetic data only. These fixtures assert no current provider/model capabilities or prices.
const NOW = Date.parse('2026-10-22T19:00:00Z');
const generation = { inputTokens: 100, outputTokens: 20, streaming: true, systemPrompt: true };
const generationSupport = { maxInputTokens: 1000, maxOutputTokens: 100, maxContextTokens: 1100, streaming: true, systemPrompt: true };
const requests: readonly CapabilityRequest[] = [
  { kind: 'text', ...generation },
  { kind: 'tool-json', ...generation, features: ['tool-calls', 'strict-json-schema'], schemaDialect: 'fixture-dialect' },
  { kind: 'vision-pdf', ...generation, formats: ['image/png', 'application/pdf'], imageCount: 1, pdfPages: 3 },
  { kind: 'voice-session', inputFormat: 'fixture-pcm-in', outputFormat: 'fixture-pcm-out', bidirectional: true, interruption: true, maxDurationMs: 60_000 },
  { kind: 'embedding', inputTokens: 100, dimensions: 64, vectorSpaceId: 'fixture-model-r1:preprocess-r1' },
  { kind: 'grounding-search', queries: 1, maxResults: 10, citations: true, domainFiltering: true },
];
const supports: readonly CapabilitySupport[] = [
  { kind: 'text', ...generationSupport },
  { kind: 'tool-json', ...generationSupport, features: ['tool-calls', 'strict-json-schema'], schemaDialects: ['fixture-dialect'] },
  { kind: 'vision-pdf', ...generationSupport, formats: ['image/png', 'application/pdf'], maxImages: 2, maxPdfPages: 20 },
  { kind: 'voice-session', inputFormats: ['fixture-pcm-in'], outputFormats: ['fixture-pcm-out'], bidirectional: true, interruption: true, maxDurationMs: 60_000 },
  { kind: 'embedding', maxInputTokens: 1000, dimensions: 64, vectorSpaceId: 'fixture-model-r1:preprocess-r1' },
  { kind: 'grounding-search', maxQueries: 2, maxResults: 20, citations: true, domainFiltering: true },
];
function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    logicalRequestId: 'logical-1', nextPhysicalAttemptId: 'physical-1', principalId: 'principal-1', tenantId: 'tenant-1',
    payloadDigest: 'a'.repeat(64), policyRevision: 'policy-v1', termsPolicyId: 'legal-policy-v1', budgetScopeId: 'new-free-first-aggregate',
    surface: 'chat', quality: { tier: 'standard', gateId: 'fixture-quality', gateVersion: '1' }, capability: requests[0],
    privacy: { dataClass: 'public', policyId: 'privacy-v1', allowedProcessingRegions: ['fixture-region'], maxRetentionHours: 0,
      allowTraining: false, allowHumanReview: false }, payer: { kind: 'platform', ownerId: 'platform-owner' },
    mode: 'free-first-authorized-paid', createdAtMs: NOW, deadlineAtMs: NOW + 120_000, maxQueueWaitMs: 5000, queueWaitConsumedMs: 0, queueEnteredAtMs: NOW,
    firstOutputTimeoutMs: 1000, attemptTimeoutMs: 90_000, cancellation: { id: 'cancel-1', cancelled: false },
    outputVisible: false, maxPhysicalAttempts: 4, attempts: [], evidenceRef: 'request-ref', ...overrides,
  };
}
function candidate(r: RoutingRequest, id = 'free-a', paid = false, profileOverrides: Partial<ProviderProfile> = {}): Candidate {
  const profile: ProviderProfile = {
    id, version: 'v1', providerId: 'fixture-provider', modelId: 'fixture-model', modelRevision: 'r1', adapterId: `fixture-${r.capability.kind}`,
    status: 'approved', serviceClass: 'production', product: 'inference-api', surfaces: [r.surface],
    qualityApprovals: [r.quality], termsApprovals: [r.termsPolicyId], capabilities: [supports.find(s => s.kind === r.capability.kind)!],
    privacy: { dataClasses: ['public', 'personal', 'confidential', 'health'], training: 'none', humanReview: 'none',
      retentionHours: 0, processingRegions: ['fixture-region'] }, credentialOwner: r.payer,
    quotaDimensions: [
      { scope: { providerId: 'fixture-provider', kind: 'organization', id: 'shared-org' }, meter: 'requests/day' },
      { scope: { providerId: 'fixture-provider', kind: 'model', id: 'shared-org/model' }, meter: 'tokens/minute' },
    ], charging: paid ? 'metered' : 'verified-free-no-overage', evidenceRef: `profile-${id}`, ...profileOverrides,
  };
  const requestBinding = evidenceBinding(withoutEvidence(r));
  const profileBinding = evidenceBinding(withoutEvidence(profile));
  return {
    profile,
    quota: { logicalRequestId: r.logicalRequestId, profileId: id, profileVersion: profile.version, profileBinding, requestBinding,
      dimensions: profile.quotaDimensions.map(d => ({ ...d, required: 10, remaining: 100 })), evidenceRef: `quota-${id}` },
    availability: { profileId: id, profileVersion: profile.version, profileBinding, requestBinding, coolingUntilMs: 0, predictedQueueMs: 0, predictedFirstOutputMs: 100,
      predictedCompletionMs: r.capability.kind === 'voice-session' ? r.capability.maxDurationMs : 200, evidenceRef: `availability-${id}` },
    ...(paid ? { price: { logicalRequestId: r.logicalRequestId, profileId: id, profileVersion: profile.version, profileBinding, requestBinding,
      rateCardVersion: 'fixture-rate-1', currency: 'USD' as const, estimatedNanoUsd: 1_000_000_000, ceilingNanoUsd: 2_000_000_000,
      coverage: 'all-request-usage' as const, capability: r.capability, evidenceRef: `price-${id}` } } : {}),
  };
}
function budget(r: RoutingRequest): BudgetAuthorization {
  return { id: 'budget-authority', principalId: r.principalId, tenantId: r.tenantId, logicalRequestId: r.logicalRequestId,
    payer: r.payer, surface: r.surface, allowedProfileIds: ['paid-a', 'paid-b'], budgetScopeId: r.budgetScopeId,
    periodId: 'IST-2026-10-23', periodStartsAtMs: Date.parse('2026-10-22T18:30:00Z'), periodEndsAtMs: Date.parse('2026-10-23T18:30:00Z'),
    maxAttemptNanoUsd: 10_000_000_000, remainingLogicalRequestNanoUsd: 10_000_000_000,
    remainingPeriodNanoUsd: 10_000_000_000, periodLimitNanoUsd: 10_000_000_000, evidenceRef: 'budget-ref' };
}
function context(r = request(), candidates = [candidate(r)], b: BudgetAuthorization | undefined = budget(r)) {
  const records = new Map<string, EvidenceRecord>();
  function issue(kind: EvidenceKind, subject: { readonly evidenceRef: string }) {
    records.set(subject.evidenceRef, { kind, binding: evidenceBinding(withoutEvidence(subject)), issuedAtMs: NOW - 100,
      expiresAtMs: NOW + 300_000, revoked: false });
  }
  function seal() {
    issue('request', input.request);
    for (const c of input.candidates) {
      issue('profile', c.profile); issue('quota', c.quota); issue('availability', c.availability);
      if (c.price) issue('price', c.price);
    }
    if (input.budget) issue('budget', input.budget);
  }
  const input: { nowMs: number; request: RoutingRequest; candidates: Candidate[]; budget: BudgetAuthorization | undefined;
    authority: PlanningInput['authority'] } = { nowMs: NOW, request: r, candidates, budget: b, authority: { lookup: ref => records.get(ref) } };
  seal();
  return { input, records, seal };
}
function plan(result: PlanningResult): SelectionPlan {
  expect(result.kind).toBe('plan');
  if (result.kind !== 'plan') throw new Error(JSON.stringify(result));
  return result;
}
function rejected(result: PlanningResult, reason: string) {
  expect(result.kind).toBe('blocked');
  if (result.kind === 'blocked') expect(result.rejected.some(r => r.reason === reason)).toBe(true);
}

describe('inactive and authority-bound planning', () => {
  it('enrolls no real profiles and returns a non-dispatchable plan', () => {
    expect(PRODUCTION_PROFILES).toEqual([]);
    const c = context();
    const result = plan(planInference(c.input));
    expect(result.authorizedToDispatch).toBe(false);
    expect(result.physicalAttemptId).toBe('physical-1');
    expect(result.mandatoryDispatchChecks).toEqual(expect.arrayContaining([
      'revalidate-authenticated-request-and-payload', 'atomic-shared-quota-reservation', 'recheck-deadline-and-cancellation',
      'persist-physical-attempt-before-network', 'retain-unknown-dispatch-reservations', 'no-fallback-after-visible-output',
    ]));
  });
  it('does not mutate inputs and is deterministic', () => {
    const c = context(); const before = JSON.stringify(c.input);
    expect(planInference(c.input)).toEqual(planInference(c.input)); expect(JSON.stringify(c.input)).toBe(before);
  });
  it('does not accept typed request metadata without trusted evidence', () => {
    const c = context(); c.records.delete('request-ref');
    expect(planInference(c.input)).toMatchObject({ kind: 'blocked', reason: 'evidence' });
  });
  it.each(['principalId', 'tenantId', 'payloadDigest', 'policyRevision', 'budgetScopeId'] as const)('rejects a forged %s', field => {
    const c = context(); c.input.request = { ...c.input.request, [field]: field === 'payloadDigest' ? 'b'.repeat(64) : 'forged' };
    expect(planInference(c.input)).toMatchObject({ kind: 'blocked', reason: 'evidence' });
  });
  it.each(['request-ref', 'profile-free-a', 'quota-free-a', 'availability-free-a'])('rejects missing %s', ref => {
    const c = context(); c.records.delete(ref); expect(planInference(c.input).kind).toBe('blocked');
  });
  it.each(['expired', 'future', 'revoked', 'wrong-kind', 'mismatched'])('rejects %s authoritative evidence', mutation => {
    const c = context(); const old = c.records.get('profile-free-a')!;
    c.records.set('profile-free-a', { ...old,
      ...(mutation === 'expired' ? { expiresAtMs: NOW } : {}), ...(mutation === 'future' ? { issuedAtMs: NOW + 1 } : {}),
      ...(mutation === 'revoked' ? { revoked: true } : {}), ...(mutation === 'wrong-kind' ? { kind: 'budget' as const } : {}),
      ...(mutation === 'mismatched' ? { binding: '{}' } : {}),
    }); rejected(planInference(c.input), 'evidence');
  });
  it('fails closed when evidence authority is unavailable', () => {
    const c = context(); c.input.authority = { lookup: () => { throw new Error('store unavailable'); } };
    expect(planInference(c.input)).toMatchObject({ kind: 'blocked', reason: 'evidence' });
  });
  it('does not reuse forecasts or quota estimates for a changed authorized payload', () => {
    const c = context(); c.input.request = { ...c.input.request, payloadDigest: 'c'.repeat(64) }; c.seal();
    rejected(planInference(c.input), 'evidence');
  });
  it.each(['image-generation', 'image-enhancement'] as const)('preserves %s, including enhancement dependencies', surface => {
    const c = context(request({ surface }));
    expect(planInference(c.input)).toEqual({ kind: 'excluded', reason: 'image-pipeline-preserved' });
  });
});

describe('capability, quality and privacy compatibility', () => {
  it.each(requests)('plans the distinct $kind family without text coercion', capability => {
    const r = request({ capability }); const result = plan(planInference(context(r).input));
    expect(result.capabilityKind).toBe(capability.kind); expect(result.adapterId).toBe(`fixture-${capability.kind}`);
  });
  it.each(requests.filter(r => r.kind !== 'text'))('text support does not imply $kind', capability => {
    const r = request({ capability }); const c = candidate(r);
    rejected(planInference(context(r, [{ ...c, profile: { ...c.profile, capabilities: [supports[0]] } }]).input), 'capability');
  });
  it('does not collapse Strong into a cheap Weak gate', () => {
    const r = request({ surface: 'builder', quality: { tier: 'strong', gateId: 'builder-quality', gateVersion: '9' } });
    const c = candidate(r); rejected(planInference(context(r, [{ ...c, profile: { ...c.profile,
      qualityApprovals: [{ ...r.quality, tier: 'weak' }] } }]).input), 'quality');
  });
  it('requires the exact quality gate version', () => {
    const c = context(); c.input.candidates = [{ ...c.input.candidates[0], profile: { ...c.input.candidates[0].profile,
      qualityApprovals: [{ ...c.input.request.quality, gateVersion: 'obsolete' }] } }]; c.seal();
    rejected(planInference(c.input), 'quality');
  });
  it.each(['evaluation-only', 'unknown'] as const)('rejects %s services, including NVIDIA hosted trial', serviceClass => {
    const r = request(); const c = candidate(r); rejected(planInference(context(r, [{ ...c,
      profile: { ...c.profile, providerId: 'nvidia-hosted-trial-fixture', serviceClass } }]).input), 'profile-ineligible');
  });
  it('rejects coding subscriptions as production inference products', () => {
    const r = request(); const c = candidate(r); rejected(planInference(context(r, [{ ...c,
      profile: { ...c.profile, product: 'coding-subscription' } }]).input), 'profile-ineligible');
  });
  it.each(['personal', 'confidential', 'health'] as const)('excludes %s data from training/review tiers even with permissive flags', dataClass => {
    const r = request({ privacy: { ...request().privacy, dataClass, allowTraining: true, allowHumanReview: true } });
    const c = candidate(r); rejected(planInference(context(r, [{ ...c, profile: { ...c.profile,
      privacy: { ...c.profile.privacy, training: 'permitted', humanReview: 'permitted' } } }]).input), 'privacy');
  });
  it.each(['training', 'humanReview'] as const)('unknown %s terms are not assumed safe', field => {
    const r = request(); const c = candidate(r); rejected(planInference(context(r, [{ ...c, profile: { ...c.profile,
      privacy: { ...c.profile.privacy, [field]: 'unknown' } } }]).input), 'privacy');
  });
  it('requires known retention and permitted processing geography', () => {
    const r = request(); const c = candidate(r);
    for (const privacy of [{ ...c.profile.privacy, retentionHours: null }, { ...c.profile.privacy, processingRegions: ['other-region'] }]) {
      rejected(planInference(context(r, [{ ...c, profile: { ...c.profile, privacy } }]).input), 'privacy');
    }
  });
});

describe('reviewed provider preference is a bounded, evidence-backed tie-breaker', () => {
  it('preserves reviewed GLM 4.7 preference over 4.5 despite reverse lexical profile and model IDs', () => {
    const r = request();
    const older = candidate(r, 'a-glm-4.5', false, { modelId: 'glm-4.5-flash', reviewedPriority: 20 });
    const preferred = candidate(r, 'z-glm-4.7', false, { modelId: 'glm-4.7-flash', reviewedPriority: 10 });
    for (const candidates of [[older, preferred], [preferred, older]]) {
      expect(plan(planInference(context(r, candidates).input)).profileId).toBe(preferred.profile.id);
    }
  });
  it.each([undefined, 1000, 50])('preserves deterministic legacy ID fallback for equal priority %s', reviewedPriority => {
    const r = request(); const overrides = reviewedPriority === undefined ? {} : { reviewedPriority };
    const a = candidate(r, 'free-a', false, overrides); const b = candidate(r, 'free-b', false, overrides);
    for (const candidates of [[a, b], [b, a]]) expect(plan(planInference(context(r, candidates).input)).profileId).toBe('free-a');
  });
  it('ranks an omitted legacy preference as 1000 without changing that profile evidence', () => {
    const r = request(); const legacy = candidate(r, 'free-a');
    const preferred = candidate(r, 'free-z', false, { reviewedPriority: 0 });
    expect(plan(planInference(context(r, [legacy, preferred]).input)).profileId).toBe('free-z');
    expect(legacy.profile).not.toHaveProperty('reviewedPriority');
  });
  it.each([-1, 1001, 1.5, '10', null])('rejects an invalid reviewed priority %s even with matching evidence', reviewedPriority => {
    const r = request();
    const c = candidate(r, 'free-a', false, { reviewedPriority: reviewedPriority as number });
    rejected(planInference(context(r, [c]).input), 'malformed');
  });
  it.each([0, 1000])('accepts inclusive reviewed priority boundary %i', reviewedPriority => {
    const r = request();
    expect(plan(planInference(context(r, [candidate(r, 'free-a', false, { reviewedPriority })]).input)).profileId).toBe('free-a');
  });
  it('rejects an unreviewed priority change instead of accepting a typed profile preference', () => {
    const c = context();
    c.input.candidates = [{ ...c.input.candidates[0], profile: { ...c.input.candidates[0].profile, reviewedPriority: 0 } }];
    rejected(planInference(c.input), 'evidence');
  });
  it('keeps free quota headroom ahead of the preferred primary', () => {
    const r = request(); const preferred = candidate(r, 'free-a', false, { reviewedPriority: 0 });
    const drained = { ...preferred, quota: { ...preferred.quota, dimensions: preferred.quota.dimensions.map(d => ({ ...d, remaining: 11 })) } };
    expect(plan(planInference(context(r, [drained, candidate(r, 'free-b', false, { reviewedPriority: 100 })]).input)).profileId).toBe('free-b');
  });
  it.each(['quota', 'cooldown'] as const)('skips a preferred primary rejected for %s', condition => {
    const r = request(); const preferred = candidate(r, 'free-a', false, { reviewedPriority: 0 });
    const unavailable = condition === 'quota'
      ? { ...preferred, quota: { ...preferred.quota, dimensions: preferred.quota.dimensions.map(d => ({ ...d, remaining: 0 })) } }
      : { ...preferred, availability: { ...preferred.availability, coolingUntilMs: NOW + 10_000 } };
    const result = plan(planInference(context(r, [unavailable, candidate(r, 'free-b', false, { reviewedPriority: 100 })]).input));
    expect(result.profileId).toBe('free-b');
    expect(result.rejected).toContainEqual({ profileId: 'free-a', reason: condition });
  });
  it.each([false, true])('keeps operational latency before priority for paid=%s', paid => {
    const r = request(); const preferred = candidate(r, paid ? 'paid-a' : 'free-a', paid, { reviewedPriority: 0 });
    const slower = { ...preferred, availability: { ...preferred.availability, predictedQueueMs: 100 } };
    const faster = candidate(r, paid ? 'paid-b' : 'free-b', paid, { reviewedPriority: 100 });
    expect(plan(planInference(context(r, [slower, faster]).input)).profileId).toBe(faster.profile.id);
  });
  it.each([
    ['capability', { capabilities: [] }], ['quality', { qualityApprovals: [] }], ['profile-ineligible', { status: 'disabled' }],
    ['privacy', { privacy: { ...candidate(request()).profile.privacy, training: 'permitted' } }],
  ] as const)('never trades %s eligibility for priority', (reason, overrides) => {
    const r = request(); const unsuitable = candidate(r, 'free-a', false, { reviewedPriority: 0, ...overrides });
    const result = plan(planInference(context(r, [unsuitable, candidate(r, 'free-b', false, { reviewedPriority: 100 })]).input));
    expect(result.profileId).toBe('free-b'); expect(result.rejected).toContainEqual({ profileId: 'free-a', reason });
  });
  it.each(['estimatedNanoUsd', 'ceilingNanoUsd'] as const)('keeps the paid %s minimum before priority', field => {
    const r = request(); const preferred = candidate(r, 'paid-a', true, { reviewedPriority: 0 });
    const other = candidate(r, 'paid-b', true, { reviewedPriority: 100 });
    const cheaper = { ...other, price: { ...other.price!, [field]: field === 'estimatedNanoUsd' ? 500_000_000 : 1_000_000_000 } };
    expect(plan(planInference(context(r, [preferred, cheaper]).input)).profileId).toBe('paid-b');
  });
  it('uses reviewed priority only when eligible paid costs and latency tie', () => {
    const r = request();
    expect(plan(planInference(context(r, [candidate(r, 'paid-a', true, { reviewedPriority: 100 }),
      candidate(r, 'paid-b', true, { reviewedPriority: 0 })]).input)).profileId).toBe('paid-b');
  });
  it('never lets preferred paid capacity precede eligible free capacity', () => {
    const r = request();
    expect(plan(planInference(context(r, [candidate(r, 'paid-a', true, { reviewedPriority: 0 }), candidate(r)]).input)).profileId).toBe('free-a');
  });
});

describe('free-first selection and shared paid authority', () => {
  it('uses eligible free capacity before any paid candidate, regardless of candidate order', () => {
    const r = request(); expect(plan(planInference(context(r, [candidate(r, 'paid-a', true), candidate(r)]).input)).profileId).toBe('free-a');
  });
  it('prefers free routes with more remaining bottleneck quota, not a serial failing chain', () => {
    const r = request(); const a = candidate(r); const b = candidate(r, 'free-b');
    const drained = { ...a, quota: { ...a.quota, dimensions: a.quota.dimensions.map(d => ({ ...d, remaining: 11 })) } };
    expect(plan(planInference(context(r, [drained, b]).input)).profileId).toBe('free-b');
  });
  it('skips exhausted and cooling free candidates, then selects cheapest compatible paid total', () => {
    const r = request(); const free = candidate(r); const a = candidate(r, 'paid-a', true); const b = candidate(r, 'paid-b', true);
    const input = context(r, [{ ...free, quota: { ...free.quota, dimensions: free.quota.dimensions.map(d => ({ ...d, remaining: 0 })) } },
      a, { ...b, price: { ...b.price!, estimatedNanoUsd: 500_000_000, ceilingNanoUsd: 1_000_000_000 } }]).input;
    const result = plan(planInference(input)); expect(result.profileId).toBe('paid-b');
    expect(result.budgetReservation?.amountNanoUsd).toBe(1_000_000_000);
    expect(result.mandatoryDispatchChecks).toContain('atomic-shared-budget-hold');
  });
  it('strict-free never permits paid, even with a valid budget', () => {
    const r = request({ mode: 'strict-free' }); rejected(planInference(context(r, [candidate(r, 'paid-a', true)]).input), 'strict-free');
  });
  it('paid cannot run without explicit scoped budget authorization', () => {
    const r = request(); const c = context(r, [candidate(r, 'paid-a', true)]); c.input.budget = undefined;
    rejected(planInference(c.input), 'budget');
  });
  it.each(['price-paid-a', 'budget-ref'])('paid fails closed without current %s', ref => {
    const r = request(); const c = context(r, [candidate(r, 'paid-a', true)]); c.records.delete(ref);
    expect(planInference(c.input).kind).toBe('blocked');
  });
  it.each(['unknown', 'stale', 'under-ceiling', 'wrong-currency', 'missing-charges'])('rejects %s price evidence', condition => {
    const r = request(); const p = candidate(r, 'paid-a', true); const c = context(r, [{ ...p, price: condition === 'unknown' ? undefined : {
      ...p.price!, ...(condition === 'under-ceiling' ? { ceilingNanoUsd: 1 } : {}),
      ...(condition === 'wrong-currency' ? { currency: 'EUR' as 'USD' } : {}),
      ...(condition === 'missing-charges' ? { coverage: 'tokens-only' as 'all-request-usage' } : {}),
    } }]);
    if (condition === 'stale') c.records.set('price-paid-a', { ...c.records.get('price-paid-a')!, expiresAtMs: NOW });
    rejected(planInference(c.input), 'price');
  });
  it.each(['principalId', 'tenantId', 'logicalRequestId', 'budgetScopeId', 'surface'] as const)('cannot borrow another budget %s', field => {
    const r = request(); const c = context(r, [candidate(r, 'paid-a', true)], { ...budget(r), [field]: 'other' });
    rejected(planInference(c.input), 'budget');
  });
  it('keeps funded builders separate from the new aggregate fallback pool', () => {
    const r = request({ surface: 'builder', budgetScopeId: 'funded-builder-wallet' });
    const c = context(r, [candidate(r, 'paid-a', true)], { ...budget(r), budgetScopeId: 'new-free-first-aggregate' });
    rejected(planInference(c.input), 'budget');
  });
  it.each(['maxAttemptNanoUsd', 'remainingLogicalRequestNanoUsd', 'remainingPeriodNanoUsd'] as const)('honors %s using conservative ceiling, not estimated cost', field => {
    const r = request(); rejected(planInference(context(r, [candidate(r, 'paid-a', true)], { ...budget(r), [field]: 1_999_999_999 }).input), 'budget');
  });
  it('does not extend budget authority past its period', () => {
    const r = request(); rejected(planInference(context(r, [candidate(r, 'paid-a', true)], { ...budget(r), periodEndsAtMs: NOW }).input), 'budget');
  });
  it('simulates one $10 aggregate pool across alternating paid providers with no per-provider reset', () => {
    let remaining = 10_000_000_000;
    for (let i = 0; i < 6; i++) {
      const r = request({ logicalRequestId: `request-${i}`, nextPhysicalAttemptId: `attempt-${i}` });
      const p = candidate(r, i % 2 ? 'paid-a' : 'paid-b', true);
      const result = planInference(context(r, [p], { ...budget(r), remainingPeriodNanoUsd: remaining }).input);
      if (i < 5) {
        const hold = plan(result).budgetReservation!;
        expect(hold.budgetScopeId).toBe('new-free-first-aggregate');
        expect(hold.periodId).toBe('IST-2026-10-23'); remaining -= hold.amountNanoUsd;
      } else rejected(result, 'budget');
    }
    expect(remaining).toBe(0); // Simulation only; production atomic persistence is still mandatory.
  });
});

describe('tenant, quota and lifecycle boundaries', () => {
  it.each(['developer-api', 'published-app'] as const)('preserves tenant-owned %s routing without platform substitution', surface => {
    const r = request({ surface, payer: { kind: 'tenant', ownerId: 'tenant-account', tenantId: 'tenant-1' } });
    expect(plan(planInference(context(r).input)).payer.kind).toBe('tenant');
    const c = candidate(r); rejected(planInference(context(r, [{ ...c, profile: { ...c.profile,
      credentialOwner: { kind: 'platform', ownerId: 'platform-owner' } } }]).input), 'payer');
  });
  it('does not introduce tenant BYOK into AgentV3', () => {
    const r = request({ surface: 'builder', payer: { kind: 'tenant', ownerId: 'tenant-account', tenantId: 'tenant-1' } });
    expect(planInference(context(r).input)).toMatchObject({ kind: 'blocked', reason: 'payer' });
  });
  it('rejects cross-tenant credential ownership', () => {
    const r = request({ surface: 'developer-api', payer: { kind: 'tenant', ownerId: 'tenant-account', tenantId: 'tenant-1' } });
    const c = candidate(r); rejected(planInference(context(r, [{ ...c, profile: { ...c.profile,
      credentialOwner: { kind: 'tenant', ownerId: 'tenant-account', tenantId: 'tenant-2' } } }]).input), 'payer');
  });
  it('reserves every overlapping quota dimension and shares organization keys across models/credentials', () => {
    const r = request(); const a = candidate(r); const b = candidate(r, 'free-b');
    const pa = plan(planInference(context(r, [a]).input)); const pb = plan(planInference(context(r, [b]).input));
    expect(pa.quotaReservations).toHaveLength(2); expect(pa.quotaReservations[0].ledgerKey).toBe(pb.quotaReservations[0].ledgerKey);
    expect(pa.quotaReservations[0].ledgerKey).toBe(quotaLedgerKey(a.profile.quotaDimensions[0]));
  });
  it.each(['missing', 'duplicate', 'exhausted', 'negative', 'wrong-provider'])('rejects %s quota dimensions', condition => {
    const r = request(); const c = candidate(r); let dims = [...c.quota.dimensions];
    if (condition === 'missing') dims.pop();
    if (condition === 'duplicate') dims.push(dims[0]);
    if (condition === 'exhausted') dims[0] = { ...dims[0], remaining: 9 };
    if (condition === 'negative') dims[0] = { ...dims[0], required: -1 };
    if (condition === 'wrong-provider') dims[0] = { ...dims[0], scope: { ...dims[0].scope, providerId: 'other' } };
    rejected(planInference(context(r, [{ ...c, quota: { ...c.quota, dimensions: dims } }]).input), 'quota');
  });
  it('rejects known provider cooldown without dispatch', () => {
    const r = request(); const c = candidate(r); rejected(planInference(context(r, [{ ...c,
      availability: { ...c.availability, coolingUntilMs: NOW + 1 } }]).input), 'cooldown');
  });
  it('honors ordinary chat five-second queue without resetting it on replanning', () => {
    const r = request(); const c = candidate(r); const x = context(r, [{ ...c,
      availability: { ...c.availability, predictedQueueMs: 5001 } }]); rejected(planInference(x.input), 'deadline');
    x.input.candidates = [{ ...c, availability: { ...c.availability, predictedQueueMs: 4000 } }]; x.seal();
    expect(plan(planInference(x.input)).queueUntilMs).toBe(NOW + 5000);
    x.input.nowMs = NOW + 2000; rejected(planInference(x.input), 'deadline');
  });
  it('does not apply chat queue/session timing defaults to voice', () => {
    const r = request({ capability: requests[3], maxQueueWaitMs: 15_000, firstOutputTimeoutMs: 3000, attemptTimeoutMs: 70_000 });
    const c = candidate(r); const result = plan(planInference(context(r, [{ ...c,
      availability: { ...c.availability, predictedQueueMs: 6000 } }]).input));
    expect(result.queueUntilMs).toBe(NOW + 15_000); expect(result.attemptTimeoutMs).toBe(70_000);
  });
  it.each(['first-output', 'completion', 'absolute'])('rejects an impossible %s deadline', condition => {
    const r = request(condition === 'absolute' ? { deadlineAtMs: NOW + 100 } : {}); const c = candidate(r);
    rejected(planInference(context(r, [{ ...c, availability: { ...c.availability,
      ...(condition === 'first-output' ? { predictedFirstOutputMs: 1001 } : {}),
      ...(condition === 'completion' ? { predictedCompletionMs: 90_001 } : {}),
    } }]).input), 'deadline');
  });
  it.each([
    { cancellation: { id: 'cancel-1', cancelled: true }, reason: 'cancelled' },
    { outputVisible: true, reason: 'output-visible' },
    { attempts: [{ physicalAttemptId: 'prior', profileId: 'free-a', outcome: 'uncertain', outputVisible: false }], reason: 'uncertain-outcome' },
    { attempts: [{ physicalAttemptId: 'prior', profileId: 'free-a', outcome: 'completed', outputVisible: false }], reason: 'already-completed' },
    { attempts: [{ physicalAttemptId: 'prior', profileId: 'free-a', outcome: 'definite-failure', failureClass: 'retryable-provider-failure', outputVisible: true }], reason: 'output-visible' },
  ] as const)('stops on $reason instead of falling back', ({ reason, ...overrides }) => {
    const r = request(overrides); expect(planInference(context(r).input)).toMatchObject({ kind: 'blocked', reason });
  });
  it('bounds physical attempts across all providers and never reuses an attempt ID', () => {
    const attempts = Array.from({ length: 4 }, (_, i) => ({ physicalAttemptId: `prior-${i}`, profileId: `profile-${i}`,
      outcome: 'definite-failure' as const, failureClass: 'retryable-provider-failure' as const, outputVisible: false }));
    const r = request({ attempts }); expect(planInference(context(r).input)).toMatchObject({ kind: 'blocked', reason: 'attempt-limit' });
    const reused = request({ attempts: attempts.slice(0, 1), nextPhysicalAttemptId: 'prior-0' });
    expect(planInference(context(reused).input)).toMatchObject({ kind: 'blocked', reason: 'malformed' });
  });
  it.each([NaN, Infinity, -1, 0, 5])('rejects invalid or unbounded attempt limit %s', maxPhysicalAttempts => {
    const r = request({ maxPhysicalAttempts });
    // Non-finite input cannot even receive a valid canonical evidence binding.
    if (!Number.isFinite(maxPhysicalAttempts)) {
      const c = context(); c.input.request = r; expect(planInference(c.input).kind).toBe('blocked');
    } else expect(planInference(context(r).input).kind).toBe('blocked');
  });
});

describe('additional admission regressions', () => {
  it.each(requests)('paid $kind requires its own total-usage quote and same aggregate hold', capability => {
    const r = request({ capability }); const result = plan(planInference(context(r, [candidate(r, 'paid-a', true)]).input));
    expect(result.budgetReservation).toMatchObject({ budgetScopeId: 'new-free-first-aggregate', amountNanoUsd: 2_000_000_000 });
    expect(result.capabilityKind).toBe(capability.kind);
  });
  it('rejects missing terms approval, disabled profiles and unknown charging', () => {
    const r = request(); const c = candidate(r);
    for (const profile of [{ ...c.profile, termsApprovals: [] }, { ...c.profile, status: 'disabled' as const },
      { ...c.profile, charging: 'unknown' as const }]) {
      rejected(planInference(context(r, [{ ...c, profile }]).input), 'profile-ineligible');
    }
  });
  it('cannot choose a cheaper paid candidate below the required quality gate', () => {
    const r = request({ surface: 'builder', quality: { tier: 'strong', gateId: 'builder-gate', gateVersion: '4' } });
    const a = candidate(r, 'paid-a', true); const b = candidate(r, 'paid-b', true);
    const result = plan(planInference(context(r, [a, { ...b, profile: { ...b.profile,
      qualityApprovals: [{ ...r.quality, tier: 'weak' }] }, price: { ...b.price!, estimatedNanoUsd: 1, ceilingNanoUsd: 1 } }]).input));
    expect(result.profileId).toBe('paid-a'); expect(result.rejected).toContainEqual({ profileId: 'paid-b', reason: 'quality' });
  });
  it('cannot increase a period remaining amount beyond the authorized total limit', () => {
    const r = request(); rejected(planInference(context(r, [candidate(r, 'paid-a', true)], {
      ...budget(r), remainingPeriodNanoUsd: 10_000_000_001,
    }).input), 'budget');
  });
  it('replans after a definite 8-second failure using remaining cumulative queue allowance', () => {
    const now = NOW + 8000;
    const r = request({ nextPhysicalAttemptId: 'physical-2', queueEnteredAtMs: now, queueWaitConsumedMs: 1000,
      attempts: [{ physicalAttemptId: 'physical-1', profileId: 'free-a', outcome: 'definite-failure', failureClass: 'retryable-provider-failure', outputVisible: false }] });
    const c = candidate(r, 'free-b'); const x = context(r, [{ ...c, availability: { ...c.availability, predictedQueueMs: 4000 } }]);
    x.input.nowMs = now;
    const result = plan(planInference(x.input)); expect(result.queueUntilMs).toBe(NOW + 12_000);
    expect(result.deadlineAtMs).toBe(r.deadlineAtMs); expect(result.remainingPhysicalAttempts).toBe(2);
    x.input.candidates = [{ ...c, availability: { ...c.availability, predictedQueueMs: 4001 } }]; x.seal();
    rejected(planInference(x.input), 'deadline');
  });
  it('does not grant fresh queue time after consuming the entire allowance', () => {
    const r = request({ queueWaitConsumedMs: 5000 }); const c = candidate(r);
    rejected(planInference(context(r, [{ ...c, availability: { ...c.availability, predictedQueueMs: 1 } }]).input), 'deadline');
    expect(planInference(context(request({ queueWaitConsumedMs: 5001 })).input).kind).toBe('blocked');
  });
  it('blocks expired absolute deadlines even when a new queue interval would fit', () => {
    const r = request({ deadlineAtMs: NOW }); expect(planInference(context(r).input)).toMatchObject({ kind: 'blocked', reason: 'deadline' });
  });
  it('does not mint extra quota capacity by presenting 25 alternate profile/key routes', () => {
    const r = request(); const candidates = Array.from({ length: 25 }, (_, i) => {
      const c = candidate(r, `free-profile-${i}`);
      return { ...c, quota: { ...c.quota, dimensions: c.quota.dimensions.map(d => ({ ...d, remaining: 0 })) } };
    });
    const result = planInference(context(r, candidates).input);
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.rejected).toHaveLength(25);
    expect(new Set(candidates.map(c => quotaLedgerKey(c.profile.quotaDimensions[0]))).size).toBe(1);
  });
  it('ties are stable across input order without mutating the candidate list', () => {
    const r = request(); const a = candidate(r, 'free-a'); const b = candidate(r, 'free-b');
    expect(plan(planInference(context(r, [a, b]).input)).profileId).toBe('free-a');
    expect(plan(planInference(context(r, [b, a]).input)).profileId).toBe('free-a');
  });
  it('rejects duplicate profile identities rather than multiplying their capacity', () => {
    const r = request(); const a = candidate(r);
    expect(planInference(context(r, [a, a]).input)).toMatchObject({ kind: 'blocked', reason: 'malformed' });
  });
  it('rejects malformed runtime data without throwing or selecting a fallback', () => {
    const c = context();
    expect(planInference({ ...c.input, request: null } as unknown as PlanningInput)).toMatchObject({ kind: 'blocked', reason: 'malformed' });
    expect(planInference({ ...c.input, candidates: null } as unknown as PlanningInput)).toMatchObject({ kind: 'blocked', reason: 'malformed' });
    expect(planInference({ ...c.input, candidates: [{ profile: null }] } as unknown as PlanningInput).kind).toBe('blocked');
  });
});

describe('cross-profile evidence replay', () => {
  it.each([{ version: 'v2' }, { modelRevision: 'replaced-without-version-bump' }, { adapterId: 'different-adapter' }])(
    'rejects signed old quota/availability when only the profile is updated: %j', change => {
      const c = context(); const old = c.input.candidates[0]; const profile = { ...old.profile, ...change };
      c.input.candidates = [{ ...old, profile }];
      c.records.set(profile.evidenceRef, { ...c.records.get(profile.evidenceRef)!, binding: evidenceBinding(withoutEvidence(profile)) });
      rejected(planInference(c.input), 'evidence');
    },
  );
});

describe('terminal safety and contradictory accounting regressions', () => {
  it.each(['safety-refusal', 'policy-denied', 'invalid-request'])('never hops after a pre-text %s', failureClass => {
    const r = request({ nextPhysicalAttemptId: 'physical-2', attempts: [{ physicalAttemptId: 'physical-1', profileId: 'free-a',
      outcome: 'definite-failure', outputVisible: false, failureClass }] as unknown as RoutingRequest['attempts'] });
    expect(planInference(context(r, [candidate(r, 'free-b')]).input)).toMatchObject({ kind: 'blocked', reason: 'terminal-failure' });
  });
  it.each(['positive', 'stale', 'malformed', 'zero'])('quarantines a free profile with a %s paid quote, even in strict-free', condition => {
    const r = request({ mode: 'strict-free' }); const p = candidate(r, 'free-a', true);
    const c = context(r, [{ ...p, profile: { ...p.profile, charging: 'verified-free-no-overage' }, price: { ...p.price!,
      ...(condition === 'malformed' ? { currency: 'EUR' as 'USD' } : {}),
      ...(condition === 'zero' ? { ceilingNanoUsd: 0, estimatedNanoUsd: 0 } : {}),
    } }]);
    if (condition === 'stale') c.records.set('price-free-a', { ...c.records.get('price-free-a')!, expiresAtMs: NOW });
    rejected(planInference(c.input), 'price');
  });
});
