import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createRateLimitCooldowns } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. A bench that could never get ahead of the failure it
 * exists to prevent.
 *
 * The provider timeline, from the report:
 *
 *     236s  Provider KIMI failed — "Request timed out."
 *     356s  Provider KIMI failed — "Request timed out."      ← +120s
 *     467s  Provider KIMI failed — "Request timed out."      ← +111s
 *     587s  Provider KIMI failed — "Request timed out."      ← +120s
 *
 * A failure every two minutes, all build long. The arithmetic behind it:
 *
 *     KIMI's request timeout   120,000 ms   (the admin's own 2026-07-13 decision, "kimi ka time badhao")
 *     the cooldown's base bench 60,000 ms
 *
 * A provider whose failure costs TWO MINUTES was benched for ONE. The bench expires, the next call burns
 * the full timeout again, and for those 120 seconds nothing is benched at all — so the platform spends
 * more time inside doomed calls than outside them, by construction. No amount of escalation tuning fixes
 * that; the base relationship is upside down.
 *
 * The floor is MEASURED from the call, not read from config, so it is right for whatever timeout each
 * provider runs under and stays right when those are retuned.
 */

describe('a bench is never shorter than the failure that armed it', () => {
  const at = (t: number) => t;

  it('the report\'s exact numbers: a 120s timeout benches for 120s, not 60', () => {
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    c.strike('KIMI', at(236_000), 120_000);
    expect(c.until('KIMI')).toBe(236_000 + 120_000);
  });

  it('without the floor it would have re-armed at 60s — the drip that actually happened', () => {
    // The same call with no measured cost reproduces the old behaviour exactly, which is what makes
    // this a floor and not a change of policy.
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    c.strike('KIMI', at(236_000));
    expect(c.until('KIMI')).toBe(236_000 + 60_000);
  });

  it('a CHEAP failure keeps the normal short bench — this is a floor, not an inflation', () => {
    /**
     * A 429 that comes back in 300ms costs almost nothing, and benching it for two minutes would
     * needlessly abandon a provider that is probably fine. Only an expensive failure earns a long bench.
     */
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    c.strike('GLM', at(1_000), 300);
    expect(c.until('GLM')).toBe(1_000 + 60_000);
  });

  it('escalation still runs on top of it', () => {
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    c.strike('KIMI', at(0), 300);                 // episode 1 → 60s → until 60_000
    expect(c.until('KIMI')).toBe(60_000);
    c.strike('KIMI', at(100_000), 300);           // linked (within 2× base of expiry) → episode 2 → 120s
    expect(c.until('KIMI')).toBe(100_000 + 120_000);
  });

  it('the floor wins over escalation when the failure cost more', () => {
    // capMs bounds how far ESCALATION may run; a single failure that genuinely cost more than the cap
    // is not escalation, it is the price already paid. Benching for less guarantees paying it again.
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 }, 90_000);
    c.strike('KIMI', at(0), 300_000);
    expect(c.until('KIMI')).toBe(300_000);
  });

  it('a straggler that cost MORE than the remaining bench extends it', () => {
    /**
     * The fast lane fires concurrent turns, so a second 120s timeout can land while the first bench is
     * still running with 10 seconds left. Keeping the shorter window would let the very next call burn
     * another full timeout — the same defect, one layer in.
     */
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    c.strike('KIMI', at(0), 60_000);              // bench until 60_000
    c.strike('KIMI', at(50_000), 120_000);        // lands mid-bench, cost 120s → must reach 170_000
    expect(c.until('KIMI')).toBe(170_000);
  });

  it('a straggler that cost LESS never shortens an active bench', () => {
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    c.strike('KIMI', at(0), 120_000);             // bench until 120_000
    c.strike('KIMI', at(10_000), 500);            // cheap straggler
    expect(c.until('KIMI')).toBe(120_000);        // untouched
  });

  it('junk costs are ignored, never subtracted or trusted', () => {
    for (const bad of [0, -1, NaN, Infinity, undefined]) {
      const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
      c.strike('KIMI', at(1_000), bad as number);
      expect(c.until('KIMI'), String(bad)).toBe(61_000);
    }
  });

  it('a success still clears everything', () => {
    const c = createRateLimitCooldowns(60_000, 1, { breakerTripAfter: 0 });
    c.strike('KIMI', at(0), 120_000);
    c.clear('KIMI');
    expect(c.until('KIMI')).toBe(0);
  });

  it('the cooldown being switched OFF still switches it off', () => {
    const c = createRateLimitCooldowns(0, 1, { breakerTripAfter: 0 });
    c.strike('KIMI', at(0), 120_000);
    expect(c.until('KIMI')).toBe(0);
  });
});

describe('WIRING — the cost is measured from the call that paid it', () => {
  const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/providers/MultiProviderTurnRunner.ts'), 'utf8');

  it('each attempt is timed', () => {
    expect(src).toContain('const attemptStartedAt = now();');
    expect(src).toContain('const costMs = Math.max(0, now() - attemptStartedAt);');
  });

  it('the measured cost reaches BOTH the per-key and the pool bench', () => {
    // A pool bench shorter than the timeout would let the next KEY of the same saturated service burn
    // a full timeout window — the identical defect, one level up.
    expect(src).toContain('cooldowns.strike(name, now(), costMs);');
    expect(src).toContain('cooldowns.strike(`pool:${reportName}`, now(), costMs);');
  });

  it('it applies to the TIMEOUT class, which is the expensive one', () => {
    const at = src.indexOf('const costMs = Math.max(0, now() - attemptStartedAt);');
    expect(src.lastIndexOf('isTimeoutProviderError(err)', at)).toBeGreaterThan(-1);
  });

  it('a 429 keeps the plain strike — a fast rejection has no cost to cover', () => {
    const at = src.indexOf('isRateLimitProviderError(err)');
    const seg = src.slice(at, at + 900);
    expect(seg).toContain('cooldowns.strike(name, now());');
    expect(seg).not.toContain('costMs');
  });
});
