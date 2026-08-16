import { describe, it, expect } from 'vitest';
import { diffRemovedPaths, removeWorkspaceFiles } from './WorkspaceFileStore';

describe('WorkspaceFileStore — delete', () => {
  describe('diffRemovedPaths (pure)', () => {
    it('splits current paths into remaining + removed', () => {
      const r = diffRemovedPaths(['a.ts', 'b.ts', 'c.ts'], ['b.ts']);
      expect(r.remaining).toEqual(['a.ts', 'c.ts']);
      expect(r.removed).toEqual(['b.ts']);
    });
    it('delete-all leaves nothing remaining', () => {
      const r = diffRemovedPaths(['a', 'b'], ['a', 'b']);
      expect(r.remaining).toEqual([]);
      expect(r.removed).toEqual(['a', 'b']);
    });
    it('ignores paths that are not present', () => {
      const r = diffRemovedPaths(['a'], ['x', 'y']);
      expect(r.remaining).toEqual(['a']);
      expect(r.removed).toEqual([]);
    });
    it('is safe for empty / junk inputs', () => {
      expect(diffRemovedPaths([], [])).toEqual({ remaining: [], removed: [] });
      expect(diffRemovedPaths(['a'], ['', null as any, undefined as any])).toEqual({ remaining: ['a'], removed: [] });
    });

    // THE PHANTOM WAS UNDELETABLE (build 5b4f9b63). A legacy absolute key is a file only the store
    // knows about, under a spelling no caller would ever type — so nothing could remove it, and every
    // build re-reported the duplicate entry point it caused.
    it('deletes a legacy absolute key when asked for its normal relative path', () => {
      const r = diffRemovedPaths(['/home/user/workspace/src/main.tsx', 'src/App.tsx'], ['src/main.tsx']);
      expect(r.removed).toEqual(['/home/user/workspace/src/main.tsx']); // the ORIGINAL, so fileDocId still resolves
      expect(r.remaining).toEqual(['src/App.tsx']);
    });

    it('also accepts the absolute spelling for a normally-stored file', () => {
      const r = diffRemovedPaths(['src/main.tsx'], ['/home/user/workspace/src/main.tsx']);
      expect(r.removed).toEqual(['src/main.tsx']);
      expect(r.remaining).toEqual([]);
    });

    it('still refuses to delete a file that merely looks similar', () => {
      const r = diffRemovedPaths(['src/main.tsx'], ['src/main.ts', 'client/src/main.tsx']);
      expect(r.removed).toEqual([]);
      expect(r.remaining).toEqual(['src/main.tsx']);
    });
  });

  describe('removeWorkspaceFiles', () => {
    it('is a safe no-op (returns 0) without Firestore', async () => {
      // Under VITEST getDb() returns null → no-op, never throws.
      await expect(removeWorkspaceFiles('ws-x', ['a.ts'])).resolves.toBe(0);
      await expect(removeWorkspaceFiles('ws-x', [])).resolves.toBe(0);
    });
  });
});
