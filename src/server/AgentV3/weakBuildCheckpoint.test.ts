import { describe, it, expect } from 'vitest';
import {
  weakCheckpointConfig,
  shouldRunWeakCheckpoint,
  midBuildActionableBlockers,
  weakCheckpointSteer,
  ACTIONABLE_BLOCKER_PATTERNS,
  MID_BUILD_FALSE_ALARM_PATTERNS,
} from './weakBuildCheckpoint';
import { assessReadiness } from './Readiness';
import type { ArchitectureReport } from './ArchitectureAnalysis';
import type { SecurityFinding } from './SecurityAnalysis';
import type { ReadinessReport } from './Readiness';

const emptyArch: ArchitectureReport = {
  fileCount: 3,
  edgeCount: 2,
  cycles: [],
  unresolvedImports: [],
  layeringViolations: [],
  nodeBuiltinsInFrontend: [],
  orphanComponents: [],
};

const rr = (over: Partial<ReadinessReport>): ReadinessReport => ({
  score: 100,
  ready: true,
  blockers: [],
  warnings: [],
  ...over,
});

describe('weakCheckpointConfig', () => {
  it('is OFF by default and reads sane cadence defaults', () => {
    const cfg = weakCheckpointConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.everyN).toBe(20);
    expect(cfg.minStep).toBe(15);
    expect(cfg.maxNudges).toBe(2);
  });

  it('turns on with AGENTV3_WEAK_CHECKPOINT=on and honours overrides', () => {
    const cfg = weakCheckpointConfig({
      AGENTV3_WEAK_CHECKPOINT: 'on',
      AGENTV3_WEAK_CHECKPOINT_EVERY: '10',
      AGENTV3_WEAK_CHECKPOINT_MIN_STEP: '8',
      AGENTV3_WEAK_CHECKPOINT_MAX_NUDGES: '3',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ enabled: true, everyN: 10, minStep: 8, maxNudges: 3 });
  });

  it('ignores garbage / out-of-range overrides and keeps defaults', () => {
    const cfg = weakCheckpointConfig({
      AGENTV3_WEAK_CHECKPOINT: 'on',
      AGENTV3_WEAK_CHECKPOINT_EVERY: '0',
      AGENTV3_WEAK_CHECKPOINT_MIN_STEP: 'abc',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.everyN).toBe(20);
    expect(cfg.minStep).toBe(15);
  });
});

describe('shouldRunWeakCheckpoint', () => {
  const cfg = { enabled: true, everyN: 20, minStep: 15, maxNudges: 2 };

  it('runs on the cadence for a weak build that has built something and is warmed up', () => {
    expect(shouldRunWeakCheckpoint({ isWeakBuild: true, cfg, step: 20, toolUses: 5, nudgesUsed: 0 })).toBe(true);
    expect(shouldRunWeakCheckpoint({ isWeakBuild: true, cfg, step: 40, toolUses: 9, nudgesUsed: 1 })).toBe(true);
  });

  it('never runs for a non-weak build or when disabled', () => {
    expect(shouldRunWeakCheckpoint({ isWeakBuild: false, cfg, step: 20, toolUses: 5, nudgesUsed: 0 })).toBe(false);
    const off = { ...cfg, enabled: false };
    expect(shouldRunWeakCheckpoint({ isWeakBuild: true, cfg: off, step: 20, toolUses: 5, nudgesUsed: 0 })).toBe(false);
  });

  it('does not run before warm-up, off-cadence, with no files, or once nudges are spent', () => {
    expect(shouldRunWeakCheckpoint({ isWeakBuild: true, cfg, step: 10, toolUses: 5, nudgesUsed: 0 })).toBe(false); // warm-up
    expect(shouldRunWeakCheckpoint({ isWeakBuild: true, cfg, step: 21, toolUses: 5, nudgesUsed: 0 })).toBe(false); // off-cadence
    expect(shouldRunWeakCheckpoint({ isWeakBuild: true, cfg, step: 20, toolUses: 0, nudgesUsed: 0 })).toBe(false); // nothing built
    expect(shouldRunWeakCheckpoint({ isWeakBuild: true, cfg, step: 20, toolUses: 5, nudgesUsed: 2 })).toBe(false); // spent
  });
});

