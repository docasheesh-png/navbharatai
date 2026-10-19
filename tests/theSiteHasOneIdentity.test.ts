// SEO AUDIT 2026-10-18 — NavBharatAI's own public site says what it is, to a crawler that runs no
// JavaScript, with one identity, and without claims the code cannot back.
//
// What was wrong on the live site: every SPA path (App Mart included) carried the homepage canonical;
// unknown paths were 200 duplicates of the homepage; there was no About, Pricing or product page a
// crawler could read; no structured data; legal pages shared one privacy-policy description, could not
// link to each other (site-relative links were stripped) and printed the Contact table as raw pipes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeJsonLd, jsonLdScript, organizationJsonLd } from '../src/server/lib/siteSchema';
import { renderMarketingPage, renderAboutPage } from '../src/server/lib/marketingPages';
import {
  MARKETING_PAGES, MARKETING_PATHS, OFFICIAL_SOCIAL_PROFILES, PLAY_LISTING_URL, OFFICIAL_SITE_URL,
} from '../src/content/marketing';
import { PUBLIC_LISTING_URL } from '../src/lib/appDownload';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';
import { publicSitePaths, sitemapXml } from '../src/server/lib/siteIndex';
import { spaHeadFor, spaRouteHead } from '../src/server/lib/spaHead';
import { renderInline, renderLegalMarkdown, renderLegalPageHtml, PUBLIC_FOOTER_LINKS } from '../src/server/lib/legalMarkdown';
import { PUBLIC_PAGE_DESCRIPTIONS } from '../src/server/routes/legal';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const ORIGIN = 'https://navbharatai.com';

