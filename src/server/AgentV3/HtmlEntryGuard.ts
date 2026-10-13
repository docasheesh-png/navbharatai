// AgentV3 — HTML entry-script guard (deterministic, pre-write).
//
// ROOT CAUSE it fixes (admin deep-test, 2026-07-13 — the clock re-run report): the per-file builder let
// the model REWRITE `index.html` and drop the `<script type="module" src="/src/main.jsx">` that boots the
// app — leaving `<div id="root"></div>` with nothing to mount it. The page renders BLANK (React never
// runs). Combined with the fast-lane verify now shipping JS apps directly (tsc-can't-run → ran:false),
// a per-file build must be guaranteed to actually BOOT — so this deterministically re-attaches the entry
// script (and a `#root` mount node) whenever the HTML is missing them and a real entry module exists.
//
// Conservative + pure: it only acts when there IS an `index.html` AND a known entry module in the file
// set, and only ADDS what's missing (never rewrites a page that already boots correctly). Fully
// unit-testable; never throws. Kill switch lives at the call site (AGENTV3_HTML_ENTRY_GUARD=off).

export interface HtmlEntryResult {
  files: Record<string, string>;
  /** True when the HTML was modified (a script and/or a #root mount was injected). */
  injected: boolean;
}

// Entry modules a Vite app boots from, most-conventional first. The first one PRESENT in the file set
// is treated as the entry the HTML must load.
const ENTRY_CANDIDATES = [
  'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
  'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
  'main.tsx', 'main.jsx',
];

/**
 * Does the HTML already load the app's code as a module? Any LOCAL module script counts — `/src/main.tsx`, but also
 * `/src/app.tsx` or an inline `<script type="module">import "/src/main.tsx"</script>` (heal census of autopsy
 * 303e8a6f: reading only main|index made the guard ADD a second entry to a page that already booted — a false
 * repair, and a double mount when both modules render).
 */
function hasEntryScript(html: string): boolean {
  if (/<script\b[^>]*\bsrc\s*=\s*["'][^"']*\b(?:main|index)\.[jt]sx?["']/i.test(html)) return true;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    if (!/\btype\s*=\s*["']?module\b/i.test(attrs)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src && !/^(?:[a-z]+:)?\/\//i.test(src)) return true; // a local module file
    if (!src && /\bimport\b[^;]*["'](?:\.{0,2}\/)[^"']+["']/.test(m[2] ?? '')) return true; // an inline module importing local code
  }
  return false;
}

/** The ids the entry module mounts the app into (`getElementById('x')`, `querySelector('#x')`, `.mount('#x')`). */
function mountIdsOf(entrySource: string): string[] {
  const ids = new Set<string>();
  for (const m of entrySource.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)|querySelector\(\s*["']#([\w-]+)["']\s*\)|\.mount\(\s*["']#([\w-]+)["']\s*\)/g)) {
    const id = m[1] ?? m[2] ?? m[3];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Does the HTML carry an element with this id — quoted or not? */
function hasId(html: string, id: string): boolean {
  const e = id.replace(/[-]/g, '\\-');
  return new RegExp(`\\bid\\s*=\\s*(?:["']${e}["']|${e}(?=[\\s>/]))`, 'i').test(html);
}

/**
 * The page a Vite app is served from: the ROOT `index.html`, never `public/index.html` (a CRA page the bundler fills
 * in) or a `dist/`, `docs/` or `client/` copy that sorts first in the durable store's key order (heal census of
 * autopsy 303e8a6f). One answer for both lanes. PURE.
 */
export function appEntryHtmlKey(files: Readonly<Record<string, unknown>>): string | null {
  return Object.prototype.hasOwnProperty.call(files ?? {}, 'index.html') ? 'index.html' : null;
}

/**
 * Ensure the app's `index.html` actually BOOTS: it must load the app's code as a module and provide the mount node
 * the entry module mounts into. Deterministically injects whichever is missing, pointing at the entry module that
 * really exists in the file set and the id it really uses. Pure; never throws. Returns the input unchanged (new
 * object) when nothing needs adding, when there is no root index.html, or when no entry module is present (we never
 * guess an entry that doesn't exist).
 */
export function ensureHtmlEntryScript(input: Record<string, string>): HtmlEntryResult {
  if (!input || typeof input !== 'object') return { files: {}, injected: false };
  const htmlKey = appEntryHtmlKey(input);
  if (!htmlKey) return { files: { ...input }, injected: false };
  let html = input[htmlKey];
  if (typeof html !== 'string' || !html.trim()) return { files: { ...input }, injected: false };

  const entry = ENTRY_CANDIDATES.find((c) => typeof input[c] === 'string');
  if (!entry) return { files: { ...input }, injected: false }; // no real entry module → don't fabricate one

  let injected = false;

  // 1) Ensure the mount node the entry module mounts into exists — its OWN id (Vue's `#app`, an unquoted id), and
  //    `#root` only when the entry names none we can read. Insert right after <body> if absent.
  const ids = mountIdsOf(input[entry] ?? '');
  const mountPresent = ids.length > 0 ? ids.some((id) => hasId(html, id)) : hasId(html, 'root');
  if (!mountPresent) {
    if (/<body[^>]*>/i.test(html)) {
      html = html.replace(/(<body[^>]*>)/i, `$1\n    <div id="${ids[0] ?? 'root'}"></div>`);
      injected = true;
    }
  }

  // 2) Ensure a module script loads the app's code. Only add when NO local module script is present (a mismatched
  // path — e.g. main.tsx vs main.jsx — is left to the language-coherence reference rewrite).
  if (!hasEntryScript(html)) {
    const tag = `<script type="module" src="/${entry}"></script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `    ${tag}\n  </body>`);
    } else {
      html = `${html}\n${tag}`;
    }
    injected = true;
  }

  if (!injected) return { files: { ...input }, injected: false };
  return { files: { ...input, [htmlKey]: html }, injected: true };
}
