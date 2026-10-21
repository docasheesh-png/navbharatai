// AgentV3 — Import/Export consistency analyzer (build-robustness evaluator).
//
// Catches a top cause of HARD build failures in generated apps: an import of a named (or default)
// binding that the target local module does NOT actually export — e.g. `import { Foo } from './bar'`
// when bar.tsx never exports `Foo`. Bundlers fail with "'Foo' is not exported by './bar'" (or the
// value is silently `undefined` at runtime), breaking the app. The existing HallucinationDetector only
// verifies that the imported FILE exists (`unresolved-local-import`); it never checks that the named
// bindings match — so this closes a real, distinct gap.
//
// It uses the shared TypeScript export-capability graph and lexical binding references. Type-only
// imports/uses stay valid; runtime reads require an emitted value. Unresolved stars/external or
// declaration-file implementations remain uncertain, and node_modules is never read.

import { isAppAnalysisPath } from './appAnalysisPaths';
import { typeOnlyImportSpecs } from './typeOnlyImports';
import { createExportCapabilities, EXPORT_CODE_FILE, resolveExportTarget } from './exportCapabilities';

export type ImportMismatchKind = 'named-import-not-exported' | 'default-import-missing';

export interface ImportMismatch {
  file: string;
  line: number;
  imported: string;
  from: string;
  kind: ImportMismatchKind;
  detail: string;
}

export interface ImportExportReport {
  mismatches: ImportMismatch[];
  filesScanned: number;
  counts: Record<ImportMismatchKind, number>;
  ok: boolean;
}

const CODE_FILE = EXPORT_CODE_FILE;

/** Resolve a relative import specifier to an actual key in the file set (or null). */
export function resolveLocalTarget(importer: string, spec: string, fileSet: Set<string>): string | null {
  return resolveExportTarget(importer, spec, fileSet);
}

/** Analyze a file set for named/default imports that the target module does not export. Pure. */
export async function analyzeImportExports(files: Record<string, string>): Promise<ImportExportReport> {
  const counts: Record<ImportMismatchKind, number> = { 'named-import-not-exported': 0, 'default-import-missing': 0 };
  const empty: ImportExportReport = { mismatches: [], filesScanned: 0, counts, ok: true };

  const code = Object.fromEntries(Object.entries(files).filter(([path, content]) =>
    CODE_FILE.test(path) && isAppAnalysisPath(path) && typeof content === 'string'));
  let model: ReturnType<typeof createExportCapabilities>;
  try { model = createExportCapabilities(code); } catch { return empty; }
  const mismatches: ImportMismatch[] = [];
  for (const path of Object.keys(code)) {
    for (const binding of model.importsOf(path)) {
      const target = model.resolve(path, binding.from);
      if (!target) continue; // external package or missing file is a different check's job
      const info = model.exportsOf(target);
      const cap = info.exports.get(binding.imported);
      if (info.uncertain) continue;
      if (cap && (!binding.readsValue || cap.runtime !== 'erased')) continue;
      const kind: ImportMismatchKind = binding.imported === 'default' ? 'default-import-missing' : 'named-import-not-exported';
      counts[kind]++;
      mismatches.push({ file: path, line: binding.line,
        imported: binding.imported === 'default' ? binding.local : binding.imported,
        from: binding.from, kind,
        detail: cap
          ? `'${binding.imported}' is used as a runtime value from '${binding.from}', but that export is type-only or ambient and emits no value.`
          : binding.imported === 'default'
            ? `Default import from '${binding.from}', but that module has no default export.`
            : `'${binding.imported}' is imported from '${binding.from}', but that module does not export it.`,
      });
    }
  }

  return { mismatches, filesScanned: Object.keys(code).length, counts, ok: mismatches.length === 0 };
}

export interface ExportRegenTarget {
  /** The file that is missing exports (the one to regenerate). */
  target: string;
  /** The named bindings other files import from it but it does not export. */
  missingNamed: string[];
  /** True when a default export is imported but missing. */
  missingDefault: boolean;
  /** The importer files (path:line) that need each name — context for the repair. */
  neededBy: string[];
}

