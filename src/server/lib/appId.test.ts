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

  it('rejects a Java reserved-word segment even though it is syntactically valid reverse-DNS (G8)', () => {
    expect(isValidAppId('com.new.shop')).toBe(false);      // "new" is a Java keyword
    expect(isValidAppId('com.acme.class')).toBe(false);    // "class"
    expect(isValidAppId('com.native.app')).toBe(false);    // "native"
    expect(isValidAppId('com.acme.true')).toBe(false);     // literal
    expect(isValidAppId('com.acme.package')).toBe(false);  // "package"
    expect(isValidAppId('com.acme.shopping')).toBe(true);  // "shopping" merely CONTAINS "shop" — fine
  });
});

describe('deriveAppId', () => {
  it('derives a valid id from an app name, with a safe fallback', () => {
    expect(deriveAppId('My Shop')).toBe('com.navbharat.myshop');
    expect(isValidAppId(deriveAppId('123'))).toBe(true);  // digit-leading slug is prefixed
    expect(isValidAppId(deriveAppId('!!!'))).toBe(true);  // empty slug falls back
  });

  it('never derives a reserved-word segment from an app name like "New" or "Class" (G8)', () => {
    expect(deriveAppId('New')).toBe('com.navbharat.newx');
    expect(deriveAppId('Class')).toBe('com.navbharat.classx');
    expect(isValidAppId(deriveAppId('New'))).toBe(true);
    expect(isValidAppId(deriveAppId('Final'))).toBe(true);
  });
});

describe('resolveAppId', () => {
  it('prefers an explicit valid id, else derives, never returns invalid', () => {
    expect(resolveAppId('com.acme.thing', 'Thing')).toBe('com.acme.thing');
    expect(resolveAppId('not valid id', 'Thing')).toBe('com.navbharat.thing');
    expect(resolveAppId(undefined, 'My Shop')).toBe('com.navbharat.myshop');
    expect(isValidAppId(resolveAppId('', ''))).toBe(true);
  });

  it('REPAIRS an explicit reverse-DNS id blocked only by a reserved segment, keeping the org prefix (G8)', () => {
    expect(resolveAppId('com.new.shop', 'My Shop')).toBe('com.newx.shop');       // org prefix kept
    expect(resolveAppId('com.acme.class', 'Thing')).toBe('com.acme.classx');
    // a genuinely malformed id still falls back to a derived one
    expect(resolveAppId('not.a valid.id', 'My Shop')).toBe('com.navbharat.myshop');
    // every repaired/derived result is valid by construction
    expect(isValidAppId(resolveAppId('com.new.private', 'X'))).toBe(true);
  });
});
