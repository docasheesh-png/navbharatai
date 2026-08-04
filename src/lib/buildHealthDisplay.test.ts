import { describe, it, expect } from 'vitest';
import { simplifyHealthLine, simplifyHealthLines } from './buildHealthDisplay';

// Admin 2026-08-02: the Build-health card was a wall of forensic detail ("hardcoded-secret @
// server/index.js:24 — Hardcoded credential — load it from an environment variable instead. | …"),
// repeated lines included. "isko itna bada aur complex likhne ki need nahi hai — simple aur short
// karo." These lock the short, de-duplicated, plain-language card WITHOUT touching the engine (the
// Report keeps every file:line detail).
describe('simplifyHealthLine — one forensic line → one short user line', () => {
  it('collapses the multi-finding high-severity security blocker (the reported case)', () => {
    const line = '4 high-severity security issue(s): hardcoded-secret @ server/index.js:24 — Hardcoded credential — load it from an environment variable instead. | hardcoded-secret @ server/index.js:41 — Hardcoded credential — load it from an environment variable instead. | hardcoded-secret @ server/index.mjs:24 — Hardcoded credential — load it from an environment variable instead.';
    const out = simplifyHealthLine(line);
    expect(out).toBe('4 security issues to fix — secret keys are written in the code');
    // No file paths, no rule ids, no repeated sentences on the card.
    expect(out).not.toContain('server/index.js');
    expect(out).not.toContain('hardcoded-secret');
    expect(out.length).toBeLessThan(80);
  });

  it('shortens the compile blocker (no code frame on the card)', () => {
    const line = 'the live preview will not compile — src/main.tsx: Duplicate declaration "ErrorBoundary" 4 | import App from \'./App\'; 5 | import ErrorBoundary from \'./ErrorBoundary\';';
    const out = simplifyHealthLine(line);
    expect(out).toBe("The app won't open yet — one code error still needs fixing");
    expect(out).not.toContain('|');
  });

  it('maps the other common lines to plain language', () => {
    expect(simplifyHealthLine('2 fake/incomplete code issue(s) (placeholder / not-implemented / fake data)'))
      .toBe('2 incomplete features (placeholder code)');
    expect(simplifyHealthLine('Security config (wildcard-cors)'))
      .toBe('A security setting needs tightening — an open CORS setting');
    expect(simplifyHealthLine('1 component(s) created but never used: src/components/posts/CommentList.tsx (CommentList)'))
      .toBe('1 part is built but not connected yet');
    expect(simplifyHealthLine('1 medium-severity security issue(s): unsafe-target-blank @ src/pages/Profile.tsx:169 — target="_blank" without rel="noopener"'))
      .toBe('1 smaller security warning — an unsafe external link');
    expect(simplifyHealthLine('3 unresolved import(s) — the build will fail: a -> b, c -> d'))
      .toBe("3 broken imports — the app won't build yet");
  });

  it('singular vs plural reads naturally', () => {
    expect(simplifyHealthLine('1 high-severity security issue(s): hardcoded-secret @ a.js:1 — x'))
      .toBe('1 security issue to fix — secret keys are written in the code');
    expect(simplifyHealthLine('2 component(s) created but never used: A, B'))
      .toBe('2 parts are built but not connected yet');
  });

  it('an unknown line degrades to its short head (never a wall of text)', () => {
    const out = simplifyHealthLine('some brand new blocker: with a very long forensic tail @ file.ts:99 — details details');
    expect(out).toBe('some brand new blocker');
  });
});

describe('simplifyHealthLines — de-duplicates and caps for the card', () => {
  it('collapses the DUPLICATE "Security config (wildcard-cors)" rows the card used to show twice', () => {
    const { lines, more } = simplifyHealthLines(
      ['Security config (wildcard-cors)', 'Security config (wildcard-cors)'],
      2,
    );
    expect(lines).toHaveLength(1);
    expect(more).toBe(0);
  });

  it('caps the list and reports how many were hidden (the Report has the rest)', () => {
    const { lines, more } = simplifyHealthLines(
      ['1 unresolved import(s) — x', '2 fake/incomplete code issue(s) (y)', 'Security config (wildcard-cors)', '1 import cycle(s)'],
      2,
    );
    expect(lines).toHaveLength(2);
    expect(more).toBe(2);
  });

  it('the admin\'s exact card becomes short and readable end-to-end', () => {
    const blockers = [
      '4 high-severity security issue(s): hardcoded-secret @ server/index.js:24 — Hardcoded credential — load it from an environment variable instead. | hardcoded-secret @ server/index.js:41 — Hardcoded credential — load it from an environment variable instead.',
      '2 fake/incomplete code issue(s) (placeholder / not-implemented / fake data)',
      'the live preview will not compile — src/main.tsx: Duplicate declaration "ErrorBoundary" 4 | import App',
    ];
    const warnings = [
      '1 component(s) created but never used: src/components/posts/CommentList.tsx (CommentList)',
      '1 medium-severity security issue(s): unsafe-target-blank @ src/pages/Profile.tsx:169 — target="_blank" without rel="noopener"',
      'Security config (wildcard-cors)',
      'Security config (wildcard-cors)',
    ];
    const b = simplifyHealthLines(blockers, 3);
    const w = simplifyHealthLines(warnings, 2);
    expect(b.lines).toEqual([
      '4 security issues to fix — secret keys are written in the code',
      '2 incomplete features (placeholder code)',
      "The app won't open yet — one code error still needs fixing",
    ]);
    expect(w.lines).toEqual([
      '1 part is built but not connected yet',
      '1 smaller security warning — an unsafe external link',
    ]);
    // 5 short lines instead of 8 long ones, and every line fits on a phone row.
    for (const l of [...b.lines, ...w.lines]) expect(l.length).toBeLessThanOrEqual(70);
    expect(w.more).toBe(1); // the de-duplicated CORS line is the only hidden one
  });
});
