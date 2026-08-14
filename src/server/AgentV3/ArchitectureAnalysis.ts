// AgentV3 — Architecture analysis (Phase 4, cat 22/26).
//
// Real static analysis over the project graph WorkspaceMemory already builds from
// actual file writes: import-cycle detection and unresolved local imports. These
// are concrete, real defects (a broken local import IS a build failure), found
// without needing a sandbox — so the team can evaluate and fix its own work even
// before a build runs. The legacy QualityEngine's evaluators assume a host file
// path and the wrong repo, so they cannot serve v5.0; this is the native version.

import path from 'path';
import type { ProjectGraph } from './WorkspaceMemory';
import { isComponentName } from './WorkspaceMemory';

export interface ArchitectureReport {
  fileCount: number;
  edgeCount: number;
  /** Import cycles among local modules, each as an ordered path of files. */
  cycles: string[][];
  /** Local imports that resolve to no known file ("file -> spec"). */
  unresolvedImports: string[];
  /** Front-end modules importing back-end modules ("file -> import"). */
  layeringViolations: string[];
  /** Front-end modules importing a server-only Node builtin ("file -> spec"). */
  nodeBuiltinsInFrontend: string[];
  /** Component files that were CREATED but are imported by NOTHING else ("file (ComponentName)") —
   *  the defect behind "the components exist but the app still shows the starter screen" (the entry/
   *  shell was never updated to import + render them). See findOrphanComponents(). */
  orphanComponents: string[];
}

const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Node core modules that have NO browser equivalent and are not polyfilled by
 * bundlers — importing one in front-end code breaks the build / crashes at runtime.
 * Deliberately conservative: commonly-polyfilled builtins (path, crypto, buffer,
 * stream, events, util, url, process) are excluded to keep precision high.
 */
const SERVER_ONLY_BUILTINS = new Set<string>([
  'fs', 'child_process', 'cluster', 'net', 'tls', 'dns', 'dgram',
  'worker_threads', 'v8', 'vm', 'readline', 'repl', 'inspector', 'module', 'os', 'http2',
  'async_hooks', 'diagnostics_channel', 'perf_hooks', 'trace_events',
]);

/** A client/front-end module by its path (src/client|components|pages|app, or App.tsx). */
function isFrontendFile(file: string): boolean {
  // Server-only files are NOT front-end even when they sit under an `app/`/`pages/` segment: Next.js
  // API routes (`(app|pages)/api/…`), App-Router route handlers (`route.ts`), `*.server.*` files, and
  // anything under a `server/` dir run ONLY on the server — importing `fs`/back-end modules there is
  // correct, so they must not be flagged as a browser-build-breaker or a layering violation.
  if (
    /(^|\/)(app|pages)\/api\//i.test(file) ||
    /(^|\/)route\.(t|j)sx?$/i.test(file) ||
    /\.server\.(t|j)sx?$/i.test(file) ||
    /(^|\/)server\//i.test(file)
  ) {
    return false;
  }
  return /(^|\/)(src\/)?(client|components|pages|app)\b/i.test(file) || /App\.(t|j)sx?$/.test(file);
}

/** Resolve a local import specifier (`./x`, `../y`, or the conventional `@/x` / `~/x` alias) to a
 *  known workspace file, or null. The alias forms map to the project source root — without them,
 *  alias-imported components (near-ubiquitous in Vite/Next/shadcn scaffolds) were resolved to null,
 *  so EVERY such component was falsely reported as an "orphan the app will never render". An unknown
 *  bare specifier (an npm package) is still null. */
