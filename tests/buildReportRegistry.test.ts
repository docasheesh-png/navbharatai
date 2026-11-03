import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { buildReportOutcome, planRegistryWrite, runBuildReportNumbering, backfillOrder } from '../src/server/lib/buildReportRegistry';
import { commitDiagnosticsHistory } from '../src/server/AgentV3/diagnosticsHistoryPersistence';
import { readBuildReportList, readBuildReportWithDigest } from '../src/server/lib/buildReportList';
import { failedReportDigest, readFailedBuildPage } from '../src/server/lib/failedBuildReports';

/**
 * The build report registry (admin 2026-11-02: "sabhi build report failedbr me aye … numbering rocksolid
 * karo"). One permanent number per report, every outcome, given once and never changed.
 */
const COUNTER = 'admin_build_report_counter/counter';
const entry = (ws: string, start: number) => `build_report_numbers/${ws}~${start}`;

/** In-memory Firestore: ordered queries, cursors, field masks and serializable transactions. */
function fakeFirestore() {
  const docs = new Map<string, any>();
  let failNextTransaction = false;
  const snap = (path: string) => ({ id: path.split('/').at(-1)!, exists: docs.has(path), data: () => docs.get(path), ref: ref(path) });
  const query = (path: string, o: { field?: string; dir?: string; after?: unknown; cap?: number } = {}): any => ({
    orderBy: (field: unknown, dir = 'asc') => query(path, { ...o, field: typeof field === 'string' ? field : undefined, dir }),
    startAfter: (after: unknown) => query(path, { ...o, after }),
    limit: (cap: number) => query(path, { ...o, cap }),
    select: () => query(path, o),
    doc: (id: string) => ref(`${path}/${id}`),
    get: async () => {
      const depth = path.split('/').length + 1;
      let rows = [...docs.keys()].filter(p => p.startsWith(`${path}/`) && p.split('/').length === depth).map(snap);
      const key = (s: any) => o.field ? s.data()?.[o.field] : s.id;
      rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (o.dir === 'desc' ? -1 : 1));
      if (o.after !== undefined) {
        const bound = o.after && typeof o.after === 'object' ? key(o.after) : o.after;
        rows = rows.filter(s => o.dir === 'desc' ? key(s) < (bound as any) : key(s) > (bound as any));
      }
      rows = rows.slice(0, o.cap ?? Infinity);
      return { docs: rows, size: rows.length, empty: rows.length === 0 };
    },
  });
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (id: string) => query(`${path}/${id}`), get: async () => snap(path) });
  const write = (path: string, value: any, merge?: boolean) => docs.set(path, structuredClone(merge ? { ...docs.get(path), ...value } : value));
  const db: any = {
    collection: (path: string) => query(path),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      if (failNextTransaction) { failNextTransaction = false; throw new Error('synthetic crash'); }
      const pending: Array<[string, any, boolean | undefined]> = [];
      const result = await fn({
        get: async (r: any) => snap(r.path),
        set: (r: any, value: any, options?: { merge?: boolean }) => { pending.push([r.path, value, options?.merge]); },
      });
      for (const w of pending) write(...w);
      return result;
    },
  };
  return { db, docs, crashNextTransaction: () => { failNextTransaction = true; } };
}
const history = (docs: Map<string, any>, ws: string, report: Record<string, unknown> & { startedAt: number }, extra: Record<string, unknown> = {}) => {
  docs.set(`workspace_diagnostics_v3/${ws}`, { historyAvailable: true, ...(docs.get(`workspace_diagnostics_v3/${ws}`) ?? {}) });
  docs.set(`workspace_diagnostics_v3/${ws}/history/${report.startedAt}`, { report, savedAt: report.startedAt + 5, ...extra });
};
const failed = (startedAt: number, extra: Record<string, unknown> = {}) => ({ startedAt, endedAt: startedAt + 1, ok: false, prompt: `App ${startedAt}\nmore`, rootCause: 'Synthetic', ...extra });
const succeeded = (startedAt: number) => ({ startedAt, endedAt: startedAt + 1, ok: true, prompt: `App ${startedAt}` });
const stopped = (startedAt: number) => failed(startedAt, { issues: [{ code: 'OUTCOME_USER_STOPPED' }] });
const numberOf = (docs: Map<string, any>, ws: string, start: number) => docs.get(entry(ws, start))?.number;
afterEach(() => { state.db = null; });

