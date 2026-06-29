import { describe, it, expect } from 'vitest';
import { consentAllowsAnalytics, shouldShowBanner, CONSENT_KEY, CONSENT_EVENT } from '../src/lib/consent';

/** P-UX.1 — consent decision logic (pure; no DOM needed). */

describe('consent — consentAllowsAnalytics', () => {
  it('only "granted" enables analytics', () => {
    expect(consentAllowsAnalytics('granted')).toBe(true);
    expect(consentAllowsAnalytics('denied')).toBe(false);
    expect(consentAllowsAnalytics(null)).toBe(false);
    expect(consentAllowsAnalytics(undefined)).toBe(false);
    expect(consentAllowsAnalytics('')).toBe(false);
    expect(consentAllowsAnalytics('yes')).toBe(false);
  });
});

describe('consent — shouldShowBanner', () => {
  it('shows only until a valid choice is recorded', () => {
    expect(shouldShowBanner(null)).toBe(true);
    expect(shouldShowBanner(undefined)).toBe(true);
    expect(shouldShowBanner('')).toBe(true);
    expect(shouldShowBanner('garbage')).toBe(true);
    expect(shouldShowBanner('granted')).toBe(false);
    expect(shouldShowBanner('denied')).toBe(false);
  });
});

describe('consent — constants', () => {
  it('exposes stable storage key + event name', () => {
    expect(CONSENT_KEY).toBe('navbharat_consent');
    expect(CONSENT_EVENT).toBe('nb-consent-change');
  });
});
