import { describe, it, expect } from 'vitest';
import { nextLivePollDelayMs, resumeSinceSeq, LIVE_POLL_FAST_MS, LIVE_POLL_MAX_MS } from './livePollPolicy';

describe('nextLivePollDelayMs (B6 — pause-on-hidden + activity-aware backoff)', () => {
  it('a HIDDEN tab jumps straight to the max (near-pause), whatever the current delay', () => {
    expect(nextLivePollDelayMs({ hidden: true, hadActivity: false, current: 3_000 })).toBe(LIVE_POLL_MAX_MS);
    expect(nextLivePollDelayMs({ hidden: true, hadActivity: true, current: 3_000 })).toBe(LIVE_POLL_MAX_MS);
  });
  it('activity snaps back to the fast cadence', () => {
    expect(nextLivePollDelayMs({ hidden: false, hadActivity: true, current: 30_000 })).toBe(LIVE_POLL_FAST_MS);
  });
  it('quiet + visible backs off ×1.6 up to the max', () => {
    expect(nextLivePollDelayMs({ hidden: false, hadActivity: false, current: 3_000 })).toBe(4_800);
    expect(nextLivePollDelayMs({ hidden: false, hadActivity: false, current: 20_000 })).toBe(LIVE_POLL_MAX_MS);
    expect(nextLivePollDelayMs({ hidden: false, hadActivity: false, current: 30_000 })).toBe(LIVE_POLL_MAX_MS);
  });
  it('a junk current delay falls back to the fast cadence base', () => {
    expect(nextLivePollDelayMs({ hidden: false, hadActivity: false, current: 0 })).toBe(Math.round(LIVE_POLL_FAST_MS * 1.6));
    expect(nextLivePollDelayMs({ hidden: false, hadActivity: false, current: NaN })).toBe(Math.round(LIVE_POLL_FAST_MS * 1.6));
  });
});

describe('resumeSinceSeq (B6 — re-arm resumes, never re-downloads from 0)', () => {
  it('resumes from a stored positive seq', () => {
    expect(resumeSinceSeq(42)).toBe(42);
  });
  it('starts at 0 for a fresh/unknown workspace or junk value', () => {
    expect(resumeSinceSeq(undefined)).toBe(0);
    expect(resumeSinceSeq(0)).toBe(0);
    expect(resumeSinceSeq(-5)).toBe(0);
    expect(resumeSinceSeq(3.7 as unknown as number)).toBe(0);
  });
});
