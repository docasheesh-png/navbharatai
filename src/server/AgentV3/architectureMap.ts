// A2 (roadmap Tier 2A) — auto architecture-onboarding: a concise "how is this app structured / where do
// I start" map the agent reads BEFORE editing an unfamiliar or imported codebase, so big-app edits are
// deliberate, not blind. Distinct from generate_architecture_docs (which writes an ARCHITECTURE.md defect
// report): this is a cheap, read-only ORIENTATION derived from the same A1 import graph.
//
// PURE — operates only on the indexed ProjectGraph (reusing the A1 import edges). The ToolDispatcher
// `architecture_map` tool renders it inline for the agent.

import type { ProjectGraph } from './WorkspaceMemory';
import { buildImportEdges } from './codeGraph';

export interface HubFile {
  file: string;
  /** How many files import it — high in-degree = a core module to understand first. */
  importedBy: number;
}

export interface ArchitectureArea {
  /** Top-level-ish directory (up to 2 path segments), e.g. "src/components". */
  dir: string;
  fileCount: number;
}

export interface ArchitectureMap {
  totalFiles: number;
  totalComponents: number;
  totalRoutes: number;
  /** Roots nothing imports — the app's entry points (real entries ranked first). */
  entryPoints: string[];
  /** The most-imported files, highest first — the core modules. */
  hubs: HubFile[];
  /** Structural areas by directory, largest first. */
  areas: ArchitectureArea[];
  /** Top external (npm) dependencies. */
  externalDeps: string[];
}

const isCode = (f: string): boolean => /\.(t|j)sx?$/.test(f);
// Files that are roots BY DESIGN (an app entry) rather than dead code.
const isEntryName = (f: string): boolean =>
  /(^|\/)(main|index|app|server|entry|bootstrap)\.(t|j)sx?$/i.test(f);

/** Group a path into a "src/components"-style area key (first two segments, or the dir for shallow files). */
function areaOf(file: string): string {
  const parts = file.split('/');
  if (parts.length <= 1) return '(root)';
  if (parts.length === 2) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

/** Build the orientation map from the indexed project graph. Pure. */
export function buildArchitectureMap(graph: ProjectGraph, limit = 8): ArchitectureMap {
  const codeFiles = (graph.files ?? []).filter(isCode);
  const { reverse } = buildImportEdges(graph);

  // Entry points: code files nothing imports. Real entry-named files first, then the rest, capped.
  const roots = codeFiles.filter(f => (reverse.get(f)?.size ?? 0) === 0);
  const entryPoints = [
    ...roots.filter(isEntryName).sort(),
    ...roots.filter(f => !isEntryName(f)).sort(),
  ].slice(0, limit);

  // Hubs: most-imported files (by in-degree), highest first.
  const hubs: HubFile[] = codeFiles
    .map(f => ({ file: f, importedBy: reverse.get(f)?.size ?? 0 }))
    .filter(h => h.importedBy > 0)
    .sort((a, b) => b.importedBy - a.importedBy || a.file.localeCompare(b.file))
    .slice(0, limit);

  // Areas: file counts by directory grouping, largest first.
  const areaCounts = new Map<string, number>();
  for (const f of codeFiles) areaCounts.set(areaOf(f), (areaCounts.get(areaOf(f)) ?? 0) + 1);
  const areas: ArchitectureArea[] = [...areaCounts.entries()]
    .map(([dir, fileCount]) => ({ dir, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount || a.dir.localeCompare(b.dir));

  return {
    totalFiles: codeFiles.length,
    totalComponents: (graph.components ?? []).length,
    totalRoutes: (graph.routes ?? []).length,
    entryPoints,
    hubs,
    areas,
    externalDeps: [...(graph.dependencies ?? [])].sort().slice(0, 15),
  };
}

/** Render the map as a concise, agent-readable orientation with a suggested reading order. Pure. */
export function renderArchitectureMap(map: ArchitectureMap): string {
  if (map.totalFiles === 0) return 'architecture_map: no source files indexed yet — nothing to map.';
  const lines: string[] = [];
  lines.push(`App structure — ${map.totalFiles} code files, ${map.totalComponents} components, ${map.totalRoutes} routes.`);
  lines.push(`Entry points: ${map.entryPoints.length ? map.entryPoints.join(', ') : '(none detected)'}`);
  lines.push(
    'Core modules (most imported): ' +
    (map.hubs.length ? map.hubs.map(h => `${h.file} (${h.importedBy})`).join(', ') : '(none)'),
  );
  lines.push('Areas: ' + map.areas.slice(0, 10).map(a => `${a.dir} (${a.fileCount})`).join(', '));
  if (map.externalDeps.length) lines.push('Key dependencies: ' + map.externalDeps.join(', '));
  lines.push('Suggested reading order: entry points first, then the core modules above, then the area you need to change.');
  return lines.join('\n');
}
