import { describe, it, expect } from 'vitest';
import { watchedMsFrom, buildOutcomeTrackingEnabled } from './BuildOutcomeStore';

describe('watchedMsFrom — "never measured" and "measured as zero" are different facts', () => {
  it('is null when the preview was never seen', () => {
    expect(watchedMsFrom(null)).toBeNull();
    expect(watchedMsFrom(undefined)).toBeNull();
    expect(watchedMsFrom({})).toBeNull();
    expect(watchedMsFrom({ previewLastSeenAt: 5 })).toBeNull(); // a last with no first is not a span
  });

  it('is 0 for a single ping — seen, but no span yet', () => {
    // Collapsing this into null is how "never measured" would start reading as "watched briefly", and
    // collapsing null into 0 is how it would start reading as "abandoned instantly". Both are lies the
    // scorer would then act on.
    expect(watchedMsFrom({ previewFirstSeenAt: 1_000 })).toBe(0);
    expect(watchedMsFrom({ previewFirstSeenAt: 1_000, previewLastSeenAt: 1_000 })).toBe(0);
  });

  it('is the real span across pings', () => {
    expect(watchedMsFrom({ previewFirstSeenAt: 1_000, previewLastSeenAt: 181_000 })).toBe(180_000);
  });

  it('never returns a negative span from an out-of-order clock', () => {
    expect(watchedMsFrom({ previewFirstSeenAt: 9_000, previewLastSeenAt: 1_000 })).toBe(0);
  });
});

describe('buildOutcomeTrackingEnabled', () => {
  it('is on by default and off only for the explicit kill switch', () => {
    expect(buildOutcomeTrackingEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(buildOutcomeTrackingEnabled({ AGENTV3_OUTCOME_TRACKING: 'off' } as never)).toBe(false);
    expect(buildOutcomeTrackingEnabled({ AGENTV3_OUTCOME_TRACKING: 'on' } as never)).toBe(true);
  });
});
