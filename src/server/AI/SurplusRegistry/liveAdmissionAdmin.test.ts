import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: mocks.db }));
vi.mock('./sync', () => ({ syncSurplusMetadata: vi.fn() }));
import {
  APPROVE_OBSERVED_CONFIRM,
  approveObservedSurplusModels,
  readSurplusObservations,
  SURPLUS_REVIEWS_DOC,
} from './runtime';

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

function offer(now: number, model = 'model-a', providerId = 'provider-a') {
  return {
    model, offerId: `offer-${model}`, providerId, available: true, healthy: true, trusted: true,
    providerTrustConfirmed: true, trustObservedAt: now, discountPct: 90,
    rates: { input: '10', output: '20', cacheRead: '1', cacheWrite: '1', reasoning: '1' },
    referenceRates: { input: '100', output: '200', cacheRead: '10', cacheWrite: '10', reasoning: '10' },
    unit: 'unverified' as const, observedAt: now, upstreamGeneratedAt: null, sourceDate: now,
    sourceAgeSeconds: null, cacheMaxAgeSeconds: 300,
    sourceUrl: `https://api.surplusintelligence.ai/api/markets/${model}`,
  };
}

function mockDocs(docs: Map<string, unknown>) {
  mocks.db.mockReturnValue({
    doc: (path: string) => ({
      get: async () => ({ data: () => docs.get(path), exists: docs.has(path) }),
      set: async (value: unknown) => { docs.set(path, value); },
    }),
  });
}

describe('admin manager live admission overlay', () => {
  it('shows coding quality reviewed via live synthesis when key + builder flag are on', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true');
    vi.stubEnv('SURPLUS_REGISTRY_MODELS', 'model-a');
    vi.stubEnv('AGENTV3_SURPLUS_BUILDER', 'true');
    vi.stubEnv('SURPLUS_API_KEY', 'inf_testkey_for_live_admission_overlay');
    const now = Date.now();
    const snapshot = {
      version: 'version-a', startedAt: now, observedAt: now, expiresAt: now + 300000,
      models: ['model-a'], offers: [offer(now)],
    };
    const docs = new Map<string, unknown>([
      ['live_ai_registry/surplus-metadata', {
        snapshot, lastAttemptAt: now, lastSuccessAt: now, nextAllowedAt: now + 300000,
        controls: { revision: 1, disabledModels: [], updatedAt: now, reason: 'Initial controls revision' },
      }],
      [SURPLUS_REVIEWS_DOC, { reviews: { quality: [], pricingContract: null, accountAndPrivacyReviewedUntil: 0 } }],
    ]);
    mockDocs(docs);
    const view = await readSurplusObservations();
    expect(view.liveBuilderAdmission).toBe(true);
    expect(view.qualitySource).toBe('live_synthesis');
    expect(view.canDispatch).toBe(false);
    expect(view.models[0]).toMatchObject({ modelId: 'model-a', qualityReviewStatus: 'reviewed' });
    expect(view.models[0].blockedReasons).not.toContain('coding_quality_unreviewed');
    expect(view.models[0].blockedReasons).not.toContain('request_time_floor_contract_not_reviewed');
    expect(view.limitations.some(l => /Live builder admission is ACTIVE/i.test(l))).toBe(true);
  });

  it('stays unreviewed from empty Firestore when live builder is off', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true');
    vi.stubEnv('SURPLUS_REGISTRY_MODELS', 'model-a');
    vi.stubEnv('AGENTV3_SURPLUS_BUILDER', 'false');
    const now = Date.now();
    const snapshot = {
      version: 'version-a', startedAt: now, observedAt: now, expiresAt: now + 300000,
      models: ['model-a'], offers: [offer(now)],
    };
    mockDocs(new Map([
      ['live_ai_registry/surplus-metadata', {
        snapshot, lastAttemptAt: now, lastSuccessAt: now, nextAllowedAt: now + 300000,
        controls: { revision: 1, disabledModels: [], updatedAt: now, reason: 'Initial controls revision' },
      }],
      [SURPLUS_REVIEWS_DOC, { reviews: { quality: [], pricingContract: null, accountAndPrivacyReviewedUntil: 0 } }],
    ]));
    const view = await readSurplusObservations();
    expect(view.liveBuilderAdmission).toBe(false);
    expect(view.qualitySource).toBe('none');
    expect(view.models[0].qualityReviewStatus).toBe('unreviewed');
    expect(view.models[0].blockedReasons).toContain('coding_quality_unreviewed');
  });
});

describe('approveObservedSurplusModels', () => {
  it('persists durable coding approval for healthy observed offers', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true');
    vi.stubEnv('SURPLUS_REGISTRY_MODELS', 'model-a');
    const now = Date.now();
    const snapshot = {
      version: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', startedAt: now, observedAt: now, expiresAt: now + 300000,
      models: ['model-a'], offers: [offer(now)],
    };
    const docs = new Map<string, unknown>([
      ['live_ai_registry/surplus-metadata', {
        snapshot, lastAttemptAt: now, lastSuccessAt: now, nextAllowedAt: now + 300000,
        controls: { revision: 1, disabledModels: [], updatedAt: now, reason: 'Initial controls revision' },
      }],
    ]);
    mockDocs(docs);
    const result = await approveObservedSurplusModels({
      reason: 'Owner approved observed Surplus coding offers for Weak builds',
      confirm: APPROVE_OBSERVED_CONFIRM,
    });
    expect(result.approvedModels).toEqual(['model-a']);
    expect(result.offerPairs).toBe(1);
    expect(result.qualitySource).toBe('firestore');
    const saved = docs.get(SURPLUS_REVIEWS_DOC) as { reviews: { quality: unknown[] }; floorContract: { kind: string }; approvalSource: string };
    expect(saved.approvalSource).toBe('admin-approve-observed');
    expect(saved.floorContract.kind).toBe('observation-only-provider-request-time-floor');
    expect(saved.reviews.quality).toHaveLength(1);
    const view = await readSurplusObservations();
    expect(view.qualitySource).toBe('firestore');
    expect(view.models[0].qualityReviewStatus).toBe('reviewed');
    expect(view.models[0].blockedReasons).not.toContain('coding_quality_unreviewed');
  });

  it('rejects wrong confirm token and short reason before writes', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true');
    vi.stubEnv('SURPLUS_REGISTRY_MODELS', 'model-a');
    mocks.db.mockReturnValue({ doc: () => ({ get: async () => ({ data: () => ({}) }), set: async () => { throw new Error('should-not-write'); } }) });
    await expect(approveObservedSurplusModels({ reason: 'long enough reason here', confirm: 'nope' }))
      .rejects.toThrow('INVALID_APPROVE_CONFIRM');
    await expect(approveObservedSurplusModels({ reason: 'short', confirm: APPROVE_OBSERVED_CONFIRM }))
      .rejects.toThrow('INVALID_APPROVE_REASON');
  });
});
