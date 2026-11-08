import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('./workspaceBuildLease', async (orig) => ({ ...(await orig<object>()), renewWorkspaceBuild: vi.fn(async () => 'unknown') }));
import { startBuildLeaseHeartbeat } from './BuildRequestCoordination';
import { LEASE_HEARTBEAT_MS } from './workspaceBuildLease';

afterEach(() => vi.useRealTimers());
describe('lease heartbeat grace (05012 OUTCOME_AUTHORITY_UNAVAILABLE)', () => {
  it('one unknown renewal does not abort; sustained unknown does', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const build = { abort, exited: false, ended: false } as never;
    const timer = startBuildLeaseHeartbeat({ store: {} as never, workspaceId: 'w', token: 't', admittedAt: Date.now(),
      build: () => build, current: () => build, active: () => true, release: async () => {}, lost: () => {} });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(abort.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 3);
    expect(abort.signal.aborted).toBe(true);
    clearInterval(timer);
  });
});
