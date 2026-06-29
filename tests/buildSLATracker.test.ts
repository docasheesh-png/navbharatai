import { describe, it, expect } from 'vitest';
import {
  classifyComplexity, evaluateSlo, summarizeSlo, SLO_TARGETS_MS,
} from '../src/server/AppMakerLab/intelligence/BuildSLATracker';
import { JobStatus, type BuildJob } from '../src/server/AppMakerLab/jobs/BuildJobManager';

/**
 * P-PME.11 — build-time SLO tracker.
 */
function job(over: Partial<BuildJob>): BuildJob {
  return {
    id: 'j', prompt: 'a simple landing page', status: JobStatus.PREVIEW_READY, progress: 100, logs: [],
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:10Z'),
    ...over,
  } as BuildJob;
}
function withDuration(secs: number, over: Partial<BuildJob> = {}): BuildJob {
  const start = new Date('2026-01-01T00:00:00Z');
  return job({ createdAt: start, updatedAt: new Date(start.getTime() + secs * 1000), ...over });
}

describe('BuildSLATracker — classifyComplexity', () => {
  it('treats short, simple prompts as simple', () => {
    expect(classifyComplexity('a todo list')).toBe('simple');
    expect(classifyComplexity('landing page for a cafe')).toBe('simple');
  });
  it('treats feature-signal prompts as complex', () => {
    expect(classifyComplexity('app with login and a dashboard')).toBe('complex');
    expect(classifyComplexity('e-commerce checkout with stripe payment')).toBe('complex');
    expect(classifyComplexity('realtime chat')).toBe('complex');
  });
  it('treats very long prompts as complex', () => {
    expect(classifyComplexity('build '.repeat(60))).toBe('complex');
  });
  it('handles empty prompt', () => {
    expect(classifyComplexity(undefined)).toBe('simple');
  });
});

describe('BuildSLATracker — evaluateSlo', () => {
  it('passes a fast simple build', () => {
    const ev = evaluateSlo(withDuration(30, { prompt: 'simple page' }));
    expect(ev.complexity).toBe('simple');
    expect(ev.sloMs).toBe(SLO_TARGETS_MS.simple);
    expect(ev.withinSlo).toBe(true);
    expect(ev.overByMs).toBe(0);
  });
  it('flags a slow simple build (over 60s)', () => {
    const ev = evaluateSlo(withDuration(90, { prompt: 'simple page' }));
    expect(ev.withinSlo).toBe(false);
    expect(ev.overByMs).toBe(30_000);
  });
  it('uses the lenient SLO for a complex build', () => {
    const ev = evaluateSlo(withDuration(200, { prompt: 'dashboard with auth and database' }));
    expect(ev.complexity).toBe('complex');
    expect(ev.withinSlo).toBe(true); // 200s < 300s SLO
  });
});

describe('BuildSLATracker — summarizeSlo', () => {
  it('returns honest zeros for no jobs', () => {
    const s = summarizeSlo([]);
    expect(s.totalBuilds).toBe(0);
    expect(s.overallViolationRate).toBe(0);
    expect(s.byTier).toHaveLength(2);
  });

  it('computes per-tier violation rate + p95, ignoring non-terminal jobs', () => {
    const jobs = [
      withDuration(30, { prompt: 'simple page', status: JobStatus.PREVIEW_READY }),  // simple, ok
      withDuration(90, { prompt: 'simple page', status: JobStatus.PREVIEW_READY }),  // simple, violation
      withDuration(400, { prompt: 'dashboard with auth', status: JobStatus.FAILED }),// complex, violation
      withDuration(10, { prompt: 'simple page', status: JobStatus.BUILDING }),       // non-terminal → ignored
    ];
    const s = summarizeSlo(jobs);
    expect(s.totalBuilds).toBe(3);
    expect(s.totalViolations).toBe(2);
    const simple = s.byTier.find((t) => t.tier === 'simple')!;
    const complex = s.byTier.find((t) => t.tier === 'complex')!;
    expect(simple.builds).toBe(2);
    expect(simple.violations).toBe(1);
    expect(simple.violationRate).toBeCloseTo(0.5, 5);
    expect(complex.builds).toBe(1);
    expect(complex.violations).toBe(1);
    expect(complex.p95Ms).toBe(400_000);
  });
});
