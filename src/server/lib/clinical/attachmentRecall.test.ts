// Tests for Professionals attachment recall (admin 2026-08-19) — the sibling of Doctor AI's report
// memory: a file's vision-derived TEXT survives into later turns, so "us report me kya likha tha?"
// is not answered blind.

import { describe, it, expect } from 'vitest';
import {
  AttachmentRecallStore, referencesEarlierAttachment, buildRecallBlock,
} from './attachmentRecall';

const NOW = 1_000_000;
const HOURS = 60 * 60 * 1000;

describe('referencesEarlierAttachment', () => {
  it('matches English and Hinglish ways of pointing at a sent file', () => {
    for (const q of [
      'what did the document say about the deadline?',
      'us file me kya likha tha',
      'jo pdf bheja tha usme se summary banao',
      'is report ka matlab samjhao',
      'summarise the attached paper',
      'the screenshot I uploaded — what is the error?',
    ]) {
      expect(referencesEarlierAttachment(q), q).toBe(true);
    }
  });

  it('does NOT fire on ordinary conversation — recall is not free noise', () => {
    for (const q of [
      'explain photosynthesis',
      'thoda aur simple karke batao',
      'what is section 138?',
      'thanks, that helped',
    ]) {
      expect(referencesEarlierAttachment(q), q).toBe(false);
    }
  });
});

describe('AttachmentRecallStore', () => {
  it('remembers what a file said and hands it back on a later turn', () => {
    const s = new AttachmentRecallStore();
    s.remember('u1:teacher', 'The document is a physics syllabus covering optics.', NOW);
    expect(s.recall('u1:teacher', NOW + 60_000)).toEqual(['The document is a physics syllabus covering optics.']);
  });

  it('keeps sessions and professionals isolated', () => {
    const s = new AttachmentRecallStore();
    s.remember('u1:teacher', 'A', NOW);
    expect(s.recall('u2:teacher', NOW)).toEqual([]);
    expect(s.recall('u1:lawyer', NOW)).toEqual([]);
  });

  it('expires after the working-session TTL', () => {
    const s = new AttachmentRecallStore();
    s.remember('u1:teacher', 'A', NOW);
    expect(s.recall('u1:teacher', NOW + 7 * HOURS)).toEqual([]);
  });

  it('keeps at most three, oldest dropped first, and bounds each one', () => {
    const s = new AttachmentRecallStore();
    for (const t of ['a', 'b', 'c', 'd']) s.remember('u1:teacher', t, NOW);
    expect(s.recall('u1:teacher', NOW)).toEqual(['b', 'c', 'd']);
    s.remember('u2:teacher', 'x'.repeat(9000), NOW);
    expect(s.recall('u2:teacher', NOW)[0].length).toBeLessThanOrEqual(4000);
  });

  it('ignores an empty description and an empty key', () => {
    const s = new AttachmentRecallStore();
    s.remember('u1:teacher', '   ', NOW);
    s.remember('', 'something', NOW);
    expect(s.recall('u1:teacher', NOW)).toEqual([]);
  });

  it('sweep clears expired sessions only', () => {
    const s = new AttachmentRecallStore();
    s.remember('old', 'A', NOW);
    s.remember('new', 'B', NOW + 5 * HOURS);
    s.sweep(NOW + 7 * HOURS);
    expect(s.recall('old', NOW + 7 * HOURS)).toEqual([]);
    expect(s.recall('new', NOW + 7 * HOURS)).toEqual(['B']);
  });
});

describe('buildRecallBlock', () => {
  it('is honest — a record of what was read, never a claim of a fresh look', () => {
    const b = buildRecallBlock(['page one text']);
    expect(b).toContain('this is what you read');
    expect(b).toContain('send the file again');
    expect(b).toContain('page one text');
  });

  it('is empty when there is nothing remembered', () => {
    expect(buildRecallBlock([])).toBe('');
  });
});
