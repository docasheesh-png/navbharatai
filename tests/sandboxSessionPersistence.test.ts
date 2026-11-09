import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { SandboxStore } from '../src/server/AgentV3/SandboxStore';
import type { SandboxSession } from '../src/server/AgentV3/sandboxSessions';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const start = (observationId = A, startedAt = 100): SandboxSession => ({ observationId, sandboxId: 'vm', origin: 'resumed', reason: 'build', startedAt, busyMs: 0, ops: 0 });
const ended = (s = start()): SandboxSession => ({ ...s, endedAt: s.startedAt + 50, endedBy: 'dropped', busyMs: 5, ops: 2 });
const unrelated = { workspaceId: 'ws', sandboxId: 'vm', userId: 'owner', updatedAt: 1, snapshotUrl: 'saved', recipe: { command: 'npm run dev' }, allocation: { opaque: 'keep' }, declaredPort: 4000 };
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(initial: Record<string, unknown> | undefined = { ...unrelated }) {
  let row = initial;
  const counter = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn((_ref: unknown, fields: object) => { row = { ...row, ...structuredClone(fields) }; });
  const db = {
    collection: (name: string) => ({ doc: () => ({ set: name === 'agentv3_sandbox_starts' ? counter : vi.fn(() => { throw Error('No session set allowed'); }) }) }),
    runTransaction: vi.fn(async (cb: (tx: object) => Promise<void>) => cb({
      get: async () => { const copy = row && structuredClone(row); return { exists: copy !== undefined, data: () => copy }; }, update,
    })),
  };
  return { store: new SandboxStore(() => db as unknown as admin.firestore.Firestore), db, update, counter, row: () => row, setRow: (next: typeof row) => { row = next; } };
}
afterEach(() => vi.restoreAllMocks());

