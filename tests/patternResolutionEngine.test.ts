import { describe, it, expect } from 'vitest';
import { PatternResolutionEngine } from '../src/server/AppMakerLab/intelligence/PatternResolutionEngine';
import type { ProjectBlueprint } from '../src/server/AppMakerLab/ProjectBlueprint';

function bp(overrides: Partial<ProjectBlueprint> = {}): ProjectBlueprint {
  return {
    version: 'V3',
    id: 'bp-1',
    requirementId: 'req-1',
    name: 'Test',
    type: 'web',
    userRequirement: { prompt: 'test', persona: 'user', goal: 'build' },
    complexity: { tier: 'Low', estimatedModules: 2, riskFactor: 0.1 },
    generationPlan: { steps: [], phases: [] },
    roles: [],
    journeys: [],
    businessRules: [],
    pages: [],
    entities: [],
    apiEndpoints: [],
    requirements: { testing: [], deployment: [], monitoring: [] },
    features: [],
    technologyRequirements: [],
    metadata: { applicationType: 'web-application', domain: 'general', userRoles: [] },
    ...overrides,
  };
}

describe('PatternResolutionEngine.resolve', () => {
  const engine = new PatternResolutionEngine();

  it('returns a TechnologyArchitectureBlueprint with a stack', () => {
    const result = engine.resolve(bp());
    expect(result.stack).toBeDefined();
  });

  it('stack has a frontend property', () => {
    const result = engine.resolve(bp());
    expect(result.stack.frontend).toBeTruthy();
  });

  it('returns matchedConstraints and rejectedConstraints arrays', () => {
    const result = engine.resolve(bp());
    expect(Array.isArray(result.matchedConstraints)).toBe(true);
    expect(Array.isArray(result.rejectedConstraints)).toBe(true);
  });

  it('returns rationale array', () => {
    const result = engine.resolve(bp());
    expect(Array.isArray(result.rationale)).toBe(true);
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it('realtime blueprint resolves to realtime-capable stack', () => {
    const result = engine.resolve(bp({ features: ['messaging'] }));
    expect(result.stack).toBeDefined();
  });
});
