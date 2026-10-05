// A STORE REVIEW THAT TAKES SOMETHING DOWN CARRIES THE ADMIN'S OWN REASON (Q-681, admin-approved (b) 2026-10-05).
//
// The gallery, App Mart APK and App Mart web reviews accepted a reject/remove with no note, so the 180-day
// removal record could read "removed by admin" — a sentence nobody wrote. Worse, the App Mart "Remove" button
// SENT one on the admin's behalf: "Removed by an admin from the app page". The same class PR 1 closed for
// bans and token changes (`adminActionReason.ts`), on the three routes it did not reach.
//
// THE ADMIN CHOSE (b): require it from the next store bundle, so the Remove button in phone builds already
// installed keeps working. So the rule has two halves, both read here:
//   • A client that knows the rule says so with `reasonContract: 1`. It MUST send a real reason — the
//     screen keeps the button disabled, and the server refuses a request without one.
//   • A request without the marker is an older bundled app. Accepted, but recorded honestly as "no reason
//     given (older app build)", never as a reason someone typed — and its fabricated placeholder is read as
//     exactly that. `LEGACY_REVIEW_CLIENTS_ACCEPTED` turns this half off once the next store bundle has
//     shipped (BUILD_REPORT_QUEUE Q-681).
//
// PURE: no React, no I/O. Read by the screens (to keep the button disabled) and by the server.

import { readAdminReason } from './adminActionReason';

/** The marker a client that enforces the reason sends with every review decision. */
export const REVIEW_REASON_CONTRACT = 1;

/**
 * Whether a review request WITHOUT the marker (a phone build made before this rule) is still accepted.
 * 🔒 Flip to false once the store bundle carrying this client is live — Q-681 tracks that step.
 */
export const LEGACY_REVIEW_CLIENTS_ACCEPTED = true;

/** The sentence the old App Mart client filled in on the admin's behalf. Never recorded as a reason. */
const FABRICATED_LEGACY_NOTES = new Set(['removed by an admin from the app page']);

/** What the removal record says when an older build sent no reason. */
export const NO_REASON_LEGACY = 'No reason given (decision made from an older app build)';

export type ReviewReasonRead =
  | { ok: true; reason: string | null; legacy: boolean; error?: undefined }
  | { ok: false; error: string; reason?: undefined; legacy?: undefined };

/**
 * Read the reason for a review decision. `takesDown` is true for reject / remove — the decisions that
 * delete someone's work. An approval needs no reason; a note given with one is kept.
 */
export function readReviewReason(body: { note?: unknown; reasonContract?: unknown } | null | undefined, takesDown: boolean): ReviewReasonRead {
  const raw = body?.note;
  if (!takesDown) {
    const note = typeof raw === 'string' ? raw.trim().slice(0, 500) : '';
    return { ok: true, reason: note || null, legacy: false };
  }
  const read = readAdminReason(raw);
  const modern = body?.reasonContract === REVIEW_REASON_CONTRACT;
  // `in` narrows under the client's non-strict tsconfig, where `read.ok` does not.
  if ('reason' in read) {
    if (!modern && FABRICATED_LEGACY_NOTES.has(read.reason.toLowerCase())) return { ok: true, reason: null, legacy: true };
    return { ok: true, reason: read.reason, legacy: false };
  }
  if (modern || !LEGACY_REVIEW_CLIENTS_ACCEPTED) return { ok: false, error: read.error };
  return { ok: true, reason: null, legacy: true };
}

/** The reason the removal record and the audit line carry. */
export function recordedReviewReason(read: { reason: string | null; legacy: boolean }): string {
  return read.reason ?? NO_REASON_LEGACY;
}
