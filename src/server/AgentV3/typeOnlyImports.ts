/**
 * A TYPE-ONLY IMPORT IS NOT A RUNTIME EDGE, SO IT CANNOT MAKE A RUNTIME CYCLE (autopsy 1d3ff0d5, 2026-10-21).
 *
 * A student/teacher learning app rendered in a real browser 7 minutes in. Its screens each wrote
 * `import type { AppContextType } from '../App'` while `App.tsx` imported the screens — the standard way to
 * share a context's shape. Two cycle detectors read that as 18 import cycles; `Readiness` priced each at
 * 8 points, the score hit 0/100, the "below the 50/100 bar" blocker fired, and a working app was handed back
 * to the builder as unfinished. The resumed run lost the original brief, spent the rest of the free budget
 * asking the user what to build, and the build ended RED at the cost ceiling.
 *
 * `import type …` and `export type … from …` are erased by the compiler before anything runs (esbuild/Vite
 * erase them unconditionally), so they can never be half-initialised at import time — the one thing a
 * cycle is dangerous for. The comment in `findCircularDependencies` already said "type-only cycles are
 * harmless"; the regex never did. This module is the one place that decides it.
 *
 * ⚠️ DELIBERATELY NARROW. Only the statement-level forms count. `import { type A } from 'x'` is NOT treated
 * as type-only: under `verbatimModuleSyntax` it survives as a bare `import 'x'` side-effect import, which
 * IS a runtime edge. A spec is type-only only when EVERY static statement that names it is type-only, so a
 * file that also imports a value from the same module keeps its edge.
 */

// The clause of each statement is matched TOKEN BY TOKEN, never as "anything up to `from`": a lazy
// `[^'";]*?` crosses a newline in a file written without semicolons, so `export type { A }` followed on the
// next line by `import Z from './z'` would swallow the real import and mark './z' type-only.
const IMPORT_RE = /\bimport(\s+type)?\s+(?:[\w$]+\s*,\s*)?(?:[\w$]+|\*\s+as\s+[\w$]+|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
const EXPORT_RE = /\bexport(\s+type)?\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;

/** Specifiers `code` (comment-stripped source) imports ONLY as types. PURE. */
export function typeOnlyImportSpecs(code: string): Set<string> {
  const typeOnly = new Set<string>();
  const valueUsed = new Set<string>();
  for (const re of [IMPORT_RE, EXPORT_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      if (m[1]) typeOnly.add(m[2]); else valueUsed.add(m[2]);
    }
  }
  for (const spec of valueUsed) typeOnly.delete(spec);
  // A dynamic `import('x')` or `require('x')` is a runtime edge too.
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = dynamicRe.exec(code); m; m = dynamicRe.exec(code)) typeOnly.delete(m[1] ?? m[2]);
  // A side-effect import `import 'x'` is a runtime edge as well.
  const sideEffectRe = /\bimport\s*['"]([^'"]+)['"]/g;
  for (let m = sideEffectRe.exec(code); m; m = sideEffectRe.exec(code)) typeOnly.delete(m[1]);
  return typeOnly;
}
