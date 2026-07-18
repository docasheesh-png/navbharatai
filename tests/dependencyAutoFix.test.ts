import { describe, it, expect } from 'vitest';
import { planDependencyAutoFix, dependencyAutoFixSummary, WELL_KNOWN_DEPS, pinKnownDepsInInstallCommand } from '../src/server/AgentV3/DependencyAutoFix';
import type { DependencyIssue } from '../src/server/AgentV3/DependencyAnalysis';

/** P-PIPE.40 — dependency auto-fix planner (advisory, pure). */

const missing = (pkg: string): DependencyIssue => ({ kind: 'missing', package: pkg, severity: 'high', detail: `'${pkg}' is imported but not in package.json` });

describe('planDependencyAutoFix', () => {
  it('routes a well-known npm package to autofixable with its exact version', () => {
    const plan = planDependencyAutoFix([missing('react-router-dom'), missing('zustand')]);
    expect(plan.autofixable).toEqual([
      { package: 'react-router-dom', version: WELL_KNOWN_DEPS['react-router-dom'] },
      { package: 'zustand', version: WELL_KNOWN_DEPS['zustand'] },
    ]);
    expect(plan.needsReview).toEqual([]);
  });

  it('pins the Vue ecosystem to Vue-3-compatible majors (EventHive autopsy): vue-router→4, pinia→2', () => {
    expect(WELL_KNOWN_DEPS['vue-router']).toBe('^4');
    expect(WELL_KNOWN_DEPS['pinia']).toBe('^2');
    const plan = planDependencyAutoFix([missing('vue-router'), missing('pinia')]);
    expect(plan.autofixable).toEqual([
      { package: 'vue-router', version: '^4' },
      { package: 'pinia', version: '^2' },
    ]);
  });

  it('routes an alias-shaped name to needsReview, never auto-suggested (the false-positive guard)', () => {
    const plan = planDependencyAutoFix([missing('components'), missing('lib'), missing('utils'), missing('hooks')]);
    expect(plan.autofixable).toEqual([]);
    expect(plan.needsReview).toEqual(['components', 'lib', 'utils', 'hooks']);
  });

  it('mixes both and dedupes, and ignores non-missing kinds', () => {
    const issues: DependencyIssue[] = [
      missing('axios'),
      missing('axios'), // duplicate
      missing('lib'),
      { kind: 'unused', package: 'left-pad', severity: 'low', detail: 'unused' },
      { kind: 'unpinned', package: 'react', severity: 'medium', detail: 'floating' },
    ];
    const plan = planDependencyAutoFix(issues);
    expect(plan.autofixable).toEqual([{ package: 'axios', version: WELL_KNOWN_DEPS['axios'] }]);
    expect(plan.needsReview).toEqual(['lib']);
  });

  it('is empty for no missing deps', () => {
    const plan = planDependencyAutoFix([]);
    expect(plan.autofixable).toEqual([]);
    expect(plan.needsReview).toEqual([]);
  });
});

describe('dependencyAutoFixSummary', () => {
  it('is empty when there is nothing to say', () => {
    expect(dependencyAutoFixSummary({ autofixable: [], needsReview: [] })).toBe('');
  });
  it('lists exact add-suggestions and a separate verify line', () => {
    const s = dependencyAutoFixSummary(planDependencyAutoFix([missing('axios'), missing('components')]));
    expect(s).toContain('add these to package.json');
    expect(s).toContain(`axios@${WELL_KNOWN_DEPS['axios']}`);
    expect(s).toContain('Verify (imported but not in package.json');
    expect(s).toContain('components');
  });
  it('the well-known allowlist never contains alias-colliding bare names', () => {
    for (const alias of ['components', 'lib', 'utils', 'hooks', 'api', 'store', 'types', 'pages', 'features', 'styles', 'assets', 'config']) {
      expect(WELL_KNOWN_DEPS[alias]).toBeUndefined();
    }
  });
});

describe('pinKnownDepsInInstallCommand (EventHive/MelodyBox: stop bare installs pulling breaking latest)', () => {
  it('pins a bare Prisma install to the pre-7 major (the exact EventHive failure)', () => {
    expect(pinKnownDepsInInstallCommand('npm install prisma @prisma/client'))
      .toBe('npm install prisma@^6 @prisma/client@^6');
  });

  it('pins a bare vue-router/pinia install to the Vue-3-compatible majors', () => {
    expect(pinKnownDepsInInstallCommand('npm install vue-router pinia'))
      .toBe('npm install vue-router@^4 pinia@^2');
  });

  it('does NOT touch `npx prisma generate` — only install sub-commands are rewritten', () => {
    expect(pinKnownDepsInInstallCommand('npx prisma generate')).toBe('npx prisma generate');
    expect(pinKnownDepsInInstallCommand('npx prisma migrate dev --name init')).toBe('npx prisma migrate dev --name init');
  });

  it('respects an EXPLICIT version (prisma@7) — only bare tokens are pinned', () => {
    expect(pinKnownDepsInInstallCommand('npm install prisma@7')).toBe('npm install prisma@7');
  });

  it('handles a && chain: pins the install, leaves the migrate untouched', () => {
    expect(pinKnownDepsInInstallCommand('npm install prisma @prisma/client && npx prisma migrate dev'))
      .toBe('npm install prisma@^6 @prisma/client@^6 && npx prisma migrate dev');
  });

  it('pins across a -D flag and the EventHive-style --legacy-peer-deps fallback chain', () => {
    expect(pinKnownDepsInInstallCommand('npm install -D prisma')).toBe('npm install -D prisma@^6');
    expect(pinKnownDepsInInstallCommand('npm install express || npm install express --legacy-peer-deps'))
      .toBe('npm install express@^4 || npm install express@^4 --legacy-peer-deps');
  });

  it('leaves unknown packages, non-install commands, and bare `npm install` unchanged', () => {
    expect(pinKnownDepsInInstallCommand('npm install left-pad')).toBe('npm install left-pad');
    expect(pinKnownDepsInInstallCommand('npm run build')).toBe('npm run build');
    expect(pinKnownDepsInInstallCommand('npm install')).toBe('npm install');
    expect(pinKnownDepsInInstallCommand('npm ci')).toBe('npm ci');
  });

  it('does not mangle the "prisma" substring inside the scoped @prisma/client token', () => {
    // token-exact matching: `@prisma/client` → `@prisma/client@^6`, never `@prisma@^6/client`.
    expect(pinKnownDepsInInstallCommand('npm i @prisma/client')).toBe('npm i @prisma/client@^6');
  });
});
