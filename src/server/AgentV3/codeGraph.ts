// A1 (roadmap Tier 2A) — let the agent QUERY the repo's structure instead of prompt-stuffing it.
//
// WorkspaceMemory already indexes forward imports (file → specifiers) and symbol definitions, and the
// `recall` tool finds where a symbol is DEFINED. What was missing is the STRUCTURED reverse view the
// agent needs to edit safely: "who imports this file?" and "if I change X, what else is affected?".
// grep can't answer that — it finds text, not resolved import edges. These functions are PURE (they
// read a ProjectGraph); the ToolDispatcher `code_graph` tool wires them to the live workspace memory.

import { resolveLocalImport } from './ArchitectureAnalysis';
import type { ProjectGraph, SymbolInfo } from './WorkspaceMemory';

export interface ImportEdges {
  /** file → the LOCAL files it imports (resolved, bare/npm specifiers dropped). */
  forward: Map<string, Set<string>>;
  /** file → the LOCAL files that import it (the reverse of `forward`). */
  reverse: Map<string, Set<string>>;
}

/** Resolve every local import in the graph into concrete file→file edges (both directions). Pure. */
export function buildImportEdges(graph: ProjectGraph): ImportEdges {
  const files = new Set(graph.files);
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, k: string, v: string) => {
    let s = map.get(k);
    if (!s) { s = new Set(); map.set(k, s); }
    s.add(v);
  };
  for (const [from, specs] of Object.entries(graph.imports ?? {})) {
    for (const spec of specs) {
      const to = resolveLocalImport(from, spec, files);
      if (!to || to === from) continue; // npm/unknown specifier, or self-import
      add(forward, from, to);
      add(reverse, to, from);
    }
  }
  return { forward, reverse };
}

/**
 * Resolve a user/agent-supplied path to a real indexed file. Accepts an exact match or a unique
 * suffix match (so "App.tsx" finds "src/App.tsx"). Returns null on no match OR an ambiguous suffix.
 */
export function resolveGraphFile(graph: ProjectGraph, target: string): string | null {
  const t = target.trim().replace(/^\.?\//, '');
  if (graph.files.includes(t)) return t;
  const suffixHits = graph.files.filter(f => f === t || f.endsWith('/' + t));
  return suffixHits.length === 1 ? suffixHits[0] : null;
}

const sorted = (s: Set<string> | undefined): string[] => (s ? [...s].sort() : []);

/** Direct importers of `file` — the files that would be affected by changing its exports. Pure. */
export function whoImports(graph: ProjectGraph, file: string): string[] {
  return sorted(buildImportEdges(graph).reverse.get(file));
}

/** Direct LOCAL dependencies of `file` — the in-repo files it imports. Pure. */
export function dependenciesOf(graph: ProjectGraph, file: string): string[] {
  return sorted(buildImportEdges(graph).forward.get(file));
}

/**
 * Transitive change-impact of `file`: every file that reaches it through the import graph (its
 * direct + indirect importers). BFS over the reverse edges; excludes the file itself; cycle-safe. Pure.
 */
export function impactOf(graph: ProjectGraph, file: string): string[] {
  const { reverse } = buildImportEdges(graph);
  const seen = new Set<string>();
  const queue: string[] = [...(reverse.get(file) ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === file || seen.has(cur)) continue;
    seen.add(cur);
    for (const importer of reverse.get(cur) ?? []) {
      if (!seen.has(importer) && importer !== file) queue.push(importer);
    }
  }
  return [...seen].sort();
}

/** Where a symbol is defined (exact name match across the indexed symbols). Pure. */
export function definitionsOf(graph: ProjectGraph, symbolName: string): SymbolInfo[] {
  const name = symbolName.trim();
  return (graph.symbols ?? []).filter(s => s.name === name);
}
