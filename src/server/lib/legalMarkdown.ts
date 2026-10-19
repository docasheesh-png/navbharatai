// Render a legal document's Markdown to standalone HTML, server-side.
//
// WHY THIS EXISTS: the five legal documents live as Markdown strings and are rendered in-app by
// LegalDocPage (react-markdown). That is fine for a signed-in user browsing Settings, but it is NOT
// enough for the job these pages now have to do: Meta requires a Privacy Policy URL before an app
// can go Live, and Google Play requires one for the Data safety declaration. Those URLs are opened
// by reviewers and by automated checkers, and an automated checker that does not run JavaScript
// would fetch our SPA shell and see an empty page — a "working" link that quietly fails review.
//
// So the public /privacy and /terms pages are rendered HERE, on the server, and arrive as real HTML
// in the first response. No JavaScript, no auth, no app shell.
//
// WHY A SMALL RENDERER INSTEAD OF A LIBRARY: react-markdown is a React component and cannot run in
// an Express response, and adding a second Markdown dependency for two static pages is weight (and
// audit surface) for nothing. These documents use a deliberately small subset of Markdown, so this
// supports exactly that subset — and every input is HTML-escaped FIRST, so no document, however
// edited, can inject markup into the page.

/** Escape every HTML-significant character. Runs BEFORE any formatting, so markup cannot be injected. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `/path` on THIS site — never `//host` or `/\\host`, which a browser resolves to another origin. */
export function isSiteRelativeHref(href: string): boolean {
  return /^\/(?![\/\\])[^\s\\]*$/.test(href);
}

/**
 * Inline formatting, applied to already-escaped text: `code`, **bold**, *italic*, [text](url).
 *
 * Links are restricted to http(s) and mailto: — a `javascript:` href in a document would otherwise
 * become a live XSS vector on a page we serve to reviewers. A rejected link keeps its text and
 * loses only the anchor, so the document still reads correctly.
 */
export function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // The href allows ONE level of nested parentheses, so a URL that legitimately contains them is
    // captured whole — and so a rejected link does not leave a stray ")" behind in the prose.
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (whole, label: string, href: string) =>
      /^(https?:\/\/|mailto:)/i.test(href)
        ? `<a href="${href}" rel="noopener noreferrer">${label}</a>`
        // SITE-RELATIVE links (`/refund`, `/contact`) are the documents' own cross-references — 18 of
        // them across the legal pages. They used to be refused along with `javascript:`, so every one
        // rendered as plain text and no public page linked to any other: a reader could not follow
        // "see our Refund Policy", and a crawler found each page only through the sitemap. ONE leading
        // slash only — `//host` and `/\host` are protocol-relative to a browser and stay refused.
        : isSiteRelativeHref(href)
          ? `<a href="${href}">${label}</a>`
          : label)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/**
 * Markdown → HTML for the subset these documents use: #/##/### headings, --- rules, bullet and
 * numbered lists, > quotes, and paragraphs. Pure, so it is fully testable without a server.
 */
