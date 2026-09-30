// "DEKHO! YEH KOI UI HAI? EK DAM SIMPLE SA PAGE BANA DIYA!" (admin 2026-09-30, a screenshot of "Nemi Mart").
//
// A grocery app: the header stacked into three lines, the products ran in one long column, the MRP sat
// beside the price NOT struck through, and "Start Shopping" was a square, underlined box. Three separate
// causes, each locked here:
//
//   1. The class check that drives the CSS repair read only `className=`. A plain HTML + JS app names its
//      classes with `class=` — in the page and in the strings its script writes — so every one of them
//      was invisible, and the repair built for exactly this never ran. It also counted only kebab-case
//      names, and a page whose classes are single words ("header", "price", "mrp") passed silently.
//   2. The kit gave `.btn-primary` its FILL and not its SHAPE: padding, radius and inline-flex lived on
//      `:where(button), .btn` only, so `<a class="btn-primary">` rendered as a coloured rectangle.
//   3. The kit had no shop layout at all — no header row, no product grid, no struck-through MRP — so a
//      model had nothing to reach for and invented names nobody styled.
import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  cssConsistencyError, collectDefinedClasses, collectUsedClasses, findUndefinedClasses,
  undefinedClassesInFile, undefinedClassesWriteNote,
} from '../src/server/AgentV3/CssConsistency';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { parseCssBlocks, kitClasses } from '../src/server/AgentV3/kitRestore';
import { DESIGN_KIT_VOCABULARY } from '../src/server/AgentV3/SimpleBuilder';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

// The shape of the page in the screenshot: plain HTML, a small stylesheet that styles none of its classes,
// and product cards written by a script.
const NEMI_HTML = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>
  <header class="header"><div class="logo">Nemi Mart</div><input class="search" placeholder="Search"><button class="cart">Cart</button></header>
  <section class="hero"><h1>Groceries in 10 minutes</h1><a class="btn-primary" href="#shop">Start Shopping</a></section>
  <div id="products" class="products"></div>
  <script src="app.js"></script>
