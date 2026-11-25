/**
 * 🚫 AN ENGINE THAT REFUSES IS PARKED, NOT RETRIED EVERY BUILD (failedbr BR2514–BR2519, 2026-11-24).
 *
 * Six builds, hours apart: each admitted Surplus, each model answered "the engine refused the request, HTTP 404", each
 * build spent 80–94 s on it and fell back to the Weak ladder. The admit circuit's cool-down (1–3 min, sized for an
 * overload spike) had always expired by the next build. An outright refusal now parks Surplus for 30 min at once;
 * then one build probes it (half-open). A passing fault (429, 408, a timeout) keeps the short spike behaviour.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordSurplusMidBuildDeath, recordSurplusAdmitProbeSuccess, resetSurplusAdmitCircuitForTests, shouldSkipSurplusAdmit,
  SURPLUS_ADMIT_CIRCUIT_REFUSAL_COOLDOWN_MS, SURPLUS_ADMIT_CIRCUIT_MAX_COOLDOWN_MS,
} from '../src/server/AI/SurplusRegistry/surplusAdmitCircuit';
import { readFileSync } from 'node:fs';

const T0 = 1_795_519_306_865; // BR2514's start
const HOUR = 3_600_000;
beforeEach(() => resetSurplusAdmitCircuitForTests());

describe('🔴 the reported day: 404s hours apart', () => {
  it('ONE refused build parks Surplus at once — the next build an hour later does not burn 85 s on it again', () => {
    recordSurplusMidBuildDeath('mid_build_after_write', T0, { httpStatus: 404 });
    expect(shouldSkipSurplusAdmit(T0 + 60_000)).toBe(true);
    expect(shouldSkipSurplusAdmit(T0 + 20 * 60_000)).toBe(true);
  });
  it('after 30 min one build probes it; refused again ⇒ parked again; served ⇒ back for everyone', () => {
    recordSurplusMidBuildDeath('mid_build_after_write', T0, { httpStatus: 404 });
    const probe = T0 + SURPLUS_ADMIT_CIRCUIT_REFUSAL_COOLDOWN_MS + 1;
    expect(shouldSkipSurplusAdmit(probe)).toBe(false); // half-open: one trial
    recordSurplusMidBuildDeath('mid_build_after_write', probe, { httpStatus: 404 });
    expect(shouldSkipSurplusAdmit(probe + HOUR / 4)).toBe(true);
    recordSurplusAdmitProbeSuccess();
    expect(shouldSkipSurplusAdmit(probe + HOUR / 4)).toBe(false);
  });
  it('🔁 reversion: without the status (the old call) one 404 build parks nothing, and the spike cool-down is minutes', () => {
    recordSurplusMidBuildDeath('mid_build_after_write', T0);
    expect(shouldSkipSurplusAdmit(T0 + 1)).toBe(false);
    recordSurplusMidBuildDeath('mid_build_after_write', T0 + HOUR);
    expect(shouldSkipSurplusAdmit(T0 + HOUR + SURPLUS_ADMIT_CIRCUIT_MAX_COOLDOWN_MS + 1)).toBe(false);
  });
});

describe('a passing fault is still a spike, not a refusal', () => {
  for (const st of [429, 408, 500, 503]) {
    it(`HTTP ${st}: one death parks nothing (the spike threshold still applies)`, () => {
      recordSurplusMidBuildDeath('mid_build_engine_unavailable', T0, { httpStatus: st });
      expect(shouldSkipSurplusAdmit(T0 + 1)).toBe(false);
    });
  }
  it('the fail-open path hands the engine\'s real status to the circuit', () => {
    const src = readFileSync('src/server/AI/SurplusRegistry/surplusPreWriteFailOpen.ts', 'utf8');
    expect(src).toContain("const httpStatus = readEngineSafeDiag(error)?.status; if (typeof httpStatus === 'number') recordSurplusMidBuildDeath(reason, Date.now(), { httpStatus });");
  });
});
