import { describe, it, expect } from 'vitest';
import { isValidAppId, deriveAppId, resolveAppId } from './appId';

describe('isValidAppId', () => {
  it('accepts valid reverse-DNS ids and rejects bad ones', () => {
    expect(isValidAppId('com.acme.shop')).toBe(true);
    expect(isValidAppId('com.navbharat.app')).toBe(true);
    expect(isValidAppId('shop')).toBe(false);             // single segment
    expect(isValidAppId('1com.acme.shop')).toBe(false);   // segment starts with digit
    expect(isValidAppId('com.acme.my-shop')).toBe(false); // hyphen not allowed
    expect(isValidAppId('')).toBe(false);
  });
});

describe('deriveAppId', () => {
  it('derives a valid id from an app name, with a safe fallback', () => {
    expect(deriveAppId('My Shop')).toBe('com.navbharat.myshop');
    expect(isValidAppId(deriveAppId('123'))).toBe(true);  // digit-leading slug is prefixed
    expect(isValidAppId(deriveAppId('!!!'))).toBe(true);  // empty slug falls back
  });
});

describe('resolveAppId', () => {
  it('prefers an explicit valid id, else derives, never returns invalid', () => {
    expect(resolveAppId('com.acme.thing', 'Thing')).toBe('com.acme.thing');
    expect(resolveAppId('not valid id', 'Thing')).toBe('com.navbharat.thing');
    expect(resolveAppId(undefined, 'My Shop')).toBe('com.navbharat.myshop');
    expect(isValidAppId(resolveAppId('', ''))).toBe(true);
  });
});
