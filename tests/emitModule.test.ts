/**
 * The emitted-module helper, and the invariant it exists to hold.
 *
 * THE BUG IT CLOSES: 57 generator tests each wrote a scratch `.ts` file into the REAL
 * `src/server/lib/` directory and deleted it moments later. For those seconds the source tree
 * contained a file that is not source code, so any test walking that tree could list it and then fail
 * reading it — which is exactly what happened to `tests/envFlag.test.ts` during the 2026-08-09 audit.
 * The workaround there (skip anything matching `/\._/`) treated the symptom; this is the cause.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { emitModule, EMITTED_DIR } from './helpers/emitModule';

const created: Array<() => void> = [];
afterEach(() => { while (created.length) created.pop()?.(); });

const make = (name: string, src: string) => {
  const m = emitModule(name, src);
  created.push(m.cleanup);
  return m;
};

describe('emitModule', () => {
  it('writes the source where the test can import it back', async () => {
    const m = make('demo', 'export const answer = 42;\n');
    expect(existsSync(m.path)).toBe(true);
    expect(readFileSync(m.path, 'utf8')).toContain('answer = 42');
    const mod = (await import(/* @vite-ignore */ m.href)) as { answer: number };
    expect(mod.answer).toBe(42);
  });

  it('transforms TypeScript — the reason these files cannot live in the OS temp dir', async () => {
    // vite-node only transforms files inside the project root. A `/tmp` artifact would fail on the
    // first type annotation, which is why the fix moved the directory rather than leaving the project.
    const m = make('typed', 'export function twice(n: number): number { return n * 2; }\n');
    const mod = (await import(/* @vite-ignore */ m.href)) as { twice: (n: number) => number };
    expect(mod.twice(21)).toBe(42);
  });

  it('keeps parallel workers apart by pid', () => {
    expect(make('paralleltest', 'export const a = 1;').path).toContain(String(process.pid));
  });

  it('cleanup removes the file and is safe to call twice', () => {
    const m = emitModule('cleanupcheck', 'export const x = 1;');
    expect(existsSync(m.path)).toBe(true);
    m.cleanup();
    expect(existsSync(m.path)).toBe(false);
    expect(() => m.cleanup()).not.toThrow();
  });

  it('sanitises the name so it cannot escape the directory', () => {
    const m = make('../../evil', 'export const x = 1;');
    expect(m.path.startsWith(EMITTED_DIR)).toBe(true);
    expect(m.path).not.toContain('..');
  });
});

describe('🔒 no test writes a scratch module into the source tree', () => {
  it('the emitted directory is outside src/', () => {
    expect(EMITTED_DIR).not.toContain(`${require('path').sep}src${require('path').sep}`);
  });

  it('no generator test builds its own artifact path any more', () => {
    // If this fails, the fix is `emitModule(...)` — not a new hand-rolled path.
    const files = execSync("find src -name '*.test.ts' -o -name '*.test.tsx'", { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const offenders: string[] = [];
    for (const f of files) {
      let src: string;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      if (/_emitted_\$\{process\.pid\}/.test(src)) offenders.push(f);
      if (/writeFileSync\(\s*join\(here,/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('src/server/lib holds only real source and tests — no scratch leftovers', () => {
    const stray = readdirSync('src/server/lib').filter((f) => f.startsWith('._'));
    expect(stray).toEqual([]);
  });
});