const ldBlocks = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** Things a public page must never say: invented proof, ranking promises, vendor names. */
const FORBIDDEN = [
  /\b(#1|number one|no\. ?1)\b/i, /\bguarantee[ds]?\b.*\b(rank|google|first)/i, /\baward/i, /\bcertified\b/i,
  /\b\d[\d,.]*\s*(k|lakh|million|crore)?\+?\s*(users|customers|downloads)\b/i, /\btrusted by\b/i, /\btestimonial/i,
  /\b(Claude|Anthropic|Kimi|Moonshot|GLM|Zhipu|OpenAI|ChatGPT|GPT-\d|Gemini|Nemotron|NVIDIA|Llama)\b/,
  /\b(our own|indigenous|home-grown) (llm|foundation model|language model)\b/i,
];

describe('index.html — one identity, stated as structured data', () => {
  const html = read('index.html');

  it('carries exactly the WebSite + Organization graph the server builds', () => {
    const blocks = ldBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(homeJsonLd());
  });

  it('names NavBharatAI at https://navbharatai.com/', () => {
    const org = organizationJsonLd();
    expect(org.name).toBe('NavBharatAI');
    expect(org.url).toBe('https://navbharatai.com/');
    expect(OFFICIAL_SITE_URL).toBe('https://navbharatai.com/');
  });

  it('sameAs lists only official profiles that exist — the Play listing, plus any the owner adds', () => {
    expect(PLAY_LISTING_URL).toBe(PUBLIC_LISTING_URL);
    expect(organizationJsonLd().sameAs).toEqual([PLAY_LISTING_URL, ...OFFICIAL_SOCIAL_PROFILES.map((p) => p.url)]);
  });

  it('a non-JavaScript reader gets words and links, outside the boot frame', () => {
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? '';
    for (const p of MARKETING_PATHS) expect(noscript).toContain(`href="${p}"`);
    expect(html.indexOf('<noscript>')).toBeLessThan(html.indexOf('<div id="root">'));
  });

  it('uses a real 1200×630 share image', () => {
    expect(html).toContain('<meta property="og:image" content="https://navbharatai.com/og-image.png" />');
    const png = readFileSync(join(root, 'public/og-image.png'));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('jsonLdScript cannot be closed early by content', () => {
    expect(jsonLdScript({ a: '</script><script>alert(1)</script>' })).not.toMatch(/<\/script><script>/);
  });
});

describe('server-rendered product pages', () => {
  const pages = MARKETING_PAGES.map((p) => ({ p, html: renderMarketingPage(p, ORIGIN) }));
  const about = renderAboutPage(ORIGIN, {});

  it('each is a complete page: own title, description, canonical, ONE h1, valid JSON-LD, no executable script', () => {
    for (const { p, html } of [...pages, { p: { path: '/about' }, html: about }]) {
      expect(html.startsWith('<!doctype html>'), p.path).toBe(true);
      expect(html, p.path).toContain(`<link rel="canonical" href="${ORIGIN}${p.path}">`);
      expect(html.match(/<h1>/g)?.length, p.path).toBe(1);
      expect(ldBlocks(html).length, p.path).toBe(1);
      expect(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''), p.path).not.toContain('<script');
      expect(html, p.path).not.toMatch(/<link rel="stylesheet"/);
    }
  });

  it('titles and descriptions are distinct and within search-snippet length', () => {
    const titles = MARKETING_PAGES.map((p) => p.title);
    const descs = MARKETING_PAGES.map((p) => p.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descs).size).toBe(descs.length);
    for (const t of titles) expect(t.length, t).toBeLessThanOrEqual(65);
    for (const d of descs) { expect(d.length, d).toBeGreaterThan(70); expect(d.length, d).toBeLessThanOrEqual(170); }
  });

  it('is not thin: every page carries real content', () => {
    for (const { p, html } of pages) expect(text(html).split(' ').length, p.path).toBeGreaterThan(250);
  });

  it('🔒 says nothing the code cannot back — no invented proof, no vendor names, no own-model claim', () => {
    for (const { p, html } of [...pages, { p: { path: '/about' }, html: about }]) {
      const t = text(html);
      for (const re of FORBIDDEN) expect(t, `${p.path} matched ${re}`).not.toMatch(re);
    }
  });

  it('prices come from hostingTiers.ts, not retyped', () => {
    const pricing = pages.find(({ p }) => p.path === '/pricing')!.html;
    for (const t of HOSTING_TIERS) expect(pricing).toContain(`₹${t.priceInr} for ${t.days} days`);
    // Pro is behind PLAN_MODEL_PRO and the plan restructure is paused: it is not offered here.
    expect(pricing).not.toMatch(/\bPro — ₹/);
  });

  it('About shows real contact details and official links, and never an empty social placeholder', () => {
    expect(about).toContain('mailto:info@navbharatai.com');
    expect(about).toContain(PLAY_LISTING_URL);
    expect(about).not.toMatch(/TODO/);
    expect(ldBlocks(about)[0]['@graph'][0]['@type']).toBe('AboutPage');
  });

  it('every page links to the others, so none is an orphan', () => {
    for (const { p, html } of pages) for (const r of p.related) expect(html, `${p.path} → ${r}`).toContain(`href="${r}"`);
  });

  it('is served by the server and listed in the sitemap', () => {
    for (const p of MARKETING_PATHS) {
      expect(spaFallbackShouldDefer(p), p).toBe(true);
      expect(publicSitePaths()).toContain(p);
      expect(sitemapXml(ORIGIN)).toContain(`<loc>${ORIGIN}${p}</loc>`);
    }
    expect(read('server.ts')).toMatch(/registerMarketingRoutes\(app\)/);
  });
});

describe('the SPA shell gets a head that matches the path', () => {
  const shell = read('index.html');

  it('the homepage is served exactly as built', () => {
    expect(spaHeadFor('/', shell, ORIGIN)).toBe(shell);
  });

  it('App Mart has its OWN canonical — it is no longer "a copy of the homepage"', () => {
    const out = spaHeadFor('/store', shell, ORIGIN);
    expect(out).toContain(`<link rel="canonical" href="${ORIGIN}/store" />`);
    expect(out).toContain(`<meta property="og:url" content="${ORIGIN}/store" />`);
    expect(out).toMatch(/<title>App Mart/);
    expect(out).not.toContain('application/ld+json');
    expect(spaRouteHead('/store/')).not.toBe('noindex');
  });

  it('🔒 an App Mart listing is noindex, follow with NO canonical — real-looking, nonexistent and junk ids alike (P1-A)', () => {
    // The server cannot tell a live listing from a deleted or mistyped id, so no id may claim to be an
    // indexable page of its own until a per-app server head exists.
    const ids = ['abc123', 'AbC_9-x', 'does-not-exist-123', 'a'.repeat(128), 'a'.repeat(129), '../x', '%22%3E%3Cscript%3E'];
    for (const id of ids) {
      const p = `/store/app/${id}`;
      expect(spaRouteHead(p), p).toBe('noindex');
      expect(spaRouteHead(`${p}/`), `${p}/`).toBe('noindex');
      const out = spaHeadFor(p, shell, ORIGIN);
      expect(out, p).toContain('<meta name="robots" content="noindex, follow" />');
      expect(out, p).not.toContain('rel="canonical"');
      expect(out, p).not.toContain(`${ORIGIN}/store/app/`);
    }
    // /store itself stays the one indexable App Mart page.
    expect(spaHeadFor('/store', shell, ORIGIN)).not.toContain('noindex');
  });

  it('🔒 the sitemap lists App Mart once, and no listing, app screen or unknown path', () => {
    const xml = sitemapXml(ORIGIN);
    expect(xml).toContain(`<loc>${ORIGIN}/store</loc>`);
    expect(xml).not.toContain('/store/app/');
    for (const p of publicSitePaths()) expect(spaRouteHead(p) === 'noindex' && !spaFallbackShouldDefer(p), p).toBe(false);
  });

  it('an app screen or a typo is noindex and no longer claims the homepage canonical', () => {
    for (const p of ['/anything', '/admin', '/sonic', '/store/app/../x', '/nonexistent-xyz', '/About', '/settings', '/store/apps']) {
      const out = spaHeadFor(p, shell, ORIGIN);
      expect(out, p).toContain('<meta name="robots" content="noindex, follow" />');
      expect(out, p).not.toContain('rel="canonical"');
    }
  });

  it('🔒 the BODY is never touched — the app boots exactly as before', () => {
    const body = (h: string) => h.slice(h.indexOf('<body>'));
    for (const p of ['/', '/store', '/nope']) expect(body(spaHeadFor(p, shell, ORIGIN)), p).toBe(body(shell));
  });

  it('tolerates junk input', () => {
    expect(() => spaHeadFor(undefined as never, shell, ORIGIN)).not.toThrow();
    expect(spaHeadFor('/store', '', ORIGIN)).toBe('');
  });
});

describe('legal pages — linked, described, readable', () => {
  it('site-relative cross-references are links again; other-origin tricks stay refused', () => {
    expect(renderInline('[Refund Policy](/refund)')).toBe('<a href="/refund">Refund Policy</a>');
    expect(renderInline('[x](//evil.example)')).toBe('x');
    expect(renderInline('[x](/\\evil.example)')).toBe('x');
    expect(renderInline('[x](javascript:alert(1))')).toBe('x');
  });

  it('renders a Markdown table as a table, cells escaped', () => {
    const html = renderLegalMarkdown('| A | B |\n|---|---|\n| `x` | <b>y</b> |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th><th>B</th>');
    expect(html).toContain('<td><code>x</code></td><td>&lt;b&gt;y&lt;/b&gt;</td>');
    expect(html).not.toContain('|');
  });

  it('each page has its own description, not the privacy policy\'s', () => {
    const descs = Object.values(PUBLIC_PAGE_DESCRIPTIONS);
    expect(new Set(descs).size).toBe(descs.length);
    const page = renderLegalPageHtml({ title: 'Terms', updated: 'x', body: 'y', description: PUBLIC_PAGE_DESCRIPTIONS['/terms'] });
    expect(page).not.toContain('what we collect, why, and your rights');
    for (const [href] of PUBLIC_FOOTER_LINKS) expect(page).toContain(`href="${href}"`);
  });
});

// ── P1-B (SEO verification 2026-10-18): BUILD BILLING IS DESCRIBED THE WAY THE CODE BILLS ───────────
// The public pages said "if a build does not produce a working app, you are not charged" — false for
// a build the USER stopped with files saved, which `decideCancelledBuildBill` charges. These tests pin
// (1) the code facts the wording relies on, so a billing change fails here and forces the copy to be
// revisited, and (2) the wording itself, on every public surface that describes it.
import { decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';
import { FAILED_BUILD_RULE, STOPPED_BUILD_RULE } from '../src/content/marketing';
import { aboutContent } from '../src/content/about';
import { REFUND_POLICY } from '../src/content/legal/refundPolicy';

describe('🔒 build billing is described exactly as the code bills it', () => {
  const stop = (o: Partial<Parameters<typeof decideCancelledBuildBill>[0] & object>) =>
    decideCancelledBuildBill({ abortCause: 'user-stop', filesWritten: 5, appRendered: false, decidedBilledUsd: 1, ...o });
  const plain = (s: string) => s.replace(/\*\*/g, '');
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const pageText = (path: string) => decode(text(renderMarketingPage(MARKETING_PAGES.find((p) => p.path === path)!, ORIGIN)));

  it('code fact: a FAILED build bills ₹0 (zeroBillForFailedBuild is `!ok`), and only a user Stop is billed by the cancel rule', () => {
    expect(read('src/server/routes/agentv3.ts')).toMatch(/export function zeroBillForFailedBuild\(resultOk: boolean\): boolean \{\s*return resultOk === false;\s*\}/);
    for (const cause of ['watchdog', 'unknown', 'deploy-drain'] as const) {
      expect(decideCancelledBuildBill({ abortCause: cause as never, filesWritten: 9, appRendered: true, decidedBilledUsd: 3 }).applies).toBe(false);
    }
  });

  it('code fact: a user Stop is free only when nothing of the user\'s own was kept', () => {
    expect(stop({ filesWritten: 0 }).billedUsd).toBe(0);                         // nothing written
    expect(stop({ filesWritten: 12, preseededUnchanged: 12 }).billedUsd).toBe(0); // only our template
    expect(stop({ editingExistingApp: true }).billedUsd).toBe(0);                 // unverified edit
  });

  it('code fact: a user Stop with an app running pays the work done; with files saved, half — floored at real cost, capped at the work done', () => {
    // "An app had been seen running" = running BEFORE the Stop was asked for (#3820, rule g): times 1 < 2.
    expect(stop({ appRendered: true, appRenderedAt: 1, stopRequestedAt: 2, decidedBilledUsd: 2 }).billedUsd).toBe(2);
    expect(stop({ decidedBilledUsd: 2 }).billedUsd).toBe(1);
    expect(stop({ decidedBilledUsd: 2, realCostUsd: 1.5 }).billedUsd).toBe(1.5);
    expect(stop({ decidedBilledUsd: 2, realCostUsd: 5 }).billedUsd).toBe(2);
  });

  it('/pricing and /ai-app-builder state BOTH rules, word for word', () => {
    for (const path of ['/pricing', '/ai-app-builder']) {
      const t = pageText(path);
      expect(t, path).toContain(plain(FAILED_BUILD_RULE));
      expect(t, path).toContain(plain(STOPPED_BUILD_RULE));
    }
    expect(plain(STOPPED_BUILD_RULE)).toMatch(/half of the work done so far, or what that work actually cost to run if that is more, and never more than the work done/);
    expect(plain(STOPPED_BUILD_RULE)).toMatch(/Closing the app .* does not stop a build/);
  });

  it('About and the Refund Policy distinguish a failed build from a stopped one', () => {
    const promise = aboutContent(null).promises.map((p) => `${p.title}. ${p.body}`).join(' ');
    expect(promise).toMatch(/If a build fails, you are not charged/);
    expect(promise).toMatch(/If you stop a build yourself \(Stop, unsending your message or typing "stop"\), you pay only for work you keep/);
    expect(plain(REFUND_POLICY)).toMatch(/A build you stop yourself is not a failure, and you pay only for work you keep/);
    expect(plain(REFUND_POLICY)).toMatch(/for any reason other than you stopping it/);
  });

  it('🔒 no public surface promises "no working app, no charge" or a free/refunded stop', () => {
    const MISLEADING = [
      /(does not|doesn't|did not|didn't) produce a working app[^.]{0,80}(not charged|free|no charge)/i,
      /not (be )?charged for (a|any) build that (does not|doesn't) produce a working app/i,
      /working app,? or (it'?s |it is )?free/i,
      /(stopp?ed|cancell?ed) (builds?|a build) (is|are) (always )?(free|never charged|not charged)/i,
      /stopping (a build )?is (always )?free/i,
      /\bfull refund\b/i,
    ];
    const surfaces: Array<[string, string]> = [
      ...MARKETING_PAGES.map((p) => [p.path, pageText(p.path)] as [string, string]),
      ['/about', decode(text(renderAboutPage(ORIGIN, null)))],
      ['about.ts (in-app About)', JSON.stringify(aboutContent(null))],
      ['/refund', plain(REFUND_POLICY)],
      ['index.html', read('index.html')],
    ];
    for (const [where, t] of surfaces) for (const re of MISLEADING) expect(t, `${where} matched ${re}`).not.toMatch(re);
    // "never charged" is true only of a FAILED build; the product pages must not say it at all.
    for (const p of MARKETING_PAGES) expect(pageText(p.path), p.path).not.toMatch(/\bnever charged\b/i);
  });
});
