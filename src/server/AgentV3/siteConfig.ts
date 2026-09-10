/**
 * SITE CONFIG — redirects, a real 404 page, and safe headers for a published app (ROADMAP §13, 1.6).
 *
 * The hosting version we create carried ONE hardcoded config: a catch-all rewrite to index.html and a
 * cache header for /assets. That is right for the single-page app most builds are, and wrong for
 * everything a real site needs once it has been live a week: a page that moved (a redirect), a
 * multi-page site whose missing pages should say so (a 404 that is a 404), and the handful of
 * response headers every serious host sets by default. This module is the ONE place that config is
 * formed, for every first-party publish, from the app's files and the user's saved settings.
 *
 * 🔒 THREE RULES THE FORM ENFORCES, so a setting cannot hurt the site it belongs to:
 *   • A redirect target is a path on the same site, or an https URL the user typed themselves. No
 *     protocol-relative `//evil`, no `javascript:`, no http:. A published app must not become an open
 *     redirect — and the check lives where the setting is SAVED, so a bad rule never reaches the host.
 *   • The catch-all rewrite is kept for a single-page app and dropped ONLY for a site that is visibly
 *     multi-page AND ships its own `404.html`. Dropping it for an SPA would 404 every deep link; keeping
 *     it for a multi-page site makes a missing page answer 200 with the home page, which is the lie
 *     "custom 404" exists to end. The decision is made from the files, not from a checkbox.
 *   • Security headers are always on. `X-Frame-Options` alone is a setting, because a user may
 *     legitimately embed their own app elsewhere — the default refuses framing by strangers.
 *
 * PURE. The store is siteConfigStore.ts; the injection point is Deployment.createVersion.
 */

export interface SiteRedirect {
  /** The path visitors arrive at. `/old`, `/old/**` (host glob syntax). */
  from: string;
  /** Where they go: a path on this site, or an https URL. */
  to: string;
  code: 301 | 302;
}

export interface SiteConfig {
  redirects: SiteRedirect[];
  /** Let other sites frame this app. Default false: framing by strangers is clickjacking's precondition. */
  allowEmbedding: boolean;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = Object.freeze({ redirects: [], allowEmbedding: false }) as SiteConfig;
export const MAX_REDIRECTS = 50;
const MAX_FROM_CHARS = 200;
const MAX_TO_CHARS = 500;

/** Headers every first-party publish sets. HSTS is already set by the host itself. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
});
export const FRAME_HEADER: Readonly<Record<string, string>> = Object.freeze({ 'X-Frame-Options': 'SAMEORIGIN' });
export const ASSET_CACHE_HEADER: Readonly<Record<string, string>> = Object.freeze({ 'Cache-Control': 'max-age=31536000,immutable' });

// A second leading slash is a PROTOCOL-RELATIVE URL (`//evil.com`), which the browser resolves to
// another host — the open redirect this whole module exists to refuse. Rejected in both fields.
const FROM_RE = /^\/(?!\/)[A-Za-z0-9/_\-.*:~%]*$/;
const PATH_TO_RE = /^\/(?!\/)[^\s]*$/;

/**
 * Turn whatever the client sent into a SiteConfig, refusing what cannot be safe. Errors are sentences
 * for the person who typed the rule; a config with errors is not returned as a config.
 */
export function validateSiteConfig(raw: unknown): { config: SiteConfig | null; errors: string[] } {
  const errors: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as { redirects?: unknown; allowEmbedding?: unknown };
  const allowEmbedding = obj.allowEmbedding === true;
  const list = Array.isArray(obj.redirects) ? obj.redirects : [];
  if (list.length > MAX_REDIRECTS) errors.push(`At most ${MAX_REDIRECTS} redirects can be set.`);
  const redirects: SiteRedirect[] = [];
  const seenFrom = new Set<string>();
  list.slice(0, MAX_REDIRECTS).forEach((r, i) => {
    const row = (r && typeof r === 'object' ? r : {}) as { from?: unknown; to?: unknown; code?: unknown };
    const from = typeof row.from === 'string' ? row.from.trim() : '';
    const to = typeof row.to === 'string' ? row.to.trim() : '';
    const code = row.code === 302 || row.code === '302' ? 302 : 301;
    const n = i + 1;
    if (!from || !FROM_RE.test(from) || from.length > MAX_FROM_CHARS) {
      errors.push(`Redirect ${n}: "from" must be a path on your site, starting with /, like /old-page.`);
      return;
    }
    const isPath = PATH_TO_RE.test(to);
    const isHttps = /^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(to);
    if (!to || to.length > MAX_TO_CHARS || (!isPath && !isHttps)) {
      errors.push(`Redirect ${n}: "to" must be a path on your site (like /new-page) or a full https:// address.`);
      return;
    }
    if (from === to) {
      errors.push(`Redirect ${n}: "from" and "to" are the same, which would send visitors in a loop.`);
      return;
    }
    if (seenFrom.has(from)) {
      errors.push(`Redirect ${n}: /${from.slice(1)} already has a redirect above.`);
      return;
    }
    seenFrom.add(from);
    redirects.push({ from, to, code });
  });
  return { config: errors.length ? null : { redirects, allowEmbedding }, errors };
}

/**
 * Is this bundle a multi-page site that ships its own 404 page? Only then is the SPA catch-all dropped.
 * "Multi-page" = at least one top-level .html besides index.html and 404.html — a site that has an
 * about.html is one whose visitors can genuinely land on a page that does not exist.
 */
export function customNotFoundApplies(files: ReadonlyMap<string, unknown>): boolean {
  let has404 = false;
  let otherPages = 0;
  for (const rawPath of files.keys()) {
    const p = String(rawPath).replace(/^\/+/, '').toLowerCase();
    if (p.includes('/')) continue;
    if (p === '404.html') has404 = true;
    else if (p.endsWith('.html') && p !== 'index.html') otherPages += 1;
  }
  return has404 && otherPages > 0;
}

/** The host's version config shape — only the fields we set. */
export interface HostingVersionConfig {
  rewrites?: Array<{ glob: string; path: string }>;
  redirects?: Array<{ glob: string; statusCode: number; location: string }>;
  headers: Array<{ glob: string; headers: Record<string, string> }>;
}

/** The ONE config every first-party publish is created with. */
export function hostingVersionConfig(files: ReadonlyMap<string, unknown>, cfg: SiteConfig | null | undefined): HostingVersionConfig {
  const c = cfg ?? DEFAULT_SITE_CONFIG;
  const out: HostingVersionConfig = {
    headers: [
      { glob: '/assets/**', headers: { ...ASSET_CACHE_HEADER } },
      { glob: '**', headers: { ...SECURITY_HEADERS, ...(c.allowEmbedding ? {} : FRAME_HEADER) } },
    ],
  };
  if (c.redirects.length) {
    out.redirects = c.redirects.map((r) => ({ glob: r.from, statusCode: r.code, location: r.to }));
  }
  if (!customNotFoundApplies(files)) {
    out.rewrites = [{ glob: '**', path: '/index.html' }];
  }
  return out;
}
