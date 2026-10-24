import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: vi.fn(), sync: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: mocks.db }));
vi.mock('./sync', () => ({ syncSurplusMetadata: mocks.sync }));
import { controlSurplusModel, previewSurplusBuild, readSurplusObservations, refreshSurplusRegistry, surplusRegistryConfig } from './runtime';
import { SURPLUS_OBSERVATION_CANDIDATES } from './config';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('optional metadata runtime', () => {
  it('defaults OFF without reading credentials or database', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', '');
    expect(await refreshSurplusRegistry()).toEqual({ status: 'disabled' });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
    expect(await previewSurplusBuild({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 })).toMatchObject({ canDispatch: false, status: 'blocked' });
    expect(await readSurplusObservations()).toMatchObject({ status: 'disabled', canDispatch: false, observedCandidates: [] });
    await expect(controlSurplusModel('model-a', 'disable', 0, 'version-a', 'Disable for safety')).rejects.toThrow('REGISTRY_DISABLED');
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('fixes shared cadence to five minutes, including legacy interval overrides', () => {
    expect(surplusRegistryConfig({ SURPLUS_REGISTRY_INTERVAL_MS: '1' }).intervalMs).toBe(300000);
    expect(surplusRegistryConfig({ SURPLUS_REGISTRY_INTERVAL_MS: '600000' }).intervalMs).toBe(300000);
  });
  it('fails closed when enabled but durable store is unavailable', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true'); mocks.db.mockReturnValue(null);
    expect(await refreshSurplusRegistry()).toEqual({ status: 'unavailable' });
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});

describe('bounded observation candidate configuration', () => {
  it('defaults to fifteen catalog candidates without granting quality approval', () => {
    const config = surplusRegistryConfig({});
    expect(config.models).toEqual(SURPLUS_OBSERVATION_CANDIDATES);
    expect(config.models).toHaveLength(15);
    expect(config.enabled).toBe(false);
    expect(config.configurationError).toBeNull();
  });
  it.each(['', 'model-a,', 'model-a,model-a', '../escape', 'a/../b', 'a//b', 'model-a?key=secret', Array.from({ length: 16 }, (_, i) => `model-${i}`).join(',')])('rejects invalid configured universe before database/network %s', async models => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true'); vi.stubEnv('SURPLUS_REGISTRY_MODELS', models);
    expect(surplusRegistryConfig().configurationError).toBe('invalid_model_universe');
    expect(await refreshSurplusRegistry()).toEqual({ status: 'invalid_configuration' });
    expect(await readSurplusObservations()).toMatchObject({ status: 'invalid_configuration', models: [] });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('accepts a smaller explicit universe without expanding it silently', () => {
    expect(surplusRegistryConfig({ SURPLUS_REGISTRY_MODELS: 'model-a, model-b' }).models).toEqual(['model-a', 'model-b']);
  });
  it('reports persisted manager status without leaking review/account fields or polling', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true'); vi.stubEnv('SURPLUS_REGISTRY_MODELS', 'model-a');
    const now = Date.now();
    const snapshot = { version: 'version-a', startedAt: now, observedAt: now, expiresAt: now + 300000, models: ['model-a'], offers: [] };
    mocks.db.mockReturnValue({ doc: (path: string) => ({ get: async () => ({ data: () => path.endsWith('surplus-metadata')
      ? { snapshot, lastAttemptAt: now, lastSuccessAt: now, nextAllowedAt: now + 300000, controls: { revision: 1, disabledModels: ['model-a'], updatedAt: now, reason: 'Disabled for review' } }
      : { account: { credentialSha256: 'PRIVATE_ACCOUNT_HASH' }, reviews: { quality: [], pricingContract: null, accountAndPrivacyReviewedUntil: 0 } } }) }) });
    const view = await readSurplusObservations();
    expect(view).toMatchObject({ status: 'observed', version: 'version-a', controlRevision: 1, lastAttemptAt: now, lastSuccessAt: now, models: [{ modelId: 'model-a', disabled: true, qualityReviewStatus: 'unreviewed' }] });
    expect(view.models[0].blockedReasons).toContain('manually_disabled');
    expect(JSON.stringify(view)).not.toContain('PRIVATE_ACCOUNT_HASH');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('sanitizes durable database failures without claiming freshness', async () => {
    vi.stubEnv('SURPLUS_REGISTRY_ENABLED', 'true'); mocks.db.mockImplementation(() => { throw new Error('PRIVATE_STORAGE_DETAILS'); });
    expect(await refreshSurplusRegistry()).toEqual({ status: 'unavailable' });
    expect(await readSurplusObservations()).toMatchObject({ status: 'unavailable', fetchedAt: null, lastError: 'metadata_unavailable' });
    expect(await previewSurplusBuild({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 })).toMatchObject({ status: 'blocked', canDispatch: false });
  });
});
