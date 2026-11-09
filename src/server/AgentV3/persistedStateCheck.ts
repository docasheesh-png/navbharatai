// BR1957 L04/L05: a cast and try/catch do not validate persisted data. Advisory only:
// never rewrite user code/data, infer a universal schema, or turn a warning into a failed write.
// Bounded single-file storage -> React state / data-theme flow. Runtime guards and transforming
// validators remain the app's responsibility; this is not a proof of their correctness.
import * as ts from 'typescript';

export interface PersistedStateFinding { type: string; message: string; count: number; line: number }
const SOURCE = /\.[jt]sx?$/i;
const EXCLUDED = /(^|\/)(?:node_modules|dist|build|__(?:tests?|mocks?)__)\/|\.(?:test|spec|d)\.[jt]sx?$/i;
const MODES = new Set(['light', 'dark', 'auto']);
function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}
function member(e: ts.Expression): { owner: ts.Expression; name: string } | null {
  e = unwrap(e);
  if (ts.isPropertyAccessExpression(e)) return { owner: e.expression, name: e.name.text };
  if (ts.isElementAccessExpression(e) && e.argumentExpression && ts.isStringLiteralLike(e.argumentExpression)) return { owner: e.expression, name: e.argumentExpression.text };
  return null;
}

/** No I/O or evaluation. TypeScript binds symbols only; the compiler host cannot read other files. */
export function persistedStateFindings(file: string, content: string): PersistedStateFinding[] {
  try {
    if (!SOURCE.test(file) || EXCLUDED.test(file) || typeof content !== 'string' || !/getItem|localStorage|sessionStorage/.test(content)) return [];
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, /x$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const host: ts.CompilerHost = {
      getSourceFile: (name) => name === file ? sf : undefined, getDefaultLibFileName: () => '',
      writeFile: () => {}, getCurrentDirectory: () => '', getDirectories: () => [],
      fileExists: (name) => name === file, readFile: (name) => name === file ? content : undefined,
      getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    };
    const checker = ts.createProgram([file], { noLib: true, noResolve: true }, host).getTypeChecker();
    const declaration = (e: ts.Identifier): ts.Declaration | undefined => {
      const symbol = checker.getSymbolAtLocation(e); return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    };
    const resolve = (e: ts.Expression, seen = new Set<ts.Node>()): ts.Expression => {
      e = unwrap(e);
      if (!ts.isIdentifier(e) || seen.has(e) || seen.size > 20) return e;
      const d = declaration(e);
      if (!d || seen.has(d) || !ts.isVariableDeclaration(d) || !d.initializer) return e;
      seen.add(d); return resolve(d.initializer, seen);
    };
    const named = (e: ts.Expression, name: string): boolean => { e = resolve(e); return ts.isIdentifier(e) && e.text === name && !declaration(e); };
    const storage = (e: ts.Expression): boolean => {
      e = resolve(e); if (ts.isIdentifier(e)) return /^(?:local|session)Storage$/.test(e.text) && !declaration(e);
      const m = member(e); return !!m && /^(?:local|session)Storage$/.test(m.name) && (named(m.owner, 'window') || named(m.owner, 'globalThis'));
    };
    const callName = (e: ts.Expression, name: string, owner?: string): boolean => {
      e = resolve(e); const m = member(e);
      const fromReact = (d: ts.Node | undefined): boolean => {
        while (d && !ts.isImportDeclaration(d)) d = d.parent;
        return !!d && ts.isImportDeclaration(d) && ts.isStringLiteralLike(d.moduleSpecifier) && d.moduleSpecifier.text === 'react';
      };
      if (m) {
        if (owner) return m.name === name && named(m.owner, owner);
        const root = resolve(m.owner);
        return m.name === name && ts.isIdentifier(root) && (root.text === 'React' && !declaration(root) || fromReact(declaration(root)));
      }
      // React's named useState alias is a normal import binding, not a same-spelling custom function.
      if (!owner && ts.isIdentifier(e)) {
        const d = declaration(e);
        return e.text === name && !d || !!d && ts.isImportSpecifier(d) && fromReact(d) && (d.propertyName ?? d.name).text === name;
      }
      return false;
    };
    type Taint = { kind: 'parsed' | 'raw'; origin: ts.Expression };
    const taint = (e: ts.Expression, seen = new Set<ts.Node>()): Taint | null => {
      e = unwrap(e); if (seen.has(e) || seen.size > 30) return null; seen.add(e);
      if (ts.isIdentifier(e)) {
        const d = declaration(e);
        if (d && ts.isVariableDeclaration(d) && d.initializer) return taint(d.initializer, seen);
      }
      if (ts.isCallExpression(e)) {
        const m = member(resolve(e.expression));
        if (m?.name === 'getItem' && storage(m.owner)) return { kind: 'raw', origin: e };
        if (callName(e.expression, 'parse', 'JSON') && e.arguments[0] && taint(e.arguments[0], seen)) return { kind: 'parsed', origin: e };
      }
      if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) return taint(e.left, seen) ?? taint(e.right, seen);
      return null;
    };
    const same = (e: ts.Expression, target: ts.Expression): boolean => {
      const a = taint(e), b = taint(target); return !!a && !!b && a.origin === b.origin;
    };
    // Positive enum tests only. Truthiness, casts, != junk, comments and try/catch are NOT whitelists.
    const enumGuard = (condition: ts.Expression, target: ts.Expression): boolean => {
      const e = unwrap(condition);
      if (ts.isBinaryExpression(e)) {
        const op = e.operatorToken.kind;
        if (op === ts.SyntaxKind.BarBarToken) return enumGuard(e.left, target) && enumGuard(e.right, target);
        if (op === ts.SyntaxKind.AmpersandAmpersandToken) return enumGuard(e.left, target) || enumGuard(e.right, target);
        if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) return (same(e.left, target) && ts.isStringLiteralLike(e.right) && MODES.has(e.right.text)) || (same(e.right, target) && ts.isStringLiteralLike(e.left) && MODES.has(e.left.text));
      }
      if (ts.isCallExpression(e) && e.arguments[0] && same(e.arguments[0], target)) {
        const m = member(e.expression), values = m && resolve(m.owner);
        return m?.name === 'includes' && !!values && ts.isArrayLiteralExpression(values) && values.elements.length > 0 && values.elements.every(x => ts.isStringLiteralLike(x) && MODES.has(x.text));
      }
      return false;
    };
    const shapeGuard = (condition: ts.Expression, target: ts.Expression): boolean => {
      const e = unwrap(condition);
      if (ts.isBinaryExpression(e)) {
        if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return shapeGuard(e.left, target) || shapeGuard(e.right, target);
        if (e.operatorToken.kind === ts.SyntaxKind.BarBarToken) return shapeGuard(e.left, target) && shapeGuard(e.right, target);
        if (e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isTypeOfExpression(e.left) && ts.isStringLiteralLike(e.right)) {
          const m = member(e.left.expression);
          return !!m && same(m.owner, target) && ['string', 'number', 'boolean'].includes(e.right.text);
        }
      }
      if (ts.isCallExpression(e)) {
        if (callName(e.expression, 'isArray', 'Array') && e.arguments[0] && same(e.arguments[0], target)) return true;
        // An explicit predicate call guards the branch. The check neither certifies nor rewrites it.
        if (ts.isIdentifier(e.expression) && /^(?:is|validate)[A-Z]/.test(e.expression.text) && e.arguments.some(a => same(a, target))) return true;
      }
      return false;
    };
    const guarded = (node: ts.Node, value: ts.Expression, theme: boolean): boolean => {
      const guard = theme ? enumGuard : shapeGuard;
      let child = node;
      for (let p = node.parent; p; child = p, p = p.parent) {
        if (ts.isIfStatement(p) && p.thenStatement === child && guard(p.expression, value)) return true;
        const rejected = (condition: ts.Expression): boolean => {
          const c = unwrap(condition); return ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken && guard(c.operand, value);
        };
        if (ts.isIfStatement(p) && p.elseStatement === child && rejected(p.expression)) return true;
        if (ts.isConditionalExpression(p) && p.whenFalse === child && rejected(p.condition)) return true;
        // Common validated decoder style: refuse invalid data, then commit. Only an immediate,
        // unconditional return/throw qualifies; a logging branch or nested callback does not.
        if (ts.isBlock(p) && ts.isStatement(child)) {
          const previous = p.statements[p.statements.indexOf(child) - 1];
          if (previous && ts.isIfStatement(previous) && !previous.elseStatement && rejected(previous.expression)) {
            const body = previous.thenStatement;
            const stop = ts.isBlock(body) && body.statements.length === 1 ? body.statements[0] : body;
            if (ts.isReturnStatement(stop) || ts.isThrowStatement(stop)) return true;
          }
        }
        if (ts.isConditionalExpression(p) && p.whenTrue === child && guard(p.condition, value)) return true;
        if (ts.isBinaryExpression(p) && p.right === child && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && guard(p.left, value)) return true;
        // A parent hook's guard must not validate a callback that can execute later with changed state.
        if (ts.isFunctionLike(p)) break;
      }
      return false;
    };
    const stateTarget = (e: ts.Expression): string | null => {
      e = resolve(e); if (!ts.isIdentifier(e)) return null;
      const d = declaration(e);
      if (!d || !ts.isBindingElement(d) || !ts.isArrayBindingPattern(d.parent) || d.parent.elements[1] !== d) return null;
      const v = d.parent.parent, first = d.parent.elements[0];
      return ts.isVariableDeclaration(v) && !!v.initializer && ts.isCallExpression(v.initializer) && callName(v.initializer.expression, 'useState') && ts.isBindingElement(first) && ts.isIdentifier(first.name) ? first.name.text : null;
    };
    const out: PersistedStateFinding[] = [], seen = new Set<string>();
    const inspect = (value: ts.Expression, theme: boolean): void => {
      const unwrapped = unwrap(value);
      if (guarded(unwrapped, unwrapped, theme)) return;
      const expanded = resolve(unwrapped);
      // Follow aliases into branch-valued initializers; a truthy ternary is not a whitelist.
      const e = ts.isConditionalExpression(expanded) || ts.isArrowFunction(expanded) || ts.isFunctionExpression(expanded) ? expanded : unwrapped;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
        if (!ts.isBlock(e.body)) inspect(e.body, theme);
        else { const returns = (n: ts.Node): void => { if (ts.isReturnStatement(n) && n.expression) inspect(n.expression, theme); else if (!ts.isFunctionLike(n)) ts.forEachChild(n, returns); }; ts.forEachChild(e.body, returns); }
        return;
      }
      if (ts.isConditionalExpression(e)) { inspect(e.whenTrue, theme); inspect(e.whenFalse, theme); return; }
      const t = taint(e); if (!t || !theme && t.kind !== 'parsed' || guarded(e, e, theme)) return;
      const line = sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1;
      const type = theme ? 'persisted-theme-mode' : 'persisted-json-state', key = `${line}:${type}`;
      if (seen.has(key)) return; seen.add(key);
      out.push({ type, line, count: 1, message: theme
        ? `Line ${line}: persisted theme reaches state/data-theme without a local light|dark|auto whitelist. Validate the app's supported modes before use; a type cast/truthiness is not validation. Preserve user storage; do not rewrite it speculatively.`
        : `Line ${line}: parsed browser storage reaches React state without a local runtime shape guard. Validate the domain fields/bounds (or use an explicit validated decoder) before state; JSON.parse, try/catch and TypeScript casts do not validate shape. Preserve existing valid data.` });
    };
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const state = stateTarget(n.expression), m = member(n.expression);
        if (state && n.arguments[0]) inspect(n.arguments[0], /theme/i.test(state));
        else if (callName(n.expression, 'useState') && n.arguments[0]) {
          const parent = n.parent, first = ts.isVariableDeclaration(parent) && ts.isArrayBindingPattern(parent.name) && parent.name.elements[0];
          inspect(n.arguments[0], !!first && ts.isBindingElement(first) && /theme/i.test(first.name.getText(sf)));
        } else if (m?.name === 'setAttribute' && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === 'data-theme' && n.arguments[1]) inspect(n.arguments[1], true);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf); return out;
  } catch { return []; }
}

/** Same warnings at build end, including hook-only projects; no success/repair is inferred. */
export function persistedStateBuildWarnings(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([path, content]) => persistedStateFindings(path, content).map(f => `${path}: ${f.message}`));
}
