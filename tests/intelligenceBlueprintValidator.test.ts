import { describe, it, expect } from 'vitest';
import { BlueprintValidator } from '../src/server/AppMakerLab/intelligence/BlueprintValidator';
import type { ProjectBlueprint } from '../src/server/AppMakerLab/ProjectBlueprint';

function bp(modules: Record<string, { type: any; dependencies: string[] }> = {}): ProjectBlueprint {
  return {
    id: 'bp-1', version: 'V3', requirementId: 'req-1', name: 'Test', type: 'web',
    userRequirement: { prompt: 'test', persona: 'user', goal: 'build' },
    complexity: { tier: 'Low', estimatedModules: 1, riskFactor: 0.1 },
    generationPlan: { steps: [], phases: [] },
    roles: [], journeys: [], businessRules: [], pages: [], entities: [], apiEndpoints: [],
    requirements: { testing: [], deployment: [], monitoring: [] },
    modules: modules as any,
  };
}

describe('BlueprintValidator.validate', () => {
  const validator = new BlueprintValidator();

  it('does not throw for a valid blueprint with no dependencies', () => {
    expect(() => validator.validate(bp({ A: { type: 'FRONTEND', dependencies: [] } }))).not.toThrow();
  });

  it('does not throw when dependency exists in modules', () => {
    const b = bp({ A: { type: 'FRONTEND', dependencies: ['B'] }, B: { type: 'BACKEND', dependencies: [] } });
    expect(() => validator.validate(b)).not.toThrow();
  });

  it('throws for a missing dependency', () => {
    const b = bp({ A: { type: 'FRONTEND', dependencies: ['Ghost'] } });
    expect(() => validator.validate(b)).toThrow('Missing dependency: Ghost for module A');
  });

  it('throws for Authentication → Backend dependency', () => {
    const b = bp({ Authentication: { type: 'AUTH', dependencies: ['Backend'] }, Backend: { type: 'BACKEND', dependencies: [] } });
    expect(() => validator.validate(b)).toThrow('Authentication cannot depend on Backend');
  });

  it('throws for a cycle', () => {
    const b = bp({ A: { type: 'FRONTEND', dependencies: ['B'] }, B: { type: 'FRONTEND', dependencies: ['A'] } });
    expect(() => validator.validate(b)).toThrow('Cycle');
  });

  it('removes "Frontend" dep without throwing', () => {
    const b = bp({ A: { type: 'FRONTEND', dependencies: ['Frontend'] } });
    expect(() => validator.validate(b)).not.toThrow();
    expect(b.modules!['A'].dependencies).not.toContain('Frontend');
  });
});
