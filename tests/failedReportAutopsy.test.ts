import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { failedReportDigest } from '../src/server/lib/failedBuildReports';
import { parseFailedReportAutopsy, readFailedReportAutopsy, updateFailedReportAutopsy, withFailedReportAutopsies } from '../src/server/lib/failedReportAutopsy';

const report = { ok: false, startedAt: 100, endedAt: 101, buildId: 'build-1', rootCause: 'Test failure' };
const digest = failedReportDigest(report);
const repo = 'https://github.com/docasheesh-png/navbharatai';
const input = (overrides: Record<string, unknown> = {}) => ({
  expectedRevision: 0, reportDigest: digest, mutationId: '12345678-1234-1234-1234-123456789abc',
  status: 'in_progress', summary: 'Read the retained report; root-cause verification is still in progress.',
  ledgerUrl: '', counts: { total: 2, resolved: 0, blocked: 0 }, blockers: '', verification: null,
  reason: 'Begin itemized review', ...overrides,
});
const proof = { scope: 'source_and_tests', commitSha: 'a'.repeat(40), pullRequestUrl: `${repo}/pull/123`,
  ciRunUrl: `${repo}/actions/runs/456`, testSummary: 'Exact regression fails on reversion and passes on the merged source. No historical app rerun.' };
const done = () => input({ status: 'done', ledgerUrl: `${repo}/blob/${'a'.repeat(40)}/docs/autopsy.md`,
  counts: { total: 2, resolved: 2, blocked: 0 }, verification: proof });
