import { describe, expect, it } from 'vitest';
import { commitDiagnosticsHistory } from '../src/server/AgentV3/diagnosticsHistoryPersistence';

const counterPath = 'admin_build_report_counter/counter';
const entryPath = (start = 100) => `build_report_numbers/synthetic-workspace~${start}`;
const ready = (nextNumber = 1) => ({ state: 'ready', nextNumber });
const rootPath = 'workspace_diagnostics_v3/synthetic-workspace';
const historyPath = (start = 100) => `${rootPath}/history/${start}`;
const failure = (startedAt = 100) => ({ startedAt, endedAt: startedAt + 10, ok: false, diagnostics: ['synthetic failure'] });

/** Optimistic transactions: snapshots are isolated, a changed read version retries the
 * actual production callback, and writes commit atomically. No Firebase/network calls. */
function store(counter: Record<string, unknown> | undefined = ready()) {
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

const save = (s: ReturnType<typeof store>, report: Record<string, unknown> & { startedAt: number }, savedAt = 200, progress?: boolean) =>
  commitDiagnosticsHistory(s.db, 'synthetic-workspace', report, savedAt, progress);

describe('diagnostics history writer: terminal integrity and permanent build report numbers', () => {
  it.each([false, true])('late progress cannot erase a terminal verdict (ok=%s), its payload or its number', async ok => {
    const s = store();
    await save(s, failure());
    const enriched = { ...failure(), ok, diagnostics: ['final enrichment'], extra: { retained: true } };
    await save(s, enriched, 250, false);
    const terminal = structuredClone(s.docs.get(historyPath()));
    const entry = structuredClone(s.docs.get(entryPath()));
    await save(s, { startedAt: 100 }, 300, true);
    await save(s, { startedAt: 100 }, 400);
    expect(s.docs.get(historyPath())).toEqual(terminal);
    expect(terminal).toMatchObject({ report: enriched, savedAt: 250 });
    expect(s.docs.get(entryPath())).toEqual(entry);
    expect(entry).toMatchObject({ number: 1, outcome: ok ? 'succeeded' : 'failed', numberedAt: 200, lastSavedAt: 250 });
    expect(s.docs.get(counterPath).nextNumber).toBe(2);
  });

  it.each([true, false])('concurrent progress and final settlement keep ONE number (progressFirst=%s)', async progressFirst => {
    const s = store();
    const progress = () => save(s, { startedAt: 100 }, 300, true);
    const final = () => save(s, failure(), 200, false);
    await Promise.all(progressFirst ? [progress(), final()] : [final(), progress()]);
    expect(s.retries()).toBeGreaterThan(0);
    expect(s.docs.get(historyPath())).toMatchObject({ report: failure(), savedAt: 200, inProgress: false });
    expect(s.docs.get(entryPath())).toMatchObject({ number: 1, outcome: 'failed' });
    expect(s.docs.get(counterPath).nextNumber).toBe(2);
  });

  it('concurrent distinct reports get unique numbers and duplicate retries keep one', async () => {
    const s = store();
    await Promise.all([save(s, failure(300)), save(s, failure(100)), save(s, failure(200)), save(s, failure(100))]);
    const ids = [100, 200, 300].map(start => s.docs.get(entryPath(start)).number);
    expect(new Set(ids).size).toBe(3);
    expect(ids.slice().sort()).toEqual([1, 2, 3]);
    expect(s.docs.get(counterPath).nextNumber).toBe(4);
    expect(s.retries()).toBeGreaterThan(0);
  });

  it('numbers EVERY outcome at its first save — progress, success, failure, user stop — and never renumbers', async () => {
    const s = store();
    await save(s, { startedAt: 100 }, 110, true);
    await save(s, { startedAt: 200, endedAt: 210, ok: true }, 210);
    await save(s, failure(300), 310);
    await save(s, { ...failure(400), issues: [{ code: 'OUTCOME_USER_STOPPED' }] }, 410);
    expect([100, 200, 300, 400].map(t => [s.docs.get(entryPath(t)).number, s.docs.get(entryPath(t)).outcome]))
      .toEqual([[1, 'unfinished'], [2, 'succeeded'], [3, 'failed'], [4, 'stopped']]);
    // The unfinished build settles later: its outcome follows the report, its number never moves.
    await save(s, { startedAt: 100, endedAt: 500, ok: true }, 500);
    expect(s.docs.get(entryPath(100))).toMatchObject({ number: 1, outcome: 'succeeded', endedAt: 500, numberedAt: 110, lastSavedAt: 500 });
    expect(s.docs.get(counterPath).nextNumber).toBe(5);
  });

  it.each([
    ['missing', undefined],
    ['empty', {}],
    ['still backfilling', { state: 'backfilling', nextNumber: 7 }],
    ['zero', { state: 'ready', nextNumber: 0 }],
    ['fractional', { state: 'ready', nextNumber: 1.5 }],
    ['string', { state: 'ready', nextNumber: '7' }],
    ['nonfinite', { state: 'ready', nextNumber: NaN }],
    ['exhausted', { state: 'ready', nextNumber: Number.MAX_SAFE_INTEGER }],
  ] as const)('a %s counter saves the report and invents no number', async (_name, counter) => {
    const s = store(counter as Record<string, unknown> | undefined);
    if (counter === undefined) s.docs.delete(counterPath);
    await save(s, failure());
    expect(s.docs.get(historyPath())).toEqual({ report: failure(), savedAt: 200 });
    expect(s.docs.get(rootPath)).toEqual({ historyAvailable: true });
    expect(s.docs.has(entryPath())).toBe(false);
    expect(s.docs.get(counterPath)).toEqual(counter);
  });

  it('carries a legacy failures-only reportNumber forward untouched and never reissues it', async () => {
    const s = store(ready(3));
    s.docs.set(historyPath(), { report: failure(), reportNumber: 7, numberedAt: 120 });
    await save(s, { ...failure(), diagnostics: ['enriched'] });
    expect(s.docs.get(historyPath())).toMatchObject({ reportNumber: 7, numberedAt: 120 });
    expect(s.docs.get(entryPath())).toMatchObject({ number: 3 });
    expect(s.docs.get(counterPath).nextNumber).toBe(4);
  });

  it('merges only the discovery marker while retaining latest payload and unrelated root metadata', async () => {
    const s = store();
    const root = { report: { ...failure(1000), ok: true }, savedAt: 2000, metadata: { version: 4 } };
    s.docs.set(rootPath, root);
    await save(s, failure());
    expect(s.docs.get(rootPath)).toEqual({ ...root, historyAvailable: true });
    expect([...s.docs.keys()].sort()).toEqual([counterPath, rootPath, historyPath(), entryPath()].sort());
  });

  it('a report without a usable start time is saved but never numbered', async () => {
    const s = store();
    await commitDiagnosticsHistory(s.db, 'synthetic-workspace', { ...failure(0) }, 600);
    expect([...s.docs.keys()].some(k => k.startsWith('build_report_numbers/'))).toBe(false);
    expect(s.docs.get(counterPath)).toEqual(ready());
  });
});
