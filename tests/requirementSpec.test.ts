import { describe, it, expect, vi } from 'vitest';
import { extractRequirementSpec, specSummary, hasUsefulSpec } from '../src/server/project/RequirementSpec';

describe('extractRequirementSpec', () => {
  it('parses a structured spec from the model (incl. fenced JSON)', async () => {
    const callModel = vi.fn(async () => '```json\n{"appType":"ops","modules":["Inventory","Incidents"],"pages":["Dashboard","Settings"],"entities":["Item","Incident"]}\n```');
    const spec = await extractRequirementSpec(callModel, 'a healthcare ops app');
    expect(spec.appType).toBe('ops');
    expect(spec.modules).toEqual(['Inventory', 'Incidents']);
    expect(spec.pages).toContain('Dashboard');
    expect(spec.entities).toContain('Item');
    expect(hasUsefulSpec(spec)).toBe(true);
  });

  it('returns an empty spec on junk / failure (safe fallback)', async () => {
    expect(hasUsefulSpec(await extractRequirementSpec(async () => 'no json', 'x'))).toBe(false);
    expect(hasUsefulSpec(await extractRequirementSpec(async () => { throw new Error('boom'); }, 'x'))).toBe(false);
  });

  it('specSummary lists modules, pages, entities for the planner', () => {
    const s = specSummary({ appType: 'ops', modules: ['Inventory'], pages: ['Dashboard'], entities: ['Item'] });
    expect(s).toMatch(/MODULES/);
    expect(s).toMatch(/Inventory/);
    expect(s).toMatch(/Dashboard/);
    expect(s).toMatch(/Item/);
  });
});
