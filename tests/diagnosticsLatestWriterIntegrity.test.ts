import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { commitLatestDiagnostics } from '../src/server/AgentV3/diagnosticsHistoryPersistence';

const finalReport = (startedAt = 100, workspaceId = 'workspace-a') => ({ startedAt, endedAt: startedAt + 10, ok: false, workspaceId, diagnostics: ['synthetic failure'] });

/** Minimal optimistic transaction model. The callback is production source, retries
 * re-read a fresh snapshot, and each set replaces the document unless merge is requested. */
function store() {
  const docs = new Map<string, any>();
  const versions = new Map<string, number>();
  let retries = 0;
  const db: any = {
    collection: (name: string) => ({ doc: (id: string) => ({
      path: `${name}/${id}`,
      set: async (value: any) => {
        const path = `${name}/${id}`;
        docs.set(path, structuredClone(value)); versions.set(path, (versions.get(path) ?? 0) + 1);
      },
    }) }),
    runTransaction: async (callback: (tx: any) => Promise<void>) => {
      for (let i = 0; i < 100; i++) {
        const snapshot = structuredClone(docs), versionSnapshot = new Map(versions);
        const reads = new Map<string, number>();
        const writes: Array<{ path: string; value: any; merge: boolean }> = [];
        await callback({
          get: async (ref: { path: string }) => {
            if (writes.length) throw new Error('Firestore forbids reads after writes');
            reads.set(ref.path, versionSnapshot.get(ref.path) ?? 0);
            return { exists: snapshot.has(ref.path), data: () => snapshot.get(ref.path) };
          },
          set: (ref: { path: string }, value: any, options?: { merge?: boolean }) => {
            writes.push({ path: ref.path, value, merge: options?.merge === true });
          },
        });
        if ([...reads].some(([path, version]) => (versions.get(path) ?? 0) !== version)) { retries++; continue; }
        for (const w of writes) {
          // Deep merge models Firestore accurately: merging a report map would retain stale nested fields.
          const merge = (a: any, b: any): any => Object.fromEntries(Object.entries({ ...a, ...b }).map(([key, value]) => [key,
            b?.[key] && typeof b[key] === 'object' && !Array.isArray(b[key]) ? merge(a?.[key], b[key]) : value]));
          docs.set(w.path, structuredClone(w.merge ? merge(docs.get(w.path), w.value) : w.value));
          versions.set(w.path, (versions.get(w.path) ?? 0) + 1);
        }
        return;
      }
      throw new Error('Synthetic retry exhaustion');
    },
  };
  return { db, docs, retries: () => retries };
}

