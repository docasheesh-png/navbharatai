import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildDeadlineFinalization, joinBuildDeadlineFinalization, retainBuildUntilBodyExit, closeDeadlineBuildStream, deadlineBodyExitMessage } from '../src/server/AgentV3/BuildDeadlineLifecycle';
import { startBuildLeaseHeartbeat } from '../src/server/AgentV3/BuildRequestCoordination';
import { selectZombieBuilds } from '../src/server/AgentV3/buildWatchdog';
import { markBuildExited, stoppedBuildGate, STOP_DRAIN_MAX_MS } from '../src/server/AgentV3/stoppingBuild';
import { claimWorkspaceBuild, releaseWorkspaceBuild, LEASE_HEARTBEAT_MS, LEASE_STALE_MS, WORKSPACE_BUILD_LEASE_COLLECTION, type BuildLeaseStore } from '../src/server/AgentV3/workspaceBuildLease';
import type { RunningBuild } from '../src/server/AgentV3/runningBuildRegistry';

const KEY = 'agentv3-owner-project';
const NOW = 1_000_000;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function build(): RunningBuild {
  return { abort: new AbortController(), buffer: [], subscribers: new Set(), ended: false, exited: false, startedTs: NOW };
}

function leaseStore() {
  const docs = new Map<string, Record<string, unknown>>();
  const db: BuildLeaseStore = {
    collection: (name) => ({ doc: (id) => `${name}/${id}` }),
    runTransaction: async (body) => body({
      get: async (ref) => ({ exists: docs.has(String(ref)), data: () => docs.get(String(ref)) }),
      set: (ref, value) => { docs.set(String(ref), value); },
      delete: (ref) => { docs.delete(String(ref)); },
    }),
  };
  return { db, docs };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('deadline settlement claims one finalizer without claiming body exit', () => {
  it('retains synchronously before finalizer I/O and shares the same completion with overlapping callers', async () => {
    const rb = build();
    const hold = deferred();
    const order: string[] = [];
    const finalizer = vi.fn(async () => { order.push('finalize'); await hold.promise; });
    const close = vi.fn();
    const lifecycle = createBuildDeadlineFinalization({ build: rb, begin: () => { order.push('retain'); }, finalize: finalizer, close });
    await lifecycle.join();

    const first = lifecycle.run();
    const second = lifecycle.run();
    expect(first).toBe(second);
    expect(order).toEqual(['retain']);
    await Promise.resolve();
    expect(order).toEqual(['retain', 'finalize']);

    let cleanupJoined = false;
    const cleanupWait = lifecycle.join().then(() => { cleanupJoined = true; });
    await Promise.resolve();
    expect(cleanupJoined).toBe(false);
    expect(finalizer).toHaveBeenCalledTimes(1);
    expect(rb.exited).toBe(false);
    hold.resolve();
    await Promise.all([first, second, cleanupWait]);
    expect(cleanupJoined).toBe(true);
    expect(rb.exited).toBe(false);
    await lifecycle.run();
    expect(finalizer).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a stream already ended by another path never starts deadline billing or persistence', async () => {
    const rb = build(); rb.ended = true;
    const begin = vi.fn();
    const finalize = vi.fn(async () => {});
    const close = vi.fn();
    const lifecycle = createBuildDeadlineFinalization({ build: rb, begin, finalize, close });
    await lifecycle.run();
    await lifecycle.join();
    expect(begin).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('a failed finalizer closes its stream once without claiming that its body has exited', async () => {
    const rb = build();
    const running = new Map([[KEY, rb]]);
    const stopping = new Map<string, RunningBuild>();
    const failure = new Error('terminal persistence failed');
    const finalize = vi.fn(async () => { throw failure; });
    const close = vi.fn(() => closeDeadlineBuildStream(KEY, rb, running, (entry) => { entry.ended = true; }));
    const lifecycle = createBuildDeadlineFinalization({ build: rb,
      begin: () => retainBuildUntilBodyExit(KEY, rb, stopping, NOW), finalize, close });
    await expect(lifecycle.run()).rejects.toBe(failure);
    await expect(lifecycle.join()).resolves.toBeUndefined();
    await expect(lifecycle.run()).rejects.toBe(failure);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(rb.ended).toBe(true);
    expect(rb.exited).toBe(false);
    expect(stopping.get(KEY)).toBe(rb);
    expect(stoppedBuildGate(rb, NOW + 100 * STOP_DRAIN_MAX_MS)).toBe('refuse');
  });

  it('a synchronous begin callback can re-enter run and join without a second finalizer or early cleanup', async () => {
    const hold = deferred();
    const finalize = vi.fn(() => hold.promise);
    let lifecycle!: ReturnType<typeof createBuildDeadlineFinalization>;
    let reentered!: Promise<void>;
    let cleanupWait!: Promise<void>;
    let joined = false;
    const begin = vi.fn(() => {
      reentered = lifecycle.run();
      cleanupWait = lifecycle.join().then(() => { joined = true; });
    });
    lifecycle = createBuildDeadlineFinalization({ build: build(), begin, finalize, close: vi.fn() });
    const terminal = lifecycle.run();
    expect(reentered).toBe(terminal);
    expect(begin).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(joined).toBe(false);
    hold.resolve();
    await Promise.all([terminal, reentered, cleanupWait]);
    expect(joined).toBe(true);
  });

  it('body cleanup waits for an independently held finalizer before releasing its resource', async () => {
    // Initializer failures can reach outer cleanup before any deadline lifecycle was installed.
    await expect(joinBuildDeadlineFinalization(undefined)).resolves.toBeUndefined();
    const rb = build();
    const bodyHold = deferred();
    const persistenceHold = deferred();
    const releaseResource = vi.fn();
    const lifecycle = createBuildDeadlineFinalization({ build: rb, begin: vi.fn(), finalize: () => persistenceHold.promise, close: vi.fn() });
    const body = (async () => {
      try { await bodyHold.promise; }
      finally { await joinBuildDeadlineFinalization(lifecycle); releaseResource(); markBuildExited(rb); }
    })();
    const terminal = lifecycle.run();
    bodyHold.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(releaseResource).not.toHaveBeenCalled();
    expect(rb.exited).toBe(false);
    persistenceHold.resolve();
    await Promise.all([body, terminal]);
    expect(releaseResource).toHaveBeenCalledTimes(1);
    expect(rb.exited).toBe(true);
  });
});

describe('deadline stream closure preserves captured ownership until the body exits', () => {
  it('an old deadline cannot replace a newer stopping entry under its captured key', () => {
    const old = build();
    const newer = build();
    const stopping = new Map([[KEY, newer]]);
    retainBuildUntilBodyExit(KEY, old, stopping, NOW);
    expect(stopping.get(KEY)).toBe(newer);
    expect(old.requiresBodyExit).toBe(true);
    expect(old.exited).toBe(false);
    expect(newer.exited).toBe(false);
  });

  it('closes only the captured stream and cannot remove a newer build under the same key', () => {
    const old = build();
    const newer = build();
    const running = new Map([[KEY, newer]]);
    const stopping = new Map<string, RunningBuild>();
    const end = vi.fn((entry: RunningBuild) => { entry.ended = true; });
    const waiter = vi.fn();
    old.exitWaiters = [waiter];
    retainBuildUntilBodyExit(KEY, old, stopping, NOW);
    closeDeadlineBuildStream(KEY, old, running, end);
    expect(running.get(KEY)).toBe(newer);
    expect(end).toHaveBeenCalledExactlyOnceWith(old);
    expect(newer.ended).toBe(false);
    expect(old.ended).toBe(true);
    expect(old.exited).toBe(false);
    expect(stopping.get(KEY)).toBe(old);
    expect(waiter).not.toHaveBeenCalled();
    expect(stoppedBuildGate(old, NOW + 100 * STOP_DRAIN_MAX_MS)).toBe('refuse');
    expect(selectZombieBuilds([[KEY, old]], NOW + 100 * STOP_DRAIN_MAX_MS, 1)).toEqual([]);
    markBuildExited(old);
    expect(waiter).toHaveBeenCalledTimes(1);
    expect(stoppedBuildGate(old, Date.now())).toBe('proceed');
    expect(selectZombieBuilds([[KEY, old]], Date.now(), 1)).toEqual([KEY]);
  });

  it('keeps the first deadline timestamp and never installs an already exited body as stopping', () => {
    const rb = build();
    const stopping = new Map<string, RunningBuild>();
    retainBuildUntilBodyExit(KEY, rb, stopping, NOW);
    retainBuildUntilBodyExit(KEY, rb, stopping, NOW + 10_000);
    expect(rb.requiresBodyExit).toBe(true);
    expect(rb.stoppedAt).toBe(NOW);
    expect(stopping.get(KEY)).toBe(rb);
    markBuildExited(rb);
    stopping.delete(KEY);
    retainBuildUntilBodyExit(KEY, rb, stopping, NOW + 20_000);
    expect(stopping.has(KEY)).toBe(false);
  });

  it.each([false, true])('renews the exact lease after stream closure (finalizer fails=%s), then frees it only after real exit', async (fails) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { db, docs } = leaseStore();
    const rb = build();
    const running = new Map([[KEY, rb]]);
    const stopping = new Map<string, RunningBuild>();
    const bodyHold = deferred();
    const finalizerHold = deferred();
    const delivered: string[] = [];
    const end = vi.fn((entry: RunningBuild) => { entry.ended = true; delivered.push('closed'); });
    expect(await claimWorkspaceBuild(db, { workspaceId: KEY, token: 'attempt-A', owner: 'worker-A', nowMs: NOW })).toMatchObject({ ok: true });
    let timer: ReturnType<typeof setInterval>;
    const release = vi.fn(async () => { clearInterval(timer); await releaseWorkspaceBuild(db, { workspaceId: KEY, token: 'attempt-A' }); });
    const lost = vi.fn();
    timer = startBuildLeaseHeartbeat({ store: db, workspaceId: KEY, token: 'attempt-A', admittedAt: NOW,
      build: () => rb, current: () => running.get(KEY), active: () => true, release, lost });
    const lifecycle = createBuildDeadlineFinalization({ build: rb,
      begin: () => { retainBuildUntilBodyExit(KEY, rb, stopping, Date.now()); rb.abort.abort(); },
      finalize: async () => { await finalizerHold.promise; if (fails) throw Error('terminal persistence failed'); delivered.push('result'); },
      close: () => closeDeadlineBuildStream(KEY, rb, running, end),
    });
    const body = (async () => {
      try { await bodyHold.promise; }
      finally { await lifecycle.join(); markBuildExited(rb); }
    })();

    const terminal = lifecycle.run();
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(release).not.toHaveBeenCalled();
    finalizerHold.resolve();
    if (fails) await expect(terminal).rejects.toThrow('terminal persistence failed'); else await terminal;
    expect(delivered).toEqual(fails ? ['closed'] : ['result', 'closed']);
    expect(running.has(KEY)).toBe(false);
    expect(rb.abort.signal.aborted).toBe(true);
    expect(rb.exited).toBe(false);

    await vi.advanceTimersByTimeAsync(8 * LEASE_STALE_MS);
    expect(docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${KEY}`)).toMatchObject({ token: 'attempt-A', heartbeatAt: Date.now() });
    expect(release).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
    expect(stoppedBuildGate(stopping.get(KEY), Date.now())).toBe('refuse');
    expect(await claimWorkspaceBuild(db, { workspaceId: KEY, token: 'attempt-B', owner: 'worker-B' })).toMatchObject({ ok: false, reason: 'busy' });

    bodyHold.resolve();
    await body;
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(release).toHaveBeenCalledTimes(1);
    expect(await claimWorkspaceBuild(db, { workspaceId: KEY, token: 'attempt-B', owner: 'worker-B' })).toMatchObject({ ok: true });
    expect(end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a deadline reports unconfirmed body exit honestly', () => {
  it('describes changed files and asks for a retry after exit, without promising persistence or automatic continuation', () => {
    const { summary } = deadlineBodyExitMessage(3);
    expect(summary).toMatch(/3 files changed/i);
    expect(summary).toMatch(/still stopping/i);
    expect(summary).toMatch(/retry after it finishes/i);
    expect(summary).not.toMatch(/saved|automatically|auto-continue|almost|nearly|complete/i);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('an unknown or empty change count %s never invents file progress', (count) => {
    const { summary } = deadlineBodyExitMessage(count);
    expect(summary).not.toMatch(/\d+ files?/);
    expect(summary).toMatch(/still stopping/i);
  });
});
