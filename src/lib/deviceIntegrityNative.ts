// THE DEVICE CHECK — the native bridge. The server's judgement lives in
// `src/server/lib/deviceIntegrity.ts`; this file is only the wire to the Android plugin
// (DeviceIntegrityPlugin.java), and it is a no-op everywhere else.
//
// Mirrors playBillingNative.ts exactly, including the lesson that file records: the guard asks
// "is this ANDROID?", never "is this native?". An iPhone is native, and registering an Android-only
// plugin there throws on every launch — a guaranteed error that hides the real ones. Play Integrity
// is a Google Play service and has no iOS counterpart, so this is Android or nothing.
//
// 🔒 WHAT THIS RETURNS IS EVIDENCE, NOT A DECISION. The two values it collects mean nothing on their
// own: the device id is a string this process read, and the token is opaque to us. Only the SERVER
// can decode the token (with our service account) and only the server decides whether any money
// moves. Nothing in this file should ever grow a boolean called `verified`.
//
// 🔒 AND AN OLDER SHELL MUST NOT BREAK. An .aab built before this plugin existed simply answers
// `unavailable`, which the caller reads as "this device cannot claim the bonus yet" and shows an
// honest "update the app" line — never a crash, and never a silent pass.

/** What the native side reported. Only `ok` carries usable evidence. */
export interface NativeDeviceCheck {
  outcome: 'ok' | 'not-configured' | 'failed' | 'unavailable';
  /** ANDROID_ID — present only on `ok`. */
  deviceId?: string;
  /** Google's signed integrity token — present only on `ok`. */
  integrityToken?: string;
  /** The native message, for the SERVER log. Never rendered verbatim to a user. */
  message?: string;
}

interface DeviceIntegrityPlugin {
  getDeviceCheck(): Promise<NativeDeviceCheck>;
}

let cached: DeviceIntegrityPlugin | null = null;

/**
 * The only platform this plugin exists on. Exported so the gate is testable without Capacitor.
 * See the header: an iPhone is native, and "native" is the wrong question.
 */
export function isDeviceCheckPlatform(platform: string | null | undefined): boolean {
  return String(platform ?? '').trim().toLowerCase() === 'android';
}

/** The plugin handle, or null on web, iOS and older shells. Never throws. */
async function plugin(): Promise<{ api: DeviceIntegrityPlugin } | null> {
  if (cached) return { api: cached };
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!isDeviceCheckPlatform(Capacitor.getPlatform())) return null;
    cached = registerPlugin<DeviceIntegrityPlugin>('DeviceIntegrity');
    return { api: cached };
  } catch {
    return null;
  }
}

/**
 * Collect this device's evidence, to be posted to the server alongside a reward claim.
 *
 * 🔒 A PARTIAL RESULT IS A FAILURE. If either half is missing the whole thing is `failed`, because
 * the server cannot tell "the device declined to attest" from "there was nothing to attest" — and an
 * id with no token is exactly what a forgery looks like. Collapsing them here means the server never
 * has to guess.
 *
 * Never throws: every path returns a named outcome, so a caller on the sign-in screen cannot be
 * broken by a device that behaves unexpectedly.
 */
export async function collectDeviceCheck(): Promise<NativeDeviceCheck> {
  try {
    const held = await plugin();
    if (!held) return { outcome: 'unavailable' };
    const res = await held.api.getDeviceCheck();
    if (!res || res.outcome !== 'ok') {
      return { outcome: res?.outcome ?? 'failed', message: res?.message };
    }
    if (!res.deviceId || !res.integrityToken) {
      return { outcome: 'failed', message: 'the device check returned an incomplete result' };
    }
    return { outcome: 'ok', deviceId: res.deviceId, integrityToken: res.integrityToken };
  } catch (e) {
    // An older shell throws "plugin is not implemented"; anything else is a device oddity. Both are
    // "we could not check", which is never a pass.
    return { outcome: 'unavailable', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Is this build able to claim a device-gated bonus at all?
 *
 * Exists so a screen can decide what to SHOW before the user taps something that cannot work —
 * offering a claim button that is guaranteed to fail is the half-built state the second absolute
 * rule forbids.
 */
export async function deviceCheckAvailable(): Promise<boolean> {
  return (await collectDeviceCheck()).outcome === 'ok';
}
