import { describe, it, expect } from 'vitest';
import {
  parsePackageSpec,
  addDependency,
  removeDependency,
  npmActionForVerb,
} from '../src/lib/packageJsonOps';

/** P-DEV.5 — package.json manifest ops (pure). */

describe('packageJsonOps — parsePackageSpec', () => {
  it('parses plain, versioned, and scoped specs', () => {
    expect(parsePackageSpec('axios')).toEqual({ name: 'axios' });
    expect(parsePackageSpec('react@18.2.0')).toEqual({ name: 'react', version: '18.2.0' });
    expect(parsePackageSpec('@scope/pkg')).toEqual({ name: '@scope/pkg' });
    expect(parsePackageSpec('@scope/pkg@1.2.3')).toEqual({ name: '@scope/pkg', version: '1.2.3' });
  });
  it('returns null for empty', () => {
    expect(parsePackageSpec('')).toBeNull();
    expect(parsePackageSpec('   ')).toBeNull();
  });
});

const base = JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } }, null, 2) + '\n';

describe('packageJsonOps — addDependency', () => {
  it('adds with the given version and keeps deps sorted', () => {
    const r = addDependency(base, 'axios', '1.6.0');
    expect(r.ok).toBe(true);
    const pkg = JSON.parse(r.text);
    expect(pkg.dependencies.axios).toBe('1.6.0');
    expect(Object.keys(pkg.dependencies)).toEqual(['axios', 'react']); // sorted
    expect(r.message).toContain('added axios@1.6.0');
  });
  it('defaults to the "latest" tag (no fabricated version) when none given', () => {
    expect(JSON.parse(addDependency(base, 'lodash').text).dependencies.lodash).toBe('latest');
  });
  it('supports devDependencies', () => {
    const r = addDependency(base, 'vitest', '2.0.0', true);
    expect(JSON.parse(r.text).devDependencies.vitest).toBe('2.0.0');
  });
  it('fails on invalid JSON', () => {
    expect(addDependency('{not json', 'x').ok).toBe(false);
  });
});

describe('packageJsonOps — removeDependency', () => {
  it('removes an existing dependency', () => {
    const r = removeDependency(base, 'react');
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text).dependencies.react).toBeUndefined();
    expect(r.message).toContain('removed react');
  });
  it('reports when the dep is absent', () => {
    const r = removeDependency(base, 'nope');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not a dependency');
  });
});

describe('packageJsonOps — npmActionForVerb', () => {
  it('maps install/uninstall aliases', () => {
    expect(npmActionForVerb('install')).toBe('install');
    expect(npmActionForVerb('i')).toBe('install');
    expect(npmActionForVerb('add')).toBe('install');
    expect(npmActionForVerb('uninstall')).toBe('uninstall');
    expect(npmActionForVerb('remove')).toBe('uninstall');
    expect(npmActionForVerb('rm')).toBe('uninstall');
    expect(npmActionForVerb('run')).toBeNull();
  });
});
