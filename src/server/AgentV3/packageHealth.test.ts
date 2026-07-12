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

  it('flags `npm run X` referencing a script that does not exist', () => {
    const pkg = JSON.stringify({
      scripts: { build: 'npm run clean && vite build' }, // no "clean" script
      devDependencies: { vite: '^5.0.0' },
    });
    const r = analyzePackageHealth(pkg);
    const ref = r.issues.find((i) => i.kind === 'script-missing-ref');
    expect(ref).toBeTruthy();
    expect(ref!.detail).toContain('Missing script: clean');
  });

  it('does NOT flag `npm run X` when the referenced script exists', () => {
    const pkg = JSON.stringify({
      scripts: { clean: 'rm -rf dist', build: 'npm run clean && vite build' },
      devDependencies: { vite: '^5.0.0' },
    });
    expect(analyzePackageHealth(pkg).issues.some((i) => i.kind === 'script-missing-ref')).toBe(false);
  });

  it('recognizes pnpm/yarn/bun run invocations and captures the name past flags', () => {
    const pkg = JSON.stringify({
      scripts: {
        a: 'pnpm run missinga',
        b: 'yarn run missingb',
        c: 'bun run missingc -- --watch',
      },
    });
    const refs = analyzePackageHealth(pkg).issues
      .filter((i) => i.kind === 'script-missing-ref')
      .map((i) => i.detail);
    expect(refs.some((d) => d.includes('missinga'))).toBe(true);
    expect(refs.some((d) => d.includes('missingb'))).toBe(true);
    expect(refs.some((d) => d.includes('missingc'))).toBe(true);
  });

  it('does NOT flag a bare `yarn X` (no run) — ambiguous with a binary, kept zero-false-positive', () => {
    const pkg = JSON.stringify({ scripts: { start: 'yarn dev' } });
    expect(analyzePackageHealth(pkg).issues.some((i) => i.kind === 'script-missing-ref')).toBe(false);
  });

  it('emits one script-missing-ref per (script, referenced-name) pair', () => {
    const pkg = JSON.stringify({
      scripts: { ci: 'npm run lint && npm run lint && npm run typecheck' }, // lint twice, both missing
    });
    const refs = analyzePackageHealth(pkg).issues.filter((i) => i.kind === 'script-missing-ref');
    expect(refs).toHaveLength(2); // lint (once, deduped) + typecheck
  });
});

describe('packageHealthSummary', () => {
  it('summarizes OK and issue states', () => {
    expect(packageHealthSummary({ ok: true, issues: [] })).toContain('OK');
    expect(packageHealthSummary({ ok: false, issues: [{ kind: 'dup-dep', detail: 'x' }] })).toContain('1 issue');
  });
});
