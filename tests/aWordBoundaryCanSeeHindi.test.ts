/**
 * QUEUE Q-103, AND ITS WHOLE CLASS: A `\b` BESIDE A DEVANAGARI LETTER CAN NEVER MATCH.
 *
 * JavaScript's `\b` is an ASCII boundary. Every Devanagari letter is a "non-word" character to it, so
 * between "मत" and the space after it there is no boundary at all, and `/मत\b/` matches nothing,
 * ever. Each such regex looks like it reads Hindi and silently does not. Found in eight files on
 * 2026-10-04, among them:
 *   - `publishConsent.ts` `/मत\b/`: "पब्लिश करो, पर अभी मत" (publish it, but not now) published;
 *   - `transitLive.ts` / `liveSearchContext.ts`: "ट्रेन 12951 कहाँ है" never reached live train status;
 *   - `claimAudit.ts`: a Hindi "console has no errors" claim was never audited (the queue row).
 *
 * The census below reads every regex LITERAL in the shipped source with the TypeScript parser, and
 * fails on a `\b` whose neighbour can be a Devanagari letter: directly, through a character class,
 * or through any alternative of an adjacent group. A Devanagari word boundary is written as a
 * lookaround (`(?<![\wऀ-ॿ])`), or, in code that ships to phones, a consuming
 * `(?:^|[^\wऀ-ॿ])`, because Safari 14 (in our build targets) has no lookbehind.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import ts from 'typescript';
import { decidePublishConsent } from '../src/server/AgentV3/publishConsent';
import { detectTransitQuery } from '../src/server/lib/transitLive';
import { shapeSearchQuery } from '../src/server/lib/liveSearchContext';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { APNAPAN_GREETINGS } from '../src/lib/apnapanEngine';

const ROOT = join(__dirname, '..');
const DEVA = /[ऀ-ॿ]/;

/** The index of the bracket that closes the one opened at `open`, honouring escapes and classes. */
function closeOf(p: string, open: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = open; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The index of the bracket that opens the group closed at `close`. */
function openOf(p: string, close: number): number {
  for (let i = close - 1; i >= 0; i--) {
    if (p[i] === '(' && closeOf(p, i) === close) return i;
  }
  return -1;
}

/** Top-level alternatives of a group's body. */
function alternatives(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inClass = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  return out;
}

const groupBody = (p: string, open: number, close: number) =>
  p.slice(open + 1, close).replace(/^\?(?::|=|!|<=|<!|<[A-Za-z_]\w*>)/, '');

/** Can this fragment BEGIN with a Devanagari letter? */
function startsDeva(frag: string): boolean {
  const f = frag.replace(/^\s+/, '');
  if (!f) return false;
  if (DEVA.test(f[0])) return true;
  if (f[0] === '[') return DEVA.test(f.slice(1, f.indexOf(']') + 1 || undefined));
  if (f[0] === '(') {
    const close = closeOf(f, 0);
    return close > 0 && alternatives(groupBody(f, 0, close)).some(startsDeva);
  }
  return false;
}

/** Can this fragment END with a Devanagari letter? */
function endsDeva(frag: string): boolean {
  let f = frag.replace(/\s+$/, '');
  f = f.replace(/(?:[?*+]|\{\d+(?:,\d*)?\})\??$/, '');
  if (!f) return false;
  const last = f[f.length - 1];
  if (DEVA.test(last) && f[f.length - 2] !== '\\') return true;
  if (last === ']') return DEVA.test(f.slice(f.lastIndexOf('[')));
  if (last === ')') {
    const open = openOf(f, f.length - 1);
    return open >= 0 && alternatives(groupBody(f, open, f.length - 1)).some(endsDeva);
  }
  return false;
}

/** Every `\b` in a pattern whose neighbour can be a Devanagari letter. */
export function deadBoundaries(p: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== '\\') continue;
    if (p[i + 1] !== 'b') { i++; continue; }
    const right = p.slice(i + 2);
    const left = p.slice(0, i);
    if (startsDeva(right) || endsDeva(left)) out.push(i);
    i++;
  }
  return out;
}

