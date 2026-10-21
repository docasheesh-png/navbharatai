// One source of truth for local export contracts. A symbol in TypeScript's export table is NOT proof
// that JavaScript exports a value: interfaces, type-only forwarding and ambient declarations erase.
// Unknown external/declaration-file implementations stay unknown, never candidates for a runtime heal.
import * as ts from 'typescript';

export type RuntimeExport = 'value' | 'erased' | 'unknown';
export interface ExportCapability { runtime: RuntimeExport; type: boolean; }
export interface ModuleCapabilities {
  exports: Map<string, ExportCapability>;
  uncertain: boolean;
}
export interface ImportBinding {
  from: string;
  imported: string;
  local: string;
  typeOnly: boolean;
  readsValue: boolean;
  start: number;
  line: number;
  /** Namespace imports are opt-in: they request an object, not a named "*" export. */
  namespace?: boolean;
  /** Null means a namespace value use is not a statically named property read. */
  runtimeMembers?: string[] | null;
}
export interface JsxBindingReference {
  root: string;
  component: string;
  line: number;
  state: 'value' | 'type-only' | 'missing';
}

export const EXPORT_CODE_FILE = /\.[cm]?[jt]sx?$/i;
/** Specifier spelling shared by every import/barrel writer, independent of source resolution. */
export function emittedModuleSpecifier(path: string): string {
  return path.replace(/\.mts$/i, '.mjs').replace(/\.cts$/i, '.cjs').replace(/\.[jt]sx?$/i, '');
}
const UNKNOWN: ExportCapability = { runtime: 'unknown', type: true };
const ERASED: ExportCapability = { runtime: 'erased', type: true };
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

/** Also used by the old public resolver: one extension/index policy across checks and mutations. */
export function resolveExportTarget(importer: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  const base = normalize(spec.startsWith('/') ? spec : `${dir}/${spec}`);
  const candidates = [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(e => base + e)];
  const match = /\.(js|jsx|mjs|cjs)$/i.exec(base);
  if (match) {
    const extensions: Record<string, string[]> = { js: ['.ts', '.tsx'], jsx: ['.tsx'], mjs: ['.mts'], cjs: ['.cts'] };
    candidates.push(...extensions[match[1].toLowerCase()].map(e => base.slice(0, -match[0].length) + e));
  }
  candidates.push(...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(e => `${base}/index${e}`));
  // A .d.ts describes an implementation, not its emitted bytes. It is useful for type imports but
  // cannot prove a local runtime repair. Real source/JS above wins when both are present.
  candidates.push(`${base}.d.ts`, `${base}.d.mts`, `${base}.d.cts`);
  return candidates.find(p => files.has(p)) ?? null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === kind);
}
function ambient(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node; p; p = p.parent) if (hasModifier(p, ts.SyntaxKind.DeclareKeyword)) return true;
  return false;
}
function isRuntimeRead(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) || ts.isJsxNamespacedName(parent)) return false;
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxClosingElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
      parent.tagName === id && /^[a-z]/.test(id.text)) return false; // intrinsic tag, not a variable
  if ((ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === id) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isExportSpecifier(parent)) {
    const declaration = parent.parent.parent;
    return !declaration.moduleSpecifier && !declaration.isTypeOnly && !parent.isTypeOnly &&
      (parent.propertyName ?? parent.name) === id;
  }
  // Names declare things rather than read them; JSX tags and computed member names are expressions.
  if ('name' in parent && parent.name === id) return false;
  for (let p: ts.Node | undefined = parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isImportEqualsDeclaration(p)) return false;
    if (ts.isExportDeclaration(p)) return !p.isTypeOnly && !(ts.isExportSpecifier(parent) && parent.isTypeOnly);
    if (ts.isExpressionWithTypeArguments(p)) {
      const heritage = p.parent;
      return ts.isHeritageClause(heritage) && heritage.token === ts.SyntaxKind.ExtendsKeyword &&
        (ts.isClassDeclaration(heritage.parent) || ts.isClassExpression(heritage.parent));
    }
    if (ts.isTypeNode(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return false;
    // Stop at the first runtime expression. Its surrounding annotation (e.g. a computed key inside
    // a type) is handled below by walking all ancestors instead of checking only the immediate parent.
  }
  return true;
}