/**
 * Group an ImportExportReport's mismatches by the TARGET module that is missing the export, so a heal
 * can REGENERATE each such file with the bindings its consumers expect.
 *
 * ROOT CAUSE this serves (deep-test App #7 — Trello, 2026-07-13): a truncated file-generation
 * (`LLM_TRUNCATED` on Vertex under GLM rate-limiting) cut off a module's export — e.g. server/routes/cards.ts
 * lost its `export … cardRoutes` — so server/index.ts's `import { cardRoutes }` broke. `reconcileImportExports`
 * only fixes named↔default KIND mismatches; it cannot restore an export that isn't there. The fix is to
 * regenerate the target file so the missing export exists again. Pure; resolves each `from` spec to a real
 * file in `fileSet` (unresolvable specs are skipped — that's the missing-FILE gate's job, not this one).
 */
export function exportRegenTargets(report: ImportExportReport, fileSet: Set<string>): ExportRegenTarget[] {
  const byTarget = new Map<string, { named: Set<string>; def: boolean; neededBy: Set<string> }>();
  for (const m of report.mismatches) {
    const target = resolveLocalTarget(m.file, m.from, fileSet);
    if (!target) continue; // unresolved file → not this gate's job
    let e = byTarget.get(target);
    if (!e) { e = { named: new Set(), def: false, neededBy: new Set() }; byTarget.set(target, e); }
    if (m.kind === 'named-import-not-exported') e.named.add(m.imported);
    else if (m.kind === 'default-import-missing') e.def = true;
    e.neededBy.add(`${m.file}:${m.line}`);
  }
  return [...byTarget.entries()].map(([target, e]) => ({
    target,
    missingNamed: [...e.named].sort(),
    missingDefault: e.def,
    neededBy: [...e.neededBy].sort(),
  }));
}

/** A compact repair instruction naming each file that must be regenerated and the exports it must provide. */
export function exportRegenInstruction(targets: readonly ExportRegenTarget[]): string {
  return targets.slice(0, 15).map((t) => {
    const parts: string[] = [];
    if (t.missingNamed.length) parts.push(`named export(s): ${t.missingNamed.join(', ')}`);
    if (t.missingDefault) parts.push('a default export');
    return `- ${t.target} MUST provide ${parts.join(' and ')} (imported by ${t.neededBy.slice(0, 4).join(', ')}${t.neededBy.length > 4 ? ', …' : ''})`;
  }).join('\n');
}

// === CIRCULAR DEPENDENCY DETECTION (theory → live; Vol 5 X.4 / Vol 6 C18 / Vol 7) ================
// A real defect class no existing check catches: A→B→A (or longer, or a self-import). ADVISORY ONLY
// — many JS/TS import cycles are BENIGN (ES modules tolerate most; type-only cycles are harmless), so
// a build is NEVER failed on a cycle (QA-03 — never break a working app). The finding is surfaced for
// the reviewer/repair to consider; it is never auto-"fixed" (breaking a cycle can change behavior).

export interface CircularDependency {
  /** The files forming the import cycle, in order, normalized to start at the smallest path. */
  cycle: string[];
}

