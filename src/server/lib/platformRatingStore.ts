// RATE NAVBHARATAI — the durable record (rules: platformRatingRules.ts).
//
// One document per user in `platform_ratings`, keyed by uid, so "has this person rated?" is a single
// read that holds on every device they sign in from. A browser flag would forget on a new phone and
// ask a user who rated yesterday — exactly what the admin said must not happen.
//
// Reads fail SAFE: a store that cannot answer means "do not ask", never a card that fires for someone
// who already rated. Writes fail LOUD (`RatingUnavailable`) so the route can say "not saved" instead of
// thanking the user for a rating that went nowhere.
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import {
  afterDismiss, hasRated, shouldAskForRating, summarizeRatings,
  type RatingRecord, type RatingSubmission, type RatingSummary, type RatingPlatform,
} from './platformRatingRules';

export const PLATFORM_RATINGS_COLLECTION = 'platform_ratings';

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Thrown only by writes, so a route can say "not saved" instead of pretending. */
export class RatingUnavailable extends Error {
  constructor() { super('Ratings are unavailable'); }
}
function needDb(): admin.firestore.Firestore {
  const db = getDb();
  if (!db) throw new RatingUnavailable();
  return db;
}

function toRecord(data: admin.firestore.DocumentData | undefined): RatingRecord | null {
  if (!data) return null;
  const rec: RatingRecord = {};
  if (Number.isInteger(data.stars)) rec.stars = data.stars;
  if (typeof data.comment === 'string') rec.comment = data.comment;
  if (Number.isFinite(data.ratedAt)) rec.ratedAt = data.ratedAt;
  if (Number.isFinite(data.dismissCount)) rec.dismissCount = data.dismissCount;
  if (Number.isFinite(data.snoozedUntil)) rec.snoozedUntil = data.snoozedUntil;
  return rec;
}

export interface RatingStatus {
  ask: boolean;
  rated: boolean;
}

/** Should this user see the card now? Any failure answers "no" (see header). */
export async function ratingStatus(uid: string, nowMs: number): Promise<RatingStatus> {
  const db = getDb();
  if (!db || !uid) return { ask: false, rated: false };
  try {
    const snap = await db.collection(PLATFORM_RATINGS_COLLECTION).doc(uid).get();
    const rec = snap.exists ? toRecord(snap.data()) : null;
    return { ask: shouldAskForRating(rec, nowMs), rated: hasRated(rec) };
  } catch {
    return { ask: false, rated: false };
  }
}

/** Save (or replace) the user's rating. Clears any "Not now" pause — they have answered. */
export async function saveRating(
  who: { uid: string; email: string | null }, sub: RatingSubmission, nowMs: number,
): Promise<void> {
  const db = needDb();
  await db.collection(PLATFORM_RATINGS_COLLECTION).doc(who.uid).set({
    uid: who.uid,
    email: who.email ?? null,
    stars: sub.stars,
    comment: sub.comment,
    platform: sub.platform,
    ratedAt: nowMs,
    snoozedUntil: admin.firestore.FieldValue.delete(),
  }, { merge: true });
}

/** "Not now": record the dismissal and the pause, in a transaction so two taps cannot both count. */
export async function dismissRating(uid: string, nowMs: number): Promise<void> {
  const db = needDb();
  const ref = db.collection(PLATFORM_RATINGS_COLLECTION).doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = afterDismiss(snap.exists ? toRecord(snap.data()) : null, nowMs);
    if (hasRated(next)) return; // a stale card cannot pause a user who has already rated
    tx.set(ref, { uid, dismissCount: next.dismissCount, snoozedUntil: next.snoozedUntil }, { merge: true });
  });
}

export interface RatingRow {
  uid: string;
  email: string | null;
  stars: number;
  comment: string;
  platform: RatingPlatform;
  ratedAt: number;
}

export interface RatingsOverview extends RatingSummary {
  recent: RatingRow[];
}

/**
 * For the admin: per-star counts over EVERY rating (five count aggregations — exact, not a sample),
 * plus the newest ratings with their notes. Throws `RatingUnavailable` when there is no database, so
 * the card shows an error rather than "0 ratings".
 */
export async function ratingsOverview(recentLimit = 100): Promise<RatingsOverview> {
  const db = needDb();
  const col = db.collection(PLATFORM_RATINGS_COLLECTION);
  const counts = await Promise.all([1, 2, 3, 4, 5].map(async (s) => (await col.where('stars', '==', s).count().get()).data().count));
  const snap = await col.orderBy('ratedAt', 'desc').limit(Math.max(1, Math.min(500, recentLimit))).get();
  const recent: RatingRow[] = [];
  for (const d of snap.docs) {
    const x = d.data();
    if (!Number.isInteger(x.stars)) continue;
    recent.push({
      uid: typeof x.uid === 'string' ? x.uid : d.id,
      email: typeof x.email === 'string' ? x.email : null,
      stars: x.stars,
      comment: typeof x.comment === 'string' ? x.comment : '',
      platform: x.platform === 'android' || x.platform === 'ios' ? x.platform : 'web',
      ratedAt: Number(x.ratedAt) || 0,
    });
  }
  return { ...summarizeRatings(counts), recent };
}
