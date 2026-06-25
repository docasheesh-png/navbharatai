// AgentV3 — SEO & metadata check (Section I #19 / Phase 10 v1).
//
// A real web app needs basic discoverability/metadata in its HTML entry: a page
// <title>, a viewport meta (mobile), a meta description (search/social preview) and
// an <html lang> (SEO + accessibility). This PURE, deterministic analyser reads the
// HTML entry and reports the missing essentials so the agent adds them before
// shipping. Focused on the high-signal four — never the long tail — so a normal app
// is not nagged.

export type SeoLevel = 'high' | 'medium' | 'low';

export interface SeoFinding {
  level: SeoLevel;
  message: string;
}

export interface SeoReport {
  /** Whether an HTML entry was available to assess. */
  assessed: boolean;
  findings: SeoFinding[];
}

/**
 * Report missing SEO/metadata essentials from an HTML entry. PURE & deterministic.
 * `assessed` is false (no findings) when there is no HTML entry (e.g. a pure API).
 */
export function analyzeSeo(indexHtml: string | null | undefined): SeoReport {
  if (!indexHtml || !/<html|<head|<body/i.test(indexHtml)) {
    return { assessed: false, findings: [] };
  }
  const html = indexHtml;
  const findings: SeoFinding[] = [];

  // A non-empty <title>.
  if (!/<title>\s*\S[^<]*<\/title>/i.test(html)) {
    findings.push({
      level: 'high',
      message: 'No non-empty <title> in the HTML entry — set a descriptive page title (browser tab, search results and link previews all use it).',
    });
  }

  // Viewport meta — without it the app is not mobile-responsive.
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    findings.push({
      level: 'medium',
      message: 'No viewport meta tag — add <meta name="viewport" content="width=device-width, initial-scale=1"> so the app is mobile-responsive.',
    });
  }

  // <meta charset> — without a declared charset, non-ASCII text (e.g. Hindi) can
  // render as mojibake in some browsers/encodings.
  if (!/<meta[^>]+charset=/i.test(html)) {
    findings.push({
      level: 'low',
      message: 'No <meta charset> in the HTML entry — add <meta charset="utf-8"> as the first <head> tag so non-ASCII (e.g. Hindi) text renders correctly.',
    });
  }

  // Meta description with real content.
  if (!/<meta[^>]+name=["']description["'][^>]*content=["'][^"']+["']/i.test(html)) {
    findings.push({
      level: 'low',
      message: 'No meta description — add one so search results and social shares show a meaningful summary.',
    });
  }

  // <html lang="...">
  if (!/<html[^>]+lang=["'][^"']+["']/i.test(html)) {
    findings.push({
      level: 'low',
      message: 'No lang attribute on <html> — set it (e.g. lang="en") for accessibility and SEO.',
    });
  }

  // Open Graph tags — without any, links shared on WhatsApp/social show a bare URL
  // with no title/image. Flag only when there are NONE (high-signal, not nagging).
  if (!/<meta[^>]+(?:property|name)=["']og:[^"']+["']/i.test(html)) {
    findings.push({
      level: 'low',
      message: 'No Open Graph tags — add og:title, og:description and og:image so links shared on WhatsApp/social show a rich preview instead of a bare URL.',
    });
  }

  // A leftover robots "noindex" actively keeps the live site OUT of search results —
  // a common dev-template footgun. Flag it (medium) so it is removed before launch.
  if (/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*\bnoindex\b/i.test(html)) {
    findings.push({
      level: 'medium',
      message: 'The page has <meta name="robots" content="noindex"> — search engines will NOT index it. Remove the noindex before launch (unless you intentionally want this page hidden from search).',
    });
  }

  // Favicon — without a <link rel="icon">, the browser shows a generic icon and
  // requests /favicon.ico (a 404 in the network log). The Vite scaffold ships one,
  // so a missing favicon means it was removed.
  if (!/<link[^>]+rel=["'](?:shortcut\s+)?(?:icon|apple-touch-icon|mask-icon)["']/i.test(html)) {
    findings.push({
      level: 'low',
      message: 'No favicon link — add <link rel="icon" href="..."> so the browser tab and bookmarks show your icon instead of a generic one (and to avoid a 404 on /favicon.ico).',
    });
  }

  return { assessed: true, findings };
}

/** A short, honest SEO/metadata block for the `evaluate` output. */
export function seoSummary(report: SeoReport): string {
  if (!report.assessed) return 'SEO/metadata: — (no HTML entry to assess).';
  if (report.findings.length === 0) return 'SEO/metadata: ✓ title, viewport, charset, description, lang, Open Graph tags and favicon are present.';
  const order: Record<SeoLevel, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...report.findings].sort((a, b) => order[a.level] - order[b.level]);
  const head = `SEO/metadata — ${report.findings.length} item(s) missing:`;
  return [head, ...sorted.map((f) => `  ⚠ ${f.message}`)].join('\n');
}
