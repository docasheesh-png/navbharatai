import { describe, it, expect } from 'vitest';
import { PatternMatcher } from '../src/server/AppMakerLab/intelligence/PatternMatcher';
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

describe('PatternMatcher.match', () => {
  const matcher = new PatternMatcher();

  it('returns an array of results', () => {
    const results = matcher.match(bp());
    expect(Array.isArray(results)).toBe(true);
  });

  it('each result has pattern, score, matchedConstraints, rejectedConstraints', () => {
    const results = matcher.match(bp());
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('pattern');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('matchedConstraints');
      expect(results[0]).toHaveProperty('rejectedConstraints');
    }
  });

  it('filters out patterns with negative score', () => {
    const results = matcher.match(bp());
    results.forEach(r => expect(r.score).toBeGreaterThanOrEqual(0));
  });

  it('realtime blueprint matches realtime-supporting pattern', () => {
    const blueprint = bp({ features: ['messaging'] });
    const results = matcher.match(blueprint);
    const realtimeMatch = results.find(r => r.matchedConstraints.includes('realtime'));
    expect(realtimeMatch).toBeDefined();
  });

  it('mobile blueprint matches mobile-supporting pattern', () => {
    const blueprint = bp({ metadata: { applicationType: 'mobile-application', domain: 'general', userRoles: [] } });
    const results = matcher.match(blueprint);
    const mobileMatch = results.find(r => r.matchedConstraints.includes('mobile'));
    expect(mobileMatch).toBeDefined();
  });
});
