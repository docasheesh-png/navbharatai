import { describe, it, expect } from 'vitest';
import {
  analyzeDependencies,
  dependencySummary,
  normalizeImportToPackage,
} from './DependencyAnalysis';

describe('normalizeImportToPackage', () => {
  it('returns null for relative imports', () => {
    expect(normalizeImportToPackage('./foo')).toBeNull();
    expect(normalizeImportToPackage('../bar/baz')).toBeNull();
  });

  it('returns null for absolute and alias imports', () => {
    expect(normalizeImportToPackage('/abs/path')).toBeNull();
    expect(normalizeImportToPackage('@/components/Button')).toBeNull();
    expect(normalizeImportToPackage('~/lib/util')).toBeNull();
  });

  it('returns null for Node.js builtins (bare and node: form)', () => {
    expect(normalizeImportToPackage('fs')).toBeNull();
    expect(normalizeImportToPackage('path')).toBeNull();
    expect(normalizeImportToPackage('node:fs')).toBeNull();
    expect(normalizeImportToPackage('node:crypto')).toBeNull();
  });

  it('maps scoped package with subpath to @scope/name', () => {
    expect(normalizeImportToPackage('@scope/pkg/sub/path')).toBe('@scope/pkg');
    expect(normalizeImportToPackage('@scope/pkg')).toBe('@scope/pkg');
  });

  it('maps pkg/sub to pkg', () => {
    expect(normalizeImportToPackage('react-dom/client')).toBe('react-dom');
    expect(normalizeImportToPackage('lodash')).toBe('lodash');
  });

  it('strips query/version suffixes', () => {
    expect(normalizeImportToPackage('some-pkg?worker')).toBe('some-pkg');
    expect(normalizeImportToPackage('./local?raw')).toBeNull();
  });
});

