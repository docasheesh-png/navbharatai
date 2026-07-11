// Mobile engagement decisions — PURE, dependency-free logic for the two native-app features
// (admin request 2026-07-11):
//   1. Play In-App UPDATE prompt — when a newer versionCode is live on the Play Store (i.e. the admin
//      uploaded a new signed .aab), tell the user an update is available.
//   2. Play In-App REVIEW prompt — after the user has genuinely engaged with the app, ask for a rating
//      at a good moment (like every professional app), without nagging.
//
// This module holds ONLY the decision math so it is fully unit-testable with no native runtime. The
// thin plugin glue (Capacitor + the two plugins) lives in `mobileNative.ts`, which calls into here.

/**
 * Whether the Play Store reports an update available for the installed app.
 * Mirrors `AppUpdateAvailability.UPDATE_AVAILABLE === 2` from @capawesome/capacitor-app-update, kept
 * as a literal so this module needs no native import. (0 UNKNOWN, 1 NOT_AVAILABLE, 3 IN_PROGRESS.)
 */
export function updateIsAvailable(updateAvailability: number | null | undefined): boolean {
  return updateAvailability === 2;
}

/** Persisted engagement state for the review prompt (stored as JSON in localStorage). */
export interface ReviewPromptState {
  /** Times the app shell has started (incremented once per app open). */
  openCount: number;
  /** Epoch ms of the very first open we ever recorded (proxy for "install age"). */
  firstOpenAtMs: number | null;
  /** Epoch ms we last SHOWED the native review card (so we never nag). */
  lastPromptedAtMs: number | null;
}

// Tuned like professional apps: ask only after real engagement, never on first run, never repeatedly.
export const REVIEW_MIN_OPENS = 3;                                   // at least a few sessions in
export const REVIEW_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000;           // and ≥ 2 days since first open
export const REVIEW_REPROMPT_MS = 120 * 24 * 60 * 60 * 1000;        // and not asked in the last 120 days

/** The zero state for a brand-new install. */
export function emptyReviewState(): ReviewPromptState {
  return { openCount: 0, firstOpenAtMs: null, lastPromptedAtMs: null };
}

/**
 * Parse the persisted state defensively — any missing/corrupt field degrades to a safe default so a
 * bad localStorage value can never crash the app or wrongly fire the prompt. Never throws.
 */
export function parseReviewState(raw: string | null | undefined): ReviewPromptState {
  if (!raw) return emptyReviewState();
  try {
    const o = JSON.parse(raw) as Partial<ReviewPromptState>;
    const openCount = Number(o?.openCount);
    const firstOpenAtMs = Number(o?.firstOpenAtMs);
    const lastPromptedAtMs = Number(o?.lastPromptedAtMs);
    return {
      openCount: Number.isFinite(openCount) && openCount > 0 ? Math.floor(openCount) : 0,
      firstOpenAtMs: Number.isFinite(firstOpenAtMs) && firstOpenAtMs > 0 ? firstOpenAtMs : null,
      lastPromptedAtMs: Number.isFinite(lastPromptedAtMs) && lastPromptedAtMs > 0 ? lastPromptedAtMs : null,
    };
  } catch {
    return emptyReviewState();
  }
}

/** Advance the state for one app open: bump the counter, stamp the first-open time once. Pure. */
export function registerAppOpen(prev: ReviewPromptState, nowMs: number): ReviewPromptState {
  return {
    openCount: prev.openCount + 1,
    firstOpenAtMs: prev.firstOpenAtMs ?? nowMs,
    lastPromptedAtMs: prev.lastPromptedAtMs,
  };
}

/**
 * Decide whether to show the native review card NOW: enough opens, enough age since first open, and
 * not prompted within the reprompt window. Pure — the caller supplies the (already open-incremented)
 * state and the current time.
 */
export function shouldRequestReview(s: ReviewPromptState, nowMs: number): boolean {
  if (s.openCount < REVIEW_MIN_OPENS) return false;
  if (s.firstOpenAtMs == null || nowMs - s.firstOpenAtMs < REVIEW_MIN_AGE_MS) return false;
  if (s.lastPromptedAtMs != null && nowMs - s.lastPromptedAtMs < REVIEW_REPROMPT_MS) return false;
  return true;
}
