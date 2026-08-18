import { describe, it, expect } from 'vitest';
import { dormantGitStatusFromCheckpoints, normalizeCheckpoint, type DurableCheckpoint } from './CheckpointStore';

const cp = (over: Partial<DurableCheckpoint> = {}): DurableCheckpoint => ({
  id: 'cp_1', sha: 'abcdef1234567890', message: 'init build', ts: 1000, ...over,
});

describe('dormantGitStatusFromCheckpoints — S3 git-status continuity on a cold sandbox', () => {
  it('returns null when there is no durable history (caller keeps honest "not available")', () => {
    expect(dormantGitStatusFromCheckpoints([])).toBeNull();
    expect(dormantGitStatusFromCheckpoints(null)).toBeNull();
    expect(dormantGitStatusFromCheckpoints(undefined)).toBeNull();
  });

  it('surfaces the NEWEST checkpoint as a dormant-but-valid working tree (not "not active")', () => {
    // loadCheckpoints returns newest-first, so the head/lastCommit come from index 0.
    const out = dormantGitStatusFromCheckpoints([
      cp({ sha: 'newSHA1234567', message: 'add player controls' }),
      cp({ sha: 'oldSHA9876543', message: 'init build' }),
    ]);
    expect(out).toEqual({
      available: true,
      live: false, // dormant — UI shows "Last saved …", never the scary live state
      clean: true,
      changed: 0,
      head: 'newSHA1', // 7-char short sha
      lastCommit: 'add player controls',
    });
  });

  it('tolerates a checkpoint missing sha/message', () => {
    const out = dormantGitStatusFromCheckpoints([cp({ sha: '', message: '' })]);
    expect(out).toMatchObject({ available: true, live: false, head: '', lastCommit: '' });
  });
});

// B5 — the label field. The trap worth a test: Firestore REJECTS an undefined field value, and
// saveCheckpoint swallows its own errors — so a `label: undefined` would silently stop persisting
// checkpoints at all, and the only symptom would be a history that quietly stopped growing.
describe('normalizeCheckpoint — the optional label must be OMITTED, never undefined', () => {
  it('does not create the key at all when there is no label', () => {
    const out = normalizeCheckpoint({ sha: 'abc123', message: 'build', ts: 5 });
    expect(out).not.toBeNull();
    expect('label' in (out as object)).toBe(false);
  });

  it('omits the key for a label that normalises to empty (whitespace, wrong type)', () => {
    for (const bad of ['   ', '', 42, null, {}]) {
      const out = normalizeCheckpoint({ sha: 'abc123', message: 'b', ts: 5, label: bad });
      expect('label' in (out as object), JSON.stringify(bad)).toBe(false);
    }
  });

  it('keeps a real label, normalised', () => {
    const out = normalizeCheckpoint({ sha: 'abc123', message: 'b', ts: 5, label: '  my   version ' });
    expect(out?.label).toBe('my version');
  });

  it('caps an over-long label rather than storing it whole', () => {
    const out = normalizeCheckpoint({ sha: 'abc123', message: 'b', ts: 5, label: 'y'.repeat(500) });
    expect(out?.label).toHaveLength(80);
  });

  it('still rejects a checkpoint with neither sha nor id, label or not', () => {
    expect(normalizeCheckpoint({ label: 'named but identity-less' })).toBeNull();
  });
});