// import X from '…' | import '…' | require('…') | export … from '…'  (specifier in one of 4 groups).
const CYCLE_IMPORT_RE = /\bimport\b[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bexport\b[^'"]*?from\s*['"]([^'"]+)['"]/g;

/** Strip block + line comments so a commented-out import never creates a graph edge. Best-effort. */
function stripForCycles(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Detect circular LOCAL-import dependencies. Reuses resolveLocalTarget, so only PROJECT files form
 * edges (a package specifier resolves to null and is excluded). Each cycle is normalized (rotated to
 * its lexicographically-smallest node) and de-duplicated. Pure & deterministic; advisory (non-blocking).
 */
export function findCircularDependencies(files: Record<string, string>): CircularDependency[] {
  const fileSet = new Set(
    Object.keys(files).filter((p) => CODE_FILE.test(p) && isAppAnalysisPath(p) && typeof files[p] === 'string'),
  );
  // Adjacency: file → sorted unique local import targets (deterministic traversal).
  const adj = new Map<string, string[]>();
  for (const path of fileSet) {
    const src = stripForCycles(files[path]);
    // `import type …` is erased before runtime, so it is no edge of a runtime cycle (typeOnlyImports.ts).
    const typeOnly = typeOnlyImportSpecs(src);
    const targets = new Set<string>();
    let m: RegExpExecArray | null;
    CYCLE_IMPORT_RE.lastIndex = 0;
    while ((m = CYCLE_IMPORT_RE.exec(src)) !== null) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!spec || typeOnly.has(spec)) continue;
      const target = resolveLocalTarget(path, spec, fileSet);
      if (target) targets.add(target);
    }
    adj.set(path, [...targets].sort());
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const pathStack: string[] = [];
  const seen = new Set<string>();
  const cycles: CircularDependency[] = [];

  const normalize = (loop: string[]): string[] => {
    let min = 0;
    for (let i = 1; i < loop.length; i++) if (loop[i] < loop[min]) min = i;
    return [...loop.slice(min), ...loop.slice(0, min)];
  };
  const record = (loop: string[]): void => {
    const norm = normalize(loop);
    const key = norm.join('>');
    if (!seen.has(key)) { seen.add(key); cycles.push({ cycle: norm }); }
  };

  const dfs = (node: string): void => {
    color.set(node, GRAY);
    pathStack.push(node);
    for (const next of adj.get(node) ?? []) {
      if (next === node) { record([node]); continue; } // self-import = 1-node cycle
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const idx = pathStack.indexOf(next);
        if (idx !== -1) record(pathStack.slice(idx));
      } else if (c === WHITE) {
        dfs(next);
      }
    }
    pathStack.pop();
    color.set(node, BLACK);
  };

  for (const node of [...fileSet].sort()) {
    if ((color.get(node) ?? WHITE) === WHITE) dfs(node);
  }
  return cycles;
}

export interface UnusedDependency {
  /** A package declared in package.json "dependencies" that no project file statically imports. */
  name: string;
}

// Node builtins (with or without the `node:` prefix) are never a package.json dependency.
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto', 'dgram', 'dns', 'events',
  'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url',
  'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

// Packages legitimately used WITHOUT a discoverable static import (JSX runtime / config-only wiring),
// so a missing import must not be reported as unused. Conservative on purpose — false positives here
// mislead the user into removing a dep the build needs.
const IMPLICIT_USE_DEPS = new Set([
  'react', 'react-dom', 'vue', 'svelte', 'preact', // framework runtimes (JSX/automatic runtime)
  'typescript', 'tslib', 'vite', 'tailwindcss', 'postcss', 'autoprefixer', // build/config wiring
]);

// Packages a META-FRAMEWORK provides implicitly, so an app never needs to import them by hand — reporting
// them as "unused" is a false positive that pushes the user to remove a dep the framework requires.
// Applied ONLY when that framework is detected (see frameworkProvidedDeps). ShopSphere/Nuxt autopsy
// 2026-07-19: `vue-router` was falsely flagged unused — Nuxt owns routing and auto-imports `useRouter`/
// `<NuxtLink>`, so no project file imports `vue-router` directly even though the app depends on it.
const NUXT_PROVIDED_DEPS = new Set([
  'nuxt', 'vue', 'vue-router', 'vue-server-renderer', '@vue/server-renderer',
  'h3', 'ofetch', 'nitropack', 'unhead', '@unhead/vue', 'ufo', 'pathe', 'consola', 'defu',
]);
const SVELTEKIT_PROVIDED_DEPS = new Set(['@sveltejs/kit', 'svelte', 'vite']);

/** True when the workspace is a Nuxt app (a nuxt.config.* file, or `nuxt` declared in package.json). */
function isNuxtProject(files: Record<string, string>, declared: string[]): boolean {
  if (declared.includes('nuxt')) return true;
  return Object.keys(files).some((p) => /(^|\/)nuxt\.config\.[cm]?[jt]s$/i.test(p));
}

/** True when the workspace is a SvelteKit app (a svelte.config.*, or `@sveltejs/kit` declared). */
function isSvelteKitProject(files: Record<string, string>, declared: string[]): boolean {
  if (declared.includes('@sveltejs/kit')) return true;
  return Object.keys(files).some((p) => /(^|\/)svelte\.config\.[cm]?[jt]s$/i.test(p));
}

/** The set of framework-provided packages to never flag as unused, given the detected meta-framework. */
function frameworkProvidedDeps(files: Record<string, string>, declared: string[]): Set<string> {
  if (isNuxtProject(files, declared)) return NUXT_PROVIDED_DEPS;
  if (isSvelteKitProject(files, declared)) return SVELTEKIT_PROVIDED_DEPS;
  return new Set();
}

