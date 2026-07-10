// U-2 (roadmap Tier 2) — App-Scaffold-Defaults: give every app the quality basics BY DEFAULT (SEO/OG
// meta, a viewport, an html lang, a web manifest, robots.txt) instead of leaving them to chance. The
// existing SeoAnalysis/PwaAnalysis only DETECT what's missing; this GENERATES the fixes.
//
// PURE + idempotent: given the current index.html it returns a patched copy plus the new files to write,
// adding ONLY what is missing (running it twice changes nothing). The ToolDispatcher `generate_app_defaults`
// tool applies the result. Scoped to a standard index.html (Vite/CRA/static); if there is none (e.g.
// Next.js metadata API) the tool says so honestly rather than writing something wrong.

export interface AppDefaultsResult {
  /** Patched index.html, or null when there was no html to patch. */
  indexHtml: string | null;
  /** New files to create (manifest, robots) — keyed by workspace path. */
  files: Record<string, string>;
  /** Human-readable list of what was added (empty when everything was already present). */
  added: string[];
}

const MANIFEST_HREF = '/manifest.webmanifest';

function manifestJson(appName: string): string {
  return JSON.stringify(
    {
      name: appName,
      short_name: appName.length > 12 ? appName.slice(0, 12) : appName,
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0f172a',
      icons: [],
    },
    null,
    2,
  ) + '\n';
}

const ROBOTS_TXT = 'User-agent: *\nAllow: /\n';

/** Ensure <html> carries a lang attribute. Returns [patched, added?]. */
function ensureLang(html: string): [string, boolean] {
  const htmlTag = html.match(/<html\b([^>]*)>/i);
  if (!htmlTag) return [html, false];
  if (/\blang\s*=/.test(htmlTag[1])) return [html, false];
  return [html.replace(htmlTag[0], `<html lang="en"${htmlTag[1]}>`), true];
}

/**
 * Plan the app-scaffold defaults. Pure + idempotent. `indexHtml` may be null (no index.html found):
 * then only the standalone files (manifest, robots) are returned and `indexHtml` stays null.
 */
export function planAppDefaults(indexHtml: string | null, appName = 'App'): AppDefaultsResult {
  const added: string[] = [];
  const files: Record<string, string> = {};

  // Standalone files, added only if absent from the workspace (the tool checks existence before writing).
  files[MANIFEST_HREF.replace(/^\//, '')] = manifestJson(appName);
  files['robots.txt'] = ROBOTS_TXT;

  if (indexHtml == null) {
    return { indexHtml: null, files, added };
  }

  let html = indexHtml;
  const [langHtml, langAdded] = ensureLang(html);
  html = langHtml;
  if (langAdded) added.push('html lang="en"');

  // Tags to ensure in <head>, each guarded by a presence test so this is idempotent.
  const ensures: Array<{ test: RegExp; tag: string; label: string }> = [
    { test: /<meta[^>]+charset/i, tag: '<meta charset="UTF-8" />', label: 'charset' },
    { test: /name=["']viewport["']/i, tag: '<meta name="viewport" content="width=device-width, initial-scale=1.0" />', label: 'viewport' },
    { test: /<title>/i, tag: `<title>${appName}</title>`, label: 'title' },
    { test: /name=["']description["']/i, tag: `<meta name="description" content="${appName}" />`, label: 'meta description' },
    { test: /property=["']og:title["']/i, tag: `<meta property="og:title" content="${appName}" />`, label: 'og:title' },
    { test: /property=["']og:description["']/i, tag: `<meta property="og:description" content="${appName}" />`, label: 'og:description' },
    { test: /name=["']twitter:card["']/i, tag: '<meta name="twitter:card" content="summary_large_image" />', label: 'twitter:card' },
    { test: /rel=["']manifest["']/i, tag: `<link rel="manifest" href="${MANIFEST_HREF}" />`, label: 'manifest link' },
  ];

  const toInsert: string[] = [];
  for (const e of ensures) {
    if (!e.test.test(html)) { toInsert.push('    ' + e.tag); added.push(e.label); }
  }

  if (toInsert.length) {
    const block = '\n' + toInsert.join('\n') + '\n';
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${block}  </head>`);
    } else if (/<head\b[^>]*>/i.test(html)) {
      html = html.replace(/(<head\b[^>]*>)/i, `$1${block}`);
    } else {
      // No <head> to patch safely — don't risk mangling the document; drop the head-only additions.
      for (const e of ensures) { const i = added.indexOf(e.label); if (i >= 0) added.splice(i, 1); }
      return { indexHtml: langAdded ? html : indexHtml, files, added };
    }
  }

  return { indexHtml: html, files, added };
}
