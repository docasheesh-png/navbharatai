// RATE NAVBHARATAI — the client half (server: src/server/routes/platformRating.ts).
//
// Admin 2026-10-05: "jab bhi user ki app badhiya bane, user usko deploy kare successfully, tabhi rating
// ka notification aa jaye! jis user ne rating nahi kari hai, uske liye!!"
//
// THE MOMENT is a publish that went live. Every place that publishes calls `announceRatingMoment()`
// after its success (the Publish sheet once its celebration card is closed, Connect my website on its
// success), and ONE listener — `PlatformRatingHost`, mounted once at the app root — decides whether to
// show the card. One listener means a new publish surface needs one line, not a second card.
//
// THE PERSON is decided by the server from their durable record (rated → never again; "Not now" → a
// growing pause). The browser only adds "at most once per session", so a user who publishes three
// times in ten minutes is not asked three times even before the server's pause is written.

/** The window event a successful, live publish raises. */
export const RATING_MOMENT_EVENT = 'nbai:rating-moment';

/** sessionStorage key: the card was already offered in this session. */
export const RATING_SESSION_KEY = 'nbai_rating_offered_session';

/** Raise the rating moment. Safe anywhere (no window → no-op). */
export function announceRatingMoment(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(RATING_MOMENT_EVENT));
  } catch { /* a rating prompt must never break a publish */ }
}

/**
 * Is this publish result a rating moment? Only a publish the server accepted, that returned a link,
 * and whose link was not proven dead. `linkLive === null` (the probe could not tell) still counts: the
 * server's own deploy already ran its liveness check before answering ok.
 */
export function isRatingMoment(r: { ok: boolean; url: unknown; linkLive: boolean | null }): boolean {
  return r.ok === true && typeof r.url === 'string' && r.url.trim() !== '' && r.linkLive !== false;
}

export interface RatingStatus {
  ask: boolean;
  rated: boolean;
}

/** Read the status body — shape-checked, because a server body is not the answer until it is checked. */
export function readRatingStatus(body: unknown): RatingStatus | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.ask !== 'boolean' || typeof b.rated !== 'boolean') return null;
  return { ask: b.ask, rated: b.rated };
}

/** Was the card already offered in this browser session? A blocked storage counts as "not yet". */
export function offeredThisSession(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const s = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
    return s?.getItem(RATING_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOfferedThisSession(storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    const s = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
    s?.setItem(RATING_SESSION_KEY, '1');
  } catch { /* best effort — the server's pause still holds */ }
}

/** The word under each star, so a choice is never only a colour. */
export const STAR_LABELS = ['Poor', 'Not great', 'Okay', 'Good', 'Excellent'] as const;

export function starLabel(stars: number): string {
  return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? STAR_LABELS[stars - 1] : '';
}

/** What the optional note asks for: a low rating asks what to fix, a high one what worked. */
export function commentPrompt(stars: number): string {
  return stars > 0 && stars <= 3 ? 'What should we fix? (optional)' : 'What did you like? (optional)';
}

/** Same cap as the server (MAX_RATING_COMMENT_CHARS) so the box never accepts what will be cut. */
export const RATING_COMMENT_MAX = 500;
