import { describe, it, expect } from 'vitest';
import { mergeWorkspaceFiles, saveWorkspaceFiles, fileDocId, diffRemovedPaths, reconcileProjectFileTree, listWorkspaceFilePaths } from '../src/server/AgentV3/WorkspaceFileStore';

/** WorkspaceFileStore — pure helpers + best-effort no-throw under VITEST (no Firestore). */

describe('fileDocId', () => {
  it('is deterministic, slash-free, and bounded', () => {
    const id = fileDocId('src/components/App.tsx');
    expect(id).toBe(fileDocId('src/components/App.tsx'));
    expect(id).not.toContain('/');
    expect(id.length).toBeLessThanOrEqual(1500);
  });
});

describe('diffRemovedPaths', () => {
  it('splits remaining vs removed', () => {
    expect(diffRemovedPaths(['a', 'b', 'c'], ['b'])).toEqual({ remaining: ['a', 'c'], removed: ['b'] });
    expect(diffRemovedPaths(['a'], ['x'])).toEqual({ remaining: ['a'], removed: [] });
  });
});

describe('reconcileProjectFileTree (RC-1: cold sandbox must not under-see the project)', () => {
  it('a recycled/cold sandbox (few files) unions up to the durable truth', () => {
    // The exact admin failure: sandbox recycled → listFiles saw ~25, durable store held the real set.
    const sandbox = Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`);
    const durable = Array.from({ length: 1532 }, (_, i) => `src/f${i}.ts`); // superset of the 25
    const out = reconcileProjectFileTree(sandbox, durable);
    expect(out.length).toBe(1532); // the whole project is seen, not just the 25 stray files
  });

  it('a warm sandbox is byte-stable when durable adds nothing new (order sandbox-first)', () => {
    const sandbox = ['a.ts', 'b.ts', 'c.ts'];
    expect(reconcileProjectFileTree(sandbox, ['a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('unions unique files from both sides, deduped', () => {
    expect(reconcileProjectFileTree(['a.ts', 'b.ts'], ['b.ts', 'z.ts'])).toEqual(['a.ts', 'b.ts', 'z.ts']);
  });

  it('handles null/empty/garbage inputs safely', () => {
    expect(reconcileProjectFileTree(null, ['a.ts'])).toEqual(['a.ts']);
    expect(reconcileProjectFileTree(['a.ts'], null)).toEqual(['a.ts']);
    expect(reconcileProjectFileTree(null, null)).toEqual([]);
    expect(reconcileProjectFileTree(['', 'a.ts'], [undefined as unknown as string, 'b.ts'])).toEqual(['a.ts', 'b.ts']);
  });
});

describe('listWorkspaceFilePaths (metadata-only, best-effort under VITEST)', () => {
  it('never throws and resolves to [] when there is no DB', async () => {
    await expect(listWorkspaceFilePaths('ws-1')).resolves.toEqual([]);
  });
});

describe('mergeWorkspaceFiles (best-effort, no Firestore in tests)', () => {
  it('never throws and resolves to undefined when there is no DB', async () => {
    await expect(mergeWorkspaceFiles('ws-1', { 'a.ts': 'x' })).resolves.toBeUndefined();
    await expect(mergeWorkspaceFiles('ws-1', {})).resolves.toBeUndefined();
  });
  it('saveWorkspaceFiles also stays a safe no-op under VITEST', async () => {
    await expect(saveWorkspaceFiles('ws-1', { 'a.ts': 'x' })).resolves.toBeUndefined();
  });
});
