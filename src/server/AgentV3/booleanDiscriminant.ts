import * as ts from 'typescript';
import { posix } from 'node:path';
import type { TscError } from './EndgameRepair';

/** Works in both compiler modes; shared by generation and repair prompts. */
export const BOOLEAN_DISCRIMINANT_RULE =
  '- For boolean-discriminated unions, write `if (result.ok === true)` or `if (result.ok === false)`, '
  + 'never `if (result.ok)` / `if (!result.ok)`: truthiness does not narrow both branches when strictNullChecks is off. '
  + 'Keep the union and the compiler settings; do not add casts or make variant-only fields optional.';

interface Edit { start: number; end: number; text: string }
const canonical = (path: string) => posix.normalize(`/${path.replace(/\\/g, '/')}`);
const MAX_FILES = 64;
const MAX_CHARS = 512_000;

/**
 * Repair the guard, not the union (calculator report 9fba77d7). Only an actual TS2339 location,
 * the same receiver symbol, and a compiler-proven true/false discriminant can authorize an edit.
 * Named aliases and imported aliases are resolved by the compiler, not by diagnostic-text regexes.
 * No I/O or model call; the caller still writes and re-verifies through its ordinary hard gate.
 */
export function repairBooleanDiscriminants(
  files: Record<string, string>, errors: readonly TscError[],
): { files: Record<string, string>; fixed: string[] } {
  const candidates = errors.filter(e => e.code === 'TS2339' && typeof files[e.file] === 'string');
  if (candidates.length === 0) return { files, fixed: [] };
  const paths = new Map(Object.keys(files).map(path => [canonical(path), path]));
  const sources = new Map<string, ts.SourceFile>();
  const pending = candidates.map(e => canonical(e.file));
  let chars = 0;
  const resolve = (name: string, from: string): string | undefined => {
    if (!name.startsWith('.')) return undefined;
    const base = posix.resolve(posix.dirname(from), name);
    const stems = /\.[cm]?jsx?$/.test(base) ? [base.replace(/\.[cm]?jsx?$/, ''), base] : [base];
    return stems.flatMap(stem => [stem, `${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`, `${stem}/index.ts`, `${stem}/index.tsx`])
      .find(path => paths.has(path));
  };
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (sources.has(path)) continue;
    const original = paths.get(path);
    if (!original || !/\.[cm]?[jt]sx?$/.test(path)) continue;
    const content = files[original];
    chars += content.length;
    if (sources.size >= MAX_FILES || chars > MAX_CHARS) return { files, fixed: [] };
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    sources.set(path, source);
    for (const statement of source.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
        || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const dependency = resolve(statement.moduleSpecifier.text, path);
      if (dependency) pending.push(dependency);
    }
  }
  const options: ts.CompilerOptions = {
    noLib: true, strictNullChecks: false, allowJs: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve,
  };
  const host: ts.CompilerHost = {
    getSourceFile: name => sources.get(canonical(name)),
    getDefaultLibFileName: () => '/lib.d.ts', writeFile: () => {},
    getCurrentDirectory: () => '/', getDirectories: () => [],
    fileExists: name => sources.has(canonical(name)),
    readFile: name => sources.get(canonical(name))?.text,
    getCanonicalFileName: canonical, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, from) => names.map(name => {
      const path = resolve(name, from);
      return path && sources.has(path) ? { resolvedFileName: path } : undefined;
    }),
  };
  const checker = ts.createProgram([...sources.keys()], options, host).getTypeChecker();
  const edits = new Map<string, Map<number, Edit>>();
  for (const error of candidates) {
    const source = sources.get(canonical(error.file));
    const member = /^Property '([^']+)' does not exist on type '/.exec(error.message)?.[1];
    if (!source || !member || error.line < 1 || error.line > source.getLineStarts().length) continue;
    const position = source.getPositionOfLineAndCharacter(error.line - 1, Math.max(0, error.col - 1));
    let access: ts.PropertyAccessExpression | undefined;
    const locate = (node: ts.Node): void => {
      if (position < node.getStart(source) || position >= node.end) return;
      if (ts.isPropertyAccessExpression(node) && node.name.text === member) access = node;
      ts.forEachChild(node, locate);
    };
    locate(source);
    if (!access || !ts.isIdentifier(access.expression) || access.questionDotToken) continue;
    const receiver = checker.getSymbolAtLocation(access.expression);
    if (!receiver) continue;
    for (let parent: ts.Node | undefined = access.parent; parent; parent = parent.parent) {
      if (!ts.isIfStatement(parent)) continue;
      let condition = parent.expression;
      while (ts.isParenthesizedExpression(condition)) condition = condition.expression;
      const negated = ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken;
      let flag = negated ? (condition as ts.PrefixUnaryExpression).operand : condition;
      while (ts.isParenthesizedExpression(flag)) flag = flag.expression;
      if (!ts.isPropertyAccessExpression(flag) || !ts.isIdentifier(flag.expression) || flag.questionDotToken
        || checker.getSymbolAtLocation(flag.expression) !== receiver) continue;
      const discriminant = flag;
      const union = checker.getTypeAtLocation(discriminant.expression);
      if (!union.isUnion()) continue;
      const thenBranch = access.pos >= parent.thenStatement.pos && access.end <= parent.thenStatement.end;
      const elseBranch = parent.elseStatement && access.pos >= parent.elseStatement.pos && access.end <= parent.elseStatement.end;
      if (!thenBranch && !elseBranch) continue;
      const expected = thenBranch ? !negated : negated;
      let sawTrue = false;
      let sawFalse = false;
      let branchHasMember = false;
      const proven = union.types.every(variant => {
        const symbol = variant.getProperty(discriminant.name.text);
        if (!symbol || (symbol.flags & ts.SymbolFlags.Optional) !== 0) return false;
        const type = checker.getTypeOfSymbolAtLocation(symbol, discriminant);
        if ((type.flags & ts.TypeFlags.BooleanLiteral) === 0) return false;
        const literal = checker.typeToString(type);
        if (literal !== 'true' && literal !== 'false') return false;
        const value = literal === 'true';
        if (value) sawTrue = true; else sawFalse = true;
        if (value !== expected) return true;
        branchHasMember = true;
        return variant.getProperty(member) !== undefined;
      });
      if (!proven || !sawTrue || !sawFalse || !branchHasMember) continue;
      const byStart = edits.get(error.file) ?? new Map<number, Edit>();
      const start = parent.expression.getStart(source);
      byStart.set(start, { start, end: parent.expression.end,
        text: `${discriminant.getText(source)} === ${negated ? 'false' : 'true'}` });
      edits.set(error.file, byStart);
      break;
    }
  }
  const out = { ...files };
  const fixed: string[] = [];
  for (const [path, byStart] of edits) {
    for (const edit of [...byStart.values()].sort((a, b) => b.start - a.start)) {
      out[path] = out[path].slice(0, edit.start) + edit.text + out[path].slice(edit.end);
      fixed.push(`${path}: compared the boolean discriminant explicitly (${edit.text})`);
    }
  }
  return { files: out, fixed };
}
