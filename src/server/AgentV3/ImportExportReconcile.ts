// AgentV3 — Import/Export RECONCILER (deterministic self-heal for the #1 recurring generator bug).
//
// WHY THIS EXISTS (root cause, admin build reports fae70e42 / Notes / Car / Watch): v3.0 repeatedly
// generates TEST files (and occasionally source files) that import a component with the WRONG import
// KIND — a NAMED import for a DEFAULT-exported component, e.g.
//     src/App.test.tsx:  import { App } from './App'      // App.tsx does `export default App`
// The readiness gate (ImportExportAnalysis) correctly flags this as a build-breaking "broken import",
// so the build ends NOT READY (ok:false) — but nothing ever FIXES it, because in an edit turn the
// agent's intent was elsewhere and these files are never revisited. The user is left with a failed
// verdict on an otherwise-working app.
//
// This module is the deterministic cure: when the fix is UNAMBIGUOUS — the imported binding is not
// exported the way it was imported, but the SAME name IS exported the OTHER way — rewrite the import
// to the correct kind. It is intent-preserving (the developer clearly wanted that binding; only the
// syntax was wrong) and conservative to the point of paranoia: it only acts when the exact name
// matches an export of the opposite kind, never guesses, never renames, and skips anything it cannot
// prove safe (namespace imports, wildcard re-exports, parse failures, aliased/anonymous cases).

import { analyzeImportExports, resolveLocalTarget } from './ImportExportAnalysis';

export type ReconcileKind = 'named-to-default' | 'default-to-named';

export interface ReconcileFix {
  file: string;
  line: number;
  name: string;
  from: string;
  kind: ReconcileKind;
  before: string;
  after: string;
}

export interface ReconcileResult {
  /** The file set with every safe reconciliation applied (unchanged files are returned as-is). */
  files: Record<string, string>;
  /** Every fix applied, for honest diagnostics. Empty when nothing was safely reconcilable. */
  fixes: ReconcileFix[];
}

const CODE_FILE = /\.(t|j)sx?$/;

let TsMorph: any;
async function loadTsMorph(): Promise<any | null> {
  if (TsMorph) return TsMorph;
  try { TsMorph = await import('ts-morph'); return TsMorph; } catch { return null; }
}

interface ExportShape {
  /** Local names of named exports. */
  named: Set<string>;
  /** The local identifier name of the default export, if it has one (anonymous default -> null). */
  defaultName: string | null;
  hasDefault: boolean;
  hasWildcard: boolean;
  parseFailed: boolean;
}

/**
 * Deterministically repair unambiguous named/default import mismatches across a file set.
 *
 * Returns the corrected files plus the list of applied fixes. Pure and never throws — on any parse
 * or library problem it returns the input files unchanged with an empty fix list, so it can only ever
 * make a broken build better, never a working build worse.
 */
