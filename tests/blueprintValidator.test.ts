import { describe, it, expect } from 'vitest';
import { BlueprintValidator } from '../src/server/AppMakerLab/BlueprintValidator';
import type { ProjectBlueprint } from '../src/server/AppMakerLab/ProjectBlueprint';

function makeBlueprint(overrides: Partial<ProjectBlueprint> = {}): ProjectBlueprint {
  return {
    version: 'V3',
    id: 'bp-1',
    requirementId: 'req-1',
    name: 'Test App',
    type: 'web',
    userRequirement: { prompt: 'build something', intent: 'test' } as any,
    roles: [{ name: 'admin', permissions: ['read', 'write'] }],
    pages: [{ path: '/', name: 'Home', components: ['Header'] }],
    entities: [{ name: 'User', fields: { id: 'string' } }],
    apiEndpoints: [{ path: '/api/users', method: 'GET', description: 'List users' }],
    ...overrides,
  } as ProjectBlueprint;
}

describe('BlueprintValidator', () => {
  it('returns isValid true when all required fields present', () => {
    const result = BlueprintValidator.validate(makeBlueprint());
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when roles is empty', () => {
    const result = BlueprintValidator.validate(makeBlueprint({ roles: [] }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('roles'))).toBe(true);
  });

  it('returns error when pages is empty', () => {
    const result = BlueprintValidator.validate(makeBlueprint({ pages: [] }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('pages'))).toBe(true);
  });

  it('returns error when entities is empty', () => {
    const result = BlueprintValidator.validate(makeBlueprint({ entities: [] }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('entities'))).toBe(true);
  });

  it('returns error when apiEndpoints is empty', () => {
    const result = BlueprintValidator.validate(makeBlueprint({ apiEndpoints: [] }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('API'))).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const result = BlueprintValidator.validate(makeBlueprint({ roles: [], pages: [], entities: [], apiEndpoints: [] }));
    expect(result.errors).toHaveLength(4);
  });
});
