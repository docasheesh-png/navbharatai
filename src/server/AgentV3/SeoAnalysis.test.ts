import { describe, it, expect } from 'vitest';
import { analyzeSeo, seoSummary } from './SeoAnalysis';

const FULL = `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<title>My Real App</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="A genuinely useful app." />
<meta property="og:title" content="My Real App" />
<meta property="og:image" content="/og.png" />
<link rel="icon" type="image/svg+xml" href="/vite.svg" />
</head><body><div id="root"></div></body></html>`;

describe('analyzeSeo', () => {
  it('is not assessable without an HTML entry', () => {
    expect(analyzeSeo(null).assessed).toBe(false);
    expect(analyzeSeo('export const x = 1;').assessed).toBe(false);
  });

  it('reports no issues for a complete HTML head', () => {
    const r = analyzeSeo(FULL);
    expect(r.assessed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('flags a missing/empty title as high', () => {
    const r = analyzeSeo('<html lang="en"><head><title></title><meta name="viewport" content="x"><meta name="description" content="y"></head></html>');
    expect(r.findings.some((f) => f.level === 'high' && /title/.test(f.message))).toBe(true);
  });

  it('flags a missing <meta charset> as low, but not when present', () => {
    const missing = analyzeSeo('<html lang="en"><head><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"></head></html>');
    expect(missing.findings.some((f) => f.level === 'low' && /charset/.test(f.message))).toBe(true);
    const present = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"></head></html>');
    expect(present.findings.some((f) => /charset/.test(f.message))).toBe(false);
  });

  it('flags a missing viewport as medium', () => {
    const r = analyzeSeo('<html lang="en"><head><title>X</title><meta name="description" content="y"></head></html>');
    expect(r.findings.some((f) => f.level === 'medium' && /viewport/.test(f.message))).toBe(true);
  });

  it('flags a missing description and lang as low', () => {
    const r = analyzeSeo('<html><head><title>X</title><meta name="viewport" content="x"></head></html>');
    expect(r.findings.some((f) => /description/.test(f.message))).toBe(true);
    expect(r.findings.some((f) => /lang attribute/.test(f.message))).toBe(true);
  });

  it('does not count an empty description content as present', () => {
    const r = analyzeSeo('<html lang="en"><head><title>X</title><meta name="viewport" content="x"><meta name="description" content=""></head></html>');
    expect(r.findings.some((f) => /description/.test(f.message))).toBe(true);
  });

  it('flags a page with no Open Graph tags as low, but not when og:title is present', () => {
    const none = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"></head></html>');
    expect(none.findings.some((f) => f.level === 'low' && /Open Graph/.test(f.message))).toBe(true);
    const present = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"></head></html>');
    expect(present.findings.some((f) => /Open Graph/.test(f.message))).toBe(false);
  });

  it('flags a page with no favicon link as low, but not when one is present', () => {
    const none = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"></head></html>');
    expect(none.findings.some((f) => f.level === 'low' && /favicon/.test(f.message))).toBe(true);
    const present = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="/favicon.ico"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"></head></html>');
    expect(present.findings.some((f) => /favicon/.test(f.message))).toBe(false);
  });
});

describe('seoSummary', () => {
  it('renders the not-assessable line', () => {
    expect(seoSummary(analyzeSeo(null))).toContain('no HTML entry');
  });
  it('renders a pass line when complete', () => {
    expect(seoSummary(analyzeSeo(FULL))).toContain('✓');
  });
  it('lists missing items', () => {
    const out = seoSummary(analyzeSeo('<html><head></head><body></body></html>'));
    expect(out).toContain('⚠');
    expect(out).toContain('missing');
  });
});