export async function reconcileImportExports(files: Record<string, string>): Promise<ReconcileResult> {
  const unchanged: ReconcileResult = { files, fixes: [] };
  const mod = await loadTsMorph();
  if (!mod) return unchanged;

  let project: any;
  try {
    project = new mod.Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true, jsx: 2 },
    });
  } catch { return unchanged; }

  const sources = new Map<string, any>();
  const fileSet = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE.test(path) || typeof content !== 'string') continue;
    fileSet.add(path);
    try { sources.set(path, project.createSourceFile(path, content, { overwrite: true })); } catch { /* skip */ }
  }
  if (sources.size === 0) return unchanged;

  const shapeCache = new Map<string, ExportShape>();
  const shapeOf = (path: string): ExportShape => {
    const cached = shapeCache.get(path);
    if (cached) return cached;
    const shape: ExportShape = { named: new Set(), defaultName: null, hasDefault: false, hasWildcard: false, parseFailed: false };
    const sf = sources.get(path);
    if (!sf) { shape.parseFailed = true; shapeCache.set(path, shape); return shape; }
    try {
      for (const ed of sf.getExportDeclarations?.() ?? []) {
        if (ed.isNamespaceExport?.()) shape.hasWildcard = true;
      }
      const decls: Map<string, any[]> = sf.getExportedDeclarations?.() ?? new Map();
      for (const [name, declArr] of decls) {
        if (name === 'default') {
          shape.hasDefault = true;
          // Derive the default export's local identifier name when it has one (named function/class/
          // variable). Anonymous defaults leave defaultName null -> we skip them.
          for (const d of declArr ?? []) {
            const n = d?.getName?.();
            if (typeof n === 'string' && n) { shape.defaultName = n; break; }
          }
        } else {
          shape.named.add(name);
        }
      }
    } catch {
      shape.parseFailed = true;
    }
    shapeCache.set(path, shape);
    return shape;
  };

  const fixes: ReconcileFix[] = [];
  const touched = new Set<string>();

  for (const [path, sf] of sources) {
    let imports: any[];
    try { imports = sf.getImportDeclarations(); } catch { continue; }
    for (const imp of imports) {
      let spec = '';
      try { spec = imp.getModuleSpecifierValue?.() ?? ''; } catch { continue; }
      const target = resolveLocalTarget(path, spec, fileSet);
      if (!target) continue;
      const shape = shapeOf(target);
      if (shape.parseFailed || shape.hasWildcard) continue; // never act on uncertainty

      // A namespace import cannot be reconciled to a named/default binding — skip the whole statement.
      let hasNamespace = false;
      try { hasNamespace = !!imp.getNamespaceImport?.(); } catch { /* ignore */ }
      if (hasNamespace) continue;

      const line: number = (() => { try { return imp.getStartLineNumber?.() ?? 0; } catch { return 0; } })();
      const before = (() => { try { return imp.getText?.() ?? ''; } catch { return ''; } })();

      // Read the whole import clause, then rewrite the statement via replaceWithText — building the
      // text ourselves is fully deterministic and avoids ts-morph's structure quirks (set() with an
      // empty namedImports array leaves a stray "{ }"). Quote style + type-only-ness are preserved by
      // reusing the original module-specifier node text and the isTypeOnly flag.
      let defName = '';
      try { defName = imp.getDefaultImport?.()?.getText?.() ?? ''; } catch { defName = ''; }
      const named: Array<{ name: string; alias?: string }> = [];
      try {
        for (const ni of imp.getNamedImports?.() ?? []) {
          const n = ni.getName?.() ?? '';
          const a = ni.getAliasNode?.()?.getText?.();
          if (n) named.push(a ? { name: n, alias: a } : { name: n });
        }
      } catch { /* ignore — treated as no named imports */ }
      const specText = (() => { try { return imp.getModuleSpecifier?.()?.getText?.() || `'${spec}'`; } catch { return `'${spec}'`; } })();
      const typeKw = (() => { try { return imp.isTypeOnly?.() ? 'import type ' : 'import '; } catch { return 'import '; } })();
      const renderNamed = (list: Array<{ name: string; alias?: string }>) =>
        `{ ${list.map((x) => (x.alias ? `${x.name} as ${x.alias}` : x.name)).join(', ')} }`;

      // CASE A — a NAMED import whose name is actually the DEFAULT export.
      // import { App } from './App' where App is not a named export but IS the default (named App),
      // and the statement has no default import yet. Move that one name to the default position; the
      // name-match (default's own identifier === imported name) proves it is the same binding.
      const moveToDefault = !defName && named.find((x) =>
        !x.alias && !shape.named.has(x.name) && shape.hasDefault && shape.defaultName === x.name);
      if (moveToDefault) {
        const remaining = named.filter((x) => x.name !== moveToDefault.name);
        const newText = `${typeKw}${moveToDefault.name}${remaining.length ? `, ${renderNamed(remaining)}` : ''} from ${specText};`;
        try {
          imp.replaceWithText(newText);
          touched.add(path);
          fixes.push({ file: path, line, name: moveToDefault.name, from: spec, kind: 'named-to-default', before, after: newText });
        } catch { /* leave untouched on any mutation error */ }
        continue; // one reconciliation per statement
      }

      // CASE B — a DEFAULT import whose name is actually a NAMED export (and there is no default export).
      // import App from './App' where App has no default but IS a named export -> make it a named import.
      if (defName && !shape.hasDefault && shape.named.has(defName)) {
        const newText = `${typeKw}${renderNamed([...named, { name: defName }])} from ${specText};`;
        try {
          imp.replaceWithText(newText);
          touched.add(path);
          fixes.push({ file: path, line, name: defName, from: spec, kind: 'default-to-named', before, after: newText });
        } catch { /* leave untouched on error */ }
      }
    }
  }

  if (fixes.length === 0) return unchanged;

  const out: Record<string, string> = { ...files };
  for (const path of touched) {
    const sf = sources.get(path);
    if (!sf) continue;
    try { out[path] = sf.getFullText(); } catch { /* keep original on serialization error */ }
  }
  return { files: out, fixes };
}

