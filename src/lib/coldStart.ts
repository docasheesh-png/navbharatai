// HOW LONG DOES THE APP TAKE TO OPEN? — measured before anything is optimised (admin 2026-09-19, item E).
//
// The audit that produced items A–E found `dist/assets` at 5.9 MB and the splash released at 1 s, and
// could say NOTHING about what that costs a real user at launch, because nobody had ever measured it.
// This repo's own rule, learned the expensive way on E2B spend: **measure first, then decide.** A speed
// change judged on a feeling is how a plausible number ends up in a doc for a month (see the
// `E2B_USD_PER_HOUR` correction in CLAUDE.md, where the wrong step was the one that sounded rigorous).
//
// 🔴 WHAT THIS CANNOT SEE, SAID FIRST SO NO ONE READS THE NUMBER AS THE WHOLE LAUNCH. JavaScript starts
// existing when the WebView starts loading our document. Everything BEFORE that — the Android process
// starting, the Activity, the WebView being created, the splash appearing — is invisible from here and
// is NOT in these numbers. So `toAppReady` is the WEB half of a cold start, and the true figure is
// larger by an amount only a native trace can give. Reporting it as "the cold start" would be exactly
// the kind of confident, unfalsifiable number this project has already been bitten by.
//
// 🔒 AND NOT EVERY LOAD IS A COLD START. A reload, a back/forward restore, or a launch that happened
// while the app was in the BACKGROUND (the OS pre-warming, or the user switching away mid-launch) all
// produce timings that no human experienced. Folding those into an average would quietly poison it, so
// each is rejected BY NAME rather than averaged away.

/** Everything the measurement needs, injected so the rules are testable without a browser. */
export interface ColdStartInput {
  /** `PerformanceNavigationTiming.type` — only 'navigate' is a launch. */
  navigationType: string | undefined;
  /** ms from timeOrigin: when the first byte of the document arrived. */
  responseStart: number | undefined;
  /** ms from timeOrigin: when the DOM was ready. */
  domContentLoaded: number | undefined;
  /** ms from timeOrigin: the `first-contentful-paint` paint entry, when there is one. */
  firstContentfulPaint: number | undefined;
  /** ms from timeOrigin: our own mark, set in the frame after React's first render. */
  appReady: number | undefined;
  /** Was the document EVER hidden between load and the mark? */
  wasHiddenDuringLaunch: boolean;
  /** True inside the Capacitor shell — the web and the app are different launches and are labelled so. */
  nativeShell: boolean;
}

export interface ColdStartPhases {
  /** Document request → first byte. In the bundled shell this is a local file read, so it is tiny. */
  toFirstByte: number;
  /** timeOrigin → DOM ready. Parse + the synchronous part of the bundle. */
  toDomReady: number;
  /** timeOrigin → first contentful paint: when the user first saw ANYTHING. */
  toFirstPaint: number | null;
  /** timeOrigin → React's first painted screen. The number that matters most. */
  toAppReady: number;
  /** DOM ready → app ready: how much of the wait is our own JavaScript booting. */
  scriptBoot: number;
}

export type ColdStartVerdict =
  | { usable: true; phases: ColdStartPhases; surface: 'app' | 'web' }
  | { usable: false; reason: 'not-a-launch' | 'backgrounded' | 'incomplete' };

/** Anything beyond this is not a launch measurement, it is a stalled tab or a clock that moved. */
export const MAX_PLAUSIBLE_COLD_START_MS = 120_000;

/**
 * Turn raw timings into a sample, or say honestly why there isn't one.
 *
 * Every rejection is a case whose timings a human never experienced. They are named rather than
 * silently dropped, because "we got no samples" and "we got samples and threw them away" lead to very
 * different next steps.
 */
export function coldStartVerdict(input: ColdStartInput): ColdStartVerdict {
  if (input.navigationType !== undefined && input.navigationType !== 'navigate') {
    // 'reload' and 'back_forward' reuse a warm process and a warm cache; neither is a cold start.
    return { usable: false, reason: 'not-a-launch' };
  }
  if (input.wasHiddenDuringLaunch) {
    // Nobody watched this one: a background pre-warm, or the user switched away mid-launch. Browsers
    // also throttle timers in a hidden document, so the numbers would be long AND meaningless.
    return { usable: false, reason: 'backgrounded' };
  }
  const { responseStart, domContentLoaded, appReady } = input;
  if (
    typeof responseStart !== 'number' ||
    typeof domContentLoaded !== 'number' ||
    typeof appReady !== 'number' ||
    appReady <= 0
  ) {
    return { usable: false, reason: 'incomplete' };
  }
  if (appReady > MAX_PLAUSIBLE_COLD_START_MS) return { usable: false, reason: 'incomplete' };

  const fcp = typeof input.firstContentfulPaint === 'number' ? Math.round(input.firstContentfulPaint) : null;
  return {
    usable: true,
    surface: input.nativeShell ? 'app' : 'web',
    phases: {
      toFirstByte: Math.round(responseStart),
      toDomReady: Math.round(domContentLoaded),
      toFirstPaint: fcp,
      toAppReady: Math.round(appReady),
      // Clamped at 0: the two clocks come from different entries and a sub-millisecond ordering
      // quirk must never be reported as a negative duration.
      scriptBoot: Math.max(0, Math.round(appReady - domContentLoaded)),
    },
  };
}

/** The analytics event name. One constant so the sender and any later reader cannot drift. */
export const COLD_START_EVENT = 'cold_start';

/** The payload shape posted to /api/analytics/event — flat, so it is readable without a schema. */
export function coldStartPayload(verdict: Extract<ColdStartVerdict, { usable: true }>): Record<string, unknown> {
  return {
    surface: verdict.surface,
    ...verdict.phases,
    // Stated in the payload itself, not only in this file: whoever reads a dashboard built from these
    // rows must know the native prelude is missing from them.
    excludesNativeLaunch: verdict.surface === 'app',
  };
}
