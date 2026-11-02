import { describe, it, expect } from 'vitest';
import { surplusFallbackDisabledFor } from './surplusNoFallback';
import { tryConsumeSurplusPreWriteFailOpen } from './surplusPreWriteFailOpen';
import { PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../../lib/buildEngineError';

describe('surplusFallbackDisabledFor', () => {
  it('no profile opts out of fallback — z@gmail.com same as others (2026-11-02)', () => {
    expect(surplusFallbackDisabledFor('z@gmail.com')).toBe(false);
    expect(surplusFallbackDisabledFor(' Z@Gmail.com ')).toBe(false);
    expect(surplusFallbackDisabledFor('a@gmail.com')).toBe(false);
    expect(surplusFallbackDisabledFor('xz@gmail.com')).toBe(false);
    expect(surplusFallbackDisabledFor(null)).toBe(false);
    expect(surplusFallbackDisabledFor(undefined)).toBe(false);
  });

  it('noFallback hooks never consume a pre-write fail-open', () => {
    let fired = 0;
    const hooks = { state: { dropped: false }, userFilesWritten: () => 0, onFailOpen: () => { fired++; }, noFallback: true };
    const err = new Error(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(tryConsumeSurplusPreWriteFailOpen({ ...hooks, noFallback: false, state: { dropped: false } }, err)).not.toBeNull();
    fired = 0;
    expect(tryConsumeSurplusPreWriteFailOpen(hooks, err)).toBeNull();
    expect(hooks.state.dropped).toBe(false);
    expect(fired).toBe(0);
  });
});

describe('surplusRawErrorReporter', () => {
  it('nobody (incl. z@gmail.com) gets raw errors; scrubbed copy for all', async () => {
    const { surplusRawErrorReporter } = await import('./surplusNoFallback');
    expect(surplusRawErrorReporter('a@b.com', () => {})).toBeUndefined();
    expect(surplusRawErrorReporter('z@gmail.com', () => {})).toBeUndefined();
    expect(surplusRawErrorReporter(null, () => {}, 'GiYNmFcDMVYSWW48Nrurm7j41gv1')).toBeUndefined();
  });
});

describe('surplusFallbackDisabledFor uid match (2026-10-29 stale_or_missing_snapshot fallback leak)', () => {
  it('z uid routes normally on every tier, same as other users', async () => {
    const { surplusFallbackDisabledFor, surplusFallbackDisabledForTier } = await import('./surplusNoFallback');
    expect(surplusFallbackDisabledFor(null, 'GiYNmFcDMVYSWW48Nrurm7j41gv1')).toBe(false);
    expect(surplusFallbackDisabledFor(null, 'someone-else')).toBe(false);
    for (const tier of ['weak', 'normal', 'strong', 'surplus']) {
      expect(surplusFallbackDisabledForTier(tier, 'z@gmail.com', 'GiYNmFcDMVYSWW48Nrurm7j41gv1'))
        .toBe(surplusFallbackDisabledForTier(tier, 'a@b.com', 'someone-else'));
    }
  });
});
