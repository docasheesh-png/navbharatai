// Meta (Facebook / Instagram) advertising pixel — the WEB half of conversion measurement.
//
// WHY THIS EXISTS: Meta can only optimise a campaign for an outcome it can actually observe. With no
// pixel the only available objective is link CLICKS, so the budget goes to people who tap an ad
// rather than to people who sign up or pay. This module is what lets a campaign optimise for the
// outcomes NavBharatAI cares about (registration, purchase) instead of taps.
//
// FOUR RULES, all enforced HERE rather than at call sites — the same single-choke-point discipline
// as enforceNoClaude / redactProviders, so a new call site cannot leak or misreport by forgetting:
//
//  1. CONSENT FIRST. A third-party advertising pixel is non-essential telemetry, so it must not load
//     until the user has granted analytics consent (GDPR / India DPDP) — the same gate trackEvent()
//     and the web-vitals observers already pass through. Consent granted mid-session starts it.
//
//  2. WEB ONLY. The installed Android shell reports its own installs and app events through the
//     Facebook Android SDK (see android/app/build.gradle). Loading the web pixel inside that WebView
//     as well would count one person twice and corrupt the campaign's own optimisation signal.
//
//  3. ALLOWLIST, NEVER A FIREHOSE. Only the few genuine conversion events below are mirrored to Meta.
//     Forwarding every internal product event would hand an ad network our whole telemetry stream —
//     that is a privacy problem, not a measurement upgrade.
//
//  4. NEVER INVENT A VALUE. A Purchase carries the REAL rupee amount the SERVER confirmed, or it is
//     reported with no value at all. A made-up amount would both misstate revenue in Meta's reporting
//     and train the campaign to chase the wrong customers.
//
// WHY THE ID COMES FROM THE SERVER, NOT A VITE_ VARIABLE: `import.meta.env.VITE_*` is baked in at
// BUILD time and this project's web bundle is built inside Docker (cloudbuild.yaml passes such values
// as --build-arg). An admin setting VITE_META_PIXEL_ID in Cloud Run would therefore change NOTHING,
// silently — the exact class of doc-vs-reality drift CLAUDE.md warns about. So the id is served at
// runtime by GET /api/public-config from the META_PIXEL_ID env, and setting it takes effect on the
// next page load with no rebuild. A pixel id is public by nature (it is visible in any page's source),
// so serving it on an unauthenticated route discloses nothing.

/** One event as the pixel should receive it. `standard` picks fbq('track') vs fbq('trackCustom'). */
export interface PixelEvent {
  name: string;
  standard: boolean;
  params?: Record<string, unknown>;
}

/**
 * Pure: is this a plausible Meta pixel id? Meta pixel ids are numeric (15-16 digits today).
 * Validating here means a typo'd or placeholder env value disables the pixel honestly instead of
 * injecting junk into the page and failing invisibly at Meta's end.
 */
export function isValidPixelId(id: string | null | undefined): boolean {
  return /^\d{8,20}$/.test(String(id ?? '').trim());
}

/**
 * Pure: should the pixel load at all? Every condition that could make loading it wrong lives here,
 * so there is exactly one answer to test and exactly one place to change it.
 */
export function shouldLoadPixel(input: {
  pixelId: string | null | undefined;
  hasConsent: boolean;
  isNative: boolean;
  isProd: boolean;
}): boolean {
  if (!input.isProd) return false;      // never in dev — it would pollute real campaign data
  if (input.isNative) return false;     // rule 2: the Android SDK owns the app's own events
  if (!input.hasConsent) return false;  // rule 1: consent is a precondition, not a preference
  return isValidPixelId(input.pixelId);
}

/** Round to paise so a floating-point remainder never reaches Meta as 499.00000000000006. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure: map ONE internal analytics event to the pixel event Meta should receive, or null when this
 * event is not a conversion worth reporting (rule 3 — the default is silence, not forwarding).
 *
 * Standard event names are used wherever the semantics genuinely match, because Meta's optimisation
 * and its out-of-the-box reporting both understand them. Where nothing standard fits, a clearly-named
 * custom event is honest; inventing a standard-event meaning would corrupt Meta's own benchmarks.
 */
export function pixelEventFor(event: string, props?: Record<string, unknown>): PixelEvent | null {
  switch (event) {
    case 'signup':
      // Exact semantic match: a NavBharatAI account was created.
      return { name: 'CompleteRegistration', standard: true };

    case 'checkout_started':
      return { name: 'InitiateCheckout', standard: true };

    case 'purchase': {
      const value = Number(props?.value);
      if (Number.isFinite(value) && value > 0) {
        return { name: 'Purchase', standard: true, params: { value: round2(value), currency: 'INR' } };
      }
      // RULE 4, the honest degrade: the purchase genuinely happened, so the conversion is still
      // reported — but with NO value rather than a guessed one. Meta accepts a valueless Purchase;
      // it simply cannot value-optimise on it. Silence would be worse (a real sale goes unlearned),
      // and a fabricated amount would be worse still.
      return { name: 'Purchase', standard: true };
    }

    case 'app_generated':
      // No standard event means "the user built a working app", which is our actual activation
      // moment — so a custom event, named for what it is.
      return { name: 'AppBuilt', standard: false };

    default:
      return null; // everything else stays internal
  }
}

