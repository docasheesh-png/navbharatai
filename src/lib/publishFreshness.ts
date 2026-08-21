// IS THE LIVE SITE STILL THE APP THE USER HAS? — the question nobody was asking them.
//
// WHY THIS EXISTS (admin, 2026-08-21). The request was "put a Publish button above the Visit link, so
// the app can be published again after editing it". A button answers *how do I republish* — but the
// thing that actually leaves people with a stale public site is the OTHER half: nobody tells them
// their live site is older than their app. They edit, they are happy, and mitrify.com keeps serving
// last week's build. So the button says what it will DO, and that is decided here.
//
// 🔒 HONESTY (rule 2). Both timestamps are real and come from the SAME server clock:
//   • `publishedAt`  — `DeploymentRecord.updatedAt`, stamped when the bytes actually went live.
//   • `filesSavedAt` — the durable workspace doc's `savedAt`, rewritten by every save/merge/remove.
// When either is missing we return `unknown` and the UI says NOTHING about staleness — an invented
// "you have unpublished changes" would send people to re-publish an already-current site forever,
// which is exactly the kind of confident-but-wrong signal this file exists to prevent.
//
// PURE — no I/O, no clock of its own (`now` is passed in), fully unit-testable.

export type PublishFreshness =
  /** Nothing has ever been published for this workspace — publishing is the missing step. */
  | 'never_published'
  /** The live site was published AFTER the last file change: what people see is current. */
  | 'up_to_date'
  /** Files changed after the last publish — the live site is behind the app. */
  | 'changed'
  /** We cannot tell (a record predating this signal, or a store we could not read). Say nothing. */
  | 'unknown';

export interface FreshnessInput {
  /** Is there a genuinely LIVE deployment right now? (An unpublished/taken-down app is not live.) */
  live: boolean;
  /** When the live bytes were published (ms). */
  publishedAt?: number | null;
  /** When the workspace's files were last written durably (ms). */
  filesSavedAt?: number | null;
}

/**
 * Decide what the live site's freshness is. Pure.
 *
 * Ordering note: a build SAVES its files and only then publishes them, so a normal publish leaves
 * `publishedAt > filesSavedAt` and reads as up-to-date. Equal timestamps are treated as up-to-date
 * too — a save and a publish landing in the same millisecond is the publish OF that save, and
 * calling it stale would flag every fast build as needing a republish.
 */
export function publishFreshness(input: FreshnessInput): PublishFreshness {
  if (!input.live) return 'never_published';
  const published = numberOrNull(input.publishedAt);
  const saved = numberOrNull(input.filesSavedAt);
  // A live deployment whose own timestamp we cannot read tells us nothing to compare against.
  if (published === null || saved === null) return 'unknown';
  return saved > published ? 'changed' : 'up_to_date';
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Should this surface show the red dot? (admin 2026-08-21: "edit karte hai, ek red dot ana chahiye —
 * publish (*) → connect your own domain (*) → publish (green)(*)".)
 *
 * The dot is a TRAIL: it appears on the outer Publish button so the change is noticed, and repeats on
 * each step so it can be followed to the button that fixes it. Every one of those surfaces asks this
 * function, so the trail can never disagree with itself.
 *
 * 🔒 It means exactly ONE thing: published, then changed. Deliberately NOT `never_published` — an app
 * the user has not chosen to publish is not a problem to nag about, and a dot that never clears is a
 * dot people stop seeing, which would cost us the one case it exists for. `unknown` shows nothing,
 * because a dot is a claim and we do not make claims we did not measure. PURE.
 */
export function needsPublishDot(freshness: PublishFreshness | undefined | null): boolean {
  return freshness === 'changed';
}

/**
 * "4 minutes ago" — in whole units, never a false precision like "0 minutes ago". Pure.
 * A future timestamp (clock skew between two writes) degrades to "just now" rather than "in -2 min".
 */
export function timeAgo(then: number, now: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}
