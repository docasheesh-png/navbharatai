import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import express from 'express';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { registerFailedReportRoutes } from '../src/server/routes/failedReports';
import { mintAdminToken } from '../src/server/lib/adminAuth';
import { redactSecrets as legacyRedact } from '../src/server/AgentV3/SecretRedactor';
import { redactSecrets as sourceRedact } from '../src/server/AgentV3/SourceSecretRedactor';
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
function expandingSource(): string {
  const prefix = 'interface User { password: string; }\nconst password="syntheticA"; ' +
    (String.raw`const config = { pass\u{77}ord: "tiny" };` + ' ').repeat(500) + '// ';
  return prefix + 'x'.repeat(196_000 - prefix.length);
}
function exactExportHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === 'object' ? Object.fromEntries(Object.entries(v)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function database() {
  const data = new Map<string, any>([['workspace_diagnostics_v3/app/history/100', { report }]]);
  const writes: string[] = [];
  let serial = Promise.resolve();
  const ref = (path: string): any => ({ path, get: async () => snapshot({ path }), collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }) });
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
  it.each([
    { name: 'ordinary source', source: () => 'const config = { password: syntheticCredential }; interface User { password: string; }',
      preservesType: true, repeatedChanges: false, genericFallback: false },
    { name: 'mask expansion beyond the original size cap', source: expandingSource,
      preservesType: true, repeatedChanges: true, genericFallback: false },
    { name: 'already-redacted oversized stored source', source: () => sourceRedact(expandingSource()),
      preservesType: false, repeatedChanges: false, genericFallback: true },
    { name: 'ambiguous credential proof-budget fallback', source: () =>
      'interface User { password: string; }\n' + 'PASSWORD=syntheticA;syntheticB '.repeat(1_000),
      preservesType: false, repeatedChanges: true, genericFallback: true },
  ])('binds real REST/MCP reads and done CAS to one stored snapshot: $name', async (fixture) => {
    const d = database(); state.db = d.db;
    const source = fixture.source();
    const retained = { ...report, source };
    const retainedPath = 'workspace_diagnostics_v3/app/history/100';
    d.data.set(retainedPath, { report: retained });
    vi.stubEnv('ADMIN_USERNAME', 'digest-test-owner'); vi.stubEnv('ADMIN_PASSWORD', 'synthetic-admin-password');
    const token = mintAdminToken('synthetic-admin-password', 'digest-test-owner', Date.now());
    const app = express(); app.use(express.json()); registerFailedReportRoutes(app);
    const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const headers = { 'x-admin-token': token, 'Content-Type': 'application/json' };
    const detailPath = '/api/failedbr/reports/app/100';
    try {
      const rest = await fetch(origin + detailPath, { headers });
      expect(rest.status).toBe(200);
      const detail = await rest.json() as any;
      const mcp = await fetch(origin + '/api/failedbr/mcp', { method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_failed_build', arguments: { workspaceId: 'app', historyId: '100' } } }) });
      expect(mcp.status).toBe(200);
      const tool = JSON.parse((await mcp.json() as any).result.content[0].text);
      expect(tool).toEqual({ ...detail.report, reportDigest: detail.reportDigest });
      expect(detail.reportDigest).toBe(failedReportDigest(retained));
      // Independently hash the exact bytes represented by this exported object. Applying
      // another redaction pass here is wrong when mask expansion crosses the size cap.
      expect(detail.reportDigest).toBe(exactExportHash(detail.report));
      expect((await readFailedReportAutopsy('app', '100'))?.reportDigest).toBe(detail.reportDigest);
      expect(JSON.stringify(detail.report)).not.toContain('syntheticCredential');
      expect(detail.report.source).not.toContain('syntheticA');
      expect(detail.report.source).not.toContain('syntheticB');
      expect(detail.report.source).not.toBe(JSON.stringify('[REDACTED:secret]'));
      if (fixture.genericFallback) expect(detail.report.source).toBe(legacyRedact(source));
      expect(detail.report.source.includes('password: string;')).toBe(fixture.preservesType);
      expect(sourceRedact(detail.report.source) !== detail.report.source).toBe(fixture.repeatedChanges);
      if (fixture.repeatedChanges) {
        expect(failedReportDigest(detail.report)).not.toBe(detail.reportDigest);
      }
      if (fixture.name === 'mask expansion beyond the original size cap') {
        expect(detail.report.source.length).toBeGreaterThan(200_000);
      }
      const saved = await fetch(origin + detailPath + '/autopsy', { method: 'POST', headers,
        body: JSON.stringify({ ...done(), reportDigest: detail.reportDigest }) });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ state: 'done', revision: 1 });
      const reread = await fetch(origin + detailPath, { headers });
      expect(await reread.json()).toEqual(detail);
      expect((await readFailedReportAutopsy('app', '100'))?.state).toBe('done');
      expect(d.data.get(retainedPath)).toEqual({ report: retained });
      const writes = d.writes.length;
      d.data.set(retainedPath, { report: { ...retained, newWarning: 'A genuine later nonsecret observation' } });
      const stale = await fetch(origin + detailPath + '/autopsy', { method: 'POST', headers,
        body: JSON.stringify(input({ reportDigest: detail.reportDigest, expectedRevision: 1, mutationId: '22345678-1234-1234-1234-123456789abc' })) });
      expect(stale.status).toBe(409);
      expect((await readFailedReportAutopsy('app', '100'))?.state).toBe('stale');
      expect((await updateFailedReportAutopsy('app', '100',
        { ...done(), reportDigest: detail.reportDigest }, 'admin:owner'))?.state).toBe('stale');
      expect(d.writes).toHaveLength(writes);
    } finally {
      await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
      vi.unstubAllEnvs();
    }
  });
  it('keeps a historical old-redaction digest explicitly stale without migrating the record', async () => {
    const d = database(); state.db = d.db;
    const source = 'interface User { password: string; }';
    const retained = { ...report, source };
    d.data.set('workspace_diagnostics_v3/app/history/100', { report: retained });
    const currentDigest = failedReportDigest(retained);
    await updateFailedReportAutopsy('app', '100', { ...done(), reportDigest: currentDigest }, 'admin:owner');
    const key = [...d.data.keys()].find(k => k.startsWith('admin_failed_report_autopsies/') && k.split('/').length === 2)!;
    const oldDigest = failedReportDigest({ ...retained, source: legacyRedact(source) });
    expect(oldDigest).not.toBe(currentDigest);
    d.data.set(key, { ...d.data.get(key), reportDigest: oldDigest });
    const before = structuredClone([...d.data.entries()]);
    expect((await readFailedReportAutopsy('app', '100'))?.state).toBe('stale');
    const page = { reports: [{ workspaceId: 'app', historyId: '100', reportDigest: currentDigest, buildId: 'build-1', startedAt: 100, endedAt: 101, appLabel: 'Test', rootCause: null }], nextCursor: null, scanned: 1 };
    expect((await withFailedReportAutopsies(page)).reports[0].autopsy?.state).toBe('stale');
    expect([...d.data.entries()]).toEqual(before);
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
