// The script-free public pages (legal + product pages) carry a strict CSP of their own — and the pages
// need nothing it forbids. Both halves are pinned: a policy that silently broke the page, or a page that
// started depending on something the policy blocks, fails here instead of in a reader's browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATIC_PAGE_CSP, useStaticPageCsp } from '../../src/server/lib/securityHeaders';
import { MARKETING_PAGES } from '../../src/content/marketing';
import { renderMarketingPage, renderAboutPage } from '../../src/server/lib/marketingPages';
import { renderLegalPageHtml } from '../../src/server/lib/legalMarkdown';
import { PUBLIC_PAGE_DESCRIPTIONS } from '../../src/server/routes/legal';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const code = (t: string) => t.replace(/(^|[^:])\/\/.*$/gm, '$1');
const ORIGIN = 'https://navbharatai.com';
const directives = Object.fromEntries(STATIC_PAGE_CSP.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

describe('STATIC_PAGE_CSP', () => {
  it('allows no script at all, and nothing by default', () => {
    expect(directives['default-src']).toEqual(["'none'"]);
    expect(directives['script-src']).toBeUndefined();
    expect(STATIC_PAGE_CSP).not.toMatch(/unsafe-eval|https:|\*/);
    expect(directives['connect-src']).toEqual(["'self'"]); // same-origin only (audit tools fetch robots.txt)
  });
  it('keeps framing exactly as the app policy (same-origin only) and blocks <base> and form posts', () => {
    expect(directives['frame-ancestors']).toEqual(["'self'"]);
    expect(directives['base-uri']).toEqual(["'none'"]);
    expect(directives['form-action']).toEqual(["'none'"]);
  });
  it('useStaticPageCsp sets exactly that header', () => {
    const set: Record<string, string> = {};
    useStaticPageCsp({ setHeader: (k, v) => { set[k] = v; } });
    expect(set).toEqual({ 'Content-Security-Policy': STATIC_PAGE_CSP });
  });
});

describe('the pages need nothing the policy forbids', () => {
  const pages: Array<[string, string]> = [
    ...MARKETING_PAGES.map((p) => [p.path, renderMarketingPage(p, ORIGIN)] as [string, string]),
    ['/about', renderAboutPage(ORIGIN, {})],
    ...Object.entries(PUBLIC_PAGE_DESCRIPTIONS).map(([path, description]) =>
      [path, renderLegalPageHtml({ title: 'T', updated: 'x', body: '# T\n\n[a](/privacy) and **b**', description, url: `${ORIGIN}${path}` })] as [string, string]),
  ];
  for (const [path, html] of pages) {
    it(path, () => {
      const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
      for (const attrs of scripts) expect(attrs, 'only JSON-LD data blocks').toMatch(/type="application\/ld\+json"/);
      expect(html).not.toMatch(/\son[a-z]+=/i);              // no inline handlers
      expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i); // no fetched stylesheet
      expect(html).not.toMatch(/<(iframe|form|object|embed|video|audio)\b/i);
      for (const m of html.matchAll(/<(?:img|link)\b[^>]*\b(?:src|href)="([^"]+)"/gi)) {
        if (/rel="canonical"/.test(m[0])) continue;
        expect(m[1], 'same-origin resources only').toMatch(/^\/(?!\/)/);
      }
    });
  }
});

describe('every server-rendered public page sends it, and /status does not', () => {
  it('each legal and product page response sets the strict CSP', () => {
    for (const f of ['src/server/routes/legal.ts', 'src/server/routes/marketing.ts']) {
      const src = code(read(f));
      const sends = src.match(/res\.type\('html'\)\.send\(render/g)?.length ?? 0;
      const csp = src.match(/useStaticPageCsp\(res\);/g)?.length ?? 0;
      expect(sends, f).toBeGreaterThan(0);
      expect(csp, f).toBe(sends);
    }
  });
  it('/status keeps the app policy — it runs an inline poller', () => {
    expect(code(read('src/server/routes/health.ts'))).not.toContain('useStaticPageCsp');
  });
});
