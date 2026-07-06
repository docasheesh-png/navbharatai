import { describe, it, expect } from 'vitest';
import { analyzeImportExports, resolveLocalTarget } from './ImportExportAnalysis';

describe('resolveLocalTarget', () => {
  const set = new Set(['src/lib/util.ts', 'src/components/Button.tsx', 'src/api/index.ts']);
  it('resolves with extension inference', () => {
    expect(resolveLocalTarget('src/App.tsx', './lib/util', set)).toBe('src/lib/util.ts');
    expect(resolveLocalTarget('src/pages/Home.tsx', '../components/Button', set)).toBe('src/components/Button.tsx');
  });
  it('resolves index files', () => {
    expect(resolveLocalTarget('src/App.tsx', './api', set)).toBe('src/api/index.ts');
  });
  it('returns null for external packages', () => {
    expect(resolveLocalTarget('src/App.tsx', 'react', set)).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(resolveLocalTarget('src/App.tsx', './missing', set)).toBeNull();
  });
});

describe('analyzeImportExports — clean (no false positives)', () => {
  it('accepts imports that match the target exports', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const add = (a,b)=>a+b;\nexport function sub(a,b){return a-b;}\nexport default function main(){}`,
      'src/App.tsx': `import main, { add, sub } from './util';\nexport function App(){ return add(1,2)+sub(3,1)+Number(main); }`,
    });
    expect(r.ok).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.filesScanned).toBe(2);
  });

  it('accepts a renamed import (import { X as Y }) when X is exported', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const original = 1;`,
      'src/App.tsx': `import { original as renamed } from './util';\nexport const v = renamed;`,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts type imports of exported types', async () => {
    const r = await analyzeImportExports({
      'src/types.ts': `export interface User { id: string }\nexport type Role = 'admin' | 'user';`,
      'src/App.tsx': `import type { User, Role } from './types';\nexport const u: User = { id: 'x' }; export const r: Role = 'admin';`,
    });
    expect(r.ok).toBe(true);
  });

  it('stays silent for external packages and unresolved files', async () => {
    const r = await analyzeImportExports({
      'src/App.tsx': `import React from 'react';\nimport { thing } from './does-not-exist';\nexport const A = React;`,
    });
    expect(r.ok).toBe(true); // external + missing-file are not this checker's concern
  });

  it('stays silent when the target uses a wildcard re-export', async () => {
    const r = await analyzeImportExports({
      'src/barrel.ts': `export * from './somewhere';`,
      'src/App.tsx': `import { MaybeThere } from './barrel';\nexport const x = MaybeThere;`,
    });
    expect(r.ok).toBe(true); // export * could legitimately provide the name
  });

  it('resolves a name re-exported through a barrel file', async () => {
    const r = await analyzeImportExports({
      'src/widgets/Card.tsx': `export const Card = () => null;`,
      'src/widgets/index.ts': `export { Card } from './Card';`,
      'src/App.tsx': `import { Card } from './widgets';\nexport const A = Card;`,
    });
    expect(r.ok).toBe(true);
  });
});

describe('analyzeImportExports — mismatches', () => {
  it('flags a named import the target does not export', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const add = 1;`,
      'src/App.tsx': `import { add, subtract } from './util';\nexport const v = add;`,
    });
    expect(r.ok).toBe(false);
    expect(r.counts['named-import-not-exported']).toBe(1);
    expect(r.mismatches[0].imported).toBe('subtract');
    expect(r.mismatches[0].from).toBe('./util');
    expect(r.mismatches[0].kind).toBe('named-import-not-exported');
  });

  it('flags a default import when the target has no default export', async () => {
    const r = await analyzeImportExports({
      'src/util.ts': `export const add = 1;`,
      'src/App.tsx': `import util from './util';\nexport const v = util;`,
    });
    expect(r.ok).toBe(false);
    expect(r.counts['default-import-missing']).toBe(1);
    expect(r.mismatches[0].kind).toBe('default-import-missing');
  });

  it('reports the correct line and file, and finds multiple mismatches', async () => {
    const r = await analyzeImportExports({
      'src/a.ts': `export const one = 1;`,
      'src/b.tsx': `import { one, two } from './a';\nimport missing from './a';\nexport const x = one;`,
    });
    expect(r.mismatches).toHaveLength(2); // 'two' not exported + default missing
    const named = r.mismatches.find(m => m.kind === 'named-import-not-exported')!;
    expect(named.imported).toBe('two');
    expect(named.line).toBe(1);
  });
});

describe('analyzeImportExports — robustness', () => {
  it('returns honest zeros for a non-code file set', async () => {
    const r = await analyzeImportExports({ 'README.md': 'import { x } from "./y"' });
    expect(r.filesScanned).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('does not throw on unparseable content', async () => {
    const r = await analyzeImportExports({ 'src/broken.tsx': 'import { <<< from ./', 'src/ok.ts': 'export const a = 1;' });
    expect(Array.isArray(r.mismatches)).toBe(true);
  });
});
