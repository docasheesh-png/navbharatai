import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fastLaneRungDecision, fastLaneReasoningGateEnabled } from '../src/server/AgentV3/fastLaneRung';
import { tierLadder } from '../src/server/AgentV3/tierLadder';

/**
 * Autopsy ac41a924 (2026-09-23): a complex-routed Weak build opened on `kimi-k2.7-code`, which always
 * reasons. The fast lane's one plan call (90 s cap) spent its whole cap thinking, the lane handed over
 * with nothing, and the full builder then built the app on the same model — 90 s for no file.
 */

const weak = tierLadder('weak').rungs;

describe('the gate, on the real ladders', () => {
  it('a COMPLEX weak build opens on an always-reasoning rung, so the lane is skipped', () => {
    const d = fastLaneRungDecision(weak, { complex: true });
    expect(d.rung?.model).toBe('kimi-k2.7-code');
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/always reasons/);
  });

  it('a SIMPLE weak build opens on the flash rung, which can answer directly, so the lane runs', () => {
    const d = fastLaneRungDecision(weak, { complex: false });
    expect(d.rung?.model).toBe('glm-4.7-flashx');
    expect(d.skip).toBe(false);
  });

  it('a keyless opener is skipped the way the chain skips it, and the next keyed rung decides', () => {
    const d = fastLaneRungDecision(weak, { complex: false, isKeyed: (r) => r.provider !== 'GLM' });
    expect(d.rung?.provider).toBe('KIMI');
    expect(d.skip).toBe(true);
  });

  it('no keyed rung at all: nothing to decide, the lane is not blocked here', () => {
    expect(fastLaneRungDecision(weak, { complex: true, isKeyed: () => false })).toEqual({ rung: null, skip: false, reason: '' });
  });

  it('the kill switch restores the old behaviour', () => {
    expect(fastLaneRungDecision(weak, { complex: true, enabled: false }).skip).toBe(false);
    expect(fastLaneReasoningGateEnabled({ AGENTV3_FASTLANE_REASONING_GATE: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(fastLaneReasoningGateEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(fastLaneReasoningGateEnabled({ AGENTV3_FASTLANE_REASONING_GATE: 'maybe' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('the route asks the gate before starting the lane', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('the lane condition includes the gate, and the skip is recorded', () => {
    expect(route).toContain('if (fastLaneWouldRun && !fastLaneRung.skip) {');
    expect(route).toContain("code: 'FAST_LANE_SKIPPED_REASONING_RUNG'");
    expect(route).toMatch(/fastLaneRungDecision\(tierLadder\(powerLevelReqEffective\)\.rungs, \{\s*complex: buildIsComplex/);
  });

  it('the skip is an engine fact, never a finding against the app', () => {
    const diag = readFileSync(join(__dirname, '..', 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    const block = diag.slice(diag.indexOf('const PROCESS_ONLY_CODES'), diag.indexOf(']);', diag.indexOf('const PROCESS_ONLY_CODES')));
    expect(block).toContain("'FAST_LANE_SKIPPED_REASONING_RUNG'");
  });
});

describe('a step deadline is not called the build\'s budget', () => {
  it('the runner no longer tells the report that the BUILD\'s time budget ended', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/providers/MultiProviderTurnRunner.ts'), 'utf8');
    expect(src).not.toContain("This build's time budget ended before the step could finish");
    expect(src).toContain('The time allowed for this step ran out before it could finish');
  });
});
