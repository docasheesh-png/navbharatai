// AgentV3 — Import/Export consistency analyzer (build-robustness evaluator).
//
// Catches a top cause of HARD build failures in generated apps: an import of a named (or default)
// binding that the target local module does NOT actually export — e.g. `import { Foo } from './bar'`
// when bar.tsx never exports `Foo`. Bundlers fail with "'Foo' is not exported by './bar'" (or the
// value is silently `undefined` at runtime), breaking the app. The existing HallucinationDetector only
// verifies that the imported FILE exists (`unresolved-local-import`); it never checks that the named
// bindings match — so this closes a real, distinct gap.
//
// It is exact (symbol-level, via ts-morph) and conservative: it only checks imports that resolve to a
// known LOCAL file, skips modules that use `export *` (a wildcard re-export could legitimately provide
// the name), and never touches node_modules. That keeps false positives near zero.

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

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

const CODE_FILE = /\.(t|j)sx?$/;
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const INDEXES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/** Normalize a POSIX-style path, collapsing `.` and `..` segments. */
function normalizePath(p: string): string {
  const parts = p.split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Resolve a relative import specifier to an actual key in the file set (or null). */
export function resolveLocalTarget(importer: string, spec: string, fileSet: Set<string>): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const base = normalizePath(`${dirname(importer)}/${spec}`);
  for (const ext of EXTS) {
    const cand = normalizePath(base + ext);
    if (fileSet.has(cand)) return cand;
  }
  // NodeNext/ESM TypeScript: a `.js`/`.jsx`/`.mjs`/`.cjs` import resolves to the `.ts`/`.tsx`/`.mts`/`.cts`
  // SOURCE (SvelteKit — CollabDesk autopsy). Swap the JS output extension for its TS source before giving
  // up, so a correct `./types.js` → `types.ts` import is neither falsely flagged nor wrongly "reconciled".
  const jsExt = /\.(js|jsx|mjs|cjs)$/i.exec(base);
  if (jsExt) {
    const stem = base.slice(0, -jsExt[0].length);
    for (const ext of [...(TS_SOURCE_FOR_JS_EXT[jsExt[1].toLowerCase()] ?? []), ...EXTS]) {
      const cand = normalizePath(stem + ext);
      if (fileSet.has(cand)) return cand;
    }
  }
  for (const idx of INDEXES) {
    const cand = normalizePath(base + idx);
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

/** TypeScript SOURCE extensions a JS OUTPUT extension resolves to under NodeNext/ESM (SvelteKit). */
const TS_SOURCE_FOR_JS_EXT: Record<string, string[]> = { js: ['.ts', '.tsx'], jsx: ['.tsx'], mjs: ['.mts'], cjs: ['.cts'] };

interface ExportInfo { names: Set<string>; hasDefault: boolean; hasWildcard: boolean; parseFailed: boolean; }

/** Analyze a file set for named/default imports that the target module does not export. Pure. */
export async function analyzeImportExports(files: Record<string, string>): Promise<ImportExportReport> {
  const counts: Record<ImportMismatchKind, number> = { 'named-import-not-exported': 0, 'default-import-missing': 0 };
  const empty: ImportExportReport = { mismatches: [], filesScanned: 0, counts, ok: true };

  const mod = await loadTsMorph();
  if (!mod) return empty;

  const project = new mod.Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 2 },
  });

  // Add every code file up front so cross-file export resolution (barrels/re-exports) works.
  const sources = new Map<string, any>();
  const fileSet = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE.test(path) || typeof content !== 'string') continue;
    fileSet.add(path);
    try { sources.set(path, project.createSourceFile(path, content, { overwrite: true })); } catch { /* skip */ }
  }

  const exportCache = new Map<string, ExportInfo>();
  const exportsOf = (path: string): ExportInfo => {
    const cached = exportCache.get(path);
    if (cached) return cached;
    const info: ExportInfo = { names: new Set(), hasDefault: false, hasWildcard: false, parseFailed: false };
    const sf = sources.get(path);
    if (!sf) { info.parseFailed = true; exportCache.set(path, info); return info; }
    try {
      // `export * from './x'` — a wildcard re-export could supply any name; mark uncertain.
      for (const ed of sf.getExportDeclarations?.() ?? []) {
        if (ed.isNamespaceExport?.()) info.hasWildcard = true;
      }
      const decls: Map<string, unknown> = sf.getExportedDeclarations?.() ?? new Map();
      for (const name of decls.keys()) {
        if (name === 'default') info.hasDefault = true;
        else info.names.add(name);
      }
    } catch {
      info.parseFailed = true;
    }
    exportCache.set(path, info);
    return info;
  };

  const mismatches: ImportMismatch[] = [];

  for (const [path, sf] of sources) {
    let imports: any[];
    try { imports = sf.getImportDeclarations(); } catch { continue; }
    for (const imp of imports) {
      let spec = '';
      try { spec = imp.getModuleSpecifierValue?.() ?? ''; } catch { continue; } // malformed import — skip
      const target = resolveLocalTarget(path, spec, fileSet);
      if (!target) continue; // external pkg or unresolved file (HallucinationDetector's job)
      const info = exportsOf(target);
      if (info.parseFailed || info.hasWildcard) continue; // can't be certain — stay silent
      const line: number = imp.getStartLineNumber?.() ?? 0;

      const def = imp.getDefaultImport?.();
      if (def && !info.hasDefault) {
        counts['default-import-missing']++;
        mismatches.push({
          file: path, line, imported: def.getText?.() ?? 'default', from: spec,
          kind: 'default-import-missing',
          detail: `Default import from '${spec}', but that module has no default export.`,
        });
      }

      for (const ni of imp.getNamedImports?.() ?? []) {
        // getName() is the SOURCE name (before `as`), which is what must be exported.
        const name: string = ni.getName?.() ?? '';
        if (!name) continue;
        if (!info.names.has(name)) {
          counts['named-import-not-exported']++;
          mismatches.push({
            file: path, line, imported: name, from: spec,
            kind: 'named-import-not-exported',
            detail: `'${name}' is imported from '${spec}', but that module does not export it.`,
          });
        }
      }
    }
  }

  return { mismatches, filesScanned: sources.size, counts, ok: mismatches.length === 0 };
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
    Object.keys(files).filter((p) => CODE_FILE.test(p) && typeof files[p] === 'string'),
  );
  // Adjacency: file → sorted unique local import targets (deterministic traversal).
  const adj = new Map<string, string[]>();
  for (const path of fileSet) {
    const src = stripForCycles(files[path]);
    const targets = new Set<string>();
    let m: RegExpExecArray | null;
    CYCLE_IMPORT_RE.lastIndex = 0;
    while ((m = CYCLE_IMPORT_RE.exec(src)) !== null) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!spec) continue;
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
  try {
    const pkg = JSON.parse(pkgRaw);
    const deps = pkg && typeof pkg === 'object' ? pkg.dependencies : null;
    if (!deps || typeof deps !== 'object') return [];
    declared = Object.keys(deps);
  } catch {
    return []; // malformed package.json — say nothing rather than mislead
  }
  if (declared.length === 0) return [];

  const fileSet = new Set(
    Object.keys(files).filter((p) => CODE_FILE.test(p) && typeof files[p] === 'string'),
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
    if (!importedPkgs.has(name)) unused.push({ name });
  }
  return unused;
}
