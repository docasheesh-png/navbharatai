import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimWorkspaceBuild, renewWorkspaceBuild, releaseWorkspaceBuild,
  WORKSPACE_BUILD_LEASE_COLLECTION, LEASE_CALL_TIMEOUT_MS, LEASE_STALE_MS, type BuildLeaseStore,
} from '../src/server/AgentV3/workspaceBuildLease';

const NOW = 1_790_000_000_000;
const WS = 'agentv3-owner-session';
function gate() { let open!: () => void; const promise = new Promise<void>((resolve) => { open = resolve; }); return { promise, open }; }
/** Optimistic transaction double; lease changes invalidate an earlier staged write before commit. */
function database() {
  const docs = new Map<string, Record<string, unknown>>(); const versions = new Map<string, number>();
  const state = { beforeRead: undefined as undefined | (() => Promise<void>), beforeCommit: undefined as undefined | (() => Promise<void>) };
  const set = (key: string, value: Record<string, unknown> | null) => {
    if (value) docs.set(key, value); else docs.delete(key);
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const store: BuildLeaseStore = {
    collection: (name) => ({ doc: (id) => `${name}/${id}` }),
    async runTransaction<T>(run: Parameters<BuildLeaseStore['runTransaction']>[0]): Promise<T> {
      for (let retry = 0; retry < 10; retry++) {
        const reads = new Map<string, number>(); const writes: Array<[string, Record<string, unknown> | null]> = [];
        const result = await run({
          get: async (key) => {
            if (state.beforeRead) await state.beforeRead();
            const k = String(key); const value = docs.get(k); reads.set(k, versions.get(k) ?? 0);
            return { exists: !!value, data: () => value };
          },
          set: (key, value) => { writes.push([String(key), value]); },
          delete: (key) => { writes.push([String(key), null]); },
        });
        if (state.beforeCommit) await state.beforeCommit();
        if ([...reads].some(([key, version]) => (versions.get(key) ?? 0) !== version)) continue;
        writes.forEach(([key, value]) => set(key, value));
        return result as T;
      }
      throw new Error('transaction contention');
    },
  };
  return { store, state, docs, key: `${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}` };
}
const opts = (token = 'a', owner = 'worker') => ({ workspaceId: WS, token, owner });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe('lease-only admission fault behavior', () => {
  it('a missing database or invalid workspace/token never grants unverified admission', async () => {
    expect(await claimWorkspaceBuild(null, opts())).toMatchObject({ ok: false, reason: 'unavailable' });
    const { store } = database();
    expect(await claimWorkspaceBuild(store, { ...opts(), workspaceId: '' })).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(await claimWorkspaceBuild(store, { ...opts(), token: '' })).toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('a rejected database transaction is retryable unavailable, never success', async () => {
    const { store } = database(); store.runTransaction = async () => { throw new Error('UNAVAILABLE'); };
    expect(await claimWorkspaceBuild(store, opts())).toEqual({ ok: false, reason: 'unavailable', holderHeartbeatAt: 0 });
  });
  it('a hanging transaction returns unavailable at the production deadline', async () => {
    const { store } = database(); store.runTransaction = () => new Promise(() => {});
    const claim = claimWorkspaceBuild(store, opts());
    await vi.advanceTimersByTimeAsync(LEASE_CALL_TIMEOUT_MS);
    expect(await claim).toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('a delayed claim callback cannot stage a lease after the caller timed out', async () => {
    const db = database(); const delayed = gate(); db.state.beforeRead = () => delayed.promise;
    const claim = claimWorkspaceBuild(db.store, opts());
    await vi.advanceTimersByTimeAsync(LEASE_CALL_TIMEOUT_MS + 1);
    expect(await claim).toMatchObject({ ok: false, reason: 'unavailable' });
    delayed.open(); await vi.advanceTimersByTimeAsync(0);
    expect(db.docs.size).toBe(0);
  });
  it('an ambiguously timed-out commit cannot overwrite a later successful claim on transaction retry', async () => {
    const db = database(); const committing = gate(), delayed = gate(); let held = false;
    db.state.beforeCommit = async () => { if (!held) { held = true; committing.open(); await delayed.promise; } };
    const old = claimWorkspaceBuild(db.store, opts('old', 'A')); await committing.promise;
    await vi.advanceTimersByTimeAsync(LEASE_CALL_TIMEOUT_MS + 1);
    expect(await old).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(await claimWorkspaceBuild(db.store, opts('new', 'B'))).toEqual({ ok: true, verified: true });
    delayed.open(); await vi.advanceTimersByTimeAsync(0);
    expect(db.docs.get(db.key)?.token).toBe('new');
  });
  it('a commit whose ACK is delayed may exist, but its timed-out caller still receives no admission', async () => {
    const db = database(); const ack = gate(); const tx = db.store.runTransaction.bind(db.store);
    db.store.runTransaction = async (run) => { const result = await tx(run); await ack.promise; return result; };
    const claim = claimWorkspaceBuild(db.store, opts());
    await vi.advanceTimersByTimeAsync(LEASE_CALL_TIMEOUT_MS + 1);
    expect(await claim).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(db.docs.get(db.key)?.token).toBe('a'); // Promise.race is not transaction cancellation.
    ack.open(); await vi.advanceTimersByTimeAsync(0);
  });
  it('another live token remains busy even under the same process owner', async () => {
    const db = database(); await claimWorkspaceBuild(db.store, opts('first'));
    expect(await claimWorkspaceBuild(db.store, opts('second'))).toMatchObject({ ok: false, reason: 'busy' });
    expect(db.docs.get(db.key)?.token).toBe('first');
  });
});

describe('renewal and release faults', () => {
  it('an expired lease cannot revive itself with a late renewal', async () => {
    const db = database(); await claimWorkspaceBuild(db.store, opts());
    vi.setSystemTime(NOW + LEASE_STALE_MS);
    expect(await renewWorkspaceBuild(db.store, { workspaceId: WS, token: 'a' })).toBe('lost');
    expect(db.docs.get(db.key)?.heartbeatAt).toBe(NOW);
  });
  it('current callback time, not its captured start, decides whether a near-expiry heartbeat is still valid', async () => {
    const db = database(); await claimWorkspaceBuild(db.store, opts()); vi.setSystemTime(NOW + LEASE_STALE_MS - 1_000);
    const read = gate(); db.state.beforeRead = () => read.promise;
    const renewal = renewWorkspaceBuild(db.store, { workspaceId: WS, token: 'a', nowMs: Date.now() });
    await vi.advanceTimersByTimeAsync(2_000); read.open();
    expect(await renewal).toBe('lost'); expect(db.docs.get(db.key)?.heartbeatAt).toBe(NOW);
  });
  it('a delayed renewal callback cannot change the lease after timing out', async () => {
    const db = database(); await claimWorkspaceBuild(db.store, opts()); const read = gate(); db.state.beforeRead = () => read.promise;
    const renewal = renewWorkspaceBuild(db.store, { workspaceId: WS, token: 'a' });
    await vi.advanceTimersByTimeAsync(LEASE_CALL_TIMEOUT_MS + 1);
    expect(await renewal).toBe('unknown'); read.open(); await vi.advanceTimersByTimeAsync(0);
    expect(db.docs.get(db.key)?.heartbeatAt).toBe(NOW);
  });
  it('a stopped build keeps its exact live lease until actual shared-runtime exit, blocking another claim beyond the stale window', async () => {
    const db = database(); await claimWorkspaceBuild(db.store, opts()); db.docs.get(db.key)!.stopRequested = true;
    for (const elapsed of [20_000, 80_000, 140_000, 180_000]) {
      vi.setSystemTime(NOW + elapsed);
      expect(await renewWorkspaceBuild(db.store, { workspaceId: WS, token: 'a' })).toBe('stop-requested');
      expect(db.docs.get(db.key)?.heartbeatAt).toBe(NOW + elapsed);
      expect(await claimWorkspaceBuild(db.store, opts('new', 'B'))).toMatchObject({ ok: false, reason: 'busy' });
    }
    await releaseWorkspaceBuild(db.store, { workspaceId: WS, token: 'a' });
    expect(await claimWorkspaceBuild(db.store, opts('new', 'B'))).toEqual({ ok: true, verified: true });
  });
  it('a stopped lease that already expired is never resurrected', async () => {
    const db = database(); await claimWorkspaceBuild(db.store, opts()); db.docs.get(db.key)!.stopRequested = true;
    vi.setSystemTime(NOW + LEASE_STALE_MS + 1);
    expect(await renewWorkspaceBuild(db.store, { workspaceId: WS, token: 'a' })).toBe('lost');
    expect(db.docs.get(db.key)?.heartbeatAt).toBe(NOW);
  });
  it('a stale release never deletes the next owner\'s lease', async () => {
    const db = database(); await claimWorkspaceBuild(db.store, opts('old', 'A')); vi.setSystemTime(NOW + LEASE_STALE_MS + 1);
    await claimWorkspaceBuild(db.store, opts('new', 'B')); await releaseWorkspaceBuild(db.store, { workspaceId: WS, token: 'old' });
    expect(db.docs.get(db.key)?.token).toBe('new');
  });
});
