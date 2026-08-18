import { describe, it, expect } from 'vitest';
import { packageNameFromSpecifier, extractImportedPackages, findMissingDependencies, phantomAliasDependencies, removeDependenciesFromPackageJson } from './DependencyReconciler';

// THE PHANTOM DEPENDENCY (autopsy build a487e019, 2026-08-18). The scaffold sets baseUrl:"src", so a model
// that writes `import { useStore } from 'stores/useStore'` sees a LOCAL path (src/stores/useStore) but
// sometimes ALSO lists "stores" in package.json dependencies — a package that does not exist. With
// baseUrl:"src" that declared package is provably unreachable, so it is safe to remove.
describe('phantomAliasDependencies — declared deps that are actually local baseUrl:"src" folders', () => {
  const TSCONFIG = JSON.stringify({ compilerOptions: { baseUrl: 'src' } });

  it('flags the reported "stores" case: a src/stores/ folder + "stores" in deps', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18', stores: '^1.0.0' } }),
      'tsconfig.json': TSCONFIG,
      'src/stores/useStore.ts': 'export const useStore = () => {};',
      'src/App.tsx': "import { useStore } from 'stores/useStore';",
    };
    expect(phantomAliasDependencies(files)).toEqual(['stores']);
  });

  it('flags every alias folder that leaked into deps, sorted', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { types: '*', components: '1.0.0', react: '^18' } }),
      'tsconfig.json': TSCONFIG,
      'src/types/index.ts': 'export type X = 1;',
      'src/components/Button.tsx': 'export const Button = () => null;',
    };
    expect(phantomAliasDependencies(files)).toEqual(['components', 'types']);
  });

  it('does NOT flag a real package that has no same-named src folder', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { zustand: '^4', react: '^18' } }),
      'tsconfig.json': TSCONFIG,
      'src/stores/useStore.ts': "import { create } from 'zustand';",
    };
    expect(phantomAliasDependencies(files)).toEqual([]);
  });

  it('does NOTHING without baseUrl:"src" — the alias assumption must be proven', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { stores: '^1' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
      'src/stores/x.ts': 'export const x = 1;',
    };
    expect(phantomAliasDependencies(files)).toEqual([]);
  });

  it('does not flag a bare FILE (src/utils.ts) as a folder alias — folders only', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { utils: '^1' } }),
      'tsconfig.json': TSCONFIG,
      'src/utils.ts': 'export const u = 1;', // a file, not a folder — never flagged
    };
    expect(phantomAliasDependencies(files)).toEqual([]);
  });

  it('is junk-safe (no package.json / no deps / empty)', () => {
    expect(phantomAliasDependencies({})).toEqual([]);
    expect(phantomAliasDependencies({ 'package.json': '{ not json', 'tsconfig.json': TSCONFIG })).toEqual([]);
  });
});

describe('removeDependenciesFromPackageJson', () => {
  it('removes the named deps from every section, keeps formatting', () => {
    const raw = JSON.stringify({ dependencies: { react: '^18', stores: '^1' }, devDependencies: { vite: '^5' } }, null, 2) + '\n';
    const out = removeDependenciesFromPackageJson(raw, ['stores']);
    const pkg = JSON.parse(out);
    expect(pkg.dependencies).toEqual({ react: '^18' });
    expect(pkg.devDependencies).toEqual({ vite: '^5' });
    expect(out.endsWith('\n')).toBe(true);
  });

  it('returns the input UNCHANGED when nothing matched or names is empty', () => {
    const raw = JSON.stringify({ dependencies: { react: '^18' } });
    expect(removeDependenciesFromPackageJson(raw, [])).toBe(raw);
    expect(removeDependenciesFromPackageJson(raw, ['stores'])).toBe(raw);
  });

  it('never throws on unparseable JSON', () => {
    expect(removeDependenciesFromPackageJson('{ not json', ['x'])).toBe('{ not json');
  });
});

describe('packageNameFromSpecifier — resolve an import to the installable package name', () => {
  it('keeps scoped packages, collapsing deep sub-paths', () => {
    expect(packageNameFromSpecifier('@dnd-kit/modifiers')).toBe('@dnd-kit/modifiers');
    expect(packageNameFromSpecifier('@dnd-kit/sortable/dist/x')).toBe('@dnd-kit/sortable');
  });
  it('collapses a normal package sub-path to the package', () => {
    expect(packageNameFromSpecifier('react-dom/client')).toBe('react-dom');
    expect(packageNameFromSpecifier('lodash/fp')).toBe('lodash');
    expect(packageNameFromSpecifier('react')).toBe('react');
  });
  it('rejects relative/absolute paths and the @/ src alias', () => {
    expect(packageNameFromSpecifier('./Foo')).toBeNull();
    expect(packageNameFromSpecifier('../lib/x')).toBeNull();
    expect(packageNameFromSpecifier('/abs')).toBeNull();
    expect(packageNameFromSpecifier('@/components/Button')).toBeNull();
  });
  it('rejects Node builtins and node:/virtual:/url specifiers', () => {
    expect(packageNameFromSpecifier('fs')).toBeNull();
    expect(packageNameFromSpecifier('path')).toBeNull();
    expect(packageNameFromSpecifier('node:crypto')).toBeNull();
    expect(packageNameFromSpecifier('virtual:uno.css')).toBeNull();
  });
});

