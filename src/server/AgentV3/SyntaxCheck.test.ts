import { describe, it, expect } from 'vitest';
import { findSyntaxErrors, syntaxRepairInstruction, firstSyntaxError, parseGuardDecision, writeParseGuardEnabled, isDuplicateDeclarationError, type SyntaxErrorInfo } from './SyntaxCheck';

describe('firstSyntaxError — single-file parse for the write guard', () => {
  it('returns the error for a duplicate declaration, null for clean code', async () => {
    const dup = 'export default function App(){ const x=()=>1; const x=()=>2; return null }';
    const e = await firstSyntaxError('src/App.tsx', dup);
    expect(e?.message).toMatch(/already been declared/i);
    expect(await firstSyntaxError('src/App.tsx', 'export default function App(){ return null }')).toBeNull();
  });
  it('has no opinion on non-parseable sources (.d.ts / .css / .json)', async () => {
    expect(await firstSyntaxError('src/x.d.ts', 'garbage <<<')).toBeNull();
    expect(await firstSyntaxError('src/x.css', '.a { color }')).toBeNull();
  });
});

describe('parseGuardDecision — refuse a write that breaks a CLEAN file, allow repairs', () => {
  const err = (message: string): SyntaxErrorInfo => ({ path: 'src/App.tsx', message, line: 231, column: 8 });
  it('allows when disabled, or when the new content parses clean', () => {
    expect(parseGuardDecision('src/App.tsx', null, err('x'), false)).toBeNull();
    expect(parseGuardDecision('src/App.tsx', null, null, true)).toBeNull();
  });
  it('REFUSES a clean → broken change, naming the location + duplicate hint', () => {
    const msg = parseGuardDecision('src/App.tsx', null, err("The symbol \"handleExportCSV\" has already been declared"), true);
    expect(msg).toMatch(/WRITE REJECTED/);
    expect(msg).toMatch(/231:8/);
    expect(msg).toMatch(/DUPLICATE declaration/);
    expect(msg).toMatch(/EDIT the/);
  });
  it('ALLOWS a repair on an already-broken file (old was broken → never block)', () => {
    expect(parseGuardDecision('src/App.tsx', err('old broke'), err('still broken'), true)).toBeNull();
  });
  it('REFUSES a NEWLY-introduced duplicate even on an already-broken file (autopsy 2026-08-02, cancelSubscription)', () => {
    // The real hole: src/lib/api.ts was mid-repair for unrelated type errors (errOld present, NOT a
    // duplicate) when a second `export async function cancelSubscription` was added — the old
    // `if (errOld) return null` waved the "already been declared" white screen straight through.
    const msg = parseGuardDecision(
      'src/lib/api.ts',
      err('Expected ";" but found "const"'),                                   // old: unrelated in-flight error
      err('Multiple exports with the same name "cancelSubscription"'),         // new: duplicate export introduced
      true,
    );
    expect(msg).toMatch(/WRITE REJECTED/);
    expect(msg).toMatch(/DUPLICATE declaration/);
  });
  it('REFUSES a duplicate const introduced onto an already-broken file', () => {
    const msg = parseGuardDecision('src/lib/api.ts', err('Unexpected token'), err('The symbol "delay" has already been declared'), true);
    expect(msg).toMatch(/WRITE REJECTED/);
  });
  it('does NOT trap a removal-in-progress: old ALSO had the duplicate → allow', () => {
    expect(parseGuardDecision(
      'src/lib/api.ts',
      err('The symbol "cancelSubscription" has already been declared'),        // old already duplicate
      err('The symbol "cancelSubscription" has already been declared'),        // new still duplicate (mid-removal)
      true,
    )).toBeNull();
  });
  it('isDuplicateDeclarationError classifies esbuild + Babel phrasings, tolerates null', () => {
    expect(isDuplicateDeclarationError(err('The symbol "x" has already been declared'))).toBe(true);
    expect(isDuplicateDeclarationError(err('Multiple exports with the same name "x"'))).toBe(true);
    expect(isDuplicateDeclarationError(err('Duplicate declaration "Team"'))).toBe(true);
    expect(isDuplicateDeclarationError(err('Unexpected token'))).toBe(false);
    expect(isDuplicateDeclarationError(null)).toBe(false);
  });
  it('the guard is default-ON (kill switch AGENTV3_WRITE_PARSE_GUARD=off)', () => {
    expect(writeParseGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(writeParseGuardEnabled({ AGENTV3_WRITE_PARSE_GUARD: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

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
