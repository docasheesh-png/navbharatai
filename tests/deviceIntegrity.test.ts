import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  judgeIntegrityPayload, normalizeDeviceId, checkDeviceIntegrity, deviceCheckConfigured,
  deviceRefusalMessage, _setIntegrityFetchForTests, INTEGRITY_MAX_AGE_MS,
} from '../src/server/lib/deviceIntegrity';
import { _setStoreFetchForTests } from '../src/server/lib/storeVerify';

/**
 * The device gate. Every referral rupee sits behind it, and none of it can be exercised against the
 * real Google from CI — so the judgement half is pure and tested exhaustively, and the network half
 * is driven through the injected fetch.
 *
 * The organising question for every case below is the one that matters for money: WHICH WAY DOES IT
 * FAIL? This gate is the rare one in this repo that must fail CLOSED, because there is no later gate
 * to catch a wrong "yes".
 */

const NOW = 1_800_000_000_000;
const PKG = 'com.navbharat.ai';

/**
 * A REAL RSA key, generated here rather than a placeholder string.
 *
 * The first version of this suite used `{"private_key":"y"}` and four cases failed in a way that was
 * worth more than a passing test: `googleAccessToken` signs a JWT with that key, `crypto.sign`
 * threw, the token came back null, and every check short-circuited to 'unavailable' — so the tests
 * "reached" Play Integrity without ever reaching it. With a real key the OAuth exchange is genuinely
 * exercised, which means the JWT minting this depends on is covered too.
 */
let SA_JSON = '';
beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  SA_JSON = JSON.stringify({
    client_email: 'referral-device-check@navbharatai.test',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
});

const goodPayload = (over: Record<string, unknown> = {}) => ({
  requestDetails: { requestPackageName: PKG, timestampMillis: String(NOW - 2_000) },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PKG },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'] },
  ...over,
});

const judge = (payload: unknown) => judgeIntegrityPayload(payload, { packageName: PKG, now: NOW });

afterEach(() => { _setIntegrityFetchForTests(null); _setStoreFetchForTests(null); });

/** Google's OAuth endpoint, standing in for the real one so the access token actually mints. */
function oauthReturnsAToken(): void {
  _setStoreFetchForTests(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'ya29.test' }) }));
}