/** In-memory, no filesystem/package/network reads. Parse once, resolve aliases with the real TS binder. */
export function createExportCapabilities(files: Record<string, string>) {
  const sources = new Map<string, ts.SourceFile>();
  for (const [path, content] of Object.entries(files)) {
    if (EXPORT_CODE_FILE.test(path) && typeof content === 'string') {
      sources.set(normalize(path), ts.createSourceFile(normalize(path), content, ts.ScriptTarget.Latest, true));
    }
  }
  const paths = new Set(sources.keys());
  const options: ts.CompilerOptions = { noLib: true, noResolve: false, allowJs: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve };
  const host: ts.CompilerHost = {
    getSourceFile: p => sources.get(normalize(p)), getDefaultLibFileName: () => '', writeFile: () => {},
    getCurrentDirectory: () => '/', getDirectories: () => [], fileExists: p => paths.has(normalize(p)),
    readFile: p => sources.get(normalize(p))?.text, getCanonicalFileName: normalize,
    useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, importer) => names.map(spec => {
      const target = resolveExportTarget(normalize(importer), spec, paths);
      return target ? { resolvedFileName: target } : undefined;
    }),
  };
  const program = ts.createProgram([...paths], options, host);
  const checker = program.getTypeChecker();
  const cache = new Map<string, ModuleCapabilities>();
  const visiting = new Set<ts.Symbol>();
  const commonJsSurface = (sf: ts.SourceFile): boolean => {
    if (sf.statements.some(st => ts.isExportAssignment(st) && st.isExportEquals)) return true;
    const hasEsmExports = sf.statements.some(st => ts.isExportDeclaration(st)
      || ts.isExportAssignment(st) || hasModifier(st, ts.SyntaxKind.ExportKeyword));
    // Empty and import-only .cjs/.cts files supply CommonJS's default exports object, including
    // value/side-effect imports and erased type imports. Export syntax (even `export type` or
    // `export {}`) instead gives the bundler an ESM export surface; it stays analyzable.
    if (/\.c[jt]s$/i.test(sf.fileName) && !hasEsmExports) return true;
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(node) && (node.text === 'module' || node.text === 'exports') && isRuntimeRead(node)) {
        const symbol = checker.resolveName(node.text, node, ts.SymbolFlags.Value | ts.SymbolFlags.Alias, false);
        // The binder synthesizes SourceFile/Identifier declarations for CommonJS globals.
        // Parameters, variables, imports and other real declarations are lexical shadows instead.
        const shadowed = symbol?.declarations?.some(d => !ts.isSourceFile(d) && !ts.isIdentifier(d) && !ambient(d));
        if (!shadowed) { found = true; return; }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    // Dynamic/aliased CommonJS mutation cannot prove a static named export or authorize a repair.
    // Do not label its absent ESM table as proof that a working runtime export is missing.
    return found;
  };
  const declarationCapability = (d: ts.Declaration): ExportCapability => {
    if (ts.isExportSpecifier(d)) {
      const ed = d.parent.parent;
      if (d.isTypeOnly || ed.isTypeOnly) return ERASED;
      if (ed.moduleSpecifier && ts.isStringLiteralLike(ed.moduleSpecifier)) {
        const target = resolveExportTarget(d.getSourceFile().fileName, ed.moduleSpecifier.text, paths);
        return target ? exportsOf(target).exports.get((d.propertyName ?? d.name).text) ?? UNKNOWN : UNKNOWN;
      }
      return symbolCapability(checker.getExportSpecifierLocalTargetSymbol(d));
    }
    if (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)) {
      const clause = ts.isImportClause(d) ? d : ts.isImportSpecifier(d) ? d.parent.parent : d.parent;
      const imp = clause.parent;
      if (clause.isTypeOnly || (ts.isImportSpecifier(d) && d.isTypeOnly)) return ERASED;
      if (!ts.isImportDeclaration(imp) || !ts.isStringLiteralLike(imp.moduleSpecifier)) return UNKNOWN;
      const target = resolveExportTarget(d.getSourceFile().fileName, imp.moduleSpecifier.text, paths);
      if (!target) return UNKNOWN;
      if (ts.isNamespaceImport(d)) return { runtime: 'value', type: true };
      return exportsOf(target).exports.get(ts.isImportSpecifier(d) ? (d.propertyName ?? d.name).text : 'default') ?? UNKNOWN;
    }
    if (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isTypeParameterDeclaration(d)) return ERASED;
    if (d.getSourceFile().isDeclarationFile) return UNKNOWN;
    if (ambient(d)) return { runtime: 'erased', type: ts.isClassDeclaration(d) || ts.isEnumDeclaration(d) || ts.isModuleDeclaration(d) };
    if (ts.isFunctionDeclaration(d)) return { runtime: d.body ? 'value' : 'erased', type: false };
    if (ts.isClassDeclaration(d) || ts.isEnumDeclaration(d)) return { runtime: 'value', type: true };
    if (ts.isVariableDeclaration(d) || ts.isBindingElement(d)) return { runtime: 'value', type: false };
    if (ts.isExportAssignment(d)) {
      return ts.isIdentifier(d.expression) ? symbolCapability(checker.getSymbolAtLocation(d.expression) ??
        checker.resolveName(d.expression.text, d.expression, ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias, false)) : { runtime: 'value', type: false };
    }
    if (ts.isModuleDeclaration(d)) {
      // Type-only namespaces emit no object; runtime namespaces can merge with functions/classes.
      const body = d.body;
      const hasValue = body && (ts.isModuleBlock(body) ? body.statements.some(s =>
        !ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s) && !ts.isEmptyStatement(s) && !ambient(s) &&
        !(ts.isFunctionDeclaration(s) && !s.body) &&
        (!ts.isModuleDeclaration(s) || declarationCapability(s).runtime === 'value') &&
        !(ts.isImportEqualsDeclaration(s) && s.isTypeOnly) &&
        !(ts.isExportDeclaration(s) && (s.isTypeOnly || (s.exportClause && ts.isNamedExports(s.exportClause) && s.exportClause.elements.every(e => e.isTypeOnly))))) : declarationCapability(body).runtime === 'value');
      return { runtime: hasValue ? 'value' : 'erased', type: true };
    }
    if (ts.isNamespaceExport(d)) return d.parent.isTypeOnly ? ERASED : { runtime: 'value', type: true };
    return UNKNOWN;
  };
  const symbolCapability = (symbol: ts.Symbol | undefined): ExportCapability => {
    if (!symbol || visiting.has(symbol)) return UNKNOWN;
    visiting.add(symbol);
    const caps = (symbol.declarations ?? []).map(declarationCapability);
    visiting.delete(symbol);
    return { runtime: caps.some(c => c.runtime === 'value') ? 'value' : !caps.length || caps.some(c => c.runtime === 'unknown') ? 'unknown' : 'erased', type: caps.some(c => c.type) };
  };
  const exportsOf = (path: string): ModuleCapabilities => {
    path = normalize(path);
    const cached = cache.get(path);
    if (cached) return cached;
    const sf = sources.get(path);
    const result: ModuleCapabilities = { exports: new Map(), uncertain: !sf };
    cache.set(path, result);
    if (!sf) return result;
    result.uncertain = !!(sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length
      || commonJsSurface(sf);
    const module = checker.getSymbolAtLocation(sf);
    const symbols = module ? checker.getExportsOfModule(module) : [];
    if (module) for (const symbol of symbols) result.exports.set(symbol.name, symbolCapability(symbol));
    const explicitNames = new Set(symbols.filter(symbol => symbol.declarations?.some(d => d.getSourceFile() === sf)).map(symbol => symbol.name));
    const stars = new Map<string, { cap: ExportCapability; origin?: ts.Symbol }>();
    for (const st of sf.statements) {
      if (!ts.isExportDeclaration(st) || st.exportClause || !st.moduleSpecifier || !ts.isStringLiteralLike(st.moduleSpecifier)) continue;
      const target = resolveExportTarget(path, st.moduleSpecifier.text, paths);
      if (!target) { result.uncertain = true; continue; }
      const forwarded = exportsOf(target);
      result.uncertain ||= forwarded.uncertain;
      // The checker follows stars but drops their type-only edge. Merge all edges rather than
      // letting a later type-only star erase an earlier runtime export of the same binding.
      const targetModule = checker.getSymbolAtLocation(sources.get(target)!);
      const targetSymbols = targetModule ? checker.getExportsOfModule(targetModule) : [];
      for (const [name, inherited] of forwarded.exports) {
        if (name === 'default' || explicitNames.has(name)) continue;
        const cap = st.isTypeOnly ? ERASED : inherited;
        let origin = targetSymbols.find(symbol => symbol.name === name);
        if (origin && (origin.flags & ts.SymbolFlags.Alias)) origin = checker.getAliasedSymbol(origin);
        const previous = stars.get(name);
        if (!previous) stars.set(name, { cap, origin });
        else if (previous.cap.runtime === 'unknown' || cap.runtime === 'unknown' ||
          (previous.cap.runtime === 'value' && cap.runtime === 'value' && previous.origin !== origin)) {
          stars.set(name, { cap: UNKNOWN }); // ambiguous runtime star providers: never guess
        } else if (cap.runtime === 'value') stars.set(name, { cap, origin });
      }
    }
    for (const [name, entry] of stars) result.exports.set(name, entry.cap);
    return result;
  };
  const importsCache = new Map<string, ImportBinding[]>();
  const valueReadsCache = new Map<string, Map<string, ts.Identifier[]>>();
  const valueReads = (path: string) => {
    const cached = valueReadsCache.get(path); if (cached) return cached;
    const result = new Map<string, ts.Identifier[]>();
    const sf = sources.get(normalize(path));
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && isRuntimeRead(node)) {
        const ids = result.get(node.text) ?? []; ids.push(node); result.set(node.text, ids);
      }
      ts.forEachChild(node, visit);
    };
    if (sf) visit(sf);
    valueReadsCache.set(path, result); return result;
  };
  const allImportsOf = (path: string): ImportBinding[] => {
    const cached = importsCache.get(path); if (cached) return cached;
    const result: ImportBinding[] = [];
    const sf = sources.get(normalize(path)); if (!sf) return result;
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteralLike(st.moduleSpecifier)) continue;
      const clause = st.importClause;
      const add = (id: ts.Identifier, imported: string, typeOnly: boolean, start: number, namespace = false) => {
        const symbol = checker.getSymbolAtLocation(id);
        const reads = (valueReads(path).get(id.text) ?? []).filter(ref => {
          // Re-exporting a type-imported binding forwards its type, not its runtime value.
          if (typeOnly && ts.isExportSpecifier(ref.parent)) return false;
          // A type-only alias can legally coexist with a same-named local value. TypeScript merges
          // their symbol, but the runtime read belongs to that value, not to the erased import.
          if (typeOnly && symbol && (symbol.flags & ts.SymbolFlags.Value)) return false;
          const refSymbol = ts.isShorthandPropertyAssignment(ref.parent) ? checker.getShorthandAssignmentValueSymbol(ref.parent) :
            ts.isExportSpecifier(ref.parent) ? checker.getExportSpecifierLocalTargetSymbol(ref.parent) : checker.getSymbolAtLocation(ref);
          const lexical = refSymbol ?? checker.resolveName(ref.text, ref, ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias, false);
          return !!symbol && lexical === symbol;
        });
        let runtimeMembers: string[] | null = [];
        if (namespace) for (const ref of reads) {
          const p = ref.parent;
          if (ts.isPropertyAccessExpression(p) && p.expression === ref) runtimeMembers.push(p.name.text);
          else if (ts.isElementAccessExpression(p) && p.expression === ref && ts.isStringLiteralLike(p.argumentExpression)) runtimeMembers.push(p.argumentExpression.text);
          else { runtimeMembers = null; break; } // dynamic/object uses cannot prove the requested members
        }
        result.push({ from: (st.moduleSpecifier as ts.StringLiteral).text, imported, local: id.text, typeOnly, start,
          line: sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1, readsValue: reads.length > 0,
          ...(namespace ? { namespace: true, runtimeMembers } : {}),
        });
      };
      if (clause.name) add(clause.name, 'default', clause.isTypeOnly, clause.name.getStart(sf));
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const id = clause.namedBindings.name;
        add(id, '*', clause.isTypeOnly, id.getStart(sf), true);
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const ni of clause.namedBindings.elements) {
        add(ni.name, (ni.propertyName ?? ni.name).text, clause.isTypeOnly || ni.isTypeOnly, ni.getStart(sf));
      }
    }
    importsCache.set(path, result); return result;
  };
  // JSX needs the binding at THIS tag, not a union of declarations elsewhere in the file. Use the
  // same binder as import value reads, retaining function-expression names and lexical shadows.
  const jsxBindingsOf = (path: string): JsxBindingReference[] => {
    const sf = sources.get(normalize(path));
    const result: JsxBindingReference[] = [];
    if (!sf || (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) return result;
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        let root: ts.Node = tag;
        while (ts.isPropertyAccessExpression(root)) root = root.expression;
        if (ts.isIdentifier(root) && (ts.isPropertyAccessExpression(tag) || /^[A-Z]/.test(root.text))) {
          const symbol = checker.getSymbolAtLocation(root) ?? checker.resolveName(root.text, root,
            ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias, false);
          const erasedImport = symbol?.declarations?.some(d =>
            ts.isImportSpecifier(d) ? d.isTypeOnly || d.parent.parent.isTypeOnly :
              ts.isImportClause(d) ? d.isTypeOnly : ts.isNamespaceImport(d) ? d.parent.isTypeOnly : false);
          // Ambient value declarations may describe an injected runtime global. Their existence is
          // not proof of a missing binding; local type aliases/interfaces alone are not value bindings.
          const state = !symbol ? 'missing' : symbol.flags & ts.SymbolFlags.Value ? 'value' :
            erasedImport || !(symbol.flags & ts.SymbolFlags.Alias) ? 'type-only' : 'value';
          result.push({ root: root.text, component: tag.getText(sf), line: sf.getLineAndCharacterOfPosition(tag.getStart(sf)).line + 1, state });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return result;
  };
  return {
    exportsOf, jsxBindingsOf,
    // Existing producer-export consumers deliberately do not see namespace imports: a namespace
    // object is not a request for an export named '*'. The type-only healer explicitly opts in.
    importsOf: (path: string, includeNamespaces = false) => allImportsOf(path).filter(b => includeNamespaces || !b.namespace),
    hasValueRead: (path: string, name: string) => !!valueReads(path).get(name)?.length,
    resolve: (path: string, from: string) => resolveExportTarget(normalize(path), from, paths),
  };
}
