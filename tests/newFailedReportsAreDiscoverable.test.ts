import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { isFailedBuildPage } from '../src/lib/failedBuildReports';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { commitDiagnosticsHistory } from '../src/server/AgentV3/diagnosticsHistoryPersistence';
import { readFailedBuildPage, readFailedBuildWithDigest } from '../src/server/lib/failedBuildReports';

function fakeFirestore() {
  const docs = new Map<string, any>();
  let failCommit = false;
  const snap = (path: string) => ({ id: path.split('/').at(-1)!, exists: docs.has(path), data: () => docs.get(path), ref: ref(path) });
  const collection = (path: string): any => {
    let after = '', inclusive = false, cap = Infinity;
    const q: any = {
      doc: (id: string) => ref(`${path}/${id}`),
      orderBy: () => q,
      startAt: (id: string) => { after = id; inclusive = true; return q; },
      startAfter: (id: string) => { after = id; inclusive = false; return q; },
      limit: (n: number) => { cap = n; return q; },
      get: async () => {
        const depth = path.split('/').length + 1;
        const rows = [...docs.keys()].filter(p => p.startsWith(`${path}/`) && p.split('/').length === depth)
          .sort().map(snap).filter(s => inclusive ? s.id >= after : s.id > after).slice(0, cap);
        return { docs: rows, size: rows.length, empty: rows.length === 0 };
      },
    };
    return q;
  };
  const ref = (path: string): any => ({ path, collection: (id: string) => collection(`${path}/${id}`), get: async () => snap(path) });
  const db: any = {
    collection,
    batch: () => {
      const writes: Array<{ path: string; data: any; merge?: boolean }> = [];
      return {
        set: (r: any, data: any, options?: { merge: boolean }) => { writes.push({ path: r.path, data, merge: options?.merge }); },
        commit: async () => {
          if (failCommit) throw new Error('Synthetic atomic write failure');
          for (const w of writes) docs.set(w.path, w.merge ? { ...docs.get(w.path), ...w.data } : w.data);
        },
      };
    },
  };
  return { db, docs, setFailure: (value: boolean) => { failCommit = value; } };
}
const failure = (startedAt: number) => ({ startedAt, endedAt: startedAt + 10, ok: false, prompt: 'Synthetic app', rootCause: 'Synthetic compile error' });
afterEach(() => { state.db = null; vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('new retained failed-report discovery', () => {
  it('accepts legacy pages and validates optional read provenance without treating it as evidence completeness', () => {
    const page = { reports: [], scanned: 0, nextCursor: null };
    expect(isFailedBuildPage(page)).toBe(true);
    const observation = { observedAt: 100, deployment: null, scope: 'retained-settled-failures', ordering: 'workspace-history' };
    expect(isFailedBuildPage({ ...page, observation })).toBe(true);
    for (const invalid of [{ ...observation, observedAt: NaN }, { ...observation, deployment: 'private-service-name' },
      { ...observation, scope: 'all-user-data' }, { ...observation, ordering: 'newest-first' }]) {
      expect(isFailedBuildPage({ ...page, observation: invalid })).toBe(false);
    }
  });

  it('discovers and reads a newly saved report without a latest write or manual submission', async () => {
    const { db, docs } = fakeFirestore(); state.db = db;
    expect((await readFailedBuildPage()).reports).toEqual([]);
    const r = { ...failure(2000), api_key: 'synthetic-private-credential' };
    await commitDiagnosticsHistory(db, 'workspace-a', r, 3000);
    expect(docs.get('workspace_diagnostics_v3/workspace-a')).toEqual({ historyAvailable: true });
    const page = await readFailedBuildPage();
    expect(page.reports.map(r => [r.workspaceId, r.historyId])).toEqual([['workspace-a', '2000']]);
    const detail = await readFailedBuildWithDigest('workspace-a', '2000');
    expect(detail?.reportDigest).toBe(page.reports[0].reportDigest);
    expect(detail?.report).toMatchObject({ startedAt: 2000, api_key: '[REDACTED:credential]' });
    expect(JSON.stringify(page)).not.toContain('synthetic-private-credential');
  });
  it('merges only a discovery marker and never rolls back a newer latest report', async () => {
    const { db, docs } = fakeFirestore(); state.db = db;
    const path = 'workspace_diagnostics_v3/workspace-a';
    const newer = { report: { ...failure(5000), ok: true }, savedAt: 5010, existingMetadata: 'preserve' };
    docs.set(path, newer);
    await commitDiagnosticsHistory(db, 'workspace-a', failure(2000), 6000);
    expect(docs.get(path)).toEqual({ ...newer, historyAvailable: true });
    expect((await readFailedBuildPage()).reports.map(r => r.startedAt)).toEqual([2000]);
  });
  it('commits marker and history atomically and retries idempotently without orphan history', async () => {
    const { db, docs, setFailure } = fakeFirestore(); state.db = db;
    setFailure(true);
    await expect(commitDiagnosticsHistory(db, 'workspace-a', failure(2000), 3000)).rejects.toThrow('atomic');
    expect(docs.size).toBe(0);
    setFailure(false);
    await commitDiagnosticsHistory(db, 'workspace-a', failure(2000), 3000);
    await commitDiagnosticsHistory(db, 'workspace-a', failure(2000), 3000);
    expect(docs.size).toBe(2);
    expect((await readFailedBuildPage()).reports).toHaveLength(1);
  });
  it('progress becomes discoverable only after settlement, without widening the read scope', async () => {
    const { db } = fakeFirestore(); state.db = db;
    await commitDiagnosticsHistory(db, 'workspace-a', { startedAt: 2000 }, 2010, true);
    expect((await readFailedBuildPage()).reports).toEqual([]);
    expect(await readFailedBuildWithDigest('workspace-a', '2000')).toBeNull();
    await commitDiagnosticsHistory(db, 'workspace-a', failure(2000), 2020);
    expect((await readFailedBuildPage()).reports).toHaveLength(1);
    await commitDiagnosticsHistory(db, 'workspace-a', { ...failure(4000), ok: true }, 4020);
    expect((await readFailedBuildPage()).reports).toHaveLength(1);
    expect(await readFailedBuildWithDigest('workspace-a', '4000')).toBeNull();
  });
  it('a fresh scan discovers additions even behind an older cursor and states its read scope', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000); vi.stubEnv('K_REVISION', 'synthetic-private-deployment-name');
    const { db } = fakeFirestore(); state.db = db;
    await commitDiagnosticsHistory(db, 'workspace-z', failure(2000), 2020);
    const old = await readFailedBuildPage(undefined, 1);
    await commitDiagnosticsHistory(db, 'workspace-a', failure(3000), 3020);
    vi.setSystemTime(20000);
    const fresh = await readFailedBuildPage();
    expect(fresh.reports.map(r => r.startedAt)).toEqual([3000, 2000]);
    expect(fresh.observation).toMatchObject({ observedAt: 20000, scope: 'retained-settled-failures', ordering: 'workspace-history' });
    expect(old.observation?.observedAt).toBe(10000);
    expect(fresh.observation?.deployment).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(fresh)).not.toContain('synthetic-private-deployment-name');
    expect(fresh.observation?.deployment).toBe(old.observation?.deployment);
  });
  it('both history writers use the atomic helper, with no private independent history write', () => {
    const source = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
    const ast = ts.createSourceFile('DiagnosticsStore.ts', source, ts.ScriptTarget.Latest, true);
    for (const name of ['saveDiagnosticsHistory', 'upsertDiagnosticsHistoryProgress']) {
      const fn = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
      expect(fn).toBeDefined();
      const calls: string[] = [];
      const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n.expression.getText(ast)); ts.forEachChild(n, visit); };
      visit(fn);
      expect(calls.filter(n => n === 'commitDiagnosticsHistory')).toHaveLength(1);
      expect(calls.some(n => n.endsWith('.set'))).toBe(false);
      expect(calls).toContain('persistWithRetry');
    }
  });
});
