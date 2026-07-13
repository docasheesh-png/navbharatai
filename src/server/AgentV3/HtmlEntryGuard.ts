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

/** Does the HTML already have a `<script>` that loads a main/index entry module? */
function hasEntryScript(html: string): boolean {
  return /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\b(?:main|index)\.[jt]sx?["']/i.test(html);
}

/**
 * Ensure the app's `index.html` actually BOOTS: it must load the entry module via a `<script type=
 * "module">` and provide a `<div id="root">` mount node. Deterministically injects whichever is missing,
 * pointing at the entry module that really exists in the file set. Pure; never throws. Returns the input
 * unchanged (new object) when nothing needs adding, when there is no index.html, or when no entry module
 * is present (we never guess an entry that doesn't exist).
 */
export function ensureHtmlEntryScript(input: Record<string, string>): HtmlEntryResult {
  if (!input || typeof input !== 'object') return { files: {}, injected: false };
  const htmlKey = Object.keys(input).find((k) => /(^|\/)index\.html$/i.test(k));
  if (!htmlKey) return { files: { ...input }, injected: false };
  let html = input[htmlKey];
  if (typeof html !== 'string' || !html.trim()) return { files: { ...input }, injected: false };

  const entry = ENTRY_CANDIDATES.find((c) => typeof input[c] === 'string');
  if (!entry) return { files: { ...input }, injected: false }; // no real entry module → don't fabricate one

  let injected = false;

  // 1) Ensure a #root mount node exists (React needs a target). Insert right after <body> if absent.
  if (!/\bid\s*=\s*["']root["']/i.test(html)) {
    if (/<body[^>]*>/i.test(html)) {
      html = html.replace(/(<body[^>]*>)/i, '$1\n    <div id="root"></div>');
      injected = true;
    }
  }

  // 2) Ensure a module script loads the entry. Only add when NO entry script is present (a mismatched
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
