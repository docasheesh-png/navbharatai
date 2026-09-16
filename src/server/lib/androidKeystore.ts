// GENERATE THE USER'S ANDROID UPLOAD KEY — so "Google Play bundle" is one press, not a Java tutorial.
//
// ADMIN 2026-09-15 ("pehle warning, phir auto"). The warning half (signingReadiness.ts) stops a build
// that could not have succeeded. This half removes the reason it could not: until now a user had to
// install a JDK, run `keytool` with six flags, base64 the file, and paste four secrets into GitHub
// before a Play bundle could be signed even once. Every competitor has that same wall; it is where
// most people stop.
//
// 🔴 WHAT THIS KEY IS, AND WHY GENERATING IT IS SAFE NOW WHEN IT WOULD NOT HAVE BEEN IN 2019.
// `mobileSetup.ts` states the old objection in writing: "A signing key IS the app's permanent identity
// — if we held it and lost it, their app could never be updated again." That is TRUE of the APP
// SIGNING key and FALSE of this one. Every new app on Play uses Play App Signing (mandatory for the
// .aab format): Google holds the app signing key, and what the developer holds is an UPLOAD key, which
// Google can RESET if it is lost. So the worst case here is a support request, not a dead app.
//
// 🔒 AND WE DO NOT KEEP IT. The key is written straight into the user's OWN repository as encrypted
// GitHub Actions secrets and handed to them once to download. NavBharatAI stores no copy — not in the
// vault, not in Firestore, not in a log. The fingerprint below is recorded instead: it identifies the
// key for Play's console and reveals nothing.
//
// PKCS#12, NOT JKS — and this was verified rather than assumed. Java 9+ reads PKCS12 natively (it is
// Java's own default keystore format since then) and AGP's `signingConfigs` infers the type from the
// file. Generated here with node-forge, then read back with Java's REAL `keytool` during development:
//   keytool -list -v         -> "Keystore type: PKCS12 ... Alias name: upload ... PrivateKeyEntry ...
//                               SHA256withRSA ... 2048-bit RSA ... valid until 2056"
//   keytool -importkeystore  -> exit 0, which only succeeds if the private key genuinely unlocks.
//
// ⚠️ ONE PASSWORD, TWO SECRETS, ON PURPOSE. A PKCS#12 keystore protects its key entry with the store
// password, so `ANDROID_KEY_PASSWORD` must equal `ANDROID_KEYSTORE_PASSWORD`. Both are still written,
// because the generated workflow reads both names; giving them different values would produce
// "Cannot recover key" at build time — the exact failure `mobileBuildRepair` already classifies.

import forge from 'node-forge';
import { generateKeyPairSync, randomBytes } from 'crypto';

/** Play's convention for the key that signs uploads. Also the PKCS#12 friendly name = the alias. */
export const UPLOAD_KEY_ALIAS = 'upload';

/**
 * Play REQUIRES an upload certificate valid beyond 22 October 2033, and rejects a short one at upload
 * — a rule that costs nothing to satisfy now and cannot be fixed later without a key reset. 30 years.
 */
export const KEY_VALIDITY_YEARS = 30;

export interface GeneratedKeystore {
  /** The .keystore file itself, base64 — exactly what `ANDROID_KEYSTORE_BASE64` must contain. */
  base64: string;
  storePassword: string;
  keyAlias: string;
  /** Equal to `storePassword` — see the PKCS#12 note above. */
  keyPassword: string;
  /** `AB:CD:...` — safe to show, store and paste into Play's console. Never identifies the key material. */
  sha256Fingerprint: string;
  validUntil: string;
}

/**
 * A password nobody has to remember, so it may as well be unguessable: 24 random bytes, base64url, no
 * characters that a shell, a YAML file or a Gradle property would treat specially.
 */
function strongPassword(): string {
  return randomBytes(24).toString('base64url');
}

/** X.509 wants a non-empty CN with no control characters; a user's app name is neither guaranteed. */
export function certificateCommonName(appName: string | undefined | null): string {
  const clean = String(appName ?? '')
    .replace(CONTROL_OR_DN_SPECIAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return clean || 'NavBharatAI App';
}

/** Control characters and the RFC 4514 specials that would otherwise break the distinguished name. */
const CONTROL_OR_DN_SPECIAL = new RegExp('[\\u0000-\\u001f,+="<>;\\\\]', 'g');

/** `4A:57:75:...`, the form Play's console and `keytool` both print. */
function fingerprintOf(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const hex = forge.md.sha256.create().update(der).digest().toHex().toUpperCase();
  return (hex.match(/.{2}/g) || []).join(':');
}

/**
 * Create a brand-new upload keystore. Pure apart from randomness and the clock, so the caller decides
 * where it goes — this module never writes it anywhere.
 *
 * ⚠️ RSA keygen runs on Node's NATIVE crypto, not node-forge's pure-JS implementation: forge would
 * block the event loop for seconds on a 2048-bit key, and this runs inside a request.
 */
export function generateUploadKeystore(appName?: string): GeneratedKeystore {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const fPriv = forge.pki.privateKeyFromPem(privateKey);
  const fPub = forge.pki.publicKeyFromPem(publicKey);

  const cert = forge.pki.createCertificate();
  cert.publicKey = fPub;
  // A leading non-zero digit keeps the serial positive: a DER INTEGER whose top bit is set reads as
  // negative, and some tools reject a negative serial number.
  cert.serialNumber = `01${randomBytes(8).toString('hex')}`;
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime());
  notAfter.setFullYear(notAfter.getFullYear() + KEY_VALIDITY_YEARS);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const subject = [
    { name: 'commonName', value: certificateCommonName(appName) },
    { name: 'organizationName', value: 'NavBharatAI' },
    { name: 'countryName', value: 'IN' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject); // self-signed: an upload certificate has no chain and needs none
  cert.sign(fPriv, forge.md.sha256.create());

  const password = strongPassword();
  const p12 = forge.pkcs12.toPkcs12Asn1(fPriv, [cert], password, {
    algorithm: '3des',
    friendlyName: UPLOAD_KEY_ALIAS,
    generateLocalKeyId: true,
  });
  const der = forge.asn1.toDer(p12).getBytes();

  return {
    base64: Buffer.from(der, 'binary').toString('base64'),
    storePassword: password,
    keyAlias: UPLOAD_KEY_ALIAS,
    keyPassword: password,
    sha256Fingerprint: fingerprintOf(cert),
    validUntil: notAfter.toISOString(),
  };
}
