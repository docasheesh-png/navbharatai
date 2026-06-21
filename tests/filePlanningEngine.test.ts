import { describe, it, expect } from 'vitest';
import { FilePlanningEngine } from '../src/server/AppMakerLab/intelligence/FilePlanningEngine';
import type { ProjectBlueprint } from '../src/server/AppMakerLab/ProjectBlueprint';

function blueprint(overrides: Partial<ProjectBlueprint> = {}): ProjectBlueprint {
  return {
    version: 'V3',
    id: 'bp-1',
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
    ...overrides,
  };
}

describe('FilePlanningEngine.plan', () => {
  it('generates one page file per page in blueprint', () => {
    const bp = blueprint({ pages: [{ path: '/home', name: 'Home', components: [] }] });
    const plan = FilePlanningEngine.plan(bp);
    expect(plan.files.some(f => f.path.includes('Home.tsx'))).toBe(true);
  });

  it('generates 3 files per entity (type + service + hook)', () => {
    const bp = blueprint({ entities: [{ name: 'User', fields: { id: 'string' } }] });
    const plan = FilePlanningEngine.plan(bp);
    const entityFiles = plan.files.filter(f => f.path.includes('User'));
    expect(entityFiles).toHaveLength(3);
  });

  it('adds auth files when auth is enabled', () => {
    const bp = blueprint({ auth: { enabled: true } });
    const plan = FilePlanningEngine.plan(bp);
    expect(plan.files.some(f => f.path.includes('Login.tsx'))).toBe(true);
    expect(plan.files.some(f => f.path.includes('authService'))).toBe(true);
  });

  it('does NOT add auth files when auth is disabled', () => {
    const bp = blueprint({ auth: { enabled: false } });
    const plan = FilePlanningEngine.plan(bp);
    expect(plan.files.some(f => f.path.includes('Login.tsx'))).toBe(false);
  });

  it('adds repository files for entities when database is enabled', () => {
    const bp = blueprint({ database: { enabled: true }, entities: [{ name: 'Product', fields: {} }] });
    const plan = FilePlanningEngine.plan(bp);
    expect(plan.files.some(f => f.path.includes('ProductRepository'))).toBe(true);
  });

  it('generates api route file for each api endpoint', () => {
    const bp = blueprint({ apiEndpoints: [{ path: '/api/users', method: 'GET', description: 'list users' }] });
    const plan = FilePlanningEngine.plan(bp);
    expect(plan.files.some(f => f.path.includes('users'))).toBe(true);
  });

  it('returns empty files list for an empty blueprint', () => {
    const bp = blueprint();
    const plan = FilePlanningEngine.plan(bp);
    expect(plan.files).toHaveLength(0);
  });
});
