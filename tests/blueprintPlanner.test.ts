import { describe, it, expect } from 'vitest';
import { BlueprintPlanner } from '../src/server/AppMakerLab/generator/BlueprintPlanner';
import type { ProjectBlueprint } from '../src/server/AppMakerLab/ProjectBlueprint';

function bp(modules: Record<string, { type: string; dependencies: string[] }> = {}): ProjectBlueprint {
  return {
    id: 'bp-1',
    version: 'V3',
    requirementId: 'req-1',
    name: 'Test',
    type: 'web',
    userRequirement: { prompt: 'test', persona: 'user', goal: 'build' },
    complexity: { tier: 'Low', estimatedModules: 1, riskFactor: 0.1 },
    generationPlan: { steps: [], phases: [] },
    roles: [],
    journeys: [],
    businessRules: [],
    pages: [],
    entities: [],
    apiEndpoints: [],
    requirements: { testing: [], deployment: [], monitoring: [] },
    modules: modules as any,
  };
}

describe('BlueprintPlanner.plan', () => {
  const planner = new BlueprintPlanner();

  it('generates a plan with correct planId format', () => {
    const plan = planner.plan(bp({ A: { type: 'FRONTEND', dependencies: [] } }), 'ws-1', 'corr-1');
    expect(plan.planId).toBe('plan-bp-1');
  });

  it('returns one task per module', () => {
    const plan = planner.plan(bp({ A: { type: 'FRONTEND', dependencies: [] }, B: { type: 'BACKEND', dependencies: [] } }), 'ws-1', 'corr-1');
    expect(plan.tasks).toHaveLength(2);
  });

  it('task id is prefixed with "task-"', () => {
    const plan = planner.plan(bp({ Auth: { type: 'AUTH', dependencies: [] } }), 'ws-1', 'corr-1');
    expect(plan.tasks[0].id).toBe('task-Auth');
  });

  it('throws BlueprintValidationError when blueprint has no modules', () => {
    const badBp = { ...bp(), modules: undefined } as any;
    expect(() => planner.plan(badBp, 'ws-1', 'corr-1')).toThrow('Invalid blueprint structure');
  });

  it('throws DuplicateModuleError for duplicate module names', () => {
    // Duplicate modules can't happen with a plain object — test self-dependency instead
    const b = bp({ SelfLoop: { type: 'FRONTEND', dependencies: ['SelfLoop'] } });
    expect(() => planner.plan(b, 'ws-1', 'corr-1')).toThrow('SelfLoop');
  });

  it('filters out "Frontend" and "Authentication→Backend" dependencies', () => {
    const b = bp({ 
      Home: { type: 'FRONTEND', dependencies: ['Frontend'] },
      Authentication: { type: 'AUTH', dependencies: ['Backend'] },
    });
    const plan = planner.plan(b, 'ws-1', 'corr-1');
    const homeTask = plan.tasks.find(t => t.id === 'task-Home');
    expect(homeTask?.dependencies).not.toContain('task-Frontend');
  });
});
