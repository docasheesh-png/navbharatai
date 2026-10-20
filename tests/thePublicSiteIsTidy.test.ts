// SEO VERIFICATION 2026-10-18, P2 — the public site's loose ends, each pinned so it cannot come back.
//
//  P2-1  every public page's meta description fits a search snippet (≤ 160 characters)
//  P2-2  /status, which is in the sitemap, has a description and a canonical
//  P2-3  legal pages carry link-preview (og / twitter) tags — still loading no linked resource
//  P2-4  a noindex SPA path does not claim the homepage: no homepage JSON-LD, no homepage og:url
//  P2-6  a missing FILE is a 404, never the app shell with a 200
//  P2-7  /about's store read is cached, time-boxed and never fails the page
//  P2-8  server pages use the 20 KB logo as favicon, not the 129 KB original
//  P2-9  visits to the server-rendered product pages are counted again
//  P2-10 no plan bullet implies that free accounts see ads (NavBharatAI shows none to anyone)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKETING_PAGES } from '../src/content/marketing';
import { ABOUT_DESCRIPTION, renderMarketingPage, renderAboutPage } from '../src/server/lib/marketingPages';
import { PUBLIC_PAGE_DESCRIPTIONS } from '../src/server/routes/legal';
import { renderLegalPageHtml } from '../src/server/lib/legalMarkdown';
import { renderStatusPageHtml, STATUS_PAGE_DESCRIPTION } from '../src/server/lib/HealthReport';
import { spaHeadFor, spaRouteHead } from '../src/server/lib/spaHead';
import { spaFallbackShouldDefer, isMissingStaticFilePath } from '../src/server/lib/spaFallback';
import { readAboutOverridesForPage, clearAboutPageCache } from '../src/server/lib/siteAbout';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const ORIGIN = 'https://navbharatai.com';
const shell = read('index.html');
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const metaDesc = (html: string) => decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '');
// Line comments only, so a prose mention of a call does not satisfy a code assertion.
const code = (t: string) => t.replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('P2-1 — every public description fits a search snippet', () => {
  it('product pages, About, legal pages, /status, App Mart and the homepage are 71–160 characters', () => {
    const all: Array<[string, string]> = [
      ...MARKETING_PAGES.map((p) => [p.path, p.description] as [string, string]),
      ['/about', ABOUT_DESCRIPTION],
      ...Object.entries(PUBLIC_PAGE_DESCRIPTIONS),
      ['/status', STATUS_PAGE_DESCRIPTION],
      ['/store', metaDesc(spaHeadFor('/store', shell, ORIGIN))],
      ['/', metaDesc(shell)],
    ];
    for (const [where, d] of all) {
      expect(d.length, `${where}: ${d}`).toBeGreaterThan(70);
      expect(d.length, `${where}: ${d}`).toBeLessThanOrEqual(160);
    }
    expect(new Set(all.map(([, d]) => d)).size).toBe(all.length);
  });
});

describe('P2-2 — /status is a complete sitemap entry', () => {
  it('has a description and, given the origin, its own canonical', () => {
    const html = renderStatusPageHtml(ORIGIN);
    expect(metaDesc(html)).toBe(STATUS_PAGE_DESCRIPTION);
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/status">`);
  });
  it('never prints a canonical from a bad origin', () => {
    expect(renderStatusPageHtml('javascript:alert(1)')).not.toContain('rel="canonical"');
    expect(renderStatusPageHtml()).not.toContain('rel="canonical"');
  });
  it('the route passes the site origin', () => {
    expect(code(read('src/server/routes/health.ts'))).toContain('renderStatusPageHtml(siteOrigin())');
  });
});

