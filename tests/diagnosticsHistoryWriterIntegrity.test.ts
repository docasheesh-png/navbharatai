import { describe, expect, it } from 'vitest';
import { commitDiagnosticsHistory } from '../src/server/AgentV3/diagnosticsHistoryPersistence';

const counterPath = 'admin_failed_report_numbers/counter';
const rootPath = 'workspace_diagnostics_v3/synthetic-workspace';
const historyPath = (start = 100) => `${rootPath}/history/${start}`;
const failure = (startedAt = 100) => ({ startedAt, endedAt: startedAt + 10, ok: false, diagnostics: ['synthetic failure'] });

/** Optimistic transactions: snapshots are isolated, a changed read version retries the
 * actual production callback, and writes commit atomically. No Firebase/network calls. */
function store(counter: Record<string, unknown> | undefined = { nextNumber: 1 }) {
  const docs = new Map<string, any>();
  const versions = new Map<string, number>();
  if (counter) docs.set(counterPath, structuredClone(counter));
  let retries = 0;
  const ref = (path: string): any => ({ path, collection: (id: string) => ({ doc: (id2: string) => ref(`${path}/${id}/${id2}`) }) });
  const write = (path: string, value: any, merge?: boolean) => {
    docs.set(path, structuredClone(merge ? { ...docs.get(path), ...value } : value));
    versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const db: any = {
    collection: (path: string) => ({ doc: (id: string) => ref(`${path}/${id}`) }),
    batch: () => {
      const writes: Array<[string, any, boolean | undefined]> = [];
      return {
        set: (r: { path: string }, value: any, options?: { merge: boolean }) => writes.push([r.path, value, options?.merge]),
        commit: async () => { for (const args of writes) write(...args); },
      };
    },
    runTransaction: async (callback: (tx: any) => Promise<void>) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const snapshot = structuredClone(docs), observed = new Map<string, number>();
        const versionSnapshot = new Map(versions);
        const writes: Array<[string, any, boolean | undefined]> = [];
        let wrote = false;
        await callback({
          get: async (r: { path: string }) => {
            if (wrote) throw new Error('Firestore forbids reads after writes');
            observed.set(r.path, versionSnapshot.get(r.path) ?? 0);
            return { exists: snapshot.has(r.path), data: () => snapshot.get(r.path) };
          },
          set: (r: { path: string }, value: any, options?: { merge: boolean }) => {
            wrote = true; writes.push([r.path, value, options?.merge]);
          },
        });
        if ([...observed].some(([path, version]) => (versions.get(path) ?? 0) !== version)) { retries++; continue; }
        for (const args of writes) write(...args);
        return;
      }
      throw new Error('Synthetic transaction retry exhaustion');
    },
  };
  return { db, docs, retries: () => retries };
}

const save = (s: ReturnType<typeof store>, report: ReturnType<typeof failure> | { startedAt: number }, savedAt = 200, progress?: boolean) =>
  commitDiagnosticsHistory(s.db, 'synthetic-workspace', report, savedAt, progress);

