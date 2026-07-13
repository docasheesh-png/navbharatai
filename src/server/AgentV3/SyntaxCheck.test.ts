import { describe, it, expect } from 'vitest';
import { findSyntaxErrors, syntaxRepairInstruction } from './SyntaxCheck';

describe('findSyntaxErrors (deterministic parse gate — deep-test App #6)', () => {
  it('flags the EXACT App #6 corruption: a CSS declaration injected inside JSX', async () => {
    // The truncated GLM output produced a <button> with a stray `-side: border-radius: 0.5rem;` in its
    // attribute list — the "Unexpected token (31:13)" the in-browser preview died on.
    const files = {
      'src/App.tsx': [
        'export default function App() {',
        '  return (',
        '    <button',
        '      onClick={() => window.location.hash = "#budgets"}',
        '      -side: border-radius: 0.5rem;',
        '    >',
        '      Budgets',
        '    </button>',
        '  );',
        '}',
      ].join('\n'),
    };
    const errs = await findSyntaxErrors(files);
    expect(errs).toHaveLength(1);
    expect(errs[0].path).toBe('src/App.tsx');
    expect(errs[0].message).toBeTruthy();
  });

  it('passes clean, valid TSX / TS / JSX (no false positives)', async () => {
    const files = {
      'src/App.tsx': 'import React from "react";\nexport default function App(){ return <div className="app">hi</div>; }',
      'src/util.ts': 'export const add = (a: number, b: number): number => a + b;\nexport type P = { x: number };',
      'src/Widget.jsx': 'export function Widget(){ return <span>ok</span>; }',
      'src/data.json': '{ not: valid json but not checked }', // non-JS/TS → skipped
      'README.md': 'not code',
    };
    expect(await findSyntaxErrors(files)).toEqual([]);
  });

  it('catches an unterminated block / unclosed brace', async () => {
    const errs = await findSyntaxErrors({ 'src/broken.ts': 'export function f() { const x = 1;' });
    expect(errs).toHaveLength(1);
    expect(errs[0].path).toBe('src/broken.ts');
  });

  it('skips .d.ts, empty files, and non-code files; tolerates odd input', async () => {
    const errs = await findSyntaxErrors({
      'src/types.d.ts': 'declare module "x";',
      'src/empty.tsx': '   ',
      'src/blank.ts': '',
      // @ts-expect-error runtime guard against a non-string value
      'src/bad.ts': 123,
    });
    expect(errs).toEqual([]);
  });

  it('syntaxRepairInstruction lists path + location + message compactly', () => {
    const txt = syntaxRepairInstruction([
      { path: 'src/App.tsx', message: 'Unexpected ":"', line: 31, column: 13 },
      { path: 'src/x.ts', message: 'Expected "}"' },
    ]);
    expect(txt).toContain('src/App.tsx (line 31:13): Unexpected ":"');
    expect(txt).toContain('src/x.ts: Expected "}"');
  });
});
