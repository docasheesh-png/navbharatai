import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeModel } from './eligibility';
import { registryCredentialBinding } from './sync';
const mock = vi.hoisted(() => ({ state: {} as any, get: vi.fn(), doc: vi.fn(), fetch: vi.fn(), sync: vi.fn(), refresh: vi.fn() }));
vi.mock('../InferenceGateway/catalogRefresh', () => ({ refreshGatewayCatalog: mock.refresh }));
vi.mock('./sync', async original => ({ ...await original<typeof import('./sync')>(), RegistrySynchronizer: class { sync = mock.sync; } }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: () => ({ doc: mock.doc }) }));
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../../lib/audit', () => ({ audit: vi.fn() }));
vi.mock('./store', () => ({ FirestoreRegistryStore: class {
  async routingState() { return mock.state; }
  async read() { return mock.state; }
  async adminHistory() { return {}; }
  async imageState() { return {}; }
  async recheck() { return true; }
  async record() {}
  async updateHealth() {}
} }));
beforeEach(() => { vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'all');
  vi.resetModules(); vi.clearAllMocks(); mock.sync.mockResolvedValue({ status: 'synced', version: 'version' }); mock.refresh.mockResolvedValue({ status: 'updated', updatedProfiles: 1 });
  const now = Date.now(); const id = 'test/model:free'; const key = 'synthetic-account-key';
  vi.stubEnv('LIVE_MODEL_REGISTRY_ENABLED', 'true'); vi.stubEnv('OPENROUTER_API_KEY', key);
  const model = normalizeModel({ id, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, context_length: 8192 },
    { data: { id, endpoints: [{ model_id: id, tag: 'test/endpoint', pricing: { prompt: '0', completion: '0' }, context_length: 8192, supported_parameters: ['max_tokens'] }] } }, true, now, 600000, 'version');
  mock.state = { manifest: { version: 'version', accountVerified: true, expiresAt: now + 600000, accountCredentialBinding: registryCredentialBinding(key) }, models: [model],
    controls: { [id]: { disabled: false, termsReviewedUntil: now + 600000, endpointTag: 'test/endpoint' } }, health: {} };
  mock.doc.mockReturnValue({ get: mock.get }); mock.get.mockResolvedValue({ exists: false });
  mock.fetch.mockResolvedValue(new Response(JSON.stringify({ model: id, choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] })));
  vi.stubGlobal('fetch', mock.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('registry coexistence and metadata privacy', () => {
  it('does not expose private credential binding in the admin view', async () => {
    const runtime = await import('./runtime'); const result = await runtime.liveModelRegistryView();
    expect(result.manifest).not.toHaveProperty('accountCredentialBinding'); expect(mock.state.manifest.accountCredentialBinding).toBeDefined();
  });
  it.each([{}, { expiresAtMs: 0 }, { authority: 'invalid' }])('new gateway ownership metadata does not disable preserved legacy consumers', async value => {
    mock.get.mockResolvedValue({ exists: true, data: () => value });
    const runtime = await import('./runtime'); expect(await runtime.strictFreeText({ prompt: 'Hello' })).toMatchObject({ content: 'Hello' });
    expect(mock.doc).not.toHaveBeenCalled(); expect(mock.fetch).toHaveBeenCalledOnce();
  });
  it('no ownership record preserves normal legacy dispatch', async () => {
    const runtime = await import('./runtime'); expect(await runtime.strictFreeText({ prompt: 'Hello' })).toMatchObject({ content: 'Hello' });
    expect(mock.fetch).toHaveBeenCalledOnce();
  });
});

describe('selected gateway cannot escape through registry entry points', () => {
  it.each(['text', 'chat', 'tools'] as const)('blocks unclaimed nested %s with zero physical calls', async kind => {
    const runtime = await import('./runtime'); const { runWithGatewaySelection } = await import('../InferenceGateway/dispatchBoundary');
    const call = kind === 'text' ? () => runtime.strictFreeText({ prompt: 'Hello' }) : kind === 'chat'
      ? () => runtime.strictFreeChat({ prompt: 'Hello' }) : () => runtime.strictFreeToolTurn({ messages: [{ role: 'user', content: 'Hello' }] });
    await expect(runWithGatewaySelection(true, call)).rejects.toMatchObject({ code: 'INFERENCE_GATEWAY_TERMINAL' });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it('rejects copied hook lookalikes before any physical call', async () => {
    const runtime = await import('./runtime');
    await expect(runtime.strictFreeText({ prompt: 'Hello', maxAttempts: 1, gateway: { modelId: 'test/model:free', endpointTag: 'test/endpoint', registryVersion: 'version', authorizeDispatch: async () => true, assertDispatchPolicy: () => {}, beforeVisibleOutput: async () => {} } })).rejects.toMatchObject({ code: 'GATEWAY_AUTHORIZATION_REQUIRED' });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
});

describe('existing background/admin sync refreshes reviewed gateway entries', () => {
 it('refreshes the saved gateway catalog after a real synchronizer result', async () => {
   vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); mock.get.mockResolvedValue({ exists: true });
   const runtime = await import('./runtime'); expect(await runtime.syncLiveModels()).toMatchObject({ status: 'synced' });
   expect(mock.sync).toHaveBeenCalledOnce(); expect(mock.refresh).toHaveBeenCalledOnce();
   expect(mock.refresh.mock.calls[0][1]).toBe(mock.state);
 });
 it('does not create a catalog or renew approval when gateway setup is absent', async () => {
   vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on');
   const runtime = await import('./runtime'); await runtime.syncLiveModels(); expect(mock.refresh).not.toHaveBeenCalled();
 });
 it('keeps successful catalog sync separate from failed gateway refresh', async () => {
   vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on'); mock.get.mockResolvedValue({ exists: true }); mock.refresh.mockRejectedValue(new Error('unavailable'));
   const runtime = await import('./runtime'); expect(await runtime.syncLiveModels()).toMatchObject({ status: 'synced' });
   expect(mock.refresh).toHaveBeenCalledOnce();
 });
});
