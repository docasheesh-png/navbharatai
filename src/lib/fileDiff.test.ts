import { describe, it, expect } from 'vitest';

import {
  computeDiff, buildHunks, diffStats, splitLines, joinLines,
  revertHunk, revertFile, hasChanges,
} from './fileDiff';

const lines = (t: string) => splitLines(t).lines;

describe('splitLines / joinLines — the trailing newline is not a line', () => {
  it('round-trips text exactly', () => {
    for (const t of ['a\nb\n', 'a\nb', '', '\n', 'one', 'x\n\ny\n']) {
      const { lines: l, trailingNewline } = splitLines(t);
      expect(joinLines(l, trailingNewline)).toBe(t);
    }
  });

  it('🔒 does NOT treat the final newline as an empty last line', () => {
    // "a\nb\n".split('\n') is ['a','b','']. Diffing that phantom element makes a final-newline change
    // look like an added blank line, and reassembly then drops or doubles the newline.
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], trailingNewline: true });
    expect(splitLines('a\nb')).toEqual({ lines: ['a', 'b'], trailingNewline: false });
  });

  it('an empty file has no lines at all', () => {
    expect(splitLines('')).toEqual({ lines: [], trailingNewline: false });
    expect(joinLines([], false)).toBe('');
  });
});

describe('computeDiff', () => {
  it('marks unchanged, added and removed lines', () => {
    const d = computeDiff(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
    expect(d.filter((l) => l.type === 'added').map((l) => l.content)).toEqual(['x']);
    expect(d.filter((l) => l.type === 'removed').map((l) => l.content)).toEqual(['b']);
  });

  it('an identical file has no changes', () => {
    expect(diffStats(computeDiff(['a'], ['a']))).toEqual({ added: 0, removed: 0 });
  });

  it('handles one side being empty', () => {
    expect(diffStats(computeDiff([], ['a', 'b']))).toEqual({ added: 2, removed: 0 });
    expect(diffStats(computeDiff(['a', 'b'], []))).toEqual({ added: 0, removed: 2 });
  });
});

describe('buildHunks', () => {
  it('returns nothing when nothing changed', () => {
    expect(buildHunks(computeDiff(['a', 'b'], ['a', 'b']))).toEqual([]);
  });

  it('separates changes that are far apart into different hunks', () => {
    const old = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const next = [...old];
    next[2] = 'CHANGED-EARLY';
    next[35] = 'CHANGED-LATE';
    const hunks = buildHunks(computeDiff(old, next), 3);
    expect(hunks.length).toBe(2);
  });

  it('merges changes that are close together into one hunk', () => {
    const old = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const next = [...old];
    next[5] = 'A';
    next[6] = 'B';
    expect(buildHunks(computeDiff(old, next), 5).length).toBe(1);
  });

  it('🔒 every hunk line carries its position in the full diff', () => {
    // Without indices a hunk could only be matched back by comparing contents — and a file full of
    // identical `}` lines makes that ambiguous, so revert would act on the wrong hunk.
    const diff = computeDiff(['a', 'b', 'c'], ['a', 'X', 'c']);
    const [h] = buildHunks(diff, 1);
    expect(h.indices).toHaveLength(h.lines.length);
    h.indices.forEach((idx, k) => expect(diff[idx]).toBe(h.lines[k]));
  });
});

describe('revertHunk — put ONE change back, keep the rest', () => {
  it('reverting the only hunk restores the original exactly', () => {
    const before = 'function greet() {\n  return "hi";\n}\n';
    const after = 'function greet() {\n  return "hello there";\n}\n';
    expect(revertHunk(before, after, 0)).toBe(before);
  });

  it('🔒 reverting ONE hunk leaves the other change in place — the whole point', () => {
    const old = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const next = old.split('\n').map((l, i) => (i === 2 ? 'EARLY' : i === 35 ? 'LATE' : l)).join('\n');
    const hunks = buildHunks(computeDiff(lines(old), lines(next)), 3);
    expect(hunks.length).toBe(2);

    const revertedFirst = revertHunk(old, next, 0, 3)!;
    const got = revertedFirst.split('\n');
    expect(got[2]).toBe('line2');   // the early change is undone
    expect(got[35]).toBe('LATE');   // the late change survives untouched
  });

  it('reverting every hunk in turn ends at the original', () => {
    const old = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const next = old.split('\n').map((l, i) => (i === 2 ? 'EARLY' : i === 35 ? 'LATE' : l)).join('\n');
    let cur = next;
    // Revert the LAST hunk first: undoing an earlier one re-indexes what follows it, and a caller
    // walking forwards would revert the wrong thing on its second step.
    for (let k = buildHunks(computeDiff(lines(old), lines(cur)), 3).length - 1; k >= 0; k--) {
      cur = revertHunk(old, cur, k, 3) ?? cur;
    }
    expect(cur).toBe(old);
  });

  it('brings a DELETED line back', () => {
    expect(revertHunk('keep\ndeleted\nkeep2\n', 'keep\nkeep2\n', 0)).toBe('keep\ndeleted\nkeep2\n');
  });

  it('removes an ADDED line', () => {
    expect(revertHunk('keep\n', 'keep\nbrand new\n', 0)).toBe('keep\n');
  });

  it('🔒 refuses an out-of-range hunk instead of corrupting the file', () => {
    // A stale UI (the file changed under it) must get an honest refusal, never a mangled write.
    const before = 'a\nb\n';
    const after = 'a\nX\n';
    expect(revertHunk(before, after, 5)).toBeNull();
    expect(revertHunk(before, after, -1)).toBeNull();
    expect(revertHunk(before, before, 0)).toBeNull();   // nothing changed ⇒ no hunk 0 exists
  });

  it('preserves a file with no trailing newline', () => {
    expect(revertHunk('a\nb', 'a\nX', 0)).toBe('a\nb');
  });

  it('handles reverting into an empty file', () => {
    expect(revertHunk('', 'added\n', 0)).toBe('');
  });
});

describe('revertFile — the whole file', () => {
  it('gives back the previous content verbatim', () => {
    expect(revertFile('old content\n')).toBe('old content\n');
    expect(revertFile('')).toBe('');
  });

  it('🔒 refuses for a file the build CREATED — there is nothing to go back to', () => {
    // Offering "revert" on a new file would promise a restore this function cannot perform. Deleting
    // it is a different action with different consequences, and the caller must choose that on purpose.
    expect(revertFile(undefined)).toBeNull();
  });
});

describe('hasChanges', () => {
  it('is false for identical text, so a no-op control is never offered', () => {
    expect(hasChanges('same', 'same')).toBe(false);
    expect(hasChanges('a', 'b')).toBe(true);
  });
});
