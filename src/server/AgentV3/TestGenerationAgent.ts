// P-AI.7 — Test Generation Intelligence (automatic post-build scaffolding).
//
// The `generate_tests` TOOL already lets the AI scaffold tests on demand, but nothing produced
// tests AUTOMATICALLY after a build — so a built app shipped with zero test coverage unless the
// model happened to call the tool. This adds the deterministic post-build step the spec calls for:
// rank the just-built source files by how heavily their exports are USED elsewhere, then scaffold a
// runnable Vitest skeleton for the top few that don't already have a test.
//
// Dependency-free: regex export extraction + the existing TestSkeletonGenerator. No extra LLM call,
// no cost, no risk to the build result. HONEST (and, since Phase 4.4, honest in both directions): the
// skeletons assert only what is true by construction and mark the real behaviour with `it.todo`, which
// vitest reports as PENDING — so they never fake a pass, and they also never fail on correct code. The
// earlier version called every function with `undefined` arguments, which shipped a RED suite with a
// brand-new app; a suite the user cannot trust is worse than no suite at all. Pure core → tested.

import { generateUnitTest, type FunctionDef } from '../lib/TestSkeletonGenerator';

export type ExportedFn = FunctionDef;

const SOURCE_RE = /\.(ts|tsx)$/;
const SKIP_RE = /(\.test\.|\.spec\.|\.d\.ts$|\.config\.|vite-env|setupTests)/i;
// Entry/aggregator files rarely hold testable logic worth a smoke skeleton.
const SKIP_BASENAMES = new Set(['index', 'main', 'types', 'constants', 'env', 'vite-env']);

/** Strip a leading "./" so paths compare consistently. */
function norm(p: string): string {
  return String(p || '').replace(/^\.\//, '');
}

/** Is this a source file worth scaffolding a unit test for? Pure. */
export function isTestableSource(path: string): boolean {
  const p = norm(path);
  if (!SOURCE_RE.test(p)) return false;
  if (SKIP_RE.test(p)) return false;
  const base = (p.split('/').pop() || '').replace(SOURCE_RE, '');
  if (SKIP_BASENAMES.has(base)) return false;
  return true;
}

/** Turn a raw parameter list into usable identifier placeholders. Pure. */
function parseParams(raw: string): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Drop type annotations / defaults / destructuring noise → a bare identifier (or "arg").
      const head = s.replace(/[:=].*$/, '').replace(/[{}[\].]/g, ' ').trim();
      const name = (head.split(/\s+/).pop() || 'arg').replace(/[^A-Za-z0-9_$]/g, '');
      return name || 'arg';
    });
}

/** Extract exported functions (name, params, async) from TS/TSX source. Pure, regex-based. */
export function extractExportedFunctions(content: string): ExportedFn[] {
  const out: ExportedFn[] = [];
  const seen = new Set<string>();
  const src = String(content || '');
  // export [default] [async] function NAME(params)
  const fnRe = /export\s+(?:default\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(src))) {
    const name = m[2];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, async: !!m[1], params: parseParams(m[3]) });
  }
  // export const NAME = [async] (params) =>   |   export const NAME = [async] function (params)
  const arrowRe = /export\s+const\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(async\s+)?(?:function\s*[A-Za-z0-9_$]*\s*)?\(([^)]*)\)\s*(?::[^=]*)?=>?/g;
  while ((m = arrowRe.exec(src))) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, async: !!m[2], params: parseParams(m[3]) });
  }
  return out;
}

/** Derive the conventional test-file path for a source path (foo.ts → foo.test.ts). Pure. */
export function testPathFor(srcPath: string): string {
  return norm(srcPath).replace(SOURCE_RE, '.test.$1');
}

/** Derive the same-dir relative import specifier the test uses for a source path. Pure. */
export function moduleSpecifierFor(srcPath: string): string {
  const base = (norm(srcPath).split('/').pop() || 'module').replace(SOURCE_RE, '');
  return `./${base}`;
}

/** How many times a target's exports are referenced across the OTHER files — a "most-used" proxy. Pure. */
function usageScore(targetPath: string, names: string[], files: Array<{ path: string; content: string }>): number {
  let score = 0;
  for (const f of files) {
    if (norm(f.path) === targetPath) continue;
    const content = String(f.content || '');
    for (const n of names) {
      if (!n) continue;
      const re = new RegExp(`\\b${n}\\b`, 'g');
      const matches = content.match(re);
      if (matches) score += matches.length;
    }
  }
  return score;
}

export interface TestPlanItem {
  sourcePath: string;
  testPath: string;
  modulePath: string;
  functions: ExportedFn[];
  /** Rendered, runnable Vitest skeleton content. */
  content: string;
}

