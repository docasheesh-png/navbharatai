/**
 * WHICH PARTS OF THE APP THE LOCK COVERS — the rules, in the module both sides import.
 *
 * Small file, big consequences. Every case here is a way the App Lock could quietly stop being a lock:
 * the mandatory area being removable, an unknown id stored as if something checked it, a corrupt record
 * reading as "everything locked" and shutting the owner out, or the two sides of the app disagreeing
 * about whether locking Wallet & Billing covers the recharge tab inside it.
 */
import { describe, it, expect } from 'vitest';
import {
  APP_LOCK_AREAS, APP_LOCK_AREA_IDS, MANDATORY_LOCK_AREAS, isAppLockArea, areaLabel, areaSpec,
  normaliseLockedAreas, isAreaLocked, coveredByBilling, effectiveLockedAreas,
} from '../src/lib/appLockAreas';

describe('the list the admin asked for', () => {
  it('holds exactly the seven areas, and API keys is the only mandatory one', () => {
    // Admin 2026-09-13: "1- api keys and secret (non removal ✅) 2- user chahe to (on/off) default off:
    // navbharatai pro, billings, subscription, wallet recharge, code studio, settings".
    expect([...APP_LOCK_AREA_IDS]).toEqual([
      'api_keys', 'billing', 'subscription', 'wallet_recharge', 'pro_builder', 'code_studio', 'settings',
    ]);
    expect([...MANDATORY_LOCK_AREAS]).toEqual(['api_keys']);
  });

  it('every area has a label and a hint a non-technical user can read', () => {
    for (const spec of APP_LOCK_AREAS) {
      expect(spec.label.length, spec.id).toBeGreaterThan(2);
      expect(spec.hint.length, spec.id).toBeGreaterThan(20);
      // The label is what the user reads, so it must never be the code's name for the thing.
      expect(spec.label, spec.id).not.toContain('_');
    }
    expect(areaLabel('code_studio')).toBe('Code Studio');
    expect(areaSpec('nope' as never)).toBeNull();
  });

  it('recognises its own ids and nothing else', () => {
    expect(isAppLockArea('settings')).toBe(true);
    for (const bad of ['', 'Settings', 'secrets', 42, null, undefined, {}]) {
      expect(isAppLockArea(bad), String(bad)).toBe(false);
    }
  });
});

describe('🔒 the default, and what a corrupt record must degrade to', () => {
  it('nothing stored ⇒ only the mandatory area — the rest are OFF by default', () => {
    // "user chahe to (on/off) default off" — so a brand-new account has one lock, not seven.
    expect(normaliseLockedAreas(undefined)).toEqual(['api_keys']);
    expect(normaliseLockedAreas([])).toEqual(['api_keys']);
  });

  it('🔴 junk degrades to the DEFAULT, never to "everything locked"', () => {
    // The dangerous direction is the other one: a corrupt record that read as all-locked would shut a
    // user out of their own Settings, Billing and builder with no way to reach the toggles.
    for (const junk of [null, 0, 'settings', { settings: true }, [['settings']], NaN]) {
      expect(normaliseLockedAreas(junk), JSON.stringify(junk)).toEqual(['api_keys']);
    }
  });

  it('🔒 the API-keys lock cannot be removed, by any input', () => {
    expect(normaliseLockedAreas(['settings'])).toContain('api_keys');
    expect(normaliseLockedAreas(['billing', 'code_studio'])).toContain('api_keys');
    expect(isAreaLocked([], 'api_keys')).toBe(true);
    expect(isAreaLocked(['billing'], 'api_keys')).toBe(true);
  });

  it('drops unknown ids instead of storing them', () => {
    expect(normaliseLockedAreas(['billing', 'made_up', '', 7, null])).toEqual(['api_keys', 'billing']);
  });

  it('returns the canonical order and deduplicates, whatever order it was given', () => {
    const a = normaliseLockedAreas(['settings', 'billing', 'settings', 'api_keys']);
    const b = normaliseLockedAreas(['billing', 'settings']);
    expect(a).toEqual(b);
    expect(a).toEqual(['api_keys', 'billing', 'settings']);
  });
});

describe('locking the whole Wallet & Billing screen covers what is inside it', () => {
  it('names the two areas that live inside that one screen', () => {
    expect(coveredByBilling('subscription')).toBe(true);
    expect(coveredByBilling('wallet_recharge')).toBe(true);
    for (const outside of ['api_keys', 'pro_builder', 'code_studio', 'settings', 'billing'] as const) {
      expect(coveredByBilling(outside), outside).toBe(false);
    }
  });

  it('🔴 a user who locked Billing has locked the plans card and the recharge tab too', () => {
    // They are not separate screens in this app — both render inside Wallet & Billing. A gate that ignored
    // this would leave the recharge tab open on a screen the user believed they had locked.
    const eff = effectiveLockedAreas(['billing']);
    expect(eff).toContain('subscription');
    expect(eff).toContain('wallet_recharge');
  });

  it('but locking only the recharge tab does NOT lock the whole screen', () => {
    // Containment runs one way. The user can still read their balance and history.
    const eff = effectiveLockedAreas(['wallet_recharge']);
    expect(eff).toContain('wallet_recharge');
    expect(eff).not.toContain('billing');
    expect(eff).not.toContain('subscription');
  });

  it('is idempotent and still canonical', () => {
    expect(effectiveLockedAreas(effectiveLockedAreas(['billing']))).toEqual(effectiveLockedAreas(['billing']));
    expect(effectiveLockedAreas(['settings', 'billing'])).toEqual(
      ['api_keys', 'billing', 'subscription', 'wallet_recharge', 'settings'],
    );
  });
});
