import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ chain: vi.fn(), strict: vi.fn(), legacy: vi.fn(), stream: vi.fn(), getRouter: vi.fn() }));
vi.mock('../src/server/AI/FreeChain/runtime', () => ({ maybeFreeChain: mocks.chain }));
vi.mock('../src/server/AI/LiveRegistry/runtime', () => ({ strictFreeChat: mocks.strict }));
vi.mock('../src/server/AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: mocks.getRouter } }));

import { UniversalAIRouter } from '../src/server/AI/UniversalAIRouter';
import { runWithInferenceScope } from '../src/server/AI/inferencePolicy';
import type { FreeChainContext } from '../src/server/AI/FreeChain/rollout';

const context: FreeChainContext = { uid: 'verified-test-user', conversationKey: 'server-generated-key', privateTurn: false, healthTurn: false, cacheEligible: false };
const chainReply = { content: 'chain answer', provider: 'GROQ', model: 'approved-model', latencyMs: 3, usage: { inputTokens: 20, outputTokens: 4 }, ok: true, freeChain: { requestId: 'test', rung: 'groq', cacheHit: false } };
const history = [{ sender: 'user', text: 'earlier question' }, { sender: 'assistant', text: 'earlier answer' }];
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('FREE_CHAIN_ENABLED', 'on');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.getRouter.mockReturnValue({ route: mocks.legacy, routeStream: mocks.stream });
  mocks.legacy.mockResolvedValue({ response: { content: 'legacy answer', provider: 'GEMINI', model: 'legacy-model', latencyMs: 7 }, telemetry: { success: true, provider: 'GEMINI', latency: 7 } });
  mocks.stream.mockResolvedValue({ content: 'legacy stream', ok: true, provider: 'GEMINI', model: 'legacy-model', latencyMs: 7 });
  mocks.chain.mockResolvedValue(chainReply);
  mocks.strict.mockResolvedValue({ content: 'strict answer', provider: 'OPENROUTER', model: 'verified-free', latencyMs: 2 });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Free Chat Chain scope is ordinary chat plus explicit server context', () => {
  it('legacy nonstream callers without server context never activate the chain, even when enabled', async () => {
    const result = await new UniversalAIRouter().routeDetailed('hello');
    expect(result).toMatchObject({ content: 'legacy answer', ok: true, provider: 'GEMINI', model: 'legacy-model' });
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.getRouter).toHaveBeenCalledWith('free');
    expect(mocks.legacy).toHaveBeenCalledWith('hello', undefined);
  });

  it('legacy string-returning helper remains outside the new chain', async () => {
    expect(await new UniversalAIRouter().route('hello', history, 'navbharat', undefined, 'system')).toBe('legacy answer');
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.legacy).toHaveBeenCalledWith('User: earlier question\nAssistant: earlier answer\nUser: hello', 'system');
  });

  it('legacy streaming callers without server context preserve the signal and original router', async () => {
    const signal = new AbortController().signal; const onChunk = vi.fn();
    expect(await new UniversalAIRouter().routeStream('hello', history, 'navbharat', 'system', onChunk, signal)).toMatchObject({ content: 'legacy stream', ok: true });
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.stream).toHaveBeenCalledWith('User: earlier question\nAssistant: earlier answer\nUser: hello', 'system', onChunk, signal);
  });

  it('ordinary nonstream chat forwards complete server-owned context and real result telemetry', async () => {
    const signal = new AbortController().signal;
    const result = await new UniversalAIRouter().routeDetailed('hello', history, 'navbharat', undefined, 'system', false, signal, context);
    expect(mocks.chain).toHaveBeenCalledExactlyOnceWith({ message: 'hello', history, systemPrompt: 'system', signal, context });
    expect(result).toBe(chainReply);
    expect(mocks.getRouter).not.toHaveBeenCalled();
    expect(mocks.strict).not.toHaveBeenCalled();
  });

  it('ordinary streaming chat forwards the callback and cancellation without a second router call', async () => {
    const signal = new AbortController().signal; const onChunk = vi.fn();
    mocks.chain.mockImplementation(async input => { input.onChunk('chain answer'); return chainReply; });
    const result = await new UniversalAIRouter().routeStream('hello', history, 'navbharat', 'system', onChunk, signal, false, context);
    expect(mocks.chain).toHaveBeenCalledExactlyOnceWith({ message: 'hello', history, systemPrompt: 'system', signal, onChunk, context });
    expect(result).toBe(chainReply);
    expect(onChunk.mock.calls).toEqual([['chain answer']]);
    expect(mocks.getRouter).not.toHaveBeenCalled();
  });

  it.each(['free', 'sda', 'doctor', 'professional'] as const)('nonstream %s remains isolated even if passed chain-shaped context', async tier => {
    const result = await new UniversalAIRouter().routeDetailed('hello', [], tier, undefined, undefined, false, undefined, context);
    expect(result.content).toBe('legacy answer');
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.getRouter).toHaveBeenCalledWith(tier === 'free' ? 'free' : 'professional');
  });

  it.each(['free', 'sda', 'doctor', 'professional', 'weak', 'paid-builder'])('streaming %s never activates the ordinary-chat chain', async tier => {
    await new UniversalAIRouter().routeStream('hello', [], tier, undefined, vi.fn(), undefined, false, context);
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.stream).toHaveBeenCalledOnce();
  });

  it.each(['nonstream', 'stream'])('null admission leaves the %s legacy path unchanged', async mode => {
    mocks.chain.mockResolvedValue(null);
    const router = new UniversalAIRouter();
    const result = mode === 'stream'
      ? await router.routeStream('hello', [], 'navbharat', undefined, vi.fn(), undefined, false, context)
      : await router.routeDetailed('hello', [], 'navbharat', undefined, undefined, false, undefined, context);
    expect(result).toMatchObject({ ok: true, provider: 'GEMINI', model: 'legacy-model' });
    expect(mocks.chain).toHaveBeenCalledOnce();
    expect(mocks.getRouter).toHaveBeenCalledWith('free');
  });

  it.each(['nonstream', 'stream'])('an admitted exhausted %s chain cannot escape into a legacy paid fallback', async mode => {
    const exhausted = { ...chainReply, content: 'temporarily unavailable', ok: false, provider: 'NONE', model: 'none' };
    mocks.chain.mockResolvedValue(exhausted);
    const router = new UniversalAIRouter();
    const result = mode === 'stream'
      ? await router.routeStream('hello', [], 'navbharat', undefined, vi.fn(), undefined, false, context)
      : await router.routeDetailed('hello', [], 'navbharat', undefined, undefined, false, undefined, context);
    expect(result).toBe(exhausted);
    expect(mocks.getRouter).not.toHaveBeenCalled();
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it.each(['nonstream', 'stream'])('an unexpected %s chain failure cannot silently restart another spending path', async mode => {
    mocks.chain.mockRejectedValue(new Error('store unavailable'));
    const router = new UniversalAIRouter();
    const promise = mode === 'stream'
      ? router.routeStream('hello', [], 'navbharat', undefined, vi.fn(), undefined, false, context)
      : router.routeDetailed('hello', [], 'navbharat', undefined, undefined, false, undefined, context);
    await expect(promise).rejects.toThrow('store unavailable');
    expect(mocks.getRouter).not.toHaveBeenCalled();
  });

  it('strict-free explicit hedge behavior is preserved when chain admission declines', async () => {
    vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'on'); mocks.chain.mockResolvedValue(null);
    const signal = new AbortController().signal;
    const result = await runWithInferenceScope('free-modules', () => new UniversalAIRouter().routeDetailed('hello', [], 'navbharat', undefined, 'system', true, signal, context));
    expect(result).toMatchObject({ content: 'strict answer', provider: 'OPENROUTER', ok: true });
    expect(mocks.strict).toHaveBeenCalledWith({ prompt: 'hello', systemPrompt: 'system', signal });
    expect(mocks.getRouter).not.toHaveBeenCalled();
  });
});
