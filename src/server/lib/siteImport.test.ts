import { describe, it, expect } from 'vitest';
import {
  extractSiteDesign, buildSiteImportPrompt, normalizeHex, normalizeSiteUrl,
  MAX_NAV, MAX_HEADINGS, MAX_COLORS, TEXT_SAMPLE_CHARS,
} from './siteImport';

const PAGE = `<!doctype html>
<html lang="en-IN"><head>
<title>Sharma &amp; Sons — Fresh Groceries</title>
<meta name="description" content="Daily vegetables delivered in 30 minutes.">
<meta name="theme-color" content="#0f9d58">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&family=Inter&display=swap">
<style>
  body { font-family: "Inter", system-ui, sans-serif; color: #222222; background: #fff; }
  .hero { background: #0F9D58; } .btn { background: #ff6f00; color: #FFF; } .muted { color: #222; }
</style>
<script>window.__APP__ = { color: '#123456', headline: '<h1>Not a heading</h1>' };</script>
</head><body>
<header><nav><a href="/">Home</a><a href="/shop">Shop</a><a href="/offers">Offers</a><a href="/shop">Shop</a><a href="/contact">Contact</a></nav></header>
<section class="hero">
  <h1>Fresh groceries, <b>30-minute</b> delivery</h1>
  <p>Order before 8 pm for same-day delivery across Jaipur.</p>
  <a class="btn primary" href="/shop">Start shopping</a>
  <img src="https://cdn.example.com/hero.jpg" alt="Basket of vegetables">
  <img src="https://cdn.example.com/logo.svg" alt="">
</section>
<section>
  <h2>Why us</h2>
  <h3>Farm fresh</h3><h3>Fair prices</h3>
  <div style="color:#ff6f00">Offers</div>
</section>
<section>
  <h2>Stay in touch</h2>
  <form action="/subscribe">
    <label for="em">Your email</label><input id="em" type="email" name="email">
    <input type="hidden" name="csrf" value="x">
    <select name="city"><option>Jaipur</option></select>
    <button type="submit">Subscribe</button>
  </form>
  <form action="/login"><input type="text" placeholder="Phone number"><input type="password" name="pw"><input type="submit" value="Log in"></form>
</section>
<footer><a href="/privacy">Privacy</a></footer>
<svg><path d="M0 0"/></svg>
</body></html>`;

