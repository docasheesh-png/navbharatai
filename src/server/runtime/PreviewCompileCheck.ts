// PreviewCompileCheck — dry-compile every source file with the SAME @babel/standalone config the
// in-browser preview uses, so the build can tell whether the live preview will actually compile
// (not just whether tsc + the E2B/vite preview pass).
//
// Why this exists (autopsy 2026-07-22, buildId 91694679): the in-browser preview transpiles with Babel
// standalone — a DIFFERENT compiler from both the build's `tsc --noEmit` gate AND the E2B/vite (esbuild)
// preview. Code can pass tsc, render in E2B, and still white-screen in the in-browser Babel preview the
// user actually opens (the reported case: `declare` class fields, now fixed by allowDeclareFields). The
// engine's "✅ Preview verified" only ever exercised the E2B/vite surface, so this whole class of
// compiler-divergence shipped as "verified". This module is the missing check: it faithfully reproduces
// the in-browser transform so a throw here == a real in-browser failure (no false divergence).
//
// Faithful-mirror contract: the presets/plugins/sourceType below MUST stay identical to the in-browser
// transform in ReactPreview.ts (buildReactPreview's requireModule). If that transform changes, change
// this in lockstep — a drift would make the check either miss a real divergence or invent a false one.
// A regression test asserts a `declare` field (the fixed case) compiles here exactly as it does there.
//
// Known limitation (honest, rule 6): this checks every source file, whereas the in-browser preview lazily
// compiles only files reachable from the entry. A broken-but-never-imported source file would be flagged
// here though the live preview (never requiring it) would render. Consequence is mild and safe — an
// admin-only diagnostic and, when the heal gate is on, one bounded repair pass — never a build failure or
// a billing change. Reachability-scoping is a future refinement.

import * as Babel from '@babel/standalone';

export interface PreviewCompileError {
  file: string;
  message: string;
}

export interface PreviewCompileResult {
  ok: boolean;
  errors: PreviewCompileError[];
  checked: number;
}

// Extensions the in-browser preview compiles via Babel (mirror of ReactPreview.ts SOURCE_EXT).
const COMPILABLE = /\.(tsx?|jsx?|mjs)$/;
const TS = /\.tsx?$/;
const TSX = /\.tsx$/;
const DTS = /\.d\.ts$/;

/**
 * Build the EXACT preset array the in-browser preview feeds to Babel for a given file.
 * Kept identical to ReactPreview.ts:481-483 (and previewUtils.ts) — see the faithful-mirror contract.
 */
export function previewBabelPresets(path: string): unknown[] {
  const isTs = TS.test(path);
  const isTsx = TSX.test(path);
  return isTs
    ? [
        ['react', { runtime: 'automatic', development: true }],
        ['typescript', { isTSX: isTsx, allExtensions: true, allowDeclareFields: true }],
      ]
    : [['react', { runtime: 'automatic', development: true }]];
}

/**
 * Dry-compile the app's source files through the in-browser Babel config. Returns every file that would
 * throw at compile time in the live preview. Pure and synchronous — no sandbox, no browser, no LLM.
 */
export function checkPreviewCompiles(
  files: Record<string, string>,
  opts?: { maxFiles?: number },
): PreviewCompileResult {
  const errors: PreviewCompileError[] = [];
  const anyBabel = Babel as unknown as { transform: (code: string, options: unknown) => unknown };
  const paths = Object.keys(files).filter(
    (p) => COMPILABLE.test(p) && !DTS.test(p) && !p.includes('node_modules'),
  );
  const cap = Math.max(1, opts?.maxFiles ?? 400);
  let checked = 0;
  for (const path of paths.slice(0, cap)) {
    const code = files[path];
    if (typeof code !== 'string' || code.length === 0) continue;
    checked++;
    try {
      anyBabel.transform(code, {
        filename: path,
        presets: previewBabelPresets(path),
        plugins: ['transform-modules-commonjs'],
        sourceType: 'module',
      });
    } catch (e) {
      const message = String((e as { message?: unknown })?.message ?? e).slice(0, 300);
      errors.push({ file: path, message });
    }
  }
  return { ok: errors.length === 0, errors, checked };
}

/**
 * The app ENTRY files, which are ALWAYS reachable from the live preview (main is the entry, App is
 * imported by main, index is the alt entry). Matched EXACTLY at the src root (or repo root) — so a nested
 * barrel like `src/types/index.ts` is NOT treated as an entry. Pure.
 */
const ENTRY_FILE_RE = /^(src\/)?(main|App|index)\.(tsx|jsx|ts|js)$/;

/**
 * Whether an UNHEALED preview-compile divergence should block delivery (make the build honestly not-ok →
 * free). TRUE only when at least one failing file is a guaranteed-REACHABLE entry file — so the user's
 * live preview genuinely white-screens (the reported App.tsx/main.tsx "Duplicate declaration" case). A
 * divergence only in a non-entry (possibly never-imported) file stays advisory, respecting this module's
 * documented reachability limitation — no false build failure on a broken-but-unused file. Pure.
 */
export function previewDivergenceBlocksDelivery(errors: PreviewCompileError[]): boolean {
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => e && typeof e.file === 'string' && ENTRY_FILE_RE.test(e.file.replace(/^\.\//, '')));
}

/** Honest user-facing summary when the live preview will not compile — free (working app or free). Pure. */
export function previewCompileUnresolvedSummary(): string {
  return (
    'Your app was built, but the live preview does not compile yet, so it is not fully working — ' +
    'you have NOT been charged for this build. Reply "fix it" (or "continue") and I\'ll resolve it and finish.'
  );
}

/**
 * A focused repair instruction for a bounded LLM heal pass — fix ONLY the preview compile errors, with
 * the smallest edits, writing code the Babel preview accepts.
 */
export function previewCompileRepairInstruction(errors: PreviewCompileError[]): string {
  const list = errors
    .slice(0, 10)
    .map((e) => `- ${e.file}: ${e.message}`)
    .join('\n');
  return (
    `The app builds and passes the type-checker, but the live in-browser preview compiler (Babel) FAILS ` +
    `to compile the file(s) below, so the preview white-screens for the user. Fix ONLY these compile ` +
    `errors with the smallest possible edits to the existing files — change nothing else. Do NOT add or ` +
    `edit tsconfig/babel config; instead write code the preview accepts (for example: avoid \`declare\` ` +
    `class fields — initialise the field or use a plain property; avoid TypeScript-only syntax Babel ` +
    `cannot erase):\n\n${list}`
  );
}
