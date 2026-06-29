import { describe, it, expect } from 'vitest';
import { analyzePreviewHtml, buildPreviewRepairPrompt } from './PreviewVerify';

describe('analyzePreviewHtml — v3.0 sees whether its preview really rendered', () => {
  it('accepts a real rendered app (visible content, no error surface)', () => {
    const html = '<html><body><div id="root"><h1>My Todo App</h1><ul><li>Buy milk</li></ul></div></body></html>';
    const v = analyzePreviewHtml(html);
    expect(v.rendered).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it('flags an EMPTY mount root (React crashed before render)', () => {
    const html = '<html><body><div id="root"></div><script src="/main.js"></script></body></html>';
    const v = analyzePreviewHtml(html);
    expect(v.rendered).toBe(false);
    expect(v.problems.join(' ')).toMatch(/root element is empty|never rendered/i);
  });

  it('flags a Vite build-error overlay', () => {
    const html = '<html><body><vite-error-overlay></vite-error-overlay><div id="root"></div></body></html>';
    expect(analyzePreviewHtml(html).rendered).toBe(false);
    expect(analyzePreviewHtml(html).problems.join(' ')).toMatch(/build-error overlay/i);
  });

  it('flags a dev-server 404 / "Cannot GET"', () => {
    expect(analyzePreviewHtml('<pre>Cannot GET /</pre>').rendered).toBe(false);
    expect(analyzePreviewHtml('<pre>Cannot GET /</pre>').problems.join(' ')).toMatch(/404|Cannot GET/i);
  });

  it('flags an uncaught runtime error printed on the page', () => {
    const html = '<html><body><div id="root">Uncaught TypeError: cannot read properties of undefined</div></body></html>';
    expect(analyzePreviewHtml(html).rendered).toBe(false);
    expect(analyzePreviewHtml(html).problems.join(' ')).toMatch(/runtime error/i);
  });

  it('flags an empty/blank page', () => {
    expect(analyzePreviewHtml('').rendered).toBe(false);
    expect(analyzePreviewHtml('   ').rendered).toBe(false);
    const blank = analyzePreviewHtml('<html><head></head><body></body></html>');
    expect(blank.rendered).toBe(false);
    expect(blank.problems.join(' ')).toMatch(/blank|no visible content/i);
  });
});

describe('buildPreviewRepairPrompt', () => {
  it('lists the observed problems + console errors and instructs a real fix', () => {
    const p = buildPreviewRepairPrompt(["the app's root element is empty"], ['TypeError: x is undefined']);
    expect(p).toContain("the app's root element is empty");
    expect(p).toContain('TypeError: x is undefined');
    expect(p).toContain('actually render');
  });
  it('works with no console errors', () => {
    expect(buildPreviewRepairPrompt(['blank page'])).toContain('blank page');
  });
});
