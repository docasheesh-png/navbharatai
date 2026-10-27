/** Every concrete legacy adapter must pass cancellation to its SDK, not just inspect a flag. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ openai: vi.fn(), anthropic: vi.fn(), google: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: m.openai } }; } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: m.anthropic }; } }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: m.google }; } }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: async () => {} }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { GlmProvider } from '../src/server/AI/Router/providers/GlmProvider';
import { OpenAiChatProvider } from '../src/server/AI/Router/providers/OpenAiChatProvider';
import { GrokProvider } from '../src/server/AI/Router/providers/GrokProvider';
import { AnthropicProvider } from '../src/server/AI/Router/providers/AnthropicProvider';
import { GeminiProvider } from '../src/server/AI/Router/providers/GeminiProvider';
import { VertexProvider } from '../src/server/AI/Router/providers/VertexProvider';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';
import { cappedFreeTierRung, setFreeTierPaidStoreForTests } from '../src/server/lib/freeTierPaidCap';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); resetAllBreakers(); AIRouterManager.reset();
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off'); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off');
  vi.stubEnv('OPENAI_CHAT_MODEL', '');
  vi.stubEnv('GEMINI_API_KEY', 'offline-test-only'); vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'offline-test-project');
});
afterEach(() => { vi.unstubAllEnvs(); setFreeTierPaidStoreForTests(undefined); });
const cases = [
  ['GLM', () => new GlmProvider(), m.openai], ['OPENAI', () => new OpenAiChatProvider(), m.openai],
  ['GROK', () => new GrokProvider(), m.openai], ['ANTHROPIC', () => new AnthropicProvider(), m.anthropic],
  ['GEMINI', () => new GeminiProvider(), m.google], ['VERTEX', () => new VertexProvider(), m.google],
] as const;
describe('SDK abort wiring', () => {
  it.each(cases)('%s forwards caller abort to its actual SDK request', async (_name, make, sdk) => {
    let sdkSignal: AbortSignal | undefined; let release!: () => void;
    sdk.mockImplementation((payload: any, options: any) => new Promise((resolve, reject) => {
      sdkSignal = payload.config?.abortSignal ?? options?.signal;
      release = () => resolve({ choices: [{ message: { content: 'answer' } }], content: [{ type: 'text', text: 'answer' }], text: 'answer' });
      sdkSignal?.addEventListener('abort', () => reject(sdkSignal!.reason), { once: true });
    }));
    const controller = new AbortController();
    const provider: AIProvider = make();
    const schema = { type: 'OBJECT', properties: {} };
    const images = _name === 'GROK' || _name === 'ANTHROPIC' ? ['c3ludGhldGlj'] : undefined;
    const pending = provider.execute('hello', schema, 'offline-model', 'system', images, controller.signal).catch(error => error);
    await flush();
    expect.soft(sdkSignal).toBeInstanceOf(AbortSignal);
    const payload = sdk.mock.calls[0][0];
    expect(payload.model).toBe('offline-model');
    if (_name === 'GEMINI' || _name === 'VERTEX') expect(payload.config.systemInstruction).toBe('system');
    else if (_name === 'ANTHROPIC') { expect(payload.system).toBe('system'); expect(payload.messages[0].content[0].source.data).toBe(images![0]); }
    else { expect(payload.messages[0]).toEqual({ role: 'system', content: 'system' }); if (images) expect(payload.messages[1].content[1].image_url.url).toContain(images[0]); }
    if (_name === 'GEMINI') expect(payload.config.responseSchema).toEqual(schema);
    controller.abort(new Error('request disconnected')); release();
    const result = await pending;
    expect.soft(sdkSignal?.aborted).toBe(true);
    expect(result).toBeInstanceOf(Error);
    expect(sdk).toHaveBeenCalledOnce();
  });
  it('a pinned vision-capable model slot retains the images and parent cancellation', async () => {
    vi.stubEnv('GROK_API_KEY', 'offline-test-only');
    const controller = new AbortController();
    m.openai.mockResolvedValue({ choices: [{ message: { content: 'answer' } }] });
    const result = await AIRouterManager.getRouter('professional').route('read image', 'system', ['c3ludGhldGlj'], undefined, controller.signal);
    expect(result.telemetry.success).toBe(true);
    const [payload, options] = m.openai.mock.calls[0];
    expect(payload.model).toBe('grok-3'); expect(payload.messages[0].content).toBe('system');
    expect(payload.messages[1].content[1].image_url.url).toBe('data:image/png;base64,c3ludGhldGlj');
    expect(options.signal).toBe(controller.signal); expect(options.timeout).toBe(120_000);
  });
  it('Vertex cancellation interrupts rate-limit backoff without another SDK attempt', async () => {
    m.google.mockRejectedValue({ status: 429 });
    const controller = new AbortController();
    const pending = new VertexProvider().execute('hello', undefined, undefined, 'system', undefined, controller.signal).catch(error => error);
    await flush(); expect(m.google).toHaveBeenCalledOnce();
    controller.abort(new Error('caller left'));
    expect(await pending).toBeInstanceOf(Error); expect(m.google).toHaveBeenCalledOnce();
  });
  it.each(['execute', 'executeStream'] as const)('aborting during %s paid reservation prevents physical dispatch', async method => {
    let release!: (hold: any) => void;
    const reservePaid = vi.fn(() => new Promise<any>(resolve => { release = resolve; }));
    setFreeTierPaidStoreForTests({ reservePaid, settlePaid: vi.fn(async () => true) });
    const execute = vi.fn(); const executeStream = vi.fn();
    const base: AIProvider = { name: 'VERTEX', priority: 1, pinnedModel: 'gemini-2.5-flash', healthCheck: async () => true, execute, executeStream };
    const decorated = cappedFreeTierRung(base, 'free-chat');
    const controller = new AbortController();
    const pending = (method === 'execute' ? decorated.execute('hello', undefined, undefined, 'system', undefined, controller.signal)
      : decorated.executeStream!('hello', 'system', () => {}, undefined, controller.signal)).catch(error => error);
    await flush(); controller.abort(new Error('caller left'));
    release({ id: 'a'.repeat(64), day: '2026-10-26', uidHash: 'b'.repeat(64), maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
    expect(await pending).toBeInstanceOf(Error);
    expect(execute).not.toHaveBeenCalled(); expect(executeStream).not.toHaveBeenCalled();
  });
  it('the model slot and daily paid-cap decorator preserve signal and never start a fallback after abort', async () => {
    vi.stubEnv('GLM_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', '');
    const reservePaid = vi.fn(async (input: any) => ({ id: 'a'.repeat(64), day: '2026-10-26', uidHash: 'b'.repeat(64), maxCostNanoUsd: input.maxCostNanoUsd, createdAt: 0, mayDispatch: true }));
    setFreeTierPaidStoreForTests({ reservePaid, settlePaid: vi.fn(async () => true) });
    let sdkSignal: AbortSignal | undefined; let release!: () => void;
    m.google.mockImplementation((payload: any) => new Promise((resolve, reject) => {
      sdkSignal = payload.config?.abortSignal;
      release = () => resolve({ text: 'answer' });
      sdkSignal?.addEventListener('abort', () => reject(sdkSignal!.reason), { once: true });
    }));
    const controller = new AbortController();
    const pending = AIRouterManager.getRouter('free').route('hello', 'system', undefined, undefined, controller.signal).catch(error => error);
    await flush();
    expect(m.google).toHaveBeenCalledOnce();
    expect(m.google.mock.calls[0][0].model).toBe('gemini-2.5-flash-lite');
    controller.abort(new Error('request disconnected')); release();
    expect(await pending).toBeInstanceOf(Error);
    expect(sdkSignal?.aborted).toBe(true);
    expect(m.google).toHaveBeenCalledOnce(); expect(reservePaid).toHaveBeenCalledOnce();
  });
});
