import { describe, it, expect } from 'vitest';
import { generateMobileExport, isValidAppId, deriveAppId } from './MobileExportGenerator';

describe('isValidAppId / deriveAppId', () => {
  it('accepts valid reverse-DNS ids and rejects bad ones', () => {
    expect(isValidAppId('com.acme.shop')).toBe(true);
    expect(isValidAppId('com.navbharat.app')).toBe(true);
    expect(isValidAppId('shop')).toBe(false);            // single segment
    expect(isValidAppId('1com.acme.shop')).toBe(false);  // segment starts with digit
    expect(isValidAppId('com.acme.my-shop')).toBe(false);// hyphen not allowed
    expect(isValidAppId('')).toBe(false);
  });

  it('derives a valid id from an app name (fallback safe)', () => {
    expect(isValidAppId(deriveAppId('My Shop'))).toBe(true);
    expect(deriveAppId('My Shop')).toBe('com.navbharat.myshop');
    // A name that sanitizes to something starting with a digit still yields a valid id.
    expect(isValidAppId(deriveAppId('123'))).toBe(true);
    expect(isValidAppId(deriveAppId('!!!'))).toBe(true);
  });
});

describe('generateMobileExport', () => {
  it('emits a parameterized capacitor.config.ts + README + Capacitor deps', () => {
    const r = generateMobileExport({ appName: 'My Shop', webDir: 'dist' });
    expect(r.appId).toBe('com.navbharat.myshop');
    const cfg = r.files['capacitor.config.ts'];
    expect(cfg).toContain('"com.navbharat.myshop"');
    expect(cfg).toContain('"My Shop"');
    expect(cfg).toContain('"dist"');
    expect(cfg).toContain('@capacitor/cli');
    expect(r.dependencies.map((d) => d.name)).toEqual(['@capacitor/core', '@capacitor/cli', '@capacitor/android']);
    expect(Object.keys(r.scripts)).toContain('cap:sync');
  });

  it('honors an explicit valid appId and defaults webDir to dist', () => {
    const r = generateMobileExport({ appName: 'Thing', appId: 'com.acme.thing' });
    expect(r.appId).toBe('com.acme.thing');
    expect(r.files['capacitor.config.ts']).toContain('"dist"');
  });

  it('replaces an INVALID explicit appId with a derived one (never emits a broken id)', () => {
    const r = generateMobileExport({ appName: 'Thing', appId: 'not valid id' });
    expect(isValidAppId(r.appId)).toBe(true);
    expect(r.appId).toBe('com.navbharat.thing');
  });

  it('is HONEST that a signed binary is not produced here (needs a runner + keystore)', () => {
    const r = generateMobileExport({ appName: 'Thing' });
    expect(r.files['MOBILE_EXPORT.md']).toMatch(/keystore/i);
    expect(r.files['MOBILE_EXPORT.md']).toMatch(/NOT done here|not produced|build runner/i);
    expect(r.instructions).toMatch(/NOT produced here/i);
  });
});
