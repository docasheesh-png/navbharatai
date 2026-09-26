import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { phoneCheckFailureCategory } from '../src/server/lib/referralClaimOutcomes';

/**
 * THE ADMIN'S OWN PHONE, 2026-09-26: "Yeh error aa raha hai!!" and "Phone verification bhi fail".
 *
 * Two screenshots, two native defects, and neither one could fail a single test before this file:
 *
 *   1. The ₹100 claim said "We could not check this device just now" — the CLIENT's sentence, so the
 *      request never left the phone. `DeviceIntegrityPlugin` built a classic Play Integrity request
 *      WITHOUT the nonce Google requires, so every device failed before Google was asked.
 *   2. "Phone sign-in provider is not enabled" — the native auth plugin only builds a handler for a
 *      provider listed in `capacitor.config.ts`, and 'phone' was never listed. The native phone OTP
 *      (login AND the ₹100 mobile step) had never worked on Android or iOS.
 *
 * Both lived in the native layer, where `tsc` and `vitest` cannot see. These locks read the source.
 */
const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Which native provider each `FirebaseAuthentication.<method>` needs. A method not named here fails. */
const PROVIDER_FOR: Record<string, string | null> = {
  signInWithGoogle: 'google.com', linkWithGoogle: 'google.com',
  signInWithGithub: 'github.com', linkWithGithub: 'github.com',
  signInWithApple: 'apple.com', linkWithApple: 'apple.com',
  signInWithPhoneNumber: 'phone', linkWithPhoneNumber: 'phone', confirmVerificationCode: 'phone',
  // Provider-independent.
  signOut: null, addListener: null, removeAllListeners: null, getCurrentUser: null, getIdToken: null,
};

function nativeAuthCalls(): string[] {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== 'server') walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(p) || /\.test\./.test(p)) continue;
      for (const m of codeOnly(readFileSync(p, 'utf8')).matchAll(/FirebaseAuthentication\.(\w+)\(/g)) out.add(m[1]);
    }
  };
  walk(join(root, 'src'));
  return [...out].sort();
}

describe('every native sign-in method the app calls has its provider enabled', () => {
  const providers = (() => {
    const m = /^\s*providers:\s*\[([^\]]*)\]/m.exec(read('capacitor.config.ts'));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  })();

  it('the scan really finds calls — an empty scan would pass vacuously', () => {
    expect(nativeAuthCalls()).toContain('signInWithGoogle');
    expect(nativeAuthCalls()).toContain('linkWithPhoneNumber');
  });

  it('🔴 no method is called whose provider the native plugin was never told about', () => {
    const calls = nativeAuthCalls();
    const unknown = calls.filter((c) => !(c in PROVIDER_FOR));
    expect(unknown, `classify these in PROVIDER_FOR: ${unknown.join(', ')}`).toEqual([]);
    const missing = calls
      .map((c) => PROVIDER_FOR[c])
      .filter((p): p is string => !!p && !providers.includes(p));
    expect([...new Set(missing)], 'add to FirebaseAuthentication.providers in capacitor.config.ts').toEqual([]);
  });

  it("'phone' is enabled — the exact provider whose absence broke the OTP", () => {
    expect(providers).toContain('phone');
  });
});

describe('the device check sends the nonce Google requires', () => {
  const plugin = codeOnly(read('android/app/src/main/java/com/navbharatai/app/DeviceIntegrityPlugin.java'));

  it('🔴 the request sets a nonce before build()', () => {
    expect(plugin).toMatch(/IntegrityTokenRequest\.builder\(\)\s*\.setNonce\(freshNonce\(\)\)[\s\S]{0,120}\.build\(\)/);
  });

  it('the nonce is random, web-safe and unwrapped', () => {
    expect(plugin).toMatch(/new SecureRandom\(\)\.nextBytes/);
    expect(plugin).toMatch(/Base64\.URL_SAFE \| Base64\.NO_WRAP/);
  });
});

describe('a failure on the phone reaches the admin with its real cause', () => {
  it("Google's error code becomes its name", () => {
    expect(phoneCheckFailureCategory('failed', '-16: Integrity API error (-16): Cloud project number is invalid.'))
      .toBe('google-cloud-project-number-invalid');
    expect(phoneCheckFailureCategory('failed', 'Integrity API error (-1): API not available'))
      .toBe('google-api-not-available');
    expect(phoneCheckFailureCategory('failed', 'Missing required properties: nonce')).toBe('request-malformed');
  });

  it('a build without the project number and an old shell are told apart', () => {
    expect(phoneCheckFailureCategory('not-configured', '')).toBe('not-configured-in-this-build');
    expect(phoneCheckFailureCategory('unavailable', '')).toBe('plugin-unavailable');
    expect(phoneCheckFailureCategory('failed', 'something new')).toBe('phone-check-failed');
  });

  it("the app sends Google's message with the report, bounded", () => {
    expect(codeOnly(read('src/lib/referralClaim.ts'))).toMatch(/message: String\(device\.message \?\? ''\)\.slice\(0, 300\)/);
  });
});
