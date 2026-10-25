import { describe, expect, it, vi } from 'vitest';
import { admitSurplusOrFallback, SURPLUS_ADMISSION_TIMEOUT_MS } from './admitOrFallback';
import { SurplusBuildUnavailableError, type SurplusBuildSession } from './buildSession';

const session = Object.freeze({ buildId: 'b1', model: 'model-a', estimatedMicroUsd: '1.000000', runner: () => ({ runTurn: async () => ({ text: '' }) }) }) as unknown as SurplusBuildSession;

describe('admitSurplusOrFallback', () => {
  it('skips all Surplus I/O when the builder flag is off', async () => {
    const create = vi.fn();
    const outcome = await admitSurplusOrFallback({ buildId: 'b1', tier: 'weak', enabled: false, create });
    expect(outcome).toEqual({ status: 'skipped', session: undefined, reason: 'flag_off' });
    expect(create).not.toHaveBeenCalled();
  });

  it('admits a live Surplus session when creation succeeds', async () => {
    const create = vi.fn(async () => session);
    const outcome = await admitSurplusOrFallback({ buildId: 'b1', tier: 'weak', enabled: true, create });
    expect(outcome).toEqual({ status: 'admitted', session });
    expect(create).toHaveBeenCalledOnce();
  });

  it('fails open to Weak when Surplus admission throws', async () => {
    const onFallback = vi.fn();
    const create = vi.fn(async () => { throw new SurplusBuildUnavailableError('no_eligible_90_percent_offer'); });
    const outcome = await admitSurplusOrFallback({ buildId: 'b1', tier: 'weak', enabled: true, create, onFallback });
    expect(outcome).toEqual({ status: 'fallback', session: undefined, reason: 'no_eligible_90_percent_offer' });
    expect(onFallback).toHaveBeenCalledExactlyOnceWith('no_eligible_90_percent_offer');
  });

  it('fails open with admission_timeout when Surplus hangs past the hard deadline', async () => {
    vi.useFakeTimers();
    try {
      const onFallback = vi.fn();
      const create = vi.fn(() => new Promise<SurplusBuildSession>(() => { /* never settles */ }));
      const pending = admitSurplusOrFallback({
        buildId: 'b1', tier: 'weak', enabled: true, create, onFallback, timeoutMs: SURPLUS_ADMISSION_TIMEOUT_MS,
      });
      await vi.advanceTimersByTimeAsync(SURPLUS_ADMISSION_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ status: 'fallback', session: undefined, reason: 'admission_timeout' });
      expect(onFallback).toHaveBeenCalledExactlyOnceWith('admission_timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never exposes upstream exception text in the fallback reason', async () => {
    const create = vi.fn(async () => { throw new Error('https://api.surplusintelligence.ai secret-key boom'); });
    const outcome = await admitSurplusOrFallback({ buildId: 'b1', tier: 'weak', enabled: true, create });
    expect(outcome.status).toBe('fallback');
    if (outcome.status === 'fallback') {
      expect(outcome.reason).toBe('review_unavailable');
      expect(outcome.reason).not.toMatch(/surplus|secret|https/i);
    }
  });
});

describe('resolveProBuildSurplusAdmission', () => {
  it('continues without Surplus when flag is off and Weak ladder is available', async () => {
    const { resolveProBuildSurplusAdmission } = await import('./admitOrFallback');
    const outcome = await resolveProBuildSurplusAdmission({
      buildId: 'b1', tier: 'weak', enabled: false, create: vi.fn(),
      tierEngineAvailable: () => true,
    });
    expect(outcome).toEqual({ ok: true, session: undefined });
  });

  it('refuses when Surplus fails open and Weak ladder is unavailable', async () => {
    const { resolveProBuildSurplusAdmission } = await import('./admitOrFallback');
    const create = vi.fn(async () => { throw new SurplusBuildUnavailableError('stale_or_missing_snapshot'); });
    const outcome = await resolveProBuildSurplusAdmission({
      buildId: 'b1', tier: 'weak', enabled: true, create,
      tierEngineAvailable: () => false,
    });
    expect(outcome).toEqual({ ok: false, afterSurplusFallback: true });
  });
});
