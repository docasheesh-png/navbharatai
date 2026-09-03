// The ANDROID half of the Meta consent gate. `metaPixel.ts` covers the web pixel; this covers the
// Facebook SDK compiled into the Play build.
//
// WHY A SECOND GATE AT ALL: the pixel is a script we choose to inject, so withholding it is enough.
// The native SDK is the opposite — it initialises itself from a ContentProvider at process start and
// starts logging app events and reading the advertising ID on its own. Consent that is checked only
// in JavaScript would therefore be checked after collection had already begun. So the manifest ships
// the SDK's switches OFF and this module is what opens them, once the user has agreed.
//
// Mirrors mobileNative.ts: pure decision here, Capacitor call behind a native guard, every path
// try/caught — a measurement SDK must never be able to break the app or a privacy control.

import { consentAllowsAnalytics } from './consent';

/** What the native plugin reports back. `sdk-absent` is the normal answer on a build with no Meta credentials. */
export type NativeConsentOutcome = 'enabled' | 'disabled' | 'sdk-absent' | 'failed' | 'not-native' | 'unavailable';

/**
 * Pure: should the native SDK be switched on, given the raw stored consent value?
 *
 * Deliberately the SAME predicate the pixel and web-vitals use, rather than a second reading of the
 * same choice. Two independent interpretations of one consent value is how a product ends up honouring
 * a refusal on the web and ignoring it in the app.
 */
export function nativeMetaConsentGranted(rawConsent: string | null | undefined): boolean {
  return consentAllowsAnalytics(rawConsent);
}

/**
 * Push the current choice to the Android SDK. No-op (and honest about it) anywhere else.
 *
 * Called at boot AND on every consent change, because both directions matter: a grant has to open the
 * switches, and a withdrawal has to close them again.
 */
export async function syncNativeMetaConsent(granted: boolean): Promise<NativeConsentOutcome> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform() !== true) return 'not-native';
    const plugin = registerPlugin<{
      setConsent(options: { granted: boolean }): Promise<{ granted: boolean; outcome: NativeConsentOutcome }>;
    }>('MetaConsent');
    const res = await plugin.setConsent({ granted });
    return res?.outcome ?? 'unavailable';
  } catch {
    // An older installed shell has no such plugin. That build also predates the SDK, so nothing is
    // collecting — "unavailable" is the truthful answer, not a failure to act on.
    return 'unavailable';
  }
}
