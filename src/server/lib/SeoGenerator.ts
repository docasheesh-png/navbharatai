// U-4 (verified recipe modules) — SEO essentials (dependency-free).
//
// A public site that ships without SEO basics is invisible: no page title/description in search results, no
// preview card when shared on WhatsApp/Twitter/LinkedIn, and no sitemap/robots for crawlers. Hand-writing
// these is error-prone in one specific way that matters: a title or description containing `<`, `>`, `&` or a
// quote, if not ESCAPED, breaks the HTML meta tag or produces invalid sitemap XML (and can even inject
// markup). This recipe ships correct builders: `buildMetaTags` (title + description + canonical + full
// OpenGraph + Twitter card, every value escaped), `buildSitemap` (valid, XML-escaped sitemap.xml) and
// `buildRobotsTxt`. Dependency-free, no env keys. PURE builder; correct and complete — no TODO stubs (the
// real-features rule). Unit-tested.

export interface SeoConfig {
  files: Record<string, string>;
  instructions: string;
}

const SEO_SERVER = `// SEO helpers. All values are escaped for their context (HTML attribute / XML text), so a title or
// description containing <, >, & or a quote can never break the tag or inject markup.

const escapeHtml = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface MetaInput {
  title: string;
  description: string;
  /** Absolute canonical URL of the page. */
  url: string;
  /** Absolute URL of the social preview image (1200×630 works everywhere). */
  image?: string;
  siteName?: string;
  /** OpenGraph type — 'website' (default), 'article', 'product', … */
  type?: string;
}

// Build the <head> meta tags for a page: title, description, canonical, OpenGraph (WhatsApp/LinkedIn/FB) and
// Twitter card. Drop the returned string into your <head>. Every value is HTML-escaped.
export function buildMetaTags(m: MetaInput): string {
  const t = escapeHtml(m.title);
  const d = escapeHtml(m.description);
  const url = escapeHtml(m.url);
  const type = escapeHtml(m.type || 'website');
  const lines = [
    \`<title>\${t}</title>\`,
    \`<meta name="description" content="\${d}">\`,
    \`<link rel="canonical" href="\${url}">\`,
    \`<meta property="og:title" content="\${t}">\`,
    \`<meta property="og:description" content="\${d}">\`,
    \`<meta property="og:url" content="\${url}">\`,
    \`<meta property="og:type" content="\${type}">\`,
    \`<meta name="twitter:card" content="\${m.image ? 'summary_large_image' : 'summary'}">\`,
    \`<meta name="twitter:title" content="\${t}">\`,
    \`<meta name="twitter:description" content="\${d}">\`,
  ];
  if (m.siteName) lines.push(\`<meta property="og:site_name" content="\${escapeHtml(m.siteName)}">\`);
  if (m.image) {
    lines.push(\`<meta property="og:image" content="\${escapeHtml(m.image)}">\`);
    lines.push(\`<meta name="twitter:image" content="\${escapeHtml(m.image)}">\`);
  }
  return lines.join('\\n');
}

export interface SitemapEntry {
  loc: string;
  /** ISO date (YYYY-MM-DD). */
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  /** 0.0–1.0. */
  priority?: number;
}

// Build a valid sitemap.xml from your page URLs. Serve it at /sitemap.xml (and reference it in robots.txt).
export function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const parts = [\`    <loc>\${escapeHtml(e.loc)}</loc>\`];
    if (e.lastmod) parts.push(\`    <lastmod>\${escapeHtml(e.lastmod)}</lastmod>\`);
    if (e.changefreq) parts.push(\`    <changefreq>\${e.changefreq}</changefreq>\`);
    if (typeof e.priority === 'number') parts.push(\`    <priority>\${Math.min(Math.max(e.priority, 0), 1).toFixed(1)}</priority>\`);
    return \`  <url>\\n\${parts.join('\\n')}\\n  </url>\`;
  });
  return \`<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n\${urls.join('\\n')}\\n</urlset>\`;
}

// Build robots.txt. By default allows everything and points crawlers at your sitemap; pass disallow paths
// (e.g. ['/admin', '/api']) to keep them out of the index.
export function buildRobotsTxt(opts?: { sitemapUrl?: string; disallow?: string[] }): string {
  const lines = ['User-agent: *'];
  const disallow = opts?.disallow ?? [];
  if (disallow.length === 0) lines.push('Disallow:');
  else for (const p of disallow) lines.push('Disallow: ' + p);
  if (opts?.sitemapUrl) lines.push('', 'Sitemap: ' + opts.sitemapUrl);
  return lines.join('\\n') + '\\n';
}
`;

const INSTRUCTIONS =
  'SEO helpers wired at server/lib/seo.ts (no dependency). Use buildMetaTags({ title, description, url, image ' +
  '}) to render the <head> title + description + canonical + OpenGraph + Twitter-card tags (so the page shows a ' +
  'proper preview when shared on WhatsApp/LinkedIn/Twitter) — every value is HTML-escaped. Serve ' +
  'buildSitemap(entries) at /sitemap.xml and buildRobotsTxt({ sitemapUrl, disallow: ["/admin"] }) at ' +
  '/robots.txt so search engines can crawl the site. All output is correctly escaped, so a title with <, > or ' +
  '& never breaks the tag or the XML. No API key needed.';

export function generateSeoIntegration(): SeoConfig {
  return {
    files: { 'server/lib/seo.ts': SEO_SERVER },
    instructions: INSTRUCTIONS,
  };
}
