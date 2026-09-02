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
  return out.join('\n');
}

/**
 * The complete standalone page. Self-contained styles (no external stylesheet, no font host, no
 * script) so it renders identically for a reviewer, a crawler, and a user on a slow phone — and so
 * it cannot be broken by anything else in the app.
 */
export function renderLegalPageHtml(doc: { title: string; updated: string; body: string }): string {
  const title = escapeHtml(doc.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — NavBharatAI</title>
<meta name="description" content="${title} for NavBharatAI — what we collect, why, and your rights.">
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
  @media (prefers-color-scheme: dark) {
    body { background: #101017; color: #e9e9f2; }
    hr { border-top-color: #2c2c39; }
    blockquote { background: #191922; border-left-color: #9b95ff; }
    code { background: #21212c; }
    a { color: #9b95ff; }
    .updated { color: #9a9aae; }
  }
</style>
</head>
<body>
<main>
<p class="updated">NavBharatAI · Last updated ${escapeHtml(doc.updated)}</p>
${renderLegalMarkdown(doc.body)}
</main>
</body>
</html>`;
}
