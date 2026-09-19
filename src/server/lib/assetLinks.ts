// ANDROID APP LINKS — serve the file Android fetches to verify we own this domain (admin 2026-09-19).
//
// WHY. Tapping a navbharatai.com link opened a browser, not the app — the loudest "this is a website"
// moment left, and a growth leak besides (share links, referral codes, published apps). Android only
// hands a domain's links to an app when it can fetch, over https, from the domain itself:
//     https://navbharatai.com/.well-known/assetlinks.json
// and find that app's package name beside the SHA-256 fingerprint of the certificate it was signed
// with. No file, no link handling — silently, with nothing to see anywhere.
//
// SHAPED AFTER `appleDomainAssociation.ts`, deliberately, including the trap it records: `public/` is
// NOT copied into the runtime Docker image, so a committed file under `public/.well-known/` is absent
// in the one environment Android actually fetches from. This file therefore has ONE source — an env
// value the admin sets in Cloud Run — and no file path at all. There is nothing to forget to deploy.
//
// 🔴 THE FINGERPRINT IS NOT A SECRET, and saying so matters because this repo's registry forbids
// writing values down. It is PUBLISHED, by design, at the public URL above, on every app that has ever
// enabled App Links. What must never leave the admin's machine is the KEYSTORE; the fingerprint is the
// keystore's public identity. The admin reads it from Play Console → Setup → App signing.
//
// UNSET ⇒ 404, which is exactly today's behaviour: the path is not served now either, so nothing
// changes until the value exists. An empty 200 would be worse than a 404 — Android would read it as a
// malformed statement list and the admin would debug a parse error instead of a missing value.

/** The exact path Android fetches. A constant so the route and the tests cannot drift. */
export const ASSET_LINKS_PATH = '/.well-known/assetlinks.json';

/**
 * The app the statements are about.
 *
 * This is `appId` in capacitor.config.ts and `applicationId` in build.gradle — NOT the Android
 * `namespace` (`com.navbharatai.app`), which is the internal code package and is a different string.
 * Android matches the installed app by the value here, so the wrong one verifies nothing and reports
 * nothing. `tests/aLinkOpensTheApp.test.ts` asserts it against capacitor.config.ts.
 */
export const ANDROID_PACKAGE_NAME = 'com.navbharat.ai';

/** A Play/keytool SHA-256 fingerprint: 32 uppercase hex pairs joined by colons. */
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/**
 * Every well-formed fingerprint in the configured value, de-duplicated and upper-cased.
 *
 * ⚠️ A COMMA LIST IS THE NORMAL CASE, NOT AN EDGE CASE. With Play App Signing an app has TWO
 * certificates — the UPLOAD key the admin signs with and the APP SIGNING key Google re-signs with —
 * and the one that reaches a user's phone depends on how they installed it. Listing both makes a
 * sideloaded test build and a Play install behave identically; listing one makes the other fail with
 * no error anywhere.
 *
 * A malformed entry is DROPPED rather than passed through. Android rejects the whole statement file if
 * any entry is malformed, so one typo would silently disable link handling for the good fingerprint
 * sitting beside it — the failure mode this project has been bitten by twice (a trailing space in
 * BRAVE_API_KEY, an `=` in ALERT_EMAIL_FROM).
 */
export function assetLinkFingerprints(env: NodeJS.ProcessEnv): string[] {
  const raw = String(env?.ANDROID_CERT_SHA256 || '').trim();
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const value = part.trim().toUpperCase();
    if (FINGERPRINT.test(value)) seen.add(value);
  }
  return [...seen];
}

/** Fingerprints present in the value that are NOT well-formed — for the admin log line only. */
export function malformedFingerprints(env: NodeJS.ProcessEnv): string[] {
  const raw = String(env?.ANDROID_CERT_SHA256 || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !FINGERPRINT.test(p.toUpperCase()));
}

/**
 * The statement list Android expects, or null when nothing is configured.
 *
 * `delegate_permission/common.handle_all_urls` is the only permission App Links needs — it is the
 * statement "this app may handle this site's URLs". It is deliberately NOT accompanied by
 * `common.get_login_creds` (Smart Lock password sharing), which is a different, wider grant that
 * nothing here asks for.
 */
export function assetLinksJson(env: NodeJS.ProcessEnv): string | null {
  const fingerprints = assetLinkFingerprints(env);
  if (fingerprints.length === 0) return null;
  return `${JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    null,
    2,
  )}\n`;
}
