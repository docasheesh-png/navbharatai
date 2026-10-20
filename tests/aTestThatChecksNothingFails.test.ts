// A TEST THAT CHECKS NOTHING FAILS (2026-10-11, found by the Q-600 sweep).
//
// Three awareness locks kept tests named "offers a real one-tap navigation target (never a dead button)"
// and "the OFFLINE AI finds …" after the Offline AI was deleted (#2948): their assertions went with the
// module, their bodies were left empty or as loops with no body, and every one of them PASSED while
// checking nothing. A green test that asserts nothing is worse than no test — it is read as proof.
// This census fails on an `it(...)` with an empty body or a `for (...) {}` with an empty body in any test
// file. A match inside a string literal (a fixture that is source code) is not a test and is skipped.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';

function testFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.(ts|tsx|mjs|js)$/.test(n)) out.push(p);
    }
  };
  walk('src'); walk('tests');
  return out;
}

export function emptyTestBodies(src: string, fileName = 'test.ts'): string[] {
  // A necessary condition only, never a verdict: every empty/comment-only block must match this.
  // Avoid parsing files with no candidate at all; source fixtures may match and are resolved by AST.
  const emptyBlock = /\{(?:\s|\/\/[^\r\n\u2028\u2029]*(?:[\r\n\u2028\u2029]|$)|\/\*(?:[^*]|\*(?!\/))*\*\/)*\}/;
  if (!emptyBlock.test(src)) return [];
  // Parse syntax, not the first closing parenthesis in a header: a source-code fixture in a for-of
  // array may itself contain `function login(...) {}`. That is data, never the loop's actual body.
  // The real filename selects TS/TSX/JS parsing for every extension included by the census.
  const file = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, false);
  const tests: string[] = [];
  const loops: string[] = [];
  const record = (out: string[], kind: string, node: ts.Node) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    out.push(`${kind} at line ${line}`);
  };
  const visit = (node: ts.Node): void => {
    // Keep the existing test scope: it(literal title, [async] () => { ... }), including suite.it,
    // but not test/describe, modifiers, function/parameter callbacks, or explicit timeouts.
    if (ts.isCallExpression(node) && !node.questionDotToken && !node.typeArguments && node.arguments.length === 2) {
      const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
      const [title, callback] = node.arguments;
      if (ts.isIdentifier(name) && name.text === 'it'
        && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title) || ts.isTemplateExpression(title))
        && ts.isArrowFunction(callback) && callback.parameters.length === 0
        && !callback.type && !callback.typeParameters
        && ts.isBlock(callback.body) && callback.body.statements.length === 0) {
        record(tests, 'empty test', name);
      }
    }
    if ((ts.isForStatement(node) || ts.isForInStatement(node)
      || (ts.isForOfStatement(node) && !node.awaitModifier))
      && ts.isBlock(node.statement) && node.statement.statements.length === 0) {
      // Comments are trivia, so both a truly empty block and a comment-only block have no statements.
      record(loops, 'empty loop', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...tests, ...loops];
}

