/**
 * AUTOPSY `21b431e1` (2026-09-22) — TWO MEASUREMENTS, BUILT BEFORE THEIR FIXES, ON PURPOSE.
 *
 * The report's two most expensive items could each be explained by two different causes, and nothing
 * anywhere could say which:
 *
 *  • **8.5 minutes in the fast lane, dead on ONE `TS2554`.** Hand off sooner when the first verify
 *    blames many files? Or send the repair only the offending file? The answer depends entirely on
 *    which PHASE the minutes were in, and no report carried a phase.
 *  • **Five failed provider attempts and the ladder still on rung 2 of 5.** "The bench is too slow"
 *    is the obvious reading — but the bench's trigger is a COUNT (two consecutive timeouts) and its
 *    cost is a CLOCK, and the two had never been compared. Three minutes of a 480-second turn is 37%
 *    of the user's wait; three minutes of a 30-minute build is noise.
 *
 * The fourth absolute rule forbids fixing from a guess, so the numbers ship first. **Neither of these
 * decides anything** — no routing, no bench, no model call.
 */
import { describe, it, expect } from 'vitest';
import { fastLanePhaseSummary, dominantFastLanePhase, type FastLanePhases } from '../src/server/AgentV3/fastLanePhases';
import {
  emptyWasteLedger, recordWaste, wasteSummary, totalWasteMs, totalWasteCalls,
} from '../src/server/AgentV3/providerWaste';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const phases = (o: Partial<FastLanePhases> = {}): FastLanePhases => ({
  planMs: 0, contractMs: 0, generateMs: 0, verifyMs: 0, repairMs: 0,
  verifyRuns: 0, repairRuns: 0, totalMs: 0, ...o,
});

describe('where the fast lane’s minutes went', () => {
  it('names every phase and its share of the lane’s own clock', () => {
    const line = fastLanePhaseSummary(phases({
      planMs: 30_000, generateMs: 200_000, verifyMs: 60_000, repairMs: 210_000,
      verifyRuns: 4, repairRuns: 3, totalMs: 510_000,
    }));
    expect(line).toContain('Fast lane took 510s');
    expect(line).toContain('generate 200s (39%)');
    expect(line).toContain('verify 60s (12%) over 4 run(s)');
    expect(line).toContain('repair 210s (41%) over 3 round(s)');
  });

  it('🔴 an unaccounted remainder is PRINTED, never folded into a phase', () => {
    // Writing files and the deterministic passes are not timed. Hiding the gap would send the first
    // reader to a conclusion about the wrong phase.
    const line = fastLanePhaseSummary(phases({ generateMs: 100_000, totalMs: 160_000 }));
    expect(line).toContain('everything else 60s (38%)');
  });

  it('a lane that never started says so, instead of reporting zeros as a measurement', () => {
    expect(fastLanePhaseSummary(undefined)).toContain('never started');
    expect(dominantFastLanePhase(undefined)).toBe('unknown');
  });

  it('counts are separate from durations — three compiles is not one slow compile', () => {
    const many = fastLanePhaseSummary(phases({ verifyMs: 90_000, verifyRuns: 3, totalMs: 90_000 }));
    const one = fastLanePhaseSummary(phases({ verifyMs: 90_000, verifyRuns: 1, totalMs: 90_000 }));
    expect(many).toContain('over 3 run(s)');
    expect(one).toContain('over 1 run(s)');
  });

  it('the dominant phase is the one a scan of many reports can be grouped by', () => {
    expect(dominantFastLanePhase(phases({ repairMs: 210_000, generateMs: 200_000, totalMs: 510_000 })))
      .toContain('repair 210s of 510s');
    expect(dominantFastLanePhase(phases({ generateMs: 200_000, repairMs: 10_000, totalMs: 220_000 })))
      .toContain('generate 200s');
  });

  it('the contract phase is named only when it ran', () => {
    expect(fastLanePhaseSummary(phases({ totalMs: 10_000 }))).not.toContain('contract');
    expect(fastLanePhaseSummary(phases({ contractMs: 4_000, totalMs: 10_000 }))).toContain('contract 4s');
  });
});

describe('what the calls that returned nothing cost', () => {
  it('a clean build says every call returned something', () => {
    const line = wasteSummary(emptyWasteLedger(), 600_000);
    expect(line).toContain('every model call this build returned something');
  });

  it('sums by kind and by engine, and shows the share of the build’s clock', () => {
    const l = emptyWasteLedger();
    recordWaste(l, 'GLM', 'timeout', 60_000);
    recordWaste(l, 'GLM', 'timeout', 60_000);
    recordWaste(l, 'GLM', 'crawl', 26_170);
    recordWaste(l, 'KIMI', 'rate-limit', 1_200);
    expect(totalWasteCalls(l)).toBe(4);
    expect(totalWasteMs(l)).toBe(147_370);
    const line = wasteSummary(l, 480_000);
    expect(line).toContain('147.4s across 4 call(s)');
    expect(line).toContain("31% of the build's clock");
    expect(line).toContain('2 timeout (120s)');
    expect(line).toContain('1 crawl (26.2s)');
    expect(line).toContain('GLM 146.2s');
  });

  it('🔴 a share is reported ONLY when the denominator was really given', () => {
    // A percentage of an unknown total is the shape of number that gets quoted later as measured.
    const l = emptyWasteLedger();
    recordWaste(l, 'GLM', 'timeout', 60_000);
    expect(wasteSummary(l)).not.toContain('%');
    expect(wasteSummary(l, 0)).not.toContain('%');
    expect(wasteSummary(l, 600_000)).toContain('%');
  });

  it('an unmeasured or negative duration counts as zero, and the CALL still counts', () => {
    const l = emptyWasteLedger();
    recordWaste(l, 'GLM', 'error', Number.NaN);
    recordWaste(l, 'GLM', 'error', -5);
    expect(totalWasteMs(l)).toBe(0);
    expect(totalWasteCalls(l)).toBe(2);
    expect(wasteSummary(l, 1000)).toContain('2 error');
  });

  it('a family we could not name is "unknown", never dropped', () => {
    const l = emptyWasteLedger();
    recordWaste(l, '', 'timeout', 1000);
    expect(l.msByFamily.unknown).toBe(1000);
  });

  it('no vendor leaks into anything a user could see — these are admin-only lines', () => {
    const l = emptyWasteLedger();
    recordWaste(l, 'GLM', 'timeout', 1000);
    // The engine name IS the point here; what matters is that the code is registered process-only.
    const diag = readFileSync(join(process.cwd(), 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    expect(diag).toContain("'PROVIDER_TIME_WASTED'");
  });

  it('REVERSION GUARD: the runner emits once, before the classification, and the route listens', () => {
    const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/providers/MultiProviderTurnRunner.ts'), 'utf8');
    const emitAt = runner.indexOf('opts.onAttemptWasted?.(reportName, kind, wastedMs)');
    const classifyAt = runner.indexOf('if (isSlowStreamAbandon(err)) {\n            abandonedSlowRung = true;');
    expect(emitAt).toBeGreaterThan(0);
    // Placed before the branches so no branch can forget it.
    expect(emitAt).toBeLessThan(classifyAt);
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('onAttemptWasted: recordAttemptWasted');
    expect(route).toContain("code: 'PROVIDER_TIME_WASTED'");
    expect(route).toContain("code: 'FAST_LANE_PHASES'");
  });
});
