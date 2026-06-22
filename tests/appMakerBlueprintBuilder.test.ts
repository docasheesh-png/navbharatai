/**
 * Tests for AppMakerLab/BlueprintBuilder — maps InternalRequirementDTO to ProjectBlueprint.
 * This is the main-directory BlueprintBuilder (distinct from intelligence/BlueprintBuilder).
 */
import { describe, it, expect } from 'vitest';
import { BlueprintBuilder } from '../src/server/AppMakerLab/BlueprintBuilder';
import type { InternalRequirementDTO } from '../src/server/AppMakerLab/types';

function makeReq(overrides: Partial<InternalRequirementDTO> = {}): InternalRequirementDTO {
  return {
    id: 'req-001',
    prompt: 'Build a todo app',
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('BlueprintBuilder.build', () => {
  it('returns blueprint version V3', () => {
    const bp = BlueprintBuilder.build(makeReq());
    expect(bp.version).toBe('V3');
  });

  it('sets id as bp_<requirementId>', () => {
    const bp = BlueprintBuilder.build(makeReq({ id: 'req-42' }));
    expect(bp.id).toBe('bp_req-42');
  });

  it('sets requirementId from the input requirement', () => {
    const bp = BlueprintBuilder.build(makeReq({ id: 'my-req' }));
    expect(bp.requirementId).toBe('my-req');
  });

  it('preserves the original prompt in userRequirement', () => {
    const bp = BlueprintBuilder.build(makeReq({ prompt: 'Build an inventory system' }));
    expect(bp.userRequirement.prompt).toBe('Build an inventory system');
  });

  it('sets goal to lowercase prompt', () => {
    const bp = BlueprintBuilder.build(makeReq({ prompt: 'Build An E-Commerce App' }));
    expect(bp.userRequirement.goal).toBe('build an e-commerce app');
  });

  it('returns default complexity tier of Medium', () => {
    const bp = BlueprintBuilder.build(makeReq());
    expect(bp.complexity.tier).toBe('Medium');
    expect(bp.complexity.estimatedModules).toBe(5);
    expect(bp.complexity.riskFactor).toBe(0.5);
  });

  it('returns empty arrays for roles, journeys, pages, entities, apiEndpoints', () => {
    const bp = BlueprintBuilder.build(makeReq());
    expect(bp.roles).toEqual([]);
    expect(bp.journeys).toEqual([]);
    expect(bp.pages).toEqual([]);
    expect(bp.entities).toEqual([]);
    expect(bp.apiEndpoints).toEqual([]);
  });

  it('returns non-empty generationPlan with steps and phases', () => {
    const bp = BlueprintBuilder.build(makeReq());
    expect(bp.generationPlan.steps.length).toBeGreaterThan(0);
    expect(bp.generationPlan.phases.length).toBeGreaterThan(0);
  });
});
