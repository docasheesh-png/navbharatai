import { describe, it, expect, afterEach } from 'vitest';
import {
  terminalDailyLimitSeconds,
  decideTerminalAccess,
  accrualSeconds,
  terminalQuotaLine,
  DEFAULT_TERMINAL_DAILY_MINUTES,
  MAX_ACCRUAL_SECONDS,
  terminalRemainingLabel,
} from './terminalQuota';

describe('terminalDailyLimitSeconds', () => {
  afterEach(() => { delete process.env.AGENTV3_TERMINAL_DAILY_MINUTES; });

  it('defaults to the 30 minutes the admin chose', () => {
    expect(DEFAULT_TERMINAL_DAILY_MINUTES).toBe(30);
    expect(terminalDailyLimitSeconds()).toBe(30 * 60);
  });

  it('is env-tunable without a deploy', () => {
    process.env.AGENTV3_TERMINAL_DAILY_MINUTES = '45';
    expect(terminalDailyLimitSeconds()).toBe(45 * 60);
  });

  it('0 disables the terminal entirely (a real off switch, not a nonsense value)', () => {
    process.env.AGENTV3_TERMINAL_DAILY_MINUTES = '0';
    expect(terminalDailyLimitSeconds()).toBe(0);
    expect(decideTerminalAccess({ usedSeconds: 0, limitSeconds: 0 }).allowed).toBe(false);
  });

  // Number('') is 0 — finite and non-negative — so the obvious implementation turns a key set with NO
  // VALUE in Cloud Run into a silent total shutdown of the terminal, with nothing in the logs to say so.
  it('an EMPTY value means unset, not zero', () => {
    process.env.AGENTV3_TERMINAL_DAILY_MINUTES = '';
    expect(terminalDailyLimitSeconds()).toBe(30 * 60);
    process.env.AGENTV3_TERMINAL_DAILY_MINUTES = '   ';
    expect(terminalDailyLimitSeconds()).toBe(30 * 60);
  });

  it('falls back to the default on junk rather than accidentally disabling or unbounding it', () => {
    for (const bad of ['abc', '-5']) {
      process.env.AGENTV3_TERMINAL_DAILY_MINUTES = bad;
      expect(terminalDailyLimitSeconds(), bad).toBe(30 * 60);
    }
  });
});

describe('decideTerminalAccess', () => {
  const LIMIT = 30 * 60;

  it('allows a fresh user, and says nothing (a banner nobody needs is noise)', () => {
    const a = decideTerminalAccess({ usedSeconds: 0, limitSeconds: LIMIT });
    expect(a.allowed).toBe(true);
    expect(a.remainingSeconds).toBe(LIMIT);
    expect(a.message).toBe('');
    expect(a.warn).toBe(false);
  });

  it('warns in the last five minutes — early enough to finish, late enough to be real news', () => {
    const a = decideTerminalAccess({ usedSeconds: LIMIT - 4 * 60, limitSeconds: LIMIT });
    expect(a.allowed).toBe(true);
    expect(a.warn).toBe(true);
    expect(a.message).toMatch(/minute/i);
  });

  // A bare "limit reached" leaves someone staring at a dead button, unsure if it is broken or
  // deliberate — the same dead-end the Apple sign-in bug produced.
  it('refuses with the REASON, when it resets, and reassurance about their work', () => {
    const a = decideTerminalAccess({ usedSeconds: LIMIT, limitSeconds: LIMIT });
    expect(a.allowed).toBe(false);
    expect(a.remainingSeconds).toBe(0);
    expect(a.message).toMatch(/30 free terminal minutes/i);
    expect(a.message).toMatch(/reset tomorrow/i);
    expect(a.message).toMatch(/not affected/i);
  });

  it('stays refused when usage somehow exceeded the limit (never a negative remainder)', () => {
    const a = decideTerminalAccess({ usedSeconds: LIMIT * 10, limitSeconds: LIMIT });
    expect(a.allowed).toBe(false);
    expect(a.remainingSeconds).toBe(0);
  });

  it('the admin free-list is never metered, exactly as everywhere else', () => {
    const a = decideTerminalAccess({ usedSeconds: LIMIT * 100, limitSeconds: LIMIT, unlimited: true });
    expect(a.allowed).toBe(true);
    expect(a.warn).toBe(false);
    expect(a.message).toBe('');
  });

  it('a zero limit refuses honestly rather than pretending the feature is broken', () => {
    expect(decideTerminalAccess({ usedSeconds: 0, limitSeconds: 0 }).message).toMatch(/not available/i);
  });

  it('tolerates junk counters without throwing', () => {
    expect(decideTerminalAccess({ usedSeconds: Number.NaN, limitSeconds: LIMIT }).allowed).toBe(true);
    expect(decideTerminalAccess({ usedSeconds: -50, limitSeconds: LIMIT }).remainingSeconds).toBe(LIMIT);
  });
});

