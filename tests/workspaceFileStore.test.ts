import { describe, it, expect } from 'vitest';
import { mergeWorkspaceFiles, saveWorkspaceFiles, fileDocId, diffRemovedPaths } from '../src/server/AgentV3/WorkspaceFileStore';

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

describe('mergeWorkspaceFiles (best-effort, no Firestore in tests)', () => {
  it('never throws and resolves to undefined when there is no DB', async () => {
    await expect(mergeWorkspaceFiles('ws-1', { 'a.ts': 'x' })).resolves.toBeUndefined();
    await expect(mergeWorkspaceFiles('ws-1', {})).resolves.toBeUndefined();
  });
  it('saveWorkspaceFiles also stays a safe no-op under VITEST', async () => {
    await expect(saveWorkspaceFiles('ws-1', { 'a.ts': 'x' })).resolves.toBeUndefined();
  });
});