describe('outcome and the pure write plan', () => {
  it('classifies every outcome from the report alone', () => {
    expect(buildReportOutcome({ startedAt: 1 })).toBe('unfinished');
    expect(buildReportOutcome(succeeded(1), true)).toBe('unfinished');
    expect(buildReportOutcome(succeeded(1))).toBe('succeeded');
    expect(buildReportOutcome(failed(1))).toBe('failed');
    expect(buildReportOutcome(stopped(1))).toBe('stopped');
    expect(buildReportOutcome({ startedAt: 5, endedAt: 4, ok: false })).toBe('unfinished');
    expect(buildReportOutcome(null)).toBe('unfinished');
  });
  it('an existing number is kept whatever the counter says; a new one needs a ready counter', () => {
    const input = { workspaceId: 'w', historyId: '10', report: failed(10), savedAt: 20 };
    const kept = planRegistryWrite({ number: 4, workspaceId: 'w', historyId: '10', startedAt: 10, endedAt: null, outcome: 'unfinished', numberedAt: 11, lastSavedAt: 11 }, { state: 'ready', nextNumber: 99 }, input);
    expect(kept).toEqual({ entry: expect.objectContaining({ number: 4, outcome: 'failed', endedAt: 11, numberedAt: 11, lastSavedAt: 20 }) });
    expect(planRegistryWrite(undefined, { state: 'ready', nextNumber: 9 }, input)).toEqual({
      entry: { number: 9, workspaceId: 'w', historyId: '10', startedAt: 10, endedAt: 11, outcome: 'failed', numberedAt: 20, lastSavedAt: 20 },
      counter: { nextNumber: 10, updatedAt: 20 },
    });
    for (const counter of [undefined, {}, { state: 'backfilling', nextNumber: 9 }, { state: 'ready', nextNumber: 0 }]) expect(planRegistryWrite(undefined, counter, input)).toEqual({});
  });
  it('orders a backfill oldest first, ties broken by workspace, independent of input order', () => {
    const items = [{ workspaceId: 'b', report: { startedAt: 5 } }, { workspaceId: 'a', report: { startedAt: 5 } }, { workspaceId: 'z', report: { startedAt: 1 } }];
    expect(backfillOrder(items).map(i => i.workspaceId)).toEqual(['z', 'a', 'b']);
    expect(backfillOrder([...items].reverse()).map(i => i.workspaceId)).toEqual(['z', 'a', 'b']);
  });
});