describe('extractImportedPackages — every import/require/dynamic-import form', () => {
  it('extracts the real @dnd-kit/modifiers import from the reported TodoList.tsx', () => {
    const content = `import { DndContext } from "@dnd-kit/core";\nimport { restrictToVerticalAxis } from "@dnd-kit/modifiers";\nimport TodoItem from "./TodoItem";`;
    const pkgs = extractImportedPackages(content);
    expect(pkgs).toContain('@dnd-kit/core');
    expect(pkgs).toContain('@dnd-kit/modifiers');
    expect(pkgs).not.toContain('./TodoItem'); // relative — not a package
  });
  it('handles named, default, side-effect, export-from, require and dynamic import', () => {
    const content = [
      `import React from 'react';`,
      `import { useState } from 'react';`,
      `import './styles.css';`,
      `import 'some-polyfill';`,
      `export { x } from 'reexported-pkg';`,
      `const y = require('cjs-pkg');`,
      `const z = await import('dynamic-pkg');`,
      `import type { T } from '@scope/types';`,
    ].join('\n');
    const pkgs = extractImportedPackages(content);
    expect(pkgs.sort()).toEqual(['@scope/types', 'cjs-pkg', 'dynamic-pkg', 'react', 'reexported-pkg', 'some-polyfill'].sort());
  });

  it('NEVER reads an exported string constant as a package (the real "npm install md" bug)', () => {
    // Build report 2026-07-07: a Notes app's Button size constant `export const DEFAULT_SIZE = 'md'`
    // was read as "imports the package md" and the reconciler npm-installed the real, unrelated `md`
    // package into the user's app. Any quoted token on an export line could become an npm install —
    // a supply-chain-shaped class. Only `from '…'` clauses and import-adjacent quotes are specifiers.
    const content = [
      `export const DEFAULT_SIZE = 'md';`,
      `export type Size = 'sm' | 'md' | 'lg';`,
      `export const THEME = "dark";`,
      `export const BREAKPOINTS = { sm: '640px', md: '768px' };`,
      `import { Button } from './Button';`,
      `import clsx from 'clsx';`,
    ].join('\n');
    const pkgs = extractImportedPackages(content);
    expect(pkgs).toEqual(['clsx']); // only the real package — no 'md', 'sm', 'dark', '640px'
  });

  it('still catches every genuine specifier form after the tightening (no lost coverage)', () => {
    const content = [
      `export * from 'star-reexport';`,
      `export { a as b } from 're-export';`,
      `import 'side-effect';`,
      `import def, { named } from 'mixed-import';`,
    ].join('\n');
    expect(extractImportedPackages(content).sort()).toEqual(['mixed-import', 're-export', 'side-effect', 'star-reexport'].sort());
  });
});

describe('findMissingDependencies — the real fix for the broken preview', () => {
  it('flags @dnd-kit/modifiers: imported by a component but absent from package.json', () => {
    const files = {
      'package.json': JSON.stringify({
        dependencies: { '@dnd-kit/core': '^6.1.0', '@dnd-kit/sortable': '^8.0.0', '@dnd-kit/utilities': '^3.2.2', react: '^18.3.1' },
        devDependencies: { vite: '^5.4.1', typescript: '^5.5.3' },
      }),
      'src/components/TodoList.tsx': `import { DndContext } from "@dnd-kit/core";\nimport { restrictToVerticalAxis } from "@dnd-kit/modifiers";\nimport { useState } from "react";`,
    };
    expect(findMissingDependencies(files)).toEqual(['@dnd-kit/modifiers']);
  });

  it('returns [] when every imported package is declared', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
      'src/main.tsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';`,
    };
    expect(findMissingDependencies(files)).toEqual([]);
  });

  it('ignores relative imports, the @/ alias, node builtins, and non-source files', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1' } }),
      'src/App.tsx': `import React from 'react';\nimport { cn } from '@/lib/utils';\nimport Foo from './Foo';\nimport path from 'node:path';`,
      'README.md': `import { notCode } from 'should-be-ignored';`, // not a scannable source file
      'src/App.d.ts': `import { alsoIgnored } from 'ignored-types';`, // .d.ts is skipped
    };
    expect(findMissingDependencies(files)).toEqual([]);
  });

  it('with an unparseable package.json, everything imported counts as missing (fail-safe)', () => {
    const files = {
      'package.json': '{ broken json',
      'src/x.ts': `import { a } from 'pkg-a';\nimport 'pkg-b';`,
    };
    expect(findMissingDependencies(files)).toEqual(['pkg-a', 'pkg-b']);
  });
});
