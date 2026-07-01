// AgentV3 — Architecture analysis (Phase 4, cat 22/26).
//
// Real static analysis over the project graph WorkspaceMemory already builds from
// actual file writes: import-cycle detection and unresolved local imports. These
// are concrete, real defects (a broken local import IS a build failure), found
// without needing a sandbox — so the team can evaluate and fix its own work even
// before a build runs. The legacy QualityEngine's evaluators assume a host file
// path and the wrong repo, so they cannot serve v3.0; this is the native version.

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
  return /(^|\/)(src\/)?(client|components|pages|app)\b/i.test(file) || /App\.(t|j)sx?$/.test(file);
}

/** Resolve a local import specifier (./x, ../y) to a known workspace file, or null. */
export function resolveLocalImport(fromFile: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith('.')) return null; // not a local import
  const baseDir = path.posix.dirname(fromFile);
  const target = path.posix.normalize(path.posix.join(baseDir, spec)).replace(/^\.\//, '');
  const candidates = [
    target,
    ...CODE_EXTS.map((e) => target + e),
    ...CODE_EXTS.map((e) => path.posix.join(target, 'index' + e)),
  ];
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

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
  const isEntryPoint = (f: string): boolean => /(^|\/)(main|index|App)\.(t|j)sx?$/i.test(f);
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
