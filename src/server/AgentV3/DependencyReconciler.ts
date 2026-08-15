// AgentV3 — Dependency Reconciler: the fix for "code imports a package that package.json never declared".
//
// THE REAL BUG (found in a live build report): the AI wrote `import { restrictToVerticalAxis } from
// "@dnd-kit/modifiers"` in a component, but only listed `@dnd-kit/core`, `@dnd-kit/sortable`,
// `@dnd-kit/utilities` in package.json — NOT `@dnd-kit/modifiers`. So `npm install` never installed it,
// Vite couldn't resolve the import ("The following dependencies are imported but could not be resolved:
// @dnd-kit/modifiers"), and the preview was broken even though the dev server's PORT was up. This is a
// common AI-codegen failure: an import with no matching dependency entry.
//
// This module deterministically finds every bare package a project's source imports and subtracts the
// ones already declared in package.json (+ Node builtins) — the remainder is the MISSING set the build
// must `npm install` before starting the dev server. PURE + dependency-free so it is fully unit-testable
// without a sandbox; the route installs whatever it returns.

/** Node.js built-in modules that are never npm dependencies (with or without the `node:` prefix). */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm',
  'wasi', 'worker_threads', 'zlib',
]);

/**
 * Resolve an import specifier to the INSTALLABLE npm package name, or null when it is not a package
 * (a relative/absolute path, the `@/` src alias, a Node builtin, a `node:`/`virtual:`/URL specifier).
 *   `@dnd-kit/modifiers`        → `@dnd-kit/modifiers`
 *   `@dnd-kit/sortable/dist/x`  → `@dnd-kit/sortable`
 *   `react-dom/client`          → `react-dom`
 *   `lodash/fp`                 → `lodash`
 *   `./Foo`, `../x`, `@/lib/y`  → null
 * PURE.
 */
/**
 * File types that are ASSETS, not code. A specifier ending in one of these names a FILE — never a
 * package to install.
 *
 * ADMIN REPORT 2026-08-14 (APK build blocked): an app importing
 * `@assets/772B17C5-…_1773842365564.png` was told "it uses a library that is not set up". It is not a
 * library, it is a picture. `@assets/` is a Vite path alias, and a scoped package (`@scope/name`) has
 * exactly the same shape — so the alias was read as an npm package, the repair tried to install
 * something that cannot exist, and the build stayed blocked while the message pointed the user (and
 * the AI) at entirely the wrong problem.
 */
const ASSET_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|mp3|wav|ogg|pdf|woff2?|ttf|otf|eot|csv|txt|md)(\?.*)?$/i;

/**
 * Path-alias prefixes that are NOT packages, whatever they look like.
 *
 * ⚠️ Only `@/` used to be excluded here — one member of a whole family. `@assets/`, `@components/`,
 * `@lib/`, `~/` and friends are the ordinary Vite/tsconfig aliases every generated app uses, and each
 * one was being reported as a missing npm dependency.
 */
// ⚠️ `@types/` is DELIBERATELY ABSENT, and must stay absent. It is the single most common scoped
// package family in TypeScript (`@types/react`, `@types/node`), not a path alias — including it here
// made every one of them invisible to the reconciler, which the existing devDependencies test caught
// immediately. A prefix goes in this list only if it is far more likely to be an alias than a real
// scope; when the two are genuinely ambiguous, treating it as a package is the safer error, because
// a missed alias is one confusing message while a missed dependency is a broken build.
const ALIAS_PREFIX_RE = /^(?:~\/|@\/|@(?:assets?|images?|img|components?|component|lib|libs|utils?|src|styles?|pages?|hooks?|config|public|static|fonts?|media|shared|features?|layouts?|store|data)\/)/i;

/** True when a specifier names a FILE in this project rather than an installable package. */
export function isLocalFileSpecifier(spec: string): boolean {
  const s = (spec || '').trim();
  if (!s) return false;
  return ALIAS_PREFIX_RE.test(s) || ASSET_EXT_RE.test(s);
}

