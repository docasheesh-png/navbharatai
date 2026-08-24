import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTsconfig, typecheckReachesRoot, withE2eExcluded, e2eExcludeNote } from '../src/server/AgentV3/e2eTypecheck';
import {
  importedModules, ambientModuleBlocks, stripCollidingAmbientShims, findAmbientShimCollisions,
} from '../src/server/AgentV3/ambientModuleShim';

/**
 * A TEST FILE MUST NEVER BE ABLE TO FAIL THE APP'S RELEASE BUILD (admin APK report 2026-08-24).
 *
 * A user's "Build Android APK (installable)" run died in "Build the web app":
 *
 *     ./playwright.config.ts:3:16
 *     Type error: Cannot redeclare block-scoped variable 'devices'.
 *
 * Every link in that chain is ours: we write playwright.config.ts, we deliberately do not install
 * @playwright/test, and `next build` typechecks the project root — so the file cannot compile, a shim
 * was inevitable, and the shim made it worse.
 */

const NEXT_TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, jsx: 'preserve' },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
  exclude: ['node_modules'],
}, null, 2);

const VITE_TSCONFIG = JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }, null, 2);

describe('parseTsconfig — a tsconfig is not plain JSON', () => {
  it('reads comments and trailing commas, which are legal there', () => {
    const cfg = parseTsconfig(`{
      // the app's settings
      "compilerOptions": { "strict": true }, /* inline */
      "include": ["src"],
    }`);
    expect(cfg).toEqual({ compilerOptions: { strict: true }, include: ['src'] });
  });

  it('does NOT strip a // inside a string — that is a path, not a comment', () => {
    const cfg = parseTsconfig('{ "paths": { "x": ["https://example.com/x"] } }');
    expect((cfg as any).paths.x[0]).toBe('https://example.com/x');
  });

  it('🔒 anything unreadable is null, never a guess', () => {
    for (const bad of ['', '   ', '{ not json', '[]', 'null', '"a string"']) {
      expect(parseTsconfig(bad), bad).toBeNull();
    }
  });
});

describe('typecheckReachesRoot — the narrowness IS the safety', () => {
  it('a Next.js config sweeps the whole project', () => {
    expect(typecheckReachesRoot(parseTsconfig(NEXT_TSCONFIG)!)).toBe(true);
  });

  it('🔒 a Vite config builds only src/, so it is left completely alone', () => {
    // Editing this config would be a change with no defect behind it.
    expect(typecheckReachesRoot(parseTsconfig(VITE_TSCONFIG)!)).toBe(false);
  });

  it('no include at all means every file', () => {
    expect(typecheckReachesRoot({})).toBe(true);
    expect(typecheckReachesRoot({ include: [] })).toBe(true);
    expect(typecheckReachesRoot({ include: ['.'] })).toBe(true);
  });

  it('a shape we do not understand is treated as out of scope', () => {
    expect(typecheckReachesRoot({ include: 'src' as unknown as string[] })).toBe(false);
  });
});

describe('withE2eExcluded', () => {
  it('🔒 the reported failure: a Next.js app stops typechecking our test files', () => {
    const out = withE2eExcluded(NEXT_TSCONFIG);
    expect(out.changed).toBe(true);
    expect(out.added).toEqual(['playwright.config.ts', 'e2e']);
    const cfg = parseTsconfig(out.text)!;
    expect(cfg.exclude).toEqual(['node_modules', 'playwright.config.ts', 'e2e']);
    // Everything else survives the rewrite — this must not quietly reshape someone's config.
    expect(cfg.compilerOptions).toEqual({ strict: true, jsx: 'preserve' });
    expect(cfg.include).toEqual(['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts']);
  });

  it('🔒 a Vite project is returned BYTE-IDENTICAL', () => {
    const out = withE2eExcluded(VITE_TSCONFIG);
    expect(out.changed).toBe(false);
    expect(out.text).toBe(VITE_TSCONFIG);
    expect(out.reason).toContain('only its source folder');
  });

  it('🔒 an unparseable config is never rewritten — a corrupted project is worse than a failed build', () => {
    const broken = '{ "compilerOptions": ';
    const out = withE2eExcluded(broken);
    expect(out.changed).toBe(false);
    expect(out.text).toBe(broken);
  });

  it('already excluded ⇒ no write, in any of the spellings people use', () => {
    for (const form of ['e2e', 'e2e/**', './e2e/**/*']) {
      const cfg = JSON.stringify({ include: ['**/*.ts'], exclude: ['node_modules', 'playwright.config.ts', form] });
      expect(withE2eExcluded(cfg).changed, form).toBe(false);
    }
  });

  it('a config with no exclude at all still keeps node_modules out', () => {
    const cfg = parseTsconfig(withE2eExcluded(JSON.stringify({ include: ['**/*.ts'] })).text)!;
    expect(cfg.exclude).toContain('node_modules');
  });

  it('running it twice changes nothing the second time', () => {
    const once = withE2eExcluded(NEXT_TSCONFIG);
    expect(withE2eExcluded(once.text).changed).toBe(false);
  });

  it('the note says what was changed and why', () => {
    const note = e2eExcludeNote(['playwright.config.ts', 'e2e']);
    expect(note).toContain('playwright.config.ts');
    expect(note).toContain('Playwright, which is not installed');
  });
});