describe('judging Google’s verdict', () => {
  it('accepts a genuine Play-installed app on a genuine device', () => {
    expect(judge(goodPayload())).toEqual({ ok: true, detail: 'device verified' });
  });

  it('refuses a token minted for a DIFFERENT package', () => {
    const r = judge(goodPayload({ requestDetails: { requestPackageName: 'com.someone.else', timestampMillis: String(NOW) } }));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('com.someone.else');
  });

  it('refuses a modified or sideloaded build — the very thing built to fake the rest of this', () => {
    for (const verdict of ['UNRECOGNIZED_VERSION', 'UNEVALUATED', '']) {
      const r = judge(goodPayload({ appIntegrity: { appRecognitionVerdict: verdict, packageName: PKG } }));
      expect(r.ok, verdict).toBe(false);
    }
  });

  it('🔒 REFUSES AN EMULATOR — the bot farm this gate exists for', () => {
    // An emulator gets MEETS_BASIC_INTEGRITY at best, never MEETS_DEVICE_INTEGRITY. 500 fake phones
    // on one computer is the standard machinery of this kind of fraud.
    const r = judge(goodPayload({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('MEETS_BASIC_INTEGRITY');
  });

  it('refuses an empty or absent device verdict', () => {
    expect(judge(goodPayload({ deviceIntegrity: { deviceRecognitionVerdict: [] } })).ok).toBe(false);
    expect(judge(goodPayload({ deviceIntegrity: {} })).ok).toBe(false);
  });

  it('does NOT require MEETS_STRONG_INTEGRITY — that would refuse genuine older Indian handsets', () => {
    // A deliberate product decision, pinned so nobody "hardens" it into refusing real users. Strong
    // integrity additionally demands a recent security update, which a large share of the phones
    // this product is built for will never have.
    const r = judge(goodPayload({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] } }));
    expect(r.ok).toBe(true);
  });

  it('🔒 REFUSES A REPLAYED (stale) TOKEN', () => {
    const stale = goodPayload({ requestDetails: { requestPackageName: PKG, timestampMillis: String(NOW - INTEGRITY_MAX_AGE_MS - 1_000) } });
    expect(judge(stale).ok).toBe(false);
  });

  it('accepts a token just inside the freshness window, and refuses one just outside', () => {
    const at = (ageMs: number) => judge(goodPayload({ requestDetails: { requestPackageName: PKG, timestampMillis: String(NOW - ageMs) } }));
    expect(at(INTEGRITY_MAX_AGE_MS - 1_000).ok).toBe(true);
    expect(at(INTEGRITY_MAX_AGE_MS + 1_000).ok).toBe(false);
  });

  it('refuses a token from the FUTURE — a reopened replay window from the other side', () => {
    expect(judge(goodPayload({ requestDetails: { requestPackageName: PKG, timestampMillis: String(NOW + 10 * 60_000) } })).ok).toBe(false);
    // ...while tolerating ordinary clock skew, so an honest phone a few seconds fast still passes.
    expect(judge(goodPayload({ requestDetails: { requestPackageName: PKG, timestampMillis: String(NOW + 5_000) } })).ok).toBe(true);
  });

  it('refuses a payload with no timestamp at all rather than treating it as fresh', () => {
    expect(judge(goodPayload({ requestDetails: { requestPackageName: PKG } })).ok).toBe(false);
  });

  it('survives junk without throwing — every shape is a refusal, never a crash', () => {
    for (const junk of [null, undefined, 'a string', 42, [], {}, { requestDetails: null }]) {
      expect(judge(junk).ok, JSON.stringify(junk)).toBe(false);
    }
  });

  it('tolerates fields Google adds later — a harmless addition must not become a refusal', () => {
    expect(judge(goodPayload({ environmentDetails: { playProtectVerdict: 'NO_ISSUES' } })).ok).toBe(true);
  });
});

describe('the device id', () => {
  it('accepts a real ANDROID_ID and normalises its case', () => {
    expect(normalizeDeviceId('A1B2C3D4E5F60718')).toBe('a1b2c3d4e5f60718');
    expect(normalizeDeviceId('  a1b2c3d4e5f60718  ')).toBe('a1b2c3d4e5f60718');
  });

  it('refuses anything that is not one', () => {
    for (const junk of ['', '   ', 'short', 'not-hex-at-all!!', null, undefined, 42, {}, 'a'.repeat(200)]) {
      expect(normalizeDeviceId(junk), JSON.stringify(junk)).toBeNull();
    }
  });
});

describe('🔒 the gate FAILS CLOSED — every failure pays zero', () => {
  const env = () => ({ GOOGLE_PLAY_SA_JSON: SA_JSON, GOOGLE_PLAY_PACKAGE_NAME: PKG } as NodeJS.ProcessEnv);

  it('is unavailable when it is not configured — never "verified by default"', async () => {
    expect(deviceCheckConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    const r = await checkDeviceIntegrity({ integrityToken: 't', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: {} as NodeJS.ProcessEnv });
    expect(r.verdict).toBe('unavailable');
    expect(r.deviceId).toBeNull();
  });

  it('is unavailable when only half the configuration is present', async () => {
    expect(deviceCheckConfigured({ GOOGLE_PLAY_SA_JSON: '{}' } as NodeJS.ProcessEnv)).toBe(false);
    expect(deviceCheckConfigured({ GOOGLE_PLAY_PACKAGE_NAME: PKG } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('refuses a missing or malformed device id BEFORE spending a call on Google', async () => {
    let called = false;
    _setIntegrityFetchForTests(async () => { called = true; throw new Error('should not be reached'); });
    const r = await checkDeviceIntegrity({ integrityToken: 't', deviceId: 'nonsense', now: NOW, env: env() });
    expect(r.verdict).toBe('not-verified');
    expect(called).toBe(false);
  });

  it('is UNAVAILABLE (not a fraud signal) when Google is unreachable', async () => {
    oauthReturnsAToken();
    _setIntegrityFetchForTests(async () => { throw new Error('ECONNRESET'); });
    const r = await checkDeviceIntegrity({ integrityToken: 't', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: env() });
    // Distinguished on purpose: an outage costing honest users their bonus must not hide inside a
    // fraud counter. Both pay zero; only one of them is somebody trying it on.
    expect(r.verdict).toBe('unavailable');
  });

  it('treats a 5xx as ours and a 4xx as theirs', async () => {
    oauthReturnsAToken();
    _setIntegrityFetchForTests(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    expect((await checkDeviceIntegrity({ integrityToken: 't', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: env() })).verdict).toBe('unavailable');
    _setIntegrityFetchForTests(async () => ({ ok: false, status: 400, json: async () => ({}) }));
    expect((await checkDeviceIntegrity({ integrityToken: 't', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: env() })).verdict).toBe('not-verified');
  });

  it('🔒 A FORGED TOKEN IS REFUSED — the device’s own claim is worth nothing alone', async () => {
    // The attack this whole module exists to stop: post a real-looking ANDROID_ID with a token
    // Google did not sign for our package.
    oauthReturnsAToken();
    _setIntegrityFetchForTests(async () => ({
      ok: true, status: 200,
      json: async () => ({ tokenPayloadExternal: goodPayload({ appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PKG } }) }),
    }));
    const r = await checkDeviceIntegrity({ integrityToken: 'forged', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: env() });
    expect(r.verdict).toBe('not-verified');
    expect(r.deviceId).toBeNull();
  });

  it('never returns a device id on an unverified check, so no caller can read one by accident', async () => {
    oauthReturnsAToken();
    for (const body of [{}, { tokenPayloadExternal: null }, { tokenPayloadExternal: { junk: true } }]) {
      _setIntegrityFetchForTests(async () => ({ ok: true, status: 200, json: async () => body }));
      const r = await checkDeviceIntegrity({ integrityToken: 't', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: env() });
      expect(r.verdict).not.toBe('verified');
      expect(r.deviceId).toBeNull();
    }
  });

  it('🔴 THE INJECTED ENV REALLY REACHES THE CREDENTIAL — two sources of truth, once', async () => {
    /**
     * The defect this encodes, found while writing the suite above. `deviceCheckConfigured(env)`
     * read the injected env while `googleAccessToken` read `process.env`, so a caller passing its
     * own environment was told "configured" and then silently got no access token — every check
     * came back 'unavailable' for a reason that had nothing to do with the device. Two sources of
     * truth that agree right up until they do not.
     *
     * The assertion is deliberately about BEHAVIOUR, not plumbing: with the service account present
     * ONLY in the injected env (process.env has none here), a real verification must still succeed.
     */
    expect((process.env.GOOGLE_PLAY_SA_JSON || '')).toBe('');
    oauthReturnsAToken();
    _setIntegrityFetchForTests(async () => ({ ok: true, status: 200, json: async () => ({ tokenPayloadExternal: goodPayload() }) }));
    const r = await checkDeviceIntegrity({ integrityToken: 'real', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: env() });
    expect(r.verdict).toBe('verified');
  });

  it('verifies a genuine device and returns its normalised id', async () => {
    oauthReturnsAToken();
    _setIntegrityFetchForTests(async () => ({ ok: true, status: 200, json: async () => ({ tokenPayloadExternal: goodPayload() }) }));
    const r = await checkDeviceIntegrity({ integrityToken: 'real', deviceId: 'A1B2C3D4E5F60718', now: NOW, env: env() });
    expect(r.verdict).toBe('verified');
    expect(r.deviceId).toBe('a1b2c3d4e5f60718');
  });

  it('calls Play Integrity for OUR package, with a bearer token', async () => {
    let url = ''; let auth = '';
    oauthReturnsAToken();
    _setIntegrityFetchForTests(async (u, init) => {
      url = u; auth = init?.headers?.Authorization || '';
      return { ok: true, status: 200, json: async () => ({ tokenPayloadExternal: goodPayload() }) };
    });
    await checkDeviceIntegrity({ integrityToken: 'real', deviceId: 'a1b2c3d4e5f60718', now: NOW, env: env() });
    expect(url).toContain('playintegrity.googleapis.com');
    expect(url).toContain(encodeURIComponent(PKG));
    expect(url).toContain('decodeIntegrityToken');
    expect(auth.startsWith('Bearer ')).toBe(true);
  });
});

describe('what the user is told', () => {
  it('an outage says "try again" and reassures them about their account', () => {
    const msg = deviceRefusalMessage('unavailable');
    expect(msg).toMatch(/again/i);
    expect(msg).toMatch(/account is fine/i);
  });

  it('a refusal never accuses anyone — a rooted phone is usually just a phone', () => {
    for (const v of ['not-verified', 'unavailable'] as const) {
      expect(deviceRefusalMessage(v)).not.toMatch(/fraud|abuse|cheat|suspicious|banned|violation|rooted|emulator/i);
    }
  });

  it('never names the failing check — the one thing an attacker needs', () => {
    const msg = deviceRefusalMessage('not-verified');
    expect(msg).not.toMatch(/integrity|verdict|token|ANDROID_ID|MEETS_/i);
  });
});
