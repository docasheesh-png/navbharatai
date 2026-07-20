import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps, renderRequirementGaps, shouldSurfaceRequirementGaps } from './RequirementGapAnalyzer';

describe('analyzeRequirementGaps', () => {
  it('detects healthcare and flags likely-missing RBAC/audit/EMR for a bare prompt', () => {
    const g = analyzeRequirementGaps('Build a hospital management system');
    expect(g.domain).toBe('healthcare');
    expect(g.likelyMissing).toContain('role-based access (staff / doctor / admin)');
    expect(g.likelyMissing).toContain('audit log of record changes');
    expect(g.clarifyingQuestions.length).toBeGreaterThan(0);
    expect(g.clarifyingQuestions.length).toBeLessThanOrEqual(6); // never over-ask (the admin's rule)
  });

  it('marks a feature MENTIONED when the prompt already covers it', () => {
    const g = analyzeRequirementGaps('A hospital system with staff roles and an audit log of every change');
    expect(g.mentioned).toContain('role-based access (staff / doctor / admin)');
    expect(g.mentioned).toContain('audit log of record changes');
    expect(g.likelyMissing).not.toContain('role-based access (staff / doctor / admin)');
  });

  it('detects non-functional signals (scale, offline, security, i18n)', () => {
    const g = analyzeRequirementGaps('An offline-capable app for 100000 concurrent users with login, in Hindi');
    expect(g.nonFunctional.scale).toBe(true);
    expect(g.nonFunctional.offline).toBe(true);
    expect(g.nonFunctional.security).toBe(true);
    expect(g.nonFunctional.i18n).toBe(true);
  });

  it('falls back to general + generic features for an unknown prompt, and never throws', () => {
    const g = analyzeRequirementGaps('make me a thing');
    expect(g.domain).toBe('general');
    // @ts-expect-error — malformed input must not throw
    expect(() => analyzeRequirementGaps(null)).not.toThrow();
  });

  it('renders a readable block', () => {
    const out = renderRequirementGaps(analyzeRequirementGaps('Build an online store'));
    expect(out).toContain('Likely domain: ecommerce');
    expect(out).toMatch(/Questions to confirm|covers the usual/);
  });

  it('shouldSurfaceRequirementGaps is true for a real domain with gaps, false for a generic prompt', () => {
    // A bare healthcare prompt leaves most features implicit → worth surfacing in the build report.
    expect(shouldSurfaceRequirementGaps(analyzeRequirementGaps('build a hospital system'))).toBe(true);
    // No domain detected → general → nothing domain-specific to surface (keeps the report high-signal).
    expect(shouldSurfaceRequirementGaps(analyzeRequirementGaps('make me a thing'))).toBe(false);
  });
});
