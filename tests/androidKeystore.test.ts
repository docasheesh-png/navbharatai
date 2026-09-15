/**
 * NAVBHARATAI MAKES THE USER'S UPLOAD KEY — the "auto" half of the admin's option 3 (2026-09-15).
 *
 * Until now a Play Store bundle needed the user to install a JDK, run `keytool` with six flags, base64
 * the file and paste four secrets into GitHub. That wall is where most people stop, and every
 * competitor has the same one.
 *
 * 🔴 THE OLD OBJECTION, AND WHY IT NO LONGER HOLDS. `mobileSetup.ts` says in writing: "A signing key IS
 * the app's permanent identity — if we held it and lost it, their app could never be updated again."
 * True of the APP SIGNING key; false of this one. Every new app on Play uses Play App Signing (required
 * for the .aab format): Google holds the app signing key and the developer holds an UPLOAD key, which
 * Google can RESET. And we do not hold even that — it goes into the user's own repository, and the
 * response is the only moment it exists outside it.
 *
 * ✅ VERIFIED WITH JAVA'S OWN TOOLING, NOT ASSUMED. During development this module's real output was
 * read back by `keytool`:
 *     keytool -list -v        → "Keystore type: PKCS12 … Alias name: upload … Entry type:
 *                                PrivateKeyEntry … SHA256withRSA … 2048-bit RSA … until 2056",
 *                               and the printed SHA-256 matched `sha256Fingerprint` byte for byte.
 *     keytool -importkeystore → exit 0, which only succeeds if the private key genuinely unlocks with
 *                               the password we generated.
 * These tests pin the properties that made those two commands pass; `keytool` itself is not run in CI
 * because a Java toolchain is not a thing this suite should require.
 */

import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import {
  generateUploadKeystore, certificateCommonName, UPLOAD_KEY_ALIAS, KEY_VALIDITY_YEARS,
} from '../src/server/lib/androidKeystore';

/** Generated once: an RSA 2048 keypair per test would make this suite needlessly slow. */
const key = generateUploadKeystore('Shiv Medical Store');
const der = Buffer.from(key.base64, 'base64').toString('binary');
const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), key.storePassword);

describe('the file really is a keystore Java can open', () => {
  it('parses as PKCS#12 with exactly the password we issued', () => {
    expect(p12).toBeTruthy();
    expect(() => forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), 'not-the-password')).toThrow();
  });

  it('holds one private key under the alias Play expects', () => {
    const bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
    expect(bags.length).toBe(1);
    expect(bags[0].attributes?.friendlyName?.[0]).toBe(UPLOAD_KEY_ALIAS);
    expect(bags[0].key).toBeTruthy();
  });

  it('carries a self-signed 2048-bit certificate', () => {
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    expect(certBags.length).toBe(1);
    const cert = certBags[0].cert!;
    expect(cert.subject.getField('CN')?.value).toBe('Shiv Medical Store');
    // Self-signed: an upload certificate has no chain, so issuer and subject are the same name.
    expect(cert.issuer.getField('CN')?.value).toBe(cert.subject.getField('CN')?.value);
    expect((cert.publicKey as forge.pki.rsa.PublicKey).n.bitLength()).toBe(2048);
  });
});

describe('the properties Play will reject the upload without', () => {
  /**
   * 🔴 Play REQUIRES the upload certificate to be valid beyond 22 October 2033 and refuses a shorter
   * one at upload time — by which point the key is already in the user's repository and swapping it is
   * a key reset, not an edit. Cheap to satisfy now, expensive to discover later.
   */
  it('is valid well past Play’s 2033 cut-off', () => {
    const until = new Date(key.validUntil);
    expect(until.getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear() + KEY_VALIDITY_YEARS - 1);
    expect(until.getTime()).toBeGreaterThan(new Date('2034-01-01').getTime());
  });

  /**
   * ⚠️ ONE PASSWORD, TWO SECRETS. A PKCS#12 keystore protects its key entry with the STORE password,
   * so these two must match — different values produce "Cannot recover key" at build time, the exact
   * failure `mobileBuildRepair` already has a classifier for.
   */
  it('uses the same password for the store and the key, because PKCS#12 does', () => {
    expect(key.keyPassword).toBe(key.storePassword);
    expect(key.storePassword.length).toBeGreaterThanOrEqual(24);
  });

  it('prints the fingerprint the way Play’s console does', () => {
    expect(key.sha256Fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

describe('two keys are never the same key', () => {
  it('a second call produces a different password, serial and fingerprint', () => {
    const other = generateUploadKeystore('Shiv Medical Store');
    expect(other.storePassword).not.toBe(key.storePassword);
    expect(other.sha256Fingerprint).not.toBe(key.sha256Fingerprint);
    expect(other.base64).not.toBe(key.base64);
  });
});

describe('an app name is not a distinguished name', () => {
  /**
   * The CN comes from a user's app title, which can contain anything. A comma or a quote inside an
   * X.509 distinguished name is a syntax error, not a character — so this is sanitisation, not taste.
   */
  it('strips the characters that would break the certificate', () => {
    const cn = certificateCommonName('Shiv "Medical", Store <v2>; \\ end');
    expect(cn).not.toMatch(/[,+="<>;\\]/);
    expect(cn).toContain('Shiv');
  });

  it('never yields an empty name — X.509 requires one', () => {
    expect(certificateCommonName('')).toBe('NavBharatAI App');
    expect(certificateCommonName('   ')).toBe('NavBharatAI App');
    expect(certificateCommonName(null)).toBe('NavBharatAI App');
    expect(certificateCommonName(',,,,')).toBe('NavBharatAI App');
  });

  it('bounds the length, and a long name still parses back out of the real file', () => {
    const cn = certificateCommonName('x'.repeat(500));
    expect(cn.length).toBeLessThanOrEqual(64);
    const long = generateUploadKeystore('y'.repeat(500));
    const parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(Buffer.from(long.base64, 'base64').toString('binary')), long.storePassword);
    expect(parsed).toBeTruthy();
  });
});
