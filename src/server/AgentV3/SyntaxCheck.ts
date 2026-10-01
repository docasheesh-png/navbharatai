// AgentV3 — deterministic SYNTAX gate for generated JS/TS/JSX/TSX files.
//
// ROOT CAUSE it closes (deep-test App #6 — Expense Tracker, 2026-07-13): a GLM response hit max_tokens
// (LLM_TRUNCATED) and produced a corrupt src/App.tsx — a CSS declaration (`-side: border-radius: 0.5rem;`)
// injected INTO a JSX <button>'s attribute list. The file does not PARSE, so the app never compiled and
// the in-browser preview died with "Unexpected token (31:13)". Yet the build shipped "Build health: READY
// 60/100" — because the sandbox `tsc` could not run (the recurring VERIFY_DID_NOT_RUN), so nothing caught
// the broken file before it was declared ready.
//
// This gate runs esbuild's PARSER **in the server process** (not the sandbox), so it is IMMUNE to the
// sandbox-tsc failures that let this class through. It reports ONLY syntax/parse errors — a file that
// cannot be parsed at all — never type errors, so a valid app is never falsely blocked. esbuild is the
// SAME parser Vite uses to build the app, so "esbuild can't parse it" ⇒ "the app genuinely won't build".
// esbuild is already a dependency. Never throws; safe on any file map.

import { transform } from 'esbuild';

export interface SyntaxErrorInfo {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

const JS_TS = /\.(mjs|cjs|jsx?|tsx?)$/i;
// Type-declaration files are parsed differently (ambient) and never ship as runnable code — skip them
// so a valid `.d.ts` is never mis-flagged.
const DECL = /\.d\.ts$/i;

function loaderFor(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (/\.tsx$/i.test(path)) return 'tsx';
  if (/\.ts$/i.test(path)) return 'ts';
  if (/\.jsx$/i.test(path)) return 'jsx';
  return 'js'; // .js / .mjs / .cjs
}

/**
 * Parse every JS/TS/JSX/TSX file with esbuild and return the SYNTAX errors (path + message + location).
 * Type errors are NOT reported (esbuild only parses). Bounded to 20 files. Never throws.
 */
export async function findSyntaxErrors(files: Record<string, string>): Promise<SyntaxErrorInfo[]> {
  const out: SyntaxErrorInfo[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!JS_TS.test(path) || DECL.test(path) || typeof content !== 'string' || content.trim() === '') continue;
    try {
      await transform(content, { loader: loaderFor(path), logLevel: 'silent', sourcefile: path });
    } catch (e) {
      const err = e as { errors?: Array<{ text?: string; location?: { line?: number; column?: number } | null }> };
      const first = err.errors?.[0];
      out.push({
        path,
        message: (first?.text || (e instanceof Error ? e.message : String(e))).slice(0, 300),
        line: first?.location?.line,
        column: first?.location?.column,
      });
      if (out.length >= 20) break; // bounded — 20 broken files is already the full story
    }
  }
  return out;
}

/** A compact, human-readable repair instruction listing the syntax errors — fed to a bounded heal pass. */
export function syntaxRepairInstruction(errors: readonly SyntaxErrorInfo[]): string {
  return errors
    .slice(0, 15)
    .map((e) => `- ${e.path}${e.line ? ` (line ${e.line}${e.column != null ? `:${e.column}` : ''})` : ''}: ${e.message}`)
    .join('\n');
}

/**
 * Parse ONE source file with esbuild and return its FIRST syntax error — or null when it parses clean, or
 * isn't a parseable JS/TS/JSX/TSX source (a `.d.ts`, a `.json`, a `.css`, …). The primitive behind the
 * write-time parse guard. Never throws.
 */
export async function firstSyntaxError(path: string, content: string): Promise<SyntaxErrorInfo | null> {
  if (!JS_TS.test(path) || DECL.test(path)) return null; // not a parseable source file → no opinion
  const errs = await findSyntaxErrors({ [path]: content });
  return errs[0] ?? null;
}

/**
 * WRITE-TIME PARSE GUARD (deep-test 2026-07-18). Default-ON — kill switch `AGENTV3_WRITE_PARSE_GUARD=off`.
 * The recurring build-breaker: the builder, editing a large file, ADDS a `const handleExportCSV`/`interface`
 * that ALREADY EXISTS (a duplicate declaration → "already been declared"), or leaves an unwrapped JSX
 * sibling / a missing `)` — the file stops parsing, the preview dies, yet a later gate only catches it after
 * the fact. This flag turns on refusing such a write AT WRITE TIME.
 */
export function writeParseGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_WRITE_PARSE_GUARD !== 'off';
}