describe('analyzeDependencies', () => {
  it('detects a missing dependency as high', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18.0.0' } });
    const issues = analyzeDependencies(['react', 'axios'], pkg);
    const missing = issues.find((x) => x.kind === 'missing' && x.package === 'axios');
    expect(missing).toBeTruthy();
    expect(missing!.severity).toBe('high');
    expect(missing!.detail).toContain("'axios' is imported but not in package.json");
    // react is declared and imported — not flagged.
    expect(issues.some((x) => x.package === 'react')).toBe(false);
  });

  it('detects a declared-but-unused dependency as low, without flagging implicit packages', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^18.0.0',
        'left-pad': '^1.0.0',
        typescript: '^5.0.0',
        '@types/node': '^20.0.0',
        eslint: '^9.0.0',
      },
    });
    const issues = analyzeDependencies(['react'], pkg);
    const unused = issues.find((x) => x.kind === 'unused' && x.package === 'left-pad');
    expect(unused).toBeTruthy();
    expect(unused!.severity).toBe('low');
    // Implicit toolchain + @types/* are never flagged unused.
    expect(issues.some((x) => x.package === 'typescript')).toBe(false);
    expect(issues.some((x) => x.package === '@types/node')).toBe(false);
    expect(issues.some((x) => x.package === 'eslint')).toBe(false);
  });

  it('only considers dependencies (not dev/peer/optional) for unused', () => {
    const pkg = JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^1.0.0' },
      peerDependencies: { 'react-dom': '^18.0.0' },
      optionalDependencies: { fsevents: '^2.0.0' },
    });
    const issues = analyzeDependencies(['react'], pkg);
    // None of the dev/peer/optional entries should appear as unused.
    expect(issues.some((x) => x.kind === 'unused')).toBe(false);
  });

  it('flags a floating dependency version (*, latest, x, empty) as medium unpinned', () => {
    const pkg = JSON.stringify({
      dependencies: { react: '*', axios: 'latest', lodash: 'x', dayjs: '' },
    });
    const issues = analyzeDependencies(['react', 'axios', 'lodash', 'dayjs'], pkg);
    const unpinned = issues.filter((x) => x.kind === 'unpinned');
    expect(unpinned.map((x) => x.package).sort()).toEqual(['axios', 'dayjs', 'lodash', 'react']);
    expect(unpinned.every((x) => x.severity === 'medium')).toBe(true);
    expect(unpinned.find((x) => x.package === 'react')!.detail).toContain('not reproducible');
  });

  it('flags an unpinned devDependency and is case-insensitive', () => {
    const pkg = JSON.stringify({ devDependencies: { vitest: 'LATEST' } });
    const issues = analyzeDependencies(['vitest'], pkg);
    expect(issues.some((x) => x.kind === 'unpinned' && x.package === 'vitest')).toBe(true);
  });

  it('does not flag normal version ranges, exact pins, or partial wildcards as unpinned', () => {
    const pkg = JSON.stringify({
      dependencies: {
        react: '^18.0.0',
        axios: '~1.6.0',
        lodash: '1.2.3',
        dayjs: '1.x',
        zod: '>=3.0.0 <4',
      },
    });
    const issues = analyzeDependencies(
      ['react', 'axios', 'lodash', 'dayjs', 'zod'],
      pkg,
    );
    expect(issues.some((x) => x.kind === 'unpinned')).toBe(false);
  });

  it('does not flag special protocols (workspace:/file:/git/npm) as unpinned', () => {
    const pkg = JSON.stringify({
      dependencies: {
        a: 'workspace:*',
        b: 'file:../b',
        c: 'github:user/repo',
        d: 'npm:other@*',
      },
    });
    const issues = analyzeDependencies(['a', 'b', 'c', 'd'], pkg);
    expect(issues.some((x) => x.kind === 'unpinned')).toBe(false);
  });

  it('does not flag a floating peer/optional range as unpinned (a * peer is normal)', () => {
    const pkg = JSON.stringify({
      dependencies: { react: '^18.0.0' },
      peerDependencies: { 'react-dom': '*' },
      optionalDependencies: { fsevents: '*' },
    });
    const issues = analyzeDependencies(['react'], pkg);
    expect(issues.some((x) => x.kind === 'unpinned')).toBe(false);
  });

  it('does not flag a dependency declared only in devDependencies as missing', () => {
    const pkg = JSON.stringify({ devDependencies: { vitest: '^1.0.0' } });
    const issues = analyzeDependencies(['vitest'], pkg);
    expect(issues.some((x) => x.kind === 'missing')).toBe(false);
  });

  it('returns [] for null or garbage package.json', () => {
    expect(analyzeDependencies(['react'], null)).toEqual([]);
    expect(analyzeDependencies(['react'], 'not json {{{')).toEqual([]);
    expect(analyzeDependencies(['react'], '[]')).toEqual([]);
  });

  it('ignores relative/builtin imports when judging missing', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18.0.0' } });
    const issues = analyzeDependencies(['./local', 'node:fs', 'fs', 'react'], pkg);
    expect(issues).toEqual([]);
  });

  it('caps issues at 50', () => {
    const imports = Array.from({ length: 80 }, (_, i) => `missing-pkg-${i}`);
    const pkg = JSON.stringify({ dependencies: {} });
    const issues = analyzeDependencies(imports, pkg);
    expect(issues.length).toBe(50);
  });
});

describe('dependencySummary', () => {
  it('reports the consistent line for a clean project', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18.0.0' } });
    const issues = analyzeDependencies(['react'], pkg);
    expect(issues).toEqual([]);
    expect(dependencySummary(issues)).toBe(
      'Dependency check: ✓ Dependencies consistent with package.json.',
    );
  });

  it('lists counts and high-severity missing lines', () => {
    const pkg = JSON.stringify({ dependencies: {} });
    const out = dependencySummary(analyzeDependencies(['axios'], pkg));
    expect(out).toContain('Dependency check: 1 issue(s)');
    expect(out).toContain('1 high');
    expect(out).toContain('[high] missing: axios');
  });

  it('reports a medium count and the unpinned line', () => {
    const pkg = JSON.stringify({ dependencies: { react: 'latest' } });
    const out = dependencySummary(analyzeDependencies(['react'], pkg));
    expect(out).toContain('1 medium');
    expect(out).toContain('[medium] unpinned: react');
  });
});
