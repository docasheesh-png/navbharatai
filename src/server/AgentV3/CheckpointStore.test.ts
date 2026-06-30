import { describe, it, expect } from 'vitest';
import { dormantGitStatusFromCheckpoints, type DurableCheckpoint } from './CheckpointStore';

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
