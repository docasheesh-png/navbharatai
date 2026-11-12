import ts from 'typescript';

const RESTORE_NAME = /restore|revert|rollback/i;

function mayNameRestore(text: string): boolean {
  if (RESTORE_NAME.test(text)) return true;
  if (!text.includes('\\')) return false;
  // Encoded characters (including malformed possible encodings) always need the AST. Remaining
  // escapes can only retain their next character, insert a control character or continue a line:
  // removing the slash/continuation overincludes those names instead of hiding an identity escape.
  if (/\\(?:[ux]|[0-7])/i.test(text)) return true;
  return RESTORE_NAME.test(text.replace(/\\(?:\r\n|[\r\n\u2028\u2029])/g, '').replace(/\\/g, ''));
}

export function restoreMutations(path: string, text: string, parsed?: ts.SourceFile): Array<{ key: string; body: string }> {
  if (!mayNameRestore(text)) return [];
  // Parent-link construction walks the whole tree again. This census needs only the immediate
  // parent of a function, so carry that relation through the same visitor instead. Existing parsed
  // files keep their real parent links, which also provide the reference path in the fixture tests.
  const file = parsed ?? ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false);
  let currentParent: ts.Node = file;
  const found: Array<{ key: string; body: string }> = [];
  function visit(node: ts.Node) {
    const traversalParent = currentParent;
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const parent = node.parent ?? traversalParent;
      const named = node.name ?? ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) ? parent.name : undefined);
      const literalName = named && ts.isComputedPropertyName(named) ? named.expression : named;
      // Identifier/string .text decodes escaped spellings such as res\u0074ore. Other names retain
      // the previous raw-text check, so this optimisation cannot narrow the existing census.
      const name = literalName && (ts.isIdentifier(literalName) || ts.isStringLiteralLike(literalName))
        ? literalName.text : named?.getText(file);
      if (name && RESTORE_NAME.test(name)) {
        function calls(child: ts.Node): boolean {
          if (ts.isCallExpression(child) && /(?:\.(?:writeFiles?|writeBinaryFile|removeFile|runCommand|write|remove|execInContainer|run|restore|git)|(?:^|\.)apply(?:Green)?SnapshotRestore|writeWorkspaceFiles|mergeWorkspaceFiles|saveWorkspaceFiles|removeWorkspaceFiles|execPromise)$/.test(child.expression.getText(file))) return true;
          // This is an existence query. Stop only this body's mutation search after a match; the
          // separate outer visitor still visits every nested function and classifies it in turn.
          return ts.forEachChild(child, calls) === true;
        }
        if (calls(node.body)) found.push({ key: `${path}#${name}`, body: node.getText(file) });
      }
    }
    currentParent = node;
    ts.forEachChild(node, visit);
    currentParent = traversalParent;
  }
  visit(file);
  return found;
}
