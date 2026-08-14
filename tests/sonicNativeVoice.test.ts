/**
 * Voice must reach the real server from a phone, and must never show a button it cannot honour.
 *
 * ADMIN REPORT 2026-08-13: "sonic voice apps (aab-apk, ipa) dono me kaam nahi karta hai."
 *
 * The cause was a hole in the native API layer, not in Sonic. `installNativeApiRewrite` redirects
 * `/api/…` to the production origin for `fetch` and `XMLHttpRequest` — which is every ordinary call —
 * but `new WebSocket()` is neither, so a socket built from `window.location.host` aimed at the app's
 * own `localhost`, where nothing listens. The fix lives in apiBase for that reason: the next feature
 * that opens a socket inherits it instead of rediscovering the same failure.
 *
 * The second half is the control itself. Apple rejected this app once for a microphone button that
 * did nothing (Guideline 2.1(a), iPad, 2026-08-02), so "can this device record?" and "has the user
 * allowed it?" are kept as SEPARATE questions — conflating them either hides the button from someone
 * who would have granted permission, or shows a dead one to someone who cannot.
 */

import { describe, it, expect } from 'vitest';
import { resolveWebSocketUrl, NATIVE_API_ORIGIN } from '../src/lib/apiBase';
import {
  micSupported,
  micSecureContext,
  micErrorOutcome,
  micMessage,
  requestMic,
  type MicOutcome,
} from '../src/lib/micCapability';

/** The bundled Android/iOS shell: Capacitor present, origin is the LOCAL one. */
const nativeApp = { Capacitor: { isNativePlatform: () => true }, location: { origin: 'https://localhost' } };
/** A plain browser on the real site. */
const web = { location: { origin: 'https://navbharatai.com' } };
/** Local development. */
const dev = { location: { origin: 'http://localhost:5173' } };

describe('🔒 the reported bug — a socket that pointed at the phone itself', () => {
  it('aims at the REAL API origin inside the app', () => {
    const url = resolveWebSocketUrl('/api/sonic/stream?token=x', nativeApp);
    expect(url).toBe('wss://navbharatai.com/api/sonic/stream?token=x');
  });

  it('🔒 never resolves to localhost in the app — that IS the bug', () => {
    // `wss://localhost/api/sonic/stream` is what the phone used to open, where nothing is listening.
    expect(resolveWebSocketUrl('/api/sonic/stream', nativeApp)).not.toContain('localhost');
  });

  it('leaves the web exactly as it was', () => {
    expect(resolveWebSocketUrl('/api/sonic/stream', web)).toBe('wss://navbharatai.com/api/sonic/stream');
  });

  it('uses ws:// (not wss://) for local http development', () => {
    expect(resolveWebSocketUrl('/api/sonic/stream', dev)).toBe('ws://localhost:5173/api/sonic/stream');
  });

  it('a HOSTED native shell needs no rewrite — its origin already IS the API', () => {
    const hosted = { Capacitor: { isNativePlatform: () => true }, location: { origin: NATIVE_API_ORIGIN } };
    expect(resolveWebSocketUrl('/api/sonic/stream', hosted)).toBe('wss://navbharatai.com/api/sonic/stream');
  });

  it('passes an absolute socket URL through untouched — that is the caller’s decision', () => {
    expect(resolveWebSocketUrl('wss://elsewhere.example/stream', nativeApp)).toBe('wss://elsewhere.example/stream');
    expect(resolveWebSocketUrl('ws://elsewhere.example/stream', nativeApp)).toBe('ws://elsewhere.example/stream');
  });

  it('joins cleanly whatever the slashes look like', () => {
    expect(resolveWebSocketUrl('api/x', nativeApp)).toBe('wss://navbharatai.com/api/x');
    expect(resolveWebSocketUrl('/api/x', { ...nativeApp, location: { origin: 'https://localhost/' } }))
      .toBe('wss://navbharatai.com/api/x');
  });

  it('keeps the query string, which carries the auth token', () => {
    expect(resolveWebSocketUrl('/api/sonic/stream?token=abc&voice=v&boli=hi', nativeApp))
      .toContain('?token=abc&voice=v&boli=hi');
  });
});