describe('extractSiteDesign — the structure, read deterministically from the markup', () => {
  const x = extractSiteDesign(PAGE, 'https://sharma.example');

  it('reads title, description, language and the theme colour', () => {
    expect(x.title).toBe('Sharma & Sons — Fresh Groceries');
    expect(x.description).toBe('Daily vegetables delivered in 30 minutes.');
    expect(x.lang).toBe('en-IN');
    expect(x.colors[0]).toBe('#0f9d58');  // the author's declared brand colour outranks frequency
  });

  it('navigation in order, de-duplicated; headings with their level; CTAs from buttons AND button-styled links', () => {
    expect(x.nav).toEqual(['Home', 'Shop', 'Offers', 'Contact']);
    expect(x.headings[0]).toEqual({ level: 1, text: 'Fresh groceries, 30-minute delivery' });
    expect(x.headings.map((h) => h.text)).toContain('Farm fresh');
    expect(x.ctas).toEqual(expect.arrayContaining(['Subscribe', 'Start shopping']));
  });

  it('🔒 a <script> body is code, not content — its fake heading and colour never surface', () => {
    expect(x.headings.map((h) => h.text)).not.toContain('Not a heading');
    expect(x.colors).not.toContain('#123456');
    expect(x.textSample).not.toContain('__APP__');
  });

  it('forms: label > placeholder > name; hidden/submit inputs skipped; submit text captured', () => {
    expect(x.forms).toHaveLength(2);
    expect(x.forms[0].fields).toEqual([{ type: 'email', label: 'Your email' }, { type: 'select', label: 'city' }]);
    expect(x.forms[0].submit).toBe('Subscribe');
    expect(x.forms[1].fields).toEqual([{ type: 'text', label: 'Phone number' }, { type: 'password', label: 'pw' }]);
    expect(x.forms[1].submit).toBe('Log in');
  });

  it('colours normalised to #rrggbb and ranked; fonts from Google Fonts links and font-family', () => {
    expect(x.colors).toEqual(expect.arrayContaining(['#0f9d58', '#ff6f00', '#222222', '#ffffff']));
    expect(x.colors.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(x.fonts).toEqual(['Poppins', 'Inter']);
  });

  it('🔒 an image contributes its ALT TEXT only — never a URL', () => {
    expect(x.imageAlts).toEqual(['Basket of vegetables']);
    expect(JSON.stringify(x)).not.toContain('cdn.example.com');
    expect(x.counts.images).toBe(2);
  });

  it('flags login / payment / search honestly', () => {
    expect(x.flags.login).toBe(true);
    expect(x.flags.payment).toBe(false);
    expect(x.flags.search).toBe(false);
    expect(x.thin).toBe(false);
  });

  it('a JavaScript-drawn page is reported as THIN, with whatever the head still offered', () => {
    const spa = '<html><head><title>App</title><meta name="theme-color" content="#abc"></head><body><div id="root"></div><script src="/b.js"></script></body></html>';
    const t = extractSiteDesign(spa, 'https://spa.example');
    expect(t.thin).toBe(true);
    expect(t.title).toBe('App');
    expect(t.colors).toEqual(['#aabbcc']);
  });

  it('never throws on garbage and caps every list', () => {
    expect(() => extractSiteDesign('', 'https://x.example')).not.toThrow();
    expect(() => extractSiteDesign('<<<>>>"\'', 'https://x.example')).not.toThrow();
    const many = `<nav>${Array.from({ length: 50 }, (_, i) => `<a>L${i}</a>`).join('')}</nav>`
      + Array.from({ length: 100 }, (_, i) => `<h2>H${i}</h2>`).join('')
      + `<style>${Array.from({ length: 40 }, (_, i) => `.c${i}{color:#${(i * 7919).toString(16).padStart(6, '0').slice(0, 6)}}`).join('')}</style>`
      + `<p>${'word '.repeat(2000)}</p>`;
    const big = extractSiteDesign(many, 'https://big.example');
    expect(big.nav).toHaveLength(MAX_NAV);
    expect(big.headings).toHaveLength(MAX_HEADINGS);
    expect(big.colors.length).toBeLessThanOrEqual(MAX_COLORS);
    expect(big.textSample.length).toBeLessThanOrEqual(TEXT_SAMPLE_CHARS);
  });
});

describe('normalizeHex', () => {
  it('expands 3-digit, lower-cases, drops alpha, refuses non-colours', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#FF6F00')).toBe('#ff6f00');
    expect(normalizeHex('#ff6f0080')).toBe('#ff6f00');
    expect(normalizeHex('#ff6f')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });
});

describe('buildSiteImportPrompt — structure from the markup, the look from the live page', () => {
  const x = extractSiteDesign(PAGE, 'https://sharma.example');
  const p = buildSiteImportPrompt(x, { style: 'Plain CSS', framework: 'React JSX', includeJs: true });

  it('tells the builder to OPEN the live page in its browser first, and what to do if it will not open', () => {
    expect(p).toContain('open https://sharma.example in your browser tool');
    expect(p).toMatch(/If the page does not open/);
  });

  it('carries the structure: nav, headings by level, CTAs, forms, colours, fonts, counts', () => {
    expect(p).toContain('Navigation (in order): Home · Shop · Offers · Contact');
    expect(p).toContain('- H1: Fresh groceries, 30-minute delivery');
    expect(p).toContain('  - H2: Why us');
    expect(p).toContain('Your email (email)');
    expect(p).toContain('→ "Subscribe"');
    expect(p).toContain('#0f9d58');
    expect(p).toContain('Poppins');
    expect(p).toContain('a login / sign-in');
  });

  it('🔒 the copyright rule is in the spec, in words: no downloading or hot-linking of the site\'s assets', () => {
    expect(p).toMatch(/do NOT download, hot-link or reproduce/);
    expect(p).not.toContain('cdn.example.com');
  });

  it('honours the options and falls back to the defaults for unknown values', () => {
    expect(p).toContain('Target styling: Plain CSS. Target framework: React JSX.');
    expect(p).toContain('Include the interactive behaviour');
    const d = buildSiteImportPrompt(x, { style: 'evil<script>', framework: 'whatever' });
    expect(d).toContain('Target styling: Tailwind CSS. Target framework: Vanilla HTML.');
    expect(d).not.toContain('evil<script>');
  });

  it('a thin page says so instead of pretending the text sample is the site', () => {
    const t = extractSiteDesign('<html><head><title>App</title></head><body><div id="root"></div></body></html>', 'https://spa.example');
    const tp = buildSiteImportPrompt(t);
    expect(tp).toContain('draws itself with JavaScript');
    expect(tp).not.toContain('Visible text sample');
  });

  it('🔒 white-label: the spec never names a vendor or model', () => {
    expect(p).not.toMatch(/claude|anthropic|gemini|gpt|openai|glm|kimi|grok/i);
  });
});

describe('normalizeSiteUrl', () => {
  it('adds https:// to a bare host and leaves a scheme alone (the guard refuses bad ones)', () => {
    expect(normalizeSiteUrl(' example.com/path ')).toBe('https://example.com/path');
    expect(normalizeSiteUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeSiteUrl('file:///etc/passwd')).toBe('file:///etc/passwd');
    expect(normalizeSiteUrl('')).toBe('');
  });
});
