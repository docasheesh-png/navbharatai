import { describe, it, expect } from 'vitest';
import { PatternMatcher } from '../src/server/AppMakerLab/intelligence/PatternMatcher';
import type { ProjectBlueprint } from '../src/server/AppMakerLab/ProjectBlueprint';

function blueprint(overrides: Partial<Pick<ProjectBlueprint, 'features' | 'technologyRequirements' | 'metadata'>>): ProjectBlueprint {
  return {
    version: 'V3', id: '', requirementId: '', name: '', type: '',
    userRequirement: { prompt: '', persona: '', goal: '' },
    complexity: { tier: 'Low', estimatedModules: 1, riskFactor: 0 },
    generationPlan: { steps: [], phases: [] },
    roles: [], journeys: [], businessRules: [], pages: [], entities: [], apiEndpoints: [],
    requirements: { testing: [], deployment: [], monitoring: [] },
    features: overrides.features ?? [],
    technologyRequirements: overrides.technologyRequirements ?? [],
    metadata: overrides.metadata ?? { applicationType: 'web-application', domain: 'general', userRoles: [] },
  } as ProjectBlueprint;
}

describe('PatternMatcher.match', () => {
  const pm = new PatternMatcher();

  it('returns all patterns (score ≥ 0) for a basic non-realtime web project', () => {
    const results = pm.match(blueprint({ features: ['dashboard'] }));
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.score).toBeGreaterThanOrEqual(0));
  });

  it('filters out non-realtime patterns when realtime (messaging) is required', () => {
    const results = pm.match(blueprint({ features: ['messaging'] }));
    // web-standard (supportsRealtime:false) must be excluded
    const ids = results.map(r => r.pattern.id);
    expect(ids).not.toContain('web-standard');
  });

  it('includes realtime-capable patterns when messaging is required', () => {
    const results = pm.match(blueprint({ features: ['messaging'] }));
    const ids = results.map(r => r.pattern.id);
    expect(ids).toContain('web-realtime');
  });

  it('adds "realtime" to matchedConstraints for a realtime-capable pattern', () => {
    const results = pm.match(blueprint({ features: ['messaging'] }));
    const rt = results.find(r => r.pattern.id === 'web-realtime');
    expect(rt?.matchedConstraints).toContain('realtime');
  });

  it('returns only the mobile-app pattern for a mobile project', () => {
    const results = pm.match(blueprint({
      features: [],
      metadata: { applicationType: 'mobile-application', domain: 'general', userRoles: [] },
    }));
    const ids = results.map(r => r.pattern.id);
    expect(ids).toContain('mobile-app');
    expect(ids).not.toContain('web-standard');
    expect(ids).not.toContain('web-realtime');
  });

  it('adds "scalability" constraint for complex projects (> 5 features) with NestJS support', () => {
    const manyFeatures = ['auth', 'billing', 'inventory', 'lab', 'crm', 'analytics'];
    const results = pm.match(blueprint({ features: manyFeatures }));
    const nestjsPattern = results.find(r => r.pattern.supportsBackend?.includes('NestJS'));
    expect(nestjsPattern?.matchedConstraints).toContain('scalability');
  });

  it('returns results sorted descending by score', () => {
    const results = pm.match(blueprint({ features: ['messaging'] }));
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
