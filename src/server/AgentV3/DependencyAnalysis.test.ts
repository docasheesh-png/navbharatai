import { describe, it, expect } from 'vitest';
import {
  analyzeDependencies,
  dependencySummary,
  normalizeImportToPackage,
  detectVersionConflicts,
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

describe('detectVersionConflicts (GA-3 — semver-backed version-conflict intelligence)', () => {
  const pkg = (o: Record<string, unknown>) => JSON.stringify(o);

  it('flags the SAME package pinned to non-intersecting ranges across sections (version-conflict, high)', () => {
    const issues = detectVersionConflicts(pkg({
      dependencies: { react: '^17.0.2' },
      devDependencies: { react: '^18.2.0' },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('version-conflict');
    expect(issues[0].package).toBe('react');
    expect(issues[0].severity).toBe('high');
  });

  it('does NOT flag overlapping/compatible ranges', () => {
    // ^18.0.0 and >=18.1.0 intersect; ~4.9 and ^4.9.5 intersect.
    expect(detectVersionConflicts(pkg({
      dependencies: { typescript: '^4.9.5' },
      devDependencies: { typescript: '~4.9.0' },
    }))).toEqual([]);
    expect(detectVersionConflicts(pkg({
      dependencies: { react: '^18.0.0' },
      devDependencies: { react: '>=18.1.0' },
    }))).toEqual([]);
  });

  it('flags a dep version that violates the project\'s OWN peerDependencies range (peer-violation, high)', () => {
    const issues = detectVersionConflicts(pkg({
      dependencies: { react: '^17.0.0' },
      peerDependencies: { react: '>=18.0.0' },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('peer-violation');
    expect(issues[0].package).toBe('react');
  });

  it('does NOT flag a peer range the installed version DOES satisfy', () => {
    expect(detectVersionConflicts(pkg({
      dependencies: { react: '^18.2.0' },
      peerDependencies: { react: '>=18.0.0' },
    }))).toEqual([]);
  });

  it('skips non-semver specifiers (workspace:/file:/git/*/latest) — never a false conflict', () => {
    expect(detectVersionConflicts(pkg({
      dependencies: { pkg: 'workspace:*' },
      devDependencies: { pkg: 'file:../pkg' },
    }))).toEqual([]);
    expect(detectVersionConflicts(pkg({
      dependencies: { a: '*' },
      devDependencies: { a: 'latest' },
    }))).toEqual([]);
  });

  it('emits at most ONE issue per package (version-conflict wins over peer-violation)', () => {
    const issues = detectVersionConflicts(pkg({
      dependencies: { react: '^17.0.0' },
      devDependencies: { react: '^18.0.0' }, // cross-section conflict
      peerDependencies: { react: '>=18.0.0' }, // also a peer violation for the ^17 dep
    }));
    expect(issues.filter((i) => i.package === 'react')).toHaveLength(1);
    expect(issues[0].kind).toBe('version-conflict');
  });

  it('returns [] for null / unparseable / non-object manifests', () => {
    expect(detectVersionConflicts(null)).toEqual([]);
    expect(detectVersionConflicts('{ not json')).toEqual([]);
    expect(detectVersionConflicts('[]')).toEqual([]);
  });

  it('is wired into analyzeDependencies (conflicts surface in the main scan)', () => {
    const issues = analyzeDependencies([], pkg({
      dependencies: { react: '^17.0.0' },
      devDependencies: { react: '^18.0.0' },
    }));
    expect(issues.some((i) => i.kind === 'version-conflict' && i.package === 'react')).toBe(true);
  });
});

describe('GA-3 resolver — concrete reconciliation suggestions', () => {
  const pkg = (o: Record<string, unknown>) => JSON.stringify(o);

  it('suggests aligning the OLDER section onto the NEWER range (dev newer than deps)', () => {
    const [issue] = detectVersionConflicts(pkg({
      dependencies: { react: '^17.0.2' },
      devDependencies: { react: '^18.2.0' },
    }));
    expect(issue.kind).toBe('version-conflict');
    // deps (^17) is older → it should be moved onto dev's ^18.2.0.
    expect(issue.suggestion).toBe(
      'Set dependencies."react" to "^18.2.0" to match devDependencies (align the older pin onto the newer range).',
    );
  });

  it('picks the newer range regardless of which section it sits in (deps newer than dev)', () => {
    const [issue] = detectVersionConflicts(pkg({
      dependencies: { lodash: '^4.17.0' },
      devDependencies: { lodash: '^3.10.0' },
    }));
    // deps (^4) is newer → devDependencies should be aligned to ^4.17.0.
    expect(issue.suggestion).toBe(
      'Set devDependencies."lodash" to "^4.17.0" to match dependencies (align the older pin onto the newer range).',
    );
  });

  it('suggests bumping a peer-violating dep to the peer floor as a caret range', () => {
    const [issue] = detectVersionConflicts(pkg({
      dependencies: { react: '^17.0.0' },
      peerDependencies: { react: '>=18.0.0' },
    }));
    expect(issue.kind).toBe('peer-violation');
    expect(issue.suggestion).toBe(
      'Set dependencies."react" to "^18.0.0" to satisfy the peerDependencies requirement ">=18.0.0".',
    );
  });

  it('names the correct section for a peer-violating devDependency', () => {
    const [issue] = detectVersionConflicts(pkg({
      devDependencies: { typescript: '^4.9.0' },
      peerDependencies: { typescript: '>=5.0.0' },
    }));
    expect(issue.kind).toBe('peer-violation');
    expect(issue.suggestion).toBe(
      'Set devDependencies."typescript" to "^5.0.0" to satisfy the peerDependencies requirement ">=5.0.0".',
    );
  });

  it('surfaces the ↳ Fix line in dependencySummary when a suggestion exists', () => {
    const out = dependencySummary(detectVersionConflicts(pkg({
      dependencies: { react: '^17.0.2' },
      devDependencies: { react: '^18.2.0' },
    })));
    expect(out).toContain('↳ Fix: Set dependencies."react" to "^18.2.0"');
  });

  it('a compatible manifest yields no suggestion (nothing to reconcile)', () => {
    expect(detectVersionConflicts(pkg({
      dependencies: { react: '^18.0.0' },
      devDependencies: { react: '>=18.1.0' },
    }))).toEqual([]);
  });
});
