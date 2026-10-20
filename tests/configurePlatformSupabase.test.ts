import { describe, it, expect } from 'vitest';
import { prepareConfiguration } from '../scripts/configurePlatformSupabase.mjs';
const names = ['--gcp-project=fixture-project', '--service=fixture-service', '--run-region=asia-south1', '--token-secret=fixture-secret', '--secret-version=4', '--max-projects=2'];
describe('production configuration handoff', () => {
  it('prepares the selected org and pinned secret without applying by default', () => {
    const plan = prepareConfiguration(names);
    expect(plan.apply).toBe(false);
    expect(plan.organizationId).toBe('hkfoligpzrmcasgtzeoe');
    expect(plan.estimatedBaselineUsdPerMonth).toBe(35);
    expect(plan.command).toContain('NAVBHARAT_SUPABASE_TOKEN=fixture-secret:4');
  });
  it('rejects application without the specific organization and baseline acknowledgement', () => {
    expect(() => prepareConfiguration([...names, '--apply'])).toThrow('approval');
    expect(() => prepareConfiguration([...names, '--apply', '--confirm-pro-org=other', '--approve-baseline-usd=35'])).toThrow();
    expect(prepareConfiguration([...names, '--apply', '--confirm-pro-org=hkfoligpzrmcasgtzeoe', '--approve-baseline-usd=35']).apply).toBe(true);
  });
  it('will not reuse a stale quote when project capacity is raised', () => {
    expect(() => prepareConfiguration([...names, '--max-projects=11', '--apply', '--confirm-pro-org=hkfoligpzrmcasgtzeoe', '--approve-baseline-usd=35'])).toThrow('$125');
  });
  it('requires actual runtime identifiers and a pinned secret version', () => {
    expect(() => prepareConfiguration([])).toThrow('gcp-project');
    expect(() => prepareConfiguration([...names, '--secret-version=latest'])).toThrow('numeric');
    expect(() => prepareConfiguration([...names, '--service=bad;command'])).toThrow('names only');
  });
});
