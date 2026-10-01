// App Mart social — the STORE: where likes, comments, blocks and creator notifications live.
//
// Every decision is made in `appMartSocialRules.ts`; this file only reads and writes. Same pattern as
// the other stores in this folder: firebase-admin, a VITEST-skip `getDb`, and nothing here throws into
// a route — a read that fails returns "nothing" and a write that fails says so to its caller.
//
// THE COLLECTIONS, and why each is shaped the way it is:
//   · app_mart_reactions       — one doc per (app, person); the id IS the pair, so a person can hold
//                                exactly one reaction per app by construction.
//   · app_mart_comments        — one doc per comment. `parentId` is '' for a top-level comment so the
//                                listing is an EQUALITY filter (no composite index to forget to create —
//                                see firestoreIndexSafe.ts for what that mistake costs).
//   · app_mart_comment_reports — what readers reported. A safety record: it outlives the reporter's
//                                account for 180 days, like `safety_flags`.
//   · app_mart_blocks          — one doc per reader: the people whose comments they do not want to see.
//   · app_mart_notifications   — one GROUPED doc per (creator, kind, app, day). Kept for 90 days.
//
// 🔒 COUNTS ARE COUNTED, NOT KEPT. Likes, dislikes and comments are Firestore `count()` aggregations
// over the records themselves, cached for 30 seconds per instance. A separate tally would be a second
// source of truth that drifts — the first account deletion, a failed half-write, or a removed comment
// would leave it showing a number nothing supports. It also avoids a single document that every like
// on a popular app writes to (the hot-document wall in CLAUDE.md's SCALE PLAN).

import * as admin from 'firebase-admin';
import { randomBytes } from 'node:crypto';
import { getServerDb } from './serverDb';
import { listEqNewestFirst } from './firestoreIndexSafe';
import { getWebApp } from './navStoreWeb';
import { getApp } from './navStoreStore';
import { userProfileStore } from './UserProfileStore';
import { creatorDisplayName, publicCreatorId } from './storeCreator';
import { rememberCreatorId } from './appMartCreatorIndex';
import { indiaDay } from './guestDailyQuota';
import { sendPushToUser } from './PushNotificationService';
import {
  type AppKey, type Reaction, type SocialCounts, type StoredComment, type PublicPerson,
  type SocialNotificationDoc, type SocialNotificationKind, type RemovedBy,
  ZERO_COUNTS, reactionDocId, nextReaction, safePhotoUrl, foldActor, socialNotificationDocId,
  socialInboxId, parseSocialInboxId, inboxState, socialNotificationMessage, socialPushBody,
  applyBlock, MAX_REPORT_REASON_CHARS,
} from './appMartSocialRules';

export const APP_MART_REACTIONS_COLLECTION = 'app_mart_reactions';
export const APP_MART_COMMENTS_COLLECTION = 'app_mart_comments';
export const APP_MART_COMMENT_REPORTS_COLLECTION = 'app_mart_comment_reports';
export const APP_MART_BLOCKS_COLLECTION = 'app_mart_blocks';
export const APP_MART_NOTIFICATIONS_COLLECTION = 'app_mart_notifications';

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
export class SocialUnavailable extends Error {
  constructor() { super('App Mart social is unavailable'); }
}
function needDb(): admin.firestore.Firestore {
  const db = getDb();
  if (!db) throw new SocialUnavailable();
  return db;
}

// ─── The app a social action is about ────────────────────────────────────────────────────────────

export interface SocialTarget {
  ownerUid: string;
  name: string;
  /** Can people react and comment right now? A removed or unapproved app cannot be. */
  live: boolean;
}

/** Who owns the app, what it is called, and whether it is on the store. Null when it does not exist. */
export async function resolveTarget(k: AppKey): Promise<SocialTarget | null> {
  try {
    if (k.kind === 'web') {
      const a = await getWebApp(k.id);
      return a ? { ownerUid: a.uid, name: a.name, live: a.status !== 'removed' } : null;
    }
    const a = await getApp(k.id);
    return a ? { ownerUid: a.uid, name: a.appName, live: a.status === 'approved' } : null;
  } catch {
    return null;
  }
}

