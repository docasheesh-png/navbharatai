import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatAttemptLimits, watchChatAttempt } from './attemptBudget';
afterEach(() => vi.useRealTimers());
const limits = { firstTokenMs: 90000, idleMs: 30000, hardCapMs: 180000 };
describe('chat-local fallback observation', () => {
  it('reserves a first-token opportunity for every later fixed-chain position', () => {
    expect(chatAttemptLimits(limits, 91000, 12, 1000)).toEqual({ firstTokenMs: 7500, idleMs: 30000, hardCapMs: 90000 });
    expect(chatAttemptLimits(limits, 91000, 6, 46000)).toEqual({ firstTokenMs: 7500, idleMs: 30000, hardCapMs: 45000 });
    expect(chatAttemptLimits(limits, 91000, 1, 90000)).toEqual({ firstTokenMs: 1000, idleMs: 1000, hardCapMs: 1000 });
  });
  it('never raises a configured shorter first-token or hard bound', () => {
    expect(chatAttemptLimits({ firstTokenMs: 1000, idleMs: 2000, hardCapMs: 3000 }, 100000, 12, 0)).toEqual({ firstTokenMs: 1000, idleMs: 2000, hardCapMs: 3000 });
  });
  it('rejects already-cancelled work before physical dispatch', async () => {
    const controller = new AbortController(); controller.abort(); const run = vi.fn();
    expect(await watchChatAttempt(run, vi.fn(), limits, controller.signal)).toMatchObject({ verdict: 'failed', delivered: false });
    expect(run).not.toHaveBeenCalled();
  });
  it.each([false, true])('returns immediately from a non-cooperative SDK on cancellation (committed=%s)', async committed => {
    vi.useFakeTimers(); const controller = new AbortController(); const onChunk = vi.fn();
    let lateChunk!: (value: string) => void; let reject!: (error: Error) => void;
    const result = watchChatAttempt(async chunk => { lateChunk = chunk; if (committed) chunk('first'); await new Promise((_, r) => { reject = r; }); }, onChunk, limits, controller.signal);
    await vi.advanceTimersByTimeAsync(0); controller.abort();
    expect(await result).toMatchObject({ verdict: 'failed', delivered: committed });
    lateChunk('late'); reject(new Error('late SDK failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onChunk.mock.calls).toEqual(committed ? [['first']] : []);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a silent rung, drops late text and permits a separate clean attempt', async () => {
    vi.useFakeTimers(); let lateChunk!: (value: string) => void; const text: string[] = [];
    const result = watchChatAttempt(async chunk => { lateChunk = chunk; await new Promise(() => {}); }, s => text.push(s), { ...limits, firstTokenMs: 1000 }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ verdict: 'first-token-timeout', delivered: false });
    lateChunk('late');
    expect(await watchChatAttempt(async chunk => { chunk('healthy'); }, s => text.push(s), limits, new AbortController().signal)).toMatchObject({ verdict: 'completed' });
    expect(text).toEqual(['healthy']); expect(vi.getTimerCount()).toBe(0);
  });
});
