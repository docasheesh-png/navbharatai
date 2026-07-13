import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { isTsconfigPath, ensureTsconfigBaseUrl } from './TsconfigGuard';

describe('isTsconfigPath', () => {
  it('matches tsconfig.json and variants but not tsconfig.node.json', () => {
    expect(isTsconfigPath('tsconfig.json')).toBe(true);
    expect(isTsconfigPath('tsconfig.app.json')).toBe(true);
    expect(isTsconfigPath('packages/web/tsconfig.json')).toBe(true);
    expect(isTsconfigPath('tsconfig.node.json')).toBe(false);
    expect(isTsconfigPath('vite.config.ts')).toBe(false);
    expect(isTsconfigPath('src/App.tsx')).toBe(false);
  });
});

describe('ensureTsconfigBaseUrl — restore baseUrl/paths when a rewrite wiped them (#1305 regression guard)', () => {
  it('injects baseUrl:"src" + @/* paths when a tsconfig has NEITHER', () => {
    const before = JSON.stringify({ compilerOptions: { jsx: 'react-jsx', strict: true }, include: ['src'] }, null, 2);
    const after = JSON.parse(ensureTsconfigBaseUrl('tsconfig.json', before));
    expect(after.compilerOptions.baseUrl).toBe('src');
    expect(after.compilerOptions.paths).toEqual({ '@/*': ['*'] });
    expect(after.compilerOptions.strict).toBe(true); // existing options preserved
    expect(after.include).toEqual(['src']);
  });

  it('proves the restored config actually resolves a baseUrl import via the real TS resolver', () => {
    const restored = JSON.parse(ensureTsconfigBaseUrl('tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } })));
    const { options } = ts.convertCompilerOptionsFromJson(restored.compilerOptions, '/proj');
    const existing = new Set(['/proj/src/stores/useBoardStore.ts', '/proj/src/components/Dashboard.tsx']);
    const host: ts.ModuleResolutionHost = { fileExists: (f) => existing.has(f.replace(/\\/g, '/')), readFile: () => '', directoryExists: () => true, getDirectories: () => [] };
    const resolved = ts.resolveModuleName('stores/useBoardStore', '/proj/src/components/Dashboard.tsx', options, host).resolvedModule?.resolvedFileName;
    expect(resolved).toBe('/proj/src/stores/useBoardStore.ts');
  });

  it('respects a deliberate baseUrl (no-op when baseUrl is already set)', () => {
    const before = JSON.stringify({ compilerOptions: { baseUrl: '.' } });
    expect(ensureTsconfigBaseUrl('tsconfig.json', before)).toBe(before);
  });

  it('respects deliberate paths (no-op when paths is already set)', () => {
    const before = JSON.stringify({ compilerOptions: { paths: { '~/*': ['./src/*'] } } });
    expect(ensureTsconfigBaseUrl('tsconfig.json', before)).toBe(before);
  });

  it('no-ops for a non-tsconfig file, a commented (non-strict-JSON) tsconfig, and no compilerOptions', () => {
    expect(ensureTsconfigBaseUrl('src/App.tsx', '{}')).toBe('{}');
    const commented = '{\n  // a comment\n  "compilerOptions": {}\n}';
    expect(ensureTsconfigBaseUrl('tsconfig.json', commented)).toBe(commented); // JSON.parse fails → untouched
    const noCo = JSON.stringify({ include: ['src'] });
    expect(ensureTsconfigBaseUrl('tsconfig.json', noCo)).toBe(noCo);
  });

  it('never touches tsconfig.node.json (the vite-config project has no app sources)', () => {
    const before = JSON.stringify({ compilerOptions: { composite: true } });
    expect(ensureTsconfigBaseUrl('tsconfig.node.json', before)).toBe(before);
  });
});
