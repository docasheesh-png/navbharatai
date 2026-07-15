import { describe, it, expect } from 'vitest';
import { decideProfessionalAccess } from './access';
import { computeNewExpiry, isPassActive } from './ProfessionalPassStore';
import { istDayKey } from './ProfessionalUsageStore';

const base = { enabled: true, signedIn: true, isFreeListed: false, hasActivePass: false, usedToday: 0, freeDailyLimit: 10 };

describe('decideProfessionalAccess', () => {
  it('flag OFF → always allow, count nothing (today\'s behaviour), even anonymous', () => {
    const d = decideProfessionalAccess({ ...base, enabled: false, signedIn: false });
    expect(d).toEqual({ action: 'allow', reason: 'disabled', countsAgainstFree: false, remainingFree: 0 });
  });

  it('free-list → unlimited, never counted', () => {
    const d = decideProfessionalAccess({ ...base, isFreeListed: true });
    expect(d.action).toBe('allow');
    expect(d.reason).toBe('free-list');
    expect(d.countsAgainstFree).toBe(false);
  });

  it('anonymous (gating on) → blocked, login required', () => {
    const d = decideProfessionalAccess({ ...base, signedIn: false });
    expect(d.action).toBe('block');
    expect(d.reason).toBe('login-required');
  });

  it('active pass → unlimited, never counted', () => {
    const d = decideProfessionalAccess({ ...base, hasActivePass: true, usedToday: 999 });
    expect(d.action).toBe('allow');
    expect(d.reason).toBe('pass');
    expect(d.countsAgainstFree).toBe(false);
  });

  it('within free quota → allow and count this turn', () => {
    const d = decideProfessionalAccess({ ...base, usedToday: 3, freeDailyLimit: 10 });
    expect(d.action).toBe('allow');
    expect(d.reason).toBe('within-free-quota');
    expect(d.countsAgainstFree).toBe(true);
    expect(d.remainingFree).toBe(6); // 10 - 3 - 1
  });

  it('the LAST free message is allowed (used 9 of 10) and leaves 0', () => {
    const d = decideProfessionalAccess({ ...base, usedToday: 9, freeDailyLimit: 10 });
    expect(d.action).toBe('allow');
    expect(d.remainingFree).toBe(0);
  });

  it('quota exhausted (used 10 of 10) → blocked with paywall reason', () => {
    const d = decideProfessionalAccess({ ...base, usedToday: 10, freeDailyLimit: 10 });
    expect(d.action).toBe('block');
    expect(d.reason).toBe('free-quota-exhausted');
    expect(d.countsAgainstFree).toBe(false);
  });

  it('a zero free limit is day-1 paid: first message blocks without a pass', () => {
    const d = decideProfessionalAccess({ ...base, usedToday: 0, freeDailyLimit: 0 });
    expect(d.action).toBe('block');
    expect(d.reason).toBe('free-quota-exhausted');
  });
});

describe('pass expiry math', () => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0); // 2026-07-15T12:00:00Z

  it('grants from now when there is no active pass', () => {
    const exp = computeNewExpiry(null, now, 30);
    expect(Date.parse(exp)).toBe(now + 30 * 86400000);
  });

  it('renewal STACKS on remaining time (no lost days)', () => {
    const current = new Date(now + 5 * 86400000).toISOString(); // 5 days left
    const exp = computeNewExpiry(current, now, 30);
    expect(Date.parse(exp)).toBe(now + 35 * 86400000);
  });

  it('an expired pass grants from now, not from the past', () => {
    const current = new Date(now - 10 * 86400000).toISOString(); // expired 10 days ago
    const exp = computeNewExpiry(current, now, 30);
    expect(Date.parse(exp)).toBe(now + 30 * 86400000);
  });

  it('isPassActive is true only for a future expiry', () => {
    expect(isPassActive(new Date(now + 1000).toISOString(), now)).toBe(true);
    expect(isPassActive(new Date(now - 1000).toISOString(), now)).toBe(false);
    expect(isPassActive(null, now)).toBe(false);
    expect(isPassActive('garbage', now)).toBe(false);
  });
});

describe('istDayKey', () => {
  it('is the Indian calendar day (IST), not UTC', () => {
    // 2026-07-15T20:00:00Z is 2026-07-16T01:30 IST → the IST day has already rolled over.
    expect(istDayKey(Date.UTC(2026, 6, 15, 20, 0, 0))).toBe('2026-07-16');
    // 2026-07-15T10:00:00Z is 2026-07-15T15:30 IST → still the 15th.
    expect(istDayKey(Date.UTC(2026, 6, 15, 10, 0, 0))).toBe('2026-07-15');
  });
});
