import { describe, expect, it, beforeEach } from 'vitest';
import {
  shouldSkipSurplusAdmit,
  recordSurplusMidBuildDeath,
  recordSurplusAdmitProbeSuccess,
  resetSurplusAdmitCircuitForTests,
  surplusAdmitCircuitSnapshot,
  SURPLUS_ADMIT_CIRCUIT_OPEN_REASON,
  SURPLUS_ADMIT_CIRCUIT_FAILURE_THRESHOLD,
  SURPLUS_ADMIT_CIRCUIT_BASE_COOLDOWN_MS,
} from './surplusAdmitCircuit';
import { safeSurplusAdmissionReason } from './admitOrFallback';

describe('surplusAdmitCircuit', () => {
  beforeEach(() => {
    resetSurplusAdmitCircuitForTests();
  });

  it('starts closed — does not skip Surplus admits', () => {
    expect(shouldSkipSurplusAdmit(1_000)).toBe(false);
    expect(surplusAdmitCircuitSnapshot(1_000).state).toBe('closed');
  });

  it('stays closed after a single mid-build death (not yet a spike)', () => {
    const t0 = 1_000_000;
    expect(recordSurplusMidBuildDeath('mid_build_engine_unavailable', t0)).toBe(0);
    expect(shouldSkipSurplusAdmit(t0 + 1)).toBe(false);
    expect(surplusAdmitCircuitSnapshot(t0 + 1).state).toBe('closed');
    expect(surplusAdmitCircuitSnapshot(t0 + 1).consecutiveDeaths).toBe(1);
  });

  it('opens after consecutive mid-build deaths (spike) and skips admits during cool-down', () => {
    const t0 = 1_000_000;
    recordSurplusMidBuildDeath('mid_build_engine_unavailable', t0);
    const until = recordSurplusMidBuildDeath('mid_build_timeout', t0 + 10);
    expect(until).toBeGreaterThan(t0 + 10);
    expect(shouldSkipSurplusAdmit(t0 + 11)).toBe(true);
    const snap = surplusAdmitCircuitSnapshot(t0 + 11);
    expect(snap.state).toBe('open');
    expect(snap.consecutiveDeaths).toBeGreaterThanOrEqual(SURPLUS_ADMIT_CIRCUIT_FAILURE_THRESHOLD);
    expect(snap.openedUntil).toBe(until);
    expect(snap.lastOpenReason).toMatch(/mid_build/);
  });

  it('allows a half-open probe after cool-down elapses', () => {
    const t0 = 2_000_000;
    recordSurplusMidBuildDeath('mid_build_transport', t0);
    const until = recordSurplusMidBuildDeath('mid_build_transport', t0 + 1);
    expect(shouldSkipSurplusAdmit(until - 1)).toBe(true);
    expect(shouldSkipSurplusAdmit(until)).toBe(false); // HALF_OPEN — trial admit allowed
    expect(surplusAdmitCircuitSnapshot(until).state).toBe('half_open');
  });

  it('closes on a successful Surplus turn (probe success)', () => {
    const t0 = 3_000_000;
    recordSurplusMidBuildDeath('mid_build_engine_unavailable', t0);
    recordSurplusMidBuildDeath('mid_build_engine_unavailable', t0 + 1);
    expect(shouldSkipSurplusAdmit(t0 + 2)).toBe(true);
    recordSurplusAdmitProbeSuccess();
    expect(shouldSkipSurplusAdmit(t0 + 3)).toBe(false);
    expect(surplusAdmitCircuitSnapshot(t0 + 3).state).toBe('closed');
    expect(surplusAdmitCircuitSnapshot(t0 + 3).consecutiveDeaths).toBe(0);
  });

  it('escalates cool-down on further deaths while open / after reopen', () => {
    const t0 = 4_000_000;
    recordSurplusMidBuildDeath('mid_build_engine_unavailable', t0);
    const first = recordSurplusMidBuildDeath('mid_build_engine_unavailable', t0 + 1);
    expect(first - (t0 + 1)).toBe(SURPLUS_ADMIT_CIRCUIT_BASE_COOLDOWN_MS);
    const second = recordSurplusMidBuildDeath('mid_build_engine_unavailable', t0 + 2);
    expect(second - (t0 + 2)).toBe(SURPLUS_ADMIT_CIRCUIT_BASE_COOLDOWN_MS * 2);
  });

  it('exposes admit_circuit_open as a safe admission reason', () => {
    expect(SURPLUS_ADMIT_CIRCUIT_OPEN_REASON).toBe('admit_circuit_open');
    expect(safeSurplusAdmissionReason(SURPLUS_ADMIT_CIRCUIT_OPEN_REASON)).toBe('admit_circuit_open');
    expect(safeSurplusAdmissionReason('circuit open overload cool')).toBe('admit_circuit_open');
  });

  it('uses a multi-minute base cool-down (not a flickery few seconds)', () => {
    expect(SURPLUS_ADMIT_CIRCUIT_BASE_COOLDOWN_MS).toBeGreaterThanOrEqual(60_000);
  });
});
