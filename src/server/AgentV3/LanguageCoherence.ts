// AgentV3 — language-coherence reconcile (deterministic, pre-write).
//
// ROOT CAUSE it fixes (admin deep-test App #1, 2026-07-13 — the "digital clock" report): the app was
// planned as JavaScript (`.jsx` files), but the SHARED-CONTRACT phase's prompt ALWAYS asks the model
// for "a single TypeScript code block" (enums / interfaces / typed signatures). The per-file generator
// then pasted that TypeScript straight into `src/App.jsx` — `export enum`, `interface`, `import type`,
// `: ClockProps`, `useState<ClockState>`. A `.jsx` file CANNOT contain TypeScript syntax, so esbuild
// died with `Unexpected token, expected "from"`. That one mismatch triggered the entire cascade: 2
// failed GLM repair passes → a one-shot full-builder fallback → orphaned broken `.jsx` files left in
// the workspace → a permanently-broken in-browser preview — on the SIMPLEST possible app.
//
// The fix is a deterministic invariant enforced where the files ENTER the write step (rule 2 — fix the
// class, not the instance): a `.js`/`.jsx` file that contains TypeScript-only syntax is renamed to its
// `.ts`/`.tsx` sibling (Vite/esbuild parse TS happily under a TS extension), and every explicit
// reference to it (the HTML entry `<script src>` and any extension-carrying import) is rewritten to
// match. Extension-less imports (`import App from './App'`) resolve to the new file automatically, so
// most apps need no reference rewrite at all. Pure + dependency-free (fully unit-testable). It only ever
// turns a would-be BROKEN build into a working one — it never renames a file that is already valid.

export interface LanguageReconcileResult {
  /** The file map with any TS-bearing JS files renamed and references updated. */
  files: Record<string, string>;
  /** Every rename applied, for logging / diagnostics. */
  renames: { from: string; to: string; reason: string }[];
}

// TypeScript-ONLY signals — each is unambiguous evidence the file is TypeScript, not JavaScript. We
// deliberately use HIGH-PRECISION markers (a declaration keyword / a type-only import) rather than
// trying to detect every `: Type` annotation, because annotation detection false-positives on ordinary
// JS (object literals, ternaries, JSX). These four catch the reported failure and the vast majority of
// "model emitted TS into a JS file" cases with zero false positives on real JavaScript.
const TS_ONLY_SIGNALS: { re: RegExp; reason: string }[] = [
  { re: /\binterface\s+[A-Za-z_$][\w$]*/, reason: 'declares a TypeScript interface' },
  { re: /\benum\s+[A-Za-z_$][\w$]*/, reason: 'declares a TypeScript enum' },
  { re: /\bimport\s+type\b/, reason: 'uses a type-only import' },
  { re: /\bexport\s+type\s+[A-Za-z_${]/, reason: 'uses a type-only export' },
  { re: /\bdeclare\s+(?:const|let|var|function|module|namespace|global|type)\b/, reason: 'uses a TypeScript `declare`' },
];

/** Remove string literals and comments so a TS signal inside a quoted string can't false-trigger. */
function stripStringsAndComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')       // line comments (not the // in http://)
    .replace(/`(?:\\.|[^`\\])*`/g, '``')         // template literals
    .replace(/'(?:\\.|[^'\\])*'/g, "''")         // single-quoted
    .replace(/"(?:\\.|[^"\\])*"/g, '""');        // double-quoted
}

/** True when a JS-extension file actually contains TypeScript-only syntax. Pure; never throws. */
export function hasTsOnlySyntax(code: string): boolean {
  if (typeof code !== 'string' || !code) return false;
  let stripped: string;
  try { stripped = stripStringsAndComments(code); } catch { stripped = code; }
  return TS_ONLY_SIGNALS.some((s) => s.re.test(stripped));
}

/** Does the code contain JSX (so a `.js` file must become `.tsx`, not `.ts`)? */
function containsJsx(code: string): boolean {
  return /<[A-Za-z][\w.]*[\s/>]/.test(code) || /<\/[A-Za-z]/.test(code) || /<>/.test(code);
}

/** The TS extension a JS file should take, or null if it is not a rename candidate. */
function tsExtensionFor(path: string, code: string): string | null {
  if (/\.d\.ts$/.test(path)) return null;
  if (/\.tsx?$/.test(path)) return null;                 // already TypeScript
  if (/\.jsx$/.test(path)) return path.replace(/\.jsx$/, '.tsx');
  if (/\.mjs$/.test(path)) return path.replace(/\.mjs$/, '.mts');
  if (/\.cjs$/.test(path)) return path.replace(/\.cjs$/, '.cts');
  if (/\.js$/.test(path)) return path.replace(/\.js$/, containsJsx(code) ? '.tsx' : '.ts');
  return null;
}

/** Escape a string for use as a literal inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite explicit references to a renamed file inside another file's content. Covers the two forms
 * that actually carry an extension in these apps: the HTML entry `<script src="…/main.jsx">` and any
 * import/require that spells the extension (`from './App.jsx'`). Extension-less imports need no change.
 */
function rewriteReferences(content: string, renames: { from: string; to: string }[]): string {
  let out = content;
  for (const { from, to } of renames) {
    const fromBase = from.split('/').pop()!;             // e.g. main.jsx
    const toBase = to.split('/').pop()!;                 // e.g. main.tsx
    // Replace the basename-with-extension only when it sits in a path/quote context (src="…/main.jsx",
    // '…/main.jsx', "/src/main.jsx") so we never touch an unrelated identical substring.
    const re = new RegExp(`([\\"'\\/])${escapeRe(fromBase)}(?=[\\"'?#])`, 'g');
    out = out.replace(re, `$1${toBase}`);
  }
  return out;
}

/**
 * Deterministically reconcile file language: any `.js`/`.jsx` file that contains TypeScript-only syntax
 * is renamed to its `.ts`/`.tsx` sibling and all explicit references are updated. Pure; never throws.
 * Returns the input unchanged (new object) when nothing needs renaming.
 */
export function reconcileLanguageExtensions(input: Record<string, string>): LanguageReconcileResult {
  const renames: { from: string; to: string; reason: string }[] = [];
  if (!input || typeof input !== 'object') return { files: {}, renames };

  for (const [path, code] of Object.entries(input)) {
    if (typeof code !== 'string') continue;
    if (!/\.(jsx|js|mjs|cjs)$/.test(path)) continue;
    if (!hasTsOnlySyntax(code)) continue;
    const to = tsExtensionFor(path, code);
    if (!to || to === path || input[to] !== undefined) continue; // don't clobber an existing target
    const reason = TS_ONLY_SIGNALS.find((s) => s.re.test(stripStringsAndComments(code)))?.reason || 'contains TypeScript syntax';
    renames.push({ from: path, to, reason });
  }

  if (renames.length === 0) return { files: { ...input }, renames };

  const renamedPaths = new Map(renames.map((r) => [r.from, r.to]));
  const out: Record<string, string> = {};
  for (const [path, code] of Object.entries(input)) {
    const newPath = renamedPaths.get(path) ?? path;
    const newContent = typeof code === 'string' ? rewriteReferences(code, renames) : code;
    out[newPath] = newContent;
  }
  return { files: out, renames };
}