export function packageNameFromSpecifier(spec: string): string | null {
  const s = (spec || '').trim();
  if (!s) return null;
  if (s.startsWith('.') || s.startsWith('/')) return null;   // relative / absolute path
  // A path ALIAS or an ASSET file — never something to npm-install. See isLocalFileSpecifier.
  //
  // The asset rule also covers `real-package/dist/logo.png`: the worst case there is that we do not
  // learn about that package from THIS import, and any other import of it still declares it. Missing
  // a dependency we would have caught elsewhere is a far smaller failure than blocking a build and
  // telling the user a picture is a library.
  if (isLocalFileSpecifier(s)) return null;
  if (s.includes(':')) return null;                           // node:, virtual:, data:, http:, etc.
  const parts = s.split('/');
  let pkg: string;
  if (s.startsWith('@')) {
    if (parts.length < 2 || !parts[0] || !parts[1]) return null; // malformed scoped specifier
    pkg = `${parts[0]}/${parts[1]}`;                           // @scope/name (drop deep sub-path)
  } else {
    pkg = parts[0];                                            // name (drop sub-path)
  }
  if (!pkg || NODE_BUILTINS.has(pkg)) return null;
  return pkg;
}

/**
 * Extract every bare package name imported/required by a source file — from `import … from 'x'`,
 * `import 'x'`, `export … from 'x'`, `require('x')`, and dynamic `import('x')`. Returns the resolved
 * installable package names (relative paths / aliases / builtins removed, sub-paths collapsed). PURE.
 */
export function extractImportedPackages(content: string): string[] {
  if (!content) return [];
  const specs: string[] = [];
  const push = (re: RegExp): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) specs.push(m[1]);
  };
  // MODULE SPECIFIERS ONLY — the quote must belong to a `from '…'` clause or a side-effect
  // `import '…'`. The old pattern grabbed ANY first quoted string on an import/export line, so
  // `export const DEFAULT_SIZE = 'md';` (a Button size constant) read as "imports the package md" —
  // and the reconciler npm-installed the real (unrelated) `md` package into the user's app (build
  // report 2026-07-07). That class is supply-chain-shaped: any quoted token on an export line could
  // become an `npm install <token>`. Requiring `from` (or import-adjacent quote) kills the class:
  //   import X from 'y' | import {a} from 'y' | import type {T} from 'y' | export {a} from 'y' |
  //   export * from 'y'  → matched via `from 'y'`
  //   import 'y'          → matched via the side-effect arm (quote directly after `import`)
  //   export const x='md' | export type S='sm'|'md' → NO match (no `from`, quote not import-adjacent)
  push(/(?:^|[\n;])\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"\n]+)['"]/g);
  push(/(?:^|[\n;])\s*import\s*['"]([^'"\n]+)['"]/g); // side-effect import 'y'
  push(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g);   // require('y')
  push(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g);    // dynamic import('y')
  const out = new Set<string>();
  for (const spec of specs) {
    const pkg = packageNameFromSpecifier(spec);
    if (pkg) out.add(pkg);
  }
  return [...out];
}

/** Collect the dependency names declared in a package.json's dependencies + devDependencies. */
function declaredDependencies(packageJsonRaw: string | undefined): Set<string> {
  const declared = new Set<string>();
  if (!packageJsonRaw) return declared;
  try {
    const pkg = JSON.parse(packageJsonRaw) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; peerDependencies?: Record<string, unknown> };
    for (const group of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
      if (group && typeof group === 'object') for (const name of Object.keys(group)) declared.add(name);
    }
  } catch { /* an unparseable package.json means nothing is declared — everything imported is "missing" */ }
  return declared;
}

/** True for a source file whose imports we should scan (JS/TS/JSX/TSX). */
function isScannableSource(path: string): boolean {
  return /\.(?:m?[jt]sx?|cjs)$/i.test(path) && !/\.d\.ts$/i.test(path);
}

/**
 * Find packages the project's source code IMPORTS but package.json does NOT declare — the set the build
 * must `npm install` before the dev server starts, or Vite fails to resolve them and the preview breaks.
 * `files` maps workspace-relative path → content (must include the project's package.json). PURE.
 */
export function findMissingDependencies(files: Record<string, string>): string[] {
  const pkgJsonKey = Object.keys(files).find((p) => p === 'package.json' || p.endsWith('/package.json'));
  const declared = declaredDependencies(pkgJsonKey ? files[pkgJsonKey] : undefined);
  const missing = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!isScannableSource(path)) continue;
    for (const pkg of extractImportedPackages(content)) {
      if (!declared.has(pkg)) missing.add(pkg);
    }
  }
  return [...missing].sort();
}