export function resolveLocalImport(fromFile: string, spec: string, files: Set<string>): string | null {
  const bases: string[] = [];
  if (spec.startsWith('.')) {
    const baseDir = path.posix.dirname(fromFile);
    bases.push(path.posix.normalize(path.posix.join(baseDir, spec)).replace(/^\.\//, ''));
  } else {
    const alias = /^(?:@|~)\/(.+)$/.exec(spec);
    if (!alias) return null; // an npm package or unknown bare specifier — not a local file
    const rest = alias[1];
    // Derive the alias root from the IMPORTING file, so `@/` maps to the app's REAL source dir. A
    // FULLSTACK app keeps its frontend under `client/src/` (or `frontend/src/`, `apps/web/src/`, …), and
    // Vite/Next alias `@/` to THAT dir — not a top-level `src/`. Resolving only against `src/`/bare made
    // every `@/…` import in such an app falsely "unresolved" (e.g. `@/components/ui/button` from
    // `client/src/components/BackButton.tsx`), which blocked apps that build perfectly on the real bundler
    // — a false compile-failure. Take the importing file's own `…/src` prefix as the first base to try.
    const srcRoot = /^(.*?(?:^|\/)src)\//.exec(fromFile);
    if (srcRoot) bases.push(path.posix.normalize(srcRoot[1] + '/' + rest));
    // Then the top-level `src/`-rooted and bare forms, so it still works whether the workspace stores
    // `src/components/X` or `components/X`.
    bases.push(path.posix.normalize('src/' + rest), path.posix.normalize(rest));
  }
  for (const base of bases) {
    const candidates = [
      base,
      ...CODE_EXTS.map((e) => base + e),
      ...CODE_EXTS.map((e) => path.posix.join(base, 'index' + e)),
    ];
    // NodeNext/ESM TypeScript (SvelteKit, `"type":"module"`, `moduleResolution: NodeNext`): a relative
    // import carries the OUTPUT extension `.js`/`.jsx`/`.mjs`/`.cjs` but resolves to the `.ts`/`.tsx`/
    // `.mts`/`.cts` SOURCE — e.g. `import { Card } from './types.js'` resolves to `./types.ts`. Without
    // this, every such import was falsely "unresolved" → CollabDesk (SvelteKit) reported 19 unresolved
    // imports and 0/100 NOT READY even though every target `.ts` file existed. Swap the JS output
    // extension for its TS source extension(s) and also try the plain stem against CODE_EXTS.
    const jsExt = /\.(js|jsx|mjs|cjs)$/i.exec(base);
    if (jsExt) {
      const stem = base.slice(0, -jsExt[0].length);
      const tsExts = TS_SOURCE_FOR_JS[jsExt[1].toLowerCase()] ?? [];
      candidates.push(...tsExts.map((e) => stem + e), ...CODE_EXTS.map((e) => stem + e));
    }
    for (const c of candidates) if (files.has(c)) return c;
  }
  return null;
}

/** The TypeScript SOURCE extensions a given JS OUTPUT extension resolves to under NodeNext/ESM. */
const TS_SOURCE_FOR_JS: Record<string, string[]> = {
  js: ['.ts', '.tsx'],
  jsx: ['.tsx'],
  mjs: ['.mts'],
  cjs: ['.cts'],
};

/**
 * A component that was CREATED (a PascalCase component symbol exists in some .tsx/.jsx file) but is
 * imported by NOTHING else in the project — the exact real-world defect where separate component files
 * (Hero.tsx, Features.tsx, Footer.tsx, …) get generated yet the entry/shell (App.tsx) is never updated
 * to import and render them, so the live app keeps showing only its starter scaffold no matter how many
 * files exist. Reuses the graph's already-extracted symbols (no new parsing) and the SAME local-import
 * resolution as unresolvedImports/cycles above — one source of truth for "does this import resolve".
 * The entry points themselves (main/index/App) are excluded — they are roots BY DESIGN, not components
 * that need to be wired into something else. Returns each orphan as "file (ComponentName)", sorted.
 * PURE + exported + unit-testable.
 */
export function findOrphanComponents(graph: ProjectGraph): string[] {
  const files = new Set(graph.files);
  const importedFiles = new Set<string>();
  for (const [file, specs] of Object.entries(graph.imports)) {
    for (const spec of specs) {
      const resolved = resolveLocalImport(file, spec, files);
      if (resolved && resolved !== file) importedFiles.add(resolved);
    }
  }
  const isEntryPoint = (f: string): boolean =>
    /(^|\/)(main|index|App)\.(t|j)sx?$/i.test(f) ||
    // Scaffold-provided boilerplate is a root BY DESIGN, not an unused component. When the model
    // rewrites main.tsx and drops its `import ErrorBoundary`, the boundary is momentarily orphaned —
    // but it is ours, it is restored (scaffoldBoilerplate), and re-wired; flagging it as "created but
    // never used" is a false alarm that made real reports show a phantom unused component.
    /(^|\/)ErrorBoundary\.(t|j)sx?$/i.test(f) ||
    // Next.js App Router SPECIAL files (TaskForge autopsy 2026-07-18): layout/page/loading/error/
    // not-found/route/template/default/global-error under app/ are wired by Next by FILENAME convention
    // and never `import`-ed — so they are entry points, NOT "unused components". Without this, a clean
    // Next.js build false-flags all of them as orphans (readiness reported 14 phantom unused components).
    /(^|\/)app\/(?:.*\/)?(layout|page|loading|error|not-found|route|template|default|global-error)\.(t|j)sx?$/i.test(f);
  const orphans = new Set<string>();
  for (const sym of graph.symbols) {
    if (!isComponentName(sym.name)) continue;
    if (!/\.(t|j)sx$/.test(sym.file)) continue;
    if (isEntryPoint(sym.file)) continue;
    if (importedFiles.has(sym.file)) continue;
    orphans.add(`${sym.file} (${sym.name})`);
  }
  return [...orphans].sort();
}

/** Analyse the project graph for real architectural defects. */
export function analyzeArchitecture(graph: ProjectGraph): ArchitectureReport {
  const files = new Set(graph.files);
  const adjacency: Record<string, string[]> = {};
  const unresolvedImports: string[] = [];
  const layeringViolations: string[] = [];
  const nodeBuiltinsInFrontend: string[] = [];
  let edgeCount = 0;

  for (const [file, specs] of Object.entries(graph.imports)) {
    const edges: string[] = [];
    const frontend = isFrontendFile(file);
    for (const spec of specs) {
      if (!spec.startsWith('.')) {
        // External or Node builtin. A server-only builtin in front-end code breaks
        // the browser build, so flag it (otherwise an external dep is not local-graph).
        const root = spec.replace(/^node:/, '').split('/')[0];
        if (frontend && SERVER_ONLY_BUILTINS.has(root)) {
          nodeBuiltinsInFrontend.push(`${file} -> ${spec}`);
        }
        continue;
      }
      const resolved = resolveLocalImport(file, spec, files);
      if (!resolved) {
        unresolvedImports.push(`${file} -> ${spec}`);
        continue;
      }
      edges.push(resolved);
      edgeCount++;
      // Layering: a client/frontend module importing a server module is a violation.
      if (frontend && /(^|\/)(src\/)?server\b/i.test(resolved)) {
        layeringViolations.push(`${file} -> ${resolved}`);
      }
    }
    adjacency[file] = edges;
  }

  return {
    fileCount: graph.files.length,
    edgeCount,
    cycles: detectCycles(adjacency),
    unresolvedImports,
    layeringViolations,
    nodeBuiltinsInFrontend,
    orphanComponents: findOrphanComponents(graph),
  };
}

/** DFS cycle detection over the local-import adjacency. Returns each cycle once. */
function detectCycles(adjacency: Record<string, string[]>): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  const dfs = (node: string): void => {
    visited.add(node);
    inStack.add(node);
    stack.push(node);
    for (const next of adjacency[node] || []) {
      if (inStack.has(next)) {
        const cycle = stack.slice(stack.indexOf(next)).concat(next);
        const key = [...cycle].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!visited.has(next)) {
        dfs(next);
      }
    }
    inStack.delete(node);
    stack.pop();
  };

  for (const node of Object.keys(adjacency)) if (!visited.has(node)) dfs(node);
  return cycles;
}

/** A concise, honest text report for the agent (and the user). */
export function architectureSummary(report: ArchitectureReport): string {
  const problems = report.cycles.length + report.unresolvedImports.length + report.layeringViolations.length
    + report.nodeBuiltinsInFrontend.length + report.orphanComponents.length;
  const lines = [
    `Architecture analysis: ${report.fileCount} files, ${report.edgeCount} local import edges.`,
  ];
  if (report.unresolvedImports.length) {
    lines.push(`Unresolved local imports (${report.unresolvedImports.length}) — these will break the build:`);
    lines.push(...report.unresolvedImports.slice(0, 15).map((u) => `  - ${u}`));
  }
  if (report.cycles.length) {
    lines.push(`Import cycles (${report.cycles.length}):`);
    lines.push(...report.cycles.slice(0, 10).map((c) => `  - ${c.join(' -> ')}`));
  }
  if (report.layeringViolations.length) {
    lines.push(`Layering violations (front-end importing back-end) (${report.layeringViolations.length}):`);
    lines.push(...report.layeringViolations.slice(0, 10).map((v) => `  - ${v}`));
  }
  if (report.nodeBuiltinsInFrontend.length) {
    lines.push(`Server-only Node builtins imported by front-end code (${report.nodeBuiltinsInFrontend.length}) — these break the browser build:`);
    lines.push(...report.nodeBuiltinsInFrontend.slice(0, 10).map((v) => `  - ${v}`));
  }
  if (report.orphanComponents.length) {
    lines.push(`Orphan component(s) (${report.orphanComponents.length}) — created but never imported/rendered by anything else (the app will NOT show them):`);
    lines.push(...report.orphanComponents.slice(0, 15).map((v) => `  - ${v}`));
  }
  if (problems === 0) lines.push('No structural defects found (no unresolved imports, cycles, layering violations, browser-incompatible Node builtins, or orphan components).');
  return lines.join('\n');
}

/**
 * Generate a real ARCHITECTURE.md from the project graph (P-PIPE.112). Unlike the README's
 * "Project Structure" (which just counts files), this LEADS with the actual module dependency map —
 * the resolved local-import edges between the app's own files — plus the component/route inventory
 * and an honest "Structural notes" section (cycles / unresolved imports / layering / orphans). Purely
 * deterministic: everything is read from the graph + report, nothing invented. Pure, never throws.
 */
export function generateArchitectureDoc(graph: ProjectGraph, report: ArchitectureReport): string {
  const files = new Set(graph.files || []);
  const L: string[] = [];
  L.push('# Architecture');
  L.push('');
  L.push('_Auto-generated from the project\'s real module graph — the actual import edges between your files._');
  L.push('');

  // Resolve the real internal dependency edges (file -> local files it imports).
  const edges: Array<{ from: string; to: string[] }> = [];
  let edgeCount = 0;
  for (const [file, specs] of Object.entries(graph.imports || {})) {
    const local: string[] = [];
    for (const spec of specs || []) {
      const resolved = resolveLocalImport(file, spec, files);
      if (resolved && resolved !== file) local.push(resolved);
    }
    const unique = [...new Set(local)].sort();
    if (unique.length) { edges.push({ from: file, to: unique }); edgeCount += unique.length; }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from));

  L.push('## Overview');
  L.push(`- **${(graph.files || []).length}** source files, **${edges.length}** with internal imports, **${edgeCount}** internal edges`);
  L.push(`- **${(graph.components || []).length}** components, **${(graph.routes || []).length}** routes`);
  if ((graph.dependencies || []).length) {
    const deps = [...graph.dependencies].sort();
    const shown = deps.slice(0, 30).join(', ');
    L.push(`- **${deps.length}** external dependencies: ${shown}${deps.length > 30 ? ', …' : ''}`);
  }
  L.push('');

  L.push('## Module dependency map');
  if (!edges.length) {
    L.push('_No internal import edges yet (single-file app or imports not resolvable)._');
  } else {
    const MAX = 60;
    for (const e of edges.slice(0, MAX)) {
      L.push(`- \`${e.from}\` → ${e.to.map((t) => `\`${t}\``).join(', ')}`);
    }
    if (edges.length > MAX) L.push(`- …and ${edges.length - MAX} more files with imports.`);
  }
  L.push('');

  if ((graph.components || []).length) {
    L.push(`## Components (${graph.components.length})`);
    L.push([...graph.components].sort().slice(0, 80).map((c) => `\`${c}\``).join(', ') + (graph.components.length > 80 ? ', …' : ''));
    L.push('');
  }
  if ((graph.routes || []).length) {
    L.push(`## Routes (${graph.routes.length})`);
    L.push([...graph.routes].sort().slice(0, 60).map((r) => `\`${r}\``).join(', ') + (graph.routes.length > 60 ? ', …' : ''));
    L.push('');
  }

  L.push('## Structural notes');
  const note = (label: string, items: string[], max = 15) => {
    if (!items.length) { L.push(`- ${label}: none`); return; }
    L.push(`- ${label}: ${items.length}`);
    for (const it of items.slice(0, max)) L.push(`  - ${it}`);
    if (items.length > max) L.push(`  - …and ${items.length - max} more`);
  };
  note('Import cycles', report.cycles.map((c) => c.join(' → ')));
  note('Unresolved local imports', report.unresolvedImports);
  note('Layering violations (frontend → backend)', report.layeringViolations);
  note('Orphan components (built but imported nowhere)', report.orphanComponents);
  L.push('');
  L.push('_Structural notes are deterministic facts from the import graph — an empty list means none were found._');
  return L.join('\n') + '\n';
}
