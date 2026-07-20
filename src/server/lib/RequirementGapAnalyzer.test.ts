import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps, renderRequirementGaps, shouldSurfaceRequirementGaps, buildRequirementGuidance } from './RequirementGapAnalyzer';

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

  it('detects the appended verticals (education / logistics / restaurant)', () => {
    expect(analyzeRequirementGaps('build an LMS for a coaching institute').domain).toBe('education');
    expect(analyzeRequirementGaps('a courier delivery tracking app with driver assignment').domain).toBe('logistics');
    expect(analyzeRequirementGaps('a restaurant POS with menu and KOT').domain).toBe('restaurant');
    // and they surface real gaps for the builder
    expect(buildRequirementGuidance(analyzeRequirementGaps('build a school management system'))).toContain('education');
    expect(analyzeRequirementGaps('a school management system').likelyMissing).toContain('assignments & grading');
  });

  it('appended domains never change an existing classification (first match wins)', () => {
    // These matched a prior domain BEFORE the append and must still match the same one.
    expect(analyzeRequirementGaps('Build a hospital management system').domain).toBe('healthcare');
    expect(analyzeRequirementGaps('an online store with a cart and checkout').domain).toBe('ecommerce');
    expect(analyzeRequirementGaps('a booking app for salon slots').domain).toBe('booking');
  });

  it('buildRequirementGuidance produces INCLUDE guidance for a domain gap, empty for a generic prompt', () => {
    const g = buildRequirementGuidance(analyzeRequirementGaps('build a hospital system'));
    expect(g).toContain('REQUIREMENT AWARENESS');
    expect(g).toContain('healthcare');
    expect(g).toContain('INCLUDE them by default');
    expect(g).toContain('role-based access (staff / doctor / admin)');
    // friction-free: it instructs to build, never to ask
    expect(g).toContain('skip it silently rather than asking');
    // caps at 6 features so the guidance never bloats the prompt
    expect((g.match(/^- /gm) || []).length).toBeLessThanOrEqual(6);
    // a generic prompt gets NO guidance (build path stays exactly as today)
    expect(buildRequirementGuidance(analyzeRequirementGaps('make me a thing'))).toBe('');
  });
});