// ── Runtime side ────────────────────────────────────────────────────────────────────────────────
//
// The DOM is touched in exactly ONE function (defaultInstaller). Everything above and below it is
// plain logic, which is why this module needs no browser to test: the risky part is the DECISION to
// load and what gets reported, not Meta's own loader snippet.

/** Sends one already-mapped event onward to Meta. Returned by an installer once the pixel is live. */
export type PixelSender = (method: 'track' | 'trackCustom', name: string, params?: Record<string, unknown>) => void;

/** Installs the pixel for `pixelId` and returns the sender to use, or null if it could not start. */
export type PixelInstaller = (pixelId: string) => PixelSender | null;

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The real installer: Meta's standard loader snippet, then init + the first PageView.
 * Kept deliberately tiny and boring — it is the only browser-dependent code in this module.
 */
export const defaultInstaller: PixelInstaller = (pixelId: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const w = window as any;
  if (!w.fbq) {
    const fbq: any = function (...args: unknown[]) {
      fbq.callMethod ? fbq.callMethod.apply(fbq, args) : fbq.queue.push(args);
    };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    w.fbq = fbq;
    if (!w._fbq) w._fbq = fbq;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  w.fbq('init', pixelId);
  w.fbq('track', 'PageView');
  return (method, name, params) => {
    if (params) w.fbq(method, name, params);
    else w.fbq(method, name);
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The default id source: GET /api/public-config. Returns null on any failure — an unreachable config
 * route means "no pixel", never a retry storm and never a thrown error into app startup.
 */
export async function fetchPixelIdFromServer(): Promise<string | null> {
  try {
    const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { metaPixelId?: unknown };
    const id = typeof body?.metaPixelId === 'string' ? body.metaPixelId : null;
    return isValidPixelId(id) ? id : null;
  } catch {
    return null;
  }
}

let loadState: 'idle' | 'loading' | 'ready' | 'disabled' = 'idle';
let sender: PixelSender | null = null;

/** True only once the pixel is genuinely live — the only thing allowed to report "on". */
export function isPixelReady(): boolean {
  return loadState === 'ready' && sender !== null;
}

/** Test-only: restore module state between cases. */
export function __resetPixelForTests(): void {
  loadState = 'idle';
  sender = null;
}

/**
 * Start the pixel if — and only if — every condition in shouldLoadPixel() holds. Safe to call
 * repeatedly: it installs at most once, and a call made before consent does nothing at all, so the
 * consent listener can simply call it again when the user accepts.
 */
export async function initMetaPixel(deps: {
  hasConsent: () => boolean;
  isNative: () => boolean;
  isProd: boolean;
  fetchPixelId: () => Promise<string | null>;
  install?: PixelInstaller;
}): Promise<void> {
  if (loadState === 'ready' || loadState === 'loading') return;
  // The cheap gates run BEFORE the network call, so a user who declined causes no request at all.
  if (!deps.isProd || deps.isNative() || !deps.hasConsent()) return;

  loadState = 'loading';
  try {
    const pixelId = await deps.fetchPixelId();
    // Re-check consent: the fetch is async, and the user may have declined while it was in flight.
    if (!shouldLoadPixel({ pixelId, hasConsent: deps.hasConsent(), isNative: deps.isNative(), isProd: deps.isProd })) {
      loadState = 'disabled';
      return;
    }
    const send = (deps.install ?? defaultInstaller)(String(pixelId).trim());
    if (!send) { loadState = 'disabled'; return; }
    sender = send;
    loadState = 'ready';
  } catch {
    // A pixel that cannot load must never affect the app. Latching to 'disabled' also stops a retry
    // storm on every subsequent tracked event.
    loadState = 'disabled';
    sender = null;
  }
}

/**
 * Mirror one internal analytics event to the pixel. Called from ONE place (trackEvent), which has
 * already checked consent — this checks readiness only, and stays silent for every event that
 * pixelEventFor() does not map.
 */
export function forwardToMetaPixel(event: string, props?: Record<string, unknown>): void {
  if (loadState !== 'ready' || !sender) return;
  const mapped = pixelEventFor(event, props);
  if (!mapped) return;
  try {
    sender(mapped.standard ? 'track' : 'trackCustom', mapped.name, mapped.params);
  } catch {
    /* advertising measurement must never break the product */
  }
}
