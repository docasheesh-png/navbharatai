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
  for (const idx of INDEXES) {
    const cand = normalizePath(base + idx);
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

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
