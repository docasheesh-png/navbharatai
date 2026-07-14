import { describe, it, expect } from 'vitest';
import { hashFiles, computeBuildPlan, buildPlanNarration } from './IncrementalBuildCache';

describe('computeBuildPlan — unified incremental plan', () => {
  it('classifies changed/added/unchanged and computes the IMPACTED blast radius', () => {
    const v1 = {
      'src/util.ts': 'export const x = 1;\n',
      'src/a.ts': "import { x } from './util';\nexport const a = x;\n",
      'src/b.ts': "import { a } from './a';\nexport const b = a;\n",
    };
    const prev = hashFiles(v1);
    // Change util.ts only. a.ts imports util, b.ts imports a → both are impacted transitively.
    const v2 = { ...v1, 'src/util.ts': 'export const x = 2;\n' };
    const plan = computeBuildPlan(prev, v2);
    expect(plan.changed).toEqual(['src/util.ts']);
    expect(plan.unchanged.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(plan.impacted.sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/util.ts']); // change + transitive dependents
    expect(plan.depsChanged).toBe(false);
    expect(plan.hadPrevious).toBe(true);
  });

  it('flags depsChanged when a lockfile is added/changed', () => {
    const prev = hashFiles({ 'package-lock.json': '{"v":1}', 'src/a.ts': 'export const a = 1;' });
    const plan = computeBuildPlan(prev, { 'package-lock.json': '{"v":2}', 'src/a.ts': 'export const a = 1;' });
    expect(plan.depsChanged).toBe(true);
    expect(plan.changed).toContain('package-lock.json');
  });

  it('first build (no previous) → everything is added, hadPrevious false', () => {
    const plan = computeBuildPlan(null, { 'src/a.ts': 'export const a = 1;' });
    expect(plan.hadPrevious).toBe(false);
    expect(plan.added).toEqual(['src/a.ts']);
    expect(plan.unchanged).toEqual([]);
  });
});

describe('buildPlanNarration', () => {
  it('is empty on the first build (nothing to compare)', () => {
    expect(buildPlanNarration(computeBuildPlan(null, { 'a.ts': 'x' }))).toBe('');
  });

  it('reports unchanged + impacted + a deps-unchanged signal', () => {
    const v1 = { 'src/util.ts': 'export const x=1;', 'src/a.ts': "import {x} from './util';", 'keep.ts': 'export const k=1;' };
    const prev = hashFiles(v1);
    const line = buildPlanNarration(computeBuildPlan(prev, { ...v1, 'src/util.ts': 'export const x=2;' }));
    expect(line).toContain('unchanged');
    expect(line).toContain('impacted');
    expect(line).toContain('dependencies unchanged');
  });

  it('says a reinstall is needed when deps changed', () => {
    const prev = hashFiles({ 'yarn.lock': 'a', 'x.ts': 'export const x=1;', 'y.ts': 'export const y=1;' });
    const line = buildPlanNarration(computeBuildPlan(prev, { 'yarn.lock': 'b', 'x.ts': 'export const x=1;', 'y.ts': 'export const y=1;' }));
    expect(line).toContain('reinstall needed');
  });
});