for (const collection of ['workspace_diagnostics_v3', 'user_diagnostics_v3'] as const) {
  describe(`${collection} latest report integrity`, () => {
    const id = 'synthetic-owner';
    const path = `${collection}/${id}`;
    const save = (s: ReturnType<typeof store>, report: { startedAt: number; endedAt?: number; ok?: boolean }, savedAt = 200) =>
      commitLatestDiagnostics(s.db, collection, id, report, savedAt);

    it.each([true, false])('terminal survives concurrently retried progress (progress first=%s)', async progressFirst => {
      const s = store();
      const progress = () => save(s, { startedAt: 100 }, 300);
      const terminal = () => save(s, finalReport(), 200);
      await Promise.all(progressFirst ? [progress(), terminal()] : [terminal(), progress()]);
      expect(s.docs.get(path)).toEqual({ report: finalReport(), savedAt: 200 });
      await save(s, { startedAt: 100 }, 400);
      expect(s.docs.get(path)).toEqual({ report: finalReport(), savedAt: 200 });
      expect(s.retries()).toBeGreaterThan(0);
    });

    it.each([true, false])('older run completion never replaces newer report across workspaces (older first=%s)', async olderFirst => {
      const s = store();
      const older = () => save(s, finalReport(100, 'workspace-a'), 900);
      const newer = () => save(s, finalReport(500, 'workspace-b'), 600);
      await Promise.all(olderFirst ? [older(), newer()] : [newer(), older()]);
      expect(s.docs.get(path)).toEqual({ report: finalReport(500, 'workspace-b'), savedAt: 600 });
      await older();
      expect(s.docs.get(path)).toEqual({ report: finalReport(500, 'workspace-b'), savedAt: 600 });
    });

    it('accepts a genuinely newer progress report without retaining old terminal or nested report fields', async () => {
      const s = store();
      s.docs.set(path, { historyAvailable: true, ownerMetadata: { retain: 'synthetic' }, report: { ...finalReport(), oldOnly: 'must disappear', nested: { stale: true } }, savedAt: 110 });
      const progress = { startedAt: 500, workspaceId: 'workspace-b', nested: { current: true } };
      await save(s, progress, 600);
      expect(s.docs.get(path)).toEqual({ historyAvailable: true, ownerMetadata: { retain: 'synthetic' }, report: progress, savedAt: 600 });
      expect([...s.docs.keys()]).toEqual([path]);
    });

    it.each([
      ['workspaceId', true], ['workspaceId', false], ['buildId', true], ['buildId', false],
    ] as const)('equal-start distinct %s uses stable identity order, not terminal dominance (lower first=%s)', async (field, lowerFirst) => {
      const s = store();
      s.docs.set(path, { historyAvailable: true });
      const lower = { ...finalReport(), workspaceId: 'workspace-common', buildId: 'build-common', [field]: 'a' };
      const higher = { startedAt: 100, workspaceId: 'workspace-common', buildId: 'build-common', [field]: 'z' };
      const lowerSave = () => save(s, lower, 900);
      const higherSave = () => save(s, higher, 200);
      await Promise.all(lowerFirst ? [lowerSave(), higherSave()] : [higherSave(), lowerSave()]);
      expect(s.docs.get(path)).toEqual({ historyAvailable: true, report: higher, savedAt: 200 });
      await lowerSave();
      expect(s.docs.get(path)).toEqual({ historyAvailable: true, report: higher, savedAt: 200 });
    });

    it('legacy reports without comparable identity retain same-timestamp terminal dominance', async () => {
      const s = store();
      const terminal = { startedAt: 100, endedAt: 110, ok: false };
      await save(s, terminal, 200);
      await save(s, { startedAt: 100 }, 300);
      expect(s.docs.get(path)).toEqual({ report: terminal, savedAt: 200 });
    });

    it('empty and whitespace-only IDs are absent, not evidence of a distinct run', async () => {
      for (const absent of ['', '   ']) {
        const s = store();
        const terminal = { ...finalReport(), workspaceId: absent, buildId: absent };
        await save(s, terminal, 200);
        const progress = { startedAt: 100, workspaceId: 'workspace-z', buildId: 'build-z' };
        await save(s, progress, 300);
        expect(s.docs.get(path)).toEqual({ report: terminal, savedAt: 200 });
      }
    });

    it('equal-time distinct identity does not inherit old run reference metadata', async () => {
      const s = store();
      s.docs.set(path, { report: { ...finalReport(), buildId: 'a' }, savedAt: 200, historyAvailable: true, reportNumber: 7, numberedAt: 150 });
      const next = { ...finalReport(), buildId: 'z' };
      await save(s, next, 300);
      expect(s.docs.get(path)).toEqual({ report: next, savedAt: 300, historyAvailable: true });
    });

    it.each([NaN, Infinity, -1, 0])('rejects invalid incoming startedAt=%s rather than replacing a valid latest report', async startedAt => {
      const s = store();
      const previous = { report: finalReport(), savedAt: 200, historyAvailable: true };
      s.docs.set(path, previous);
      await save(s, { ...finalReport(), startedAt }, 900);
      expect(s.docs.get(path)).toEqual(previous);
    });

    it('keeps run-local IDs for same-run enrichment but never transfers them to a new run', async () => {
      const s = store();
      s.docs.set(path, { report: finalReport(), savedAt: 200, historyAvailable: true, reportNumber: 7, numberedAt: 150, numberingIssue: 'counter_invalid' });
      await save(s, finalReport(), 250);
      expect(s.docs.get(path)).toMatchObject({ reportNumber: 7, numberedAt: 150, numberingIssue: 'counter_invalid' });
      await save(s, finalReport(500), 600);
      expect(s.docs.get(path)).toEqual({ report: finalReport(500), savedAt: 600, historyAvailable: true });
    });

    it('allows final enrichment and verdict correction while keeping document discovery metadata', async () => {
      const s = store();
      s.docs.set(path, { historyAvailable: true, report: finalReport(), savedAt: 200 });
      const enriched = { ...finalReport(), ok: true, diagnostics: ['synthetic final enrichment'], nested: { checked: true } };
      await save(s, enriched, 300);
      expect(s.docs.get(path)).toEqual({ historyAvailable: true, report: enriched, savedAt: 300 });
      await save(s, { startedAt: 100 }, 400);
      expect(s.docs.get(path)).toEqual({ historyAvailable: true, report: enriched, savedAt: 300 });
    });
  });
}

it('both durable latest writers route their retry through the shared guarded helper', () => {
  const source = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
  const ast = ts.createSourceFile('DiagnosticsStore.ts', source, ts.ScriptTarget.Latest, true);
  for (const name of ['saveDiagnostics', 'saveLatestForUser']) {
    const fn = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    expect(fn, name).toBeDefined();
    const calls: string[] = [];
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast)); ts.forEachChild(node, visit); };
    visit(fn!);
    expect(calls.filter(call => call === 'commitLatestDiagnostics'), name).toHaveLength(1);
    expect(calls, name).toContain('persistWithRetry');
    expect(calls.some(call => call.endsWith('.set')), name).toBe(false);
    expect(calls, name).toContain('fitReportForStorage');
  }
});
