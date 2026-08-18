import { describe, it, expect } from 'vitest';
import { normalizeCheckpointLabel, checkpointDisplayName, CHECKPOINT_LABEL_MAX } from './checkpointLabel';

describe('normalizeCheckpointLabel', () => {
  it('trims and keeps a normal name', () => {
    expect(normalizeCheckpointLabel('  before I broke the login  ')).toBe('before I broke the login');
  });

  // A pasted multi-line string would otherwise break the one-line list layout.
  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(normalizeCheckpointLabel('working\n\n  cart\tpage')).toBe('working cart page');
  });

  it('caps at the shared maximum, so the UI can never show more than the server stores', () => {
    expect(normalizeCheckpointLabel('x'.repeat(500))).toHaveLength(CHECKPOINT_LABEL_MAX);
  });

  // '' MEANS "no label" — it is also how a name is cleared, which is why there is no delete endpoint.
  it('returns empty for anything unusable, and empty means "no name"', () => {
    for (const bad of ['', '   ', '\n\t', null, undefined, 42, {}, []]) {
      expect(normalizeCheckpointLabel(bad), JSON.stringify(bad)).toBe('');
    }
  });

  it('keeps non-Latin names intact (a user naming a version in Hindi is the normal case here)', () => {
    expect(normalizeCheckpointLabel('  लॉगिन ठीक करने से पहले ')).toBe('लॉगिन ठीक करने से पहले');
  });
});

// THE COMPLAINT B5 ANSWERS: "14 unnamed checkpoints are unusable". Every row must be identifiable.
describe('checkpointDisplayName — a row in the list is never unidentifiable', () => {
  it("prefers the user's own name over the auto commit message", () => {
    expect(checkpointDisplayName({ label: 'before the redesign', message: 'chore: build', sha: 'abc1234def' }))
      .toBe('before the redesign');
  });

  it('falls back to the commit message when unnamed', () => {
    expect(checkpointDisplayName({ message: 'add cart page', sha: 'abc1234def' })).toBe('add cart page');
  });

  it('falls back to the short sha when there is no name AND no message', () => {
    expect(checkpointDisplayName({ sha: 'abc1234def567' })).toBe('abc1234');
  });

  it('never returns empty, even for a checkpoint with nothing on it at all', () => {
    expect(checkpointDisplayName({})).toBe('checkpoint');
    expect(checkpointDisplayName({ label: '   ', message: '  ', sha: '' })).toBe('checkpoint');
  });

  it('returns empty only for no checkpoint at all', () => {
    expect(checkpointDisplayName(null)).toBe('');
    expect(checkpointDisplayName(undefined)).toBe('');
  });

  it('a whitespace-only name does not shadow a real message', () => {
    expect(checkpointDisplayName({ label: '   ', message: 'real message', sha: 'aaaaaaa' })).toBe('real message');
  });
});
