/**
 * Play Billing exists on ANDROID, not on "native" (admin Monitor capture, 2026-09-14).
 *
 * The gate used to be `Capacitor.isNativePlatform()`, which is true on iOS too — so every iPhone launch
 * registered the Android-only plugin and produced
 *     "PlayBilling" plugin is not implemented on ios @ unhandled promise
 * These tests state the rule: the plugin is touched on Android and nowhere else.
 */
import { describe, it, expect } from 'vitest';
import { isPlayBillingPlatform } from '../src/lib/playBillingNative';

describe('isPlayBillingPlatform', () => {
  it('is Android and only Android', () => {
    expect(isPlayBillingPlatform('android')).toBe(true);
    expect(isPlayBillingPlatform('ANDROID')).toBe(true);
    expect(isPlayBillingPlatform(' android ')).toBe(true);
  });

  it('iOS is native and still NOT a Play Billing platform — the exact bug', () => {
    expect(isPlayBillingPlatform('ios')).toBe(false);
  });

  it('web and unknown platforms never touch the plugin', () => {
    expect(isPlayBillingPlatform('web')).toBe(false);
    expect(isPlayBillingPlatform('')).toBe(false);
    expect(isPlayBillingPlatform(null)).toBe(false);
    expect(isPlayBillingPlatform(undefined)).toBe(false);
  });

  it('the source gates on getPlatform(), not on isNativePlatform() — the class, not the instance', async () => {
    const src = await import('node:fs/promises').then((fs) => fs.readFile('src/lib/playBillingNative.ts', 'utf8'));
    expect(src).toContain('isPlayBillingPlatform(Capacitor.getPlatform())');
    expect(src).not.toMatch(/isNativePlatform\(\)\s*!==\s*true\)\s*return null/);
  });
});
