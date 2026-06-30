import { describe, it, expect } from 'vitest';
import { ConflictDetector } from '../src/server/AppMakerLab/mutation/ConflictDetector';
import type { WorkspacePatchBatch } from '../src/server/AppMakerLab/mutation/MutationTypes';

function batch(patches: { path: string; content: string }[]): WorkspacePatchBatch {
  return { id: 'batch-1', patches };
}

describe('ConflictDetector.detectConflicts', () => {
  const detector = new ConflictDetector();

  it('returns false for empty batch', () => {
    expect(detector.detectConflicts(batch([]))).toBe(false);
  });

  it('returns false for single-patch batch', () => {
    expect(detector.detectConflicts(batch([{ path: 'src/a.ts', content: 'code' }]))).toBe(false);
  });

  it('returns false for multiple non-conflicting patches', () => {
    expect(detector.detectConflicts(batch([
      { path: 'src/a.ts', content: 'a' },
      { path: 'src/b.ts', content: 'b' },
    ]))).toBe(false);
  });

  it('detects a conflict when two patches target the SAME path (last-write-wins data loss)', () => {
    const b = batch([
      { path: 'src/a.ts', content: 'v1' },
      { path: 'src/b.ts', content: 'b' },
      { path: 'src/a.ts', content: 'v2' },
    ]);
    expect(detector.detectConflicts(b)).toBe(true);
    expect(detector.conflictingPaths(b)).toEqual(['src/a.ts']);
  });
});
