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
  });

  describe('removeWorkspaceFiles', () => {
    it('is a safe no-op (returns 0) without Firestore', async () => {
      // Under VITEST getDb() returns null → no-op, never throws.
      await expect(removeWorkspaceFiles('ws-x', ['a.ts'])).resolves.toBe(0);
      await expect(removeWorkspaceFiles('ws-x', [])).resolves.toBe(0);
    });
  });
});