describe('P2-3 — a shared legal link shows a card', () => {
  const page = renderLegalPageHtml({ title: 'Privacy Policy', updated: 'x', body: 'y', description: PUBLIC_PAGE_DESCRIPTIONS['/privacy'], url: `${ORIGIN}/privacy` });

  it('carries og and twitter tags for that page, with the 1200×630 image', () => {
    expect(page).toContain(`<meta property="og:url" content="${ORIGIN}/privacy">`);
    expect(page).toContain('<meta property="og:title" content="Privacy Policy — NavBharatAI">');
    expect(page).toContain(`<meta property="og:image" content="${ORIGIN}/og-image.png">`);
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page).toMatch(/<meta name="twitter:description" content="NavBharatAI Privacy Policy/);
  });

  it('still loads no linked resource, and invents no og:url without a real https url', () => {
    expect(page).not.toContain('<link ');
    const bare = renderLegalPageHtml({ title: 'T', updated: 'x', body: 'y' });
    expect(bare).not.toContain('og:url');
    expect(renderLegalPageHtml({ title: 'T', updated: 'x', body: 'y', url: 'javascript:alert(1)' })).not.toContain('og:');
  });

  it('every legal route passes its canonical url', () => {
    const legal = code(read('src/server/routes/legal.ts'));
    const renders = legal.match(/renderLegalPageHtml\(\{/g)?.length ?? 0;
    const urls = legal.match(/url: `\$\{siteOrigin\(\)\}\$\{[A-Z_a-z]+\}`/g)?.length ?? 0;
    expect(renders).toBeGreaterThan(0);
    expect(urls).toBe(renders);
  });
});

describe('P2-4 — a noindex SPA path does not claim to be the homepage', () => {
  for (const p of ['/store/app/abc123', '/store/app/does-not-exist-123', '/nonexistent-xyz', '/admin']) {
    it(p, () => {
      expect(spaRouteHead(p)).toBe('noindex');
      const out = spaHeadFor(p, shell, ORIGIN);
      expect(out).toContain('<meta name="robots" content="noindex, follow" />');
      expect(out).not.toContain('rel="canonical"');
      expect(out).not.toContain('og:url');
      expect(out).not.toContain('application/ld+json');
    });
  }
  it('the body is still byte-identical, and the homepage keeps its JSON-LD and og:url', () => {
    const body = (h: string) => h.slice(h.indexOf('<body>'));
    expect(body(spaHeadFor('/nope', shell, ORIGIN))).toBe(body(shell));
    expect(spaHeadFor('/', shell, ORIGIN)).toContain('application/ld+json');
    expect(spaHeadFor('/', shell, ORIGIN)).toContain(`<meta property="og:url" content="${ORIGIN}/" />`);
  });
});

describe('P2-6 — a missing file is a 404, an app screen is not', () => {
  it('file-shaped paths are recognised', () => {
    for (const p of ['/assets/index-OLD.js', '/assets/x', '/missing.png', '/favicon.ico', '/logo.pngg.png', '/a/b/c.css', '/x.json', '/x.webmanifest', '/x.js.map'])
      expect(isMissingStaticFilePath(p), p).toBe(true);
  });
  it('app screens, App Mart listings and public pages are not', () => {
    for (const p of ['/', '/store', '/store/app/abc123', '/store/app/AbC_9-x', '/admin', '/settings', '/nonexistent-xyz', '/about', '/pay', '/status', '/guide', '/v1.2'])
      expect(isMissingStaticFilePath(p), p).toBe(false);
  });
  it('the catch-all checks it AFTER deferring to server routes (robots.txt, sitemap.xml stay served)', () => {
    expect(spaFallbackShouldDefer('/robots.txt')).toBe(true);
    expect(spaFallbackShouldDefer('/sitemap.xml')).toBe(true);
    const server = code(read('server.ts'));
    const defer = server.indexOf('if (spaFallbackShouldDefer(req.path))');
    const missing = server.indexOf('if (isMissingStaticFilePath(req.path))');
    const count = server.indexOf('noteWebsiteVisit({');
    const send = server.indexOf('spaHeadFor(req.path');
    expect(defer).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(defer);
    expect(count).toBeGreaterThan(missing);
    expect(send).toBeGreaterThan(missing);
    expect(server.slice(missing, count)).toMatch(/res\.status\(404\)/);
  });
});

describe('P2-7 — /about reads the store once per minute, never waits long, never fails', () => {
  beforeEach(() => clearAboutPageCache());
  const OV = { headline: 'Saved by the admin' } as never;

  it('a burst of visitors shares one read, and the result is reused within the TTL', async () => {
    let reads = 0;
    let t = 0;
    const fetch = async () => { reads += 1; return OV; };
    const opts = { fetch, nowMs: () => t };
    const all = await Promise.all([1, 2, 3].map(() => readAboutOverridesForPage(opts)));
    expect(all).toEqual([OV, OV, OV]);
    t = 59_000;
    await readAboutOverridesForPage(opts);
    expect(reads).toBe(1);
    t = 61_000;
    await readAboutOverridesForPage(opts);
    expect(reads).toBe(2);
  });

  it('a slow store is not waited for: the page renders with the shipped copy', async () => {
    const never = () => new Promise<never>(() => {});
    const started = Date.now();
    expect(await readAboutOverridesForPage({ fetch: never, timeoutMs: 30 })).toEqual({});
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('a failed read falls back to the LAST GOOD overrides and is not cached as empty', async () => {
    let t = 0;
    await readAboutOverridesForPage({ fetch: async () => OV, nowMs: () => t });
    t = 120_000;
    let fails = 0;
    const failing = async () => { fails += 1; throw new Error('store down'); };
    expect(await readAboutOverridesForPage({ fetch: failing, nowMs: () => t })).toEqual(OV);
    expect(await readAboutOverridesForPage({ fetch: failing, nowMs: () => t })).toEqual(OV);
    expect(fails).toBe(2);
  });

  it('a read that started before a save cannot cache the pre-save value', async () => {
    let release!: (v: unknown) => void;
    const slow = () => new Promise<never>((r) => { release = r as never; });
    const pending = readAboutOverridesForPage({ fetch: slow, timeoutMs: 5_000 });
    clearAboutPageCache(); // what writeAboutOverrides does after a successful save
    release({ headline: 'old' });
    await pending;
    let reads = 0;
    expect(await readAboutOverridesForPage({ fetch: async () => { reads += 1; return OV; } })).toEqual(OV);
    expect(reads).toBe(1);
  });

  it('the /about route uses the cached read, and a save clears the cache', () => {
    expect(code(read('src/server/routes/marketing.ts'))).toContain('await readAboutOverridesForPage()');
    const lib = code(read('src/server/lib/siteAbout.ts'));
    const write = lib.slice(lib.indexOf('export async function writeAboutOverrides'));
    expect(write).toMatch(/clearAboutPageCache\(\);\s*return true;/);
  });
});

describe('P2-8 — the favicon is the small logo', () => {
  it('server-rendered pages and the SPA shell point at /logo-160.png', () => {
    const page = renderMarketingPage(MARKETING_PAGES[0], ORIGIN);
    expect(page).toContain('<link rel="icon" type="image/png" href="/logo-160.png">');
    expect(renderAboutPage(ORIGIN, {})).not.toContain('href="/logo.png"');
    expect(shell).toContain('<link rel="icon" type="image/png" href="/logo-160.png" />');
    expect(readFileSync(join(root, 'public/logo-160.png')).length).toBeLessThan(30_000);
  });
});

describe('P2-9 — product-page visits are counted again', () => {
  it('every marketing route and /about call noteWebsiteVisit', () => {
    const src = code(read('src/server/routes/marketing.ts'));
    expect(src).toMatch(/import \{ noteWebsiteVisit \} from '\.\.\/lib\/ownAudience'/);
    expect(src).toContain('noteWebsiteVisit({');
    // Both handlers count before sending.
    expect(src.match(/countVisit\(req\);/g)?.length).toBe(2);
  });
});

describe('P2-10 — no plan implies that free accounts see ads', () => {
  it('no hosting tier advertises "no ads" (NavBharatAI shows third-party ads to no one)', () => {
    for (const t of HOSTING_TIERS) for (const line of t.includes) expect(line, t.id).not.toMatch(/\bno ads\b/i);
  });
});

describe('a real /favicon.ico — pages without an icon link no longer log a 404', () => {
  it('public/favicon.ico is a small ICO file (served by express.static before the 404 rule)', () => {
    const ico = readFileSync(join(root, 'public/favicon.ico'));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]); // ICONDIR: reserved 0, type 1 = icon
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2);  // more than one size
    expect(ico.length).toBeLessThan(16_000);
  });
});
