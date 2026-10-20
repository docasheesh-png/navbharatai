/**
 * A deliberately small proof, not an auth resolver. An unrelated SDK import cannot make a handler
 * real when that handler only compares a fixed local credential, writes a fixed token, and flips a
 * React state bit that displays "Signed in". Opaque callbacks, network calls and unsupported flow
 * remain UNKNOWN. In particular an onLogin prop is NOT assumed to be a success notification.
 * Supported shape: a zero-parameter exported function component with local React states, a direct
 * prevented submit, and a static positive English success label. Unknown does not mean real.
 *
 * Server-only, no I/O or execution of app code. TypeScript is already a production dependency.
 * Limits apply before parsing (characters/tokens/nesting), during traversal (nodes) and at checkpoints
 * (elapsed time). The parser is synchronous, so the time budget is cooperative, not preemption.
 */
import ts from 'typescript';

export const LOCAL_LOGIN_LIMITS = Object.freeze({ chars: 65_536, tokens: 12_000, nesting: 64, nodes: 8_000, milliseconds: 40 });
export interface LocalLoginHit { line: number; text: string }

type FunctionWithBody = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
const isFunction = (n: ts.Node): n is FunctionWithBody => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);
const id = (n: ts.Node | undefined, name?: string): n is ts.Identifier => !!n && ts.isIdentifier(n) && (name === undefined || n.text === name);
const unwrap = (n: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
  return n;
};
const literal = (n: ts.Expression | undefined): string | undefined => {
  if (!n) return undefined;
  const v = unwrap(n);
  return ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v) ? v.text : undefined;
};
function attr(element: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): ts.JsxAttribute | undefined {
  const matches = element.attributes.properties.filter((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && id(p.name, name));
  return matches.length === 1 ? matches[0] : undefined;
}
function attrExpression(attribute?: ts.JsxAttribute): ts.Expression | undefined {
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression
    ? unwrap(attribute.initializer.expression) : undefined;
}
function enclosingFunction(n: ts.Node): FunctionWithBody | undefined {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (isFunction(p)) return p;
  return undefined;
}
function directDeclarations(body: ts.SourceFile | ts.Block): ts.VariableDeclaration[] {
  return body.statements.flatMap((s) => ts.isVariableStatement(s) && (s.declarationList.flags & ts.NodeFlags.Const)
    ? [...s.declarationList.declarations] : []);
}
function callStatement(statement: ts.Statement): ts.CallExpression | undefined {
  return ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) ? statement.expression : undefined;
}

