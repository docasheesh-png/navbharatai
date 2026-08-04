// Writing SEO tags into a page's <head>, safely and repeatably.
//
// WHY THIS EXISTS (admin 2026-07-27): the SEO Optimizer built these tags inline in its button
// handler, with two defects that only mattered once "Apply" started writing the user's REAL file:
//
//  • VALUES WENT INTO ATTRIBUTES UNESCAPED — `content="${meta.description}"`. A description
//    containing a double quote silently broke the tag; a description containing `" onload=` injected
//    markup into the user's own page. Descriptions are free text that users paste from anywhere, so
//    this was not a hypothetical.
//  • THE TAG REMOVAL WAS BROAD — it stripped EVERY <title> and og:/twitter: meta in the document,
//    including ones inside a <script> template or an unrelated section, then appended new ones.
//    Repeated on a real file that is exactly how a page slowly loses tags it needed.
//
// Rebuilt as a pure function so both can be tested. The replacement is still deliberately in-place
// for SEO tags — a page should have exactly one <title> and one og:title, so replacing rather than
// fencing is the correct behaviour here (unlike a stylesheet, which gets its own fenced block).

import { escapeHtml } from './escapeHtml';

export interface SeoTags {
  title?: string;
  description?: string;
  keywords?: string;
  robots?: string;
  author?: string;
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: string;
  ogSiteName?: string;
  twitterCard?: string;
  twitterHandle?: string;
}

/** A URL is only written out when it is one a browser will actually follow. */
export function isSafeUrl(url: string): boolean {
  const u = (url || '').trim();
  if (!u) return false;
  // Anything that can execute — javascript:, data:, vbscript: — has no business in href/content.
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:/i.test(u)) return false;
  return !/[\s<>"']/.test(u);
}

/**
 * Build the head tags.
 *
 * Every value is escaped for attribute context, and every URL is checked before it is written — a
 * `javascript:` canonical link is a real injection vector, not a tidiness concern.
 */
export function buildSeoHead(tags: SeoTags): string {
  const t = (v?: string) => escapeHtml((v || '').trim());
  const lines: string[] = [];

  if (tags.title?.trim()) lines.push(`<title>${t(tags.title)}</title>`);
  if (tags.description?.trim()) lines.push(`<meta name="description" content="${t(tags.description)}" />`);
  if (tags.keywords?.trim()) lines.push(`<meta name="keywords" content="${t(tags.keywords)}" />`);
  if (tags.robots?.trim()) lines.push(`<meta name="robots" content="${t(tags.robots)}" />`);
  if (tags.author?.trim()) lines.push(`<meta name="author" content="${t(tags.author)}" />`);
  if (isSafeUrl(tags.canonicalUrl || '')) lines.push(`<link rel="canonical" href="${t(tags.canonicalUrl)}" />`);

  const ogTitle = tags.ogTitle?.trim() || tags.title?.trim();
  const ogDesc = tags.ogDescription?.trim() || tags.description?.trim();
  if (ogTitle) lines.push(`<meta property="og:title" content="${t(ogTitle)}" />`);
  if (ogDesc) lines.push(`<meta property="og:description" content="${t(ogDesc)}" />`);
  if (isSafeUrl(tags.ogImage || '')) lines.push(`<meta property="og:image" content="${t(tags.ogImage)}" />`);
  if (tags.ogType?.trim()) lines.push(`<meta property="og:type" content="${t(tags.ogType)}" />`);
  if (tags.ogSiteName?.trim()) lines.push(`<meta property="og:site_name" content="${t(tags.ogSiteName)}" />`);
  if (tags.twitterCard?.trim()) lines.push(`<meta name="twitter:card" content="${t(tags.twitterCard)}" />`);
  if (tags.twitterHandle?.trim()) lines.push(`<meta name="twitter:site" content="${t(tags.twitterHandle)}" />`);

  return lines.join('\n');
}

/** Only the <head> — so tags inside the body, a script template or a code sample are never touched. */
function headRange(html: string): { start: number; end: number } | null {
  const open = /<head[^>]*>/i.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const close = html.toLowerCase().indexOf('</head>', start);
  return close < 0 ? null : { start, end: close };
}

const SEO_TAG = new RegExp(
  '<title[^>]*>[\\s\\S]*?<\\/title>'
  + '|<meta[^>]*\\sname=["\'](?:title|description|keywords|robots|author|twitter:[^"\']*)["\'][^>]*>'
  + '|<meta[^>]*\\sproperty=["\'](?:og:[^"\']*|twitter:[^"\']*)["\'][^>]*>'
  + '|<link[^>]*\\srel=["\']canonical["\'][^>]*>',
  'gi',
);

export interface SeoApplyResult {
  ok: boolean;
  code: string;
  /** How many existing SEO tags were replaced — reported so the user knows something was swapped. */
  replaced: number;
  error?: string;
}

/**
 * Put the SEO tags into a page, replacing whatever was there before.
 *
 * Scoped strictly to the <head>: the previous version searched the WHOLE document, so a `<title>`
 * inside a JavaScript template string or a documentation code sample would be deleted from the
 * user's file. A page with no <head> is declined rather than guessed at.
 */
export function applySeoHead(html: string, tags: SeoTags): SeoApplyResult {
  const range = headRange(html);
  if (!range) {
    return {
      ok: false,
      code: html,
      replaced: 0,
      error: 'This page has no <head> section, so there is nowhere for SEO tags to go. Pick your main HTML page.',
    };
  }

  const head = html.slice(range.start, range.end);
  const matches = head.match(SEO_TAG);
  const cleaned = head.replace(SEO_TAG, '').replace(/\n{3,}/g, '\n\n');
  const block = buildSeoHead(tags);
  const nextHead = block ? `${cleaned.replace(/\s+$/, '')}\n${block}\n` : cleaned;

  return {
    ok: true,
    code: html.slice(0, range.start) + nextHead + html.slice(range.end),
    replaced: matches ? matches.length : 0,
  };
}
