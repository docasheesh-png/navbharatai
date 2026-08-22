import { describe, it, expect } from 'vitest';
import {
  markRedirectStarted, readRedirectMarker, clearRedirectMarker, redirectReturnVerdict,
  redirectLostMessage, providerLabel, MARKER_TTL_MS, type MarkerStore,
} from './redirectSignInMarker';

/**
 * ADMIN, 2026-08-22: "signin with apple → apple login page → logins successfully → return to
 * navbharatai (still logged out)" — repeating identically, forever.
 *
 * 🔒 THE LOOP WAS SILENT BY CONSTRUCTION, and that is what made it unfixable from outside. On return
 * `getRedirectResult` resolves null and the SDK reports `auth/no-auth-event` — which is ALSO exactly
 * what an ordinary page load reports on every visit when nothing was pending. The app could not tell
 * "just came back from Apple with nothing" apart from "opened the homepage", so it correctly said
 * nothing about both. One marker separates them, because we wrote down that we sent them.
 */
const store = (initial: Record<string, string> = {}): MarkerStore & { data: Record<string, string> } => ({
  data: { ...initial },
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = v; },
  removeItem(k) { delete this.data[k]; },
});

const NOW = 1_700_000_000_000;

describe('the marker', () => {
  it('round-trips the provider and the time', () => {
    const s = store();
    markRedirectStarted(s, 'apple.com', NOW);
    expect(readRedirectMarker(s, NOW + 1000)).toEqual({ provider: 'apple.com', at: NOW });
  });

  it('🔒 EXPIRES — an hour-old marker is litter, not a return', () => {
    // Reporting litter as a failure would put an error in front of someone who never tried to sign in.
    const s = store();
    markRedirectStarted(s, 'apple.com', NOW);
    expect(readRedirectMarker(s, NOW + MARKER_TTL_MS + 1)).toBeNull();
    expect(readRedirectMarker(s, NOW + MARKER_TTL_MS - 1)).not.toBeNull();
  });

  it('a clock that moved backwards is treated as no marker, not as a fresh one', () => {
    const s = store();
    markRedirectStarted(s, 'apple.com', NOW);
    expect(readRedirectMarker(s, NOW - 5000)).toBeNull();
  });

  it('corrupt or absent storage never throws', () => {
    expect(readRedirectMarker(store({ 'nbai:redirect-signin': 'not json' }), NOW)).toBeNull();
    expect(readRedirectMarker(store(), NOW)).toBeNull();
    expect(readRedirectMarker(null, NOW)).toBeNull();
    expect(() => markRedirectStarted(null, 'apple.com', NOW)).not.toThrow();
    expect(() => clearRedirectMarker(null)).not.toThrow();
  });

  it('clearing it means the verdict can never fire twice', () => {
    const s = store();
    markRedirectStarted(s, 'apple.com', NOW);
    clearRedirectMarker(s);
    expect(readRedirectMarker(s, NOW)).toBeNull();
  });
});

describe('redirectReturnVerdict', () => {
  const marker = { provider: 'apple.com', at: NOW };

  it('a delivered user is success, whatever else is true', () => {
    expect(redirectReturnVerdict({ marker, resultUser: {}, currentUser: null })).toBe('signed-in');
    expect(redirectReturnVerdict({ marker: null, resultUser: {}, currentUser: null })).toBe('signed-in');
  });

  it('🔒 RESCUE: null result but a live session is a race, NOT a failure', () => {
    // This codebase has already hit the same SDK race twice on the popup path. Telling a signed-in
    // user their sign-in failed would be the worst possible answer, and checking costs one property read.
    expect(redirectReturnVerdict({ marker, resultUser: null, currentUser: {} })).toBe('recovered');
  });

  it('THE REPORTED BUG: we sent them, and nothing came back', () => {
    expect(redirectReturnVerdict({ marker, resultUser: null, currentUser: null })).toBe('lost');
  });

  it('🔒 NO marker ⇒ NONE — an ordinary page load must stay silent', () => {
    // Being unable to prove a sign-in was pending is not evidence that one failed. Without this, every
    // visitor whose browser blocks session storage would meet a red banner on the homepage.
    expect(redirectReturnVerdict({ marker: null, resultUser: null, currentUser: null })).toBe('none');
  });
});

describe('the message', () => {
  it('agrees with what the user just watched happen', () => {
    // They SAW Apple accept it. A message that implies otherwise destroys trust in the whole message.
    const m = redirectLostMessage('apple.com');
    expect(m).toContain('Apple accepted your sign-in');
    expect(m).toContain('did not keep it');
  });

  it('gives the two things that actually resolve the common browser causes', () => {
    const m = redirectLostMessage('apple.com');
    expect(m).toContain('private browsing');
    expect(m).toContain('site data');
  });

  it('never prints a raw provider id at a user', () => {
    expect(providerLabel('apple.com')).toBe('Apple');
    expect(providerLabel('google.com')).toBe('Google');
    expect(providerLabel('weird.provider')).toBe('The sign-in provider');
    expect(redirectLostMessage(null)).not.toContain('null');
  });
});
