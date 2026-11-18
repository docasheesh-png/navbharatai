import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ create: vi.fn(), calls: [] as string[] }));
vi.mock('openai', () => ({ default: class {
  chat: { completions: { create: (body: any, options?: any) => Promise<any> } };
  constructor(options: { apiKey: string }) {
    this.chat = { completions: { create: (body, opts) => {
      sdk.calls.push(options.apiKey);
      return sdk.create(options.apiKey, body, opts);
    } } };
  }
} }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync() {}, write: async () => {} } }));
vi.mock('../src/server/lib/vertexGenAI', () => ({ vertexGenAI: () => null }));
vi.mock('../src/server/AI/InferenceGateway/runtime', () => ({
  maybeGatewayText: async () => null, maybeGatewayVision: async () => null, isGatewayRouteSelected: () => false,
  InferenceGatewayTerminalError: class extends Error {},
}));
import { runVisionChain } from '../src/server/lib/visionChain';
import { GlmProvider } from '../src/server/AI/Router/providers/GlmProvider';
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
import { _resetKeyPoolCursors, nextPoolKey } from '../src/server/lib/keyPool';
import { _trafficRow, noteProviderCall, trafficProviderViews } from '../src/server/AI/ProviderHealth/trafficHealth';
const IMAGE = [{ name: 'picture.png', type: 'image/png', base64: 'c3ludGhldGlj' }];
const options = { prompt: 'describe', allowClaude: false };
const suspended = () => new Error('429 account suspended due to insufficient balance');
const sample = (provider: string, ok: boolean) => noteProviderCall({ provider, surface: 'builder', ok, ...(ok ? {} : { error: suspended() }) });
const answer = (text: string) => ({ choices: [{ message: { content: text } }] });
beforeEach(() => {
  _resetKeyPoolCursors(); resetAllBreakers(); sdk.calls.length = 0; sdk.create.mockReset();
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off');
  vi.stubEnv('GLM_API_KEY', 'primary,secondary'); vi.stubEnv('VISION_GLM_MODELS', 'glm-4.6v-flash');
  for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) vi.stubEnv(name, '');
  sdk.create.mockImplementation(async (key, body) => body.stream
    ? { [Symbol.asyncIterator]: async function* () { yield { choices: [{ delta: { content: key } }] }; } }
    : answer(key));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('pool account health is attributed to the dispatched credential', () => {
  it('a suspended primary cannot block funded vision or be cleared by its secondary success', async () => {
    sample('GLM', false);
    expect(await runVisionChain(IMAGE, options)).toMatchObject({ provider: 'GLM', text: 'secondary' });
    expect(sdk.calls).toEqual(['secondary']);
    expect(_trafficRow('GLM')?.state).toBe('suspended');
    expect(_trafficRow('GLM#2')?.state).toBe('up');
  });

  it('a real secondary vision failure records only that slot even though the rung returns null', async () => {
    sample('GLM', true); nextPoolKey(process.env.GLM_API_KEY);
    sdk.create.mockRejectedValue(suspended());
    expect(await runVisionChain(IMAGE, options)).toBeNull();
    expect(sdk.calls).toEqual(['secondary']);
    expect(_trafficRow('GLM#2')?.state).toBe('suspended');
    expect(_trafficRow('GLM')?.state).toBe('up');
  });

  it.each(['missing key', 'unsupported PDF'])('%s is not a failed provider call', async kind => {
    if (kind === 'missing key') vi.stubEnv('GLM_API_KEY', '');
    await runVisionChain(kind === 'unsupported PDF' ? [{ ...IMAGE[0], type: 'application/pdf' }] : IMAGE, options);
    expect(sdk.calls).toEqual([]);
    expect(trafficProviderViews().filter(row => row.provider.startsWith('GLM'))).toEqual([]);
  });

  it.each(['normal', 'stream'])('router %s dispatch lets the adapter select health by key, without a family outcome', async mode => {
    sample('GLM', false);
    const router = new AIRouter('pool-health'); router.registerProvider(new GlmProvider());
    if (mode === 'normal') expect((await router.route('hello')).response.content).toBe('secondary');
    else expect(await router.routeStream('hello', undefined, () => {})).toMatchObject({ ok: true, provider: 'GLM' });
    expect(sdk.calls).toEqual(['secondary']);
    expect(_trafficRow('GLM')?.state).toBe('suspended');
    const secondary = trafficProviderViews().find(row => row.provider === 'GLM#2');
    expect(secondary).toMatchObject({ state: 'up', samples: 1, inFlight: 0 });
  });

  it.each(['normal', 'stream'])('router %s failure cannot suspend an unused funded primary', async mode => {
    sample('GLM', true); nextPoolKey(process.env.GLM_API_KEY);
    sdk.create.mockRejectedValue(suspended());
    const router = new AIRouter('pool-health'); router.registerProvider(new GlmProvider());
    if (mode === 'normal') expect((await router.route('hello')).telemetry.success).toBe(false);
    else expect(await router.routeStream('hello', undefined, () => {})).toMatchObject({ ok: false });
    expect(sdk.calls).toEqual(['secondary']);
    expect(_trafficRow('GLM#2')?.state).toBe('suspended');
    expect(trafficProviderViews().find(row => row.provider === 'GLM')).toMatchObject({ state: 'up', samples: 1 });
  });

  it('a vision timeout keeps physical occupancy until transport settles and ignores its late success', async () => {
    vi.useFakeTimers();
    let complete!: (value: unknown) => void;
    sdk.create.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = runVisionChain(IMAGE, { ...options, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(15);
    expect(await pending).toBeNull();
    expect(trafficProviderViews().find(row => row.provider === 'GLM')).toMatchObject({ inFlight: 1, samples: 1, errorRate: { timeout: 1 } });
    complete(answer('late'));
    await Promise.resolve(); await Promise.resolve();
    expect(trafficProviderViews().find(row => row.provider === 'GLM')).toMatchObject({ inFlight: 0, samples: 1, errorRate: { timeout: 1 } });
  });
});
