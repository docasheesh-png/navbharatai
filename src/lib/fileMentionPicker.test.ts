import { describe, it, expect } from 'vitest';
import {
  activeMentionQuery,
  rankMentionSuggestions,
  applyMentionSuggestion,
  MENTION_SUGGESTION_LIMIT,
} from './fileMentionPicker';

const FILES = ['src/App.tsx', 'src/Header.tsx', 'src/headless/thing.ts', 'package.json', 'apps/web/src/main.ts'];

describe('activeMentionQuery — when the picker should be open', () => {
  it('opens the moment @ is typed at the start', () => {
    expect(activeMentionQuery('@', 1)).toEqual({ query: '', at: 0 });
  });

  it('opens after a space and captures what has been typed so far', () => {
    expect(activeMentionQuery('fix @Head', 9)).toEqual({ query: 'Head', at: 4 });
  });

  // Otherwise typing an email address would pop a file menu over the composer.
  it('stays CLOSED for a mid-word @ (an email address)', () => {
    expect(activeMentionQuery('me@example.com', 14)).toBeNull();
  });

  it('closes once the mention ends with a space', () => {
    expect(activeMentionQuery('@src/App.tsx make it sticky', 27)).toBeNull();
  });

  it('uses only the text BEFORE the caret — editing earlier must not reopen a later mention', () => {
    expect(activeMentionQuery('hello @src/App.tsx', 5)).toBeNull();
  });

  it('tracks the LAST @ when there are several', () => {
    expect(activeMentionQuery('@a.ts and @b', 12)).toEqual({ query: 'b', at: 10 });
  });

  it('handles no @ at all, and junk input', () => {
    expect(activeMentionQuery('make it faster', 5)).toBeNull();
    expect(activeMentionQuery('', 0)).toBeNull();
    expect(activeMentionQuery(null, 0)).toBeNull();
  });

  it('clamps an out-of-range caret instead of throwing', () => {
    expect(activeMentionQuery('@a', 999)).toEqual({ query: 'a', at: 0 });
    expect(activeMentionQuery('@a', -5)).toBeNull();
  });
});

describe('rankMentionSuggestions — ordered the way a person thinks about their project', () => {
  // Typing "head" means Header.tsx, not src/headless/thing.ts.
  it('a FILENAME match beats a path match', () => {
    expect(rankMentionSuggestions(FILES, 'head')[0]).toBe('src/Header.tsx');
  });

  it('a prefix beats a mid-string hit', () => {
    const out = rankMentionSuggestions(['src/xApp.tsx', 'src/App.tsx'], 'app');
    expect(out[0]).toBe('src/App.tsx');
  });

  it('is case-insensitive', () => {
    expect(rankMentionSuggestions(FILES, 'HEADER')[0]).toBe('src/Header.tsx');
  });

  it('matches a path segment too', () => {
    expect(rankMentionSuggestions(FILES, 'apps/')).toContain('apps/web/src/main.ts');
  });

  it('shows shallow files first on an empty query — top-level files are what users mean', () => {
    expect(rankMentionSuggestions(FILES, '')[0]).toBe('package.json');
  });

  it('returns nothing when nothing matches (an empty menu, never a wrong guess)', () => {
    expect(rankMentionSuggestions(FILES, 'zzzzz')).toEqual([]);
  });

  it('caps the list — a long menu is something to read, not a shortcut', () => {
    const many = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    expect(rankMentionSuggestions(many, 'file')).toHaveLength(MENTION_SUGGESTION_LIMIT);
  });

  it('handles junk input', () => {
    expect(rankMentionSuggestions(null, 'a')).toEqual([]);
    expect(rankMentionSuggestions([], 'a')).toEqual([]);
  });
});

describe('applyMentionSuggestion', () => {
  it('replaces exactly the typed mention and leaves the rest alone', () => {
    const q = activeMentionQuery('fix @Head', 9)!;
    expect(applyMentionSuggestion('fix @Head', q, 'src/Header.tsx').text).toBe('fix @src/Header.tsx ');
  });

  it('keeps text that follows the mention', () => {
    const q = activeMentionQuery('fix @Head now', 9)!;
    expect(applyMentionSuggestion('fix @Head now', q, 'src/Header.tsx').text).toBe('fix @src/Header.tsx  now');
  });

  // The trailing space is what TERMINATES the mention, which is what closes the picker.
  it('adds a trailing space, so the picker closes and typing continues', () => {
    const q = activeMentionQuery('@', 1)!;
    const r = applyMentionSuggestion('@', q, 'package.json');
    expect(r.text).toBe('@package.json ');
    expect(activeMentionQuery(r.text, r.caret)).toBeNull();
  });

  it('puts the caret after the inserted path', () => {
    const q = activeMentionQuery('@', 1)!;
    const r = applyMentionSuggestion('@', q, 'package.json');
    expect(r.caret).toBe('@package.json '.length);
  });
});
