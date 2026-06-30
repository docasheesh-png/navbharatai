import { describe, it, expect } from 'vitest';
import { replaceSymbol, listSymbols } from '../src/server/AppMakerLab/generator/ASTPatching';

/** P-CGE.1 — AST-based partial patching (pure, TS compiler API). */

const SRC = `import { x } from './x';

export function add(a: number, b: number) {
  return a + b;
}

export const PI = 3.14;

export class Calc {
  run() { return add(1, 2); }
}

interface Opts { verbose: boolean; }
`;

describe('listSymbols', () => {
  it('lists top-level declarations', () => {
    expect(listSymbols(SRC).sort()).toEqual(['Calc', 'Opts', 'PI', 'add'].sort());
  });
  it('is empty for no declarations', () => {
    expect(listSymbols('const a = 1;').length).toBe(1); // a
    expect(listSymbols('// just a comment')).toEqual([]);
  });
});

describe('replaceSymbol', () => {
  it('replaces a function leaving the rest byte-for-byte intact', () => {
    const r = replaceSymbol(SRC, 'add', 'export function add(a: number, b: number) {\n  return a + b + 0;\n}');
    expect(r.ok).toBe(true);
    expect(r.content).toContain('return a + b + 0;');
    // Surrounding code untouched.
    expect(r.content).toContain("import { x } from './x';");
    expect(r.content).toContain('export const PI = 3.14;');
    expect(r.content).toContain('export class Calc {');
    // The old body is gone (only the new one remains).
    expect(r.content!.match(/return a \+ b;/)).toBeNull();
  });

  it('replaces a class', () => {
    const r = replaceSymbol(SRC, 'Calc', 'export class Calc {\n  run() { return 99; }\n}');
    expect(r.ok).toBe(true);
    expect(r.content).toContain('return 99;');
    expect(r.content).toContain('export function add'); // untouched
  });

  it('replaces an exported const', () => {
    const r = replaceSymbol(SRC, 'PI', 'export const PI = 3.14159;');
    expect(r.ok).toBe(true);
    expect(r.content).toContain('3.14159');
  });

  it('returns an honest error for a missing symbol, listing what exists', () => {
    const r = replaceSymbol(SRC, 'nope', 'whatever');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not found');
    expect(r.error).toContain('add'); // suggests available symbols
  });

  it('validates inputs', () => {
    expect(replaceSymbol(SRC, '', 'x').ok).toBe(false);
    expect(replaceSymbol(SRC, 'add', '').ok).toBe(false);
  });
});
