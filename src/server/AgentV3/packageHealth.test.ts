import { describe, it, expect } from 'vitest';
import { analyzePackageHealth, packageHealthSummary } from './packageHealth';

// GA-3: package.json health. Pure — assert script-tool and duplicate-dep detection, with high precision.

describe('analyzePackageHealth', () => {
  it('flags a script that runs a tool the project never installed', () => {
    const pkg = JSON.stringify({
      scripts: { lint: 'eslint .', build: 'vite build' },
      dependencies: { vite: '^5' }, // eslint missing
    });
    const r = analyzePackageHealth(pkg);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.kind === 'script-tool-missing' && /eslint/.test(i.detail))).toBe(true);
    // vite IS declared → not flagged
    expect(r.issues.every(i => !/vite/.test(i.detail))).toBe(true);
  });

  it('maps tools to their real package (tsc → typescript) and sees through wrappers', () => {
    const pkg = JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit', test: 'cross-env CI=1 vitest run' },
      devDependencies: { typescript: '^5' }, // vitest missing, cross-env not required (wrapper)
    });
    const r = analyzePackageHealth(pkg);
    expect(r.issues.some(i => /vitest/.test(i.detail))).toBe(true);
    expect(r.issues.every(i => !/typescript/.test(i.detail))).toBe(true); // tsc satisfied by typescript
  });

  it('flags a package declared in both dependencies and devDependencies', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18' }, devDependencies: { react: '^18' } });
    const r = analyzePackageHealth(pkg);
    expect(r.issues.some(i => i.kind === 'dup-dep' && /react/.test(i.detail))).toBe(true);
  });

  it('is clean when every script tool is installed and nothing is duplicated', () => {
    const pkg = JSON.stringify({
      scripts: { dev: 'vite', build: 'tsc && vite build', lint: 'eslint .', echo: 'echo hi' },
      dependencies: { vite: '^5' },
      devDependencies: { typescript: '^5', eslint: '^9' },
    });
    const r = analyzePackageHealth(pkg);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('does NOT flag custom/shell commands or node scripts (high precision)', () => {
    const pkg = JSON.stringify({
      scripts: { start: 'node server.js', clean: 'rm -rf dist', custom: 'my-internal-cli run' },
      dependencies: {},
    });
    expect(analyzePackageHealth(pkg).ok).toBe(true);
  });

  it('handles invalid JSON honestly', () => {
    expect(analyzePackageHealth('{ not json').ok).toBe(false);
  });
});

describe('packageHealthSummary', () => {
  it('summarizes OK and issue states', () => {
    expect(packageHealthSummary({ ok: true, issues: [] })).toContain('OK');
    expect(packageHealthSummary({ ok: false, issues: [{ kind: 'dup-dep', detail: 'x' }] })).toContain('1 issue');
  });
});
