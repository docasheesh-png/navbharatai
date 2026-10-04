// NAVBHARATAI'S OWN robots.txt AND sitemap.xml (launch checklist, 2026-10-04).
//
// Before this, both paths fell through to the SPA catch-all and answered 200 with index.html — a
// crawler asking for robots.txt got a web page, and there was no sitemap at all, so the public pages
// that exist to be found (the legal pages a payment aggregator, Play and Meta check; the store; the
// status page) had to be discovered by luck.
//
// The page list is DERIVED from legalPaths.ts — the same source the legal handlers and the SPA
// fallback read — so a public page added there is in the sitemap by construction, never by memory.
// PURE.

import { PUBLIC_LEGAL_ROUTES, DELETE_ACCOUNT_PATH, CONTACT_PATH } from './legalPaths';

export const ROBOTS_PATH = '/robots.txt';
export const SITEMAP_PATH = '/sitemap.xml';

/** The public pages a visitor or a crawler can open without signing in, canonical spellings only. */
export function publicSitePaths(): string[] {
  return ['/', '/store', '/status', ...Object.keys(PUBLIC_LEGAL_ROUTES), CONTACT_PATH, DELETE_ACCOUNT_PATH];
}

/** The site's public origin: PUBLIC_BASE_URL when it is a real https origin, else the production one. */
export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+$/i.test(raw) ? raw : 'https://navbharatai.com';
}

/** Paths that are not pages: the API, live previews, the admin console. */
const DISALLOW = ['/api/', '/preview/', '/preview-app/', '/admin'];

export function robotsTxt(origin: string): string {
  return ['User-agent: *', 'Allow: /', ...DISALLOW.map((d) => `Disallow: ${d}`), '', `Sitemap: ${origin}${SITEMAP_PATH}`, ''].join('\n');
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemapXml(origin: string): string {
  const urls = publicSitePaths().map((p) => `  <url><loc>${xmlEscape(origin + p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
