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
  const problems = report.cycles.length + report.unresolvedImports.length + report.layeringViolations.length + report.nodeBuiltinsInFrontend.length;
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
  if (problems === 0) lines.push('No structural defects found (no unresolved imports, cycles, layering violations or browser-incompatible Node builtins).');
  return lines.join('\n');
}
