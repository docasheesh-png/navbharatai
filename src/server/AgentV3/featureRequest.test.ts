import { describe, it, expect } from 'vitest';
import { isAffirmativelyRequested } from './featureRequest';

describe('isAffirmativelyRequested', () => {
  // THE exact bug (deep-test App #1): "No settings, no other features" must NOT count settings.
  it('returns false when the feature is explicitly declined ("No settings")', () => {
    const prompt = 'Build a simple digital clock. No settings, no other features — just the live clock.';
    expect(isAffirmativelyRequested(prompt, /\bsettings\b/i)).toBe(false);
  });

  it('returns true when the feature is genuinely requested ("add a settings page")', () => {
    expect(isAffirmativelyRequested('Add a settings page with a dark-mode toggle', /\bsettings\b/i)).toBe(true);
  });

  it('returns false when the feature is not mentioned at all', () => {
    expect(isAffirmativelyRequested('a plain clock', /\bsettings\b/i)).toBe(false);
  });

  it('handles other negation cues (without / no / disable / don\'t)', () => {
    expect(isAffirmativelyRequested('a notes app without search', /\bsearch\b/i)).toBe(false);
    expect(isAffirmativelyRequested("a todo list, don't add auth", /\bauth\b/i)).toBe(false);
    expect(isAffirmativelyRequested('disable delete for now', /\bdelete\b/i)).toBe(false);
  });

  it('returns true when at least ONE mention is affirmative even if another is negated', () => {
    // "add search" is affirmative even though a later clause declines a different thing.
    expect(isAffirmativelyRequested('add search to the list, but no filters', /\bsearch\b/i)).toBe(true);
  });

  it('does not hang on a zero-width-capable pattern and tolerates odd input', () => {
    expect(isAffirmativelyRequested('', /\bx\b/i)).toBe(false);
    // @ts-expect-error runtime guard against a non-string prompt
    expect(isAffirmativelyRequested(null, /\bx\b/i)).toBe(false);
  });
});
