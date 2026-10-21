import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { numberBuildReports, readBuildReportNumbers } from '../src/server/lib/buildReportNumbering';
import { isBuildReportNumbering } from '../src/lib/buildReportNumbering';

type Report = { startedAt: number; endedAt?: number; ok?: boolean };
type Workspace = { report?: Report; savedAt?: number; history?: Record<string, Report> };
const failure = (startedAt: number): Report => ({ startedAt, endedAt: startedAt + 1, ok: false });
function database(source: Record<string, Workspace>) {
  const reads: string[][] = [];
  let transactions = 0;
  const query = (rows: any[], offset = '', limit = Infinity, fields: string[] = []): any => ({
    rows, offset, take: limit, fields,
    orderBy: () => query(rows, offset, limit, fields),
    startAfter: (doc: { id: string }) => query(rows, doc.id, limit, fields),
    limit: (n: number) => query(rows, offset, n, fields),
    select: (...selected: string[]) => query(rows, offset, limit, selected),
  });
  const doc = (id: string, data: unknown, history?: Record<string, Report>) => ({ id, data: () => data,
    ref: { collection: () => query(Object.entries(history ?? {}).sort(([a], [b]) => a < b ? -1 : 1).map(([key, report]) => doc(key, { report }))) } });
  const db = { collection: () => query(Object.keys(source).sort().map(id => doc(id, source[id], source[id].history))),
    runTransaction: vi.fn(async (fn: (tx: any) => unknown, options: unknown) => {
      transactions++; expect(options).toEqual({ readOnly: true });
      return fn({ get: async (q: any) => {
        reads.push(q.fields);
        const docs = q.rows.filter((d: any) => d.id > q.offset).slice(0, q.take);
        return { docs, size: docs.length };
      } });
    }), reads, transactionCount: () => transactions };
  return db;
}
const rows = (...entries: Array<[string, number, string?]>) => entries.map(([workspaceId, startedAt, historyId]) => ({ workspaceId, startedAt, historyId: historyId ?? String(startedAt) }));
const number = (cohort: 'latest' | 'failed', entries: ReturnType<typeof rows>) => numberBuildReports(cohort, entries, r => r.historyId);
beforeEach(() => { state.db = null; });
afterEach(() => { vi.useRealTimers(); });

