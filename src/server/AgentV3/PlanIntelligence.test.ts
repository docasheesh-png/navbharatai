import { describe, it, expect } from 'vitest';
import { analyzePlan, planAnalysisSummary, type PlanTodo } from './PlanIntelligence';

const plan = (...titles: string[]): PlanTodo[] => titles.map((title) => ({ title }));

describe('analyzePlan — testing gap (high)', () => {
  it('flags a multi-step plan with no verification step', () => {
    const f = analyzePlan(plan('Scaffold the project', 'Build the UI', 'Add the API'));
    expect(f.some((x) => x.level === 'high' && /testing\/verification/i.test(x.message))).toBe(true);
  });
  it('does NOT flag when a test/verify step is present', () => {
    const f = analyzePlan(plan('Scaffold the project', 'Build the UI', 'Write unit tests and verify the build'));
    expect(f.some((x) => /testing\/verification/i.test(x.message))).toBe(false);
  });
});

describe('analyzePlan — setup gap (medium)', () => {
  it('flags a 3+ step plan with no setup/scaffold step', () => {
    const f = analyzePlan(plan('Build the homepage', 'Add login form', 'Write tests'));
    expect(f.some((x) => /setup\/scaffolding/i.test(x.message))).toBe(true);
  });
  it('does not flag when setup is present', () => {
    const f = analyzePlan(plan('Initialize the project and install dependencies', 'Build the homepage', 'Write tests'));
    expect(f.some((x) => /setup\/scaffolding/i.test(x.message))).toBe(false);
  });
});

describe('analyzePlan — deploy intent (medium)', () => {
  it('flags when the request asks to deploy but no plan step deploys', () => {
    const f = analyzePlan(plan('Set up the project', 'Build features', 'Test it'), 'build and deploy a portfolio site');
    expect(f.some((x) => /deploy\/release step/i.test(x.message))).toBe(true);
  });
  it('does not flag when a deploy step exists', () => {
    const f = analyzePlan(plan('Set up the project', 'Build and test', 'Deploy to production'), 'build and deploy a portfolio site');
    expect(f.some((x) => /deploy\/release step/i.test(x.message))).toBe(false);
  });
});

describe('analyzePlan — scope', () => {
  it('flags a single-step plan as under-scoped', () => {
    const f = analyzePlan(plan('Build the whole app'));
    expect(f.some((x) => /under-scoped/i.test(x.message))).toBe(true);
  });
  it('flags an over-large plan', () => {
    const f = analyzePlan(plan(...Array.from({ length: 25 }, (_, i) => `Step ${i} with verify`)));
    expect(f.some((x) => /consider grouping/i.test(x.message))).toBe(true);
  });
  it('flags vague generic step titles', () => {
    const f = analyzePlan(plan('setup', 'build', 'finish', 'write tests'));
    expect(f.some((x) => /too vague to act on/i.test(x.message))).toBe(true);
  });
});

describe('analyzePlan — clean plan', () => {
  it('returns no findings for a well-formed plan', () => {
    const f = analyzePlan(
      plan('Initialize project and install dependencies', 'Build the dashboard UI', 'Wire the API', 'Write tests and verify', 'Deploy to production'),
      'build and deploy a dashboard',
    );
    expect(f).toHaveLength(0);
  });
  it('returns [] for an empty plan', () => {
    expect(analyzePlan([])).toEqual([]);
    expect(analyzePlan([{ title: '   ' }])).toEqual([]);
  });
});

describe('planAnalysisSummary', () => {
  it('reports a clean plan with the step count', () => {
    const s = planAnalysisSummary(plan('Init and install deps', 'Build UI', 'Verify with tests'));
    expect(s).toMatch(/Plan review \(3 steps\): ✓ no strategic gaps/);
  });
  it('lists the points to consider, highest severity first', () => {
    const s = planAnalysisSummary(plan('Build the UI', 'Add API'));
    expect(s).toContain('to consider before approving');
    expect(s).toMatch(/⚠ No testing\/verification/);
  });
  it('handles singular step wording', () => {
    expect(planAnalysisSummary(plan('Build everything'))).toMatch(/Plan review \(1 step\)/);
  });
});
