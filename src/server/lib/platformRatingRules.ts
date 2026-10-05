// RATE NAVBHARATAI — the rules, PURE (admin 2026-10-05: "rating system banao! jab bhi user ki app
// badhiya bane, user usko deploy kare successfully, tabhi rating ka notification aa jaye! jis user ne
// rating nahi kari hai, uske liye!!").
//
// WHAT THIS IS, AND WHAT IT IS NOT. A rating of NavBharatAI itself, asked at the one moment a user has
// just watched their own app go live — the best moment they will have with the product. It is NOT the
// Play/App Store review card (`mobileEngagement.ts`, opened on app start after real engagement). That
// card stays as it was and is deliberately NOT chained to this one: Play's in-app review guidelines
// forbid asking for an opinion before showing the store card, and forwarding only happy users to the
// store is review gating. So the two never talk to each other; this one keeps its answers in our own
// database, where the admin can read every low rating and its reason.
//
// THE ONE RULE THE ADMIN SET: a user who has rated is never asked again. A user who has not is asked
// after a successful publish — but "Not now" is respected with a growing pause, so a person who
// publishes ten times in a day is not asked ten times.

/** The longest note a rating keeps. Enough for a real reason; short enough to read in a list. */
export const MAX_RATING_COMMENT_CHARS = 500;

/** Where the user rated from — so the admin can tell a phone complaint from a web one. */
export type RatingPlatform = 'web' | 'android' | 'ios';

/** One user's rating record. Stored one per user (doc id = uid), so "has rated" is one read. */
export interface RatingRecord {
  /** 1–5 once the user has rated; absent while they have only said "Not now". */
  stars?: number;
  comment?: string;
  ratedAt?: number;
  /** How many times the user chose "Not now" — drives the growing pause. */
  dismissCount?: number;
  /** Epoch ms before which the user is not asked again. */
  snoozedUntil?: number;
}

export interface RatingSubmission {
  stars: number;
  comment: string;
  platform: RatingPlatform;
}

/**
 * The pause after each "Not now": three days, then a week, then a month for every later one.
 * Never "never" — the admin asked that users who have NOT rated be asked — but rare enough that a
 * person who keeps declining is asked about once a month at most.
 */
export const SNOOZE_LADDER_MS = [3, 7, 30].map((d) => d * 24 * 60 * 60 * 1000);

export function snoozeAfter(dismissCount: number): number {
  const i = Math.max(0, Math.min(SNOOZE_LADDER_MS.length - 1, Math.floor(dismissCount) - 1));
  return SNOOZE_LADDER_MS[i];
}

/** Has this record a real rating? A record that only carries "Not now" data has not. */
export function hasRated(rec: RatingRecord | null | undefined): boolean {
  const s = Number(rec?.stars);
  return Number.isInteger(s) && s >= 1 && s <= 5;
}

/**
 * Should this user be asked now? Only a signed-in user is ever asked (the record is keyed by uid),
 * never one who has rated, and never inside a "Not now" pause.
 */
export function shouldAskForRating(rec: RatingRecord | null | undefined, nowMs: number): boolean {
  if (hasRated(rec)) return false;
  const until = Number(rec?.snoozedUntil);
  if (Number.isFinite(until) && until > nowMs) return false;
  return true;
}

/** The record after one more "Not now". Leaves a real rating untouched (a stale card cannot undo it). */
export function afterDismiss(rec: RatingRecord | null | undefined, nowMs: number): RatingRecord {
  const prev = rec ?? {};
  if (hasRated(prev)) return { ...prev };
  const dismissCount = (Number.isFinite(Number(prev.dismissCount)) ? Math.max(0, Math.floor(Number(prev.dismissCount))) : 0) + 1;
  return { ...prev, dismissCount, snoozedUntil: nowMs + snoozeAfter(dismissCount) };
}

/** Collapse control characters and runs of blank lines; trim; cap. The note is shown to the admin. */
export function cleanRatingComment(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const flat = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return flat.length > MAX_RATING_COMMENT_CHARS ? flat.slice(0, MAX_RATING_COMMENT_CHARS).trimEnd() : flat;
}

/**
 * Read a submission body. Stars must be a whole number 1–5 (a string "4" from a form is accepted;
 * 4.5, 0, 6 and "great" are not). Anything else returns null and the route answers 400 — a rating is
 * never invented from a malformed body.
 */
export function parseRatingSubmission(body: unknown): RatingSubmission | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const stars = typeof b.stars === 'string' && /^\d$/.test(b.stars.trim()) ? Number(b.stars.trim()) : b.stars;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  const platform: RatingPlatform = b.platform === 'android' || b.platform === 'ios' ? b.platform : 'web';
  return { stars, comment: cleanRatingComment(b.comment), platform };
}

export interface RatingSummary {
  count: number;
  /** Mean of all ratings, one decimal; null when nobody has rated yet (never a fake 0.0). */
  average: number | null;
  /** distribution[0] is 1-star … distribution[4] is 5-star. */
  distribution: [number, number, number, number, number];
}

/** The summary from per-star counts. Pure, so the admin card and its test agree on the arithmetic. */
export function summarizeRatings(perStar: ReadonlyArray<number>): RatingSummary {
  const d = [0, 1, 2, 3, 4].map((i) => {
    const n = Number(perStar[i]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }) as RatingSummary['distribution'];
  const count = d.reduce((a, b) => a + b, 0);
  const total = d.reduce((a, n, i) => a + n * (i + 1), 0);
  return { count, average: count ? Math.round((total / count) * 10) / 10 : null, distribution: d };
}
