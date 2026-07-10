import { describe, it, expect } from 'vitest';
import { computeMove, relativeSpecifier, aliasSpecifier, type MoveFile } from './codemodMoveFile';

// C7: move a file + rewrite all importers. Pure — assert both importer rewrites and the moved file's
// own relative-import recomputation, across relative and @/ alias styles.

describe('relativeSpecifier / aliasSpecifier', () => {
  it('computes a leading-./ extensionless relative spec', () => {
    expect(relativeSpecifier('src/App.tsx', 'src/components/Button.tsx')).toBe('./components/Button');
    expect(relativeSpecifier('src/pages/Home.tsx', 'src/lib/util.ts')).toBe('../lib/util');
  });
  it('computes an alias spec rooted under src', () => {
    expect(aliasSpecifier('@', 'src/lib/util.ts')).toBe('@/lib/util');
    expect(aliasSpecifier('~', 'src/components/Button.tsx')).toBe('~/components/Button');
  });
});

describe('computeMove', () => {
  const files = (): MoveFile[] => [
    { path: 'src/App.tsx', content: "import { Button } from './components/Button';\nimport { fmt } from '@/lib/util';\n" },
    { path: 'src/Header.tsx', content: "import Button from './components/Button';\n" },
    { path: 'src/components/Button.tsx', content: "import { fmt } from '../lib/util';\nexport const Button = () => fmt('x');\n" },
    { path: 'src/lib/util.ts', content: 'export const fmt = (s: string) => s;\n' },
  ];

  it('rewrites relative importers when a file moves', () => {
    const r = computeMove(files(), 'src/components/Button.tsx', 'src/ui/Button.tsx');
    expect(r.ok).toBe(true);
    const app = r.changes.find(c => c.path === 'src/App.tsx')!;
    expect(app.after).toContain("from './ui/Button'");
    const header = r.changes.find(c => c.path === 'src/Header.tsx')!;
    expect(header.after).toContain("from './ui/Button'");
  });

  it('recomputes the moved file\'s own relative imports from the new location', () => {
    const r = computeMove(files(), 'src/components/Button.tsx', 'src/ui/widgets/Button.tsx');
    const moved = r.changes.find(c => c.path === 'src/ui/widgets/Button.tsx')!;
    // ../lib/util (from src/components) must become ../../lib/util (from src/ui/widgets)
    expect(moved.after).toContain("from '../../lib/util'");
  });

  it('rewrites @/ alias importers to the new alias path', () => {
    const r = computeMove(files(), 'src/lib/util.ts', 'src/helpers/format.ts');
    const app = r.changes.find(c => c.path === 'src/App.tsx')!;
    expect(app.after).toContain("from '@/helpers/format'");
    // Button.tsx imports it relatively → that importer is rewritten relatively
    const button = r.changes.find(c => c.path === 'src/components/Button.tsx')!;
    expect(button.after).toContain("from '../helpers/format'");
  });

  it('leaves unrelated imports and npm packages untouched', () => {
    const withNpm: MoveFile[] = [
      { path: 'src/App.tsx', content: "import React from 'react';\nimport { Button } from './Button';\n" },
      { path: 'src/Button.tsx', content: 'export const Button = () => null;\n' },
    ];
    const r = computeMove(withNpm, 'src/Button.tsx', 'src/ui/Button.tsx');
    const app = r.changes.find(c => c.path === 'src/App.tsx')!;
    expect(app.after).toContain("import React from 'react'"); // untouched
    expect(app.after).toContain("from './ui/Button'");
  });

  it('errors on missing source, identical paths, or an occupied target', () => {
    expect(computeMove(files(), 'src/Nope.tsx', 'src/x.tsx').ok).toBe(false);
    expect(computeMove(files(), 'src/App.tsx', 'src/App.tsx').ok).toBe(false);
    expect(computeMove(files(), 'src/App.tsx', 'src/lib/util.ts').ok).toBe(false); // target exists
  });

  it('always includes the moved file itself in the change set (at the new path)', () => {
    const r = computeMove(files(), 'src/lib/util.ts', 'src/util.ts');
    const moved = r.changes.find(c => c.path === 'src/util.ts');
    expect(moved).toBeDefined();
    expect(r.summary).toContain('Moved src/lib/util.ts → src/util.ts');
  });
});
