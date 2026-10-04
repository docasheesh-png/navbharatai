// AgentV3 — A METHOD THAT USES `this`, HANDED OUT WITHOUT BEING CALLED, LOSES `this` (autopsy 6cd698cc, 2026-10-01).
//
// The chat app's theme hook was a small store object and a hook that returned its setter:
//
//     const store = { state: { theme }, set(newTheme) { if (this.state.theme !== newTheme) … } };
//     export function useTheme() { return [store.get(), store.set]; }
//
// `store.set` handed out on its own runs with `this === undefined`, so the first press of "☀️ light" threw
// "Cannot read properties of undefined (reading 'state')". tsc is clean on it (TypeScript types `this` in an
// object-literal method as the literal), the build passed, the reviewer passed it, and only the click explorer
// found it — after which the repair was undone (see repairScope.ts) and the app shipped with the broken button.
//
// The shape is decidable from the file alone, so it is named at WRITE time, while the model still holds the
// file (ToolDispatcher.writeSteeringNotes, beside the store-loop note). Precision-first: the object must be a
// `const` initialised with an object literal in this file; the method must read `this` in its own body (not
// inside a nested function); and the reference must be neither called (`store.set(x)`) nor `.call`/`.apply`/
// `.bind`-ed nor assigned to. Destructuring the method out of the object counts too. Advisory — a note appended
// to the tool result, never a blocked or changed write. PURE (the TypeScript parser only). Never throws.

import * as ts from 'typescript';

export interface DetachedMethod {
  file: string;
  line: number;
  object: string;
  method: string;
}

const SOURCE = /\.(?:t|j)sx?$/;
const TEST_FILE = /(^|\/)__(tests?|mocks?)__\/|\.(test|spec)\.[jt]sx?$/i;

/** Kill switch. `off` restores the behaviour before 2026-10-01 exactly: no note, ever. */
export function detachedMethodNoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_DETACHED_METHOD_NOTE ?? '').trim().toLowerCase() !== 'off';
}

/** Does this function body read `this` itself (not inside a nested ordinary function or class)? */
function readsOwnThis(body: ts.Node | undefined): boolean {
  if (!body) return false;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) { found = true; return; }
    // An ordinary function or a class has its own `this`; an arrow shares the method's.
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassLike(n) || ts.isMethodDeclaration(n)
      || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  for (;;) {
    if (ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isTypeAssertionExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isSatisfiesExpression?.(cur)) { cur = cur.expression; continue; }
    return cur;
  }
}

/** The `this`-reading methods of every `const X = { … }` in the file: X → method names. */
function thisMethods(sf: ts.SourceFile): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.Const)) {
      for (const d of n.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (!ts.isObjectLiteralExpression(init)) continue;
        for (const p of init.properties) {
          let name: string | null = null;
          let body: ts.Node | undefined;
          if (ts.isMethodDeclaration(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) { name = p.name.text; body = p.body; }
          else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && ts.isFunctionExpression(unwrap(p.initializer))) {
            name = p.name.text; body = (unwrap(p.initializer) as ts.FunctionExpression).body;
          }
          if (name && readsOwnThis(body)) {
            if (!out.has(d.name.text)) out.set(d.name.text, new Set());
            out.get(d.name.text)!.add(name);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const BOUND_USE = new Set(['call', 'apply', 'bind']);

/** Every place in one file where a `this`-reading method leaves its object without being called. PURE. */
export function findDetachedMethods(file: string, content: string): DetachedMethod[] {
  try {
    if (!SOURCE.test(file) || TEST_FILE.test(file) || typeof content !== 'string' || !content.includes('this')) return [];
    const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
    const methods = thisMethods(sf);
    if (methods.size === 0) return [];
    const out: DetachedMethod[] = [];
    const seen = new Set<string>();
    const add = (node: ts.Node, object: string, method: string): void => {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const key = `${line}:${object}.${method}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ file, line, object, method });
    };
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && methods.get(n.expression.text)?.has(n.name.text)) {
        const parent = n.parent;
        const called = ts.isCallExpression(parent) && parent.expression === n;
        const bound = ts.isPropertyAccessExpression(parent) && parent.expression === n && BOUND_USE.has(parent.name.text);
        const assigned = ts.isBinaryExpression(parent) && parent.left === n && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        const deleted = ts.isDeleteExpression(parent);
        const typeof_ = ts.isTypeOfExpression(parent);
        const tested = (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken)
          || (ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind) && parent.left === n)
          || ts.isIfStatement(parent) || ts.isConditionalExpression(parent) && parent.condition === n;
        if (!called && !bound && !assigned && !deleted && !typeof_ && !tested) add(n, n.expression.text, n.name.text);
      }
      // `const { set } = store` — the method leaves its object here too.
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && ts.isIdentifier(unwrap(n.initializer))) {
        const object = (unwrap(n.initializer) as ts.Identifier).text;
        const ms = methods.get(object);
        if (ms) {
          for (const el of n.name.elements) {
            const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
            if (prop && ms.has(prop)) add(el, object, prop);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  } catch {
    return [];
  }
}

/** The note appended to the write's tool result. '' when there is nothing to say. PURE. */
export function detachedMethodNote(files: Readonly<Record<string, string>>): string {
  if (!detachedMethodNoteEnabled()) return '';
  const found = Object.entries(files).flatMap(([file, content]) => findDetachedMethods(file, content)).slice(0, 4);
  if (found.length === 0) return '';
  const where = found.map((d) => `${d.file}:${d.line} (\`${d.object}.${d.method}\`)`).join(', ');
  const first = found[0];
  return `\n⚠️ ${where}: this hands out a method that reads \`this\` without calling it. Called on its own, \`this\` is undefined and it throws "Cannot read properties of undefined" the first time it runs. `
    + `Wrap it in an arrow that calls it (\`(v) => ${first.object}.${first.method}(v)\`), bind it (\`${first.object}.${first.method}.bind(${first.object})\`), or write the method without \`this\`.`;
}
