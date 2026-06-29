import { describe, it, expect } from 'vitest';
import {
  merge3, parseConflicts, resolveConflicts, hasConflictMarkers,
} from '../src/lib/merge3';

/**
 * P-DEV.4 — 3-way merge engine + conflict-marker tooling.
 */
describe('merge3 — clean auto-merges', () => {
  it('identical ours/theirs/base → unchanged, no conflict', () => {
    const r = merge3('a\nb\nc', 'a\nb\nc', 'a\nb\nc');
    expect(r.hasConflicts).toBe(false);
    expect(r.merged).toBe('a\nb\nc');
  });

  it('only OURS changed → takes ours', () => {
    const r = merge3('a\nb\nc', 'a\nB\nc', 'a\nb\nc');
    expect(r.hasConflicts).toBe(false);
    expect(r.merged).toBe('a\nB\nc');
  });

  it('only THEIRS changed → takes theirs', () => {
    const r = merge3('a\nb\nc', 'a\nb\nc', 'a\nb\nC');
    expect(r.hasConflicts).toBe(false);
    expect(r.merged).toBe('a\nb\nC');
  });

  it('non-overlapping changes on both sides → both applied, no conflict', () => {
    const r = merge3('a\nb\nc', 'A\nb\nc', 'a\nb\nC');
    expect(r.hasConflicts).toBe(false);
    expect(r.merged).toBe('A\nb\nC');
  });

  it('both sides make the SAME change → collapses, no conflict', () => {
    const r = merge3('a\nb\nc', 'a\nX\nc', 'a\nX\nc');
    expect(r.hasConflicts).toBe(false);
    expect(r.merged).toBe('a\nX\nc');
  });
});

describe('merge3 — conflicts', () => {
  it('both sides change the SAME region differently → conflict with markers', () => {
    const r = merge3('a\nb\nc', 'a\nOURS\nc', 'a\nTHEIRS\nc');
    expect(r.hasConflicts).toBe(true);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toEqual({ ours: ['OURS'], base: ['b'], theirs: ['THEIRS'] });
    expect(r.merged).toContain('<<<<<<< ours');
    expect(r.merged).toContain('=======');
    expect(r.merged).toContain('>>>>>>> theirs');
    expect(r.merged).toContain('OURS');
    expect(r.merged).toContain('THEIRS');
  });

  it('honors custom labels', () => {
    const r = merge3('b', 'x', 'y', { oursLabel: 'HEAD', theirsLabel: 'feature' });
    expect(r.merged).toContain('<<<<<<< HEAD');
    expect(r.merged).toContain('>>>>>>> feature');
  });

  it('a clean merge round-trips through merge3 without markers', () => {
    const r = merge3('1\n2\n3\n4', '1\n2\n3\n4\n5', '0\n1\n2\n3\n4');
    expect(r.hasConflicts).toBe(false);
    expect(r.merged).toBe('0\n1\n2\n3\n4\n5');
  });
});

describe('parseConflicts / resolveConflicts', () => {
  const conflicted = [
    'top',
    '<<<<<<< ours',
    'mine-1',
    'mine-2',
    '=======',
    'theirs-1',
    '>>>>>>> theirs',
    'bottom',
  ].join('\n');

  it('detects markers', () => {
    expect(hasConflictMarkers(conflicted)).toBe(true);
    expect(hasConflictMarkers('no markers here')).toBe(false);
  });

  it('parses stable + conflict segments', () => {
    const p = parseConflicts(conflicted);
    expect(p.conflictCount).toBe(1);
    expect(p.segments[0]).toEqual({ type: 'stable', lines: ['top'] });
    expect(p.segments[1]).toEqual({ type: 'conflict', ours: ['mine-1', 'mine-2'], theirs: ['theirs-1'] });
    expect(p.segments[2]).toEqual({ type: 'stable', lines: ['bottom'] });
  });

  it('parses diff3-style base section', () => {
    const withBase = ['<<<<<<< ours', 'o', '||||||| base', 'b', '=======', 't', '>>>>>>> theirs'].join('\n');
    const p = parseConflicts(withBase);
    expect(p.segments[0]).toEqual({ type: 'conflict', ours: ['o'], theirs: ['t'], base: ['b'] });
  });

  it('resolves each choice', () => {
    const p = parseConflicts(conflicted);
    expect(resolveConflicts(p, ['ours'])).toBe('top\nmine-1\nmine-2\nbottom');
    expect(resolveConflicts(p, ['theirs'])).toBe('top\ntheirs-1\nbottom');
    expect(resolveConflicts(p, ['both'])).toBe('top\nmine-1\nmine-2\ntheirs-1\nbottom');
  });

  it('defaults missing choices to ours', () => {
    const p = parseConflicts(conflicted);
    expect(resolveConflicts(p, [])).toBe('top\nmine-1\nmine-2\nbottom');
  });

  it('a fully-resolved file has no markers left', () => {
    const p = parseConflicts(conflicted);
    expect(hasConflictMarkers(resolveConflicts(p, ['theirs']))).toBe(false);
  });
});
