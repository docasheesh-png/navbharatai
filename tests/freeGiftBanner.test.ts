import { describe, it, expect } from 'vitest';
import { creditArrivesIn } from '../src/components/panels/FreeGiftBanner';

// A date is harder to feel than a distance: "arrives on 4 August" makes someone do arithmetic,
// "arrives in 3 days" does not. This is the only logic in the banner, so it is the only part worth
// testing here — everything else it renders comes straight from the server's `freeGift` block.

const T0 = Date.parse('2026-07-28T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (t: number) => new Date(t).toISOString();

describe('creditArrivesIn', () => {
  it('counts whole days ahead', () => {
    expect(creditArrivesIn(iso(T0 + 3 * DAY), T0)).toBe('in 3 days');
    expect(creditArrivesIn(iso(T0 + 7 * DAY), T0)).toBe('in 7 days');
  });

  it('says tomorrow rather than "in 1 days"', () => {
    expect(creditArrivesIn(iso(T0 + DAY), T0)).toBe('tomorrow');
  });

  it('a few hours away is still tomorrow, not "today"', () => {
    // Rounding UP is deliberate: promising credit "today" that lands after midnight reads as a broken
    // promise, while "tomorrow" that arrives tonight reads as a pleasant surprise.
    expect(creditArrivesIn(iso(T0 + 5 * 60 * 60 * 1000), T0)).toBe('tomorrow');
  });

  it('a rung that is already due says today, never a past date', () => {
    expect(creditArrivesIn(iso(T0), T0)).toBe('today');
    expect(creditArrivesIn(iso(T0 - 5 * DAY), T0)).toBe('today');
  });

  it('an unparseable date renders nothing rather than "in NaN days"', () => {
    expect(creditArrivesIn('soon', T0)).toBe('');
    expect(creditArrivesIn('', T0)).toBe('');
  });
});