describe('a test that checks nothing fails', () => {
  it('the detector sees both shapes, and not a fixture that merely contains them', () => {
    expect(emptyTestBodies("it('does a thing', () => {\n  });")).toHaveLength(1);
    expect(emptyTestBodies("for (const q of ['a', 'b']) {\n    }")).toHaveLength(1);
    expect(emptyTestBodies("const f = { 'a.test.tsx': 'it(\"x\", () => {});' };")).toEqual([]);
    expect(emptyTestBodies("'for (let i = 1; i < 2; i++) {}', // a fixture line")).toEqual([]);
    expect(emptyTestBodies("it('real', () => { expect(1).toBe(1); });")).toEqual([]);
    // A body left with only a comment is still empty (how R6 of this test's own reversion slipped past v1).
    expect(emptyTestBodies("it('stripped', () => {\n    // the assertion that used to be here\n  });")).toHaveLength(1);
    expect(emptyTestBodies("for (const q of qs) {\n  /* gone */\n}")).toHaveLength(1);
    // …but a real test that OPENS with a doc comment is not empty (the false positive v2 had).
    expect(emptyTestBodies("it('real', async () => {\n  /** why */\n  const x = 1;\n  expect(x).toBe(1);\n  /* later */\n});")).toEqual([]);
  });

  it('uses the real body after multiline source fixtures in a loop header', () => {
    const source = [
      'for (const prefix of [',
      '  `const config = { password: ${value} };`,',
      '  `config.password = ${value};`,',
      '  `function login(password: string = ${value}) {}`,',
      ']) {',
      '  expect(redactSecrets(prefix)).not.toContain("syntheticCredential");',
      '}',
    ].join('\n');
    expect(emptyTestBodies(source)).toEqual([]);
    expect(emptyTestBodies(source.replace('  expect(redactSecrets(prefix)).not.toContain("syntheticCredential");', '  /* assertion deleted */')))
      .toEqual(['empty loop at line 1']);
  });

  it.each([
    'for (let i = start(); i < end(); i += step())',
    'for (const value of getValues(nested()))',
    'for (const key in getObject(nested()))',
  ])('recognizes the actual empty body after nested parentheses: %s', (header) => {
    expect(emptyTestBodies(`${header} {}`)).toEqual(['empty loop at line 1']);
    expect(emptyTestBodies(`${header} { /* gone */\n // also gone\n }`)).toEqual(['empty loop at line 1']);
    expect(emptyTestBodies(`${header} { /** why */ expect(true).toBe(true); /* later */ }`)).toEqual([]);
  });

  it('does not mistake quoted, commented or regular-expression source for executable blocks', () => {
    const source = [
      'const fixture = `',
      "it('not a test', () => {});",
      'for (const value of values) {}',
      '`;',
      '// for (const value of values) {}',
      "/* it('not a test', () => {}); */",
      'const pattern = /for (const value of values) {}/;',
      "it('real empty test', async () => { /* gone */ });",
      'for (const value of values) { // gone',
      '}',
    ].join('\n');
    expect(emptyTestBodies(source)).toEqual(['empty test at line 8', 'empty loop at line 9']);
  });

  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
    'retains empty/comment-only blocks across every JavaScript line separator: %j', (newline) => {
      const body = `{\uFEFF /* doc * / still a comment */ // gone${newline}}`;
      expect(emptyTestBodies(`it('stripped', () => ${body});`)).toEqual(['empty test at line 1']);
      expect(emptyTestBodies(`for (const value of getValues()) ${body}`)).toEqual(['empty loop at line 1']);
      expect(emptyTestBodies(`it('real', () => { // why${newline}expect(true).toBe(true); });`)).toEqual([]);
    },
  );

  it('preserves direct property it calls and the line where the test name starts', () => {
    expect(emptyTestBodies("suite.\nit('stripped', () => { /* gone */ });"))
      .toEqual(['empty test at line 2']);
    expect(emptyTestBodies("suite.it('real', () => { expect(true).toBe(true); });")).toEqual([]);
  });

  it('keeps the existing callback and loop scope instead of expanding the census', () => {
    const source = [
      "test('not in this census', () => {});",
      "describe('not in this census', () => {});",
      "it.skip('not in this census', () => {});",
      "it.each([1])('not in this census', () => {});",
      "it('function callback', function () {});",
      "it('parameter callback', (context) => {});",
      "it('explicit timeout', () => {}, 1000);",
      "it('typed callback', (): void => {});",
      "suite['it']('computed name', () => {});",
      'for (const value of values) continue;',
      'for await (const value of values) {}',
    ].join('\n');
    expect(emptyTestBodies(source)).toEqual([]);
  });

  it.each(['example.test.ts', 'example.test.tsx', 'example.test.js', 'example.test.mjs'])(
    'parses census file syntax and reports original line numbers: %s', (fileName) => {
      const prefix = fileName.endsWith('.tsx')
        ? 'const view = <div title="for (const value of values) {{}}" />;'
        : fileName.endsWith('.ts') ? 'const value = <number>1;' : 'const value = identity(1);';
      const source = [prefix, "it('empty', () => { /* gone */ });", 'for (const value of values) {}'].join('\r\n');
      expect(emptyTestBodies(source, fileName)).toEqual(['empty test at line 2', 'empty loop at line 3']);
    },
  );

  it('CENSUS: no test file has an empty test or an empty loop', () => {
    const offenders = testFiles().flatMap((f) => emptyTestBodies(readFileSync(f, 'utf8'), f).map((h) => `${f}: ${h}`));
    expect(offenders).toEqual([]);
  });
});
