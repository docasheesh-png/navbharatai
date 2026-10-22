import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const stubs = vi.hoisted(() => ({ free: vi.fn(), available: vi.fn(), legacy: vi.fn() }));
vi.mock('../src/server/AI/LiveRegistry/runtime', () => ({ strictFreeText: stubs.free }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: stubs.available }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import { runWithInferenceScope } from '../src/server/AI/inferencePolicy';
const env = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks(); process.env.STRICT_FREE_MODULES_ENABLED = 'true';
  stubs.free.mockResolvedValue({ content: 'verified free', model: 'example:free', provider: 'OPENROUTER', latencyMs: 1 });
  stubs.legacy.mockResolvedValue({ content: 'existing paid', model: 'existing', provider: 'GROK', latencyMs: 1 });
});
afterEach(() => { process.env = { ...env }; });
function router() {
  const r = new AIRouter('test');
  r.registerProvider({ name: 'GROK', priority: 1, execute: stubs.legacy, healthCheck: async () => true } as any);
  return r;
}
describe('central router strict-free interception', () => {
  it.each(['route', 'routeRaced'] as const)('%s invokes verified dispatcher, never registered paid providers', async (method) => {
    const result = await runWithInferenceScope('free-modules', () => router()[method]('prompt', 'system'));
    expect(result.response.content).toBe('verified free');
    expect(stubs.free).toHaveBeenCalledOnce(); expect(stubs.legacy).not.toHaveBeenCalled();
  });
  it('does not enter the paid chain on registry failure', async () => {
    stubs.free.mockRejectedValueOnce(new Error('registry unavailable'));
    await expect(runWithInferenceScope('free-modules', () => router().routeRaced('prompt'))).rejects.toThrow('registry unavailable');
    expect(stubs.legacy).not.toHaveBeenCalled();
  });
  it('passes streaming and cancellation through without racing a paid model', async () => {
    const onChunk = vi.fn(); const signal = new AbortController().signal;
    const result = await runWithInferenceScope('free-modules', () => router().routeStream('prompt', 'system', onChunk, signal));
    expect(stubs.free).toHaveBeenCalledWith({ prompt: 'prompt', systemPrompt: 'system', onChunk, signal });
    expect(result.raced).toBe(false); expect(stubs.legacy).not.toHaveBeenCalled();
  });
  it.each([
    (r: AIRouter) => r.route('prompt', 'system', ['data:image/png;base64,AA==']),
    (r: AIRouter) => r.route('prompt', 'system', undefined, 'paid-model'),
    (r: AIRouter) => r.generate('prompt', { type: 'object' }),
  ])('rejects unsupported options rather than silently discarding requirements', async (call) => {
    await expect(runWithInferenceScope('free-modules', () => call(router()))).rejects.toThrow('No paid fallback');
    expect(stubs.free).not.toHaveBeenCalled(); expect(stubs.legacy).not.toHaveBeenCalled();
  });
  it('preserves Normal/Strong existing provider execution under the module flag', async () => {
    const result = await runWithInferenceScope('paid-builder', () => router().route('prompt'));
    expect(result.response.content).toBe('existing paid');
    expect(stubs.free).not.toHaveBeenCalled(); expect(stubs.legacy).toHaveBeenCalledOnce();
  });
  it('flag off restores the existing provider chain', async () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'false';
    const result = await runWithInferenceScope('free-modules', () => router().route('prompt'));
    expect(result.response.content).toBe('existing paid');
    expect(stubs.free).not.toHaveBeenCalled();
  });
});