describe('the one-time numbering of reports saved before the registry', () => {
  it('🔒 numbers EVERY outcome oldest-first (#1 = oldest), including legacy latest-only reports, then hands over to live writes', async () => {
    const { db, docs } = fakeFirestore();
    history(docs, 'ws-b', succeeded(300));
    history(docs, 'ws-a', failed(100));
    history(docs, 'ws-a', stopped(400));
    history(docs, 'ws-c', { startedAt: 200 }, { inProgress: true });
    docs.set('workspace_diagnostics_v3/ws-legacy', { report: failed(50), savedAt: 60 }); // pre-history report
    expect(await runBuildReportNumbering(db, 'runner-1')).toEqual({ status: 'numbered', numbered: 5, swept: 0 });
    expect([numberOf(docs, 'ws-legacy', 50), numberOf(docs, 'ws-a', 100), numberOf(docs, 'ws-c', 200), numberOf(docs, 'ws-b', 300), numberOf(docs, 'ws-a', 400)]).toEqual([1, 2, 3, 4, 5]);
    expect(docs.get(entry('ws-legacy', 50))).toMatchObject({ historyId: 'latest', outcome: 'failed' });
    expect(docs.get(entry('ws-a', 400)).outcome).toBe('stopped');
    expect(docs.get(entry('ws-c', 200)).outcome).toBe('unfinished');
    expect(docs.get(COUNTER)).toMatchObject({ state: 'ready', nextNumber: 6 });
    // From here every new report numbers itself in its own history write.
    await commitDiagnosticsHistory(db, 'ws-new', succeeded(900), 905);
    expect(numberOf(docs, 'ws-new', 900)).toBe(6);
  });

  it('is idempotent: a second run is one read and changes nothing', async () => {
    const { db, docs } = fakeFirestore();
    history(docs, 'ws', failed(100));
    await runBuildReportNumbering(db, 'runner-1');
    const before = structuredClone([...docs]);
    expect(await runBuildReportNumbering(db, 'runner-2')).toEqual({ status: 'ready', numbered: 0, swept: 0 });
    expect([...docs]).toEqual(before);
  });

  it('a live write during the backfill stays unnumbered (never jumps ahead), then the sweep numbers it', async () => {
    const { db, docs } = fakeFirestore();
    history(docs, 'old', failed(100));
    docs.set(COUNTER, { state: 'backfilling', nextNumber: 1, leaseOwner: 'other', leaseUntil: 0 }); // an expired lease
    await commitDiagnosticsHistory(db, 'live', failed(500), 505);
    expect(numberOf(docs, 'live', 500)).toBeUndefined();
    const result = await runBuildReportNumbering(db, 'runner-1');
    expect(numberOf(docs, 'old', 100)).toBe(1);
    expect(numberOf(docs, 'live', 500)).toBe(2);
    expect(result.status).toBe('numbered');
  });

  it('a live lease held by another runner is respected: nothing is numbered twice', async () => {
    const { db, docs } = fakeFirestore();
    history(docs, 'ws', failed(100));
    docs.set(COUNTER, { state: 'backfilling', nextNumber: 1, leaseOwner: 'other', leaseUntil: Date.now() + 60_000 });
    expect(await runBuildReportNumbering(db, 'runner-1')).toEqual({ status: 'busy', numbered: 0, swept: 0 });
    expect(numberOf(docs, 'ws', 100)).toBeUndefined();
  });

  it('a crash mid-way leaves a numbered prefix; the next runner continues after it, still oldest-first', async () => {
    const { db, docs, crashNextTransaction } = fakeFirestore();
    // 250 reports: more than one 200-row chunk.
    for (let i = 1; i <= 250; i++) history(docs, `ws-${String(i).padStart(3, '0')}`, failed(i * 10));
    const original = db.runTransaction;
    let calls = 0;
    db.runTransaction = async (fn: any) => { calls++; if (calls === 3) crashNextTransaction(); return original(fn); };
    await expect(runBuildReportNumbering(db, 'runner-1')).rejects.toThrow('synthetic crash');
    db.runTransaction = original;
    expect(numberOf(docs, 'ws-001', 10)).toBe(1);
    expect(numberOf(docs, 'ws-201', 2010)).toBeUndefined();
    docs.set(COUNTER, { ...docs.get(COUNTER), leaseUntil: 0 }); // the dead runner's lease runs out
    await runBuildReportNumbering(db, 'runner-2');
    const numbers = Array.from({ length: 250 }, (_, i) => numberOf(docs, `ws-${String(i + 1).padStart(3, '0')}`, (i + 1) * 10));
    expect(numbers).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(docs.get(COUNTER)).toMatchObject({ state: 'ready', nextNumber: 251 });
  });

  it('an invalid counter is reported, never repaired by guessing', async () => {
    const { db, docs } = fakeFirestore();
    history(docs, 'ws', failed(100));
    docs.set(COUNTER, { state: 'ready', nextNumber: 'seven' });
    expect((await runBuildReportNumbering(db, 'runner-1')).status).toBe('counter_invalid');
    expect(numberOf(docs, 'ws', 100)).toBeUndefined();
  });
});

