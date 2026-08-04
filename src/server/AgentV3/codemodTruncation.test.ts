import { describe, it, expect } from 'vitest';
import { codemodPassesRemaining, codemodTruncationNote, CODEMOD_CAP_PER_PASS } from './codemodTruncation';

describe('codemodPassesRemaining', () => {
  it('is 0 when nothing was skipped', () => {
    expect(codemodPassesRemaining(0)).toBe(0);
    expect(codemodPassesRemaining(-5)).toBe(0);
  });
  it('ceils skipped / cap', () => {
    expect(codemodPassesRemaining(1, 2000)).toBe(1);
    expect(codemodPassesRemaining(2000, 2000)).toBe(1);
    expect(codemodPassesRemaining(2001, 2000)).toBe(2);
    expect(codemodPassesRemaining(5000, 2000)).toBe(3);
  });
  it('defaults to the real per-pass cap', () => {
    expect(codemodPassesRemaining(CODEMOD_CAP_PER_PASS + 1)).toBe(2);
  });
  it('is safe against a non-positive cap', () => {
    expect(codemodPassesRemaining(100, 0)).toBe(0);
  });
});

describe('codemodTruncationNote', () => {
  it('returns "" when nothing was skipped (caller shows base summary only)', () => {
    expect(codemodTruncationNote('codemod_rename', 0)).toBe('');
  });
  it('names the tool, the skipped count, the cap, and the concrete number of re-runs', () => {
    const note = codemodTruncationNote('codemod_rename', 4500, 2000);
    expect(note).toContain('4500 more matching file(s)');
    expect(note).toContain('cap of 2000');
    expect(note).toContain('Re-run codemod_rename ~3 more time(s)');
    expect(note).toContain('converges');
  });
});