/** Returns one source-backed finding or null (unknown/unsupported is never "fake"). */
export function provenLocalLoginPath(file: string, source: string, now: () => number = Date.now): LocalLoginHit | null {
  if (!/\.[cm]?[jt]sx$/i.test(file) || source.length > LOCAL_LOGIN_LIMITS.chars
    || !/Storage\.setItem/.test(source) || !/password|\bpass\b|\bpwd\b/i.test(source)) return null;
  const started = now();
  const expired = () => now() - started > LOCAL_LOGIN_LIMITS.milliseconds;
  try {
    // Reject pathological parser depth before invoking the recursive parser. The scanner treats
    // strings/comments as tokens, so their punctuation cannot manufacture or hide nesting.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, source);
    let nesting = 0;
    for (let count = 0; ; count++) {
      if (count >= LOCAL_LOGIN_LIMITS.tokens || expired()) return null;
      const token = scanner.scan();
      if (token === ts.SyntaxKind.EndOfFileToken) break;
      if ([ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.OpenBracketToken].includes(token)) nesting++;
      if ([ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseBracketToken].includes(token)) nesting--;
      if (nesting > LOCAL_LOGIN_LIMITS.nesting) return null;
    }
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    if (expired() || (tree as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return null;
    const nodes: ts.Node[] = [];
    const stack: ts.Node[] = [tree];
    while (stack.length) {
      if (nodes.length >= LOCAL_LOGIN_LIMITS.nodes || expired()) return null;
      const n = stack.pop()!;
      nodes.push(n);
      ts.forEachChild(n, (child) => { stack.push(child); });
    }
    // Module initialization also has a closed grammar. Unknown executed statements/initializers
    // can replace Storage.prototype or a global through aliases; naming one spelling is not proof.
    if (tree.statements.some((statement) => {
      if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isFunctionDeclaration(statement)
        || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
        || ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) return false;
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return true;
      return statement.declarationList.declarations.some((declaration) => {
        if (!id(declaration.name) || !declaration.initializer) return true;
        const init = unwrap(declaration.initializer);
        if (isFunction(init) || literal(init) !== undefined) return false;
        return !ts.isObjectLiteralExpression(init) || init.properties.some((p) => !ts.isPropertyAssignment(p) || !id(p.name) || literal(p.initializer) === undefined);
      });
    })) return null;
    // Only the actual React useState export is accepted, not a same-named arbitrary auth hook.
    const stateImports = new Set<string>();
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly || literal(statement.moduleSpecifier as ts.Expression) !== 'react') continue;
      const imports = statement.importClause?.namedBindings;
      if (imports && ts.isNamedImports(imports)) for (const imp of imports.elements) {
        if ((imp.propertyName ?? imp.name).text === 'useState' && !imp.isTypeOnly) stateImports.add(imp.name.text);
      }
    }
    if (!stateImports.size) return null;
    const allNamedDeclarations = nodes.filter((n): n is ts.VariableDeclaration | ts.ParameterDeclaration | ts.BindingElement | ts.FunctionDeclaration | ts.FunctionExpression | ts.ClassDeclaration | ts.ClassExpression | ts.ModuleDeclaration | ts.ImportEqualsDeclaration | ts.EnumDeclaration | ts.ImportSpecifier | ts.NamespaceImport | ts.ImportClause =>
      ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n)
      || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)
      || ts.isModuleDeclaration(n) || ts.isImportEqualsDeclaration(n) || ts.isEnumDeclaration(n)
      || ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n));
    // Conservative uniqueness avoids shadowing without pretending to be a whole-project type checker.
    for (const name of stateImports) if (allNamedDeclarations.filter((n) => id(n.name, name)).length !== 1) stateImports.delete(name);
    const unique = (name: string) => allNamedDeclarations.filter((n) => id(n.name, name)).length === 1;
    const moduleDeclarations = directDeclarations(tree);
    for (const form of nodes.filter(ts.isJsxElement)) {
      if (expired()) return null;
      if (!id(form.openingElement.tagName, 'form') || form.openingElement.attributes.properties.some(ts.isJsxSpreadAttribute)) continue;
      const component = enclosingFunction(form);
      if (!component || !ts.isFunctionDeclaration(component) || component.parent !== tree
        || !component.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        || component.parameters.length || component.asteriskToken || component.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
        || !component.body) continue;
      const declarations = directDeclarations(component.body);
      const states = declarations.flatMap((d) => {
        if (!ts.isArrayBindingPattern(d.name) || d.name.elements.length !== 2 || !d.initializer) return [];
        const [value, setter] = d.name.elements;
        const init = unwrap(d.initializer);
        if (!ts.isBindingElement(value) || !ts.isBindingElement(setter) || value.initializer || setter.initializer
          || value.dotDotDotToken || setter.dotDotDotToken || !id(value.name) || !id(setter.name)
          || !ts.isCallExpression(init) || !id(init.expression) || !stateImports.has(init.expression.text)
          || init.arguments.length !== 1 || !unique(value.name.text) || !unique(setter.name.text)) return [];
        return [{ declaration: d, value: value.name.text, setter: setter.name.text, initial: unwrap(init.arguments[0]) }];
      });
      const password = states.find((s) => /^(?:password|pass|pwd)$/i.test(s.value) && literal(s.initial) !== undefined);
      const auth = states.find((s) => /^(?:is)?(?:authenticated|loggedIn|signedIn)$/i.test(s.value) && s.initial.kind === ts.SyntaxKind.FalseKeyword);
      if (!password || !auth) continue;
      // Closed render grammar: no early returns/effects or eager unknown calls can authenticate,
      // replace browser operations, or hide the success view before the submit path executes.
      if (component.body.statements.some((statement) => {
        if (ts.isReturnStatement(statement)) return false;
        if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return true;
        return statement.declarationList.declarations.some((declaration) => {
          if (!declaration.initializer) return true;
          const init = unwrap(declaration.initializer);
          if (!id(declaration.name) && !states.some((s) => s.declaration === declaration)) return true;
          if (isFunction(init) || literal(init) !== undefined) return false;
          if (ts.isObjectLiteralExpression(init)) return init.properties.some((p) => !ts.isPropertyAssignment(p) || !id(p.name) || literal(p.initializer) === undefined);
          return !ts.isCallExpression(init) || !id(init.expression) || !stateImports.has(init.expression.text)
            || init.arguments.length !== 1 || !(literal(init.arguments[0]) !== undefined
              || init.arguments[0].kind === ts.SyntaxKind.FalseKeyword || init.arguments[0].kind === ts.SyntaxKind.TrueKeyword);
        });
      })) continue;
      const passwordInput = nodes.some((n) => {
        if (!ts.isJsxSelfClosingElement(n) || !id(n.tagName, 'input') || !id(attrExpression(attr(n, 'value')), password.value)) return false;
        const type = attr(n, 'type')?.initializer;
        if (n.attributes.properties.some(ts.isJsxSpreadAttribute) || !type || !ts.isStringLiteral(type) || type.text !== 'password') return false;
        for (let p = n.parent; p && p !== component; p = p.parent) if (p === form) return true;
        return false;
      });
      if (!passwordInput) continue;
      // Require an actual local, user-visible success assertion, not a state bit used by another
      // provider-backed component. Custom components or calls in this success view are unknown.
      const returns = component.body.statements.filter(ts.isReturnStatement);
      if (returns.length !== 1 || component.body.statements.at(-1) !== returns[0] || !returns[0].expression) continue;
      const view = unwrap(returns[0].expression);
      if (!ts.isConditionalExpression(view) || !id(unwrap(view.condition), auth.value) || unwrap(view.whenFalse) !== form) continue;
      const success = unwrap(view.whenTrue);
      if (!ts.isJsxElement(success)) continue;
      const successNodes = nodes.filter((n) => n.pos >= success.pos && n.end <= success.end);
      // Exact positive rendered text, not a negation, title attribute or hidden expression.
      const successText = successNodes.filter(ts.isJsxText).sort((a, b) => a.pos - b.pos).map((n) => n.text).join(' ').replace(/\s+/g, ' ').trim();
      if (!/^(?:signed in|logged in|authenticated)[.!]?$/.test(successText.toLowerCase())) continue;
      if (successNodes.some((n) => ts.isCallExpression(n) || ts.isJsxExpression(n)
        || (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))
          && (!id(n.tagName) || !/^(?:main|div|section|p|h[1-6]|span|strong|b|em)$/.test(n.tagName.text)
            || n.attributes.properties.length > 0))) continue;
      // An explicit action, another event route or a custom child can authenticate independently.
      const formNodes = nodes.filter((n) => n.pos >= form.pos && n.end <= form.end);
      if (formNodes.some((n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))
        && (!id(n.tagName) || !/^(?:form|input|button|label|div|span|p|section|fieldset|legend|h[1-6]|strong|b|em)$/.test(n.tagName.text)
          || n.attributes.properties.some(ts.isJsxSpreadAttribute))
        || ts.isJsxAttribute(n) && !/^(?:onSubmit|onChange|value|type|className|id|name|placeholder|title|autoComplete|htmlFor|role|data-[\w-]+|aria-[\w-]+)$/.test(n.name.getText(tree)))) continue;
      // Keep native control reachability validation-free rather than emulate browser constraints.
      // Passive attributes above exclude constraints, hidden/disabled controls and form reassociation.
      if (formNodes.some((n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && (() => {
          const names = n.attributes.properties.map((p) => ts.isJsxAttribute(p) ? p.name.getText(tree) : '');
          if (new Set(names).size !== names.length) return true;
          const type = attr(n, 'type');
          return id(n.tagName, 'input') && !!type && (!type.initializer || !ts.isStringLiteral(type.initializer)
            || !/^(?:text|password|tel|search)$/.test(type.initializer.text));
        })())) continue;
      if (!formNodes.some((n) => ts.isJsxOpeningElement(n) && id(n.tagName, 'button')
        && (!attr(n, 'type') || literal(attr(n, 'type')?.initializer as ts.Expression) === 'submit'))) continue;
      // Inputs may only update their own React state; an onChange that authenticates is unknown.
      if (formNodes.some((n) => ts.isJsxElement(n) && n !== form && id(n.openingElement.tagName, 'form')
        || ts.isJsxExpression(n) && (!ts.isJsxAttribute(n.parent)
          || !['onSubmit', 'onChange', 'value'].includes(n.parent.name.getText(tree)))
        || ts.isJsxAttribute(n) && id(n.name, 'onSubmit') && n.parent !== form.openingElement.attributes
        || ts.isJsxAttribute(n) && id(n.name, 'value') && !states.some((s) => id(attrExpression(n), s.value)))) continue;
      const changes = formNodes.filter((n): n is ts.JsxAttribute => ts.isJsxAttribute(n) && id(n.name, 'onChange'));
      if (changes.some((change) => {
        const callback = attrExpression(change);
        if (!callback || !ts.isArrowFunction(callback) || callback.parameters.length !== 1
          || !id(callback.parameters[0].name) || callback.parameters[0].initializer || callback.parameters[0].dotDotDotToken
          || !ts.isCallExpression(callback.body) || !id(callback.body.expression) || callback.body.arguments.length !== 1
          || !states.some((s) => s.setter === (callback.body as ts.CallExpression).expression.getText(tree))) return true;
        const value = callback.body.arguments[0];
        return !ts.isPropertyAccessExpression(value) || !id(value.name, 'value')
          || !ts.isPropertyAccessExpression(value.expression) || !/^(?:currentTarget|target)$/.test(value.expression.name.text)
          || !id(value.expression.expression, callback.parameters[0].name.text);
      })) continue;
      const bound = attrExpression(attr(form.openingElement, 'onSubmit'));
      let handler: FunctionWithBody | undefined;
      if (bound && isFunction(bound)) handler = bound;
      else if (bound && id(bound) && unique(bound.text)) {
        const declaration = declarations.find((d) => id(d.name, bound.text));
        if (declaration?.initializer && isFunction(unwrap(declaration.initializer))) handler = unwrap(declaration.initializer) as FunctionWithBody;
      }
      if (!handler?.body || !ts.isBlock(handler.body) || ('asteriskToken' in handler && handler.asteriskToken) || handler.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) continue;
      // Require event.preventDefault() then one credential branch: otherwise a native form POST
      // could be the real auth step. No optional default-submit semantics are assumed here. No hidden before/after
      // auth steps, returns, timers, arbitrary callbacks, try/finally or interprocedural assumptions.
      const statements = [...handler.body.statements];
      if (statements.length !== 2) continue;
      {
        const prevent = callStatement(statements[0]);
        if (!prevent || !ts.isPropertyAccessExpression(prevent.expression) || !id(prevent.expression.name, 'preventDefault')
          || prevent.arguments.length || handler.parameters.length !== 1 || !id(handler.parameters[0].name)
          || handler.parameters[0].initializer || handler.parameters[0].dotDotDotToken
          || !id(prevent.expression.expression, handler.parameters[0].name.text)) continue;
      }
      const branch = statements[1];
      if (!ts.isIfStatement(branch) || branch.elseStatement) continue;
      if (!ts.isBlock(branch.thenStatement) || branch.thenStatement.statements.length !== 2) continue;
      const fixed = (expression: ts.Expression): string | undefined => {
        if (expired()) return undefined;
        const value = unwrap(expression);
        const text = literal(value);
        if (text !== undefined) return text.length >= 3 && text.length <= 64 && !/[\r\n]/.test(text) ? text : undefined;
        if (!ts.isPropertyAccessExpression(value) || !id(value.expression) || !unique(value.expression.text)) return undefined;
        const name = value.expression.text;
        const declaration = [...moduleDeclarations, ...declarations].find((d) => id(d.name, name));
        if (!declaration?.initializer || !ts.isObjectLiteralExpression(unwrap(declaration.initializer))) return undefined;
        const object = unwrap(declaration.initializer) as ts.ObjectLiteralExpression;
        if (object.properties.some((p) => !ts.isPropertyAssignment(p) || !id(p.name) || literal(p.initializer) === undefined)) return undefined;
        const propertyNames = object.properties.map((p) => id(p.name) ? p.name.text : '');
        if (propertyNames.includes('__proto__') || new Set(propertyNames).size !== propertyNames.length) return undefined;
        const property = object.properties.find((p) => ts.isPropertyAssignment(p) && id(p.name, value.name.text)) as ts.PropertyAssignment | undefined;
        const credential = property && fixed(property.initializer);
        if (!credential) return undefined;
        // No mutation/escape of the fixed object: each other use must be the RHS of direct equality.
        const unmodified = nodes.filter((n) => id(n, name) && n !== declaration.name).every((n) => {
          const access = n.parent;
          const comparison = access.parent;
          return ts.isPropertyAccessExpression(access) && access.expression === n && ts.isBinaryExpression(comparison)
            && comparison.right === access && comparison.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
        });
        return unmodified ? credential : undefined;
      };
      let checksPassword = false;
      const checkedStates = new Set<string>();
      const localCondition = (expression: ts.Expression): boolean => {
        if (expired()) return false;
        const e = unwrap(expression);
        if (!ts.isBinaryExpression(e)) return false;
        if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return localCondition(e.left) && localCondition(e.right);
        if (e.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken || !id(unwrap(e.left))) return false;
        const left = unwrap(e.left) as ts.Identifier;
        const state = states.find((s) => s.value === left.text);
        const credential = fixed(e.right);
        if (checkedStates.has(left.text) || !state || !credential) return false;
        // A fixed initial match or an editable input with its own validated state writer must make
        // each equality reachable. A missing/disabled email field cannot satisfy a fixed email gate.
        if (literal(state.initial) !== credential && !formNodes.some((n) => {
          if (!ts.isJsxSelfClosingElement(n) || !id(n.tagName, 'input') || !id(attrExpression(attr(n, 'value')), state.value)
            || n.attributes.properties.some((p) => ts.isJsxAttribute(p) && /^(?:disabled|readOnly)$/.test(p.name.getText(tree)))) return false;
          const type = attr(n, 'type')?.initializer;
          if (type && (!ts.isStringLiteral(type) || !/^(?:text|password|email|tel|search)$/.test(type.text))) return false;
          const callback = attrExpression(attr(n, 'onChange'));
          return !!callback && ts.isArrowFunction(callback) && ts.isCallExpression(callback.body) && id(callback.body.expression, state.setter);
        })) return false;
        checkedStates.add(left.text);
        if (left.text === password.value) checksPassword = true;
        return true;
      };
      if (!localCondition(branch.expression) || !checksPassword) continue;
      const store = callStatement(branch.thenStatement.statements[0]);
      const mark = callStatement(branch.thenStatement.statements[1]);
      if (!store || !mark || !ts.isPropertyAccessExpression(store.expression) || !id(store.expression.name, 'setItem')
        || !id(store.expression.expression) || !['localStorage', 'sessionStorage'].includes(store.expression.expression.text)
        || allNamedDeclarations.some((n) => id(n.name, (store.expression as ts.PropertyAccessExpression).expression.getText(tree)))
        || store.arguments.length !== 2 || !/^(?:token|authToken|accessToken|sessionToken|session|auth_token|access_token)$/i.test(literal(store.arguments[0]) ?? '')
        || !literal(store.arguments[1]) || !id(mark.expression, auth.setter) || mark.arguments.length !== 1
        || mark.arguments[0].kind !== ts.SyntaxKind.TrueKeyword) continue;
      // The browser storage binding may not be reassigned, passed away or have a method replaced
      // in this source. A call spelling alone does not establish a built-in operation.
      const storageName = store.expression.expression.text;
      if (nodes.filter((n) => id(n, storageName)).some((n) => {
        const access = n.parent;
        return !ts.isPropertyAccessExpression(access) || access.expression !== n
          || !['setItem', 'getItem', 'removeItem', 'clear', 'key'].includes(access.name.text)
          || !ts.isCallExpression(access.parent) || access.parent.expression !== access;
      })) continue;
      if (expired()) return null;
      const line = tree.getLineAndCharacterOfPosition(branch.expression.getStart(tree)).line;
      return { line: line + 1, text: source.split('\n')[line] };
    }
  } catch { /* Malformed/adversarial source is unknown, never a false demo verdict. */ }
  return null;
}
