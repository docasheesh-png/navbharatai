import { describe, it, expect } from 'vitest';
import { historyOpen404Action, DEAD_BRAND_MIN_AGE_MS } from './historyOpenPolicy';

describe('historyOpen404Action', () => {
  // THE reported bug (IMG_5715): a chat built THE SAME HOUR was opened from history while its build
  // was still running/saving → 404 → permanently branded "Transcript lost". Must never brand young.
  it("a still-running build is 'resume-live' — re-attach, never brand (the reported bug)", () => {
    expect(historyOpen404Action({ ageMs: 10 * 60_000, buildRunning: true })).toBe('resume-live');
    expect(historyOpen404Action({ ageMs: 48 * 3600_000, buildRunning: true })).toBe('resume-live'); // running always wins
  });

  it("a YOUNG chat (persist may be in flight) is 'not-saved-yet' — honest transient message, no branding", () => {
    expect(historyOpen404Action({ ageMs: 0, buildRunning: false })).toBe('not-saved-yet');
    expect(historyOpen404Action({ ageMs: 15 * 60_000, buildRunning: false })).toBe('not-saved-yet');
    expect(historyOpen404Action({ ageMs: DEAD_BRAND_MIN_AGE_MS - 1, buildRunning: false })).toBe('not-saved-yet');
  });

  it("only an OLD, not-running chat is 'brand-dead' (the genuine pre-rebuild destroyed class)", () => {
    expect(historyOpen404Action({ ageMs: DEAD_BRAND_MIN_AGE_MS, buildRunning: false })).toBe('brand-dead');
    expect(historyOpen404Action({ ageMs: 7 * 24 * 3600_000, buildRunning: false })).toBe('brand-dead');
  });

  it('an UNKNOWN age (no timestamps on the row) is treated as old — pre-rebuild rows may lack them', () => {
    expect(historyOpen404Action({ ageMs: Number.NaN, buildRunning: false })).toBe('brand-dead');
    expect(historyOpen404Action({ ageMs: -5, buildRunning: false })).toBe('brand-dead');
    expect(historyOpen404Action({ ageMs: Number.POSITIVE_INFINITY, buildRunning: false })).toBe('brand-dead');
  });
});
