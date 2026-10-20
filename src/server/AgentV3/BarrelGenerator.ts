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

import { createExportCapabilities, emittedModuleSpecifier, EXPORT_CODE_FILE, resolveExportTarget } from './exportCapabilities';

export interface BarrelStub {
  /** Path of the index file to create (e.g. 'src/components/Icons/index.ts'). */
  path: string;
  /** The generated barrel content. */
  content: string;
  /** The names re-exported, for honest diagnostics. */
  exports: string[];
}

const CODE_FILE_RE = EXPORT_CODE_FILE;

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

  const capabilities = createExportCapabilities(files);

  const resolvesToFile = (base: string): boolean => resolveExportTarget('', `./${base}`, paths) !== null;
  const leavesUnder = (base: string): string[] => [...paths].filter((p) => p.startsWith(`${base}/`) && CODE_FILE_RE.test(p) && !/\/index\.[cm]?[jt]sx?$/i.test(p));
  const relLeaf = (base: string, leaf: string): string => {
    // Explicit module formats need their output extension: extensionless .mjs/.cjs imports
    // are not resolved by ordinary bundlers. Their TS counterparts use the same .mjs/.cjs
    // specifiers, which TypeScript and esbuild resolve back to .mts/.cts source.
    return `./${emittedModuleSpecifier(leaf.slice(base.length + 1))}`;
  };
  const baseName = (leaf: string): string => leaf.slice(leaf.lastIndexOf('/') + 1).replace(/\.[cm]?[jt]sx?$/i, '');

  // Combine all consumers BEFORE generating a barrel. Otherwise the first type-only consumer can
  // hide a later runtime request (or the first subset can silently omit another consumer's exports).
  const requested = new Map<string, Map<string, boolean>>();
  for (const [path, sf] of sources) {
    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue?.() ?? '';
      const base = resolveBase(path, spec, hasSrc);
      if (!base || resolvesToFile(base) || imp.getDefaultImport?.() || imp.getNamespaceImport?.()) continue;
      let names = requested.get(base);
      if (!names) { names = new Map(); requested.set(base, names); }
      for (const ni of imp.getNamedImports?.() ?? []) {
        const name = ni.getName();
        const local = ni.getAliasNode?.()?.getText() ?? name;
        const readsValue = capabilities.importsOf(path).some(b => b.from === spec && b.local === local && b.readsValue);
        names.set(name, !!names.get(name) || readsValue);
      }
    }
  }
  const stubs: BarrelStub[] = [];
  for (const [base, names] of requested) {
    const leaves = leavesUnder(base);
    if (!leaves.length || !names.size) continue;
    const lines: string[] = [];
    let allResolved = true;
    for (const [name, readsValue] of names) {
      const providers: Array<{ leaf: string; kind: 'named' | 'default'; typeOnly: boolean }> = [];
      for (const leaf of leaves) {
        const surface = capabilities.exportsOf(leaf);
        if (surface.uncertain) continue;
        const named = surface.exports.get(name);
        const cap = named ?? (baseName(leaf) === name ? surface.exports.get('default') : undefined);
        if (!cap || cap.runtime === 'unknown' || (readsValue && cap.runtime !== 'value')) continue;
        providers.push({ leaf, kind: named ? 'named' : 'default', typeOnly: cap.runtime === 'erased' });
      }
      if (providers.length !== 1) { allResolved = false; break; }
      const { leaf, kind, typeOnly } = providers[0];
      lines.push(`export ${typeOnly ? 'type ' : ''}{ ${kind === 'named' ? name : `default as ${name}`} } from '${relLeaf(base, leaf)}';`);
    }
    if (!allResolved) continue;
    const header = `// Auto-generated barrel for '${base}' — re-exports the folder's modules the app imports.\n`;
    stubs.push({ path: `${base}/index.ts`, content: `${header}${lines.sort().join('\n')}\n`, exports: [...names.keys()].sort() });
  }

  return stubs;
}