// ─── People ───────────────────────────────────────────────────────────────────────────────────────

const PEOPLE_CACHE_MS = 10 * 60_000;
const peopleCache = new Map<string, { person: PublicPerson; at: number }>();

async function authRecord(uid: string): Promise<{ displayName?: string | null; photoURL?: string | null } | null> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return await admin.auth().getUser(uid);
  } catch {
    return null;
  }
}

/**
 * How each account appears to other people: display name (never an email — `creatorDisplayName`
 * refuses one), an https photo, and the public creator code. A lookup that fails still yields the
 * code and a neutral name, so a missing profile never hides a comment.
 */
export async function resolvePeople(uids: readonly string[]): Promise<Map<string, PublicPerson>> {
  const out = new Map<string, PublicPerson>();
  const now = Date.now();
  await Promise.all([...new Set(uids.filter(Boolean))].map(async (uid) => {
    const hit = peopleCache.get(uid);
    if (hit && now - hit.at < PEOPLE_CACHE_MS) { out.set(uid, hit.person); return; }
    const profile = await userProfileStore.get(uid).catch(() => null);
    const needAuth = !profile?.displayName?.trim() || !safePhotoUrl(profile?.photoUrl);
    const auth = needAuth ? await authRecord(uid) : null;
    const creatorId = publicCreatorId(uid);
    const person: PublicPerson = {
      name: creatorDisplayName(profile?.displayName, auth?.displayName),
      photoUrl: safePhotoUrl(profile?.photoUrl) || safePhotoUrl(auth?.photoURL),
      creatorId,
    };
    rememberCreatorId(creatorId, uid);
    peopleCache.set(uid, { person, at: now });
    out.set(uid, person);
  }));
  return out;
}

// ─── Counts ───────────────────────────────────────────────────────────────────────────────────────

const COUNT_CACHE_MS = 30_000;
const countCache = new Map<string, { counts: SocialCounts; at: number }>();

function forgetCounts(appKey: string): void {
  countCache.delete(appKey);
}

async function countOf(q: admin.firestore.Query): Promise<number> {
  const snap = await q.count().get();
  return Number(snap.data().count) || 0;
}

/** Real counts for each app, from the records themselves. A failed count reads as "not known" (omitted). */
export async function countsFor(keys: readonly string[]): Promise<Record<string, SocialCounts>> {
  const db = getDb();
  const out: Record<string, SocialCounts> = {};
  if (!db) return out;
  const now = Date.now();
  await Promise.all(keys.map(async (key) => {
    const hit = countCache.get(key);
    if (hit && now - hit.at < COUNT_CACHE_MS) { out[key] = hit.counts; return; }
    try {
      const reactions = db.collection(APP_MART_REACTIONS_COLLECTION).where('appKey', '==', key);
      const [likes, dislikes, comments] = await Promise.all([
        countOf(reactions.where('kind', '==', 'like')),
        countOf(reactions.where('kind', '==', 'dislike')),
        countOf(db.collection(APP_MART_COMMENTS_COLLECTION).where('appKey', '==', key).where('visible', '==', true)),
      ]);
      const counts = { likes, dislikes, comments };
      countCache.set(key, { counts, at: now });
      out[key] = counts;
    } catch { /* omitted: the screen shows no number rather than a wrong one */ }
  }));
  if (countCache.size > 5000) countCache.clear();
  return out;
}

// ─── Reactions ────────────────────────────────────────────────────────────────────────────────────

/** The viewer's own reaction on each app. */
export async function myReactions(keys: readonly string[], uid: string): Promise<Record<string, Reaction>> {
  const db = getDb();
  const out: Record<string, Reaction> = {};
  if (!db || !uid || keys.length === 0) return out;
  try {
    const refs = keys.map((k) => db.collection(APP_MART_REACTIONS_COLLECTION).doc(reactionDocId(k, uid)));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s, i) => {
      const kind = s.exists ? s.data()?.kind : null;
      if (kind === 'like' || kind === 'dislike') out[keys[i]] = kind;
    });
  } catch { /* the buttons simply show as not pressed */ }
  return out;
}

