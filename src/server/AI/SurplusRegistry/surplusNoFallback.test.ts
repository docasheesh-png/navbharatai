import { describe, it, expect } from 'vitest';
import { surplusFallbackDisabledFor } from './surplusNoFallback';
import { tryConsumeSurplusPreWriteFailOpen } from './surplusPreWriteFailOpen';
import { PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../../lib/buildEngineError';

describe('surplusFallbackDisabledFor', () => {
  it('matches only z@gmail.com (case/space-insensitive)', () => {
    expect(surplusFallbackDisabledFor('z@gmail.com')).toBe(true);
    expect(surplusFallbackDisabledFor(' Z@Gmail.com ')).toBe(true);
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
  it('only z@gmail.com gets raw errors; others undefined', async () => {
    const { surplusRawErrorReporter } = await import('./surplusNoFallback');
    const { tagRawErrorDetail } = await import('../../AgentV3/rawErrorDetail');
    expect(surplusRawErrorReporter('a@b.com', () => {})).toBeUndefined();
    const out: string[] = [];
    const r = surplusRawErrorReporter('z@gmail.com', (t) => out.push(t))!;
    r(tagRawErrorDetail(new Error(PUBLIC_BUILD_ENGINE_UNAVAILABLE), new Error('400 bad param max_tokens')));
    expect(out[0]).toContain('400 bad param max_tokens');
  });
});