// Charging for wall time nobody spent in a terminal would be exactly the invented measurement the
// billing law forbids.
describe('accrualSeconds — never invent time the user did not spend', () => {
  it('counts a normal tick', () => {
    expect(accrualSeconds(1_000_000, 1_000_000 + 20_000)).toBe(20);
  });

  it('CAPS a huge gap — the server slept, the user was not sitting there for it', () => {
    expect(accrualSeconds(0, 3_600_000)).toBe(MAX_ACCRUAL_SECONDS);
  });

  it('adds ZERO for a backwards or zero gap (a clock change must not credit or charge)', () => {
    expect(accrualSeconds(1_000_000, 999_000)).toBe(0);
    expect(accrualSeconds(1_000_000, 1_000_000)).toBe(0);
  });

  it('adds zero for junk timestamps rather than a wild number', () => {
    expect(accrualSeconds(Number.NaN, Date.now())).toBe(0);
    expect(accrualSeconds(Date.now(), Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('rounds DOWN, so a partial second is never charged twice across ticks', () => {
    expect(accrualSeconds(0, 1_900)).toBe(1);
  });
});

describe('terminalQuotaLine', () => {
  it('is silent while there is plenty left', () => {
    expect(terminalQuotaLine(decideTerminalAccess({ usedSeconds: 60, limitSeconds: 30 * 60 }))).toBe('');
  });

  it('shows the warning near the end', () => {
    expect(terminalQuotaLine(decideTerminalAccess({ usedSeconds: 27 * 60, limitSeconds: 30 * 60 }))).toMatch(/left today/i);
  });

  it('always shows the refusal — a blocked user must never see an empty explanation', () => {
    expect(terminalQuotaLine(decideTerminalAccess({ usedSeconds: 30 * 60, limitSeconds: 30 * 60 }))).not.toBe('');
  });
});

/**
 * The header used to read a hardcoded "Terminal — 30 free minutes a day": true only for someone who
 * had not opened a terminal that day, and silent about what was actually left afterwards.
 */
describe('terminalRemainingLabel — state what is really left', () => {
  it('says the ALLOWANCE only while the server has not reported yet', () => {
    expect(terminalRemainingLabel(null)).toContain('30 free minutes a day');
    expect(terminalRemainingLabel(Number.NaN)).toContain('30 free minutes a day');
  });

  it('states the real remaining minutes once known', () => {
    expect(terminalRemainingLabel(22 * 60)).toBe('Terminal — 22 free minutes left today');
    expect(terminalRemainingLabel(60)).toBe('Terminal — 1 free minute left today');
  });

  it('is honest at the edges instead of rounding to a comfortable number', () => {
    expect(terminalRemainingLabel(0)).toContain('used up');
    expect(terminalRemainingLabel(-5)).toContain('used up');
    expect(terminalRemainingLabel(30)).toContain('under a minute');
  });

  it('an unlimited (admin) account never shows a scary zero', () => {
    expect(terminalRemainingLabel(Number.POSITIVE_INFINITY)).toContain('30 free minutes a day');
  });
});
