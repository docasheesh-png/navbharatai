import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimWorkspaceBuild, claimWorkspaceBuildAwaitingRelease, releaseWorkspaceBuild, renewWorkspaceBuildDetailed, type BuildLeaseStore } from '../src/server/AgentV3/workspaceBuildLease';

// DNA failedbr 628 (MP3 Converter) / Hello #616: lease ownership could not be confirmed → INTERRUPTED.
afterEach(() => vi.useRealTimers());
function store() {
  const docs = new Map<string, any>();
  const db: BuildLeaseStore = {
    collection: (name) => ({ doc: (id) => `${name}/${id}` }),
    runTransaction: async (body) => body({ get: async (ref) => ({ exists: docs.has(String(ref)), data: () => docs.get(String(ref)) }), set: (ref, value) => { docs.set(String(ref), value); }, delete: (ref) => { docs.delete(String(ref)); } }),
  };
  return { db, docs };
}
describe('lease renewal retries transient store errors and names the loss reason', () => {
  it('a transient Firestore error is retried within the beat and confirms the lease', async () => {
    vi.useFakeTimers(); const { db } = store();
    await claimWorkspaceBuild(db, { workspaceId: 'w', token: 'A', owner: 'o' });
    const real = db.runTransaction.bind(db); let fails = 1;
    db.runTransaction = (async (body: any) => { if (fails-- > 0) throw new Error('UNAVAILABLE: transient'); return real(body); }) as any;
    const p = renewWorkspaceBuildDetailed(db, { workspaceId: 'w', token: 'A' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toMatchObject({ renewal: 'held', attempts: 2 });
  });
  it('persistent errors → unknown with reason store-error; hangs → timeout', async () => {
    vi.useFakeTimers(); const { db } = store();
    db.runTransaction = async () => { throw new Error('offline'); };
    const a = renewWorkspaceBuildDetailed(db, { workspaceId: 'w', token: 'A' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await a).toMatchObject({ renewal: 'unknown', reason: 'store-error', attempts: 3, error: 'offline' });
    db.runTransaction = () => new Promise(() => {});
    const b = renewWorkspaceBuildDetailed(db, { workspaceId: 'w', token: 'A' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await b).toMatchObject({ renewal: 'unknown', reason: 'timeout', attempts: 3 });
  });
  it('a definite loss is not retried and says other-owner vs missing', async () => {
    const { db } = store();
    await claimWorkspaceBuild(db, { workspaceId: 'w', token: 'B', owner: 'o2' });
    expect(await renewWorkspaceBuildDetailed(db, { workspaceId: 'w', token: 'A' })).toMatchObject({ renewal: 'lost', reason: 'other-owner', attempts: 1 });
    expect(await renewWorkspaceBuildDetailed(db, { workspaceId: 'x', token: 'A' })).toMatchObject({ renewal: 'lost', reason: 'missing', attempts: 1 });
  });
});
describe('Continue waits for the previous run to release', () => {
  it('claims as soon as the draining run releases, within the wait', async () => {
    vi.useFakeTimers(); const { db } = store();
    await claimWorkspaceBuild(db, { workspaceId: 'w', token: 'A', owner: 'worker-A' });
    const p = claimWorkspaceBuildAwaitingRelease(db, { workspaceId: 'w', token: 'B', owner: 'worker-B', waitMs: 12_000, pollMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_500);
    await releaseWorkspaceBuild(db, { workspaceId: 'w', token: 'A' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toMatchObject({ ok: true });
  });
  it('a live holder that never releases is still honestly busy after the wait', async () => {
    vi.useFakeTimers(); const { db } = store();
    await claimWorkspaceBuild(db, { workspaceId: 'w', token: 'A', owner: 'worker-A' });
    const p = claimWorkspaceBuildAwaitingRelease(db, { workspaceId: 'w', token: 'B', owner: 'worker-B', waitMs: 3_000, pollMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toMatchObject({ ok: false, reason: 'busy' });
  });
});