describe('chronological numbers are complete-cohort metadata, not page positions', () => {
  it('ranks actual start time, not workspace order, save time, history ID or requested row order', async () => {
    state.db = database({ a: { report: failure(300), savedAt: 10, history: { '2': failure(300) } }, z: { report: failure(100), savedAt: 999, history: { '999': failure(100) } } });
    expect((await number('latest', rows(['a', 300], ['z', 100]))).map(r => r.numbering.ordinal)).toEqual([2, 1]);
    expect((await number('failed', rows(['a', 300, '2'], ['z', 100, '999']))).map(r => r.numbering.ordinal)).toEqual([3, 1]);
    // Mismatched history IDs mean the latest-only records are separate retained references too.
  });
  it('uses separate cohorts and excludes successes/in-progress from failures', async () => {
    state.db = database({ a: { report: { ...failure(300), ok: true }, savedAt: 300, history: { '100': failure(100), '200': { startedAt: 200, ok: false }, '300': { ...failure(300), ok: true } } }, b: { report: failure(400), savedAt: 400, history: { '400': failure(400) } } });
    expect((await number('latest', rows(['b', 400])))[0].numbering).toMatchObject({ ordinal: 2, total: 2 });
    expect((await number('failed', rows(['a', 100], ['b', 400]))).map(r => r.numbering)).toEqual([
      expect.objectContaining({ ordinal: 1, total: 2 }), expect.objectContaining({ ordinal: 2, total: 2 }),
    ]);
  });
  it('ties use stable workspace/history identity across filtered and paginated requests', async () => {
    state.db = database({ z: { report: failure(100), savedAt: 100, history: { '100': failure(100) } }, a: { report: failure(100), savedAt: 100, history: { '100': failure(100) } } });
    expect((await number('failed', rows(['z', 100])))[0].numbering.ordinal).toBe(2);
    expect((await number('failed', rows(['a', 100])))[0].numbering.ordinal).toBe(1);
    expect(state.db.transactionCount()).toBe(1);
  });
  it('includes legacy latest-only failures exactly once, but not latest duplicated by history', async () => {
    state.db = database({ a: { report: failure(100), savedAt: 100 }, b: { report: failure(200), savedAt: 200, history: { '200': failure(200) } } });
    expect((await number('failed', rows(['a', 100, 'latest'], ['b', 200]))).map(r => r.numbering.ordinal)).toEqual([1, 2]);
  });
  it('does not number an invalid timestamp or invent chronology from savedAt', async () => {
    state.db = database({ a: { report: { startedAt: NaN }, savedAt: 100 }, b: { report: failure(200), savedAt: 200 } });
    expect((await number('latest', rows(['b', 200])))[0].numbering.ordinal).toBeNull();
  });
  it('excludes parents absent from the existing savedAt-ordered latest list', async () => {
    state.db = database({ a: { report: failure(100) }, b: { report: failure(200), savedAt: 200 } });
    expect((await number('latest', rows(['b', 200])))[0].numbering).toMatchObject({ ordinal: 1, total: 1 });
  });
  it('never loads report bodies or histories for latest-only numbering; pages beyond 100 roots', async () => {
    const source = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`app${i.toString().padStart(3, '0')}`, { report: failure(i + 1), savedAt: i + 1 }]));
    state.db = database(source);
    expect((await number('latest', rows(['app204', 205])))[0].numbering).toMatchObject({ ordinal: 205, total: 205 });
    expect(state.db.reads).toHaveLength(3);
    for (const fields of state.db.reads) expect(fields).toEqual(['report.startedAt', 'report.endedAt', 'report.ok', 'savedAt']);
  });
  it('walks history pages numerically by actual time despite lexicographic document IDs', async () => {
    const history = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [String(i + 1), failure(i + 1)]));
    state.db = database({ app: { report: failure(205), savedAt: 205, history } });
    expect((await number('failed', rows(['app', 205], ['app', 2]))).map(r => r.numbering.ordinal)).toEqual([205, 2]);
  });
  it('shares in-flight scans, keeps new/replaced rows unnumbered, then refreshes retention after expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
    const source: Record<string, Workspace> = { a: { report: failure(100), savedAt: 100 }, b: { report: failure(200), savedAt: 200 } };
    state.db = database(source);
    const [a, b] = await Promise.all([number('latest', rows(['a', 100])), number('latest', rows(['b', 200]))]);
    expect(state.db.transactionCount()).toBe(1); expect(a[0].numbering.asOf).toBe(b[0].numbering.asOf);
    source.c = { report: failure(300), savedAt: 300 }; delete source.a;
    source.b.report = failure(250);
    expect((await number('latest', rows(['c', 300], ['b', 250]))).every(r => r.numbering.ordinal === null)).toBe(true);
    vi.advanceTimersByTime(600_001);
    const fresh = await number('latest', rows(['b', 250], ['c', 300]));
    expect(fresh.map(r => r.numbering.ordinal)).toEqual([1, 2]);
    expect(fresh[0].numbering.asOf).toBeGreaterThan(b[0].numbering.asOf!);
  });
  it('does not perform reads for empty results or background refreshes', async () => {
    vi.useFakeTimers(); state.db = database({});
    expect(await number('failed', [])).toEqual([]);
    vi.advanceTimersByTime(3_600_000); expect(state.db.transactionCount()).toBe(0);
  });
  it('preserves rows with explicit unavailable numbers when the store fails', async () => {
    state.db = { runTransaction: () => Promise.reject(new Error('unavailable')) };
    const result = await number('failed', rows(['a', 100]));
    expect(result).toEqual([{ workspaceId: 'a', startedAt: 100, historyId: '100', numbering: { ordinal: null, total: null, asOf: null } }]);
  });
  it('bounds workspace and document scans instead of numbering an incomplete prefix', async () => {
    state.db = database(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`a${i}`, { report: failure(i + 1), savedAt: i + 1 }])));
    expect((await number('latest', rows(['a0', 1])))[0].numbering.ordinal).toBeNull();
    const history = Object.fromEntries(Array.from({ length: 5100 }, (_, i) => [String(i + 1), failure(i + 1)]));
    state.db = database({ a: { history } });
    expect((await number('failed', rows(['a', 1])))[0].numbering.ordinal).toBeNull();
    expect(state.db.reads.length).toBeLessThanOrEqual(52);
  });
  it('admits at most eight late history reads and never advances after a timeout', async () => {
    vi.useFakeTimers();
    const source = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`app${i}`, { history: { '100': failure(100) } }]));
    const db = database(source);
    const original = db.runTransaction.getMockImplementation()!;
    const releases: Array<() => void> = [];
    let gets = 0;
    db.runTransaction.mockImplementation((fn, options) => original((tx: any) => fn({ get: async (q: any) => {
      const result = await tx.get(q);
      if (++gets > 1) await new Promise<void>(resolve => releases.push(resolve));
      return result;
    } }), options));
    state.db = db;
    const pending = number('failed', rows(['app0', 100]));
    await vi.advanceTimersByTimeAsync(1);
    expect(releases).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending)[0].numbering.ordinal).toBeNull();
    await vi.advanceTimersByTimeAsync(600_001);
    await number('failed', rows(['app0', 100]));
    expect(db.transactionCount()).toBe(1);
    releases.forEach(release => release());
    await vi.advanceTimersByTimeAsync(0);
    expect(gets).toBe(9); // one root page plus the original eight histories, no further admission
    expect(db.transactionCount()).toBe(1);
  });
  it('accepts only bounded metadata references and never reflects extra report or credential fields', async () => {
    state.db = database({ a: { report: failure(100), savedAt: 100 } });
    const result = await readBuildReportNumbers('latest', [{ workspaceId: 'a', historyId: '100', startedAt: 100, prompt: 'private synthetic prompt', token: 'synthetic secret' }]);
    expect(Object.keys(result[0]).sort()).toEqual(['historyId', 'numbering', 'startedAt', 'workspaceId']);
    for (const raw of [null, {}, [{ workspaceId: '../bad', historyId: '100', startedAt: 100 }], [{ workspaceId: 'a', historyId: 'bad/path', startedAt: 100 }], [{ workspaceId: 'a', historyId: '200', startedAt: 100 }], Array(501).fill({ workspaceId: 'a', historyId: '100', startedAt: 100 })]) await expect(readBuildReportNumbers('latest', raw)).rejects.toThrow();
    await expect(readBuildReportNumbers('failed', Array(51).fill({ workspaceId: 'a', historyId: '100', startedAt: 100 }))).rejects.toThrow();
  });
  it('bounds waiting and shares the unavailable result rather than starting duplicate scans', async () => {
    vi.useFakeTimers();
    state.db = { runTransaction: vi.fn(() => new Promise(() => {})) };
    const pending = number('latest', rows(['a', 1]));
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending)[0].numbering.ordinal).toBeNull();
    await vi.advanceTimersByTimeAsync(600_001);
    await number('latest', rows(['a', 1])); expect(state.db.runTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('numbering response validation', () => {
  it('accepts exact positive ranks and explicit unknown, never fake or malformed values', () => {
    expect(isBuildReportNumbering({ ordinal: 1, total: 2, asOf: 100 })).toBe(true);
    expect(isBuildReportNumbering({ ordinal: null, total: null, asOf: null })).toBe(true);
    for (const value of [undefined, {}, { ordinal: 0, total: 1, asOf: 100 }, { ordinal: 3, total: 2, asOf: 100 }, { ordinal: 1.5, total: 2, asOf: 100 }, { ordinal: 1, total: 2, asOf: NaN }, { ordinal: null, total: 2, asOf: 100 }]) expect(isBuildReportNumbering(value)).toBe(false);
  });
});
