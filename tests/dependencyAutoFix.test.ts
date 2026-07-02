import { describe, it, expect } from 'vitest';
import { planDependencyAutoFix, dependencyAutoFixSummary, WELL_KNOWN_DEPS } from '../src/server/AgentV3/DependencyAutoFix';
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