function regexLiteralsIn(file: string): Array<{ line: number; pattern: string }> {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Array<{ line: number; pattern: string }> = [];
  const visit = (n: ts.Node) => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const lit = n.getText(sf);
      const pattern = lit.slice(1, lit.lastIndexOf('/'));
      found.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, pattern });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('the detector itself', () => {
  it('finds a boundary beside a letter, a class, and either end of a group', () => {
    expect(deadBoundaries('मत\\b')).toHaveLength(1);
    expect(deadBoundaries('\\bनमस्ते')).toHaveLength(1);
    expect(deadBoundaries('\\b(?:console|कंसोल)\\b')).toHaveLength(2);
    expect(deadBoundaries('(?:चल रह[ाी] है)\\b')).toHaveLength(1);
    expect(deadBoundaries('रह[ाी]\\b')).toHaveLength(1);
  });

  it('leaves a Latin-only boundary and a Devanagari alternative with no boundary alone', () => {
    expect(deadBoundaries('\\bmap\\b|naksha|नक्शा|\\bborder\\b')).toHaveLength(0);
    expect(deadBoundaries('(?:ऐप|साइट|\\b(?:app|site)\\b)')).toHaveLength(0);
    expect(deadBoundaries('(?<![\\w\\u0900-\\u097F])मत(?![\\u0900-\\u097F])')).toHaveLength(0);
  });
});

describe('🔒 census: no shipped regex puts \\b beside a Devanagari letter', () => {
  it('every regex literal in the shipped source', () => {
    const files = execSync('git ls-files src server.ts', { cwd: ROOT }).toString().trim().split('\n')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    const dead: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      if (!DEVA.test(text)) continue;
      for (const { line, pattern } of regexLiteralsIn(f)) {
        if (deadBoundaries(pattern).length) dead.push(`${f}:${line}  /${pattern.slice(0, 90)}/`);
      }
    }
    expect(dead).toEqual([]);
  });
});

describe('what the dead boundaries were costing', () => {
  it('"publish it, but not now" in Hindi is not a publish', () => {
    expect(decidePublishConsent('ऐप लाइव कर दो, पर अभी मत').consent).toBe('denied');
    expect(decidePublishConsent('पब्लिश मत करो').consent).toBe('denied');
  });

  it('"मतलब" (meaning) and "मतदान" (voting) are not "मत" (do not)', () => {
    expect(decidePublishConsent('पब्लिश करो, मतलब लाइव कर दो').consent).toBe('granted');
  });

  it('a Hindi "publish it" is read, like "publish karo"', () => {
    expect(decidePublishConsent('ऐप पब्लिश करो').consent).toBe('granted');
    expect(decidePublishConsent('publish karo').consent).toBe('granted');
  });

  it('a train asked about in Hindi reaches live running status', () => {
    expect(detectTransitQuery('ट्रेन 12951 कहाँ है')).toEqual({ kind: 'train', trainNo: '12951' });
    expect(shapeSearchQuery('ट्रेन 12951 कहाँ है', new Date('2026-10-04T00:00:00Z'))).toMatch(/^train 12951 live running status/);
  });

  it('a Hindi "the console is clean" claim is audited like the English one', () => {
    const claims = auditSummaryClaims('कंसोल में कोई गलती नहीं है, सब ठीक है।', { consoleCaptured: false } as never);
    expect(claims.length).toBeGreaterThan(0);
  });

  it('a Hindi greeting is recognised', () => {
    const namaste = APNAPAN_GREETINGS.find((g) => g.key === 'नमस्ते')!;
    expect(namaste.patterns.test('नमस्ते जी')).toBe(true);
    expect(namaste.patterns.test('namaste ji')).toBe(true);
  });
});
