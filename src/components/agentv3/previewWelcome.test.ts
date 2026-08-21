// Tests for the "no app yet" preview state — the fix for a spinner and a red "Fix with AI" error
// shown to a user who has not built anything (admin 2026-08-21).

import { describe, it, expect } from 'vitest';
import { previewEmptyKind, welcomeLine, WELCOME_LINES, WELCOME_HEADLINE } from './previewWelcome';

describe('previewEmptyKind — the three states are genuinely different', () => {
  it('THE REPORTED BUG: a workspace known to have no files is never "loading"', () => {
    expect(previewEmptyKind({ knownEmpty: true, loading: true, error: '' })).toBe('no-app-yet');
  });

  it('THE REPORTED BUG: "nothing built yet" is never an error, even when the server said so', () => {
    expect(previewEmptyKind({ knownEmpty: true, loading: false, error: 'No files to preview yet' }))
      .toBe('no-app-yet');
  });

  it('real work on a KNOWN app still gets the spinner', () => {
    expect(previewEmptyKind({ knownEmpty: false, loading: true, error: '', everRendered: true })).toBe('loading');
  });

  it('THE REPORTED BUG: the very first request on a brand-new workspace does NOT get the spinner', () => {
    // Nobody yet knows whether an app exists here, so "getting your app ready" is a claim we cannot
    // support — and it is the exact spinner the admin could not attribute to any app.
    expect(previewEmptyKind({ knownEmpty: false, loading: true, error: '', everRendered: false })).toBe('no-app-yet');
    expect(previewEmptyKind({ knownEmpty: false, loading: true, error: '' })).toBe('no-app-yet');
  });

  it('a real failure is still reported as a failure — this fix must not hide breakage', () => {
    expect(previewEmptyKind({ knownEmpty: false, loading: false, error: 'compile failed' })).toBe('error');
  });

  it('nothing known at all reads as the beginning, not as a fault', () => {
    expect(previewEmptyKind({ knownEmpty: false, loading: false, error: '' })).toBe('no-app-yet');
  });
});

describe('the welcome copy', () => {
  it('rotates through every line and wraps forever', () => {
    const seen = new Set<string>();
    for (let i = 0; i < WELCOME_LINES.length * 3; i++) seen.add(welcomeLine(i));
    expect(seen.size).toBe(WELCOME_LINES.length);
    expect(welcomeLine(WELCOME_LINES.length)).toBe(welcomeLine(0));
  });

  it('is safe on a negative or fractional tick', () => {
    expect(WELCOME_LINES).toContain(welcomeLine(-1));
    expect(WELCOME_LINES).toContain(welcomeLine(-97));
    expect(WELCOME_LINES).toContain(welcomeLine(2.7));
  });

  it('never claims work is happening — that claim WAS the bug', () => {
    const forbidden = /loading|compiling|processing|getting your app ready|please wait|building/i;
    expect(WELCOME_HEADLINE).not.toMatch(forbidden);
    for (const line of WELCOME_LINES) expect(line, line).not.toMatch(forbidden);
  });

  it('speaks to Indian users in their own words too (the product’s moat, not decoration)', () => {
    expect(WELCOME_LINES.some((l) => /hindi|hinglish|likhein|banega|ban kar/i.test(l))).toBe(true);
  });
});
