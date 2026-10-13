// A census of model-facing INSTRUCTIONS in source: every prose unit that matches a class of instruction must
// carry a named shared constant, or be on an allowlist that says why it does not need to.
//
// Written for autopsy 9c612cdb (Q-986, Q-987), where two instructions — "add the rules to the stylesheet" and
// "keep the plan updated" — had each been written in several places without the one sentence that makes the
// first attempt right. A census over the source is what keeps a NEW copy of such an instruction from being
// written without it: a fix to the known copies alone is a fix to today's instances, not to the class.
//
// The unit is the whole string EXPRESSION, not one literal: `'record the plan ' + 'with update_todo'` is one
// instruction even though it is two literals. A unit is covered when the constant's IDENTIFIER (never a
// comment that names it) appears in the unit, or — for a line of a prompt written as an array of lines — in
// one of the two lines either side of it.
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface CensusHit {
  /** Repo-relative path. */
  file: string;
  line: number;
  /** The unit's prose: its literals' text, with `${expr}` for an interpolation. */
  text: string;
  covered: boolean;
}

/** Every non-test `.ts` file under `dir` (repo-relative paths). */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(relative(process.cwd(), p));
    }
  };
  walk(dir);
  return out.sort();
}

const isStringish = (n: ts.Node): boolean =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);

/** Climb from a literal to the top of its string expression (`+` chains and parentheses). */
function unitOf(n: ts.Node): ts.Node {
  let cur = n;
  for (;;) {
    const p = cur.parent;
    if (!p) return cur;
    if (ts.isParenthesizedExpression(p)) { cur = p; continue; }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken) { cur = p; continue; }
    return cur;
  }
}

/** The operands of a string expression: a `+` chain flattened, parentheses removed. */
function operands(n: ts.Node): ts.Node[] {
  if (ts.isParenthesizedExpression(n)) return operands(n.expression);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...operands(n.left), ...operands(n.right)];
  return [n];
}

/** The unit's prose. Only its own literals are read — never a nested call's or array's (a `[...].join() + x`). */
function proseOf(unit: ts.Node, sf: ts.SourceFile): string {
  return operands(unit).map((op) => {
    if (ts.isStringLiteral(op) || ts.isNoSubstitutionTemplateLiteral(op)) return op.text;
    if (ts.isTemplateExpression(op)) {
      return op.head.text + op.templateSpans.map((s) => `\${${s.expression.getText(sf)}}${s.literal.text}`).join('');
    }
    if (ts.isIdentifier(op)) return `\${${op.text}}`;
    return '';
  }).join('');
}

/** Does this string expression carry the constant — as an operand, or interpolated into one of its templates? */
function carries(unit: ts.Node, name: string): boolean {
  return operands(unit).some((op) => (ts.isIdentifier(op) && op.text === name)
    || (ts.isTemplateExpression(op) && op.templateSpans.some((s) => ts.isIdentifier(s.expression) && s.expression.text === name)));
}

/**
 * Every string-expression unit in `files` whose prose matches any of `classes`, and whether it carries
 * `constantName`.
 */
export function instructionCensus(files: readonly string[], classes: readonly RegExp[], constantName: string): CensusHit[] {
  const hits: CensusHit[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const seen = new Set<number>();
    const visit = (n: ts.Node): void => {
      if (isStringish(n)) {
        const unit = unitOf(n);
        const at = unit.getStart(sf);
        if (!seen.has(at)) {
          seen.add(at);
          const prose = proseOf(unit, sf);
          if (classes.some((re) => re.test(prose))) {
            let covered = carries(unit, constantName);
            const arr = unit.parent;
            if (!covered && arr && ts.isArrayLiteralExpression(arr)) {
              const i = arr.elements.indexOf(unit as ts.Expression);
              for (let k = Math.max(0, i - 2); k <= Math.min(arr.elements.length - 1, i + 2); k++) {
                if (carries(arr.elements[k], constantName)) covered = true;
              }
            }
            hits.push({ file, line: sf.getLineAndCharacterOfPosition(at).line + 1, text: prose, covered });
          }
        }
        if (!ts.isTemplateExpression(n)) return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits;
}