export interface AddedImport {
  file: string;
  name: string;
  from: string;
  statement: string;
}

export interface AddMissingResult {
  files: Record<string, string>;
  added: AddedImport[];
}

/** Relative import specifier from `importer` to `target` (both project-root file paths), ext-stripped. */
function relImportSpecifier(importer: string, target: string): string {
  const impDir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  const noExt = target.replace(/\.(t|j)sx?$/, '');
  const impParts = impDir ? impDir.split('/') : [];
  const tgtParts = noExt.split('/');
  let i = 0;
  while (i < impParts.length && i < tgtParts.length && impParts[i] === tgtParts[i]) i++;
  const up = impParts.slice(i).map(() => '..');
  const down = tgtParts.slice(i);
  const rel = [...up, ...down].join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Deterministically ADD a missing import when a file uses a bare value-identifier that exactly ONE
 * project module exports (a named export) and the file neither declares nor imports it.
 *
 * WHY (root cause, admin jungle-game report 104f5b09): the generator wrote `Background.ts` that USES
 * `CANVAS_HEIGHT` but imported only `import type { LayerConfig } from './constants'` — the value import
 * was forgotten. The fast lane never ran `tsc`, so "Cannot find name 'CANVAS_HEIGHT'" was never caught
 * and shipped as a runtime `ReferenceError: Can't find variable: CANVAS_HEIGHT` → the preview crashed.
 *
 * Paranoid-safe: it only acts when the name is unambiguous (exported by exactly one module), used as a
 * VALUE (not a property access `obj.X`, not a type, not a declaration/param name), and NOT already
 * declared or imported anywhere in the file. It only ADDS an import that must exist — it can only turn a
 * broken build into a working one. Pure; never throws.
 */
export async function addMissingProjectImports(files: Record<string, string>): Promise<AddMissingResult> {
  const unchanged: AddMissingResult = { files, added: [] };
  const mod = await loadTsMorph();
  if (!mod) return unchanged;
  const { SyntaxKind } = mod;

  let project: any;
  try {
    project = new mod.Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true, jsx: 2 } });
  } catch { return unchanged; }

  const sources = new Map<string, any>();
  for (const [path, content] of Object.entries(files)) {
    if (!CODE_FILE.test(path) || typeof content !== 'string') continue;
    try { sources.set(path, project.createSourceFile(path, content, { overwrite: true })); } catch { /* skip */ }
  }
  if (sources.size === 0) return unchanged;

  // Build the export index: name -> the set of project modules that export it as a NAMED export.
  // A name exported by 2+ modules is ambiguous → never auto-imported.
  const exportIndex = new Map<string, Set<string>>();
  for (const [path, sf] of sources) {
    try {
      const decls: Map<string, any[]> = sf.getExportedDeclarations?.() ?? new Map();
      for (const name of decls.keys()) {
        if (name === 'default') continue;
        if (!exportIndex.has(name)) exportIndex.set(name, new Set());
        exportIndex.get(name)!.add(path);
      }
    } catch { /* skip a file we can't read exports from */ }
  }
  if (exportIndex.size === 0) return unchanged;

  const added: AddedImport[] = [];
  const touched = new Set<string>();

  for (const [path, sf] of sources) {
    // Names DECLARED or IMPORTED anywhere in this file — never add an import for any of them (safety:
    // a duplicate/shadowing import would BREAK a working file). Conservative: if a name is declared
    // anywhere (even a nested local), we leave it alone.
    const local = new Set<string>();
    try {
      for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const parent = id.getParent?.();
        const pk = parent?.getKind?.();
        // The NAME side of a declaration / binding / import / parameter.
        if (
          pk === SyntaxKind.VariableDeclaration || pk === SyntaxKind.FunctionDeclaration ||
          pk === SyntaxKind.ClassDeclaration || pk === SyntaxKind.EnumDeclaration ||
          pk === SyntaxKind.InterfaceDeclaration || pk === SyntaxKind.TypeAliasDeclaration ||
          pk === SyntaxKind.Parameter || pk === SyntaxKind.BindingElement ||
          pk === SyntaxKind.ImportSpecifier || pk === SyntaxKind.ImportClause ||
          pk === SyntaxKind.NamespaceImport
        ) {
          try { if (parent.getNameNode?.() === id || parent.getName?.() === id.getText()) local.add(id.getText()); }
          catch { local.add(id.getText()); }
        }
      }
    } catch { continue; }

    // Candidate: iterate the (small) set of project-exported names and see if THIS file uses one as a
    // value without declaring/importing it.
    for (const [name, owners] of exportIndex) {
      if (owners.size !== 1) continue;             // ambiguous export → never guess
      const owner = [...owners][0];
      if (owner === path) continue;                 // a module can't import from itself
      if (local.has(name)) continue;                // already declared/imported here
      let usedAsValue = false;
      try {
        for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
          if (id.getText() !== name) continue;
          const parent = id.getParent?.();
          const pk = parent?.getKind?.();
          // Exclude the `.name` of a property access (obj.CANVAS_HEIGHT), object-literal keys, type
          // references, qualified names, and any declaration-name position (covered by `local`).
          if (pk === SyntaxKind.PropertyAccessExpression && parent.getNameNode?.() === id) continue;
          if (pk === SyntaxKind.QualifiedName) continue;
          if (pk === SyntaxKind.PropertyAssignment && parent.getNameNode?.() === id) continue;
          if (pk === SyntaxKind.TypeReference) continue;
          usedAsValue = true;
          break;
        }
      } catch { usedAsValue = false; }
      if (!usedAsValue) continue;

      const spec = relImportSpecifier(path, owner);
      try {
        sf.addImportDeclaration({ moduleSpecifier: spec, namedImports: [name] });
        touched.add(path);
        added.push({ file: path, name, from: spec, statement: `import { ${name} } from "${spec}";` });
      } catch { /* leave untouched on any mutation error */ }
    }
  }

  if (added.length === 0) return unchanged;
  const out: Record<string, string> = { ...files };
  for (const path of touched) {
    const sf = sources.get(path);
    if (!sf) continue;
    try { out[path] = sf.getFullText(); } catch { /* keep original on serialization error */ }
  }
  return { files: out, added };
}

/**
 * Convenience: reconcile, then re-analyze so the caller sees exactly which mismatches survived (i.e.
 * were NOT safely auto-fixable and still need real attention). Never throws.
 */
export async function reconcileAndReanalyze(files: Record<string, string>) {
  const rec = await reconcileImportExports(files);
  const report = await analyzeImportExports(rec.files);
  return { files: rec.files, fixes: rec.fixes, report };
}
