import { describe, it, expect } from 'vitest';
import { SW_UPDATE_MIN_INTERVAL_MS, shouldCheckForUpdate } from './swUpdateCheck';

describe('swUpdateCheck — throttled service-worker update re-check (B8)', () => {
  it('does not re-check before the minimum interval has elapsed', () => {
    const last = 1_000_000;
    expect(shouldCheckForUpdate(last, last)).toBe(false);
    expect(shouldCheckForUpdate(last, last + SW_UPDATE_MIN_INTERVAL_MS - 1)).toBe(false);
  });

  it('re-checks once the minimum interval has elapsed (and beyond)', () => {
    const last = 1_000_000;
    expect(shouldCheckForUpdate(last, last + SW_UPDATE_MIN_INTERVAL_MS)).toBe(true);
    expect(shouldCheckForUpdate(last, last + SW_UPDATE_MIN_INTERVAL_MS * 5)).toBe(true);
  });

  it('honours a custom interval', () => {
    expect(shouldCheckForUpdate(0, 4_999, 5_000)).toBe(false);
    expect(shouldCheckForUpdate(0, 5_000, 5_000)).toBe(true);
  });

  it('a burst of refocus events within the window only allows the first check', () => {
    // Simulates rapid visibilitychange→visible events; only the first (after the window) passes.
    let last = 0;
    const now = SW_UPDATE_MIN_INTERVAL_MS; // window has just elapsed
    expect(shouldCheckForUpdate(last, now)).toBe(true);
    last = now; // the check ran, timestamp updated
    // three more refocuses in the same second → all throttled
    expect(shouldCheckForUpdate(last, now + 100)).toBe(false);
    expect(shouldCheckForUpdate(last, now + 500)).toBe(false);
    expect(shouldCheckForUpdate(last, now + 999)).toBe(false);
  });
});