describe('local observation persistence, not provider lifetime accounting', () => {
  it('replaces the whole session without old completion fields and preserves every unrelated field', async () => {
    const f = fixture({ ...unrelated, session: ended() });
    const next = start(B, 200);
    await f.store.recordSessionStart('ws', next);
    expect(f.row()).toEqual({ ...unrelated, session: next });
    expect(f.update).toHaveBeenCalledWith(expect.anything(), { session: next });
  });
  it('same ID repeated after end never reopens it; repeated end never changes final numbers', async () => {
    const f = fixture();
    await f.store.recordSessionStart('ws', start());
    await f.store.recordSessionEnd('ws', ended());
    await f.store.recordSessionStart('ws', start());
    await f.store.recordSessionEnd('ws', { ...ended(), busyMs: 999, endedAt: 999 });
    expect(f.row()?.session).toEqual(ended());
    expect(f.counter).toHaveBeenCalledTimes(2); // Deliberately NOT exactly-once.
  });
  it.each([99, 100, 199, 200])('rejects old/tied start timestamp %s and its delayed end', async (time) => {
    const b = start(B, 200);
    const f = fixture({ ...unrelated, session: b });
    await f.store.recordSessionStart('ws', start(A, time));
    await f.store.recordSessionEnd('ws', ended(start(A, time)));
    expect(f.row()?.session).toEqual(b);
  });
  it('documents clock-skew suppression without claiming physical chronology', async () => {
    const future = start(A, 999999);
    const f = fixture({ ...unrelated, session: future });
    await f.store.recordSessionStart('ws', start(B, 200));
    expect(f.row()?.session).toEqual(future);
  });
  it.each([undefined, { ...unrelated, sandboxId: 'other' }, { ...unrelated, workspaceId: 'wrong' }, { workspaceId: 'ws' }])('does not create or repair absent/mismatched identity %#', async (row) => {
    const f = fixture(); f.setRow(row);
    await f.store.recordSessionStart('ws', start());
    await f.store.recordSessionEnd('ws', ended());
    expect(f.row()).toEqual(row); expect(f.update).not.toHaveBeenCalled();
    expect(f.counter).toHaveBeenCalledOnce();
  });
  it.each([null, [], 'bad', {}, { ...start(), startedAt: NaN }, { ...start(), observationId: 'invalid' }, { ...start(), endedAt: 1 }])('leaves malformed predecessor unknown %#', async (session) => {
    const f = fixture({ ...unrelated, session });
    await f.store.recordSessionStart('ws', start(B, 200));
    await f.store.recordSessionEnd('ws', ended());
    expect(f.update).not.toHaveBeenCalled();
  });
  it('can supersede valid legacy telemetry but never matches a legacy end', async () => {
    const legacy = { ...start(), observationId: undefined };
    const f = fixture({ ...unrelated, session: legacy });
    await f.store.recordSessionEnd('ws', { ...ended(), observationId: undefined });
    expect(f.update).not.toHaveBeenCalled();
    await f.store.recordSessionStart('ws', start(B, 200));
    expect(f.row()?.session).toEqual(start(B, 200));
  });
  it.each(['startedAt', 'origin', 'reason', 'sandboxId'] as const)('rejects end with changed immutable %s', async (field) => {
    const f = fixture({ ...unrelated, session: start() });
    const invalid = { ...ended(), [field]: field === 'startedAt' ? 101 : 'other' } as SandboxSession;
    await f.store.recordSessionEnd('ws', invalid);
    expect(f.update).not.toHaveBeenCalled();
  });
  it('end without a prior start is dropped, not invented or applied later', async () => {
    const f = fixture(); await f.store.recordSessionEnd('ws', ended());
    expect(f.row()).toEqual(unrelated);
    await f.store.recordSessionStart('ws', start());
    expect(f.row()?.session).toEqual(start());
  });
  it('waits for original touch but counts independently and captures immutable start data', async () => {
    const f = fixture(); f.setRow(undefined);
    const touch = deferred(); const session = start();
    const writing = f.store.recordSessionStart('ws', session, touch.promise);
    session.ops = 99; session.busyMs = 99;
    expect(f.counter).toHaveBeenCalledOnce(); expect(f.db.runTransaction).not.toHaveBeenCalled();
    f.setRow({ ...unrelated }); touch.resolve(); await writing;
    expect(f.row()?.session).toEqual(start());
  });
  it('counter rejection cannot settle start before pending identity/transaction, releasing end early', async () => {
    const f = fixture(); const touch = deferred(); f.counter.mockRejectedValue(Error('counter unavailable'));
    let settled = false;
    const writing = f.store.recordSessionStart('ws', start(), touch.promise).then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    touch.resolve(); await writing; expect(f.row()?.session).toEqual(start());
  });
  it('a stuck independent counter does not delay a committed observation or its end', async () => {
    const f = fixture(); const counter = deferred(); f.counter.mockReturnValue(counter.promise);
    await f.store.recordSessionStart('ws', start());
    expect(f.row()?.session).toEqual(start());
    await f.store.recordSessionEnd('ws', ended());
    expect(f.row()?.session).toEqual(ended());
    counter.resolve();
  });
  it('touch failure with no record stays unknown; lost ACK with committed identity permits CAS', async () => {
    const f = fixture(); f.setRow(undefined);
    await f.store.recordSessionStart('ws', start(), Promise.reject(Error('touch failed')));
    expect(f.row()).toBeUndefined();
    f.setRow({ ...unrelated });
    await f.store.recordSessionStart('ws', start(), Promise.reject(Error('touch ACK lost')));
    expect(f.row()?.session).toEqual(start());
  });
  it('database failure is swallowed and a later exact end can settle a committed lost-ACK start', async () => {
    const f = fixture();
    f.db.runTransaction.mockRejectedValueOnce(Error('unavailable'));
    await expect(f.store.recordSessionStart('ws', start())).resolves.toBeUndefined();
    expect(f.row()).toEqual(unrelated);
    const original = f.db.runTransaction.getMockImplementation()!;
    f.db.runTransaction.mockImplementationOnce(async (cb) => { await original(cb); throw Error('ACK lost'); });
    await f.store.recordSessionStart('ws', start());
    await f.store.recordSessionEnd('ws', ended());
    expect(f.row()?.session).toEqual(ended());
  });
  it('deletion after initial touch cannot be resurrected by telemetry', async () => {
    const f = fixture(); const touch = deferred();
    const writing = f.store.recordSessionStart('ws', start(), touch.promise);
    f.setRow(undefined); touch.resolve(); await writing;
    await f.store.recordSessionEnd('ws', ended()); expect(f.row()).toBeUndefined();
  });
  it('explicitly retains the old-touch allocation race but does not compound it with stale telemetry', async () => {
    const newer = start(B, 200); const f = fixture({ ...unrelated, sandboxId: 'new-vm', session: { ...newer, sandboxId: 'new-vm' } });
    // This is the pre-existing unconditional touch, NOT a telemetry write or newly authorized repair.
    f.setRow({ ...f.row(), sandboxId: 'vm', updatedAt: 300 });
    await f.store.recordSessionStart('ws', start());
    await f.store.recordSessionEnd('ws', ended({ ...newer, sandboxId: 'new-vm' }));
    expect(f.row()?.sandboxId).toBe('vm');
    expect(f.row()?.session).toEqual({ ...newer, sandboxId: 'new-vm' });
    expect(f.update).not.toHaveBeenCalled();
  });
});
