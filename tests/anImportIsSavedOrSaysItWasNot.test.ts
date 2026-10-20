// AN IMPORT IS SAVED, OR IT SAYS IT WAS NOT (autopsy d0b2fcd6, 2026-10-07, Q-735).
//
// A 175-file GitHub import was committed in one batch; the commit used the client's whole 60 s deadline and
// threw. The content docs HAD been written (the next read of the subcollection took 6.6 s) — but the throw
// skipped the index union, so the durable copy still listed only our 11-file starter. Both layers swallowed
// the error, the turn treated the user's app as the starter, and nobody was told.
// These tests drive the real merge over a fake store that reproduces each way a commit can end.

import { describe, it, expect } from 'vitest';
import { mergeIntoStore, mergeBatches, MERGE_BATCH_BYTES, type MergeStore } from '../src/server/AgentV3/WorkspaceFileStore';

const STARTER = ['package.json', 'index.html', 'src/App.tsx', 'src/main.tsx'];
const imported = Array.from({ length: 175 }, (_, i) => [`client/src/f${i}.tsx`, `export const f${i} = ${i};`] as const);

function store(opts: { commit: 'ok' | 'deadline-but-written' | 'lost' | ((i: number) => 'ok' | 'lost'); indexFails?: boolean }) {
  const docs = new Map<string, string>();
  let index = [...STARTER];
  let n = 0;
  const s: MergeStore = {
    commit: async (batch) => {
      const mode = typeof opts.commit === 'function' ? opts.commit(n++) : opts.commit;
      if (mode === 'lost') throw new Error('14 UNAVAILABLE');
      for (const [p, c] of batch) docs.set(p, c);
      if (mode === 'deadline-but-written') throw new Error('4 DEADLINE_EXCEEDED: Deadline exceeded');
    },
    read: async (paths) => new Map(paths.map((p) => [p, docs.get(p)])),
    readIndex: async () => index,
    writeIndex: async (paths) => { if (opts.indexFails) throw new Error('index write refused'); index = paths; },
  };
  return { s, index: () => index, docs };
}

describe('the merge', () => {
  it('🔒 THE REPORT: a commit that timed out AFTER writing is checked, found written, and indexed', async () => {
    const st = store({ commit: 'deadline-but-written' });
    const r = await mergeIntoStore(st.s, imported);
    expect(r).toMatchObject({ status: 'saved', indexed: 175, unconfirmed: [] });
    expect(st.index()).toHaveLength(175 + STARTER.length);
    expect(st.index()).toContain('client/src/f174.tsx');
    expect(st.index()).toContain('package.json'); // a union — nothing the index already had is dropped
  });

  it('🔒 a commit that really failed is NOT indexed, and the result says so', async () => {
    const st = store({ commit: 'lost' });
    const r = await mergeIntoStore(st.s, imported);
    expect(r.status).toBe('failed');
    expect(r.unconfirmed).toHaveLength(175);
    expect(st.index()).toEqual(STARTER); // never an index pointing at files that are not there
  });

  it('one batch lost ONCE is retried in smaller batches and saved (build d62bf22d)', async () => {
    const big = Array.from({ length: 900 }, (_, i) => [`f${i}.ts`, 'x'] as const);
    const st = store({ commit: (i) => (i === 1 ? 'lost' : 'ok') });
    const r = await mergeIntoStore(st.s, big, 1);
    expect(r).toMatchObject({ status: 'saved', indexed: 900, unconfirmed: [] });
  });

  it('a batch that is lost EVERY time is a PARTIAL save, named — after a bounded number of rounds', async () => {
    const big = Array.from({ length: 900 }, (_, i) => [`f${i}.ts`, 'x'] as const);
    let commits = 0;
    const docs = new Map<string, string>();
    let index: string[] = [];
    const s: MergeStore = {
      commit: async (batch) => {
        commits++;
        if (batch.some(([p]) => p === 'f450.ts')) throw new Error('4 DEADLINE_EXCEEDED');
        for (const [p, c] of batch) docs.set(p, c);
      },
      read: async (paths) => new Map(paths.map((p) => [p, docs.get(p)])),
      readIndex: async () => index,
      writeIndex: async (paths) => { index = paths; },
    };
    const r = await mergeIntoStore(s, big, 2);
    expect(r.status).toBe('partial');
    expect(r.unconfirmed).toContain('f450.ts');
    expect(r.indexed + r.unconfirmed.length).toBe(900);
    expect(r.unconfirmed.length).toBeLessThan(450); // the retry rounds saved most of the lost batch
    expect(commits).toBeLessThan(20); // bounded — never a retry loop
    expect(index).not.toContain('f450.ts');
  });

  it('the index update runs through the store\'s queue when it has one', async () => {
    const calls: string[] = [];
    const st = store({ commit: 'ok' });
    const s: MergeStore = { ...st.s, serialize: async (fn) => { calls.push('queued'); return fn(); } };
    expect((await mergeIntoStore(s, imported)).status).toBe('saved');
    expect(calls).toEqual(['queued']);
  });

  it('an index that cannot be written is a failure, never a claimed save', async () => {
    const r = await mergeIntoStore(store({ commit: 'ok', indexFails: true }).s, imported);
    expect(r.status).toBe('failed');
  });

  it('nothing to save is "nothing", not "saved"', async () => {
    expect((await mergeIntoStore(store({ commit: 'ok' }).s, [])).status).toBe('nothing');
  });
});

describe('batches are bounded by bytes, so one commit cannot outrun its deadline', () => {
  it('a few large files split into several batches; a small project stays one', () => {
    const big = Array.from({ length: 10 }, (_, i) => [`big${i}.ts`, 'x'.repeat(900 * 1024)] as const);
    const batches = mergeBatches(big);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(b.reduce((n, [p, c]) => n + c.length + p.length, 0)).toBeLessThanOrEqual(MERGE_BATCH_BYTES);
    expect(mergeBatches(imported)).toHaveLength(1);
  });
});

describe('the import reports what the store did', () => {
  it('🔒 the build-turn import records IMPORT_NOT_DURABLE and tells the user, instead of swallowing it', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).not.toMatch(/try \{ await mergeWorkspaceFiles\(workspaceId, importedFiles\); \} catch/);
    // Since build d62bf22d the save runs beside the turn and is settled before the report (importDurableSave.ts).
    expect(route).toContain('const saveImport = () => mergeWorkspaceFiles(workspaceId, importedFiles);');
    expect(route).not.toMatch(/await mergeWorkspaceFiles\(workspaceId, importedFiles\)/);
    const mod = readFileSync('src/server/AgentV3/importDurableSave.ts', 'utf8');
    expect(mod).toContain("code: 'IMPORT_NOT_DURABLE'");
  });
});
