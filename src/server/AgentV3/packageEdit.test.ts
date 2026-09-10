import { describe, it, expect } from 'vitest';
import { isValidPackageName, isSafeVersionValue, addDependency, removeDependency, listDependencies } from './packageEdit';

const pkg = (obj: Record<string, unknown>) => JSON.stringify(obj, null, 2) + '\n';

describe('isValidPackageName', () => {
  it('accepts real npm names, scoped and unscoped', () => {
    for (const n of ['axios', 'react-dom', 'lodash.merge', '@scope/pkg', '@types/node', 'a']) {
      expect(isValidPackageName(n), n).toBe(true);
    }
  });
  it('rejects names that could break JSON or a shell, or violate npm rules', () => {
    for (const n of ['', ' ', 'UPPER', 'has space', 'semi;rm', '.leadingdot', '_leading', 'a'.repeat(215), 'no/scope-at', '@/pkg', 'pkg`x`']) {
      expect(isValidPackageName(n), n).toBe(false);
    }
  });
});

describe('isSafeVersionValue', () => {
  it('accepts ranges, tags, and blank', () => {
    for (const v of ['', '^1.2.3', '~2.0.0', '1.0.0', 'latest', '>=1 <2'.replace(' ', ''), '*']) {
      expect(isSafeVersionValue(v), v).toBe(true);
    }
  });
  it('rejects quotes/backticks/backslashes/whitespace injected values', () => {
    for (const v of ['1.0.0 && rm', '"1.0"', "1'0", '1`0', '1\\0', 'x'.repeat(101)]) {
      expect(isSafeVersionValue(v), v).toBe(false);
    }
  });
});

describe('addDependency', () => {
  it('adds a new dependency at the default version and reports it', () => {
    const r = addDependency(pkg({ name: 'app', dependencies: {} }), 'axios');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(JSON.parse(r.text).dependencies.axios).toBe('latest');
    expect(r.note).toContain('installs on your next build');
  });
  it('uses the version the user gave', () => {
    const r = addDependency(pkg({ name: 'app', dependencies: {} }), 'axios', '^1.6.0');
    expect(r.ok && JSON.parse(r.text).dependencies.axios).toBe('^1.6.0');
  });
  it('is a no-op when the exact version is already there', () => {
    const r = addDependency(pkg({ name: 'app', dependencies: { axios: '^1.6.0' } }), 'axios', '^1.6.0');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changed).toBe(false);
  });
  it('updates in the EXISTING section instead of creating a duplicate across sections', () => {
    const r = addDependency(pkg({ name: 'app', devDependencies: { vitest: '^1.0.0' } }), 'vitest', '^2.0.0');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.text);
    expect(parsed.devDependencies.vitest).toBe('^2.0.0'); // stayed in devDependencies
    expect(parsed.dependencies?.vitest).toBeUndefined();   // NOT duplicated into dependencies
  });
  it('rejects a bad name or version without touching the file', () => {
    const bad = addDependency(pkg({ name: 'app' }), 'Bad Name');
    expect(bad.ok).toBe(false);
    const badV = addDependency(pkg({ name: 'app' }), 'axios', '1.0 && rm -rf /');
    expect(badV.ok).toBe(false);
  });
  it('rejects malformed package.json honestly', () => {
    const r = addDependency('{ not json', 'axios');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('package.json');
  });
});

describe('removeDependency', () => {
  it('removes from every section it appears in', () => {
    const r = removeDependency(pkg({ name: 'app', dependencies: { axios: '^1' }, devDependencies: { axios: '^1' } }), 'axios');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.text);
    expect(parsed.dependencies.axios).toBeUndefined();
    expect(parsed.devDependencies.axios).toBeUndefined();
  });
  it('is honest when the package was not there', () => {
    const r = removeDependency(pkg({ name: 'app', dependencies: {} }), 'axios');
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.changed).toBe(false); expect(r.note).toContain('nothing to remove'); }
  });
});

describe('listDependencies', () => {
  it('flattens all sections, sorted, with the section named', () => {
    const list = listDependencies(pkg({ name: 'app', dependencies: { react: '^18' }, devDependencies: { vitest: '^2' } }));
    expect(list).toEqual([
      { name: 'react', version: '^18', section: 'dependencies' },
      { name: 'vitest', version: '^2', section: 'devDependencies' },
    ]);
  });
  it('returns [] for malformed package.json', () => {
    expect(listDependencies('nope')).toEqual([]);
  });
});
