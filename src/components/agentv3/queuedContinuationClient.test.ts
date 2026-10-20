import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitQueuedContinuation, QUEUE_CONTINUATION_WAIT_MS } from './queuedContinuationClient';
import { QueueSessionScope } from './queueSessionScope';
import { readQueueContinuationTicket, type QueueContinuationTicket } from '../../lib/queueContinuation';
import { confirmedQueueResponse } from '../../lib/queueResponse';

const ticket: QueueContinuationTicket = { itemId: 'A', claimToken: 'claim-A', predecessorAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nonce: '11111111-1111-4111-8111-111111111111', state: 'pending', planRemaining: 3, ordinal: 1 };
afterEach(() => vi.useRealTimers());
function fixture() {
  const scope = new QueueSessionScope(); scope.update('agentv3-owner-session123', 'session123', 'owner');
  const claim = { id: 'A', claimToken: 'claim-A', scope: scope.capture() };
  const controller = new AbortController();
  const row = (phase: 'pending' | 'ready') => ({ id: 'A', claimToken: 'claim-A', prompt: 'Approved step', source: 'planner' as const, status: 'running' as const, createdTs: 1,
    continuation: { version: 1 as const, nonce: ticket.nonce, predecessorAttemptId: ticket.predecessorAttemptId, phase, planRemaining: 3, ordinal: 1 } });
  const run = vi.fn();
  const input = { scope, claim, ticket, signal: controller.signal, run };
  return { scope, claim, controller, row, run, input };
}