describe('list_build_reports: every outcome, filter and sort by permanent number', () => {
  async function seededList() {
    const f = fakeFirestore(); state.db = f.db;
    f.docs.set(COUNTER, { state: 'ready', nextNumber: 1 });
    await commitDiagnosticsHistory(f.db, 'ws-a', failed(100), 105);      // #1
    await commitDiagnosticsHistory(f.db, 'ws-b', succeeded(200), 205);   // #2
    await commitDiagnosticsHistory(f.db, 'ws-a', stopped(300), 305);     // #3
    await commitDiagnosticsHistory(f.db, 'ws-c', { startedAt: 400 }, 405, true); // #4 unfinished
    await commitDiagnosticsHistory(f.db, 'ws-b', failed(500), 505);      // #5
    return f;
  }
  it('lists every outcome, newest first by default, with the same number the writer gave', async () => {
    await seededList();
    const page = await readBuildReportList();
    expect(page.reports.map(r => [r.number, r.outcome])).toEqual([[5, 'failed'], [4, 'unfinished'], [3, 'stopped'], [2, 'succeeded'], [1, 'failed']]);
    expect(page.nextCursor).toBeNull();
    expect(page.numbering).toEqual({ state: 'ready', highestAssigned: 5 });
    expect(page.reports[0]).toMatchObject({ workspaceId: 'ws-b', historyId: '500', appLabel: 'App 500', retained: true, reportDigest: failedReportDigest(failed(500)) });
  });
  it('filters by outcome and sorts oldest first', async () => {
    await seededList();
    expect((await readBuildReportList({ outcome: 'failed', order: 'oldest' })).reports.map(r => r.number)).toEqual([1, 5]);
    expect((await readBuildReportList({ outcome: 'succeeded' })).reports.map(r => r.number)).toEqual([2]);
    expect((await readBuildReportList({ outcome: 'stopped' })).reports.map(r => r.number)).toEqual([3]);
    expect((await readBuildReportList({ outcome: 'unfinished' })).reports.map(r => r.number)).toEqual([4]);
  });
  it('pages with a cursor that never repeats or skips, and that only works with its own filter and order', async () => {
    await seededList();
    const seen: number[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await readBuildReportList({ order: 'oldest', limit: 2, cursor: cursor ?? undefined });
      seen.push(...page.reports.map(r => r.number));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    const first = await readBuildReportList({ order: 'oldest', limit: 2 });
    await expect(readBuildReportList({ order: 'newest', limit: 2, cursor: first.nextCursor! })).rejects.toThrow('different sort or filter');
    await expect(readBuildReportList({ outcome: 'failed', order: 'oldest', cursor: first.nextCursor! })).rejects.toThrow('different sort or filter');
  });
  it('rejects bad input instead of returning an empty list', async () => {
    await seededList();
    for (const args of [{ outcome: 'bogus' }, { order: 'sideways' }, { limit: 0 }, { limit: 51 }, { cursor: 'not-a-cursor' }]) {
      await expect(readBuildReportList(args)).rejects.toThrow();
    }
    state.db = null;
    await expect(readBuildReportList()).rejects.toThrow('unavailable');
  });
  it('says honestly when a numbered report is no longer retained, and keeps its number reserved', async () => {
    const { docs } = await seededList();
    docs.delete('workspace_diagnostics_v3/ws-a/history/100');
    const oldest = (await readBuildReportList({ order: 'oldest', limit: 1 })).reports[0];
    expect(oldest).toMatchObject({ number: 1, retained: false, reportDigest: null, appLabel: null });
  });
  it('get_build_report reads any outcome with its number and the digest of exactly what it returns', async () => {
    await seededList();
    const ok = await readBuildReportWithDigest('ws-b', '200');
    expect(ok).toMatchObject({ number: 2, outcome: 'succeeded', reportDigest: failedReportDigest(succeeded(200)) });
    expect(await readBuildReportWithDigest('ws-b', '999')).toBeNull();
    await expect(readBuildReportWithDigest('../x', '1')).rejects.toThrow('Invalid report reference');
  });
});

describe('🔢 the failed list is NEWEST FIRST: row 1 of page 1 is the newest failed build (admin 2026-11-02)', () => {
  async function seeded() {
    const f = fakeFirestore(); state.db = f.db;
    f.docs.set(COUNTER, { state: 'ready', nextNumber: 1 });
    await commitDiagnosticsHistory(f.db, 'ws-z', failed(100), 105);      // #1 failed
    await commitDiagnosticsHistory(f.db, 'ws-a', succeeded(200), 205);   // #2 not a failure
    await commitDiagnosticsHistory(f.db, 'ws-m', stopped(300), 305);     // #3 user-stopped (ok=false: listed)
    await commitDiagnosticsHistory(f.db, 'ws-b', { startedAt: 400 }, 405, true); // #4 unfinished: not listed
    await commitDiagnosticsHistory(f.db, 'ws-a', failed(500), 505);      // #5 failed — the newest failure
    return f;
  }
  it('🔒 the first row is the newest failure, by permanent number, whatever workspace it is in', async () => {
    await seeded();
    const page = await readFailedBuildPage();
    expect(page.reports.map((r) => r.permanentReportId)).toEqual([5, 3, 1]);
    expect(page.reports[0]).toMatchObject({ workspaceId: 'ws-a', historyId: '500', numbering: { ordinal: 5, total: 5 } });
    expect(page.observation?.ordering).toBe('newest-first');
    expect(page.nextCursor).toBeNull();
  });
  it('pages without repeating or skipping, and refuses a cursor from the old workspace order', async () => {
    await seeded();
    const seen: number[] = [];
    let page = await readFailedBuildPage(undefined, 1);
    for (;;) {
      seen.push(...page.reports.map((r) => r.permanentReportId!));
      if (!page.nextCursor) break;
      page = await readFailedBuildPage(page.nextCursor, 1);
    }
    expect(seen).toEqual([5, 3, 1]);
    const oldCursor = Buffer.from(JSON.stringify({ v: 1, w: 'ws-a', b: '', after: false })).toString('base64url');
    await expect(readFailedBuildPage(oldCursor)).rejects.toThrow('older workspace order');
  });
  it('a numbered report that has expired is a gap, never a broken row', async () => {
    const { docs } = await seeded();
    docs.delete('workspace_diagnostics_v3/ws-a/history/500');
    expect((await readFailedBuildPage()).reports.map((r) => r.permanentReportId)).toEqual([3, 1]);
  });
  it('a report the history write never numbered is numbered by the daily re-sweep, then listed in its place', async () => {
    const f = fakeFirestore(); state.db = f.db;
    history(f.docs, 'ws-old', failed(100));
    await runBuildReportNumbering(f.db, 'runner-1');
    // A stray: its history exists but its registry row does not (a write that failed half-way).
    history(f.docs, 'ws-stray', failed(900));
    expect(await runBuildReportNumbering(f.db, 'runner-1')).toEqual({ status: 'ready', numbered: 0, swept: 0 }); // swept today
    f.docs.set(COUNTER, { ...f.docs.get(COUNTER), sweptAt: 1 }); // a day later
    expect(await runBuildReportNumbering(f.db, 'runner-1')).toMatchObject({ status: 'numbered', swept: 1 });
    expect((await readFailedBuildPage()).reports.map((r) => r.workspaceId)).toEqual(['ws-stray', 'ws-old']);
  });
});
