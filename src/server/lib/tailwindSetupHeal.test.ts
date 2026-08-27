import { describe, it, expect } from 'vitest';
import { detectTailwindProblems, applyTailwindSetup } from './tailwindSetupHeal';
import { preflightVerify, preflightAndHeal } from './mobileShipPreflight';

/**
 * TAILWIND WIRING — the preflight gap behind a real class of runner deaths (2026-08-27 hardening).
 *
 * CSS is not an import graph the dependency reconciler walks, so an app styled with `@tailwind`
 * directives but never declaring tailwindcss passed every preflight check and died five minutes later
 * on the GitHub runner, inside PostCSS. These tests pin BOTH halves: the detection (including the
 * false positives it must not raise) and the deterministic heal (including its idempotence).
 */

const APP = {
  'package.json': JSON.stringify({
    name: 'x', scripts: { build: 'vite build' },
    dependencies: { react: '^18', 'react-dom': '^18' },
    devDependencies: { vite: '^5' },
  }),
  'index.html': '<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  'src/main.tsx': "import './index.css';\nexport {};",
  'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
};

describe('detectTailwindProblems', () => {
  it('names an app that USES tailwind but never declares it', () => {
    const problems = detectTailwindProblems(APP);
    expect(problems.some((p) => p.kind === 'undeclared')).toBe(true);
  });

  it('a tailwind.config alone is evidence of use', () => {
    const files = { ...APP, 'src/index.css': 'body { margin: 0 }', 'tailwind.config.js': 'module.exports = {}' };
    expect(detectTailwindProblems(files).some((p) => p.kind === 'undeclared')).toBe(true);
  });

  it('an app that does not use tailwind raises NOTHING — the false positive that must not exist', () => {
    const files = { ...APP, 'src/index.css': 'body { margin: 0; } /* plain css */' };
    expect(detectTailwindProblems(files)).toEqual([]);
  });

  it('a correctly declared v3 setup raises nothing', () => {
    const files = {
      ...APP,
      'package.json': JSON.stringify({ name: 'x', devDependencies: { tailwindcss: '^3', postcss: '^8', autoprefixer: '^10' } }),
    };
    expect(detectTailwindProblems(files)).toEqual([]);
  });

  it('the v4 import line is flagged under a v3 (or absent) declaration', () => {
    const files = { ...APP, 'src/index.css': '@import "tailwindcss";\n' };
    expect(detectTailwindProblems(files).some((p) => p.kind === 'v4-import')).toBe(true);
  });

  it('an EXPLICIT v4 declaration is respected, never "corrected"', () => {
    /**
     * Rewriting a setup someone chose on purpose is how a working app gets broken. A declared ^4 with
     * v4 syntax is a coherent project — not ours to touch.
     */
    const files = {
      ...APP,
      'package.json': JSON.stringify({ name: 'x', devDependencies: { tailwindcss: '^4' } }),
      'src/index.css': '@import "tailwindcss";\n',
    };
    expect(detectTailwindProblems(files)).toEqual([]);
  });
});

describe('applyTailwindSetup', () => {
  it('declares the three packages at pinned ranges and writes both configs', () => {
    const out = applyTailwindSetup(APP);
    const pkg = JSON.parse(out.files['package.json']);
    expect(pkg.devDependencies.tailwindcss).toMatch(/^\^3/);
    expect(pkg.devDependencies.postcss).toBe('^8');
    expect(pkg.devDependencies.autoprefixer).toBe('^10');
    expect(out.files['postcss.config.js']).toContain('tailwindcss');
    expect(out.files['tailwind.config.js']).toContain('content');
    expect(detectTailwindProblems(out.files)).toEqual([]);
  });

  it('rewrites the v4 import line to the three v3 directives', () => {
    const files = { ...APP, 'src/index.css': '@import "tailwindcss";\n.btn { color: red }\n' };
    const out = applyTailwindSetup(files);
    expect(out.files['src/index.css']).toContain('@tailwind base;');
    expect(out.files['src/index.css']).toContain('.btn { color: red }');
    expect(out.files['src/index.css']).not.toContain('@import "tailwindcss"');
  });

  it('is idempotent — a healed project heals to itself', () => {
    const once = applyTailwindSetup(APP);
    const twice = applyTailwindSetup(once.files);
    expect(twice.changed).toEqual({});
  });

  it('leaves an existing config where it is — only the missing pieces are written', () => {
    const files = { ...APP, 'postcss.config.cjs': 'module.exports = { plugins: {} }' };
    const out = applyTailwindSetup(files);
    expect(out.files['postcss.config.js']).toBeUndefined();
    expect(out.files['postcss.config.cjs']).toBe(files['postcss.config.cjs']);
  });

  it('an unparseable package.json is left for the syntax check — never half-edited', () => {
    const files = { ...APP, 'package.json': '{ not json' };
    expect(applyTailwindSetup(files).changed).toEqual({});
  });
});

describe('the preflight carries the check end to end', () => {
  it('preflightVerify reports the undeclared use', async () => {
    const report = await preflightVerify(APP);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.message.includes('tailwindcss'))).toBe(true);
  });

  it('preflightAndHeal fixes it DETERMINISTICALLY — with no AI chain at all', async () => {
    /**
     * The empty chain is the point: this class must never need a model. If this test starts failing
     * because the heal "needs AI", the deterministic tier has regressed.
     */
    const result = await preflightAndHeal(APP, async () => null, []);
    expect(result.ok).toBe(true);
    expect(Object.keys(result.changed)).toContain('package.json');
    expect(result.aiRounds).toBe(0);
  });
});