describe('the shim that made it worse', () => {
  // The admin's file, verbatim in shape.
  const POISONED = `declare module '@playwright/test' {
  export function defineConfig(config: any): any;
  export const devices: Record<string, any>;
}

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({ projects: [{ use: { ...devices['Desktop Chrome'] } }] });
`;

  it('🔒 removes the declaration that collides with the file’s own import', () => {
    const out = stripCollidingAmbientShims(POISONED);
    expect(out.removed).toEqual(['@playwright/test']);
    expect(out.source).not.toContain('declare module');
    expect(out.source.startsWith("import { defineConfig, devices }")).toBe(true);
    // The real code is untouched.
    expect(out.source).toContain("...devices['Desktop Chrome']");
  });

  it('🔒 NEVER touches a wildcard declaration — that is the correct way to type an asset import', () => {
    const legit = `declare module '*.css';\ndeclare module '*.svg' {\n  const c: string;\n  export default c;\n}\nimport './app.css';\n`;
    expect(stripCollidingAmbientShims(legit).removed).toEqual([]);
    expect(stripCollidingAmbientShims(legit).source).toBe(legit);
  });

  it('leaves an ambient declaration for a module the file does NOT import', () => {
    // A real .d.ts-style augmentation is legitimate; only the collision is an error.
    const fine = `declare module 'some-untyped-lib' {\n  export const x: number;\n}\nimport { y } from './local';\n`;
    expect(stripCollidingAmbientShims(fine).removed).toEqual([]);
  });

  it('matches braces rather than the first }, so a nested body is removed whole', () => {
    const nested = `declare module 'x' {\n  export interface A { b: string }\n  export const c: number;\n}\nimport 'x';\nconst keep = 1;\n`;
    const out = stripCollidingAmbientShims(nested);
    expect(out.removed).toEqual(['x']);
    expect(out.source).not.toContain('interface A');
    expect(out.source).toContain('const keep = 1;');
  });

  it('🔒 an unbalanced block is left alone rather than half-deleted', () => {
    const broken = `declare module 'x' {\n  export const a: number;\nimport 'x';\n`;
    expect(ambientModuleBlocks(broken)).toEqual([]);
    expect(stripCollidingAmbientShims(broken).source).toBe(broken);
  });

  it('importedModules sees every form that creates a binding', () => {
    const src = `import a from 'p1';\nimport 'p2';\nexport { z } from 'p3';\nconst r = require('p4');\nawait import('p5');`;
    const found = importedModules(src);
    for (const m of ['p1', 'p2', 'p3', 'p4', 'p5']) expect(found.has(m), m).toBe(true);
  });

  it('findAmbientShimCollisions only looks at TypeScript, and rejects cheaply', () => {
    const found = findAmbientShimCollisions({
      'playwright.config.ts': POISONED,
      'a.js': POISONED,          // JavaScript cannot carry `declare module`
      'b.ts': 'export const x = 1;',
    });
    expect(found).toEqual([{ path: 'playwright.config.ts', module: '@playwright/test' }]);
  });
});

describe('🔒 the wiring', () => {
  const routes = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('the exclude runs for ANY project that has the files, not just a fresh scaffold', () => {
    // Our scaffold writer is create-only, so an app given the config on an earlier build would never
    // be repaired if this were gated on having just written it — and that app is exactly the broken one.
    expect(routes).toContain("const hasE2eFiles = Object.keys(projectNow)");
    expect(routes).toContain('withE2eExcluded(tsconfigRaw)');
    expect(routes).toContain("code: 'E2E_EXCLUDED_FROM_BUILD'");
  });

  it('the shim removal runs too, so the file itself is repaired and not just hidden', () => {
    expect(routes).toContain('findAmbientShimCollisions(projectNow)');
    expect(routes).toContain("code: 'AMBIENT_SHIM_REMOVED'");
  });

  it('🔒 neither touches an import/survey turn, where the user asked us not to change files', () => {
    const at = routes.indexOf('findAmbientShimCollisions(projectNow)');
    const before = routes.slice(at - 400, at);
    expect(before).toContain('if (!isImportTurn) {');
    expect(routes).toContain('if (hasE2eFiles && !isImportTurn) {');
  });
});
