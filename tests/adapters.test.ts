import { describe, it, expect } from 'vitest';
import { PlanningParserAdapter } from '../src/server/AppMakerLab/PlanningParserAdapter';
import { RequirementsParserAdapter } from '../src/server/AppMakerLab/RequirementsParserAdapter';

describe('RequirementsParserAdapter', () => {
  it('parses raw prompt into InternalRequirementDTO', () => {
    const dto = RequirementsParserAdapter.parse('build a todo app');
    expect(dto.prompt).toBe('build a todo app');
    expect(dto.id).toMatch(/^req_/);
    expect(typeof dto.timestamp).toBe('number');
  });

  it('returns empty metadata', () => {
    const dto = RequirementsParserAdapter.parse('anything');
    expect(dto.metadata).toEqual({});
  });
});

describe('PlanningParserAdapter', () => {
  it('returns a plan with the requirement id', () => {
    const req = { id: 'req-42', prompt: 'test', timestamp: Date.now(), metadata: {} };
    const plan = PlanningParserAdapter.parse('raw plan text', req);
    expect(plan.requirementId).toBe('req-42');
  });

  it('includes at least one step', () => {
    const req = { id: 'req-1', prompt: 'test', timestamp: Date.now(), metadata: {} };
    const plan = PlanningParserAdapter.parse('raw', req);
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('sets projectType to react-spa', () => {
    const req = { id: 'req-1', prompt: 'test', timestamp: Date.now(), metadata: {} };
    const plan = PlanningParserAdapter.parse('raw', req);
    expect(plan.manifest.projectType).toBe('react-spa');
  });
});
