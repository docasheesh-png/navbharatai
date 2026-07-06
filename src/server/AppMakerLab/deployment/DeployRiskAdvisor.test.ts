import { describe, it, expect } from 'vitest';
import { assessDeployRisk, analyzeIncident, type DeployChangeSignals, type IncidentEvent } from './DeployRiskAdvisor';

const sig = (p: Partial<DeployChangeSignals> = {}): DeployChangeSignals => ({
  filesChanged: 1, linesAdded: 10, linesRemoved: 2, criticalFilesTouched: 0, testFilesChanged: 0, ...p,
});

describe('assessDeployRisk', () => {
  it('rates a tiny change with tests as low risk', () => {
    const r = assessDeployRisk(sig({ filesChanged: 2, linesAdded: 20, testFilesChanged: 1 }));
    expect(r.band).toBe('low');
    expect(r.score).toBeLessThan(30);
  });

  it('raises risk for a large change', () => {
    const r = assessDeployRisk(sig({ filesChanged: 50, linesAdded: 2000, linesRemoved: 100 }));
    expect(r.band).toBe('high');
    expect(r.reasons.join(' ')).toMatch(/Large change/);
  });

  it('raises risk when high-criticality files are touched', () => {
    const r = assessDeployRisk(sig({ filesChanged: 3, criticalFilesTouched: 2 }));
    expect(r.score).toBeGreaterThanOrEqual(24);
    expect(r.advice.join(' ')).toMatch(/critical path/);
  });

  it('penalizes a sizeable change with no tests', () => {
    const withTests = assessDeployRisk(sig({ filesChanged: 20, linesAdded: 300, testFilesChanged: 2 }));
    const noTests = assessDeployRisk(sig({ filesChanged: 20, linesAdded: 300, testFilesChanged: 0 }));
    expect(noTests.score).toBeGreaterThan(withTests.score);
    expect(noTests.reasons.join(' ')).toMatch(/No tests/);
  });

  it('forces high risk when CI is red', () => {
    const r = assessDeployRisk(sig({ filesChanged: 1, ciGreen: false }));
    expect(r.band).toBe('high');
    expect(r.advice.join(' ')).toMatch(/Do NOT deploy/);
  });

  it('caps the score at 100 and floors at 0', () => {
    expect(assessDeployRisk(sig({ filesChanged: 100, linesAdded: 9000, criticalFilesTouched: 10, ciGreen: false })).score).toBeLessThanOrEqual(100);
    expect(assessDeployRisk(sig({ filesChanged: 0, linesAdded: 0, linesRemoved: 0 })).score).toBeGreaterThanOrEqual(0);
  });
});

describe('analyzeIncident', () => {
  const t = (min: number) => min * 60_000;

  it('correlates an error burst right after a deploy and advises rollback to the previous ref', () => {
    const events: IncidentEvent[] = [
      { kind: 'deploy', at: t(0), ref: 'abc111' },
      { kind: 'deploy', at: t(60), ref: 'def222' },
      { kind: 'error', at: t(61), message: 'boom' },
      { kind: 'error', at: t(62), message: 'boom' },
    ];
    const r = analyzeIncident(events);
    expect(r.correlated).toBe(true);
    expect(r.rollbackTo).toBe('abc111');
    expect(r.errorsAfterDeploy).toBe(2);
    expect(r.likelyCause).toContain('def222');
  });

  it('does not correlate errors that are not near a deploy', () => {
    const events: IncidentEvent[] = [
      { kind: 'deploy', at: t(0), ref: 'abc111' },
      { kind: 'error', at: t(120), message: 'later, unrelated' },
    ];
    const r = analyzeIncident(events);
    expect(r.correlated).toBe(false);
    expect(r.rollbackTo).toBeNull();
  });

  it('handles a first-ever deploy with no rollback target', () => {
    const events: IncidentEvent[] = [
      { kind: 'deploy', at: t(0), ref: 'first' },
      { kind: 'error', at: t(1) },
    ];
    const r = analyzeIncident(events);
    expect(r.correlated).toBe(true);
    expect(r.rollbackTo).toBeNull();
    expect(r.advice).toMatch(/hotfix|forward/i);
  });

  it('is honest when there are no deploys', () => {
    expect(analyzeIncident([{ kind: 'error', at: 1 }]).likelyCause).toMatch(/No deploy/);
  });
});
