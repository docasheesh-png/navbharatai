/**
 * A finite source proof of one unsupported cloud-success claim, not an upload resolver.
 * Supported: inert index.html -> direct createRoot entry -> zero-prop React component whose
 * only click effect writes a positive cloud-success literal into directly displayed local state.
 * Other supplied sources must be inert. No wrappers, CSS, custom hooks, effects, props, aliases,
 * transport, continuations or unknown configuration are interpreted. Unknown is never fake.
 *
 * This assumes standard browser, React/useState and react-dom/client semantics, not arbitrary
 * dependency replacement or host injection. It establishes no historical/runtime delivery fact.
 * Server-only; existing TypeScript dependency; no I/O or execution of supplied code. Limits are
 * cooperative (the synchronous parser cannot be preempted), with lexical bounds before parsing.
 */
import ts from 'typescript';

export const LOCAL_UPLOAD_LIMITS = Object.freeze({ files: 32, chars: 131_072, tokens: 24_000, nodes: 16_000, nesting: 64, milliseconds: 80 });
export interface LocalUploadHit { file: string; line: number; text: string }
const CLAIM = /^(?:uploaded|saved|synced|backed up) to (?:the |our )?(?:cloud|server)[.!]?$/i;
// TypeScript's syntactic parser accepts some names forbidden in strict ECMAScript modules.
const FORBIDDEN_BINDING = new Set(['eval', 'arguments', 'await', 'yield', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static']);
const id = (n: ts.Node | undefined, name?: string): n is ts.Identifier => !!n && ts.isIdentifier(n) && (name === undefined || n.text === name);
const unwrap = (n: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
  return n;
};
const literal = (n: ts.Expression | undefined): string | undefined => {
  const v = n && unwrap(n);
  return v && (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) ? v.text : undefined;
};
const primitive = (n: ts.Expression): boolean => literal(n) !== undefined || ts.isNumericLiteral(n)
  || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword;
const attrValue = (n: ts.JsxAttribute): ts.Expression | undefined => n.initializer && ts.isJsxExpression(n.initializer)
  ? n.initializer.expression && unwrap(n.initializer.expression) : undefined;
const pathIsPlain = (path: string): boolean => /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.[A-Za-z]+$/.test(path)
  && !path.split('/').some((p) => p === '.' || p === '..');

/** Deliberately exact, ordinary HTML shell. No CSS, import maps, templates, handlers or extra scripts. */
function entryFromHtml(html: string): { entry: string; root: string } | null {
  const shell = /^(?:<!doctype html>\s*)?<html(?:\s+lang="[A-Za-z-]+")?>\s*(?:<head>\s*([\s\S]*?)\s*<\/head>\s*)?<body>\s*<div\s+id="([A-Za-z][\w-]*)">\s*<\/div>\s*<script\s+type="module"\s+src="\/?([A-Za-z0-9_./-]+)">\s*<\/script>\s*<\/body>\s*<\/html>$/i.exec(html.trim());
  if (!shell || !pathIsPlain(shell[3]) || !/\.[jt]sx$/.test(shell[3])) return null;
  const head = shell[1] ?? '';
  // Complete token coverage, not removal of arbitrary tags. Text cannot introduce markup/entities.
  const inertHead = /^(?:\s|<meta\s+charset="utf-8"\s*\/?>|<meta\s+name="viewport"\s+content="[A-Za-z0-9=., -]+"\s*\/?>|<title>[A-Za-z0-9 .,!?_-]*<\/title>)*$/i;
  return inertHead.test(head) ? { entry: shell[3], root: shell[2] } : null;
}

/** Static default-toolchain metadata only. In particular paths/plugins/overrides cannot rewrite React. */
function safeConfig(path: string, source: string): boolean {
  try {
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    if (path === 'package.json') {
      if (Object.keys(obj).some((key) => !['name', 'version', 'private', 'type', 'scripts', 'dependencies', 'devDependencies'].includes(key))) return false;
      if (obj.type !== undefined && obj.type !== 'module') return false;
      if (obj.name !== undefined && typeof obj.name !== 'string' || obj.version !== undefined && typeof obj.version !== 'string'
        || obj.private !== undefined && typeof obj.private !== 'boolean') return false;
      const allowedScripts: Record<string, string[]> = { dev: ['vite'], build: ['vite build', 'tsc -b && vite build', 'tsc && vite build'], preview: ['vite preview'] };
      if (obj.scripts !== undefined && (!obj.scripts || typeof obj.scripts !== 'object' || Array.isArray(obj.scripts)
        || Object.entries(obj.scripts).some(([key, value]) => !allowedScripts[key]?.includes(value as string)))) return false;
      for (const key of ['dependencies', 'devDependencies']) {
        const deps = obj[key];
        if (deps === undefined) continue;
        if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return false;
        if (Object.entries(deps).some(([name, version]) => !['react', 'react-dom', 'vite', 'typescript', '@types/react', '@types/react-dom'].includes(name)
          || typeof version !== 'string' || !/^[~^]?\d+\.\d+\.\d+$/.test(version))) return false;
      }
      return true;
    }
    if (path !== 'tsconfig.json' || Object.keys(obj).some((key) => !['compilerOptions', 'include', 'exclude'].includes(key))) return false;
    for (const key of ['include', 'exclude']) if (obj[key] !== undefined && (!Array.isArray(obj[key]) || !(obj[key] as unknown[]).every((v) => typeof v === 'string'))) return false;
    const options = obj.compilerOptions;
    if (!options || typeof options !== 'object' || Array.isArray(options)) return false;
    const permitted = new Set(['target', 'module', 'moduleResolution', 'lib', 'jsx', 'strict', 'skipLibCheck', 'noEmit', 'allowJs', 'esModuleInterop', 'allowSyntheticDefaultImports', 'isolatedModules', 'resolveJsonModule', 'allowImportingTsExtensions']);
    return Object.entries(options).every(([key, val]) => permitted.has(key) && (key === 'jsx' ? val === 'react-jsx'
      : key === 'lib' ? Array.isArray(val) && val.every((v) => typeof v === 'string')
        : ['target', 'module', 'moduleResolution'].includes(key) ? typeof val === 'string' : typeof val === 'boolean'));
  } catch { return false; }
}

/** Returns one root-backed finding, or null for every unsupported/ambiguous context. */
export function provenLocalUploadPath(files: Readonly<Record<string, string>>, now: () => number = Date.now): LocalUploadHit | null {
  const entries = Object.entries(files);
  if (entries.length > LOCAL_UPLOAD_LIMITS.files || entries.some(([p, c]) => !pathIsPlain(p) || typeof c !== 'string')
    || entries.reduce((sum, [, c]) => sum + c.length, 0) > LOCAL_UPLOAD_LIMITS.chars) return null;
  const started = now();
  const expired = () => now() - started > LOCAL_UPLOAD_LIMITS.milliseconds;
  let tokens = 0;
  let nodeCount = 0;
  const parse = (path: string, source: string): { tree: ts.SourceFile; nodes: ts.Node[] } | null => {
    // JSX compiler directives can select an opaque runtime even though they look like comments.
    if (/@jsx|@jsxImportSource|@jsxRuntime/i.test(source)) return null;
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, source);
    let depth = 0;
    for (;;) {
      if (++tokens > LOCAL_UPLOAD_LIMITS.tokens || expired()) return null;
      const token = scanner.scan();
      if (token === ts.SyntaxKind.EndOfFileToken) break;
      if ([ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.OpenBracketToken].includes(token)) depth++;
      if ([ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseBracketToken].includes(token)) depth--;
      if (depth > LOCAL_UPLOAD_LIMITS.nesting) return null;
    }
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /x$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (expired() || (tree as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return null;
    const nodes: ts.Node[] = [];
    const stack: ts.Node[] = [tree];
    while (stack.length) {
      if (++nodeCount > LOCAL_UPLOAD_LIMITS.nodes || expired()) return null;
      const n = stack.pop()!;
      nodes.push(n);
      ts.forEachChild(n, (child) => { stack.push(child); });
    }
    return { tree, nodes };
  };
  try {
    const html = files['index.html'];
    if (!html) return null;
    const shell = entryFromHtml(html);
    if (!shell || !files[shell.entry]) return null;
    const entry = parse(shell.entry, files[shell.entry]);
    if (!entry || entry.tree.statements.length !== 3) return null;
    const imports = entry.tree.statements.filter(ts.isImportDeclaration);
    if (imports.length !== 2) return null;
    let createRoot: string | undefined;
    let componentName: string | undefined;
    let componentPath: string | undefined;
    for (const imp of imports) {
      const name = literal(imp.moduleSpecifier as ts.Expression);
      const clause = imp.importClause;
      if (!name || !clause || clause.isTypeOnly || imp.attributes) return null;
      if (name === 'react-dom/client') {
        const bindings = clause.namedBindings;
        if (clause.name || !bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 1) return null;
        const binding = bindings.elements[0];
        if (binding.isTypeOnly || binding.propertyName || binding.name.text !== 'createRoot') return null;
        createRoot = binding.name.text;
      } else {
        if (!clause.name || clause.namedBindings || !/^\.\/[A-Za-z0-9_-]+(?:\.[jt]sx)?$/.test(name)) return null;
        componentName = clause.name.text;
        const base = shell.entry.slice(0, shell.entry.lastIndexOf('/') + 1) + name.slice(2);
        const candidates = /\.[jt]sx$/.test(base) ? [base] : [`${base}.tsx`, `${base}.jsx`];
        const matches = candidates.filter((path) => Object.hasOwn(files, path));
        if (matches.length !== 1) return null;
        componentPath = matches[0];
      }
    }
    // Lowercase JSX names are intrinsic tags, not references to the imported component.
    if (!createRoot || !componentName || !/^[A-Z]/.test(componentName) || !componentPath) return null;
    const renderStatement = entry.tree.statements[2];
    if (!ts.isExpressionStatement(renderStatement) || !ts.isCallExpression(renderStatement.expression)) return null;
    const render = renderStatement.expression;
    if (!ts.isPropertyAccessExpression(render.expression) || !id(render.expression.name, 'render') || render.arguments.length !== 1
      || !ts.isCallExpression(render.expression.expression)) return null;
    const root = render.expression.expression;
    if (!id(root.expression, createRoot) || root.arguments.length !== 1) return null;
    const get = unwrap(root.arguments[0]);
    if (!ts.isCallExpression(get) || !ts.isPropertyAccessExpression(get.expression) || !id(get.expression.expression, 'document')
      || !id(get.expression.name, 'getElementById') || get.arguments.length !== 1 || literal(get.arguments[0]) !== shell.root) return null;
    const rendered = unwrap(render.arguments[0]);
    if (!ts.isJsxSelfClosingElement(rendered) || !id(rendered.tagName, componentName) || rendered.attributes.properties.length) return null;
    // All other files are a closed inert grammar too. No hidden global listeners or toolchain aliases.
    for (const [path, source] of entries) {
      if (path === 'index.html' || path === shell.entry || path === componentPath) continue;
      if (/\.json$/.test(path)) { if (!safeConfig(path, source)) return null; continue; }
      if (!/\.[jt]sx?$/.test(path)) return null;
      const other = parse(path, source);
      if (!other || other.tree.statements.some((s) => {
        if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) return false;
        if (!ts.isVariableStatement(s) || !(s.declarationList.flags & ts.NodeFlags.Const)) return true;
        return s.declarationList.declarations.some((d) => !id(d.name) || FORBIDDEN_BINDING.has(d.name.text) || d.name.text === 'FormData' || !d.initializer
          || !(primitive(d.initializer) || ts.isNewExpression(d.initializer) && id(d.initializer.expression, 'FormData')
            && !!d.initializer.arguments && d.initializer.arguments.length === 0));
      })) return null;
    }
    const parsed = parse(componentPath, files[componentPath]);
    if (!parsed || parsed.tree.statements.length !== 2) return null;
    const [stateImport, component] = parsed.tree.statements;
    if (!ts.isImportDeclaration(stateImport) || literal(stateImport.moduleSpecifier as ts.Expression) !== 'react'
      || stateImport.attributes || !stateImport.importClause || stateImport.importClause.isTypeOnly || stateImport.importClause.name) return null;
    const bindings = stateImport.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 1 || bindings.elements[0].isTypeOnly
      || bindings.elements[0].propertyName || !id(bindings.elements[0].name, 'useState')) return null;
    if (!ts.isFunctionDeclaration(component) || !component.name || component.parameters.length || component.asteriskToken
      || !component.body || component.modifiers?.length !== 2
      || !component.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      || !component.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return null;
    const statements = component.body.statements;
    if (statements.length !== 3) return null;
    const constDeclaration = (statement: ts.Statement): ts.VariableDeclaration | undefined => ts.isVariableStatement(statement)
      && !statement.modifiers?.length && statement.declarationList.flags & ts.NodeFlags.Const && statement.declarationList.declarations.length === 1
      ? statement.declarationList.declarations[0] : undefined;
    const state = constDeclaration(statements[0]);
    const handlerDeclaration = constDeclaration(statements[1]);
    const returned = statements[2];
    if (!state || !ts.isArrayBindingPattern(state.name) || state.name.elements.length !== 2 || !state.initializer
      || !ts.isCallExpression(state.initializer) || !id(state.initializer.expression, 'useState')
      || state.initializer.arguments.length !== 1 || literal(state.initializer.arguments[0]) !== '') return null;
    const [value, setter] = state.name.elements;
    if (!ts.isBindingElement(value) || !ts.isBindingElement(setter) || !id(value.name) || !id(setter.name)
      || value.initializer || setter.initializer || value.dotDotDotToken || setter.dotDotDotToken || value.propertyName || setter.propertyName) return null;
    if (!handlerDeclaration || !id(handlerDeclaration.name) || !handlerDeclaration.initializer) return null;
    const handler = unwrap(handlerDeclaration.initializer);
    if (!ts.isArrowFunction(handler) || handler.parameters.length || handler.modifiers?.length || !ts.isBlock(handler.body)
      || handler.body.statements.length !== 1) return null;
    const action = handler.body.statements[0];
    if (!ts.isExpressionStatement(action) || !ts.isCallExpression(action.expression) || !id(action.expression.expression, setter.name.text)
      || action.expression.arguments.length !== 1 || !CLAIM.test(literal(action.expression.arguments[0]) ?? '')) return null;
    const names = ['useState', component.name.text, value.name.text, setter.name.text, handlerDeclaration.name.text];
    if (new Set(names).size !== names.length || names.some((name) => FORBIDDEN_BINDING.has(name))) return null;
    if (!ts.isReturnStatement(returned) || !returned.expression) return null;
    const view = unwrap(returned.expression);
    if (!ts.isJsxElement(view)) return null;
    const stateName = value.name.text;
    const handlerName = handlerDeclaration.name.text;
    let buttons = 0;
    let labels = 0;
    const validateView = (element: ts.JsxElement): boolean => {
      if (expired()) return false;
      const opening = element.openingElement;
      if (!id(opening.tagName) || !id(element.closingElement.tagName, opening.tagName.text)
        || !/^(?:main|div|section|p|span|button)$/.test(opening.tagName.text)) return false;
      const children = element.children.filter((c) => !ts.isJsxText(c) || c.text.trim() !== '');
      if (opening.tagName.text === 'button') {
        buttons++;
        if (opening.attributes.properties.length < 1 || opening.attributes.properties.length > 2) return false;
        const attrs = opening.attributes.properties;
        if (attrs.some((a) => !ts.isJsxAttribute(a) || !id(a.name) || !['onClick', 'type'].includes(a.name.text))) return false;
        const click = attrs.filter((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && id(a.name, 'onClick'));
        const type = attrs.filter((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && id(a.name, 'type'));
        return click.length === 1 && id(attrValue(click[0]), handlerName)
          && type.length <= 1 && (!type.length || !!type[0].initializer && ts.isStringLiteral(type[0].initializer) && type[0].initializer.text === 'button')
          && children.length === 1 && ts.isJsxText(children[0]) && /^upload(?: file)?$/i.test(children[0].text.trim());
      }
      if (opening.attributes.properties.length) return false;
      if (children.length === 1 && ts.isJsxExpression(children[0]) && id(children[0].expression, stateName)) { labels++; return true; }
      return children.length > 0 && children.every((c) => ts.isJsxElement(c) && validateView(c));
    };
    if (!validateView(view) || buttons !== 1 || labels !== 1 || expired()) return null;
    // The closed statement/JSX grammars consume every value/setter/handler use; nothing can escape.
    const line = parsed.tree.getLineAndCharacterOfPosition(action.getStart(parsed.tree)).line + 1;
    return { file: componentPath, line, text: files[componentPath].split('\n')[line - 1] };
  } catch { return null; }
}
