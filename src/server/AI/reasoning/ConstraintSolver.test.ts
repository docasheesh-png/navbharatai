import { describe, it, expect } from 'vitest';
import { analyzeDependencyConstraints, dominantMajor } from './ConstraintSolver';

const pkg = (deps: Record<string, string>, dev?: Record<string, string>) =>
  ({ 'package.json': JSON.stringify({ dependencies: deps, ...(dev ? { devDependencies: dev } : {}) }) });

describe('dominantMajor', () => {
  it('reads a single major from common range forms', () => {
    expect(dominantMajor('^18.2.0')).toBe(18);
    expect(dominantMajor('~17.0.1')).toBe(17);
    expect(dominantMajor('18.x')).toBe(18);
    expect(dominantMajor('18.*')).toBe(18);
    expect(dominantMajor('18')).toBe(18);
    expect(dominantMajor('19.1.0')).toBe(19);
    expect(dominantMajor('v20')).toBe(20);
    expect(dominantMajor('=16.0.0')).toBe(16);
  });
  it('returns null for unknown / multi-major / non-registry ranges', () => {
    expect(dominantMajor('*')).toBeNull();
    expect(dominantMajor('latest')).toBeNull();
    expect(dominantMajor('>=16 <19')).toBeNull();
    expect(dominantMajor('17 || 18')).toBeNull();
    expect(dominantMajor('16.0.0 - 18.0.0')).toBeNull();
    expect(dominantMajor('github:user/repo')).toBeNull();
    expect(dominantMajor('workspace:*')).toBeNull();
    expect(dominantMajor(undefined)).toBeNull();
  });
});

describe('analyzeDependencyConstraints — clean', () => {
  it('accepts matching react / react-dom majors', () => {
    const r = analyzeDependencyConstraints(pkg({ react: '^18.2.0', 'react-dom': '^18.2.0' }));
    expect(r.ok).toBe(true);
    expect(r.filesScanned).toBe(1);
  });
  it('does not flag when a version is an unknown range', () => {
    const r = analyzeDependencyConstraints(pkg({ react: '*', 'react-dom': '^18' }));
    expect(r.ok).toBe(true);
  });
  it('accepts matching @types with runtime', () => {
    const r = analyzeDependencyConstraints(pkg({ react: '^18', 'react-dom': '^18', '@types/react': '^18.2.1' }));
    expect(r.ok).toBe(true);
  });
  it('ignores @types/node (no runtime package)', () => {
    const r = analyzeDependencyConstraints(pkg({ '@types/node': '^20.0.0' }));
    expect(r.ok).toBe(true);
  });
});

describe('analyzeDependencyConstraints — conflicts', () => {
  it('flags a react / react-dom major mismatch as HIGH', () => {
    const r = analyzeDependencyConstraints(pkg({ react: '^18.2.0', 'react-dom': '^17.0.2' }));
    expect(r.ok).toBe(false);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].kind).toBe('react-dom-mismatch');
    expect(r.conflicts[0].severity).toBe('high');
  });

  it('flags the same package at different majors in deps vs devDeps as MEDIUM', () => {
    const r = analyzeDependencyConstraints(pkg({ typescript: '^5.4.0' }, { typescript: '^4.9.0' }));
    expect(r.ok).toBe(false);
    const c = r.conflicts.find((x) => x.kind === 'duplicate-version-conflict')!;
    expect(c.package).toBe('typescript');
    expect(c.severity).toBe('medium');
  });

  it('flags a @types/X major mismatch as LOW', () => {
    const r = analyzeDependencyConstraints(pkg({ react: '^18', 'react-dom': '^18', '@types/react': '^17.0.0' }));
    expect(r.ok).toBe(false);
    const c = r.conflicts.find((x) => x.kind === 'types-mismatch')!;
    expect(c.package).toBe('@types/react');
    expect(c.severity).toBe('low');
  });

  it('finds conflicts in a nested package.json too', () => {
    const r = analyzeDependencyConstraints({ 'apps/web/package.json': JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^19' } }) });
    expect(r.ok).toBe(false);
    expect(r.conflicts[0].file).toBe('apps/web/package.json');
  });
});

describe('analyzeDependencyConstraints — robustness', () => {
  it('returns honest zeros with no package.json', () => {
    const r = analyzeDependencyConstraints({ 'src/App.tsx': 'export const A = 1;' });
    expect(r.filesScanned).toBe(0);
    expect(r.ok).toBe(true);
  });
  it('skips invalid JSON without throwing', () => {
    const r = analyzeDependencyConstraints({ 'package.json': '{ not valid json' });
    expect(r.ok).toBe(true);
    expect(r.filesScanned).toBe(0);
  });
});
