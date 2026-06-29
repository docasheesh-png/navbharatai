// P-UX.1 — Privacy / analytics consent (EU GDPR + India DPDP).
//
// Non-essential telemetry (product analytics events and Core Web Vitals) must NOT fire until the
// user has actively consented. This module is the single source of truth for that decision: the
// banner writes the choice, and trackEvent() / the web-vitals observers read it before sending
// anything. Operational crash/error logging is treated as essential (legitimate-interest, no PII)
// and is intentionally NOT gated here.
//
// The pure decision helpers (consentAllowsAnalytics / shouldShowBanner) take the raw stored value
// so they are unit-testable without a DOM; the thin localStorage wrappers handle the I/O.

export type ConsentValue = 'granted' | 'denied';

/** localStorage key holding the user's choice ('granted' | 'denied'); absent until they decide. */
export const CONSENT_KEY = 'navbharat_consent';
/** Window event dispatched when the choice changes, so late-initialized telemetry can start. */
export const CONSENT_EVENT = 'nb-consent-change';

/** Pure: may non-essential analytics fire, given the raw stored value? Only on explicit grant. */
export function consentAllowsAnalytics(raw: string | null | undefined): boolean {
  return raw === 'granted';
}

/** Pure: should the consent banner be shown? Only while no valid choice has been recorded yet. */
export function shouldShowBanner(raw: string | null | undefined): boolean {
  return raw !== 'granted' && raw !== 'denied';
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

/** The user's recorded choice, or null if they have not decided. */
export function getConsent(): ConsentValue | null {
  const raw = readRaw();
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

/** True only when the user has explicitly granted analytics consent. */
export function hasAnalyticsConsent(): boolean {
  return consentAllowsAnalytics(readRaw());
}

/** True while no choice has been made yet (banner should be visible). */
export function needsConsentDecision(): boolean {
  return shouldShowBanner(readRaw());
}

/** Persist the user's choice and notify listeners (so late-initialized telemetry can start). */
export function setConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* storage unavailable — the in-memory dispatch below still drives this session */
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
  } catch {
    /* no window (SSR/tests) — nothing to notify */
  }
}
