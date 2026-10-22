import ts from 'typescript';

/** Inspect actual call arguments, not adjacent source text or comments. */
export function routeMiddlewareArguments(source: string, path: string): string[] {
  const file = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(file) === 'app' && node.expression.name.text === 'post'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (matches.length !== 1) throw new Error(`Expected exactly one POST registration for ${path}, found ${matches.length}`);
  return matches[0].arguments.slice(1).map(argument => argument.getText(file));
}