</body></html>`;
const NEMI_JS = `const list = document.getElementById('products');
for (const p of items) {
  list.innerHTML += '<div class="product"><span class="price">₹' + p.price + '</span><span class="mrp">₹' + p.mrp + '</span></div>';
  list.innerHTML += \`<span class="discount \${p.off ? 'active' : ''}">\${p.off}% off</span>\`;
  list.innerHTML += "<button class=\\"add-btn\\">Add</button>";
}`;
const NEMI_CSS = `body { font-family: sans-serif; }`;
const nemi = { 'index.html': NEMI_HTML, 'app.js': NEMI_JS, 'style.css': NEMI_CSS };

describe('1 · the class check reads a plain HTML app, and single-word classes', () => {
  it('🔴 reads `class=` in the page and in the markup strings its script writes', () => {
    const used = collectUsedClasses(nemi);
    for (const c of ['header', 'logo', 'search', 'cart', 'hero', 'btn-primary', 'products', 'product', 'price', 'mrp', 'discount', 'add-btn']) {
      expect(used.has(c), c).toBe(true);
    }
    // An interpolation is not a class.
    expect([...used].some((c) => c.includes('$') || c.includes('{'))).toBe(false);
  });

  it('🔴 the Nemi Mart page is now a real mismatch, so the CSS repair runs', () => {
    const missing = findUndefinedClasses(nemi);
    expect(missing).toEqual(expect.arrayContaining(['header', 'logo', 'price', 'mrp', 'discount', 'product', 'add-btn']));
    expect(missing).not.toContain('active'); // a state word a script toggles
    expect(cssConsistencyError(nemi)).toMatch(/CSS class mismatch/);
  });

  it('never matches `className=` as `class=` (the React path is unchanged)', () => {
    expect([...collectUsedClasses({ 'a.tsx': '<i className="one-thing"/>' })]).toEqual(['one-thing']);
  });

  it('is silent for a page on the Tailwind CDN (its utilities are defined by a script we cannot read)', () => {
    const tw = { ...nemi, 'index.html': NEMI_HTML.replace('<head>', '<head><script src="https://cdn.tailwindcss.com"></script>') };
    expect(findUndefinedClasses(tw)).toEqual([]);
    const tw4 = { ...nemi, 'style.css': '@import "tailwindcss";' };
    expect(findUndefinedClasses(tw4)).toEqual([]);
  });

  it('a one-file app\'s own <style> block defines its classes', () => {
    const page = `<html><head><style>.header{display:flex}.price{font-weight:800}.mrp{text-decoration:line-through}</style></head>
      <body><div class="header"><b class="price">1</b><s class="mrp">2</s></div></body></html>`;
    expect(collectDefinedClasses({ 'index.html': page }).cssFiles).toBe(1);
    expect(findUndefinedClasses({ 'index.html': page })).toEqual([]);
    // …and one that forgot a rule is caught, where before a one-file app was never checked at all.
    expect(findUndefinedClasses({ 'index.html': page.replace('.mrp{text-decoration:line-through}', '') })).toEqual(['mrp']);
  });

  it('the write-time note speaks for an HTML page too, and names the sheet the project really has', () => {
    const missing = undefinedClassesInFile('index.html', NEMI_HTML, { 'style.css': NEMI_CSS });
    expect(missing).toEqual(expect.arrayContaining(['header', 'logo', 'hero']));
    expect(undefinedClassesWriteNote('index.html', missing, 'style.css')).toMatch(/Add the rules to style\.css now/);
  });
});

// ── the kit ────────────────────────────────────────────────────────────────────────────────────────
const blocks = parseCssBlocks(DESIGN_KIT_CSS);
const ruleFor = (selector: string) => blocks.find((b) => b.prelude.split(',').map((s) => s.trim()).includes(selector));

describe('2 · a button CLASS gets the whole button, on any element', () => {
  for (const cls of ['.btn-primary', '.btn-secondary', '.btn-ghost', '.btn-danger']) {
    it(`${cls} carries padding, radius and inline-flex — a link with it is a button, not a box`, () => {
      const geometry = blocks.filter((b) => b.prelude.split(',').map((s) => s.trim()).includes(cls));
      const body = geometry.map((b) => b.body).join(';');
      expect(body).toMatch(/padding:\s*8px 16px/);
      expect(body).toMatch(/border-radius:\s*var\(--radius\)/);
      expect(body).toMatch(/display:\s*inline-flex/);
      expect(body).toMatch(/text-decoration:\s*none/);
    });
  }

  it('the fill still comes AFTER the shared geometry, so .btn-primary stays filled', () => {
    const geometryAt = DESIGN_KIT_CSS.indexOf(':where(button), .btn, .btn-primary');
    const fillAt = DESIGN_KIT_CSS.indexOf(':where(button[type="submit"]), .btn-primary');
    expect(geometryAt).toBeGreaterThan(-1);
    expect(fillAt).toBeGreaterThan(geometryAt);
  });

  it('a link-button is not underlined on hover (beats `a:hover`)', () => {
    expect(ruleFor('.btn-primary:hover')).toBeDefined();
    expect(blocks.some((b) => b.prelude.includes('.btn-primary:hover') && /text-decoration:\s*none/.test(b.body))).toBe(true);
  });
});

describe('3 · the kit has a shop layout', () => {
  const SHOP = ['nb-header', 'nb-brand', 'nb-search', 'nb-header-actions', 'nb-chips', 'nb-chip', 'nb-grid', 'nb-product',
    'nb-product-img', 'nb-product-title', 'nb-product-meta', 'nb-product-cta', 'nb-price-row', 'nb-price', 'nb-mrp',
    'nb-discount', 'nb-qty', 'nb-cart-bar', 'nb-footer'];

  it('every shop recipe exists in the kit', () => {
    const kit = kitClasses();
    for (const c of SHOP) expect(kit.has(c), c).toBe(true);
  });

  it('the MRP is struck through and the grid is two columns on a 360px phone', () => {
    expect(ruleFor('.nb-mrp')?.body).toMatch(/text-decoration:\s*line-through/);
    const min = Number(/minmax\((\d+)px/.exec(ruleFor('.nb-grid')!.body)![1]);
    const gap = Number(/gap:\s*(\d+)px/.exec(ruleFor('.nb-grid')!.body)![1]);
    expect(min * 2 + gap).toBeLessThanOrEqual(360 - 32); // a phone less the page's own padding
  });

  it('the discount pill reads (WCAG AA) in both themes', () => {
    const decl = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
    const light = decl(blocks.find((b) => b.prelude === ':root')!.body);
    const dark = { ...light, ...decl(blocks.find((b) => /prefers-color-scheme:\s*dark/.test(b.prelude))!.body) };
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (c: number[]) => { const l = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
    for (const t of [light, dark]) {
      const bg = rgb(t['--success']).map((v, i) => v * 0.14 + rgb(t['--card'])[i] * 0.86);
      const [a, b] = [lum(rgb(t['--success-ink'])), lum(bg)].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('both builders are told the shop recipes by name, and every name they are told exists', () => {
    const vocab = DESIGN_KIT_VOCABULARY.join('\n');
    const arch = architectSystemPrompt();
    for (const c of ['nb-header', 'nb-grid', 'nb-product', 'nb-price', 'nb-mrp', 'nb-discount', 'nb-cart-bar']) {
      expect(vocab, c).toContain(c);
      expect(arch, c).toContain(c);
    }
    const kit = kitClasses();
    for (const text of [vocab, arch]) {
      for (const m of text.matchAll(/`[a-z.]*\.(nb-[a-z-]+)/g)) expect(kit.has(m[1]), m[1]).toBe(true);
    }
  });
});

// A REAL BROWSER, where one exists (CI has none and skips it visibly).
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser, on a phone', () => {
  it('a link-button has a button\'s shape, the grid has two columns, the MRP is struck through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-shop-'));
    writeFileSync(join(dir, 'page.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width">
      <style>${DESIGN_KIT_CSS}</style></head><body style="padding:16px">
      <header class="nb-header"><a class="nb-brand" href="#">Nemi Mart</a><input class="nb-search" placeholder="Search"></header>
      <a id="cta" class="btn-primary" href="#shop">Start Shopping</a>
      <div id="grid" class="nb-grid">
        <div class="nb-product"><div class="nb-product-img">🍎</div><h3 class="nb-product-title">Apple</h3>
          <div class="nb-price-row"><span class="nb-price">₹99</span><s id="mrp" class="nb-mrp">₹120</s><span class="nb-discount">17% off</span></div>
          <button class="btn-primary nb-product-cta">Add</button></div>
        <div class="nb-product"><div class="nb-product-img">🥛</div><h3 class="nb-product-title">Milk</h3></div>
      </div>
    </body></html>`);
    const script = join(dir, 'run.mjs');
    writeFileSync(script, `import playwright from '${PW}';
      const b = await playwright.chromium.launch();
      const p = await b.newPage({ viewport: { width: 360, height: 780 } });
      await p.goto('file://${join(dir, 'page.html')}');
      const r = await p.evaluate(() => {
        const cta = getComputedStyle(document.getElementById('cta'));
        const cards = [...document.querySelectorAll('#grid > .nb-product')].map((e) => e.getBoundingClientRect().top);
        return {
          ctaPad: cta.paddingLeft, ctaRadius: cta.borderTopLeftRadius, ctaDisplay: cta.display, ctaDeco: cta.textDecorationLine,
          ctaImage: cta.backgroundImage, sameRow: Math.abs(cards[0] - cards[1]) < 1,
          mrp: getComputedStyle(document.getElementById('mrp')).textDecorationLine,
          header: getComputedStyle(document.querySelector('.nb-header')).display,
        };
      });
      console.log(JSON.stringify(r));
      await b.close();`);
    const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000 }).toString().trim().split('\n').pop()!);
    expect(out.ctaPad).toBe('16px');
    expect(out.ctaRadius).toBe('12px');
    expect(out.ctaDisplay).toBe('inline-flex');
    expect(out.ctaDeco).toBe('none');
    expect(out.ctaImage).toMatch(/linear-gradient/);
    expect(out.sameRow).toBe(true);
    expect(out.mrp).toBe('line-through');
    expect(out.header).toBe('flex');
  }, 90_000);
});
