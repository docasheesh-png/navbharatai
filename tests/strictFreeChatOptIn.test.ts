import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ chat: vi.fn(), route: vi.fn(), stream: vi.fn(), getRouter: vi.fn() }));
vi.mock('../src/server/AI/LiveRegistry/runtime', () => ({ strictFreeChat: mocks.chat }));
vi.mock('../src/server/AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: mocks.getRouter } }));
import { UniversalAIRouter } from '../src/server/AI/UniversalAIRouter';
import { runWithInferenceScope } from '../src/server/AI/inferencePolicy';
const old = process.env.STRICT_FREE_MODULES_ENABLED;
beforeEach(() => {
  vi.clearAllMocks(); process.env.STRICT_FREE_MODULES_ENABLED = 'true';
  mocks.getRouter.mockReturnValue({ route: mocks.route, routeStream: mocks.stream });
  mocks.route.mockResolvedValue({ response: { content: 'sequential', provider: 'OPENROUTER', model: 'free', latencyMs: 1 }, telemetry: { success: true } });
  mocks.stream.mockResolvedValue({ ok: true });
  mocks.chat.mockResolvedValue({ content: 'chat', provider: 'OPENROUTER', model: 'free', latencyMs: 1 });
});
afterEach(() => { if (old === undefined) delete process.env.STRICT_FREE_MODULES_ENABLED; else process.env.STRICT_FREE_MODULES_ENABLED = old; });
describe('only ordinary chat explicitly opts into two-model hedging', () => {
  it('explicit nonstream chat opt-in avoids constructing legacy clients', async () => {
    const result = await runWithInferenceScope('free-modules', () => new UniversalAIRouter().routeDetailed('hello', [], 'navbharat', undefined, 'system', true));
    expect(result.content).toBe('chat'); expect(mocks.chat).toHaveBeenCalledOnce(); expect(mocks.getRouter).not.toHaveBeenCalled();
  });
  it('helpers default to the sequential router even with the module flag on', async () => {
    const result = await runWithInferenceScope('free-modules', () => new UniversalAIRouter().routeDetailed('hello'));
    expect(result.content).toBe('sequential'); expect(mocks.chat).not.toHaveBeenCalled();
  });
  it('only explicit streaming chat opt-in forwards chunks and cancellation to hedge', async () => {
    const onChunk = vi.fn(); const signal = new AbortController().signal;
    await runWithInferenceScope('free-modules', () => new UniversalAIRouter().routeStream('hello', [], 'navbharat', 'system', onChunk, signal, true));
    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: 'system', onChunk, signal }));
    expect(mocks.getRouter).not.toHaveBeenCalled();
  });
  it('flag-off and paid builder never activate the free hedge', async () => {
    await runWithInferenceScope('paid-builder', () => new UniversalAIRouter().routeDetailed('hello', [], 'navbharat', undefined, undefined, true));
    process.env.STRICT_FREE_MODULES_ENABLED = 'false';
    await runWithInferenceScope('free-modules', () => new UniversalAIRouter().routeDetailed('hello', [], 'navbharat', undefined, undefined, true));
    expect(mocks.chat).not.toHaveBeenCalled(); expect(mocks.route).toHaveBeenCalledTimes(2);
  });
});
