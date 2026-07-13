// AgentV3 — deterministic barrel (index) generator.
//
// WHY (Kanban build autopsy 2026-07-13, and a ubiquitous React pattern): the generator writes leaf modules
// under a folder (e.g. src/components/Icons/CalendarIcon.tsx) and then imports them through a BARREL that it
// forgets to create — `import { CalendarIcon } from '../components/Icons'`. The folder has the leaves, but
// `Icons/index.ts` was never written, so the import fails and the whole build breaks. When the leaves that
// export the imported names ALREADY EXIST, the barrel is 100% DETERMINISTIC: re-export each imported name
// from the (unique) leaf that provides it — no LLM step, no guessing. This completes the missing-local-module
// trilogy (CSS modules + wrong-source imports + barrels) and frees the bounded repair budget for real gaps.
//
// Paranoid-safe: only re-exports a name provided by EXACTLY ONE leaf under the folder (ambiguous → skip),
// only NAMED imports (never default/namespace), only when the barrel target is a real folder with leaves and
// no existing index, and only when EVERY imported name resolves (a partial barrel would still break). Pure;
// never throws — any parse/library problem yields no barrels.

export interface BarrelStub {
  /** Path of the index file to create (e.g. 'src/components/Icons/index.ts'). */
  path: string;
  /** The generated barrel content. */
  content: string;
  /** The names re-exported, for honest diagnostics. */
  exports: string[];
}

const CODE_FILE_RE = /\.(?:m?[jt]sx?)$/i;
const RESOLVE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

function normalizeRelPath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

/** Resolve a relative / `@/` import to a project base path (no extension). Null for bare packages. */
function resolveBase(importer: string, spec: string, hasSrc: boolean): string | null {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
    return normalizeRelPath(`${dir}/${spec}`);
  }
  if (spec.startsWith('@/') && hasSrc) return normalizeRelPath(`src/${spec.slice(2)}`);
  return null;
}

interface LeafExports { named: Set<string>; hasDefault: boolean; }

/**
 * For every folder-barrel import (`import { A, B } from '.../Icons'`) that does NOT resolve but whose folder
 * contains leaf files exporting A and B, generate `.../Icons/index.ts` re-exporting them. Pure; never throws.
 */
export async function generateMissingBarrels(files: Record<string, string>): Promise<BarrelStub[]> {
  if (!files || typeof files !== 'object') return [];
  const mod = await loadTsMorph();
  if (!mod) return [];

  let project: any;
  try {
    project = new mod.Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true, jsx: 2 } });
  } catch { return []; }

  const paths = new Set(Object.keys(files));
  const hasSrc = [...paths].some((p) => p === 'src' || p.startsWith('src/'));
  const sources = new Map<string, any>();
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE_RE.test(path) || typeof content !== 'string') continue;
    try { sources.set(path, project.createSourceFile(path, content, { overwrite: true })); } catch { /* skip */ }
  }
  if (sources.size === 0) return [];

  const exportsOf = (path: string): LeafExports => {
    const shape: LeafExports = { named: new Set(), hasDefault: false };
    const sf = sources.get(path);
    if (!sf) return shape;
    try {
      const decls: Map<string, any[]> = sf.getExportedDeclarations?.() ?? new Map();
      for (const name of decls.keys()) {
        if (name === 'default') shape.hasDefault = true;
        else shape.named.add(name);
      }
    } catch { /* unreadable → empty */ }
    return shape;
  };

  const resolvesToFile = (base: string): boolean => RESOLVE_SUFFIXES.some((s) => paths.has(base + s));
  const leavesUnder = (base: string): string[] => [...paths].filter((p) => p.startsWith(`${base}/`) && CODE_FILE_RE.test(p) && !/\/index\.(m?[jt]sx?)$/i.test(p));
  const relLeaf = (base: string, leaf: string): string => `./${leaf.slice(base.length + 1).replace(/\.(m?[jt]sx?)$/i, '')}`;
  const baseName = (leaf: string): string => leaf.slice(leaf.lastIndexOf('/') + 1).replace(/\.(m?[jt]sx?)$/i, '');

  const stubs: BarrelStub[] = [];
  const seenBarrel = new Set<string>();

  for (const [path, sf] of sources) {
    let imports: any[];
    try { imports = sf.getImportDeclarations(); } catch { continue; }
    for (const imp of imports) {
      let spec = '';
      try { spec = imp.getModuleSpecifierValue?.() ?? ''; } catch { continue; }
      const base = resolveBase(path, spec, hasSrc);
      if (!base || seenBarrel.has(base) || resolvesToFile(base)) continue; // resolves already, or not local
      // Only NAMED imports; a default/namespace barrel isn't deterministically buildable.
      let hasDefaultOrNs = false;
      try { hasDefaultOrNs = !!imp.getDefaultImport?.() || !!imp.getNamespaceImport?.(); } catch { /* ignore */ }
      if (hasDefaultOrNs) continue;
      let named: string[];
      try { named = (imp.getNamedImports?.() ?? []).map((n: any) => n.getName?.()).filter(Boolean); } catch { continue; }
      if (named.length === 0) continue;
      const leaves = leavesUnder(base);
      if (leaves.length === 0) continue; // no folder / no leaves → genuinely missing, not a barrel

      // Map each imported name to the unique leaf that provides it.
      const lines: string[] = [];
      const exported: string[] = [];
      let allResolved = true;
      for (const name of named) {
        const providers: Array<{ leaf: string; kind: 'named' | 'default' }> = [];
        for (const leaf of leaves) {
          const ex = exportsOf(leaf);
          if (ex.named.has(name)) providers.push({ leaf, kind: 'named' });
          else if (ex.hasDefault && baseName(leaf) === name) providers.push({ leaf, kind: 'default' });
        }
        if (providers.length !== 1) { allResolved = false; break; } // ambiguous or absent → don't guess
        const { leaf, kind } = providers[0];
        lines.push(kind === 'named'
          ? `export { ${name} } from '${relLeaf(base, leaf)}';`
          : `export { default as ${name} } from '${relLeaf(base, leaf)}';`);
        exported.push(name);
      }
      if (!allResolved) continue;

      seenBarrel.add(base);
      const header = `// Auto-generated barrel for '${base}' — re-exports the folder's modules the app imports.\n`;
      stubs.push({ path: `${base}/index.ts`, content: `${header}${lines.sort().join('\n')}\n`, exports: exported.sort() });
    }
  }
  return stubs;
}
