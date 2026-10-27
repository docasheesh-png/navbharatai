import { describe, it, expect } from 'vitest';
import { wantsVersionUndo, VERSION_UNDO_PICKER_INTRO, VERSION_UNDO_NO_WORKSPACE } from './versionUndoIntent';

describe('wantsVersionUndo — Pro chat opens the version picker (no auto-restore)', () => {
  it('matches English undo / go-back intent', () => {
    for (const q of [
      'undo',
      'undo that',
      'undo my last change',
      'revert',
      'rollback',
      'go back',
      'go back to previous version',
      'restore last version',
      'previous version',
      'this is worse',
      'broke my app',
    ]) {
      expect(wantsVersionUndo(q), q).toBe(true);
    }
  });

  it('matches Hindi / Hinglish go-back intent (any clear wording)', () => {
    for (const q of [
      'undo karo',
      'undo kar do',
      'wapas lao',
      'wapas kar do',
      'pehle wala',
      'pehle jaisa kar do',
      'purana version',
      'purana wapas',
      'app kharab ho gaya',
      'galti ho gayi',
      'ulti ho gayi',
      'restore karo',
    ]) {
      expect(wantsVersionUndo(q), q).toBe(true);
    }
  });

  it('matches Devanagari go-back intent', () => {
    expect(wantsVersionUndo('वापस लाओ')).toBe(true);
    expect(wantsVersionUndo('पहले जैसा कर दो')).toBe(true);
    expect(wantsVersionUndo('गलती हो गई')).toBe(true);
  });

  it('does NOT steal GreenGuard keep-my-changes', () => {
    expect(wantsVersionUndo('keep my changes')).toBe(false);
    expect(wantsVersionUndo('mere changes rakho')).toBe(false);
  });

  it('does NOT match building an undo feature or asking where Versioning is', () => {
    expect(wantsVersionUndo('build an undo button for my app')).toBe(false);
    expect(wantsVersionUndo('how do I open versioning')).toBe(false);
    expect(wantsVersionUndo('versioning kahaan hai')).toBe(false);
  });

  it('does NOT match a surgical colour put-back (Diff territory)', () => {
    expect(wantsVersionUndo('header ka color wo wapas do')).toBe(false);
  });

  it('empty / blank is never undo', () => {
    expect(wantsVersionUndo('')).toBe(false);
    expect(wantsVersionUndo('   ')).toBe(false);
    expect(wantsVersionUndo(null)).toBe(false);
  });

  it('picker copy never sends the user to Other → Versioning', () => {
    expect(VERSION_UNDO_PICKER_INTRO.toLowerCase()).not.toMatch(/other ai|versioning/);
    expect(VERSION_UNDO_NO_WORKSPACE.toLowerCase()).not.toMatch(/other ai|versioning/);
  });
});
