/**
 * THE TEST RUNNER WE PIN MUST RUN ON THE APP'S OWN VITE, AND THE E2E NET WE DO NOT RUN MUST NOT
 * REWRITE package.json MID-CHECK (autopsy 7d79254b, 2026-09-26).
 *
 * Two open root causes from the EduHub report, fixed together because both were OUR edits to the
 * user's package.json:
 *
 *   G2 — the model typed `npm i -D vitest @vitest/ui jsdom`, and `pinKnownDepsInInstallCommand`
 *        rewrote it to `vitest@^2` on a Vite 8 app. vitest 2 cannot use Vite 8, so npm nested its own
 *        Vite 5 + esbuild, which carried the build's two critical advisories.
 *   G1 — the dependency reconciler read our own `e2e/smoke.spec.ts`, found `@playwright/test`
 *        "missing" and added it to package.json during the preview check. That made the next command
 *        reinstall and restart the dev server — the reload the render check then read as a failure.
 */
import { describe, it, expect } from 'vitest';
import {
  applyWellKnownMissingDeps,
  knownDepVersion,
  pinKnownDepsInInstallCommand,
  planDependencyAutoFix,
  viteRangeOf,
  vitestRangeForVite,
} from '../src/server/AgentV3/DependencyAutoFix';
import { isPlatformE2eScaffold, planE2eScaffold } from '../src/server/AgentV3/e2eScaffold';

const VITE8_PKG = JSON.stringify({
  name: 'eduhub',
  dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
  devDependencies: { vite: '^8.3.0', '@vitejs/plugin-react': '^5.0.0' },
});

describe('G2 — the vitest major follows the project\'s Vite', () => {
  it('Vite 8 (our own scaffold) gets vitest 5, and never vitest 2', () => {
    expect(vitestRangeForVite('^8.3.0')).toBe('^5');
    expect(vitestRangeForVite('^7.1.0')).toBe('^5');
    expect(vitestRangeForVite('^6.4.0')).toBe('^5');
  });

  it('Vite 5 gets vitest 3 — vitest 5 does not peer Vite 5', () => {
    expect(vitestRangeForVite('^5.4.0')).toBe('^3');
    expect(vitestRangeForVite('~5.0.0')).toBe('^3');
  });

  it('no Vite at all gets the current default', () => {
    expect(vitestRangeForVite(undefined)).toBe('^5');
    expect(vitestRangeForVite(null)).toBe('^5');
    expect(vitestRangeForVite('')).toBe('^5');
  });

  it('reads Vite from either section, and survives a broken package.json', () => {
    expect(viteRangeOf(VITE8_PKG)).toBe('^8.3.0');
    expect(viteRangeOf(JSON.stringify({ dependencies: { vite: '^5.2.0' } }))).toBe('^5.2.0');
    expect(viteRangeOf('{ not json')).toBeUndefined();
    expect(viteRangeOf(undefined)).toBeUndefined();
  });

  it('the report\'s own command is pinned to a runner that uses Vite 8', () => {
    const cmd = 'npm i -D vitest @vitest/ui jsdom @testing-library/react';
    const pinned = pinKnownDepsInInstallCommand(cmd, { viteRange: viteRangeOf(VITE8_PKG) });
    expect(pinned).toContain('vitest@^5');
    expect(pinned).toContain('@vitest/ui@^5');
    expect(pinned).not.toMatch(/vitest@\^2/);
  });

  it('with no project context the default is still a Vite-8-capable runner', () => {
    expect(pinKnownDepsInInstallCommand('npm i -D vitest')).toBe('npm i -D vitest@^5');
    expect(knownDepVersion('vitest')).toBe('^5');
    expect(knownDepVersion('@vitest/coverage-v8')).toBe('^5');
  });

  it('a Vite 5 project gets the whole vitest family on ONE major', () => {
    const pinned = pinKnownDepsInInstallCommand('npm i -D vitest @vitest/coverage-v8 @vitest/ui', { viteRange: '^5.4.0' });
    expect(pinned).toBe('npm i -D vitest@^3 @vitest/coverage-v8@^3 @vitest/ui@^3');
  });

  it('an explicit version the model typed is still respected', () => {
    expect(pinKnownDepsInInstallCommand('npm i -D vitest@4.1.0', { viteRange: '^8.3.0' })).toBe('npm i -D vitest@4.1.0');
  });

  it('the reconciler plans the same Vite-matched version', () => {
    const plan = planDependencyAutoFix([{ kind: 'missing', package: 'vitest', severity: 'error', detail: '' } as never], { viteRange: '^5.4.0' });
    expect(plan.autofixable).toEqual([{ package: 'vitest', version: '^3' }]);
  });
});

describe('G1 — the E2E net we write but do not run never rewrites package.json', () => {
  const e2e = planE2eScaffold({ routes: ['/', '/courses'] });

  it('our own E2E scaffold alone adds nothing — package.json is untouched', () => {
    const files: Record<string, string> = { 'package.json': VITE8_PKG, 'src/App.tsx': 'export default () => null;\n' };
    Object.assign(files, e2e.files);
    // Guard the premise: the scaffold really does import the runner we are choosing not to install.
    expect(Object.values(files).some((c) => c.includes('@playwright/test'))).toBe(true);
    const r = applyWellKnownMissingDeps(files);
    expect(r.added).toEqual([]);
    expect(r.files['package.json']).toBe(VITE8_PKG);
  });

  it('a Playwright suite the MODEL wrote on purpose is still declared — the skip is our marker, not the path', () => {
    const r = applyWellKnownMissingDeps({
      'package.json': VITE8_PKG,
      'e2e/login.spec.ts': "import { test, expect } from '@playwright/test';\ntest('logs in', async () => {});\n",
    });
    expect(r.added.map((a) => a.package)).toContain('@playwright/test');
  });

  it('recognises exactly our two files and nothing else', () => {
    for (const [path, content] of Object.entries(e2e.files)) expect(isPlatformE2eScaffold(path, content), path).toBe(true);
    expect(isPlatformE2eScaffold('e2e/login.spec.ts', "import { test } from '@playwright/test';")).toBe(false);
    expect(isPlatformE2eScaffold('src/notes.ts', e2e.files['e2e/smoke.spec.ts'])).toBe(false);
  });

  it('a Playwright import in APP code is still reconciled', () => {
    const r = applyWellKnownMissingDeps({
      'package.json': VITE8_PKG,
      'src/visual.ts': "import { test } from '@playwright/test';\nexport const t = test;\n",
    });
    expect(r.added.map((a) => a.package)).toContain('@playwright/test');
  });

  it('a real missing app dependency beside the E2E net is still added', () => {
    const r = applyWellKnownMissingDeps({
      'package.json': VITE8_PKG,
      ...e2e.files,
      'src/api.ts': "import axios from 'axios';\nexport const api = axios.create();\n",
    });
    expect(r.added.map((a) => a.package)).toEqual(['axios']);
  });
});

describe('🔒 the shell tool pins with the project in view', () => {
  it('the dispatcher hands the pinner the app\'s own package.json', () => {
    // tsc and vitest cannot see that a caller dropped the context argument — the pin would silently go
    // back to the default major for every project.
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8') as string;
    expect(src).toMatch(/pinKnownDepsInInstallCommand\(command, pinCtx\)/);
    expect(src).toMatch(/viteRange: viteRangeOf\(/);
  });
});
