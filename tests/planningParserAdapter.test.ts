import { describe, it, expect } from 'vitest';
import { PlanningParserAdapter } from '../src/server/AppMakerLab/PlanningParserAdapter';
import type { InternalRequirementDTO } from '../src/server/AppMakerLab/types';

function req(id = 'req-1'): InternalRequirementDTO {
  return { id, prompt: 'build something', timestamp: Date.now(), metadata: {} };
}

describe('PlanningParserAdapter.parse', () => {
  it('returns a plan with an id starting with "plan_"', () => {
    const plan = PlanningParserAdapter.parse('raw plan text', req());
    expect(plan.id).toMatch(/^plan_\d+$/);
  });

  it('links the plan to the requirement id', () => {
    const plan = PlanningParserAdapter.parse('text', req('req-42'));
    expect(plan.requirementId).toBe('req-42');
  });

  it('includes at least one step', () => {
    const plan = PlanningParserAdapter.parse('text', req());
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('includes a manifest with projectType "react-spa"', () => {
    const plan = PlanningParserAdapter.parse('text', req());
    expect(plan.manifest.projectType).toBe('react-spa');
  });

  it('manifest filesToGenerate is an array', () => {
    const plan = PlanningParserAdapter.parse('text', req());
    expect(Array.isArray(plan.manifest.filesToGenerate)).toBe(true);
  });
});
