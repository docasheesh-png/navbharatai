import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { readFailedBuildPage, readFailedBuild, readFailedBuildWithDigest, failedReportDigest, redactFailedReport, settledFailure } from '../src/server/lib/failedBuildReports';

const fail = (startedAt: number) => ({ startedAt, endedAt: startedAt + 1, ok: false, prompt: 'A booking app', rootCause: 'Compile failed' });
function database(workspaces: Record<string, { report?: unknown; history: Record<string, unknown> }>) {
  const snap = (id: string, data: unknown, ref?: unknown) => ({ id, exists: data !== undefined, data: () => data, ref });
  const query = (rows: any[]) => {
    let after: string | null = null, inclusive = false, limit = Infinity;
    const q: any = { orderBy: () => q, startAt: (s: string) => { after = s; inclusive = true; return q; }, startAfter: (s: string) => { after = s; return q; }, limit: (n: number) => { limit = n; return q; }, get: async () => {
      const docs = rows.filter((r) => after === null || (inclusive ? r.id >= after : r.id > after)).slice(0, limit);
      return { docs, size: docs.length, empty: docs.length === 0 };
    } };
    return q;
  };
  const parent = (id: string) => {
    const d = workspaces[id];
    const history = () => ({ ...query(Object.entries(d?.history ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => snap(k, { report: v }))), doc: (k: string) => ({ get: async () => snap(k, d?.history[k] === undefined ? undefined : { report: d.history[k] }) }) });
    return { collection: history, get: async () => snap(id, d ? { report: d.report } : undefined) };
  };
  return { collection: () => ({ ...query(Object.keys(workspaces).sort().map((id) => snap(id, { report: workspaces[id].report }, parent(id)))), doc: parent }) };
}
beforeEach(() => { state.db = null; });
describe('private retained failed history', () => {
  it('reads a failure even after the same workspace succeeds, and never duplicates latest', async () => {
    state.db = database({ app: { report: { ...fail(200), ok: true }, history: { '100': fail(100), '200': { ...fail(200), ok: true } } } });
    const p = await readFailedBuildPage();
    expect(p.reports.map((r) => r.historyId)).toEqual(['100']);
    expect(p.nextCursor).toBeNull();
    expect(await readFailedBuild('app', '100')).toMatchObject({ ok: false });
    expect(await readFailedBuild('app', '200')).toBeNull();
    expect(await readFailedBuild('app', '999')).toBeNull();
  });
  it('continues through empty bounded batches instead of losing later failures', async () => {
    const history: Record<string, unknown> = {};
    for (let i = 1000; i < 1120; i++) history[String(i)] = { ...fail(i), ok: true };
    history['1120'] = fail(1120);
    state.db = database({ app: { history } });
    const p = await readFailedBuildPage();
    expect(p.reports).toEqual([]); expect(p.scanned).toBeLessThanOrEqual(100); expect(p.nextCursor).not.toBeNull();
    const next = await readFailedBuildPage(p.nextCursor);
    expect(next.reports.map((r) => r.startedAt)).toEqual([1120]); expect(next.nextCursor).toBeNull();
  });
  it('paginates at the exact returned failure and includes legacy latest-only records', async () => {
    state.db = database({ a: { report: fail(100), history: {} }, b: { report: fail(200), history: { '200': fail(200), '300': fail(300) } } });
    let cursor: string | undefined; const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const p = await readFailedBuildPage(cursor, 1); ids.push(...p.reports.map((r) => `${r.workspaceId}/${r.historyId}`));
      if (!p.nextCursor) break; cursor = p.nextCursor;
    }
    expect(ids).toEqual(['a/latest', 'b/200', 'b/300']);
    expect(await readFailedBuild('a', 'latest')).toMatchObject({ startedAt: 100 });
  });
  it('binds list and detail digests to the same once-scrubbed snapshot', async () => {
    const source = 'const config = { password: syntheticCredential }; interface User { password: string; }';
    const retained = { ...fail(100), source, nested: { b: 2, a: 1 } };
    state.db = database({ app: { history: { '100': retained } } });
    const page = await readFailedBuildPage();
    const detail = await readFailedBuildWithDigest('app', '100');
    expect(detail?.reportDigest).toBe(page.reports[0].reportDigest);
    expect(detail?.reportDigest).toBe(failedReportDigest(retained));
    expect(detail?.report).toEqual(await readFailedBuild('app', '100'));
    expect(JSON.stringify(detail?.report)).not.toContain('syntheticCredential');
    expect((detail?.report as any).source).toContain('password: string;');
    expect(retained.source).toBe(source);
  });
  it('never reports unknown or still-running outcomes as failed', () => {
    for (const r of [{ ok: false }, { startedAt: 1, ok: false }, { ...fail(1), endedAt: NaN }, { ...fail(1), endedAt: 0 }, { ...fail(1), ok: true }, { ...fail(1), ok: undefined }]) expect(settledFailure(r)).toBe(false);
    expect(settledFailure(fail(1))).toBe(true);
  });
  it('fails honestly on unavailable storage and refuses crafted references/cursors', async () => {
    await expect(readFailedBuildPage()).rejects.toThrow(/unavailable/);
    await expect(readFailedBuildPage('garbage')).rejects.toThrow(/cursor/);
    await expect(readFailedBuildPage(undefined, 500)).rejects.toThrow(/Limit/);
    await expect(readFailedBuild('../other', '100')).rejects.toThrow(/reference/);
    state.db = { collection: () => { throw new Error('database offline'); } };
    await expect(readFailedBuildPage()).rejects.toThrow(/offline/);
  });
  it('scrubs nested credentials and known secret shapes without destroying diagnostics', () => {
    const r = redactFailedReport({ password: 'short', AWS_SECRET_ACCESS_KEY: 'opaque-cloud-secret', api_key: 'random-secret', detail: 'sk-proj-' + 'a'.repeat(30), llm: [{ inputTokens: 100, authorization: 'Bearer private' }], trace: 'Compile failed at index.ts:10', access: 'nbfr_' + 'x'.repeat(43) });
    expect(JSON.stringify(r)).not.toContain('opaque-cloud-secret'); expect(JSON.stringify(r)).not.toContain('random-secret'); expect(JSON.stringify(r)).not.toContain('short');
    expect(JSON.stringify(r)).not.toContain('sk-proj-'); expect(JSON.stringify(r)).not.toContain('Bearer private'); expect(JSON.stringify(r)).not.toContain('nbfr_');
    expect(r).toMatchObject({ llm: [{ inputTokens: 100 }], trace: 'Compile failed at index.ts:10' });
  });
});
