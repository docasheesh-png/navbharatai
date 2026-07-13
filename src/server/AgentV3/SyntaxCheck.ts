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
