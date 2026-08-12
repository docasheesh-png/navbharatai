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

/**
 * "WE'LL ADD LOGIN IN STAGE 3" IS NOT A REQUEST FOR THIS BUILD (BENCHMARK 0 report, 2026-08-12).
 *
 * The admin's prompt opened by describing the plan: build a deliberately tiny 3D game first, then take
 * the SAME game from 0 to 100 through successive edits. Those later stages mentioned login and
 * payments. The engine read the whole message as one list of requirements and reported "Requested
 * feature not found: login / authentication" against a coin-collector game that was never supposed to
 * have one.
 *
 * Same bug this file already existed to fix, in a different tense: a keyword test cannot tell "add
 * login" from "we'll add login later" any more than it could tell it from "no login".
 */
describe('a feature promised for LATER is not requested now', () => {
  const login = /\blogin\b/i;

  it('the shape from the real report', () => {
    expect(isAffirmativelyRequested('Build a very simple 3D game. In the next stage we add login.', login)).toBe(false);
    expect(isAffirmativelyRequested('Payments come in a later phase.', /\bpayments?\b/i)).toBe(false);
  });

  it('reads the cue on EITHER side — a roadmap writes it both ways', () => {
    expect(isAffirmativelyRequested('later we will add login', login)).toBe(false);
    expect(isAffirmativelyRequested('add login later', login)).toBe(false);
  });

  it('understands the Hinglish a roadmap is actually written in', () => {
    expect(isAffirmativelyRequested('login baad me add karenge', login)).toBe(false);
    expect(isAffirmativelyRequested('aage login bhi jodenge', login)).toBe(false);
  });

  it('numbered stages count as later work', () => {
    expect(isAffirmativelyRequested('Phase 2: login and profiles', login)).toBe(false);
    expect(isAffirmativelyRequested('BENCHMARK 3 — add login', login)).toBe(false);
  });

  it('A GENUINE REQUEST IS STILL A REQUEST — this must not swallow real features', () => {
    expect(isAffirmativelyRequested('Add a login page with email and password', login)).toBe(true);
    expect(isAffirmativelyRequested('The app needs login', login)).toBe(true);
  });

  it('a distant mention of "later" does not defer an unrelated request', () => {
    // The window is deliberately small; a paragraph about future work must not silence a real ask.
    const prompt = 'Add a login page with email and password. '
      + 'The design should be clean and modern with good spacing throughout the whole application. '
      + 'We can improve the colours later.';
    expect(isAffirmativelyRequested(prompt, login)).toBe(true);
  });

  it('negation still works — the original fix is untouched', () => {
    expect(isAffirmativelyRequested('No settings, no other features — just the live clock', /\bsettings\b/i)).toBe(false);
  });
});
