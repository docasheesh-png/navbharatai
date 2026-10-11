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

/** True when the match starts inside a quoted string on its own line (an odd count of a quote before it). */
function insideString(src: string, at: number): boolean {
  const lineStart = src.lastIndexOf('\n', at - 1) + 1;
  const before = src.slice(lineStart, at);
  return ['\'', '"', '`'].some((q) => (before.split(q).length - 1) % 2 === 1);
}

export function emptyTestBodies(src: string): string[] {
  const found: string[] = [];
  // "Empty" includes a body holding only comments — the shape a stripped test most often leaves behind
  // (an explanatory comment above an assertion that was deleted).
  // A block comment may not run PAST its own `*/` — a lazy `[\s\S]*?` would backtrack across a closing
  // `*/` to a later one and call a real test with a doc comment at its top "empty".
  const blank = String.raw`(?:\s|\/\/[^\n]*(?:\n|$)|\/\*(?:[^*]|\*(?!\/))*\*\/)*`;
  const shapes: Array<[RegExp, string]> = [
    [new RegExp(String.raw`\bit\(\s*(['"\x60])(.*?)\1\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{` + blank + String.raw`\}\s*\)`, 'g'), 'empty test'],
    [new RegExp(String.raw`\bfor\s*\([^)]*\)\s*\{` + blank + String.raw`\}`, 'g'), 'empty loop'],
  ];
  for (const [re, kind] of shapes) {
    for (const m of src.matchAll(re)) {
      if (insideString(src, m.index ?? 0)) continue;
      found.push(`${kind} at line ${src.slice(0, m.index).split('\n').length}`);
    }
  }
  return found;
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

  it('CENSUS: no test file has an empty test or an empty loop', () => {
    const offenders = testFiles().flatMap((f) => emptyTestBodies(readFileSync(f, 'utf8')).map((h) => `${f}: ${h}`));
    expect(offenders).toEqual([]);
  });
});
