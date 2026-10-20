import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdWorkspaceImportLease, WorkspaceImportLeaseError } from './workspaceImportLease';
import {
  claimWorkspaceBuild, requestWorkspaceBuildStop, LEASE_HEARTBEAT_MS, LEASE_STALE_MS,
  WORKSPACE_BUILD_LEASE_COLLECTION, type BuildLeaseStore,
} from './workspaceBuildLease';

const WS = 'agentv3-owner-import-session';
const KEY = `${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`;
function fixture() {
  const docs = new Map<string, any>();
  let unavailable = false;
  const store: BuildLeaseStore = {
    collection: (name) => ({ doc: (id) => `${name}/${id}` }),
    runTransaction: async (body) => {
      if (unavailable) throw new Error('UNAVAILABLE');
      return body({
        get: async (ref) => ({ exists: docs.has(String(ref)), data: () => structuredClone(docs.get(String(ref))) }),
        set: (ref, value) => { docs.set(String(ref), structuredClone(value)); },
        delete: (ref) => { docs.delete(String(ref)); },
      });
    },
  };
  return { store, docs, fail: (value: boolean) => { unavailable = value; } };
}
async function admitted(state: ReturnType<typeof fixture>) {
  const confirmedAtMs = Date.now();
  expect(await claimWorkspaceBuild(state.store, { workspaceId: WS, token: 'import-A', owner: 'worker-A', nowMs: confirmedAtMs }))
    .toMatchObject({ ok: true, verified: true });
  return holdWorkspaceImportLease({ store: state.store, workspaceId: WS, token: 'import-A', confirmedAtMs });
}
afterEach(() => vi.useRealTimers());

describe('long imports retain their exact lease while actual work is still leaving', () => {
  it('keeps a second worker blocked beyond two stale windows, then releases on actual completion', async () => {
    vi.useFakeTimers(); const state = fixture(); const hold = await admitted(state);
    const write = vi.fn(async () => {}); const actuator = hold.guard({ writeFile: write });
    await vi.advanceTimersByTimeAsync(LEASE_STALE_MS * 2);
    expect((await claimWorkspaceBuild(state.store, { workspaceId: WS, token: 'build-B', owner: 'worker-B' })).ok).toBe(false);
    await actuator.writeFile(); expect(write).toHaveBeenCalledOnce();
    await hold.release();
    expect((await claimWorkspaceBuild(state.store, { workspaceId: WS, token: 'build-B', owner: 'worker-B' })).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an observed Stop denies new calls while keeping the old live token held until its tail finishes', async () => {
    vi.useFakeTimers(); const state = fixture(); const hold = await admitted(state);
    await requestWorkspaceBuildStop(state.store, { workspaceId: WS });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    const write = vi.fn(); const persist = vi.fn();
    expect(() => hold.guard({ writeFile: write }).writeFile()).toThrow(WorkspaceImportLeaseError);
    expect(() => { hold.assertCurrent(); persist(); }).toThrow(WorkspaceImportLeaseError);
    expect(write).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LEASE_STALE_MS * 2);
    expect((await claimWorkspaceBuild(state.store, { workspaceId: WS, token: 'build-B', owner: 'worker-B' })).ok).toBe(false);
    await hold.release();
    expect((await claimWorkspaceBuild(state.store, { workspaceId: WS, token: 'build-B', owner: 'worker-B' })).ok).toBe(true);
  });

  it('an unknown renewal permanently denies new work even when storage recovers', async () => {
    vi.useFakeTimers(); const state = fixture(); const hold = await admitted(state);
    state.fail(true); await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(() => hold.assertCurrent()).toThrow(WorkspaceImportLeaseError);
    state.fail(false); await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(() => hold.assertCurrent()).toThrow(WorkspaceImportLeaseError);
    await hold.release();
  });

  it('local expiry denies a new call before a delayed heartbeat can run', async () => {
    vi.useFakeTimers(); const state = fixture(); const hold = await admitted(state);
    vi.setSystemTime(Date.now() + LEASE_STALE_MS + 1);
    const write = vi.fn();
    expect(() => hold.guard({ writeFile: write }).writeFile()).toThrow(WorkspaceImportLeaseError);
    expect(write).not.toHaveBeenCalled();
    await hold.release();
  });

  it('a takeover denies new calls and old cleanup cannot delete the successor token', async () => {
    vi.useFakeTimers(); const state = fixture(); const hold = await admitted(state);
    const newer = { token: 'build-B', owner: 'worker-B', heartbeatAt: Date.now() };
    state.docs.set(KEY, newer);
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(() => hold.assertCurrent()).toThrow(WorkspaceImportLeaseError);
    await hold.release(); expect(state.docs.get(KEY)).toEqual(newer);
    expect(vi.getTimerCount()).toBe(0);
  });
});