describe('a queued continuation needs current authoritative readiness', () => {
  it('keeps the same claim while pending and starts once only after a fresh READY read', async () => {
    const f = fixture(); let reads = 0; const wait = vi.fn(async () => {});
    const load = vi.fn(async () => ({ items: [f.row(++reads === 1 ? 'pending' : 'ready')], paused: false }));
    expect(await awaitQueuedContinuation({ ...f.input, load, wait })).toBe('started');
    expect(load).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledTimes(1);
    expect(f.run).toHaveBeenCalledExactlyOnceWith(ticket, f.claim.scope);
  });
  it.each(['paused', 'missing', 'wrong-claim', 'wrong-nonce', 'wrong-parent', 'consumed'] as const)('never submits %s state', async (fault) => {
    const f = fixture(); const row: any = f.row('ready');
    if (fault === 'wrong-claim') row.claimToken = 'claim-B';
    if (fault === 'wrong-nonce') row.continuation.nonce = '22222222-2222-4222-8222-222222222222';
    if (fault === 'wrong-parent') row.continuation.predecessorAttemptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    if (fault === 'consumed') delete row.continuation;
    await expect(awaitQueuedContinuation({ ...f.input, load: async () => ({ items: fault === 'missing' ? [] : [row], paused: fault === 'paused' }) })).rejects.toThrow('changed or was stopped');
    expect(f.run).not.toHaveBeenCalled();
  });
  it.each(['stop', 'navigate'] as const)('ignores a delayed READY read after %s', async (action) => {
    const f = fixture(); let finish!: (queue: any) => void;
    const pending = awaitQueuedContinuation({ ...f.input, load: () => new Promise((resolve) => { finish = resolve; }) });
    await Promise.resolve();
    if (action === 'stop') f.controller.abort(); else f.scope.update('agentv3-owner-other', 'other', 'owner');
    finish({ items: [f.row('ready')], paused: false });
    expect(await pending).toBe('stale'); expect(f.run).not.toHaveBeenCalled();
  });
  it('checks the captured scope again after an editor flush', async () => {
    const f = fixture();
    expect(await awaitQueuedContinuation({ ...f.input, load: async () => ({ items: [f.row('ready')], paused: false }), beforeBuild: async () => { f.scope.invalidate(); } })).toBe('stale');
    expect(f.run).not.toHaveBeenCalled();
  });
  it.each([false, true])('a completed late editor flush cannot start after the deadline even when its timer was throttled (rejects=%s)', async (rejects) => {
    const f = fixture(); let now = 0;
    await expect(awaitQueuedContinuation({ ...f.input,
      load: async () => ({ items: [f.row('ready')], paused: false }), now: () => now,
      beforeBuild: async () => { now = QUEUE_CONTINUATION_WAIT_MS + 1; if (rejects) throw Error('late rejected flush'); },
    })).rejects.toThrow('still finishing');
    expect(f.run).not.toHaveBeenCalled();
  });
  it('hands back on unknown storage instead of retrying a new execution', async () => {
    const f = fixture(); const load = vi.fn(async () => { throw Error('ACK unknown'); });
    await expect(awaitQueuedContinuation({ ...f.input, load })).rejects.toThrow('ACK unknown');
    expect(load).toHaveBeenCalledTimes(1); expect(f.run).not.toHaveBeenCalled();
  });
  it('bounds pending cleanup without mistaking elapsed time for readiness', async () => {
    const f = fixture(); let now = 0;
    await expect(awaitQueuedContinuation({ ...f.input, load: async () => ({ items: [f.row('pending')], paused: false }), now: () => now, wait: async () => { now += QUEUE_CONTINUATION_WAIT_MS; } })).rejects.toThrow('still finishing');
    expect(f.run).not.toHaveBeenCalled();
  });
  it('does not adopt an old claim after reopening the same workspace', async () => {
    const f = fixture(); f.scope.invalidate();
    const load = vi.fn();
    expect(await awaitQueuedContinuation({ ...f.input, load })).toBe('stale');
    expect(load).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  });
  it('a hanging queue read is bounded and late READY cannot submit', async () => {
    vi.useFakeTimers(); const f = fixture(); let finish!: (value: any) => void;
    const load = () => new Promise<any>((resolveRead) => { finish = resolveRead; });
    const pending = awaitQueuedContinuation({ ...f.input, load });
    const rejected = expect(pending).rejects.toThrow('still finishing');
    await vi.advanceTimersByTimeAsync(QUEUE_CONTINUATION_WAIT_MS);
    await rejected;
    finish({ items: [f.row('ready')], paused: false }); await Promise.resolve();
    expect(f.run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('Stop settles a hanging read immediately and cleans its deadline timer', async () => {
    vi.useFakeTimers(); const f = fixture();
    const pending = awaitQueuedContinuation({ ...f.input, load: () => new Promise(() => {}) });
    await Promise.resolve(); f.controller.abort();
    expect(await pending).toBe('stale');
    expect(f.run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('a hanging editor flush does not authorize another window on timeout', async () => {
    vi.useFakeTimers(); const f = fixture(); const beforeBuild = vi.fn(() => new Promise<void>(() => {}));
    const pending = awaitQueuedContinuation({ ...f.input, load: async () => ({ items: [f.row('ready')], paused: false }), beforeBuild });
    const rejected = expect(pending).rejects.toThrow('still finishing');
    await vi.advanceTimersByTimeAsync(QUEUE_CONTINUATION_WAIT_MS);
    await rejected; expect(beforeBuild).toHaveBeenCalledTimes(1);
    expect(f.run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('a Stop during editor flush settles immediately and ignores its late completion', async () => {
    const f = fixture(); let finish!: () => void;
    const pending = awaitQueuedContinuation({ ...f.input, load: async () => ({ items: [f.row('ready')], paused: false }), beforeBuild: () => new Promise<void>((resolveFlush) => { finish = resolveFlush; }) });
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    f.controller.abort(); expect(await pending).toBe('stale'); finish(); await Promise.resolve();
    expect(f.run).not.toHaveBeenCalled();
  });
});

describe('wire and queue handoff metadata are validated before use', () => {
  it('accepts the bounded normal-module ticket and READY row', () => {
    const f = fixture(); expect(readQueueContinuationTicket(ticket)).toBe(ticket);
    expect(confirmedQueueResponse({ items: [f.row('ready')], paused: false }).items).toHaveLength(1);
  });
  it.each([{ nonce: '' }, { predecessorAttemptId: 'not-an-attempt' }, { planRemaining: 0 }, { planRemaining: 61 }, { ordinal: 101 }, { ordinal: 1.5 }, { state: 'ready' }])('refuses malformed result ticket %j', (change) => {
    expect(readQueueContinuationTicket({ ...ticket, ...change })).toBeUndefined();
  });
  it.each([{ phase: 'consumed' }, { nonce: 'wrong' }, { ordinal: 0 }, { planRemaining: null }])('refuses malformed durable queue metadata %j', (change) => {
    const f = fixture(); const row = f.row('ready');
    expect(() => confirmedQueueResponse({ items: [{ ...row, continuation: { ...row.continuation, ...change } }] })).toThrow('could not be confirmed');
  });
});
