/**
 * CAN THIS DEVICE ACTUALLY RECORD? — and if not, say which of the six reasons it is.
 *
 * ADMIN REPORT 2026-08-13: Sonic voice did not work in the Android or iOS app. Two separate causes
 * (the socket pointed at the app's own localhost — fixed in `apiBase.resolveWebSocketUrl` — and iOS
 * had no microphone usage description). But a third problem sat underneath both: when the microphone
 * failed for ANY reason, the user got one flat error, so a permission they could grant in two taps
 * looked exactly like a broken feature.
 *
 * 🔒 WHY THIS MATTERS BEYOND TIDINESS. Apple rejected this app once already — Guideline 2.1(a), iPad,
 * 2026-08-02: "The microphone button is unresponsive." A control that is visible but cannot work is a
 * rejection, not a rough edge. `micSupported()` exists so a button can be GATED ON RENDER, exactly as
 * `voiceInput.speechRecognitionSupported` gates the speech-to-text buttons.
 *
 * ⚠️ SUPPORTED IS NOT THE SAME AS PERMITTED, and conflating them is the trap. A phone always supports
 * a microphone, so `micSupported()` is true there and the button SHOULD render — the user has simply
 * not been asked yet. Permission is only knowable by asking, so it is a separate, later answer.
 */

/** The distinct outcomes. Each maps to a different thing the user can do — that is why there are six. */
export type MicOutcome =
  | 'ok'
  | 'unsupported'      // no getUserMedia in this runtime at all → do not render a mic button
  | 'insecure'         // not a secure context; browsers refuse the mic outright
  | 'denied'           // the user or the OS said no
  | 'no-device'        // nothing to record with
  | 'in-use'           // another app holds the microphone
  | 'failed';          // something else broke

export interface MicWindowLike {
  isSecureContext?: boolean;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
}

/**
 * Is a microphone reachable in principle? Gate a mic button's RENDER on this.
 *
 * Deliberately does NOT ask for permission — asking on render would pop a system prompt the moment a
 * screen loads, which users read as an app grabbing at their microphone.
 */
export function micSupported(w: MicWindowLike | undefined = typeof window !== 'undefined' ? (window as MicWindowLike) : undefined): boolean {
  if (!w) return false;
  return typeof w.navigator?.mediaDevices?.getUserMedia === 'function';
}

/**
 * A secure context is required by every browser for `getUserMedia`.
 *
 * The Capacitor app is served from `https://localhost` / `capacitor://localhost`, both of which ARE
 * secure contexts — so this is about a misconfigured web deploy, not the app.
 */
export function micSecureContext(w: MicWindowLike | undefined = typeof window !== 'undefined' ? (window as MicWindowLike) : undefined): boolean {
  // `undefined` (a runtime that does not expose the flag) is treated as secure: refusing on a missing
  // flag would disable the microphone for a browser that would have allowed it.
  return w?.isSecureContext !== false;
}

/**
 * Map a `getUserMedia` rejection to the outcome the UI should act on.
 *
 * These names are the DOMException values the spec defines, and they mean genuinely different things:
 * a user who DENIED can grant, a user with NO DEVICE cannot, and a microphone held by another app
 * needs that app closed. One shared "microphone failed" message would leave all three stuck.
 */
export function micErrorOutcome(err: unknown): MicOutcome {
  const name = String((err as { name?: unknown } | null)?.name ?? '');
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':      // legacy Chrome
    case 'SecurityError':
      return name === 'SecurityError' ? 'insecure' : 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':       // legacy
      return 'no-device';
    case 'NotReadableError':
    case 'TrackStartError':            // legacy
      return 'in-use';
    default:
      return 'failed';
  }
}

/**
 * The sentence the user reads. Written as an ACTION wherever one exists, because "microphone error"
 * tells somebody nothing they can do.
 *
 * 🔒 No vendor or model name appears here — to the user this is always NavBharatAI (the White-Label
 * Law), and these strings surface directly on screen.
 */
export function micMessage(outcome: MicOutcome, isNativeApp = false): string {
  switch (outcome) {
    case 'ok':
      return '';
    case 'unsupported':
      return 'Voice is not available on this device.';
    case 'insecure':
      return 'Voice needs a secure (https) connection. Open NavBharatAI over https and try again.';
    case 'denied':
      return isNativeApp
        ? 'NavBharatAI needs microphone access for voice. Open your phone’s Settings → Apps → NavBharatAI → Permissions and allow the Microphone, then try again.'
        : 'Microphone access was blocked. Tap the lock icon in your browser’s address bar, allow the Microphone, then try again.';
    case 'no-device':
      return 'No microphone was found on this device.';
    case 'in-use':
      return 'Your microphone is being used by another app. Close it (a call or recorder, usually) and try again.';
    case 'failed':
      return 'The microphone could not be started. Please try again.';
  }
}

export interface MicRequestResult {
  /** Always meaningful — 'ok' means the stream is present, anything else says exactly what went wrong. */
  outcome: MicOutcome;
  /** The live stream, or null. Never present unless `outcome === 'ok'`. */
  stream: MediaStream | null;
}

/**
 * Ask for the microphone, once, and return either the stream or the reason.
 *
 * ⚠️ Deliberately NOT a discriminated union (`{ok:true,...} | {ok:false,...}`). This project compiles
 * with `strictNullChecks: false`, under which TypeScript does not narrow such a union — so the tidy
 * shape would have forced every caller into a cast, and a cast is exactly where a null stream slips
 * through. One shape with an always-present `outcome` needs no narrowing to be safe.
 *
 * Never throws: every caller is a UI event handler, and an unhandled rejection inside one leaves the
 * screen half-started with no message at all.
 */
export async function requestMic(
  constraints: MediaStreamConstraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } },
  w: MicWindowLike | undefined = typeof window !== 'undefined' ? (window as MicWindowLike) : undefined,
): Promise<MicRequestResult> {
  if (!micSupported(w)) return { outcome: 'unsupported', stream: null };
  if (!micSecureContext(w)) return { outcome: 'insecure', stream: null };
  try {
    const media = w!.navigator!.mediaDevices!;
    const getUserMedia = media.getUserMedia as (c: MediaStreamConstraints) => Promise<MediaStream>;
    const stream = await getUserMedia.call(media, constraints);
    return { outcome: 'ok', stream };
  } catch (err) {
    return { outcome: micErrorOutcome(err), stream: null };
  }
}
