// A TEST FILE MUST NEVER BE ABLE TO FAIL THE APP'S RELEASE BUILD.
//
// 🔒 ROOT CAUSE (admin build report 2026-08-24 — a user's "Build Android APK (installable)" run).
// The APK workflow died in its "Build the web app" step with:
//
//     ./playwright.config.ts:3:16
//     Type error: Cannot redeclare block-scoped variable 'devices'.
//
//       1 | declare module '@playwright/test' {
//       3 |   export const devices: Record<string, any>;
//       6 | import { defineConfig, devices } from '@playwright/test';
//
// Read the chain backwards and every link is ours:
//
//   1. `e2eAutoScaffold` writes `playwright.config.ts` + `e2e/*.spec.ts` into the user's project, and
//      DELIBERATELY does not install `@playwright/test` (its own comment says so — the reasoning is
//      sound: adding a package to somebody's project to run a test for them is a different thing).
//   2. So the project now contains TypeScript that imports a package it does not have. In a Next.js
//      app that is fatal, because `next build` typechecks `**/*.ts` — our test config included.
//   3. Someone then "fixed" the resulting `Cannot find module '@playwright/test'` by pasting an
//      ambient `declare module '@playwright/test'` at the top of that same file. That is the classic
//      surface patch rule 4 forbids, and it does not even work: a `declare module` block in a file
//      that also IMPORTS the same module collides with the import's bindings, so the error merely
//      changed its name. The app could no longer build at all.
//
// The 50/50 half nobody had done: the bug is not the bad shim, it is that **we wrote a file into a
// user's app that their build typechecks and that cannot possibly compile**. A shim was inevitable.
//
// 🔒 THIS IS A SIBLING OF A FIX ALREADY IN THIS REPO, which is how we know it is a class and not an
// incident. On 2026-08-11 an APK build failed because a broken `*.test.tsx` was typechecked by the
// release build; the answer was `tsconfig.build.json` excluding tests (FrameworkFoundation.ts). That
// fix was right and incomplete in two ways this closes: `playwright.config.ts` at the project ROOT is
// neither `*.test.*` nor `*.spec.*`, and `next build` reads `tsconfig.json`, never our
// `tsconfig.build.json`. A Vite scaffold was already safe by accident — its `include` is `["src"]`,
// and the config sits outside it.

/** The paths the E2E scaffold writes, which the app's release build must not typecheck. */
export const E2E_EXCLUDE_PATHS = ['playwright.config.ts', 'e2e'] as const;

/**
 * Parse tsconfig-flavoured JSON (comments and trailing commas are legal there, and Next.js users add
 * both). Returns null on anything it cannot read — a config we do not understand is one we must not
 * rewrite.
 */
export function parseTsconfig(text: string): Record<string, unknown> | null {
  const src = String(text ?? '');
  if (!src.trim()) return null;
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i++; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  // Trailing commas before } or ] — legal in tsconfig, fatal to JSON.parse.
  const cleaned = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Would this config's typecheck actually REACH a root-level `playwright.config.ts`?
 *
 * 🔒 THE NARROWNESS IS THE SAFETY. A Vite scaffold's `include` is `["src"]`, so the E2E files are
 * already outside the build and there is nothing to fix — editing that config would be a change with
 * no defect behind it, and this codebase does not make those. Only a config that sweeps the whole
 * project (no `include` at all, which means everything, or a root-level star-star glob — the Next.js
 * default) can be broken by the file we wrote. PURE.
 */
export function typecheckReachesRoot(cfg: Record<string, unknown>): boolean {
  const include = cfg?.include;
  if (include === undefined || include === null) return true;   // absent ⇒ every file under the root
  if (!Array.isArray(include)) return false;                    // a shape we do not understand
  if (include.length === 0) return true;
  return include.some((raw) => {
    const p = String(raw ?? '').trim().replace(/^\.\//, '');
    if (p === '.' || p === '**' || p === '**/*') return true;
    return /^\*\*\/\*\.(ts|tsx|js|jsx)$/.test(p);
  });
}

export interface E2eExcludeResult {
  /** The tsconfig text to write, or the input unchanged. */
  text: string;
  /** True only when something really changed and the caller should write it. */
  changed: boolean;
  /** Which entries were added, for the build report. */
  added: string[];
  /** Why nothing was done, when nothing was. '' when it was. */
  reason: string;
}

/**
 * Add the E2E paths to a tsconfig's `exclude`, so the app's build stops typechecking test files.
 *
 * NEVER THROWS, and never rewrites a config it could not parse — that would trade a build failure for
 * a corrupted project, which is the worse of the two by a distance.
 *
 * Comments in the original are lost when a rewrite happens, because a tsconfig is re-serialized from
 * the parsed object. That is a deliberate, stated trade: a lost comment costs a reader a moment, and
 * the thing it buys is an app that can be built at all. Nothing is rewritten unless a change is
 * genuinely needed, so a project already excluding these keeps its file byte-for-byte.
 */
export function withE2eExcluded(text: string): E2eExcludeResult {
  const unchanged = (reason: string): E2eExcludeResult => ({ text, changed: false, added: [], reason });
  const cfg = parseTsconfig(text);
  if (!cfg) return unchanged('the tsconfig could not be read, so it was left exactly as it is');
  if (!typecheckReachesRoot(cfg)) return unchanged('this project already builds only its source folder, so the test files cannot affect it');

  const existing = Array.isArray(cfg.exclude) ? cfg.exclude.map((e) => String(e ?? '').trim().replace(/^\.\//, '')) : [];
  const has = (p: string) => existing.some((e) => e === p || e === `${p}/**` || e === `${p}/**/*`);
  const added = E2E_EXCLUDE_PATHS.filter((p) => !has(p));
  if (added.length === 0) return unchanged('the test files are already outside this project’s build');

  const next = { ...cfg, exclude: [...(Array.isArray(cfg.exclude) ? cfg.exclude : ['node_modules']), ...added] };
  return { text: `${JSON.stringify(next, null, 2)}\n`, changed: true, added: [...added], reason: '' };
}

/**
 * The line the build report carries. Says exactly what was changed and why, because "we edited your
 * tsconfig" with no reason attached is the kind of silent mutation a user is right to distrust.
 */
export function e2eExcludeNote(added: string[]): string {
  return `Your build was set to skip the end-to-end test files (${added.join(', ')}) when compiling your app. `
    + 'They need Playwright, which is not installed in your project — without this, your app would fail '
    + 'to build over a test file that is not part of it.';
}