describe('microphone capability', () => {
  const withMic = { navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({} as MediaStream) } } };
  const withoutMic = { navigator: { mediaDevices: {} } };

  it('detects a usable microphone API', () => {
    expect(micSupported(withMic)).toBe(true);
  });

  it('🔒 reports UNSUPPORTED where getUserMedia does not exist — so no dead button renders', () => {
    expect(micSupported(withoutMic)).toBe(false);
    expect(micSupported({ navigator: {} })).toBe(false);
    expect(micSupported({})).toBe(false);
    expect(micSupported(undefined)).toBe(false);
  });

  it('🔒 an INSECURE page is refused, but a runtime that does not report the flag is allowed', () => {
    // Refusing on a missing flag would disable voice in a browser that would have permitted it.
    expect(micSecureContext({ isSecureContext: false })).toBe(false);
    expect(micSecureContext({ isSecureContext: true })).toBe(true);
    expect(micSecureContext({})).toBe(true);
  });
});

describe('🔒 six causes, six answers — not one flat "voice failed"', () => {
  it('maps every getUserMedia rejection the spec defines', () => {
    expect(micErrorOutcome({ name: 'NotAllowedError' })).toBe('denied');
    expect(micErrorOutcome({ name: 'PermissionDeniedError' })).toBe('denied');
    expect(micErrorOutcome({ name: 'SecurityError' })).toBe('insecure');
    expect(micErrorOutcome({ name: 'NotFoundError' })).toBe('no-device');
    expect(micErrorOutcome({ name: 'DevicesNotFoundError' })).toBe('no-device');
    expect(micErrorOutcome({ name: 'NotReadableError' })).toBe('in-use');
    expect(micErrorOutcome({ name: 'TrackStartError' })).toBe('in-use');
  });

  it('anything unknown is "failed", never silently "denied"', () => {
    // Telling a user to change a permission they never denied sends them somewhere that cannot help.
    expect(micErrorOutcome({ name: 'WeirdError' })).toBe('failed');
    expect(micErrorOutcome(null)).toBe('failed');
    expect(micErrorOutcome(undefined)).toBe('failed');
    expect(micErrorOutcome('a string')).toBe('failed');
  });

  it('🔒 a DENIED user is told where to fix it — differently in the app and the browser', () => {
    expect(micMessage('denied', true)).toContain('Settings');
    expect(micMessage('denied', false)).toContain('address bar');
  });

  it('every outcome has a real message, and "ok" has none', () => {
    const outcomes: MicOutcome[] = ['unsupported', 'insecure', 'denied', 'no-device', 'in-use', 'failed'];
    for (const o of outcomes) expect(micMessage(o).length, o).toBeGreaterThan(15);
    expect(micMessage('ok')).toBe('');
  });

  it('🔒 no message names a vendor — to the user this is always NavBharatAI', () => {
    const outcomes: MicOutcome[] = ['unsupported', 'insecure', 'denied', 'no-device', 'in-use', 'failed'];
    for (const o of outcomes) {
      for (const app of [true, false]) {
        expect(micMessage(o, app)).not.toMatch(/amazon|aws|nova sonic|bedrock|chrome|safari/i);
      }
    }
  });
});

describe('requestMic', () => {
  it('returns the stream when the device says yes', async () => {
    const fake = {} as MediaStream;
    const res = await requestMic(undefined, { navigator: { mediaDevices: { getUserMedia: async () => fake } } });
    expect(res.outcome).toBe('ok');
    expect(res.stream).toBe(fake);
  });

  it('🔒 never throws — it returns the reason, with a null stream', async () => {
    const res = await requestMic(undefined, {
      navigator: { mediaDevices: { getUserMedia: async () => { throw { name: 'NotAllowedError' }; } } },
    });
    expect(res.outcome).toBe('denied');
    expect(res.stream).toBeNull();
  });

  it('refuses before asking when there is nothing to ask', async () => {
    expect((await requestMic(undefined, { navigator: {} })).outcome).toBe('unsupported');
    expect((await requestMic(undefined, {
      isSecureContext: false,
      navigator: { mediaDevices: { getUserMedia: async () => ({} as MediaStream) } },
    })).outcome).toBe('insecure');
  });

  it('🔒 the outcome is ALWAYS present, so no caller needs type narrowing to be safe', async () => {
    // This project compiles with strictNullChecks off, where a discriminated union does NOT narrow —
    // a tidy {ok:true}|{ok:false} shape would have forced casts, and casts are where a null slips out.
    for (const w of [{ navigator: {} }, { navigator: { mediaDevices: { getUserMedia: async () => ({} as MediaStream) } } }]) {
      const res = await requestMic(undefined, w);
      expect(typeof res.outcome).toBe('string');
      expect('stream' in res).toBe(true);
    }
  });
});
