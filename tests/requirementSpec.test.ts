import { describe, it, expect, vi } from 'vitest';
import { extractRequirementSpec, specSummary, hasUsefulSpec } from '../src/server/project/RequirementSpec';
import type { ModelCall } from '../src/server/project/aiEdits';

describe('extractRequirementSpec', () => {
  it('parses a valid JSON response from the model', async () => {
    const callModel: ModelCall = vi.fn().mockResolvedValue(
      '{"appType":"CRM","modules":["Contacts","Deals"],"pages":["Dashboard","Contacts"],"entities":["Contact","Deal"]}'
    );
    const spec = await extractRequirementSpec(callModel, 'build a CRM');
    expect(spec.appType).toBe('CRM');
    expect(spec.modules).toContain('Contacts');
    expect(spec.entities).toContain('Deal');
  });

  it('returns empty spec when model returns invalid JSON', async () => {
    const callModel: ModelCall = vi.fn().mockResolvedValue('not json at all');
    const spec = await extractRequirementSpec(callModel, 'anything');
    expect(spec.appType).toBe('');
    expect(spec.modules).toHaveLength(0);
  });

  it('strips markdown fences from model response', async () => {
    const callModel: ModelCall = vi.fn().mockResolvedValue(
      '```json\n{"appType":"Todo","modules":["Tasks"],"pages":["Home"],"entities":["Task"]}\n```'
    );
    const spec = await extractRequirementSpec(callModel, 'build a todo');
    expect(spec.appType).toBe('Todo');
  });

  it('returns empty spec when model call throws', async () => {
    const callModel: ModelCall = vi.fn().mockRejectedValue(new Error('network error'));
    const spec = await extractRequirementSpec(callModel, 'anything');
    expect(spec.modules).toHaveLength(0);
  });
});

describe('specSummary', () => {
  it('returns empty string for empty spec', () => {
    expect(specSummary({ appType: '', modules: [], pages: [], entities: [] })).toBe('');
  });

  it('includes modules section when modules present', () => {
    const summary = specSummary({ appType: 'CRM', modules: ['Contacts'], pages: [], entities: [] });
    expect(summary).toContain('MODULES');
    expect(summary).toContain('Contacts');
  });

  it('includes all sections when all populated', () => {
    const summary = specSummary({ appType: 'App', modules: ['M1'], pages: ['P1'], entities: ['E1'] });
    expect(summary).toContain('MODULES');
    expect(summary).toContain('PAGES');
    expect(summary).toContain('ENTITIES');
  });
});

describe('hasUsefulSpec', () => {
  it('returns false when total < 2', () => {
    expect(hasUsefulSpec({ appType: '', modules: ['one'], pages: [], entities: [] })).toBe(false);
  });

  it('returns true when total >= 2', () => {
    expect(hasUsefulSpec({ appType: '', modules: ['M1'], pages: ['P1'], entities: [] })).toBe(true);
  });
});
