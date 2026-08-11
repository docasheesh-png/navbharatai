/**
 * WHAT IS MY APP MADE OF? — the screen-by-screen structure of a generated app.
 *
 * ROADMAP §2 ("component tree panel"), verified absent before building.
 *
 * WHO THIS IS FOR, and why it is not an import graph. A developer reads the file list and knows the
 * shape of the app. The person NavBharatAI is built for opens `src/` and sees forty filenames. An
 * import graph would not help them either — it answers "what depends on what", a question they are
 * not asking. The question they ARE asking is "what screens does my app have, and what is on each
 * one?", so that is what this builds: screens at the top, the parts each screen uses underneath.
 *
 * DERIVED FROM THE FILES, NOT FROM A MODEL. Same reasoning as `fileRole`: an LLM pass would cost a
 * call, could be confidently wrong about code the user cannot read, and would not work when the panel
 * is opened on a project restored from history. Import statements are already the truth.
 *
 * ⚠️ RELATIVE IMPORTS ONLY. `react`, `lodash` and every other package are dependencies, not parts of
 * the app, and listing them would bury the four files the user actually wants under thirty they do
 * not. A tree that shows `react` under every screen is noise wearing the shape of information.
 */

import { fileRole, describeFile, type FileRole } from './fileRole';

export interface TreeNode {
  /** Workspace-relative path, e.g. `src/pages/Dashboard.tsx`. */
  path: string;
  /** Display name — the basename without its extension. */
  name: string;
  /** What kind of file this is, from the shared `fileRole` rules. */
  role: FileRole | null;
  /** The one-line plain-language label, or null when the path does not say. */
  label: string | null;
  /** The parts this file uses, already de-duplicated and depth-bounded. */
  children: TreeNode[];
  /** True when this node's subtree was cut short — the UI must say so rather than imply completeness. */
  truncated?: boolean;
  /** True when this file is already an ancestor of itself (a real import cycle, shown once). */
  cyclic?: boolean;
}

export interface ComponentTree {
  /** Screens (and the entry point) — the things a user recognises. */
  roots: TreeNode[];
  /** Files that are part of the app but reachable from no screen. Worth surfacing, not hiding. */
  orphans: TreeNode[];
  /** Total files considered, so the panel can say "showing N of M" honestly. */
  fileCount: number;
}

/** Depth beyond which a UI tree stops being readable. */
export const MAX_DEPTH = 4;
/** Hard ceiling on nodes, so a 2000-file import cannot hang the panel. */
export const MAX_NODES = 400;

const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte'];

const baseName = (p: string): string => (p.split('/').pop() || p).replace(/\.[^.]+$/, '');

/** Every relative import specifier in a file. Package imports are deliberately ignored — see header. */
export function relativeImports(source: string): string[] {
  const out: string[] = [];
  const push = (spec: string | undefined) => { if (spec && spec.startsWith('.')) out.push(spec); };
  // `import x from './y'` / `import './y'` / `export … from './y'`
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]/g)) push(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) push(m[1]);
  // `const x = await import('./y')` / `lazy(() => import('./y'))`
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1]);
  return [...new Set(out)];
}

/**
 * Resolve a relative specifier against the importing file, the way a bundler would: exact match, then
 * each known extension, then `/index.*`. Returns null when nothing in the workspace matches — a
 * missing file is a real state (a broken import), not something to invent a node for.
 */
export function resolveImport(fromPath: string, spec: string, files: Record<string, string>): string | null {
  const dir = fromPath.split('/').slice(0, -1);
  const parts = spec.split('/');
  const stack = [...dir];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  if (files[base] !== undefined) return base;
  for (const ext of EXTS) if (files[base + ext] !== undefined) return base + ext;
  for (const ext of EXTS) if (files[`${base}/index${ext}`] !== undefined) return `${base}/index${ext}`;
  return null;
}

const nodeFor = (path: string): TreeNode => ({
  path,
  name: baseName(path),
  role: fileRole(path),
  label: describeFile(path),
  children: [],
});

/** Roles that a user thinks of as "a screen" — the natural top of the tree. */
const ROOT_ROLES: ReadonlySet<FileRole> = new Set<FileRole>(['entry', 'page', 'layout']);

/**
 * Build the tree.
 *
 * Bounded on purpose: depth, node count, and cycles all terminate. An imported project can have
 * thousands of files, and a panel that hangs is worse than one that says "showing the first 400".
 */
export function buildComponentTree(files: Record<string, string>): ComponentTree {
  const source = files ?? {};
  const paths = Object.keys(source).filter((p) => EXTS.some((e) => p.endsWith(e)));
  let budget = MAX_NODES;

  const visitedAnywhere = new Set<string>();

  const walk = (path: string, ancestors: Set<string>, depth: number): TreeNode => {
    const node = nodeFor(path);
    visitedAnywhere.add(path);
    if (ancestors.has(path)) { node.cyclic = true; return node; }        // a real cycle, shown once
    if (depth >= MAX_DEPTH) { node.truncated = true; return node; }
    if (budget <= 0) { node.truncated = true; return node; }

    const nextAncestors = new Set(ancestors).add(path);
    const kids = relativeImports(source[path] ?? '')
      .map((spec) => resolveImport(path, spec, source))
      .filter((p): p is string => !!p && p !== path);

    for (const child of [...new Set(kids)]) {
      if (budget <= 0) { node.truncated = true; break; }
      budget -= 1;
      node.children.push(walk(child, nextAncestors, depth + 1));
    }
    return node;
  };

  // Screens first, then the entry point, then anything else that looks like a root.
  const rootPaths = paths
    .filter((p) => { const r = fileRole(p); return r !== null && ROOT_ROLES.has(r); })
    .sort((a, b) => {
      const rank = (p: string) => (fileRole(p) === 'entry' ? 0 : fileRole(p) === 'layout' ? 1 : 2);
      return rank(a) - rank(b) || a.localeCompare(b);
    });

  const roots = rootPaths.map((p) => walk(p, new Set(), 0));

  // Anything never reached from a screen. A user with an orphaned page wants to KNOW — that is usually
  // a screen they cannot get to, which is a real bug in their app, not a detail to hide.
  const orphans = paths
    .filter((p) => !visitedAnywhere.has(p))
    .filter((p) => { const r = fileRole(p); return r !== 'test' && r !== 'type' && r !== 'config'; })
    .sort()
    .slice(0, 50)
    .map((p) => nodeFor(p));

  return { roots, orphans, fileCount: paths.length };
}

/** Total nodes in a tree — so the panel can say "showing N of M files" without recounting by hand. */
export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}
