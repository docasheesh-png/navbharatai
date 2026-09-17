import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { braceBlock, enclosingBlock, sectionUntil, anchorOf, codeOnly } from './helpers/sourceSlice';

/**
 * 🔴 SEVEN SOURCE-READING GUARDS BROKE ON CORRECT CODE IN ONE DAY (2026-09-17). This file is the
 * shared answer's own test, because a helper written to stop tests being wrong has to be right.
 *
 * The class has two halves, and the second is strictly worse:
 *
 *   • A FIXED WINDOW cries wolf — `slice(at, at + 700)` fails while the invariant holds, because
 *     somebody added a field. Noisy, but visible; you go and widen the number.
 *   • A MISSING ANCHOR goes SILENT — `indexOf` returns `-1`, the slice is junk, and the assertion
 *     passes for reasons unrelated to the claim. THREE guards in one file passed with the code
 *     REVERTED that day. A guard that cannot fail is not a guard, and unlike the noisy kind it never
 *     tells you.
 */

describe('anchorOf — the missing-anchor class, made unwritable', () => {
  it('returns the index when the needle is there', () => {
    expect(anchorOf('alpha beta gamma', 'beta')).toBe(6);
  });

  it('🔴 THROWS when it is not — never -1, which is what made three guards vacuous', () => {
    expect(() => anchorOf('alpha beta', 'delta')).toThrow(/is not in this source/);
    // The message names the needle, so the output alone says what to fix.
    expect(() => anchorOf('alpha beta', 'delta')).toThrow(/"delta"/);
  });

  it('says to RE-ANCHOR rather than widen — the wrong lesson is the expensive one', () => {
    // "Widen the number and move on" is how a real regression eventually slips through one of these.
    expect(() => anchorOf('x', 'y')).toThrow(/re-anchor the test rather than widening it/);
  });

  it('the junk slices it prevents, demonstrated on a realistic file length', () => {
    // ⚠️ THE LENGTH MATTERS, and my first draft got it wrong: on a 50-character string
    // `slice(-301, 299)` clamps to the whole thing rather than to nothing. The vacuous guards ran
    // against a ~30,000-character source file, where `-301` means "301 back from the end" and the
    // range therefore inverts. Demonstrated at a real file's scale, or the demonstration is not one.
    const src = 'x'.repeat(30_000);
    const at = src.indexOf('missing'); // -1
    expect(at).toBe(-1);
    // The two shapes the three vacuous guards were actually asserting against:
    expect(src.slice(0, at)).toHaveLength(29_999);   // very nearly the whole file
    expect(src.slice(at - 300, at + 299)).toBe('');  // …and nothing at all
    // …so a `not.toContain` against either passes whatever the code says.
    expect(src.slice(at - 300, at + 299)).not.toContain('anything');
    expect(src.slice(0, at)).not.toContain('anything');
  });

  it('never throws on junk input — it reports the missing needle, not a crash', () => {
    expect(() => anchorOf(undefined as never, 'x')).toThrow(/is not in this source/);
  });
});

describe('codeOnly — prose can neither satisfy nor defeat an assertion about code', () => {
  it('removes block comments and whole-line // comments', () => {
    const src = [
      '/* a block comment mentioning forbiddenPhrase */',
      '  // a whole-line comment mentioning forbiddenPhrase',
      'const real = 1;',
    ].join('\n');
    const out = codeOnly(src);
    expect(out).not.toContain('forbiddenPhrase');
    expect(out).toContain('const real = 1;');
  });

  it('🔴 the real case: a comment that quotes the wording its own guard forbids', () => {
    // This repo's comments legitimately say "the old wording was X" while the guard asserts X is gone.
    // One draft that day flagged its own explanation as the bug.
    const src = '// the old wording was "with NOTHING recorded" and it had to go\nconst msg = "no work recorded";';
    expect(codeOnly(src)).not.toContain('with NOTHING recorded');
    expect(codeOnly(src)).toContain('no work recorded');
  });

  it('⚠️ LEAVES a trailing // alone — stripping from any // would eat every URL', () => {
    // The restraint IS the correctness: this codebase is full of https:// in real strings, and
    // over-stripping would silently shorten the very text being asserted on.
    const src = "const doc = 'https://docs.z.ai/pricing'; // see the rate card";
    const out = codeOnly(src);
    expect(out).toContain('https://docs.z.ai/pricing');
    // Under-stripping is the accepted cost — the trailing comment survives, which is merely noisy.
    expect(out).toContain('see the rate card');
  });

  it('never throws on junk', () => {
    expect(codeOnly(undefined as never)).toBe('');
    expect(codeOnly('')).toBe('');
  });
});

describe('the three older helpers still do what they claim', () => {
  it('braceBlock takes the balanced block at or after its marker', () => {
    const src = 'before\nfunction f() { const a = { b: 1 }; return a; }\nafter';
    const block = braceBlock(src, 'function f()');
    expect(block).toContain('const a = { b: 1 }');
    expect(block).toContain('return a;');
    expect(block).not.toContain('after');
  });

  it('enclosingBlock takes the literal CONTAINING the marker, fields before it included', () => {
    const src = "record({ phase: 'build', code: 'X', autoResolved: false });";
    const block = enclosingBlock(src, "code: 'X'");
    expect(block).toContain("phase: 'build'");     // before the marker
    expect(block).toContain('autoResolved: false'); // after it
  });

  it('sectionUntil is the escape hatch when brace matching would read a TYPE', () => {
    const src = 'function f(): Promise<{ ok: true }> { body(); }\nfunction g() {}';
    expect(sectionUntil(src, 'function f()', 'function g()')).toContain('body();');
  });

  it('all three answer "" for an absent marker — which an assertion catches', () => {
    // This is why `anchorOf` exists only for the bare-indexOf case: these already fail closed.
    for (const out of [braceBlock('x', 'nope'), enclosingBlock('x', 'nope'), sectionUntil('x', 'nope', 'y')]) {
      expect(out).toBe('');
    }
  });
});

/** ⚠️ The duplicate this change deleted must not come back. */
describe('no test re-implements a helper that already exists here', () => {
  it('objectLiteralAround is gone — enclosingBlock was already doing it', () => {
    // #3037 added a local `objectLiteralAround` because I wrote the helper instead of searching
    // `tests/helpers/`. Safeguard #6's own failure mode: "my search found nothing" was never a search.
    const stream = codeOnly(readFileSync(join(__dirname, 'streamRacePolicy.test.ts'), 'utf8'));
    expect(stream).not.toContain('function objectLiteralAround');
    expect(stream).toContain("enclosingBlock(chat, 'streamed: true')");
  });
});