describe('mid-build blocker classification (no false alarms)', () => {
  it('steers on a server-only Node builtin in the browser', () => {
    const r = rr({ ready: false, blockers: ['1 server-only Node builtin import(s) in front-end code — these break the browser build: fs'] });
    expect(midBuildActionableBlockers(r)).toHaveLength(1);
    expect(weakCheckpointSteer(r)).toContain('server-only Node builtin');
  });

  it('steers on a high-severity security finding', () => {
    const r = rr({ ready: false, blockers: ['1 high-severity security issue(s): hardcoded-secret @ a.ts:1 — leaked key'] });
    expect(midBuildActionableBlockers(r)).toHaveLength(1);
    expect(weakCheckpointSteer(r)).toContain('build-breaker');
  });

  it('IGNORES an unresolved import (normal mid-build — the file is simply not written yet)', () => {
    const r = rr({ ready: false, blockers: ['3 unresolved import(s) — the build will fail'] });
    expect(midBuildActionableBlockers(r)).toEqual([]);
    expect(weakCheckpointSteer(r)).toBeNull();
  });

  it('IGNORES a low readiness score (a partial app scores low by construction)', () => {
    const r = rr({ ready: false, score: 20, blockers: ['readiness score 20/100 is below the 50/100 bar (too many unresolved quality issues)'] });
    expect(midBuildActionableBlockers(r)).toEqual([]);
    expect(weakCheckpointSteer(r)).toBeNull();
  });

  it('returns null when ready / no blockers', () => {
    expect(weakCheckpointSteer(rr({}))).toBeNull();
  });
});

// CONTRACT TEST — run the REAL assessReadiness producer and assert its emitted blocker strings still
// match the classifier patterns. If Readiness.ts ever reworded these, this fails loudly instead of the
// filter silently going dark. This is the rule-4 regression lock for Slice 2.
describe('Readiness.ts blocker-string contract', () => {
  it('node-builtin blocker matches an ACTIONABLE pattern and no false-alarm pattern', () => {
    const r = assessReadiness({ ...emptyArch, nodeBuiltinsInFrontend: ['src/App.tsx -> fs'] }, []);
    const blocker = r.blockers.find((b) => /Node builtin/i.test(b));
    expect(blocker, 'Readiness.ts must still emit a node-builtin blocker').toBeTruthy();
    expect(ACTIONABLE_BLOCKER_PATTERNS.some((re) => re.test(blocker!))).toBe(true);
    expect(MID_BUILD_FALSE_ALARM_PATTERNS.some((re) => re.test(blocker!))).toBe(false);
  });

  it('high-severity security blocker matches an ACTIONABLE pattern', () => {
    const finding: SecurityFinding = { file: 'a.ts', line: 1, severity: 'high', rule: 'hardcoded-secret', message: 'leaked key' };
    const r = assessReadiness(emptyArch, [finding]);
    const blocker = r.blockers.find((b) => /security/i.test(b));
    expect(blocker, 'Readiness.ts must still emit a high-severity security blocker').toBeTruthy();
    expect(ACTIONABLE_BLOCKER_PATTERNS.some((re) => re.test(blocker!))).toBe(true);
  });

  it('unresolved-import blocker matches a FALSE-ALARM pattern (must be ignored mid-build)', () => {
    const r = assessReadiness({ ...emptyArch, unresolvedImports: ['src/App.tsx -> ./NotYetWritten'] }, []);
    const blocker = r.blockers.find((b) => /unresolved import/i.test(b));
    expect(blocker, 'Readiness.ts must still emit an unresolved-import blocker').toBeTruthy();
    expect(MID_BUILD_FALSE_ALARM_PATTERNS.some((re) => re.test(blocker!))).toBe(true);
    expect(ACTIONABLE_BLOCKER_PATTERNS.some((re) => re.test(blocker!))).toBe(false);
    // And end-to-end: the classifier drops it.
    expect(midBuildActionableBlockers(r)).toEqual([]);
  });
});
