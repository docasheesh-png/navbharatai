// GA-18-adjacent (roadmap Tier 2) — find UNWIRED / dead code files: modules the project built but never
// imports. A very common AI-codegen mistake is "created UserCard.tsx / useAuth.ts and forgot to wire it
// in" — it compiles, but the feature never appears. This surfaces those built-but-forgotten files.
//
// PURE: reuses the A1 import edges (buildImportEdges) — a file is a candidate when NOTHING imports it AND
// it isn't a legitimate root (an entry, a test, a config, a type decl, a story, or a file-based route,
// which are all rendered/run without being imported). Advisory by design: dynamic imports and string
// references can't be seen here, so results are "verify before deleting", never an auto-delete.

import type { ProjectGraph } from './WorkspaceMemory';
import { buildImportEdges } from './codeGraph';

const isCode = (f: string): boolean => /\.(t|j)sx?$/.test(f);

// Roots that run/render WITHOUT being imported — never "dead" just because nothing imports them.
const isEntry = (f: string): boolean =>
  /(^|\/)(main|index|app|server|entry|bootstrap|_app|_document|middleware)\.(t|j)sx?$/i.test(f);
const isTest = (f: string): boolean =>
  /\.(test|spec)\.[tj]sx?$/.test(f) || /(^|\/)(__tests__|__mocks__)\//.test(f);
const isConfig = (f: string): boolean =>
  /\.config\.[cm]?[tj]s$/.test(f) ||
  /(^|\/)(vite|vitest|jest|tailwind|postcss|next|nuxt|svelte|astro|rollup|webpack|babel|eslint|prettier|playwright|cypress)\.config\./i.test(f);
const isDecl = (f: string): boolean => /\.d\.ts$/.test(f);
const isStory = (f: string): boolean => /\.stories\.[tj]sx?$/.test(f);
// File-based routing: files under pages/ app/ routes/ are entry points by convention (Next/Nuxt/SvelteKit/Remix).
const isRoute = (f: string): boolean => /(^|\/)(pages|app|routes)\//.test(f);
// Setup/registration files are often imported only by config or side-effect.
const isSetupName = (f: string): boolean =>
  /(^|\/)(setupTests|setup|vite-env|env|global|globals|polyfill[s]?|register.*|serviceWorker|sw|reportWebVitals)\.(t|j)sx?$/i.test(f);

/**
 * Files that nothing imports and that aren't legitimate roots — candidate unwired/dead modules. Pure.
 * Conservative: excludes entries, tests, configs, type decls, stories, file-based routes and setup files
 * to keep precision high (a flagged file is very likely genuinely unused). Sorted.
 */
export function findUnwiredFiles(graph: ProjectGraph): string[] {
  const codeFiles = (graph.files ?? []).filter(isCode);
  const { reverse } = buildImportEdges(graph);
  return codeFiles
    .filter(f => (reverse.get(f)?.size ?? 0) === 0)
    .filter(f => !isEntry(f) && !isTest(f) && !isConfig(f) && !isDecl(f) && !isStory(f) && !isRoute(f) && !isSetupName(f))
    .sort();
}

/** One-line + list summary. Pure. */
export function unwiredFilesSummary(files: string[]): string {
  if (!files.length) {
    return 'find_dead_code: no unwired modules found — every non-entry file is imported somewhere.';
  }
  return (
    `find_dead_code: ${files.length} file(s) that NOTHING imports (built but not wired in — verify each is ` +
    `truly unused before deleting; dynamic imports / string references are not visible here):\n` +
    files.map(f => `  ${f}`).join('\n')
  );
}
