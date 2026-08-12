// AgentV3 — PROTECT THE BOILERPLATE WE SHIP. Restore it deterministically instead of asking a weak
// model to fix a file it will only break further.
//
// ROOT CAUSE, confirmed across THREE real builds (2026-08-12 — the benchmark, the 44-minute report, and
// the "continue" report):
//
//   src/ErrorBoundary.tsx(10,10): error TS2339: Property 'state' does not exist on type 'ErrorBoundary'.
//
// The scaffold ships a CORRECT class-component ErrorBoundary. A weak-tier coder (Kimi/GLM), when it
// touches that file, reliably breaks its typing — and then cannot fix it, because a React error boundary
// MUST be a class component (there is no functional equivalent for componentDidCatch) and the model does
// not know that. Its own words from the report: "ErrorBoundary को functional component में convert करता
// हूं" → "skip करता हूं" → "बाद में fix करेंगे". Five `npx tsc` passes were burned fighting one boilerplate
// file, and it still shipped broken.
//
// THE FIX IS THE SAME SHAPE AS THE DEAD-SERVER FIX: when the failure is in a file we OWN and that has one
// canonical correct form, do the deterministic, free, certain thing (restore our version) rather than the
// expensive, probabilistic thing (a model repair pass). The model never has a legitimate reason to
// rewrite an error boundary, so restoring it can never lose user intent.
//
// PURE: the canonical content is a constant; the decision is string analysis. No I/O, no model, no clock.

import { errorBoundaryTsx } from './sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

/**
 * Files the scaffold OWNS and that have exactly one correct form. A build never needs to modify these,
 * so if the model broke one, our version is unambiguously the right thing to put back.
 *
 * Deliberately tiny. Only pure boilerplate the user never asked for belongs here — never App.tsx, never
 * anything carrying the user's actual features. Adding a file here is asserting "the model has no
 * legitimate reason to change this", which is true of an error boundary and almost nothing else.
 */
export const SCAFFOLD_BOILERPLATE: Readonly<Record<string, string>> = Object.freeze({
  'src/ErrorBoundary.tsx': errorBoundaryTsx,
});

/** Is `path` a scaffold boilerplate file we can restore? Pure. */
export function isScaffoldBoilerplate(path: string): boolean {
  return typeof path === 'string' && path in SCAFFOLD_BOILERPLATE;
}

/** The canonical content for a scaffold boilerplate path, or null. Pure. */
export function canonicalScaffold(path: string): string | null {
  return isScaffoldBoilerplate(path) ? SCAFFOLD_BOILERPLATE[path] : null;
}

/**
 * The scaffold boilerplate files a tsc error report blames — the ones we can fix for free by restoring.
 *
 * Reads the `path(line,col): error TS…` lines tsc emits and returns the DISTINCT known-boilerplate paths
 * that appear, in first-seen order. A leading `./` or `src/` variance is tolerated. Pure; never throws.
 */
export function scaffoldFilesInTscErrors(tscOutput: string): string[] {
  const text = String(tscOutput ?? '');
  const out: string[] = [];
  for (const known of Object.keys(SCAFFOLD_BOILERPLATE)) {
    // Match the path as tsc prints it: at a line start or after whitespace, before `(`.
    const base = known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\s|\\./)${base}\\(\\d+,\\d+\\)`, 'm');
    if (re.test(text)) out.push(known);
  }
  return out;
}

/**
 * Would restoring the scaffold boilerplate plausibly clear this tsc failure — i.e. is EVERY error line
 * attributed to a known boilerplate file?
 *
 * When true, a deterministic restore is very likely to fix the whole failure with no model pass. When
 * false (errors also live in the user's own files), we still restore the boilerplate we can, then let
 * the model handle the genuine remainder. Pure.
 */
export function tscFailureIsOnlyScaffold(tscOutput: string): boolean {
  const text = String(tscOutput ?? '');
  const errorLines = text.split('\n').filter((l) => /\(\d+,\d+\):\s*error\s+TS\d+/.test(l));
  if (errorLines.length === 0) return false;
  const scaffold = new Set(scaffoldFilesInTscErrors(text));
  if (scaffold.size === 0) return false;
  return errorLines.every((l) => [...scaffold].some((f) => {
    const base = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s|\\./)${base}\\(`, '').test(l);
  }));
}

/**
 * Given the current file set and a tsc error report, the boilerplate restores to apply: only files that
 * are (a) blamed by tsc AND (b) actually different from canonical (restoring an identical file is a
 * pointless write). Returns `path → canonical content`. Pure.
 */
export function scaffoldRestores(
  currentFiles: Record<string, string>,
  tscOutput: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of scaffoldFilesInTscErrors(tscOutput)) {
    const canonical = canonicalScaffold(path);
    if (canonical == null) continue;
    const current = currentFiles?.[path];
    // Restore when the file is missing or has drifted. If it already equals canonical, tsc is blaming a
    // correct file — restoring changes nothing and the real cause is elsewhere.
    if (current !== canonical) out[path] = canonical;
  }
  return out;
}