/**
 * Press 👍 or 👎. One transaction on the person's own reaction document, so two quick taps cannot
 * leave two reactions. Returns the reaction now held and whether this press ADDED a like (the only
 * press that notifies the creator).
 */
export async function pressReaction(appKey: string, uid: string, pressed: Reaction): Promise<{ mine: Reaction | null; newLike: boolean }> {
  const db = needDb();
  const ref = db.collection(APP_MART_REACTIONS_COLLECTION).doc(reactionDocId(appKey, uid));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? ((snap.data()?.kind as Reaction | undefined) ?? null) : null;
    const next = nextReaction(current, pressed);
    if (next === null) tx.delete(ref);
    else tx.set(ref, { appKey, uid, kind: next, at: Date.now() });
    return { mine: next, newLike: next === 'like' && current !== 'like' };
  });
  forgetCounts(appKey);
  return result;
}

/** Who liked an app, newest first. There is deliberately no function that lists who DISLIKED. */
export async function likersOf(appKey: string, limit = 200): Promise<Array<PublicPerson & { at: number }>> {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await listEqNewestFirst<{ uid: string; at: number }>(
      db.collection(APP_MART_REACTIONS_COLLECTION), [['appKey', appKey], ['kind', 'like']], 'at', limit,
    );
    const people = await resolvePeople(rows.map((r) => r.uid));
    return rows.map((r) => ({ ...(people.get(r.uid) ?? { name: 'NavBharatAI user', photoUrl: '', creatorId: publicCreatorId(r.uid) }), at: r.at }));
  } catch {
    return [];
  }
}

// ─── Comments ─────────────────────────────────────────────────────────────────────────────────────

function newCommentId(): string {
  return `c${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

function toStored(data: admin.firestore.DocumentData): StoredComment {
  return {
    id: String(data.id ?? ''),
    appKey: String(data.appKey ?? ''),
    uid: String(data.uid ?? ''),
    text: String(data.text ?? ''),
    parentId: String(data.parentId ?? ''),
    createdAt: Number(data.createdAt) || 0,
    visible: data.visible === true,
    replyCount: Math.max(0, Number(data.replyCount) || 0),
    removedBy: data.removedBy as RemovedBy | undefined,
    removedAt: typeof data.removedAt === 'number' ? data.removedAt : undefined,
  };
}

export async function getComment(id: string): Promise<StoredComment | null> {
  const db = getDb();
  if (!db || !/^c[0-9a-z]{6,40}$/.test(id)) return null;
  try {
    const snap = await db.collection(APP_MART_COMMENTS_COLLECTION).doc(id).get();
    return snap.exists ? toStored(snap.data() ?? {}) : null;
  } catch {
    return null;
  }
}

/** Top-level comments on an app (parentId ''), or the replies under one comment. */
export async function listComments(appKey: string, parentId: string): Promise<StoredComment[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const filters: Array<readonly [string, unknown]> = parentId
      ? [['parentId', parentId]]
      : [['appKey', appKey], ['parentId', '']];
    const rows = await listEqNewestFirst<StoredComment>(
      db.collection(APP_MART_COMMENTS_COLLECTION), filters, 'createdAt', 500, 500, (_id, d) => toStored(d),
    );
    // A reply lookup is by parent alone; the app check keeps a forged parent id from pulling another app's thread.
    return rows.filter((c) => c.appKey === appKey);
  } catch {
    return [];
  }
}

/** Save a comment (or a reply, under `parent`). Replies are one level deep, the way YouTube does it. */
export async function addComment(input: { appKey: string; uid: string; text: string; parent: StoredComment | null }): Promise<StoredComment> {
  const db = needDb();
  const c: StoredComment = {
    id: newCommentId(),
    appKey: input.appKey,
    uid: input.uid,
    text: input.text,
    parentId: input.parent ? input.parent.id : '',
    createdAt: Date.now(),
    visible: true,
    replyCount: 0,
  };
  await db.collection(APP_MART_COMMENTS_COLLECTION).doc(c.id).set(c);
  if (input.parent) {
    await db.collection(APP_MART_COMMENTS_COLLECTION).doc(input.parent.id)
      .update({ replyCount: admin.firestore.FieldValue.increment(1) })
      .catch(() => { /* the reply exists; only the "N replies" hint on its parent lags */ });
  }
  forgetCounts(input.appKey);
  return c;
}

/** Take a comment down. Its text is erased, not merely hidden, and its open reports are closed. */
export async function removeComment(c: StoredComment, by: RemovedBy): Promise<void> {
  const db = needDb();
  await db.collection(APP_MART_COMMENTS_COLLECTION).doc(c.id).update({
    visible: false, text: '', removedBy: by, removedAt: Date.now(),
  });
  if (c.parentId && c.visible) {
    await db.collection(APP_MART_COMMENTS_COLLECTION).doc(c.parentId)
      .update({ replyCount: admin.firestore.FieldValue.increment(-1) })
      .catch(() => { /* the parent may itself be gone */ });
  }
  forgetCounts(c.appKey);
  await resolveReportsFor(c.id, by === 'admin' ? 'removed' : 'removed-by-owner').catch(() => undefined);
}

// ─── Reports (the moderation queue) ──────────────────────────────────────────────────────────────

export interface CommentReport {
  id: string;
  commentId: string;
  appKey: string;
  reporterUid: string;
  authorUid: string;
  reason: string;
  /** What the comment said WHEN reported — the admin judges what the reader saw, even if it changes. */
  textSnapshot: string;
  at: number;
  status: 'open' | 'removed' | 'removed-by-owner' | 'kept';
}

export async function reportComment(c: StoredComment, reporterUid: string, reason: string): Promise<void> {
  const db = needDb();
  const id = `r${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const report: CommentReport = {
    id, commentId: c.id, appKey: c.appKey, reporterUid, authorUid: c.uid,
    reason: reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REPORT_REASON_CHARS) || 'No reason given',
    textSnapshot: c.text, at: Date.now(), status: 'open',
  };
  await db.collection(APP_MART_COMMENT_REPORTS_COLLECTION).doc(id).set(report);
}