export function renderLegalMarkdown(markdown: string): string {
  const lines = String(markdown ?? '').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  // TABLES. The Contact page's "what to write about, and where" is a Markdown table, and this renderer
  // had no table rule — so it reached readers as one paragraph of raw `| --- |` pipes. Rows are
  // collected while consecutive lines start with `|`; the first row is the header and `|---|` rows are
  // the separator. Every cell goes through the SAME escape-then-inline path as the prose.
  let tableRows: string[][] = [];
  const splitRow = (row: string) => row.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const flushTable = () => {
    if (!tableRows.length) return;
    const [head, ...rest] = tableRows;
    const cell = (tag: 'th' | 'td', c: string) => `<${tag}>${renderInline(escapeHtml(c))}</${tag}>`;
    out.push('<table>');
    out.push(`<thead><tr>${head.map((c) => cell('th', c)).join('')}</tr></thead>`);
    if (rest.length) out.push(`<tbody>\n${rest.map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('\n')}\n</tbody>`);
    out.push('</table>');
    tableRows = [];
  };
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
      paragraph = [];
    }
  };
  const openList = (type: 'ul' | 'ol') => {
    if (listType !== type) { closeList(); out.push(`<${type}>`); listType = type; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('|')) {
      flushParagraph(); closeList();
      if (!/^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/.test(trimmed)) tableRows.push(splitRow(trimmed));
      continue;
    }
    flushTable();

    if (!trimmed) { flushParagraph(); closeList(); continue; }

    if (/^---+$/.test(trimmed)) { flushParagraph(); closeList(); out.push('<hr>'); continue; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph(); openList('ul');
      out.push(`<li>${renderInline(escapeHtml(bullet[1]))}</li>`);
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph(); openList('ol');
      out.push(`<li>${renderInline(escapeHtml(numbered[1]))}</li>`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph(); closeList();
      out.push(`<blockquote>${renderInline(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  flushTable();
  return out.join('\n');
}

/**
 * The links every public page carries at its foot. Before this the legal pages were dead ends — no
 * way back to the product and no link to each other — so a reader who arrived from a search result
 * or a payment form had nowhere to go, and a crawler saw a set of orphans held together only by
 * the sitemap. Plain anchors: no script, no external resource.
 */
export const PUBLIC_FOOTER_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['/', 'NavBharatAI home'],
  ['/about', 'About'],
  ['/pricing', 'Pricing'],
  ['/ai-app-builder', 'AI App Builder'],
  ['/indian-ai-assistant', 'Indian AI Assistant'],
  ['/hindi-ai-assistant', 'Hindi AI Assistant'],
  ['/contact', 'Contact'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/refund', 'Refunds'],
  ['/grievance', 'Grievance'],
];

export function publicFooterHtml(): string {
  return `<footer class="site-foot"><nav aria-label="NavBharatAI pages">${PUBLIC_FOOTER_LINKS
    .map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`).join(' · ')}</nav></footer>`;
}

/**
 * The complete standalone page. Self-contained styles (no external stylesheet, no font host, no
 * script) so it renders identically for a reviewer, a crawler, and a user on a slow phone — and so
 * it cannot be broken by anything else in the app.
 *
 * `description` is the page's OWN search snippet. It used to be one sentence for every page —
 * "<title> for NavBharatAI — what we collect, why, and your rights." — which is a privacy-policy
 * sentence printed on the Terms, the Refund policy and the Contact page alike.
 */
export function renderLegalPageHtml(doc: { title: string; updated: string; body: string; description?: string }): string {
  const title = escapeHtml(doc.title);
  const description = escapeHtml((doc.description || `${doc.title} for NavBharatAI.`).trim());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${/NavBharatAI/.test(doc.title) ? title : `${title} — NavBharatAI`}</title>
<meta name="description" content="${description}">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #ffffff; color: #16161d;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
  h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .5rem; }
  h2 { font-size: 1.3rem; margin: 2.2rem 0 .6rem; }
  h3 { font-size: 1.08rem; margin: 1.6rem 0 .5rem; }
  p, li { margin: .6rem 0; }
  ul, ol { padding-left: 1.4rem; }
  hr { border: 0; border-top: 1px solid #e2e2ea; margin: 2rem 0; }
  blockquote { margin: 1rem 0; padding: .6rem 1rem; border-left: 3px solid #4f46e5;
    background: #f6f6f9; }
  code { background: #f0f0f5; padding: .1rem .3rem; border-radius: 4px; font-size: .92em; }
  a { color: #4f46e5; }
  .updated { color: #5a5a6c; font-size: .9rem; margin: 0 0 2rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .95rem; display: block; overflow-x: auto; }
  th, td { border: 1px solid #e2e2ea; padding: .45rem .6rem; text-align: left; vertical-align: top; }
  .site-foot { max-width: 46rem; margin: 0 auto; padding: 0 1.25rem 3rem; font-size: .9rem; line-height: 2; }
  @media (prefers-color-scheme: dark) {
    body { background: #101017; color: #e9e9f2; }
    hr { border-top-color: #2c2c39; }
    blockquote { background: #191922; border-left-color: #9b95ff; }
    code { background: #21212c; }
    a { color: #9b95ff; }
    .updated { color: #9a9aae; }
    th, td { border-color: #2c2c39; }
  }
</style>
</head>
<body>
<main>
<p class="updated">NavBharatAI · Last updated ${escapeHtml(doc.updated)}</p>
${renderLegalMarkdown(doc.body)}
</main>
${publicFooterHtml()}
</body>
</html>`;
}
