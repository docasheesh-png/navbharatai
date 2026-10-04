// LAUNCH CHECKLIST (2026-10-04): NavBharatAI's own site can be found by a crawler and previews
// properly when a link is shared, and the apps it generates do not claim a large preview image they
// do not have.
//
// What broke before: /robots.txt and /sitemap.xml fell through to the SPA catch-all and answered
// index.html with a 200; index.html had no meta description, a relative og:image (crawlers do not
// reliably resolve it) and Devanagari share text; generated apps always said `summary_large_image`
// even with no og:image, which X renders as an empty frame.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROBOTS_PATH, SITEMAP_PATH, publicSitePaths, siteOrigin, robotsTxt, sitemapXml,
} from '../src/server/lib/siteIndex';
import { PUBLIC_LEGAL_ROUTES, CONTACT_PATH, DELETE_ACCOUNT_PATH } from '../src/server/lib/legalPaths';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('robots.txt and sitemap.xml', () => {
  it('lists every public legal page by construction, from legalPaths.ts', () => {
    const paths = publicSitePaths();
    for (const p of Object.keys(PUBLIC_LEGAL_ROUTES)) expect(paths).toContain(p);
    expect(paths).toContain(CONTACT_PATH);
    expect(paths).toContain(DELETE_ACCOUNT_PATH);
    expect(paths).toContain('/');
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('writes a sitemap with absolute https URLs for each public page', () => {
    const xml = sitemapXml('https://navbharatai.com');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    for (const p of publicSitePaths()) expect(xml).toContain(`<loc>https://navbharatai.com${p}</loc>`);
  });

  it('keeps crawlers out of the API, previews and the admin console, and points at the sitemap', () => {
    const txt = robotsTxt('https://navbharatai.com');
    for (const d of ['/api/', '/preview/', '/preview-app/', '/admin']) expect(txt).toContain(`Disallow: ${d}`);
    expect(txt).toContain('Sitemap: https://navbharatai.com/sitemap.xml');
    expect(txt).not.toMatch(/Disallow: \/\s*$/m); // never blocks the whole site
  });

  it('uses PUBLIC_BASE_URL only when it is a real https origin', () => {
    expect(siteOrigin({ PUBLIC_BASE_URL: 'https://staging.navbharatai.com/' } as any)).toBe('https://staging.navbharatai.com');
    expect(siteOrigin({ PUBLIC_BASE_URL: 'http://localhost:3000' } as any)).toBe('https://navbharatai.com');
    expect(siteOrigin({ PUBLIC_BASE_URL: 'https://x.com/path' } as any)).toBe('https://navbharatai.com');
    expect(siteOrigin({} as any)).toBe('https://navbharatai.com');
  });

  it('is served by the server, not swallowed by the SPA catch-all that runs before it', () => {
    expect(spaFallbackShouldDefer(ROBOTS_PATH)).toBe(true);
    expect(spaFallbackShouldDefer(SITEMAP_PATH)).toBe(true);
    const server = read('server.ts');
    expect(server).toMatch(/registerSiteIndexRoutes\(app\)/);
  });

  it('is not shadowed by a static copy that would drift from the derived list', () => {
    expect(() => read('public/robots.txt')).toThrow();
    expect(() => read('public/sitemap.xml')).toThrow();
  });
});

describe('index.html share and search metadata', () => {
  const html = read('index.html');
  const meta = (attr: string, key: string) =>
    new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 'i').exec(html)?.[1];

  it('has a real meta description and a canonical URL', () => {
    expect((meta('name', 'description') || '').length).toBeGreaterThan(50);
    expect(html).toContain('<link rel="canonical" href="https://navbharatai.com/" />');
  });

  it('gives crawlers absolute image URLs', () => {
    expect(meta('property', 'og:image')).toMatch(/^https:\/\//);
    expect(meta('name', 'twitter:image')).toMatch(/^https:\/\//);
  });

  it('shares in English, not one region\'s script', () => {
    for (const [a, k] of [['property', 'og:title'], ['property', 'og:description'], ['name', 'twitter:title'], ['name', 'twitter:description'], ['name', 'description']]) {
      const v = meta(a, k);
      expect(v, k).toBeTruthy();
      expect(v, k).not.toMatch(/[ऀ-ॿ]/);
    }
  });
});

describe('generated apps: twitter:card matches what the page can show', () => {
  const head = (extra = '') => `<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />${extra}\n  </head>\n  <body></body>\n</html>\n`;

  it('uses the small card when the page has no og:image', () => {
    const r = planAppDefaults(head(), 'Todo App');
    expect(r.indexHtml).toContain('<meta name="twitter:card" content="summary" />');
    expect(r.indexHtml).not.toContain('summary_large_image');
  });

  it('uses the large card when the page has an og:image', () => {
    const r = planAppDefaults(head('\n    <meta property="og:image" content="https://x.example/cover.png" />'), 'Todo App');
    expect(r.indexHtml).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('never touches a twitter:card the app already set', () => {
    const r = planAppDefaults(head('\n    <meta name="twitter:card" content="summary_large_image" />'), 'Todo App');
    expect(r.indexHtml!.match(/twitter:card/g)!.length).toBe(1);
  });
});