export async function openCommentReports(limit = 200): Promise<CommentReport[]> {
  const db = getDb();
  if (!db) return [];
  try {
    return await listEqNewestFirst<CommentReport>(db.collection(APP_MART_COMMENT_REPORTS_COLLECTION), [['status', 'open']], 'at', limit);
  } catch {
    return [];
  }
}

export async function resolveReportsFor(commentId: string, status: CommentReport['status']): Promise<void> {
  const db = getDb();
  if (!db) return;
  const snap = await db.collection(APP_MART_COMMENT_REPORTS_COLLECTION).where('commentId', '==', commentId).limit(200).get();
  await Promise.all(snap.docs.filter((d) => d.data().status === 'open').map((d) => d.ref.update({ status })));
}

// ─── Blocking ─────────────────────────────────────────────────────────────────────────────────────

export async function blockedUids(uid: string | null): Promise<Set<string>> {
  const db = getDb();
  if (!db || !uid) return new Set();
  try {
    const snap = await db.collection(APP_MART_BLOCKS_COLLECTION).doc(uid).get();
    const list = snap.exists ? snap.data()?.blocked : null;
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export async function setBlocked(uid: string, targetUid: string, blocked: boolean): Promise<void> {
  const db = needDb();
  const ref = db.collection(APP_MART_BLOCKS_COLLECTION).doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const list = snap.exists && Array.isArray(snap.data()?.blocked) ? (snap.data()!.blocked as string[]) : [];
    tx.set(ref, { uid, blocked: applyBlock(list, targetUid, blocked), updatedAt: Date.now() });
  });
}

// ─── Notifications to the creator ────────────────────────────────────────────────────────────────

const PUSH_GAP_MS = 10 * 60_000;
const lastPush = new Map<string, number>();

/**
 * Tell somebody that something happened on their app. Never throws, never blocks the action that caused
 * it: a like must save whether or not the notification does. Nobody is told about their own act, and
 * nobody is told about the act of someone they blocked.
 */