/**
 * Plan automatic unit-test scaffolds for the built files. Picks the top `limit` testable source
 * files — ranked by how heavily their exports are USED elsewhere (then by export count) — that
 * export ≥1 function and do NOT already have a test, and renders a runnable Vitest skeleton for
 * each. Pure: returns the plan; the caller writes the files. Never throws.
 */
export function planAutoTests(
  files: Array<{ path: string; content: string }>,
  opts: { existingPaths?: Iterable<string>; limit?: number } = {},
): TestPlanItem[] {
  if (!Array.isArray(files) || files.length === 0) return [];
  const limit = Math.max(1, opts.limit ?? 3);
  const norms = files.map((f) => ({ path: norm(f.path), content: String(f.content || '') }));

  // Anything that already exists (other built files + caller-supplied existing paths) means we must
  // not overwrite a test that's already there.
  const existing = new Set<string>(norms.map((f) => f.path));
  for (const p of opts.existingPaths || []) existing.add(norm(p));

  const ranked = norms
    .filter((f) => isTestableSource(f.path))
    .map((f) => {
      const functions = extractExportedFunctions(f.content);
      const names = functions.map((fn) => fn.name);
      return { ...f, functions, usage: usageScore(f.path, names, norms) };
    })
    .filter((f) => f.functions.length > 0)
    .filter((f) => !existing.has(testPathFor(f.path)))
    .sort((a, b) => b.usage - a.usage || b.functions.length - a.functions.length || a.path.localeCompare(b.path))
    .slice(0, limit);

  return ranked.map((c) => {
    const testPath = testPathFor(c.path);
    const modulePath = moduleSpecifierFor(c.path);
    return {
      sourcePath: c.path,
      testPath,
      modulePath,
      functions: c.functions,
      content: generateUnitTest({ modulePath, functions: c.functions }),
    };
  });
}

/**
 * CAN A TEST SKELETON BREAK THIS APP'S PRODUCTION BUILD? (review of the 2026-09-25 pass move)
 *
 * Every skeleton imports `vitest`, and nothing installs it. That is harmless only where the release
 * build never type-checks test files. The golden Vite scaffold is safe (`tsc -p tsconfig.build.json`,
 * which excludes `*.test.*` — the 2026-08-11 APK incident), and so is a bare `vite build`, which
 * bundles only what the app imports. `next build`, `vue-tsc`, `svelte-check`, `ng build`, a plain
 * `tsc` / `tsc -b`, or a `-p` config that does not exclude tests all compile every test file: there a
 * skeleton is `TS2307 Cannot find module 'vitest'`, a failed production build, a failed publish and a
 * failed APK — for a file the user never asked for.
 *
 * Returns the tsconfig path the build names (so the caller can read it), and the answer given that
 * config's text. PRECISION-FIRST in the safe direction: anything not recognised as safe is unsafe,
 * because a missing skeleton costs nothing and a broken release build costs the user the app. Pure.
 */
export function buildTsconfigPath(packageJson: string | null | undefined): string | null {
  const script = buildScriptOf(packageJson);
  const m = script ? /\btsc\b[^&|;]*?(?:-p|--project)\s+(\S+)/.exec(script) : null;
  return m ? m[1].replace(/^\.\//, '') : null;
}

export function testSkeletonsCannotBreakTheBuild(
  packageJson: string | null | undefined,
  buildTsconfig: string | null | undefined,
): boolean {
  if (packageJson == null) return true; // no package.json: nothing compiles a .ts file at all
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try { pkg = JSON.parse(packageJson); } catch { return false; }
  if (pkg?.dependencies?.vitest || pkg?.devDependencies?.vitest) return true; // the import resolves
  const script = buildScriptOf(packageJson);
  if (!script) return true;
  if (/\b(next\s+build|nuxt|vue-tsc|svelte-check|ng\s+build|remix|astro\s+check)\b/.test(script)) return false;
  if (!/\btsc\b/.test(script)) return true; // e.g. `vite build`: only what the app imports is compiled
  if (!buildTsconfigPath(packageJson) || typeof buildTsconfig !== 'string') return false;
  return /["'][^"']*\*\.test\.[^"']*["']/.test(excludeBlock(buildTsconfig));
}

function buildScriptOf(packageJson: string | null | undefined): string {
  try {
    const s = (JSON.parse(String(packageJson)) as { scripts?: Record<string, unknown> })?.scripts?.build;
    return typeof s === 'string' ? s : '';
  } catch { return ''; }
}

/** The text of a tsconfig's `"exclude": [...]` array, or '' — read as text so comments do not matter. */
function excludeBlock(tsconfig: string): string {
  const m = /"exclude"\s*:\s*\[([\s\S]*?)\]/.exec(tsconfig);
  return m ? m[1] : '';
}
