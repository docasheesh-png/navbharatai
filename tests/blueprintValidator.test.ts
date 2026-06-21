import { describe, it, expect } from 'vitest';
import { BlueprintValidator } from '../src/server/AppMakerLab/BlueprintValidator';
import type { ProjectBlueprint } from '../src/server/AppMakerLab/ProjectBlueprint';

function minimalBlueprint(): ProjectBlueprint {
  return {
    version: 'V3',
    id: 'bp-1',
    requirementId: 'req-1',
    name: 'Test App',
    type: 'web',
    userRequirement: { prompt: 'Build it', persona: 'dev', goal: 'test' },
    complexity: { tier: 'Low', estimatedModules: 2, riskFactor: 0.1 },
    generationPlan: { steps: [], phases: [] },
    roles: [{ name: 'admin', permissions: ['all'] }],
    journeys: [],
    businessRules: [],
    pages: [{ path: '/', name: 'Home', components: [] }],
    entities: [{ name: 'User', fields: { id: 'string' } }],
    apiEndpoints: [{ path: '/api/health', method: 'GET', description: 'Health' }],
    requirements: { testing: [], deployment: [], monitoring: [] },
  };
}

describe('BlueprintValidator.validate', () => {
  it('returns isValid:true for a complete blueprint', () => {
    const result = BlueprintValidator.validate(minimalBlueprint());
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error when roles is empty', () => {
    const bp = { ...minimalBlueprint(), roles: [] };
    const { isValid, errors } = BlueprintValidator.validate(bp);
    expect(isValid).toBe(false);
    expect(errors).toContain('No roles defined');
  });

  it('reports error when pages is empty', () => {
    const bp = { ...minimalBlueprint(), pages: [] };
    const { isValid, errors } = BlueprintValidator.validate(bp);
    expect(isValid).toBe(false);
    expect(errors).toContain('No pages defined');
  });

  it('reports error when entities is empty', () => {
    const bp = { ...minimalBlueprint(), entities: [] };
    const { isValid, errors } = BlueprintValidator.validate(bp);
    expect(isValid).toBe(false);
    expect(errors).toContain('No entities defined');
  });

  it('reports error when apiEndpoints is empty', () => {
    const bp = { ...minimalBlueprint(), apiEndpoints: [] };
    const { isValid, errors } = BlueprintValidator.validate(bp);
    expect(isValid).toBe(false);
    expect(errors).toContain('No API endpoints defined');
  });

  it('accumulates multiple errors for multiple missing fields', () => {
    const bp = { ...minimalBlueprint(), roles: [], pages: [], entities: [], apiEndpoints: [] };
    const { isValid, errors } = BlueprintValidator.validate(bp);
    expect(isValid).toBe(false);
    expect(errors).toHaveLength(4);
  });
});
