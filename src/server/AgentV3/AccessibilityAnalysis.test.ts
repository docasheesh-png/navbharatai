import { describe, it, expect } from 'vitest';
import { scanAccessibility, accessibilitySummary } from './AccessibilityAnalysis';

describe('scanAccessibility', () => {
  it('flags an <img> with no alt as high', () => {
    const issues = scanAccessibility('src/Page.tsx', '<img src="/logo.png" />');
    expect(issues.some((x) => x.kind === 'img-missing-alt' && x.severity === 'high')).toBe(true);
  });

  it('does not flag an <img> that has alt (even empty alt is valid)', () => {
    expect(scanAccessibility('src/Page.tsx', '<img src="/logo.png" alt="Company logo" />')).toEqual([]);
    expect(scanAccessibility('src/Page.tsx', '<img src="/d.png" alt="" />')).toEqual([]);
  });

  it('flags <html> without lang as medium', () => {
    const issues = scanAccessibility('index.html', '<html>');
    expect(issues.some((x) => x.kind === 'html-missing-lang' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('index.html', '<html lang="en">')).toEqual([]);
  });

  it('flags autoplaying audio / unmuted autoplay video (WCAG 1.4.2), but not muted video autoplay', () => {
    expect(scanAccessibility('src/P.tsx', '<audio src="/s.mp3" autoplay />').some((x) => x.kind === 'media-autoplay')).toBe(true);
    expect(scanAccessibility('src/P.tsx', '<video src="/v.mp4" autoplay />').some((x) => x.kind === 'media-autoplay')).toBe(true);
    // Muted video autoplay (common background loop) is fine.
    expect(scanAccessibility('src/P.tsx', '<video src="/v.mp4" autoplay muted loop />').some((x) => x.kind === 'media-autoplay')).toBe(false);
    // No autoplay → not flagged.
    expect(scanAccessibility('src/P.tsx', '<video src="/v.mp4" controls />').some((x) => x.kind === 'media-autoplay')).toBe(false);
  });

  it('flags an icon-only <a href> link with no accessible name, but not a text/aria-label link', () => {
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home"><svg /></a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(true);
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home">Home</a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(false);
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home" aria-label="Home"><svg /></a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(false);
    // No href → handled by anchor-missing-href, not this rule.
    expect(scanAccessibility('src/Nav.tsx', '<a><svg /></a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(false);
  });

  it('flags <iframe> without a title (medium) but not one with title or aria-label', () => {
    const issues = scanAccessibility('src/Embed.tsx', '<iframe src="https://x.com/v" />');
    expect(issues.some((x) => x.kind === 'iframe-missing-title' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/Embed.tsx', '<iframe src="https://x.com/v" title="Demo video" />')).toEqual([]);
    expect(scanAccessibility('src/Embed.tsx', '<iframe src="https://x.com/v" aria-label="Demo" />')).toEqual([]);
  });

  it('flags a form control with no accessible name (medium) but not one with aria-label or id', () => {
    const bad = scanAccessibility('src/Form.tsx', '<input type="text" />');
    expect(bad.some((x) => x.kind === 'control-unlabeled' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/Form.tsx', '<input type="text" aria-label="Name" />')).toEqual([]);
    // an id may be the target of a <label for> elsewhere — conservative, not flagged.
    expect(scanAccessibility('src/Form.tsx', '<input id="name" type="text" />')).toEqual([]);
    // types that need no label are not flagged.
    expect(scanAccessibility('src/Form.tsx', '<input type="submit" />')).toEqual([]);
  });

  it('flags onClick on a non-interactive element with no role as low', () => {
    const issues = scanAccessibility('src/Btn.tsx', '<div onClick={go}>Go</div>');
    expect(issues.some((x) => x.kind === 'click-on-noninteractive' && x.severity === 'low')).toBe(true);
    // a role makes it acceptable.
    expect(scanAccessibility('src/Btn.tsx', '<div role="button" onClick={go}>Go</div>')).toEqual([]);
    // a real <button> is interactive — not flagged.
    expect(scanAccessibility('src/Btn.tsx', '<button onClick={go}>Go</button>')).toEqual([]);
  });

  it('flags a positive tabindex as low', () => {
    expect(scanAccessibility('src/A.tsx', '<div tabIndex={3}>x</div>').some((x) => x.kind === 'positive-tabindex')).toBe(true);
    expect(scanAccessibility('src/A.tsx', '<div tabindex="2">x</div>').some((x) => x.kind === 'positive-tabindex')).toBe(true);
    // tabIndex 0 or -1 is fine.
    expect(scanAccessibility('src/A.tsx', '<div tabIndex={0}>x</div>')).toEqual([]);
  });

  it('flags an empty icon button with no accessible name as low', () => {
    const issues = scanAccessibility('src/Icon.tsx', '<button><svg /></button>');
    expect(issues.some((x) => x.kind === 'button-no-accessible-name' && x.severity === 'low')).toBe(true);
    // aria-label resolves it.
    expect(scanAccessibility('src/Icon.tsx', '<button aria-label="Close"><svg /></button>')).toEqual([]);
  });

  it('flags an anchor with no href as low', () => {
    expect(scanAccessibility('src/Nav.tsx', '<a onClick={go}>Home</a>').some((x) => x.kind === 'anchor-missing-href')).toBe(true);
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home">Home</a>')).toEqual([]);
  });

  it('returns [] for non-frontend files and test/vendored paths', () => {
    expect(scanAccessibility('src/util.ts', '<img src="x" />')).toEqual([]);
    expect(scanAccessibility('src/Page.test.tsx', '<img src="x" />')).toEqual([]);
    expect(scanAccessibility('node_modules/pkg/Page.tsx', '<img src="x" />')).toEqual([]);
  });

  it('does not flag clean, accessible markup (no false positives)', () => {
    const clean = scanAccessibility(
      'src/Page.tsx',
      '<main>\n  <img src="/a.png" alt="A" />\n  <label htmlFor="q">Search</label>\n  <input id="q" type="text" />\n  <button onClick={go}>Search</button>\n</main>',
    );
    expect(clean).toEqual([]);
  });
});

describe('accessibilitySummary', () => {
  it('reports a clean line when there are no issues', () => {
    expect(accessibilitySummary([])).toContain('No accessibility issues detected');
  });

  it('summarises by severity with file:line lines when non-empty', () => {
    const sum = accessibilitySummary([
      { file: 'a.tsx', line: 1, kind: 'img-missing-alt', severity: 'high', snippet: '<img src="x" />' },
      { file: 'b.tsx', line: 2, kind: 'positive-tabindex', severity: 'low', snippet: '<div tabIndex={3} />' },
    ]);
    expect(sum).toContain('1 high');
    expect(sum).toContain('1 low');
    expect(sum).toContain('a.tsx:1');
    expect(sum).toContain('img-missing-alt');
  });

  it('truncates to 15 lines with a "more" tail', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      file: `f${i}.tsx`,
      line: i + 1,
      kind: 'img-missing-alt' as const,
      severity: 'high' as const,
      snippet: '<img />',
    }));
    expect(accessibilitySummary(many)).toContain('…and 5 more.');
  });
});
