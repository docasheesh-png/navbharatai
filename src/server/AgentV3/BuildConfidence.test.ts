import { describe, it, expect } from 'vitest';
import { computeBuildConfidence, buildConfidenceSummary, type BuildConfidenceInput } from './BuildConfidence';

const clean: BuildConfidenceInput = {
  readinessScore: 100,
  ready: true,
  architecture: { unresolvedImports: 0, cycles: 0, layering: 0 },
  security: { high: 0, medium: 0, low: 0 },
  authenticity: 0,
  dependencies: { missing: 0, unused: 0 },
  envVarsMissing: 0,
  accessibility: { high: 0, medium: 0, low: 0 },
  compliance: { high: 0, medium: 0, low: 0 },
};

describe('computeBuildConfidence', () => {
  it('is 100% High when every gate is clean', () => {
    const c = computeBuildConfidence(clean);
    expect(c.score).toBe(100);
    expect(c.band).toBe('high');
    expect(c.negatives).toHaveLength(0);
    expect(c.positives.length).toBeGreaterThan(0);
  });

  it('caps confidence at 35 when there is a build-breaker (unresolved import)', () => {
    const c = computeBuildConfidence({ ...clean, ready: false, architecture: { unresolvedImports: 1, cycles: 0, layering: 0 } });
    expect(c.score).toBeLessThanOrEqual(35);
    expect(c.band).toBe('low');
    expect(c.negatives[0]).toMatch(/unresolved import/i);
  });

  it('caps confidence at 35 for a missing dependency (build will not install)', () => {
    const c = computeBuildConfidence({ ...clean, dependencies: { missing: 1, unused: 0 } });
    expect(c.score).toBeLessThanOrEqual(35);
  });

  it('caps confidence at 60 when a high-severity security issue exists (no build-breaker)', () => {
    const c = computeBuildConfidence({ ...clean, security: { high: 1, medium: 0, low: 0 } });
    expect(c.score).toBeLessThanOrEqual(60);
    expect(c.negatives.some((n) => /security/i.test(n))).toBe(true);
  });

  it('caps at 60 when a high-severity compliance blocker exists (e.g. missing privacy policy)', () => {
    const c = computeBuildConfidence({ ...clean, compliance: { high: 1, medium: 0, low: 0 } });
    expect(c.score).toBeLessThanOrEqual(60);
    expect(c.negatives.some((n) => /privacy\/compliance/i.test(n))).toBe(true);
  });

  it('lands in Medium for several issues with no hard blockers', () => {
    const c = computeBuildConfidence({
      ...clean,
      accessibility: { high: 0, medium: 2, low: 1 }, // -7
      authenticity: 3, // -30
    });
    expect(c.band).toBe('medium');
    expect(c.score).toBeGreaterThanOrEqual(55);
    expect(c.score).toBeLessThan(80);
  });

  it('orders negatives by impact (highest-weight first)', () => {
    const c = computeBuildConfidence({
      ...clean,
      ready: false,
      architecture: { unresolvedImports: 1, cycles: 1, layering: 0 },
      accessibility: { high: 0, medium: 0, low: 1 },
    });
    // The build-breaker (weight 20) must be listed before the import cycle (weight 3).
    expect(c.negatives[0]).toMatch(/unresolved import/i);
  });

  it('is deterministic (same input → same score)', () => {
    const input = { ...clean, security: { high: 0, medium: 3, low: 2 } };
    expect(computeBuildConfidence(input).score).toBe(computeBuildConfidence(input).score);
  });
});

describe('buildConfidenceSummary', () => {
  it('renders a calibrated headline with the percentage, band, and "here\'s why"', () => {
    const s = buildConfidenceSummary(computeBuildConfidence(clean));
    expect(s).toMatch(/Build confidence: 100% \(High\)/);
    expect(s).toContain("Here's why:");
    expect(s).toContain('Every check is clean.');
  });

  it('lists the concrete reasons confidence was lowered', () => {
    const s = buildConfidenceSummary(computeBuildConfidence({ ...clean, ready: false, architecture: { unresolvedImports: 2, cycles: 0, layering: 0 } }));
    expect(s).toMatch(/\(Low\)/);
    expect(s).toMatch(/2 unresolved import\(s\)/);
    expect(s).toContain('lowered confidence');
  });
});