/**
 * True when a syntax error is the DUPLICATE-DECLARATION / duplicate-export class — the one error that is
 * NEVER a valid transient repair state. Adding a second top-level `const`/`let`/`function`/`class`/export
 * of a name that already exists always ships Babel's "…has already been declared" white screen. Matched
 * across esbuild's two phrasings ("The symbol \"x\" has already been declared", "Multiple exports with the
 * same name \"x\"") and Babel's own ("Duplicate declaration \"x\""). Pure; tolerant of null.
 */
export function isDuplicateDeclarationError(info: SyntaxErrorInfo | null | undefined): boolean {
  const m = info?.message || '';
  return /already been declared/i.test(m)
    || /multiple exports with the same name/i.test(m)
    || /duplicate declaration/i.test(m);
}

/**
 * Decide whether a write/edit must be REFUSED because it would introduce a syntax error. Returns a
 * model-facing rejection message, or null to allow the write. Pure policy (the esbuild parses are injected
 * as the already-computed old/new errors) so it is fully unit-testable:
 *   • allow when the guard is off, or the new content parses clean;
 *   • allow when the OLD content was ALREADY broken — never block a repair-in-progress on a broken file;
 *   • EXCEPT a NEWLY-introduced duplicate declaration: refuse it even on an already-broken file, because
 *     adding a second copy of an existing const/function/class/export is never a valid repair step and
 *     always yields the "already been declared" white screen (build-report autopsy 2026-08-02 —
 *     `cancelSubscription` was duplicated in src/lib/api.ts while the file was mid-repair for unrelated
 *     type errors, so the old `if (errOld) return null` waved the white-screen duplicate straight through).
 *     Still allow it when the SAME duplicate class was already present in the old file — the model is then
 *     mid-removal and must not be trapped.
 *   • otherwise (a CLEAN/new file broken by this change) → REFUSE with the exact location + a fix hint.
 */
export function parseGuardDecision(
  path: string,
  errOld: SyntaxErrorInfo | null,
  errNew: SyntaxErrorInfo | null,
  enabled = true,
): string | null {
  if (!enabled || !errNew) return null;   // guard off, or the result parses clean → allow
  if (errOld) {
    // A duplicate declaration is never a valid repair state — refuse it even here, UNLESS the old file
    // already had a duplicate error (removal-in-progress). Every other error class stays allowed so a
    // genuine repair on a broken file is never trapped.
    const introducesDuplicate = isDuplicateDeclarationError(errNew) && !isDuplicateDeclarationError(errOld);
    if (!introducesDuplicate) return null; // was already broken (non-duplicate) → allow the repair write
  }
  const loc = errNew.line ? ` (line ${errNew.line}${errNew.column != null ? `:${errNew.column}` : ''})` : '';
  const head = `WRITE REJECTED — your change introduces a SYNTAX ERROR in ${path}${loc}: ${errNew.message}\n` +
    `It was NOT saved (the app would not compile). `;
  // 🔴 THE HINT NAMES THE ERROR'S OWN CLASS (autopsy 1389f0d5, 2026-09-30). Two edits that wrapped part of
  // App.tsx's JSX in a condition were refused with "The character "}" is not valid inside a JSX element" —
  // and a hint that led with DUPLICATE declarations, which it was not. The model patched a fragment again,
  // was refused again, and only then rewrote the component with replace_symbol, which worked first time.
  if (isJsxStructureError(errNew) && !isDuplicateDeclarationError(errNew)) {
    return head +
      `An edit that wraps, moves or adds JSX left a tag or a brace unbalanced. Patching fragments of a ` +
      `component's markup is where this happens: re-read the component and rewrite it WHOLE with ` +
      `replace_symbol (path, symbol, code) — the AST-safe way to change a component's JSX — instead of ` +
      `another partial edit.`;
  }
  return head + `The most common cause is a DUPLICATE declaration — a ` +
    `const / function / interface that ALREADY EXISTS in this file. Do NOT add a second copy; EDIT the ` +
    `existing one instead. Other causes: an unwrapped or unbalanced JSX tag, or a missing ")" / "}". Fix ` +
    `your change so the file parses cleanly, then retry.`;
}

/** A parse error about JSX's own structure — an unbalanced tag or a brace where markup was expected. PURE. */
export function isJsxStructureError(info: SyntaxErrorInfo | null | undefined): boolean {
  const m = info?.message || '';
  return /not valid inside a JSX element/i.test(m)
    || /Expected corresponding JSX closing tag/i.test(m)
    || /Unterminated JSX/i.test(m)
    || /Adjacent JSX elements must be wrapped/i.test(m)
    || /Unexpected closing .* tag does not match/i.test(m);
}