function database() {
  const data = new Map<string, any>([['workspace_diagnostics_v3/app/history/100', { report }]]);
  const writes: string[] = [];
  let serial = Promise.resolve();
  const ref = (path: string): any => ({ path, collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }) });
  const snapshot = (r: any) => ({ exists: data.has(r.path), data: () => structuredClone(data.get(r.path)) });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    getAll: async (...refs: any[]) => refs.map(snapshot),
    runTransaction: (fn: (tx: any) => any) => {
      const run = serial.then(async () => {
        const changes: { ref: any; value: any; create: boolean }[] = [];
        const result = await fn({ get: async (r: any) => snapshot(r),
          set: (r: any, value: any) => changes.push({ ref: r, value, create: false }),
          create: (r: any, value: any) => changes.push({ ref: r, value, create: true }),
        });
        for (const c of changes) if (c.create && data.has(c.ref.path)) throw new Error('Already exists');
        for (const c of changes) { data.set(c.ref.path, structuredClone(c.value)); writes.push(c.ref.path); }
        return result;
      });
      serial = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db, data, writes };
}
beforeEach(() => { state.db = null; });
describe('bounded evidence-bound autopsy metadata', () => {
  it('starts honestly unreviewed and persists a separate current record, immutable revision and receipt', async () => {
    const d = database(); state.db = d.db;
    expect(await readFailedReportAutopsy('app', '100')).toEqual({ reportDigest: digest, revision: 0, state: 'not_started', record: null });
    const result = await updateFailedReportAutopsy('app', '100', input(), 'oauth:grant1', 123);
    expect(result).toMatchObject({ state: 'in_progress', revision: 1, record: { actor: 'oauth:grant1', updatedAt: 123 } });
    expect(d.writes).toHaveLength(3);
    expect(d.writes.every(path => path.startsWith('admin_failed_report_autopsies/'))).toBe(true);
    expect(d.data.get('workspace_diagnostics_v3/app/history/100')).toEqual({ report });
    expect(await readFailedReportAutopsy('app', '100')).toEqual(result);
  });
  it('does not confuse a terminal review or blocked ledger with done', () => {
    for (const change of [
      { status: 'done' }, { ...done(), counts: { total: 2, resolved: 1, blocked: 0 } },
      { ...done(), counts: { total: 2, resolved: 1, blocked: 1 } }, { ...done(), blockers: 'Need original application runtime' },
      { ...done(), verification: null }, { ...done(), ledgerUrl: '' },
    ]) expect(() => parseFailedReportAutopsy(input(change))).toThrow();
    expect(parseFailedReportAutopsy(done())).toMatchObject({ status: 'done', verification: { scope: 'source_and_tests' } });
    expect(() => parseFailedReportAutopsy(input({ status: 'blocked' }))).toThrow();
    expect(parseFailedReportAutopsy(input({ status: 'blocked', counts: { total: 2, resolved: 0, blocked: 2 },
      blockers: 'Original runtime missing; source diagnosis attempted; owner must provide retained source before app verification.' }))).toMatchObject({ status: 'blocked' });
  });
  it('rejects arbitrary fields, malformed counts, unsafe URLs, report writes and credential-bearing notes', () => {
    for (const change of [
      { report: { ok: true } }, { actor: 'admin:owner' }, { expectedRevision: -1 }, { expectedRevision: 1000 },
      { mutationId: '../report' }, { counts: { total: 1, resolved: 2, blocked: 0 } },
      { counts: { total: '2', resolved: 0, blocked: 0 } }, { counts: { total: 2.5, resolved: 0, blocked: 0 } },
      { counts: { total: 2, resolved: 0, blocked: 0, hidden: 1 } }, { verification: { ...proof, other: 'unexpected' } },
      { ledgerUrl: 'https://attacker.example/ledger.md' }, { ledgerUrl: `${repo}/blob/main/docs/ledger.md` },
      { ledgerUrl: `${repo}/else/blob/${'a'.repeat(40)}/docs/ledger.md` }, { summary: 'Store token nbfr_' + 'x'.repeat(43) },
      { ledgerUrl: `${repo}/blob/${'a'.repeat(40)}/../main/ledger.md` }, { ledgerUrl: `${repo}/blob/${'a'.repeat(40)}/./docs/ledger.md` },
      { summary: 'Store OAuth nbfo_' + 'a'.repeat(64) + '.' + 'x'.repeat(43) },
    ]) expect(() => parseFailedReportAutopsy(input(change))).toThrow();
  });
  it('uses semantic scrubbed digests, not object key insertion order', () => {
    expect(failedReportDigest({ b: { z: 1, a: 2 }, a: [1, 2] })).toBe(failedReportDigest({ a: [1, 2], b: { a: 2, z: 1 } }));
    // Locale collation can consider these distinct keys equal; canonical ordering must be total.
    expect(failedReportDigest({ nested: { '\u00e9': 1, 'e\u0301': 2 } }))
      .toBe(failedReportDigest({ nested: { 'e\u0301': 2, '\u00e9': 1 } }));
    expect(failedReportDigest({ a: [1, 2] })).not.toBe(failedReportDigest({ a: [2, 1] }));
    expect(failedReportDigest({ password: 'one' })).toBe(failedReportDigest({ password: 'two' }));
  });
  it('a lost response retry is idempotent, and the same mutation id cannot overwrite a different edit', async () => {
    const d = database(); state.db = d.db;
    const first = await updateFailedReportAutopsy('app', '100', input(), 'admin:owner', 123);
    expect(await updateFailedReportAutopsy('app', '100', input(), 'admin:owner', 456)).toEqual(first);
    expect(d.writes).toHaveLength(3);
    await expect(updateFailedReportAutopsy('app', '100', input({ summary: 'Different review must not reuse the saved mutation identifier.' }), 'admin:owner')).rejects.toThrow(/Mutation id/);
    await expect(updateFailedReportAutopsy('app', '100', input(), 'oauth:another')).rejects.toThrow(/Mutation id/);
    expect(d.writes).toHaveLength(3);
  });
  it('concurrent reviewers cannot lose updates; each accepted revision has an immutable audit', async () => {
    const d = database(); state.db = d.db;
    const results = await Promise.allSettled([
      updateFailedReportAutopsy('app', '100', input(), 'admin:owner'),
      updateFailedReportAutopsy('app', '100', input({ mutationId: '22345678-1234-1234-1234-123456789abc' }), 'oauth:grant1'),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    await updateFailedReportAutopsy('app', '100', input({ expectedRevision: 1, mutationId: '32345678-1234-1234-1234-123456789abc' }), 'admin:owner');
    expect((await readFailedReportAutopsy('app', '100'))?.revision).toBe(2);
    expect([...d.data.keys()].filter(k => k.includes('/revisions/'))).toHaveLength(2);
    await expect(updateFailedReportAutopsy('app', '100',
      input({ mutationId: '42345678-1234-1234-1234-123456789abc' }), 'admin:owner')).rejects.toThrow(/Another reviewer/);
    expect(d.writes).toHaveLength(6);
  });
  it('a changing retained report never inherits done; retries return current truth rather than old success', async () => {
    const d = database(); state.db = d.db;
    await updateFailedReportAutopsy('app', '100', done(), 'admin:owner');
    d.data.set('workspace_diagnostics_v3/app/history/100', { report: { ...report, newWarning: 'Later evidence' } });
    expect((await readFailedReportAutopsy('app', '100'))?.state).toBe('stale');
    expect((await updateFailedReportAutopsy('app', '100', done(), 'admin:owner')).state).toBe('stale');
    await expect(updateFailedReportAutopsy('app', '100', input({ expectedRevision: 1, mutationId: '22345678-1234-1234-1234-123456789abc' }), 'admin:owner')).rejects.toThrow(/report changed/);
    expect(d.writes).toHaveLength(3);
  });
  it('legacy latest records are bound to the exact retained report, not just the workspace', async () => {
    const d = database(); state.db = d.db;
    d.data.set('workspace_diagnostics_v3/app', { report });
    await updateFailedReportAutopsy('app', 'latest', done(), 'admin:owner');
    d.data.set('workspace_diagnostics_v3/app', { report: { ...report, startedAt: 200, endedAt: 201 } });
    expect((await readFailedReportAutopsy('app', 'latest'))?.state).toBe('stale');
    expect((await readFailedReportAutopsy('app', '100'))?.state).toBe('not_started');
  });
  it('refuses missing/successful reports, unavailable storage, forged actors and crafted paths without writes', async () => {
    await expect(readFailedReportAutopsy('app', '100')).rejects.toThrow(/unavailable/);
    const d = database(); state.db = d.db;
    expect(await readFailedReportAutopsy('app', '404')).toBeNull();
    await expect(updateFailedReportAutopsy('app', '404', input(), 'admin:owner')).rejects.toThrow(/No retained/);
    for (const [workspace, history] of [['../app', '100'], ['app', '../100']]) await expect(updateFailedReportAutopsy(workspace, history, input(), 'admin:owner')).rejects.toThrow(/reference/);
    await expect(updateFailedReportAutopsy('app', '100', input(), 'forged')).rejects.toThrow(/actor/);
    d.data.set('workspace_diagnostics_v3/app/history/100', { report: { ...report, ok: true } });
    await expect(updateFailedReportAutopsy('app', '100', input(), 'admin:owner')).rejects.toThrow(/No retained/);
    expect(d.writes).toEqual([]);
  });
  it('batch status is attached without dropping failures or hiding unavailable/malformed metadata', async () => {
    const d = database(); state.db = d.db;
    await updateFailedReportAutopsy('app', '100', done(), 'admin:owner');
    const page = { reports: [{ workspaceId: 'app', historyId: '100', reportDigest: digest, buildId: 'build-1', startedAt: 100, endedAt: 101, appLabel: 'Test', rootCause: null }], nextCursor: 'continue', scanned: 1 };
    expect(await withFailedReportAutopsies(page)).toMatchObject({ nextCursor: 'continue', reports: [{ autopsy: { state: 'done', revision: 1 } }] });
    expect((await withFailedReportAutopsies({ ...page, reports: [{ ...page.reports[0], reportDigest: 'b'.repeat(64) }] })).reports[0].autopsy?.state).toBe('stale');
    const key = [...d.data.keys()].find(k => k.startsWith('admin_failed_report_autopsies/') && k.split('/').length === 2)!;
    d.data.set(key, { status: 'done' });
    await expect(readFailedReportAutopsy('app', '100')).rejects.toThrow();
    await expect(withFailedReportAutopsies(page)).rejects.toThrow();
  });
});
