import { describe, it, expect } from 'vitest';
import { stampLabel, dayLabel, signInMethodWords } from './adminUserDisplay';

const now = Date.parse('2026-09-11T12:00:00Z');

describe('stampLabel — the cell an admin reads before calling an account dormant', () => {
  it('prints how long ago, with the exact date on hover', () => {
    const l = stampLabel(now - 3 * 60 * 60 * 1000, 'auth', now);
    expect(l.text).toBe('3 hours ago');
    expect(l.unread).toBe(false);
    expect(l.title).not.toContain('could not');
  });

  it('🔒 unread is NOT never — the cell says so instead of going blank', () => {
    for (const bad of [null, undefined, 0, -1, NaN]) {
      const l = stampLabel(bad as number | null, 'unread', now);
      expect(l.text).toBe('—');
      expect(l.unread).toBe(true);
      expect(l.title.toLowerCase()).toContain('does not mean never');
    }
  });

  it('says when a join date came from the wallet, because a re-created wallet post-dates the person', () => {
    expect(stampLabel(now - 1000, 'wallet', now).title).toContain('the account may be older');
  });

  it('an auth-sourced date carries no caveat — there is nothing to caveat', () => {
    expect(stampLabel(now - 1000, 'auth', now).title).not.toContain('(');
  });
});

describe('dayLabel', () => {
  it('gives a day for a real timestamp and a dash for nothing', () => {
    expect(dayLabel(now)).not.toBe('—');
    expect(dayLabel(null)).toBe('—');
    expect(dayLabel(0)).toBe('—');
  });
});

describe('signInMethodWords', () => {
  it('translates Firebase provider ids into words a non-technical admin reads', () => {
    expect(signInMethodWords(['google.com', 'phone'])).toBe('Google, Phone (OTP)');
  });

  it('passes an unknown id through — an unrecognised method is still a fact about the account', () => {
    expect(signInMethodWords(['saml.acme'])).toBe('saml.acme');
  });

  it('nothing known is a dash, never an empty string that looks like a layout bug', () => {
    expect(signInMethodWords([])).toBe('—');
    expect(signInMethodWords(null)).toBe('—');
  });
});
