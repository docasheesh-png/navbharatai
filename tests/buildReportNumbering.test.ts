import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { numberBuildReports, readBuildReportNumbers } from '../src/server/lib/buildReportNumbering';
import { isBuildReportNumbering } from '../src/lib/buildReportNumbering';

/**
 * 🔴 THE DEFECT THIS FILE LOCKS (admin 2026-11-02: "numbering bhi stable nahi hai"). A report's number used
 * to be its RANK among the retained reports, recomputed on every read — so a report expiring off the
 * retention clock, or a late one arriving, moved every number after it. A number is now a stored fact
 * about one report (the build report registry), read by the report's own identity.
 */
const COUNTER = 'admin_build_report_counter/counter';
const entry = (workspaceId: string, startedAt: number) => `build_report_numbers/${workspaceId}~${startedAt}`;

function database(docs: Map<string, any>, opts: { fail?: boolean } = {}) {
  const reads: string[] = [];
  const ref = (path: string) => ({ path, get: async () => {
    reads.push(path);
    if (opts.fail) throw new Error('synthetic private storage failure: projects/secret-project');
    return { exists: docs.has(path), data: () => docs.get(path) };
  } });
  return { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }), reads };
}
const rows = (...entries: Array<[string, number, string?]>) => entries.map(([workspaceId, startedAt, historyId]) => ({ workspaceId, startedAt, historyId: historyId ?? String(startedAt) }));
const number = (cohort: 'latest' | 'failed', entries: ReturnType<typeof rows>) => numberBuildReports(cohort, entries, r => r.historyId);
const seeded = (numbers: Array<[string, number, number]>, nextNumber = numbers.length + 1) => {
  const docs = new Map<string, any>([[COUNTER, { state: 'ready', nextNumber }]]);
  for (const [ws, start, n] of numbers) docs.set(entry(ws, start), { number: n, workspaceId: ws, startedAt: start });
  return docs;
};
afterEach(() => { state.db = null; });

