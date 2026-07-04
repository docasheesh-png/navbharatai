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

  it('flags Open Graph tags present without og:image, but not a complete OG set', () => {
    const partial = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>My Shop Online</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="y"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(partial.findings.some((f) => /og:image is missing/.test(f.message))).toBe(true);
    // FULL has both og:title and og:image → not flagged.
    expect(analyzeSeo(FULL).findings.some((f) => /og:image/.test(f.message))).toBe(false);
  });

  it('flags an over-long <title> (truncated in search results) but not a normal one', () => {
    const longTitle = 'Best Affordable Handmade Organic Cotton Baby Clothes Store in Budaun Uttar Pradesh';
    const html = `<html lang="en"><head><meta charset="utf-8"><title>${longTitle}</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="y"><meta property="og:title" content="X"><meta property="og:image" content="/o.png"><link rel="icon" href="/f.ico"></head></html>`;
    expect(analyzeSeo(html).findings.some((f) => /search results truncate it/.test(f.message))).toBe(true);
    // a concise real title is fine.
    expect(analyzeSeo(FULL).findings.some((f) => /truncate/.test(f.message))).toBe(false);
  });

  it('flags a leftover template-default title as medium, but not a real title', () => {
    const vite = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>Vite + React</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(vite.findings.some((f) => f.level === 'medium' && /template default/.test(f.message))).toBe(true);
    const doc = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>Document</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(doc.findings.some((f) => /template default/.test(f.message))).toBe(true);
    // a real, descriptive title is fine.
    const real = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>Budaun Grocery Store</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(real.findings.some((f) => /template default/.test(f.message))).toBe(false);
    // "Home" is a DELIBERATE homepage title, not a scaffold placeholder — must NOT be flagged
    // (regression: `home` was wrongly in the default-title alternation).
    const home = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>Home</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(home.findings.some((f) => /template default/.test(f.message))).toBe(false);
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

  it('flags a non-UTF-8 charset (mojibake for Hindi) but not utf-8', () => {
    const iso = analyzeSeo('<html lang="en"><head><meta charset="ISO-8859-1"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"><meta property="og:title" content="X"><meta property="og:image" content="/o.png"><link rel="icon" href="/f.ico"></head></html>');
    expect(iso.findings.some((f) => /not UTF-8/.test(f.message))).toBe(true);
    // utf-8 (and the utf8 spelling) is fine.
    expect(analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>X</title></head></html>').findings.some((f) => /not UTF-8/.test(f.message))).toBe(false);
    expect(analyzeSeo('<html lang="en"><head><meta charset="UTF8"><title>X</title></head></html>').findings.some((f) => /not UTF-8/.test(f.message))).toBe(false);
  });

  it('flags an over-long meta description (truncated in search results) but not a normal one', () => {
    const longDesc = 'A'.repeat(200);
    const html = `<html lang="en"><head><meta charset="utf-8"><title>My Shop</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${longDesc}"><meta property="og:title" content="X"><meta property="og:image" content="/o.png"><link rel="icon" href="/f.ico"></head></html>`;
    expect(analyzeSeo(html).findings.some((f) => /search results truncate it/.test(f.message))).toBe(true);
    // a normal-length description is fine.
    expect(analyzeSeo(FULL).findings.some((f) => /search results truncate it/.test(f.message))).toBe(false);
  });

  it('flags a missing viewport as medium', () => {
    const r = analyzeSeo('<html lang="en"><head><title>X</title><meta name="description" content="y"></head></html>');
    expect(r.findings.some((f) => f.level === 'medium' && /viewport/.test(f.message))).toBe(true);
  });

  it('flags a fixed-pixel-width viewport (non-responsive) but not width=device-width', () => {
    const fixed = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>App</title><meta name="viewport" content="width=1024"><meta name="description" content="y"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(fixed.findings.some((f) => /fixed pixel width/.test(f.message))).toBe(true);
    const ok = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>App</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="y"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(ok.findings.some((f) => /fixed pixel width/.test(f.message))).toBe(false);
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
    // The "no Open Graph at all" finding must not fire once any og tag is present…
    expect(present.findings.some((f) => /No Open Graph tags/.test(f.message))).toBe(false);
    // …but a partial OG without og:image is flagged by the dedicated rule.
    expect(present.findings.some((f) => /og:image is missing/.test(f.message))).toBe(true);
  });

  it('flags a leftover robots noindex as medium, but not a normal/index page', () => {
    const noindex = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"><meta name="robots" content="noindex, nofollow"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(noindex.findings.some((f) => f.level === 'medium' && /noindex/.test(f.message))).toBe(true);
    // index,follow (or no robots meta) must not be flagged.
    const ok = analyzeSeo('<html lang="en"><head><meta charset="utf-8"><title>X</title><meta name="viewport" content="x"><meta name="description" content="y"><meta name="robots" content="index, follow"><meta property="og:title" content="X"><link rel="icon" href="/f.ico"></head></html>');
    expect(ok.findings.some((f) => /noindex/.test(f.message))).toBe(false);
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