export async function notifySocial(input: {
  recipientUid: string; kind: SocialNotificationKind; appKey: string; appName: string;
  actorUid: string; text?: string;
}): Promise<void> {
  if (!input.recipientUid || input.recipientUid === input.actorUid) return;
  const db = getDb();
  if (!db) return;
  try {
    if ((await blockedUids(input.recipientUid)).has(input.actorUid)) return;
    const actor = (await resolvePeople([input.actorUid])).get(input.actorUid);
    const actorName = actor?.name || 'Someone';
    const now = Date.now();
    const day = indiaDay(now);
    const ref = db.collection(APP_MART_NOTIFICATIONS_COLLECTION).doc(socialNotificationDocId(input.recipientUid, input.kind, input.appKey, day));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists ? (snap.data() as SocialNotificationDoc) : null;
      const { doc, changed } = foldActor(prev, {
        recipientUid: input.recipientUid, kind: input.kind, appKey: input.appKey, appName: input.appName,
        day, actorUid: input.actorUid, actorName, text: input.text, now,
      });
      if (changed) tx.set(ref, doc);
    });
    // A push for words people wrote to you — throttled so a busy thread is one buzz per 10 minutes.
    if (input.kind !== 'like' && input.text) {
      const throttleKey = `${input.recipientUid}|${input.appKey}`;
      const last = lastPush.get(throttleKey) ?? 0;
      if (now - last >= PUSH_GAP_MS) {
        lastPush.set(throttleKey, now);
        if (lastPush.size > 10_000) lastPush.clear();
        void sendPushToUser(input.recipientUid, {
          title: 'NavBharatAI App Mart',
          body: socialPushBody(input.kind, actorName, input.appName, input.text),
          data: { type: 'app-mart', appKey: input.appKey },
        });
      }
    }
  } catch { /* a notification is never worth failing the like or comment that caused it */ }
}

/** One inbox row, in the shape the notifications panel already draws. */
export interface SocialInboxItem {
  id: string;
  message: string;
  createdAt: number;
  read: boolean;
  action: 'open-app-mart';
  target: string;
}

/** The person's App Mart notifications, newest first, for the shared notifications panel. */
export async function listSocialInbox(uid: string, limit = 30): Promise<SocialInboxItem[]> {
  const db = getDb();
  if (!db || !uid) return [];
  try {
    const rows = await listEqNewestFirst<SocialNotificationDoc & { _id: string }>(
      db.collection(APP_MART_NOTIFICATIONS_COLLECTION), [['recipientUid', uid]], 'updatedAt', 60, 300,
      (id, d) => ({ ...(d as SocialNotificationDoc), _id: id }),
    );
    return rows
      .filter((d) => inboxState(d).shown)
      .slice(0, limit)
      .map((d) => ({
        id: socialInboxId(d._id, d.version),
        message: socialNotificationMessage(d),
        createdAt: d.updatedAt,
        read: inboxState(d).read,
        action: 'open-app-mart' as const,
        target: d.appKey,
      }));
  } catch {
    return [];
  }
}

/**
 * Mark read / dismiss. The version rides on the id, so marking an old version read does not swallow
 * activity that arrived after the person looked. Scoped to the person's own documents.
 */
export async function updateSocialInbox(uid: string, ids: readonly string[], field: 'readVersion' | 'dismissedVersion'): Promise<void> {
  const db = getDb();
  if (!db || !uid) return;
  await Promise.all(ids.map(parseSocialInboxId).filter((x): x is { docId: string; version: number } => !!x).slice(0, 200).map(async ({ docId, version }) => {
    const ref = db.collection(APP_MART_NOTIFICATIONS_COLLECTION).doc(docId);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.exists ? (snap.data() as SocialNotificationDoc) : null;
        if (!d || d.recipientUid !== uid) return;
        if ((Number(d[field]) || 0) < version) tx.update(ref, { [field]: version });
      });
    } catch { /* best-effort: an unmarked row only stays unread */ }
  }));
}

/** Test seam. */
export function _resetSocialCachesForTests(): void {
  peopleCache.clear();
  countCache.clear();
  lastPush.clear();
}

export { ZERO_COUNTS };
