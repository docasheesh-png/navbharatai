// Q-881 — THE NUMBER THAT MULTIPLIES EVERY BILL HAS A BOUND, WHEREVER IT ENTERS.
//
// 🔴 THE DEFECT. The whole validation on the live USD→INR rate was `Number.isFinite(rate) && rate > 0`,
// so any positive number the free FX source returned became the multiplier on every bill on that instance
// until the next refresh: `0.5`, `5000`, a glitched payload, a compromised response. `usdInrRate()` is read
// at ~24 billing sites, so "every bill" is literal, not rhetorical.
//
// ⚠️ AND THE OBVIOUS FIX WOULD HAVE RE-CREATED A BUG THIS MODULE ALREADY HAD — which is why the shape of
// the fix matters more than its existence. The revenue audit of 2026-09-10 found `refreshUsdInrRate` was
// never wired anywhere outside its own test, so the rate sat FROZEN at the 85 fallback while the real rate
// was 87-88, and every build was under-billed ~3% in silence. A plain "refuse anything more than 5% from
// the last good value" band freezes the rate again the first time the rupee really moves 6% — the same bug
// with a safety badge on.
//
// So the property this file is really here to protect is: **the rate is bounded AND can never freeze on a
// real move.** A big jump is HELD for one cycle and lands when a second, independent fetch agrees. One
// glitch never bills anybody; a genuine move is late by one refresh, never permanent.
//
// 🔑 AND THE SIBLING: Q-881's row names only the fetch path. `setUsdInrRate` — the ops override — carried
// the identical weak check, so a hand-typed `8500` was as acceptable as a glitched payload. The band
// applies there too; the JUMP rule deliberately does not (see the module).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  usdInrRate, setUsdInrRate, refreshUsdInrRate, usdInrRateHealth,
  usdInrInAbsoluteBand, usdInrIsSmallMove,
  USD_INR_MIN, USD_INR_MAX, USD_INR_JUMP_FRACTION,
} from '../src/server/lib/UsdInrRate';

/** One fetch returning `inr`, as the live source shapes it. */
const source = (inr: unknown) => vi.fn().mockResolvedValue({ rates: { INR: inr } });

