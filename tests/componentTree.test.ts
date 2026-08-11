/**
 * "What is my app made of?" — the screen-by-screen tree.
 *
 * The things that actually go wrong in a tree builder are not wrong labels: they are HANGING (a
 * cycle, or a 2000-file import), and QUIETLY LYING (a truncated tree that looks complete). Both have
 * tests, and so does the decision to ignore package imports — a tree that lists `react` under every
 * screen is noise wearing the shape of information.
 */

import { describe, it, expect } from 'vitest';
import {
  buildComponentTree,
  relativeImports,
  resolveImport,
  countNodes,
  MAX_DEPTH,
  MAX_NODES,
} from '../src/lib/componentTree';

const f = (files: Record<string, string>) => files;

describe('relativeImports', () => {
  it('finds the shapes a generated app actually uses', () => {
    const src = `
      import React from 'react';
      import Header from './Header';
      import { Card } from '../ui/Card';
      import './styles.css';
      export { helper } from './helper';
      const Lazy = lazy(() => import('./HeavyThing'));
      const mod = await import("./other");
    `;
    expect(relativeImports(src).sort()).toEqual(
      ['../ui/Card', './Header', './HeavyThing', './helper', './other', './styles.css'],
    );
  });

  it('🔒 ignores package imports — they are dependencies, not parts of the app', () => {
    const src = "import React from 'react';\nimport _ from 'lodash';\nimport { z } from 'zod';";
    expect(relativeImports(src)).toEqual([]);
  });

  it('de-duplicates a specifier imported twice', () => {
    expect(relativeImports("import a from './x';\nimport b from './x';")).toEqual(['./x']);
  });

  it('returns nothing for an empty or import-less file', () => {
    expect(relativeImports('')).toEqual([]);
    expect(relativeImports('export const x = 1;')).toEqual([]);
  });
});

describe('resolveImport — the way a bundler would', () => {
  const files = f({
    'src/pages/Home.tsx': '', 'src/ui/Card.tsx': '', 'src/ui/index.ts': '',
    'src/lib/util.ts': '', 'src/styles.css': '',
  });

  it('resolves a sibling, a parent hop and an index file', () => {
    expect(resolveImport('src/pages/Home.tsx', '../ui/Card', files)).toBe('src/ui/Card.tsx');
    expect(resolveImport('src/pages/Home.tsx', '../ui', files)).toBe('src/ui/index.ts');
    expect(resolveImport('src/pages/Home.tsx', '../lib/util', files)).toBe('src/lib/util.ts');
  });

  it('resolves a path that already carries its extension', () => {
    expect(resolveImport('src/pages/Home.tsx', '../styles.css', files)).toBe('src/styles.css');
  });

  it('returns null for a file that is not there — a broken import is a real state', () => {
    // Inventing a node here would draw the user a screen that does not exist.
    expect(resolveImport('src/pages/Home.tsx', './Missing', files)).toBe(null);
  });
});

describe('buildComponentTree', () => {
  const app = f({
    'src/main.tsx': "import App from './App';",
    'src/App.tsx': "import Home from './pages/Home';\nimport Settings from './pages/Settings';",
    'src/pages/Home.tsx': "import { Card } from '../components/Card';\nimport { useCart } from '../hooks/useCart';",
    'src/pages/Settings.tsx': "import { Card } from '../components/Card';",
    'src/components/Card.tsx': 'export const Card = () => null;',
    'src/hooks/useCart.ts': 'export const useCart = () => null;',
    'package.json': '{}',
  });

  it('puts the screens at the top', () => {
    const tree = buildComponentTree(app);
    const names = tree.roots.map((r) => r.name);
    expect(names).toContain('main');
    expect(names).toContain('Home');
    expect(names).toContain('Settings');
  });

  it('shows what each screen is made of', () => {
    const home = buildComponentTree(app).roots.find((r) => r.name === 'Home');
    expect(home?.children.map((c) => c.name).sort()).toEqual(['Card', 'useCart']);
  });

  it('carries the same plain-language labels the build feed uses', () => {
    const home = buildComponentTree(app).roots.find((r) => r.name === 'Home');
    expect(home?.label).toBe('a screen');
    expect(home?.children.find((c) => c.name === 'Card')?.label).toBe('a part of a screen');
  });

  it('counts only real source files, not package.json', () => {
    expect(buildComponentTree(app).fileCount).toBe(6);
  });

  it('surfaces a screen nothing links to — usually a real bug in the user\'s app', () => {
    const withOrphan = { ...app, 'src/pages/Lost.tsx': 'export default () => null;' };
    const tree = buildComponentTree(withOrphan);
    // `Lost` is a page, so it is also a root; the orphan list is for files reached from nowhere.
    const orphanNames = tree.orphans.map((o) => o.name);
    expect(orphanNames).not.toContain('Card'); // reached from Home
    expect(tree.roots.map((r) => r.name)).toContain('Lost');
  });

  it('lists a helper that no screen imports', () => {
    const withDead = { ...app, 'src/lib/unused.ts': 'export const x = 1;' };
    expect(buildComponentTree(withDead).orphans.map((o) => o.name)).toContain('unused');
  });
});

describe('it terminates — the failure that matters', () => {
  it('🔒 survives an import cycle instead of hanging', () => {
    const cyclic = f({
      'src/pages/A.tsx': "import B from './B';",
      'src/pages/B.tsx': "import A from './A';",
    });
    const tree = buildComponentTree(cyclic);
    expect(countNodes(tree.roots)).toBeGreaterThan(0);
    const flat = JSON.stringify(tree);
    expect(flat).toContain('"cyclic":true'); // shown once, honestly, not looped
  });

  it('🔒 survives a file importing itself', () => {
    expect(() => buildComponentTree(f({ 'src/pages/Self.tsx': "import x from './Self';" }))).not.toThrow();
  });

  it('stops at MAX_DEPTH and SAYS the tree was cut', () => {
    // A truncated tree that looked complete would be the quiet lie this test exists to prevent.
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i += 1) files[`src/pages/P${i}.tsx`] = `import N from './P${i + 1}';`;
    files['src/pages/P12.tsx'] = 'export default () => null;';
    const root = buildComponentTree(files).roots.find((r) => r.name === 'P0');

    let depth = 0;
    let node = root;
    while (node?.children.length) { node = node.children[0]; depth += 1; }
    expect(depth).toBeLessThanOrEqual(MAX_DEPTH);
    expect(JSON.stringify(root)).toContain('"truncated":true');
  });

  it('🔒 caps total nodes so a huge import cannot hang the panel', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 1200; i += 1) {
      files[`src/pages/Page${i}.tsx`] = `import C from '../components/C${i}';`;
      files[`src/components/C${i}.tsx`] = 'export default () => null;';
    }
    const tree = buildComponentTree(files);
    // Roots are all listed (a user must see every screen), but the EXPANSION is bounded.
    expect(countNodes(tree.roots)).toBeLessThan(1200 + MAX_NODES + 10);
    expect(tree.fileCount).toBe(2400);
  });

  it('handles an empty or junk workspace without throwing', () => {
    expect(buildComponentTree({})).toEqual({ roots: [], orphans: [], fileCount: 0 });
    expect(() => buildComponentTree(undefined as never)).not.toThrow();
  });
});