describe('diagnostics history writer terminal and permanent-reference integrity', () => {
  it.each([false, true])('late progress cannot erase a terminal verdict (ok=%s), payload or reference', async ok => {
    const s = store();
    await save(s, failure());
    const enriched = { ...failure(), ok, diagnostics: ['final enrichment'], extra: { retained: true } };
    await save(s, enriched, 250, false);
    const terminal = structuredClone(s.docs.get(historyPath()));
    await save(s, { startedAt: 100 }, 300, true);
    await save(s, { startedAt: 100 }, 400);
    expect(s.docs.get(historyPath())).toEqual(terminal);
    expect(terminal).toMatchObject({ report: enriched, reportNumber: 1, numberedAt: 200, savedAt: 250 });
    expect(s.docs.get(counterPath).nextNumber).toBe(2);
  });

  it.each([true, false])('concurrent progress and final settlement survive either callback order (progressFirst=%s)', async progressFirst => {
    const s = store();
    const progress = () => save(s, { startedAt: 100 }, 300, true);
    const final = () => save(s, failure(), 200, false);
    await Promise.all(progressFirst ? [progress(), final()] : [final(), progress()]);
    expect(s.retries()).toBeGreaterThan(0);
    expect(s.docs.get(historyPath())).toMatchObject({ report: failure(), reportNumber: 1, savedAt: 200, inProgress: false });
    expect(s.docs.get(counterPath).nextNumber).toBe(2);
  });

  it('concurrent distinct histories allocate unique IDs and duplicate history retries retain one ID', async () => {
    const s = store();
    await Promise.all([save(s, failure(300)), save(s, failure(100)), save(s, failure(200)), save(s, failure(100))]);
    const ids = [100, 200, 300].map(start => s.docs.get(historyPath(start)).reportNumber);
    expect(new Set(ids).size).toBe(3);
    expect(ids.slice().sort()).toEqual([1, 2, 3]);
    expect(s.docs.get(counterPath).nextNumber).toBe(4);
    expect(s.retries()).toBeGreaterThan(0);
  });

  it.each([
    ['missing', undefined, 'counter_uninitialized'],
    ['empty', {}, 'counter_invalid'],
    ['zero', { nextNumber: 0 }, 'counter_invalid'],
    ['fractional', { nextNumber: 1.5 }, 'counter_invalid'],
    ['string', { nextNumber: '7' }, 'counter_invalid'],
    ['nonfinite', { nextNumber: NaN }, 'counter_invalid'],
    ['exhausted', { nextNumber: Number.MAX_SAFE_INTEGER }, 'counter_exhausted'],
    ['blocked', { nextNumber: 9, numberingBlocked: true }, 'counter_invalid'],
  ] as const)('durably saves without inventing ID for %s counter', async (_name, counter, issue) => {
    const s = store(counter as Record<string, unknown> | undefined);
    // Explicit undefined means missing, rather than store's initialized default.
    if (counter === undefined) s.docs.delete(counterPath);
    await save(s, failure());
    expect(s.docs.get(historyPath())).toEqual({ report: failure(), savedAt: 200, numberingIssue: issue });
    expect(s.docs.get(rootPath)).toEqual({ historyAvailable: true });
    expect(s.docs.get(counterPath)).toEqual(counter);
  });

  it('detects a stale counter, retains stored ID and blocks subsequent allocation rather than guessing a global max', async () => {
    const s = store({ nextNumber: 3 });
    s.docs.set(historyPath(), { report: failure(), reportNumber: 7, numberedAt: 120 });
    await save(s, { ...failure(), diagnostics: ['enriched'] });
    expect(s.docs.get(historyPath())).toMatchObject({ reportNumber: 7, numberedAt: 120, numberingIssue: 'counter_inconsistent' });
    expect(s.docs.get(counterPath)).toEqual({ nextNumber: 3, numberingBlocked: true });
    await save(s, failure(400));
    expect(s.docs.get(historyPath(400))).toMatchObject({ numberingIssue: 'counter_invalid', report: failure(400) });
    expect(s.docs.get(historyPath(400)).reportNumber).toBeUndefined();
  });

  it('merges only the discovery marker while retaining latest payload and unrelated root metadata', async () => {
    const s = store();
    const root = { report: { ...failure(1000), ok: true }, savedAt: 2000, metadata: { version: 4 } };
    s.docs.set(rootPath, root);
    await save(s, failure());
    expect(s.docs.get(rootPath)).toEqual({ ...root, historyAvailable: true });
    expect([...s.docs.keys()].sort()).toEqual([counterPath, rootPath, historyPath()].sort());
  });

  it('only valid settled failures allocate new permanent IDs', async () => {
    const s = store();
    for (const report of [{ startedAt: 100 }, { ...failure(200), ok: true }, { ...failure(300), endedAt: 299 },
      { ...failure(400), endedAt: Infinity }, { ...failure(0) }, { ...failure(500), ok: undefined }]) {
      await commitDiagnosticsHistory(s.db, 'synthetic-workspace', report, 600);
      expect(s.docs.get(historyPath(report.startedAt)).reportNumber).toBeUndefined();
    }
    expect(s.docs.get(counterPath)).toEqual({ nextNumber: 1 });
  });
});