describe('a build report number is a permanent stored fact, never a recomputed rank', () => {
  it('returns each report its stored number, whatever the request order or cohort', async () => {
    state.db = database(seeded([['b', 300, 1], ['a', 100, 2], ['c', 200, 3]]));
    const failed = await number('failed', rows(['c', 200], ['a', 100], ['b', 300]));
    expect(failed.map(r => [r.workspaceId, r.numbering.ordinal, r.numbering.total])).toEqual([['c', 3, 3], ['a', 2, 3], ['b', 1, 3]]);
    const latest = await number('latest', rows(['a', 100]));
    expect(latest[0].numbering.ordinal).toBe(2); // the same report has the same number on every screen
    expect(failed.every(r => isBuildReportNumbering(r.numbering))).toBe(true);
  });

  it('🔒 a report expiring or being erased moves NO other number (the reported instability)', async () => {
    const docs = seeded([['a', 100, 1], ['b', 200, 2], ['c', 300, 3]]);
    state.db = database(docs);
    const before = await number('failed', rows(['b', 200], ['c', 300]));
    docs.delete(entry('a', 100)); // report #1 left the retention window
    const after = await number('failed', rows(['b', 200], ['c', 300]));
    expect(after.map(r => r.numbering.ordinal)).toEqual(before.map(r => r.numbering.ordinal));
    expect(after.map(r => r.numbering.ordinal)).toEqual([2, 3]);
    expect(after[0].numbering.total).toBe(3); // the highest number ever given; #1 is a gap, never reissued
  });

  it('🔒 a late-arriving OLDER report takes a new number and moves nobody else', async () => {
    const docs = seeded([['a', 200, 1], ['b', 300, 2]]);
    state.db = database(docs);
    docs.set(entry('late', 100), { number: 3 }); docs.set(COUNTER, { state: 'ready', nextNumber: 4 });
    const result = await number('failed', rows(['a', 200], ['b', 300], ['late', 100]));
    expect(result.map(r => r.numbering.ordinal)).toEqual([1, 2, 3]);
  });

  it('identity is workspace AND start time: a replaced report never inherits the old number', async () => {
    state.db = database(seeded([['a', 100, 1]]));
    const [replaced] = await number('latest', rows(['a', 999]));
    expect(replaced.numbering).toEqual({ ordinal: null, total: null, asOf: null, reason: 'not_numbered' });
  });

  it('says WHY a number is missing, and never substitutes a position', async () => {
    state.db = database(new Map());
    expect((await number('failed', rows(['a', 100])))[0].numbering).toMatchObject({ ordinal: null, reason: 'numbering_pending' });
    state.db = database(new Map([[COUNTER, { state: 'backfilling', nextNumber: 9 }]]));
    expect((await number('failed', rows(['a', 100])))[0].numbering).toMatchObject({ ordinal: null, reason: 'numbering_pending' });
    state.db = database(seeded([]));
    expect((await number('failed', rows(['a', 100])))[0].numbering).toMatchObject({ ordinal: null, reason: 'not_numbered' });
    expect((await number('failed', rows(['a', NaN])))[0].numbering).toMatchObject({ ordinal: null, reason: 'invalid_timestamp' });
    state.db = null;
    expect((await number('failed', rows(['a', 100])))[0].numbering).toMatchObject({ ordinal: null, reason: 'storage_unavailable' });
  });

  it('a storage failure is reported as unavailable without leaking the database error', async () => {
    state.db = database(seeded([['a', 100, 1]]), { fail: true });
    const result = await number('failed', rows(['a', 100]));
    expect(result[0].numbering).toEqual({ ordinal: null, total: null, asOf: null, reason: 'storage_unavailable' });
    expect(JSON.stringify(result)).not.toContain('secret-project');
  });

  it('reads one registry row per requested report and nothing else — no scan of the inventory', async () => {
    const db = database(seeded([['a', 100, 1], ['b', 200, 2]]));
    state.db = db;
    await number('latest', rows(['a', 100], ['b', 200]));
    expect(db.reads.sort()).toEqual([COUNTER, entry('a', 100), entry('b', 200)].sort());
  });

  it('accepts only bounded metadata references and never reflects extra report or credential fields', async () => {
    state.db = database(seeded([['a', 100, 1]]));
    const result = await readBuildReportNumbers('latest', [{ workspaceId: 'a', historyId: '100', startedAt: 100, prompt: 'private synthetic prompt', token: 'synthetic secret' }]);
    expect(Object.keys(result[0]).sort()).toEqual(['historyId', 'numbering', 'startedAt', 'workspaceId']);
    expect(result[0].numbering.ordinal).toBe(1);
    for (const raw of [null, {}, [{ workspaceId: '../bad', historyId: '100', startedAt: 100 }], [{ workspaceId: 'a', historyId: 'bad/path', startedAt: 100 }], [{ workspaceId: 'a', historyId: '200', startedAt: 100 }], Array(501).fill({ workspaceId: 'a', historyId: '100', startedAt: 100 })]) await expect(readBuildReportNumbers('latest', raw)).rejects.toThrow();
    await expect(readBuildReportNumbers('failed', Array(51).fill({ workspaceId: 'a', historyId: '100', startedAt: 100 }))).rejects.toThrow();
  });

  it('🔒 CLASS LOCK: no report reader computes a number by sorting or by position', () => {
    // The class is "a number derived from where a report sits in a list". Any reader that sorts reports
    // and hands out `index + 1` re-creates it, whatever it is called.
    for (const file of ['src/server/lib/buildReportNumbering.ts', 'src/server/lib/failedBuildReports.ts', 'src/server/lib/buildReportList.ts', 'src/server/routes/failedReports.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/ordinal:\s*(?:index|i|idx|position)\s*\+\s*1/);
      expect(source, file).not.toMatch(/\branks\b/);
    }
  });
});