/**
 * The commands a project's own `scripts` run (`next dev` → `next`, `npx vite build` → `vite`,
 * `NODE_ENV=production node server.js` → `node`). A dependency whose name is one of them is USED — by the
 * CLI — however few files import it.
 *
 * 🔴 AUTOPSY b47c56d8 (2026-09-30): a Next.js app was told *"\"next\" is declared in package.json
 * dependencies but no project file imports it"* while its dev script was literally `next dev`. The finding
 * hedged ("if it is used only via a CLI, ignore this") about the one fact it had in hand. Matched by exact
 * name only, so this can only REMOVE findings, never invent one.
 */
function scriptCommands(pkg: unknown): Set<string> {
  const out = new Set<string>();
  const scripts = pkg && typeof pkg === 'object' ? (pkg as { scripts?: unknown }).scripts : null;
  if (!scripts || typeof scripts !== 'object') return out;
  const WRAPPERS = new Set(['npx', 'pnpx', 'bunx', 'exec', 'dlx', 'cross-env', 'dotenv', 'env']);
  for (const value of Object.values(scripts as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    for (const segment of value.split(/&&|\|\||;|\|/)) {
      const tokens = segment.trim().split(/\s+/).filter(Boolean);
      let i = 0;
      // Skip env assignments, wrappers (and a wrapper's own `--` or flags), and `yarn`/`pnpm` runners.
      while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || WRAPPERS.has(tokens[i]) || tokens[i] === 'yarn' || tokens[i] === 'pnpm' || tokens[i] === '--' || tokens[i].startsWith('-'))) i++;
      if (i < tokens.length) out.add(tokens[i]);
    }
  }
  return out;
}

/** Reduce an import specifier to its package name: '@scope/x/sub' → '@scope/x', 'x/sub' → 'x'. */
function packageNameOf(spec: string): string {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

/**
 * Detect runtime dependencies declared in package.json that NO project file imports. DETECTION ONLY —
 * never prunes/removes (a dep can be used via config, CLI, or a runtime string load, so removal is
 * unsafe) and never fails a build. Only inspects "dependencies" (not devDependencies, which are
 * build-time and frequently config-only) and excludes a conservative implicit-use allowlist to keep
 * false positives near zero. Pure & deterministic; advisory.
 */
export function findUnusedDependencies(files: Record<string, string>): UnusedDependency[] {
  const pkgRaw = files['package.json'];
  if (typeof pkgRaw !== 'string') return [];
  let declared: string[];
  let commands: Set<string>;
  try {
    const pkg = JSON.parse(pkgRaw);
    const deps = pkg && typeof pkg === 'object' ? pkg.dependencies : null;
    if (!deps || typeof deps !== 'object') return [];
    declared = Object.keys(deps);
    commands = scriptCommands(pkg);
  } catch {
    return []; // malformed package.json — say nothing rather than mislead
  }
  if (declared.length === 0) return [];

  const fileSet = new Set(
    Object.keys(files).filter((p) => CODE_FILE.test(p) && isAppAnalysisPath(p) && typeof files[p] === 'string'),
  );
  // Every bare-package name imported anywhere in the project.
  const importedPkgs = new Set<string>();
  for (const path of fileSet) {
    const src = stripForCycles(files[path]);
    let m: RegExpExecArray | null;
    CYCLE_IMPORT_RE.lastIndex = 0;
    while ((m = CYCLE_IMPORT_RE.exec(src)) !== null) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!spec) continue;
      if (spec.startsWith('.') || spec.startsWith('/')) continue; // local import — not a package
      const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
      if (NODE_BUILTINS.has(bare)) continue;
      importedPkgs.add(packageNameOf(bare));
    }
  }

  const provided = frameworkProvidedDeps(files, declared);
  const unused: UnusedDependency[] = [];
  for (const name of declared) {
    if (IMPLICIT_USE_DEPS.has(name)) continue;
    if (provided.has(name)) continue; // auto-provided by the meta-framework (Nuxt/SvelteKit) — not unused
    if (name.startsWith('@types/')) continue; // type-only, never statically imported
    if (commands.has(name)) continue; // run by the project's own scripts (`next dev`, `nodemon …`)
    if (!importedPkgs.has(name)) unused.push({ name });
  }
  return unused;
}
