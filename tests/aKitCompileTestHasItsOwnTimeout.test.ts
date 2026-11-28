// ⏱️ A TEST THAT COMPILES KIT FILES FROM DISK HAS ITS OWN TIMEOUT (2026-11-26, PR #4595's red CI). A strict ts.createProgram
// over the generated kit takes seconds locally and passes the 20 s vitest default under CI coverage; the street-danger
// compile test had no timeout of its own and failed a PR whose diff never touched it. The class: "a whole-kit compile on
// the default timeout". Every test file that hands ts.createProgram files from a temp directory gives that test ≥ 60 s.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

describe('census: kit compiles carry an explicit timeout', () => {
  it("every ts.createProgram inside a test, over files joined from a temp directory, has that test's own timeout of at least 60 s", () => {
    const offenders: string[] = [];
    for (const f of readdirSync('tests').filter((n) => n.endsWith('.test.ts'))) {
      const src = readFileSync(`tests/${f}`, 'utf8');
      for (const m of src.matchAll(/ts\.createProgram\(/g)) {
        // The enclosing test: the last `it(` before the call, and the first line after it that closes at that indentation.
        const before = src.slice(0, m.index!);
        const itAt = Math.max(before.lastIndexOf('\nit('), ...[...before.matchAll(/\n([ \t]*)it\(/g)].map((x) => x.index!));
        const indent = (/\n([ \t]*)it\(/.exec(src.slice(itAt)) ?? ['', ''])[1];
        // A helper defined outside any test (its callers own the timeout) is not this census's business.
        if (itAt < 0 || new RegExp('\\n' + indent + '\\}').test(src.slice(itAt + 1, m.index!))) continue;
        // Files from a temp directory on disk (the kit, written out) — an in-memory program is small and fast.
        if (!/join\((?:DIR|dir)\b/.test(src.slice(itAt, m.index! + 400))) continue;
        const close = new RegExp('\\n' + indent + '\\}\\s*(?:,\\s*(\\d[\\d_]*)\\s*)?\\);').exec(src.slice(m.index!));
        const ms = close && close[1] ? Number(close[1].replace(/_/g, '')) : 0;
        if (!(ms >= 60_000)) offenders.push(f);
      }
    }
    expect(offenders, 'give the compiling test its own timeout: }, 120_000);').toEqual([]);
  });

  // The same class, second shape (2026-11-27, PR #4619's red CI): the import healer run over the WHOLE recipe set parses
  // every recipe file at once (147 files, 2.3 MB that day). Its cost grows with every kit added, so it crosses the 20 s
  // default under coverage on some unrelated PR. Every test handing the whole recipe set to an analysis owns ≥ 60 s.
  it('every test that runs an analysis over the whole game-recipe set has its own timeout of at least 60 s', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of readdirSync('tests').filter((n) => n.endsWith('.test.ts'))) {
      const src = readFileSync(`tests/${f}`, 'utf8');
      // The helper that joins every recipe's files: `const NAME = (...) => ... Object.values(GAME_RECIPES) ...`.
      for (const h of src.matchAll(/const (\w+) = \([^)]*\)[^\n]*=>[^\n]*Object\.values\(GAME_RECIPES\)/g)) {
        for (const m of src.matchAll(new RegExp(`await \\w+\\(${h[1]}\\(\\)`, 'g'))) {
          seen++;
          const before = src.slice(0, m.index!);
          const itAt = Math.max(...[...before.matchAll(/\n([ \t]*)it\(/g)].map((x) => x.index!));
          const indent = (/\n([ \t]*)it\(/.exec(src.slice(itAt)) ?? ['', ''])[1];
          const close = new RegExp('\\n' + indent + '\\}\\s*(?:,\\s*(\\d[\\d_]*)\\s*)?\\);').exec(src.slice(m.index!));
          const ms = close && close[1] ? Number(close[1].replace(/_/g, '')) : 0;
          if (!(ms >= 60_000)) offenders.push(`${f}: ${m[0]}`);
        }
      }
    }
    expect(seen, 'the census must find the whole-recipe healer test it was written for').toBeGreaterThan(0);
    expect(offenders, 'give the test its own timeout: }, 120_000);').toEqual([]);
  });
});
