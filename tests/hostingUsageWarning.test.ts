/**
 * "YOU HAVE USED 80% OF YOUR TRAFFIC" — the warning the plan agreement promises.
 *
 * The tests that earn their keep here are about NOISE and TRUTH, not arithmetic:
 *   • a daily job must not send the same warning every day for three weeks (CLAUDE.md's alert law);
 *   • a user who jumps 40% → 100% overnight must be told they are AT the limit, not at 50%;
 *   • a renewal must re-arm the thresholds with nothing to clean up;
 *   • the two allowances must not silence each other.
 */
import { describe, it, expect } from 'vitest';
import {
  decideUsageWarning, warnKey, USAGE_WARN_PERCENTS,
} from '../src/server/lib/hostingUsageWarning';

const P1 = '2026-09-01';
const P2 = '2026-10-01';
const base = { includedGb: 10, meter: 'backend' as const, periodStart: P1, overageInrPerGb: 20 };

describe('when it speaks', () => {
  it('says nothing below the first threshold — which is most days', () => {
    for (const usedGb of [0, 1, 4.9]) {
      expect(decideUsageWarning({ ...base, usedGb }).warn).toBe(false);
    }
  });

  it('fires at exactly 50%, 80% and 100%, one at a time as usage climbs', () => {
    let warnedFor: Record<string, string> = {};
    const fired: number[] = [];
    for (const usedGb of [5, 6, 8, 9, 10, 12]) {
      const d = decideUsageWarning({ ...base, usedGb, warnedFor });
      warnedFor = d.warnedFor;
      if (d.warn) fired.push(d.percent!);
    }
    expect(fired).toEqual([50, 80, 100]);
  });

  it('🔒 NEVER REPEATS a threshold inside one period — the daily-job noise bug', () => {
    let warnedFor: Record<string, string> = {};
    let sent = 0;
    // Thirty consecutive daily sweeps, all sitting at 85%.
    for (let day = 0; day < 30; day++) {
      const d = decideUsageWarning({ ...base, usedGb: 8.5, warnedFor });
      warnedFor = d.warnedFor;
      if (d.warn) sent++;
    }
    expect(sent).toBe(1);
  });
});

describe('🔴 the LARGEST reached threshold fires — the mirror of the expiry reminders', () => {
  it('a jump from nothing to over the limit says 100%, not 50%', () => {
    const d = decideUsageWarning({ ...base, usedGb: 11 });
    expect(d.percent).toBe(100);
    expect(d.message).toMatch(/used all 10 GB/);
    expect(d.message).not.toMatch(/50%/);
  });

  it('and burns every SMALLER threshold in the same write, so none fires late', () => {
    const d = decideUsageWarning({ ...base, usedGb: 11 });
    for (const p of USAGE_WARN_PERCENTS) {
      expect(d.warnedFor[warnKey('backend', p)]).toBe(P1);
    }
    // A later sweep at 60% — which can happen if a period total is corrected downward — says nothing.
    expect(decideUsageWarning({ ...base, usedGb: 6, warnedFor: d.warnedFor }).warn).toBe(false);
  });

  it('a jump straight to 80% skips the 50% message entirely', () => {
    const d = decideUsageWarning({ ...base, usedGb: 8.5 });
    expect(d.percent).toBe(80);
    expect(d.warnedFor[warnKey('backend', 50)]).toBe(P1);
    expect(d.warnedFor[warnKey('backend', 100)]).toBeUndefined();
  });
});

describe('a new period re-arms everything, with nothing to clean up', () => {
  it('the same thresholds fire again once the period start changes', () => {
    const first = decideUsageWarning({ ...base, usedGb: 11 });
    expect(first.warn).toBe(true);
    const next = decideUsageWarning({ ...base, usedGb: 5, periodStart: P2, warnedFor: first.warnedFor });
    expect(next.warn).toBe(true);
    expect(next.percent).toBe(50);
  });

  it('the stored value IS the period, so a stale key can never read as current', () => {
    const d = decideUsageWarning({ ...base, usedGb: 5 });
    expect(d.warnedFor[warnKey('backend', 50)]).toBe(P1);
  });
});

describe('the two allowances are independent', () => {
  it('a frontend warning does not silence the backend one', () => {
    const fe = decideUsageWarning({ ...base, meter: 'frontend', usedGb: 9 });
    expect(fe.warn).toBe(true);
    const be = decideUsageWarning({ ...base, meter: 'backend', usedGb: 9, warnedFor: fe.warnedFor });
    expect(be.warn).toBe(true);
    expect(be.percent).toBe(80);
  });

  it('each names its own kind of traffic, so the message is actionable', () => {
    expect(decideUsageWarning({ ...base, meter: 'frontend', usedGb: 5 }).message).toMatch(/visitor traffic/);
    expect(decideUsageWarning({ ...base, meter: 'backend', usedGb: 5 }).message).toMatch(/server traffic/);
  });
});

describe('it refuses to say anything it cannot say truthfully', () => {
  it('a zero or missing allowance never warns — there is no percentage of zero', () => {
    for (const includedGb of [0, -5, NaN, Infinity]) {
      expect(decideUsageWarning({ ...base, includedGb, usedGb: 100 }).warn).toBe(false);
    }
  });

  it('an unusable usage figure never warns', () => {
    for (const usedGb of [NaN, -1, Infinity]) {
      expect(decideUsageWarning({ ...base, usedGb }).warn).toBe(false);
    }
  });

  it('no period means no warning — there is nothing to key the dedupe on', () => {
    expect(decideUsageWarning({ ...base, usedGb: 11, periodStart: '' }).warn).toBe(false);
  });

  it('the returned map is a COPY — a refusal must not mutate the caller\'s record', () => {
    const warnedFor = { [warnKey('backend', 50)]: P1 };
    const d = decideUsageWarning({ ...base, usedGb: 5, warnedFor });
    expect(d.warn).toBe(false);
    expect(warnedFor).toEqual({ [warnKey('backend', 50)]: P1 });
    d.warnedFor[warnKey('backend', 80)] = 'x';
    expect(warnedFor[warnKey('backend', 80)]).toBeUndefined();
  });
});

describe('what the message actually says', () => {
  it('the 100% message quotes the REAL overage rate, and reassures about the apps', () => {
    const d = decideUsageWarning({ ...base, usedGb: 10 });
    expect(d.message).toContain('₹20 per GB');
    expect(d.message).toMatch(/stay online/);
  });

  it('with no rate known it states the fact and invents no number', () => {
    const d = decideUsageWarning({ ...base, usedGb: 10, overageInrPerGb: undefined });
    expect(d.message).not.toMatch(/₹/);
    expect(d.message).toMatch(/used all 10 GB/);
  });

  it('a below-limit message says there is nothing to do, so it does not read as an alarm', () => {
    expect(decideUsageWarning({ ...base, usedGb: 5 }).message).toMatch(/Nothing to do/);
  });

  it('🔒 no message names a vendor — the White-Label Law reaches every user-facing string', () => {
    const forbidden = /google|cloud run|firebase|artifact|gcp|amazon|aws|cloudflare/i;
    for (const meter of ['frontend', 'backend'] as const) {
      for (const usedGb of [5, 8, 12]) {
        const d = decideUsageWarning({ ...base, meter, usedGb });
        if (d.warn) expect(d.message).not.toMatch(forbidden);
      }
    }
  });
});
