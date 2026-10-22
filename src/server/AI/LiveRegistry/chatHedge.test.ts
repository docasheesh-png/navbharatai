import { afterEach, describe, expect, it, vi } from 'vitest';
import { hedgeFreeChat, type SingleChatAttempt } from './chatHedge';
import { FreeRoutingError, type FreeTextResult } from './dispatcher';

type AttemptInput = Parameters<SingleChatAttempt>[0];
function result(model = 'test/first:free', content = 'Hello'): FreeTextResult {
  return { content, model, provider: 'OPENROUTER', toolCalls: [], finishReason: 'stop', latencyMs: 1, pricingProof: {} as FreeTextResult['pricingProof'] };
}
function harness() {
  const calls: { input: AttemptInput; resolve: (value: FreeTextResult) => void; reject: (error: unknown) => void }[] = [];
  const dispatch = vi.fn((input: AttemptInput) => new Promise<FreeTextResult>((resolve, reject) => {
    calls.push({ input, resolve, reject });
    // This models the dispatcher's required synchronous reservation of a model.
    const id = ['test/first:free', 'test/second:free'].find(candidate => !input.excludeModelIds.has(candidate));
    if (!id) { reject(new FreeRoutingError('NO_VERIFIED_FREE_MODEL')); return; }
    input.excludeModelIds.add(id);
  }));
  return { dispatch, calls };
}
const observe = (promise: Promise<FreeTextResult>) => promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('bounded verified-free chat hedging', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('starts only one request when useful text arrives before the hedge delay', async () => {
    vi.useFakeTimers(); const h = harness(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: text => chunks.push(text) }));
    await flush(); h.calls[0].input.onChunk?.('Hello');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.calls).toHaveLength(1);
    h.calls[0].resolve(result());
    expect((await done).value?.content).toBe('Hello');
    expect(chunks).toEqual(['Hello']); expect(vi.getTimerCount()).toBe(0);
  });
  it('delays the second attempt and shares the distinct-model exclusion set', async () => {
    vi.useFakeTimers(); const h = harness(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: t => chunks.push(t) }, { delayMs: 50 }));
    await vi.advanceTimersByTimeAsync(49); expect(h.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.calls).toHaveLength(2);
    expect(h.calls[0].input.excludeModelIds).toBe(h.calls[1].input.excludeModelIds);
    expect([...h.calls[1].input.excludeModelIds]).toEqual(['test/first:free', 'test/second:free']);
    expect(h.calls.every(c => c.input.maxAttempts === 1)).toBe(true);
    h.calls[1].input.onChunk?.('Second'); expect(h.calls[0].input.signal?.aborted).toBe(true);
    h.calls[0].input.onChunk?.('ignored'); h.calls[0].reject(new Error('Aborted'));
    h.calls[1].resolve(result('test/second:free', 'Second'));
    expect((await done).value?.model).toBe('test/second:free'); expect(chunks).toEqual(['Second']);
  });
  it('does not let whitespace or empty chunks win', async () => {
    vi.useFakeTimers(); const h = harness(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: t => chunks.push(t) }, { delayMs: 10 }));
    await flush(); h.calls[0].input.onChunk?.(''); h.calls[0].input.onChunk?.(' \n');
    await vi.advanceTimersByTimeAsync(10); expect(h.calls).toHaveLength(2); expect(chunks).toEqual([]);
    h.calls[1].input.onChunk?.('Good'); h.calls[1].resolve(result('test/second:free', 'Good'));
    expect((await done).value?.content).toBe('Good'); expect(chunks).toEqual(['Good']);
  });
  it('preserves leading whitespace for the eventual winner', async () => {
    vi.useFakeTimers(); const h = harness(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: t => chunks.push(t) }));
    await flush(); h.calls[0].input.onChunk?.('\n'); h.calls[0].input.onChunk?.('Hello'); h.calls[0].input.onChunk?.('!');
    h.calls[0].resolve(result('test/first:free', '\nHello!'));
    await done; expect(chunks).toEqual(['\nHello', '!']);
  });
  it('starts fallback immediately on pre-output failure, but never a third request', async () => {
    vi.useFakeTimers(); const h = harness(); const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi' }));
    await flush(); h.calls[0].reject(new Error('Unavailable')); await flush(); expect(h.calls).toHaveLength(2);
    h.calls[1].reject(new Error('Unavailable')); expect((await done).error.code).toBe('ALL_FREE_MODELS_FAILED');
    await vi.advanceTimersByTimeAsync(100000); expect(h.calls).toHaveLength(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('never swaps answers after winning text is delivered, even if the winner fails', async () => {
    vi.useFakeTimers(); const h = harness(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: t => chunks.push(t) }, { delayMs: 1 }));
    await vi.advanceTimersByTimeAsync(1); h.calls[0].input.onChunk?.('Partial');
    h.calls[1].input.onChunk?.('Different answer'); h.calls[1].resolve(result('test/second:free', 'Different answer'));
    h.calls[0].reject(new FreeRoutingError('PARTIAL_RESPONSE_INTERRUPTED'));
    expect((await done).error.code).toBe('PARTIAL_RESPONSE_INTERRUPTED'); expect(chunks).toEqual(['Partial']);
  });
  it('rejects empty completions without selecting them', async () => {
    vi.useFakeTimers(); const h = harness(); const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi' }));
    await flush(); h.calls[0].resolve(result('test/first:free', '  ')); await flush();
    expect(h.calls).toHaveLength(2); h.calls[1].resolve(result('test/second:free', 'Valid'));
    expect((await done).value?.content).toBe('Valid');
  });
  it('supports a completed valid response without delta callbacks', async () => {
    vi.useFakeTimers(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(async () => result(), { prompt: 'Hi', onChunk: t => chunks.push(t) }));
    await flush(); expect((await done).value?.content).toBe('Hello'); expect(chunks).toEqual(['Hello']);
  });
  it('rejects a pre-aborted caller before any dispatch', async () => {
    const abort = new AbortController(); abort.abort(); const dispatch = vi.fn();
    const done = await observe(hedgeFreeChat(dispatch, { prompt: 'Hi', signal: abort.signal }));
    expect(done.error.code).toBe('CHAT_ABORTED'); expect(dispatch).not.toHaveBeenCalled();
  });
  it('aborts both attempts and settles even if adapters ignore cancellation', async () => {
    vi.useFakeTimers(); const h = harness(); const abort = new AbortController();
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', signal: abort.signal }, { delayMs: 1 }));
    await vi.advanceTimersByTimeAsync(1); abort.abort();
    expect((await done).error.code).toBe('CHAT_ABORTED'); expect(h.calls.every(c => c.input.signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('enforces a whole-operation deadline before or after partial output', async () => {
    vi.useFakeTimers(); const h = harness(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: t => chunks.push(t) }, { delayMs: 1, timeoutMs: 10 }));
    await vi.advanceTimersByTimeAsync(2); h.calls[0].input.onChunk?.('Partial');
    await vi.advanceTimersByTimeAsync(8); expect((await done).error.code).toBe('CHAT_DEADLINE_EXCEEDED');
    expect(h.calls.every(c => c.input.signal?.aborted)).toBe(true); expect(chunks).toEqual(['Partial']);
  });
  it.each([400, 401, 402, 403, 413, 422])('does not hedge nonretryable %s errors', async status => {
    vi.useFakeTimers(); const dispatch = vi.fn(async () => { throw new FreeRoutingError(`HTTP_${status}`, status); });
    const done = observe(hedgeFreeChat(dispatch, { prompt: 'Hi' })); await flush();
    expect((await done).error.status).toBe(status); expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('stops the whole operation on a billing anomaly even from the other attempt', async () => {
    vi.useFakeTimers(); const h = harness(); const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi' }, { delayMs: 1 }));
    await vi.advanceTimersByTimeAsync(1); h.calls[1].input.onChunk?.('Answer');
    h.calls[0].reject(new FreeRoutingError('FREE_BILLING_ANOMALY'));
    expect((await done).error.code).toBe('FREE_BILLING_ANOMALY'); expect(h.calls[1].input.signal?.aborted).toBe(true);
  });
  it('treats callback failure as terminal and does not retry user-visible output', async () => {
    vi.useFakeTimers(); const h = harness(); const err = new Error('Disconnected writer');
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: () => { throw err; } }));
    await flush(); expect(() => h.calls[0].input.onChunk?.('Answer')).toThrow(err);
    expect((await done).error).toBe(err); expect(h.calls).toHaveLength(1);
  });
  it('does not forward smuggled tool envelopes or caller attempt overrides', async () => {
    vi.useFakeTimers(); const h = harness();
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', tools: [{ type: 'web_search' }], maxAttempts: 99 } as any));
    await flush(); expect(h.calls[0].input).not.toHaveProperty('tools'); expect(h.calls[0].input.maxAttempts).toBe(1);
    h.calls[0].resolve(result()); await done;
  });
  it('bounds endless whitespace without making it a winning response', async () => {
    vi.useFakeTimers(); const dispatch = vi.fn(async (input: AttemptInput) => { input.onChunk?.(' '.repeat(16385)); return result(); });
    const done = observe(hedgeFreeChat(dispatch, { prompt: 'Hi' })); await flush();
    expect((await done).error.code).toBe('ALL_FREE_MODELS_FAILED'); expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('does not dispatch if parent aborts before the first microtask', async () => {
    vi.useFakeTimers(); const h = harness(); const parent = new AbortController();
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', signal: parent.signal }));
    parent.abort(); await flush();
    expect((await done).error.code).toBe('CHAT_ABORTED'); expect(h.calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('locks only one winner when both emit in the same turn', async () => {
    vi.useFakeTimers(); const h = harness(); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: t => chunks.push(t) }, { delayMs: 1 }));
    await vi.advanceTimersByTimeAsync(1);
    h.calls[0].input.onChunk?.('First'); h.calls[1].input.onChunk?.('Second');
    h.calls[0].resolve(result('test/first:free', 'First')); h.calls[1].resolve(result('test/second:free', 'Second'));
    expect((await done).value?.content).toBe('First'); expect(chunks).toEqual(['First']);
  });
  it('observes a late losing rejection after a completed winner', async () => {
    vi.useFakeTimers(); const h = harness();
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi' }, { delayMs: 1 }));
    await vi.advanceTimersByTimeAsync(1); h.calls[1].resolve(result('test/second:free'));
    expect((await done).value?.model).toBe('test/second:free');
    h.calls[0].reject(new Error('Late failure')); await flush(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects tool-only completion rather than executing tools or choosing it', async () => {
    vi.useFakeTimers(); const h = harness();
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi' })); await flush();
    h.calls[0].resolve({ ...result(), toolCalls: [{ id: '1', name: 'search', arguments: '{}' }] });
    await flush(); expect(h.calls).toHaveLength(2); h.calls[1].resolve(result('test/second:free'));
    expect((await done).value?.model).toBe('test/second:free');
  });

  it('does not reject a large meaningful first chunk as empty-prefix overflow', async () => {
    vi.useFakeTimers(); const h = harness(); const text = 'a'.repeat(17000); const chunks: string[] = [];
    const done = observe(hedgeFreeChat(h.dispatch, { prompt: 'Hi', onChunk: t => chunks.push(t) })); await flush();
    h.calls[0].input.onChunk?.(text); h.calls[0].resolve(result('test/first:free', text));
    expect((await done).value?.content).toBe(text); expect(chunks).toEqual([text]); expect(h.calls).toHaveLength(1);
  });

});
