import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  emptyWriteTypecheckStats,
  writeTypecheckSummary,
  shouldProbeTsconfig,
  tsProjectSettled,
  isMissingFileError,
  shouldTypecheckWrite,
  MAX_TSCONFIG_PROBES,
} from '../src/server/AgentV3/writeTimeTypecheck';
import {
  contractCallCanFinish,
  canAffordSharedContract,
  preambleCapMs,
  BUILD_PHASE_RESERVE,
} from '../src/server/AgentV3/FastLaneBudget';

/**
 * AUTOPSY bb688add (2026-09-20) — the Hindi wedding invitation, 16.4 minutes, ₹177.98 on the FREE tier.
 *
 * ONE CLASS, TWICE: a thing we could not measure, recorded as a measurement of zero.
 *
 *  • The `tsconfig.json` probe could not be read, and that was written down as "this is not a
 *    TypeScript project" — permanently. The check built to catch this exact build's eleven TS2339
 *    errors AT WRITE TIME stood down, and the report said "no TypeScript source was written this
 *    build" about a build that wrote six TypeScript files.
 *  • The shared-contract call was handed 47,800ms after its own measured predecessor had just cost
 *    48,198ms. `Math.min(cap, measured)` modelled that as *cheaper* rather than as *free of value and
 *    full of cost*, so the call was started, cut off, and paid for (₹1.17, `UNBILLED_BARREN_WORK`) —
 *    and the files were then generated with no contract and disagreed.
 */

describe('the tsconfig probe — a read that threw is not a verdict', () => {
  it('retries while the answer is unknown, and stops after the bounded attempts', () => {
    expect(shouldProbeTsconfig('unknown', 0)).toBe(true);
    expect(shouldProbeTsconfig('unknown', MAX_TSCONFIG_PROBES - 1)).toBe(true);
    expect(shouldProbeTsconfig('unknown', MAX_TSCONFIG_PROBES)).toBe(false);
  });

  it('never re-probes once the answer is real — a JS project is asked once, not on every write', () => {
    expect(shouldProbeTsconfig('no', 0)).toBe(false);
    expect(shouldProbeTsconfig('yes', 0)).toBe(false);
  });

  it('an unknown is only SETTLED as "not TypeScript" after the attempts are spent', () => {
    expect(tsProjectSettled('unknown', 1)).toBe(false);
    expect(tsProjectSettled('unknown', MAX_TSCONFIG_PROBES)).toBe(true);
    expect(tsProjectSettled('no', 0)).toBe(true);
  });

  it('🔴 only an unmistakable not-found is an absence — every other failure stays unknown', () => {
    expect(isMissingFileError(new Error('ENOENT: no such file or directory, open tsconfig.json'))).toBe(true);
    expect(isMissingFileError(new Error('[not_found] stat tsconfig.json'))).toBe(true);
    // The asymmetry: a false "absent" disables the compiler for the build; a false "unknown" costs
    // two extra file reads.
    expect(isMissingFileError(new Error('files.read timed out after 30000ms'))).toBe(false);
    expect(isMissingFileError(new Error('sandbox is paused'))).toBe(false);
    expect(isMissingFileError(new Error(''))).toBe(false);
    expect(isMissingFileError(undefined)).toBe(false);
  });

  it('a DEAD SANDBOX saying "no such file" about the workspace is not a missing tsconfig', () => {
    expect(isMissingFileError(new Error('[not_found] lstat /home/user/workspace: no such file or directory'))).toBe(false);
  });
});

describe('the report must not claim "no TypeScript was written" when TypeScript was written', () => {
  it('🔴 the bb688add sentence is gone — a project skip says so, and says why', () => {
    const s = emptyWriteTypecheckStats();
    s.skipped = 22; s.skippedNotTs = 16; s.skippedNoTsconfig = 6; s.probeFailures = 3;
    const line = writeTypecheckSummary(s, true);
    expect(line).not.toContain('no TypeScript source was written');
    expect(line).toContain('6 TypeScript write(s) happened');
    expect(line).toContain('could not be read');
  });

  it('a genuinely absent tsconfig is reported as absent, not as a failed read', () => {
    const s = emptyWriteTypecheckStats();
    s.skipped = 4; s.skippedNoTsconfig = 4; s.probeFailures = 0;
    expect(writeTypecheckSummary(s, true)).toContain('no tsconfig.json was found');
  });

  it('a build of only CSS and HTML still reads exactly as it did before', () => {
    const s = emptyWriteTypecheckStats();
    s.skipped = 9; s.skippedNotTs = 9;
    expect(writeTypecheckSummary(s, true)).toContain('no TypeScript source was written this build (9 write(s) skipped as not TypeScript)');
  });

  it('the files that build actually wrote ARE TypeScript — the premise, not an assumption', () => {
    for (const p of ['src/types/invitation.ts', 'src/data/invitation.ts', 'src/hooks/useInvitation.ts', 'src/components/Invitation.tsx', 'src/App.tsx', 'src/main.tsx']) {
      expect(shouldTypecheckWrite(p)).toBe(true);
    }
    expect(shouldTypecheckWrite('src/vite-env.d.ts')).toBe(false); // types, not code
    expect(shouldTypecheckWrite('src/index.css')).toBe(false);
  });

  it('a check that RAN reports its runs, untouched by any of this', () => {
    const s = emptyWriteTypecheckStats();
    s.runs = 4; s.cleanRuns = 3; s.ownErrorsSurfaced = 2; s.elapsedMs = 4000;
    expect(writeTypecheckSummary(s, true)).toContain('4 run(s), 3 clean, 2 error(s)');
  });
});