beforeEach(() => { setUsdInrRate(85); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('an impossible rate never becomes the billing rate', () => {
  it('🔴 THE INCIDENT: a glitched payload is refused and billing stays where it was', async () => {
    for (const absurd of [0.5, 5000, 0, -85, NaN, Infinity, '85', null, undefined, {}, []]) {
      setUsdInrRate(85);
      await refreshUsdInrRate(source(absurd));
      expect(usdInrRate(), `${JSON.stringify(absurd)} must not become the rate`).toBe(85);
    }
  });

  it('the band is wide enough that it can only catch the impossible', () => {
    // It must not have an opinion about FX. Today's rate is ~85; a 2.5x move is still accepted.
    expect(usdInrInAbsoluteBand(85)).toBe(true);
    expect(usdInrInAbsoluteBand(40)).toBe(true);
    expect(usdInrInAbsoluteBand(250)).toBe(true);
    expect(usdInrInAbsoluteBand(USD_INR_MIN)).toBe(true);
    expect(usdInrInAbsoluteBand(USD_INR_MAX)).toBe(true);
    expect(usdInrInAbsoluteBand(USD_INR_MIN - 0.01)).toBe(false);
    expect(usdInrInAbsoluteBand(USD_INR_MAX + 0.01)).toBe(false);
    expect(USD_INR_MAX / USD_INR_MIN, 'a band narrower than 5x would start being an FX forecast').toBeGreaterThan(5);
  });

  it('a refusal is LOUD every time, with a running count — the 2026-09 bug was silent', async () => {
    // ⚠️ `refusalsInARow` is module state that only an ACCEPTANCE clears, which is the honest definition:
    // a manual override does not make the FX source healthy again, so it deliberately does not reset the
    // streak. So establish a known state with a good refresh first — and that proves the reset too.
    await refreshUsdInrRate(source(85.1));
    expect(usdInrRateHealth().refusalsInARow, 'an acceptance clears the streak').toBe(0);

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await refreshUsdInrRate(source(5000));
    await refreshUsdInrRate(source(5000));
    expect(err, 'quiet-after-the-first is exactly how a frozen rate hid for months').toHaveBeenCalledTimes(2);
    expect(String(err.mock.calls[1][0])).toMatch(/#2 in a row/);
    expect(usdInrRateHealth().refusalsInARow).toBe(2);
    expect(usdInrRateHealth().lastRefusal).toContain('outside the plausible band');
    expect(usdInrRate(), 'and billing never moved').toBe(85.1);
  });
});

describe('🔑 and yet the rate can NEVER freeze on a real move', () => {
  it('an ordinary move lands immediately', async () => {
    await refreshUsdInrRate(source(86.5)); // ~1.8% from 85
    expect(usdInrRate()).toBe(86.5);
    expect(usdInrRateHealth().lastRefusal).toBe('');
  });

  it('a big jump is HELD once, then lands when a second fetch agrees', async () => {
    await refreshUsdInrRate(source(95)); // ~11.8% — too far to take on one observation
    expect(usdInrRate(), 'one observation must not move the billing rate this far').toBe(85);
    expect(usdInrRateHealth().heldCandidate).toBe(95);

    await refreshUsdInrRate(source(95.2)); // an independent fetch agrees (drift allowed, not an exact match)
    expect(usdInrRate(), 'a confirmed move MUST land — a frozen rate is the 2026-09-10 bug').toBe(95.2);
    expect(usdInrRateHealth().heldCandidate).toBeNull();
  });

  it('a one-off glitch inside the band never lands, because the next fetch disagrees', async () => {
    await refreshUsdInrRate(source(42));   // within [30,300] but a 50% jump — held
    expect(usdInrRate()).toBe(85);
    await refreshUsdInrRate(source(85.3)); // reality returns; the glitch is forgotten
    expect(usdInrRate()).toBe(85.3);
    expect(usdInrRateHealth().heldCandidate).toBeNull();
  });

  it('a sustained devaluation lands on the following cycle, not never', async () => {
    // The property the audit cares about: late by one refresh is acceptable, permanent is not.
    for (const r of [70, 69.8, 69.9]) await refreshUsdInrRate(source(r));
    expect(usdInrRate()).toBeLessThan(75);
  });

  it('the jump rule has nothing to compare against on a cold start, so the first reading lands', () => {
    expect(usdInrIsSmallMove(95, 0)).toBe(true);
    expect(usdInrIsSmallMove(95, NaN)).toBe(true);
    expect(usdInrIsSmallMove(95, 85)).toBe(false);
    expect(usdInrIsSmallMove(85 * (1 + USD_INR_JUMP_FRACTION), 85)).toBe(true); // exactly at the allowance
  });
});

describe('THE SIBLING: the ops override is bounded too, but not jump-limited', () => {
  it('a typo is refused and the rate is unchanged', () => {
    setUsdInrRate(85);
    setUsdInrRate(8500);
    expect(usdInrRate(), 'a hand-typed 8500 was as acceptable as a glitched payload before this').toBe(85);
    setUsdInrRate(0);
    expect(usdInrRate()).toBe(85);
  });

  it('a deliberate in-band override works even when it is a big move — a human owns that value', () => {
    setUsdInrRate(85);
    setUsdInrRate(42);
    expect(usdInrRate(), 'making a person confirm their own keystroke twice just teaches them to call it twice').toBe(42);
  });
});

describe('the env fallback goes through the same band', () => {
  it('an out-of-band USD_INR_RATE is refused and 85 is used', async () => {
    // CLAUDE.md's own warning: an env value always beats a code default, so a typo of 850 for 85 would
    // multiply every bill by ten with nothing to catch it.
    const before = process.env.USD_INR_RATE;
    try {
      process.env.USD_INR_RATE = '850';
      vi.resetModules();
      const fresh = await import('../src/server/lib/UsdInrRate');
      expect(fresh.usdInrRate()).toBe(85);

      process.env.USD_INR_RATE = '88.5';
      vi.resetModules();
      const ok = await import('../src/server/lib/UsdInrRate');
      expect(ok.usdInrRate(), 'a plausible env value must still be honoured').toBe(88.5);
    } finally {
      if (before === undefined) delete process.env.USD_INR_RATE; else process.env.USD_INR_RATE = before;
      vi.resetModules();
    }
  });
});
