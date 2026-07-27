// Adding a snippet to a page the user already has.
//
// WHY THIS EXISTS (admin 2026-07-27): the Component Library's "Insert" merged a snippet into the
// in-memory preview with a bare `.replace('</body>', html + '</body>')`. Now that Insert writes the
// user's REAL file, three things that did not matter before matter a lot:
//
//  • A COMPONENT is not idempotent and should not be. Someone adding two pricing cards means it. So
//    components are appended, deliberately, every time.
//  • A LIBRARY TAG *is* idempotent. Loading jQuery twice is a real bug, so a <script src> or
//    <link href> already present is detected and skipped instead of duplicated.
//  • THE SNIPPETS ARE WRITTEN IN TAILWIND CLASSES. The library's own preview loads the Tailwind CDN,
//    so everything looks right there — but a page that does not load Tailwind renders the same
//    snippet as unstyled text. Silently inserting something that looks broken is worse than saying
//    so, hence `pageLoadsTailwind`.
//
// Pure and unit-tested.

export interface InsertResult {
  ok: boolean;
  /** The updated source. Equals the input when ok is false, or when the snippet was already there. */
  code: string;
  /** True when an identical library tag was already loaded, so nothing was added. */
  skipped: boolean;
  error?: string;
}

function isHtmlFile(path: string): boolean {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ext === 'html' || ext === 'htm';
}

/** The src/href a snippet loads, when it is a single <script> or <link> tag. */
export function externalResourceUrl(snippet: string): string | null {
  const s = snippet.trim();
  const script = s.match(/^<script[^>]*\ssrc=["']([^"']+)["']/i);
  if (script) return script[1];
  const link = s.match(/^<link[^>]*\shref=["']([^"']+)["']/i);
  if (link) return link[1];
  return null;
}

/**
 * Does this page already load Tailwind?
 *
 * Covers the CDN script, a bundled/linked stylesheet, and the `@tailwind`/`@import "tailwindcss"`
 * directives a built app uses — so a real project is not told it is missing Tailwind when it is not.
 */
export function pageLoadsTailwind(source: string): boolean {
  return /tailwind/i.test(source);
}

/** True when a snippet relies on Tailwind utility classes to look right. */
export function snippetNeedsTailwind(snippet: string): boolean {
  // The class names the library's snippets are built from. A handful of matches is enough signal;
  // a plain <script src> tag has none of them.
  return /class="[^"]*\b(bg-|text-|flex|grid|rounded|p-\d|px-\d|py-\d|m-\d|w-|h-|gap-|shadow)/.test(snippet);
}

/**
 * Insert a snippet into an HTML page.
 *
 * Library tags go in the <head> so they load before the page uses them; visible markup goes at the
 * end of <body> where it will actually be seen.
 */
export function insertSnippet(filePath: string, source: string, snippet: string): InsertResult {
  if (!isHtmlFile(filePath)) {
    return {
      ok: false,
      code: source,
      skipped: false,
      error: 'A component can only be added to an HTML page. Pick an .html file, or copy the code and paste it into your component yourself.',
    };
  }
  if (!snippet.trim()) {
    return { ok: false, code: source, skipped: false, error: 'Nothing to add.' };
  }

  const url = externalResourceUrl(snippet);
  if (url) {
    // Loading the same library twice is a real bug, not a user preference.
    if (source.includes(url)) return { ok: true, code: source, skipped: true };
    if (/<\/head>/i.test(source)) {
      return { ok: true, code: source.replace(/<\/head>/i, `  ${snippet.trim()}\n</head>`), skipped: false };
    }
    return { ok: true, code: `${snippet.trim()}\n${source}`, skipped: false };
  }

  if (/<\/body>/i.test(source)) {
    return { ok: true, code: source.replace(/<\/body>/i, `${snippet.trim()}\n</body>`), skipped: false };
  }
  return { ok: true, code: `${source.replace(/\s+$/, '')}\n${snippet.trim()}\n`, skipped: false };
}
