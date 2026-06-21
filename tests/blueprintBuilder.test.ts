import { describe, it, expect } from 'vitest';
import { BlueprintBuilder } from '../src/server/AppMakerLab/intelligence/BlueprintBuilder';
import type { StructuredRequirementModel } from '../src/server/AppMakerLab/types/RequirementModels';

function model(overrides: Partial<StructuredRequirementModel> = {}): StructuredRequirementModel {
  return {
    domain: 'general',
    projectType: 'react-spa',
    pages: [],
    entities: [],
    features: [],
    apis: [],
    auth: { enabled: false },
    database: { enabled: false },
    integrations: [],
    ...overrides,
  };
}

describe('BlueprintBuilder.build', () => {
  it('returns a V3 ProjectBlueprint', () => {
    const bp = BlueprintBuilder.build(model());
    expect(bp.version).toBe('V3');
  });

  it('always includes Frontend, Backend, Database modules', () => {
    const bp = BlueprintBuilder.build(model());
    expect(bp.modules).toHaveProperty('Frontend');
    expect(bp.modules).toHaveProperty('Backend');
    expect(bp.modules).toHaveProperty('Database');
  });

  it('adds Authentication module when auth is enabled', () => {
    const bp = BlueprintBuilder.build(model({ auth: { enabled: true } }));
    expect(bp.modules).toHaveProperty('Authentication');
  });

  it('does not add Authentication module when auth is disabled', () => {
    const bp = BlueprintBuilder.build(model({ auth: { enabled: false } }));
    expect(bp.modules).not.toHaveProperty('Authentication');
  });

  it('adds Messaging module for chat feature', () => {
    const bp = BlueprintBuilder.build(model({ features: ['chat'] }));
    expect(bp.modules).toHaveProperty('Messaging');
  });

  it('maps pages to blueprint pages', () => {
    const bp = BlueprintBuilder.build(model({ pages: ['Home', 'Profile'] }));
    expect(bp.pages.length).toBe(2);
    expect(bp.pages[0].name).toBe('Home');
  });

  it('maps entities to blueprint entities', () => {
    const bp = BlueprintBuilder.build(model({ entities: ['User', 'Product'] }));
    expect(bp.entities.length).toBe(2);
  });

  it('maps apis to apiEndpoints', () => {
    const bp = BlueprintBuilder.build(model({ apis: ['createUser'] }));
    expect(bp.apiEndpoints.length).toBe(1);
  });
});
