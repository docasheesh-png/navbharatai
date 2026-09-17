// WHAT THE FLOATING ADMIN COPY BUTTON SHOULD PUT ON THE CLIPBOARD.
//
// 🔴 ADMIN 2026-09-17: *"jab build report copy ki jaye to json formate me hi copy ho. abhi text me
// copy ho rahi hai."*
//
// The floating button copies the PAGE AS TEXT, and for an ordinary admin screen that is right and
// deliberate (see `AdminCopyButton`'s header and `pageSnapshot.ts`: a browser cannot photograph its
// own window, and a text outline carries more of what a fix needs than a picture). But when a BUILD
// REPORT is open, that same press produces a DOM outline of a 153-issue JSON document — flattened,
// truncated, and unparseable. The report's own Copy button already yields JSON; the floating one is
// simply bigger, on top, and the obvious thing to press.
//
// 🔒 THE PAYLOAD IS REGISTERED, NOT SCRAPED BACK OUT OF THE DOM. The dashboard has already resolved
// the exact JSON (`partJson`), so reading it back out of rendered markup would be a RECONSTRUCTION
// that can silently differ from the real report — a copy that looks like the report and is not one is
// worse than an honest text dump. This module only chooses between payloads that already exist.
//
// ⚠️ The admin's own request in `adminReportParts.ts` (2026-08-09) ends *"build report JSON me hi copy
// ho, text me nahi"* — the same instruction, made about the report panel's own button. This is its
// sibling, hunted two days later than it should have been.
//
// PURE — no DOM, no clipboard, so the CHOICE is unit-testable.

export interface AdminCopyPayload {
  /** What the confirmation calls it: "2nd part", "APK build report"… */
  label: string;
  /** The exact text to copy. Already JSON — this module never stringifies. */
  json: string;
}

export interface AdminCopyCandidates {
  /** The APK build-report modal's payload, when that modal is open. */
  apkReport?: AdminCopyPayload | null;
  /** The build-report viewer's CHOSEN part, when that viewer is open. */
  buildReport?: AdminCopyPayload | null;
}

/**
 * Which payload wins, or null for "copy the page as text".
 *
 * The APK modal is checked first because it is the one that opens ON TOP of the reports tab — if both
 * are somehow set, the one the admin is looking at is the newer overlay.
 *
 * A candidate with an EMPTY `json` yields null rather than an empty copy: `copyTextToClipboard`
 * already refuses empty text, and silently wiping the admin's clipboard is the failure that looks
 * exactly like success. Falling back to the page text is strictly better than copying nothing.
 */
export function chooseAdminCopyPayload(c: AdminCopyCandidates): AdminCopyPayload | null {
  for (const candidate of [c.apkReport, c.buildReport]) {
    if (candidate && typeof candidate.json === 'string' && candidate.json.trim()) {
      return { label: candidate.label || 'Report', json: candidate.json };
    }
  }
  return null;
}

/** The confirmation line. It names JSON explicitly, so the admin can see WHICH copy they just took. */
export function copyStatusText(payload: AdminCopyPayload | null, pageLines: number): string {
  return payload
    ? `${payload.label} copied as JSON — paste it in the chat`
    : `Page copied (${pageLines} lines) — paste it in the chat`;
}
