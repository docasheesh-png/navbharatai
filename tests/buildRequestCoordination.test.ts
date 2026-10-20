import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildPreflightStream, startBuildLeaseHeartbeat, withBuildRequestCleanup } from '../src/server/AgentV3/BuildRequestCoordination';
import { claimWorkspaceBuild, requestWorkspaceBuildStop, releaseWorkspaceBuild, LEASE_HEARTBEAT_MS, LEASE_STALE_MS, WORKSPACE_BUILD_LEASE_COLLECTION, type BuildLeaseStore } from '../src/server/AgentV3/workspaceBuildLease';
import { mockReq, mockRes } from './helpers/routeTestUtils';
import type { RunningBuild } from '../src/server/AgentV3/runningBuildRegistry';
afterEach(() => vi.useRealTimers());
describe('accepted request finalization survives preflight/initializer exits', () => {
  it.each([false, true])('runs its registered cleanup after early return or throw=%s', async (throws) => {
    const cleanup = vi.fn(async () => {});
    const handler = withBuildRequestCleanup(async (_req, _res, register) => { register(cleanup); if (throws) throw Error('initializer failed'); });
    const run = handler(mockReq(), mockRes(), () => {});
    if (throws) await expect(run).rejects.toThrow('initializer failed'); else await run;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it('preflight starts within1second and a late refusal is an honest terminal failure', async () => {
    vi.useFakeTimers();
    const res: any = mockRes(); const events: any[] = [];
    res.flushHeaders = () => { res.headersSent = true; };
    res.write = (line: string) => { events.push(JSON.parse(line)); return true; };
    const stream = createBuildPreflightStream(res, (event, forward) => forward(event));
    stream.send({ type: 'ping' }); stream.arm();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual([{ type: 'ping' }]);
    stream.reject(503, { error: 'unknown ownership', code: 'BUILD_AUTHORITY_UNAVAILABLE', retryable: true });
    expect(events.slice(1).map((e) => [e.type, e.ok])).toEqual([['error', undefined], ['result', false]]);
    expect(res.ended).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
function leaseFixture() {
  const docs = new Map<string, any>();
  const db: BuildLeaseStore = {
    collection: (name) => ({ doc: (id) => `${name}/${id}` }),
    runTransaction: async (body) => body({ get: async (ref) => ({ exists: docs.has(String(ref)), data: () => docs.get(String(ref)) }), set: (ref, value) => { docs.set(String(ref), value); }, delete: (ref) => { docs.delete(String(ref)); } }),
  };
  const build = { abort: new AbortController(), ended: false, exited: false } as RunningBuild;
  const released = vi.fn(async () => {}); const lost = vi.fn();
  return { db, docs, build, released, lost };
}
describe('lease heartbeat lifecycle uses the captured accepted build', () => {
  it('keeps a stopped-but-leaving build blocked, then releases when that same build exits', async () => {
    vi.useFakeTimers(); const f = leaseFixture(); const now = Date.now();
    await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-A', owner: 'worker-A', nowMs: now });
    f.build.ended = true;
    const timer = startBuildLeaseHeartbeat({ store: f.db, workspaceId: 'workspace', token: 'attempt-A', admittedAt: now, build: () => f.build, current: () => undefined, active: () => true, release: f.released, lost: f.lost });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(f.released).not.toHaveBeenCalled();
    f.build.exited = true;
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(f.released).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });
  it('a remote Stop keeps the shared runtime blocked while its captured build is still leaving', async () => {
    vi.useFakeTimers(); const f = leaseFixture(); const now = Date.now();
    await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-A', owner: 'worker-A', nowMs: now });
    await requestWorkspaceBuildStop(f.db, { workspaceId: 'workspace', nowMs: now });
    f.released.mockImplementation(async () => { await releaseWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-A' }); });
    const timer = startBuildLeaseHeartbeat({ store: f.db, workspaceId: 'workspace', token: 'attempt-A', admittedAt: now, build: () => f.build, current: () => f.build.ended ? undefined : f.build, active: () => true, release: f.released, lost: f.lost });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(f.build.abort.signal.aborted).toBe(true);
    // Stop closes the stream, but an unabortable command/flush can keep the body alive much longer.
    f.build.ended = true;
    await vi.advanceTimersByTimeAsync(2 * LEASE_STALE_MS);
    expect((await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-B', owner: 'worker-B' })).ok).toBe(false);
    expect(f.released).not.toHaveBeenCalled();
    f.build.exited = true;
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(f.released).toHaveBeenCalledTimes(1);
    expect((await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-B', owner: 'worker-B' })).ok).toBe(true);
    clearInterval(timer);
  });
  it('a newer token aborts the old build and never renews or overwrites the new lease', async () => {
    vi.useFakeTimers(); const f = leaseFixture(); const now = Date.now();
    await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-A', owner: 'worker-A', nowMs: now - LEASE_STALE_MS - 1 });
    await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-B', owner: 'worker-B', nowMs: now });
    const before = structuredClone(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/workspace`));
    const timer = startBuildLeaseHeartbeat({ store: f.db, workspaceId: 'workspace', token: 'attempt-A', admittedAt: now, build: () => f.build, current: () => f.build, active: () => true, release: f.released, lost: f.lost });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(f.build.abort.signal.aborted).toBe(true);
    expect(f.lost).toHaveBeenCalledTimes(1);
    expect(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/workspace`)).toEqual(before);
    clearInterval(timer);
  });
  it('a deadline-held body losing its durable token cannot retire its receipt through the release callback', async () => {
    vi.useFakeTimers(); const f = leaseFixture(); const now = Date.now();
    await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-A', owner: 'worker-A', nowMs: now - LEASE_STALE_MS - 1 });
    await claimWorkspaceBuild(f.db, { workspaceId: 'workspace', token: 'attempt-B', owner: 'worker-B', nowMs: now });
    const successor = { ...f.build, abort: new AbortController() } as RunningBuild;
    const before = structuredClone(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/workspace`));
    f.build.requiresBodyExit = true;
    const timer = startBuildLeaseHeartbeat({ store: f.db, workspaceId: 'workspace', token: 'attempt-A', admittedAt: now,
      build: () => f.build, current: () => successor, active: () => true, release: f.released, lost: f.lost });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(f.build.abort.signal.aborted).toBe(true);
    expect(successor.abort.signal.aborted).toBe(false);
    expect(f.lost).toHaveBeenCalledTimes(1);
    expect(f.released).not.toHaveBeenCalled();
    expect(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/workspace`)).toEqual(before);
    f.build.exited = true;
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(f.released).toHaveBeenCalledTimes(1);
    expect(f.docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/workspace`)).toEqual(before);
    clearInterval(timer);
  });
});
