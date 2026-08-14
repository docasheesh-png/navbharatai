import { describe, it, expect } from 'vitest';
import { lintBuiltApp, designLintSummary, a11yLintSummary, MAX_LINT_CHARS } from './buildQualityLint';

/**
 * Wiring two finished linters that nothing had ever called on a real build.
 *
 * The risk being tested is NOT whether the linters work — they are pure and already unit-tested. It is
 * whether feeding them a whole app produces findings worth showing. A build-end check that fires on a
 * good app is worse than no check: it trains everyone to ignore the section it lives in, and then the
 * real finding arrives and is skipped too. So most of what follows is about NOT crying wolf.
 */

const cleanApp = {
  'src/App.tsx': `
    export default function App() {
      return <main className="page"><h1>Notes</h1><img src="/logo.png" alt="Company logo" />
        <label htmlFor="q">Search</label><input id="q" />
        <button>Save</button></main>;
    }`,
  'src/styles.css': `:root { --brand: #2b6cb0; --ink: #1a202c; }
    .page { padding: 16px; gap: 8px; } .card { padding: 24px; }`,
  'index.html': '<html lang="en"><body><div id="root"></div></body></html>',
};

describe('it does not cry wolf on a good app', () => {
  it('a clean app scores well and raises nothing', () => {
    const r = lintBuiltApp(cleanApp)!;
    expect(r).not.toBeNull();
    expect(r.a11y.violations).toHaveLength(0);
    expect(r.a11y.score).toBe(100);
    expect(r.design.score).toBeGreaterThanOrEqual(75);
  });

  it('a fragment app is not blamed for having no <html lang>', () => {
    /**
     * The false positive this wiring could most easily have shipped. Concatenating JSX gives a string
     * with no `<html>` element at all, and a naive check would report "missing lang" on EVERY app ever
     * built. (The linter's own guard handles it — this pins that the wiring did not defeat it.)
     */
    const r = lintBuiltApp({ 'src/App.tsx': '<div><h1>hi</h1></div>' })!;
    expect(r.a11y.violations.find((v) => v.type === 'html-lang')).toBeUndefined();
  });
});

describe('what it is fed — the difference between a real score and a meaningless one', () => {
  it('vendored and generated code is excluded', () => {
    /**
     * A minified stylesheet holds thousands of hex colours belonging to somebody else. Including one
     * would report a catastrophic consistency score for an app whose own code is spotless — exactly the
     * finding that teaches a user the check is broken.
     */
    const noise = Array.from({ length: 60 }, (_, i) => `.c${i}{color:#${(i * 7).toString(16).padStart(6, '0')}}`).join('');
    const withVendor = { ...cleanApp, 'node_modules/pkg/theme.css': noise, 'dist/app.min.css': noise, 'src/vendor.bundle.js': noise };
    expect(lintBuiltApp(withVendor)!.design.score).toBe(lintBuiltApp(cleanApp)!.design.score);
  });

  it('non-source files are ignored entirely', () => {
    const r = lintBuiltApp({ ...cleanApp, 'README.md': '#ff0000 #00ff00 #0000ff', 'logo.png': 'binary' })!;
    expect(r.fileCount).toBe(3);
  });

  it('an app with nothing lintable returns null, NOT a perfect score', () => {
    /**
     * The honesty case. A 100 here would read as "this app is flawless"; the truth is "we looked at
     * nothing", and those must not produce the same output.
     */
    expect(lintBuiltApp({ 'README.md': 'hi', 'data.json': '{}' })).toBeNull();
    expect(lintBuiltApp({})).toBeNull();
  });

  it('oversized input is capped, and SAYS it was capped', () => {
    const big = { 'index.html': '<html lang="en"></html>', 'src/huge.tsx': 'x'.repeat(MAX_LINT_CHARS + 10), 'src/App.tsx': '<div/>' };
    const r = lintBuiltApp(big)!;
    expect(r.truncated).toBe(true);
    // …and it still linted what it could rather than giving up.
    expect(r.fileCount).toBeGreaterThan(0);
    expect(designLintSummary(r)).toContain('partially scanned');
  });
});

describe('it finds the things nothing else in the stack looks for', () => {
  it('catches missing alt text, unlabelled fields and unnamed controls', () => {
    // None of these fail tsc, ESLint, the CSS check or the reviewer — they are invisible today.
    const r = lintBuiltApp({
      'src/App.tsx': `<div><img src="/a.png" /><input type="text" /><button><Icon /></button></div>`,
    })!;
    const types = r.a11y.violations.map((v) => v.type);
    expect(types).toContain('img-alt');
    expect(types).toContain('input-label');
    expect(types).toContain('control-name');
    expect(r.a11y.score).toBeLessThan(100);
  });

  it('every accessibility finding names its WCAG criterion', () => {
    // "Add a label" is an opinion; "WCAG 1.3.1" is a standard, and it is what makes the finding
    // actionable rather than arguable.
    const r = lintBuiltApp({ 'src/App.tsx': '<img src="/a.png" />' })!;
    expect(a11yLintSummary(r)).toMatch(/WCAG 1\.1\.1/);
  });

  it('catches a design that is styled but inconsistent', () => {
    /**
     * The gap between this and the design GATE, made concrete: every element here carries a class and
     * the page is fully styled, so the per-page coverage check passes it — while it uses a different
     * one-off colour in every rule.
     */
    const many = Array.from({ length: 24 }, (_, i) => `.s${i}{color:#${i.toString(16).repeat(6).slice(0, 6)};padding:${i * 3 + 1}px}`).join('\n');
    const r = lintBuiltApp({ 'src/styles.css': many })!;
    expect(r.design.violations.length).toBeGreaterThan(0);
    expect(r.design.score).toBeLessThan(100);
  });

  it('every design finding carries an instruction the builder could act on', () => {
    // The linters were written for a one-click "Fix with AI" button. Wired here the fix text is what
    // makes a report line something a user can hand straight back as the next request.
    const many = Array.from({ length: 24 }, (_, i) => `.s${i}{color:#${i.toString(16).repeat(6).slice(0, 6)}}`).join('\n');
    const r = lintBuiltApp({ 'src/styles.css': many })!;
    expect(r.design.violations.every((v) => typeof v.fix === 'string' && v.fix.length > 20)).toBe(true);
  });
});

describe('it can never be the reason a build is reported as failed', () => {
  it('malformed input yields a result or null — never a throw', () => {
    const junk = { 'src/a.tsx': null, 'src/b.tsx': undefined, 42: 'x' } as unknown as Record<string, string>;
    expect(() => lintBuiltApp(junk)).not.toThrow();
    expect(() => lintBuiltApp(null as unknown as Record<string, string>)).not.toThrow();
    expect(() => lintBuiltApp(undefined as unknown as Record<string, string>)).not.toThrow();
  });

  it('summaries are safe on a clean result', () => {
    const r = lintBuiltApp(cleanApp)!;
    expect(() => designLintSummary(r)).not.toThrow();
    expect(a11yLintSummary(r)).toContain('no common WCAG failures');
  });
});
