/**
 * Audit 2026-10-11: two deletes put an unbounded list into ONE Firestore batch, which Firestore refuses past 500
 * writes. Deleting a long conversation failed outright; the metrics-timeline retention sweep (up to 1,600 docs
 * at the default 8 shards) threw, was swallowed as housekeeping, and never deleted anything again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deleteInChunks, SAFE_BATCH_WRITES } from '../src/server/lib/batchChunks';

function fakeDb() {
  const commits: string[][] = [];
  return {
    commits,
    db: {
      batch() {
        const ops: string[] = [];
        return { delete(ref: { id: string }) { ops.push(ref.id); }, async commit() { if (ops.length > 500) throw new Error('too many writes'); commits.push(ops); } };
      },
    },
  };
}

describe('deleteInChunks', () => {
  it('splits any number of deletes into batches Firestore accepts, parent last', async () => {
    const { db, commits } = fakeDb();
    const refs = Array.from({ length: 1_234 }, (_, i) => ({ id: `t${i}` }));
    const n = await deleteInChunks(db as never, refs as never, { id: 'main' } as never);
    expect(n).toBe(1_235);
    expect(commits.every((c) => c.length <= SAFE_BATCH_WRITES)).toBe(true);
    expect(commits.at(-1)).toEqual(['main']);
    expect(commits.flat().length).toBe(1_235);
  });
});

/** Every server source file, and how many `.batch()` calls each holds. */
function batchSites(): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.ts$/.test(n) || /\.test\./.test(n)) continue;
      const c = (readFileSync(p, 'utf8').match(/\.batch\(\)/g) ?? []).length;
      if (c > 0) out[p] = c;
    }
  };
  walk('src/server');
  return out;
}

describe('census: every batch is bounded', () => {
  // Each reviewed site, with how its batch stays under 500 writes. A NEW `.batch()` fails this test until it
  // uses deleteInChunks (or another bound) and is listed here with the reason.
  const REVIEWED: Record<string, [number, string]> = {
    'src/server/lib/batchChunks.ts': [2, 'the chunking helper itself (SAFE_BATCH_WRITES = 400)'],
    'src/server/AgentV3/DiagnosticsStore.ts': [1, 'loop of limit(300) pages'],
    'src/server/AgentV3/WorkspaceAssetStore.ts': [1, 'slices of BATCH'],
    'src/server/AgentV3/AdminBuildReportStore.ts': [1, 'loop of limit(300) pages'],
    'src/server/AgentV3/WorkspaceFileStore.ts': [4, 'slices of BATCH, or limit(BATCH) pages; the merge store is called with slices'],
    'src/server/project/BuildHistoryStore.ts': [1, 'deletes only the excess over MAX_VERSIONS_PER_WORKSPACE'],
    'src/server/lib/DataRetentionManager.ts': [1, 'limit(max) where max <= DEFAULT_MAX_PER_RUN (500, Firestore\'s own limit)'],
    'src/server/lib/AdminApkReportStore.ts': [1, 'slices of 400'],
    'src/server/lib/derivedIdErase.ts': [1, 'pages of a bounded size'],
    'src/server/lib/sharedDataStore.ts': [2, 'loop of limit(200) pages'],
    'src/server/lib/workspaceDataErase.ts': [1, 'pages of a bounded size'],
    'src/server/lib/navStoreWeb.ts': [5, 'slices of BATCH, or a fixed handful of documents'],
  };

  it('no unreviewed batch, and the reviewed ones did not grow', () => {
    const now = batchSites();
    const unreviewed = Object.keys(now).filter((f) => !(f in REVIEWED)).map((f) => `${f} (${now[f]})`);
    expect(unreviewed, 'Use deleteInChunks (src/server/lib/batchChunks.ts) or bound the batch, then list it here').toEqual([]);
    for (const [f, [count]] of Object.entries(REVIEWED)) expect(now[f] ?? 0, f).toBeLessThanOrEqual(count);
  });

  it('the two unbounded deletes go through the helper', () => {
    expect(readFileSync('src/server/AgentV3/FirestoreConversationStore.ts', 'utf8')).toMatch(/await deleteInChunks\(this\.db, /);
    expect(readFileSync('src/server/lib/metricsTimeline.ts', 'utf8')).toMatch(/await deleteInChunks\(db, stale\.docs\.map/);
  });
});
