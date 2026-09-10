// "Report this conversion exactly once" — one implementation, used by every conversion we report.
//
// WHY THIS IS SHARED AND NOT WRITTEN TWICE: the signup signal and the purchase signal need the same
// guard for the same reason, and two copies of a dedupe rule are two copies that drift (the fourth
// absolute rule's "fix the class, not the instance" — cf. the four drifted copies of safeRelPath
// that became one shared workspacePath.ts).
//
// WHY A GUARD IS NEEDED AT ALL: the events we report are re-derivable from state that outlives the
// event. onAuthStateChanged fires on every page load and token refresh while Firebase keeps
// reporting the same creationTime; a payment can be verified again by a second redirect or a manual
// re-check. Without this, one registration or one sale would be re-reported every time — silently
// inflating the exact numbers ad spend is optimised against. Nobody is harmed, and the measurement
// is still a lie, so it gets a structural fix rather than a comment asking callers to be careful.

/** Keep the list short — this is a dedupe guard, not a purchase history. */
export const MAX_REMEMBERED = 5;

/** Pure: parse a stored key list, tolerating anything a previous version or a user may have left. */
export function parseReported(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string' && !!k) : [];
  } catch {
    return [];
  }
}

export interface ReportDecision {
  /** Fire the conversion? */
  report: boolean;
  /** The value to persist back, or null when nothing changed. */
  nextStored: string | null;
}

/**
 * Pure: should this conversion be reported, and what should be remembered afterwards?
 *
 * `eligible` is the caller's own domain test (is this really a new account / a really-credited
 * payment); this function only decides the once-ness. Separated from the I/O so every branch is
 * testable without a DOM.
 */
export function decideReportOnce(
  rawStored: string | null | undefined,
  key: string,
  eligible: boolean,
  max = MAX_REMEMBERED,
): ReportDecision {
  if (!key || !eligible) return { report: false, nextStored: null };
  const already = parseReported(rawStored);
  if (already.includes(key)) return { report: false, nextStored: null };
  return { report: true, nextStored: JSON.stringify([key, ...already].slice(0, max)) };
}
