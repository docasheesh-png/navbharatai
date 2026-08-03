import { describe, it, expect } from 'vitest';
import { projectContractCard, declaredPackagesFromPackageJson } from './projectContractCard';

describe('projectContractCard — prevent the wrong-import / undeclared-package classes', () => {
  it('THE REAL FAILURE: tells the builder which module owns a shared type, so it cannot import it from ./storage', () => {
    // Reported build: the model wrote `import { Team } from './storage'` and had to self-heal to the
    // shared schema module a turn later. The card states the true owner up front.
    const card = projectContractCard({
      symbols: [
        { name: 'Team', file: 'shared/schema.ts' },
        { name: 'User', file: 'shared/schema.ts' },
        { name: 'Plan', file: 'shared/schema.ts' },
        { name: 'storage', file: 'server/storage.ts' },
      ],
      declaredPackages: ['react'],
    });
    expect(card).toContain('shared/schema.ts');
    expect(card).toMatch(/shared\/schema\.ts — .*Team/);
    expect(card).toContain('never from another file that merely re-uses it');
  });

  it('THE REAL FAILURE 2: lists declared packages and forbids importing an undeclared one (the nanoid case)', () => {
    const card = projectContractCard({
      symbols: [{ name: 'App', file: 'src/App.tsx' }],
      declaredPackages: ['react', 'react-dom', 'express'],
    });
    expect(card).toContain('Declared packages (package.json): express, react, react-dom');
    expect(card).not.toContain('nanoid'); // nanoid was NOT declared — the card must not imply it is available
    expect(card).toContain('add it to package.json in the SAME turn');
  });

  it('is BOUNDED — a huge project can never bloat the prompt', () => {
    const symbols = Array.from({ length: 500 }, (_, i) => ({ name: 'Sym' + i, file: 'src/mod' + (i % 120) + '.ts' }));
    const packages = Array.from({ length: 300 }, (_, i) => 'pkg-' + i);
    const card = projectContractCard({ symbols, declaredPackages: packages }, { maxModules: 5, maxPerModule: 3, maxPackages: 4 });
    const moduleLines = card.split('\n').filter((l) => l.startsWith('- src/mod'));
    expect(moduleLines).toHaveLength(5);
    for (const l of moduleLines) expect(l.split(',').length).toBeLessThanOrEqual(4); // 3 names + the "+N more" tail
    expect(card).toMatch(/Declared packages \(package\.json\): pkg-0, pkg-1, pkg-10, pkg-100$/m);
  });

  it('skips noise files (css/json/assets/node_modules/.d.ts) — only real modules carry a contract', () => {
    const card = projectContractCard({
      symbols: [
        { name: 'Real', file: 'src/lib/api.ts' },
        { name: 'Styles', file: 'src/index.css' },
        { name: 'Vendor', file: 'node_modules/x/index.js' },
        { name: 'Types', file: 'src/types.d.ts' },
        { name: 'Data', file: 'src/data.json' },
      ],
      declaredPackages: [],
    });
    expect(card).toContain('src/lib/api.ts');
    for (const noise of ['index.css', 'node_modules', 'types.d.ts', 'data.json']) {
      expect(card, noise).not.toContain(noise);
    }
  });

  it('is DETERMINISTIC and de-duplicates symbol names', () => {
    const input = {
      symbols: [
        { name: 'A', file: 'src/b.ts' }, { name: 'A', file: 'src/b.ts' },
        { name: 'B', file: 'src/b.ts' }, { name: 'C', file: 'src/a.ts' },
      ],
      declaredPackages: ['z', 'a'],
    };
    const first = projectContractCard(input);
    expect(projectContractCard(input)).toBe(first);
    expect(first).toMatch(/src\/b\.ts — A, B/);          // richest module first, name de-duped
    expect(first.indexOf('src/b.ts')).toBeLessThan(first.indexOf('src/a.ts'));
  });

  it('returns EMPTY for a fresh/empty project so the caller adds no block at all', () => {
    expect(projectContractCard({ symbols: [], declaredPackages: [] })).toBe('');
    expect(projectContractCard({ symbols: [{ name: '', file: '' }], declaredPackages: [] })).toBe('');
  });

  it('tolerates junk input without throwing', () => {
    expect(() => projectContractCard({ symbols: [null as never, undefined as never], declaredPackages: [null as never] })).not.toThrow();
  });
});

describe('declaredPackagesFromPackageJson', () => {
  it('reads dependencies + devDependencies, de-duped', () => {
    const raw = JSON.stringify({ dependencies: { react: '^18', nanoid: '^5' }, devDependencies: { vite: '^5', react: '^18' } });
    expect(declaredPackagesFromPackageJson(raw).sort()).toEqual(['nanoid', 'react', 'vite']);
  });
  it('an unparseable / missing package.json contributes nothing (never throws)', () => {
    expect(declaredPackagesFromPackageJson('{ not json')).toEqual([]);
    expect(declaredPackagesFromPackageJson(null)).toEqual([]);
    expect(declaredPackagesFromPackageJson('')).toEqual([]);
  });
});