describe('a call the clock cannot carry is not started', () => {
  // The build's own numbers, to the millisecond.
  const PLAN_CALL_MS = 48_198;
  const LANE_MS = 240_000;

  it('🔴 reproduces bb688add: the cap is derived to the millisecond, and it is too small', () => {
    const cap = preambleCapMs(LANE_MS, PLAN_CALL_MS, 90_000);
    expect(cap).toBe(Math.round(LANE_MS * (1 - BUILD_PHASE_RESERVE)) - PLAN_CALL_MS);
    expect(cap).toBeLessThan(PLAN_CALL_MS);            // 47,802 < 48,198
    expect(contractCallCanFinish({ contractCapMs: cap, preambleCallMs: PLAN_CALL_MS })).toBe(false);
  });

  it('and canAffordSharedContract now refuses it, where it used to say yes', () => {
    const cap = preambleCapMs(LANE_MS, PLAN_CALL_MS, 90_000);
    // 2 tiers at the plan's latency fit comfortably in what is left — which is exactly why the old
    // tier-projection rule said "affordable" and the pass ran anyway.
    expect(canAffordSharedContract({
      preambleCallMs: PLAN_CALL_MS, tiers: 2, elapsedMs: PLAN_CALL_MS, overallMs: LANE_MS, contractCapMs: cap,
    })).toBe(false);
  });

  it('a fast planner still gets its contract — this can only ever SKIP, never start one more', () => {
    const cap = preambleCapMs(LANE_MS, 20_000, 90_000);
    expect(contractCallCanFinish({ contractCapMs: cap, preambleCallMs: 20_000 })).toBe(true);
    expect(canAffordSharedContract({
      preambleCallMs: 20_000, tiers: 2, elapsedMs: 20_000, overallMs: LANE_MS, contractCapMs: cap,
    })).toBe(true);
  });

  it('no measurement ⇒ it runs — never bail on an absent signal', () => {
    expect(contractCallCanFinish({ contractCapMs: 10_000, preambleCallMs: 0 })).toBe(true);
    expect(contractCallCanFinish({ contractCapMs: 10_000, preambleCallMs: -1 })).toBe(true);
  });

  it('an exactly-equal cap is allowed — the threshold is the measurement, with no invented margin', () => {
    expect(contractCallCanFinish({ contractCapMs: 48_198, preambleCallMs: 48_198 })).toBe(true);
    expect(contractCallCanFinish({ contractCapMs: 48_197, preambleCallMs: 48_198 })).toBe(false);
  });
});

describe('the wiring — proven from the source, because no behavioural test in this repo reaches it', () => {
  const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
  const builder = readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8');
  const diag = readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8');

  it('the dispatcher no longer latches a failed probe as "not a TypeScript project"', () => {
    expect(dispatcher).not.toContain('catch { this._isTsProject = false; }');
    expect(dispatcher).toContain('if (isMissingFileError(err)) this._tsProject = \'no\';');
    expect(dispatcher).toContain('shouldProbeTsconfig(this._tsProject, this._tsProbeAttempts)');
  });

  it('the two skip reasons are counted separately at the one place that knows them apart', () => {
    expect(dispatcher).toContain('s.skippedNotTs += paths.length');
    expect(dispatcher).toContain('s.skippedNoTsconfig += tsPaths.length');
  });

  it('the fast lane names the third skip reason instead of blaming the budget split', () => {
    expect(builder).toContain('contractCallCanFinish({ contractCapMs: contractCap, preambleCallMs: planCallMs })');
    expect(builder).toContain('it would be cut off before producing anything');
  });

  it('🔴 the report no longer says "this build\'s time budget ended" about a step deadline', () => {
    expect(diag).not.toContain("stopped because this build's time budget ended");
    expect(diag).toContain('stopped by one of our own clocks');
  });
});
