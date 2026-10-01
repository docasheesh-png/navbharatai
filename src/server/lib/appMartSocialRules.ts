// App Mart social — the RULES (admin 2026-09-30).
//
// Admin, verbatim: *"app mart me ek social media banana hai! … app ke niche 3 option dikhe — like (👍)
// dislike (👎) comment … only login user like dislike comment kar sakta hai … creator ke pas
// notifications jaye … creator dekh sake kisne like kiya hai (dislike kisne kiya hai yeh na dikhe bas
// number dikhe) … sabhi users ko app ki like aur dislikes dikhe, number only … comment wale user ke naam
// par click kare to us user ki profile … naam, photo, banayi hui apps … user ki email nahi dikhani hai!!"*
//
// This file holds every DECISION, and nothing that touches a database, so each rule is visible and
// tested on its own (`tests/appMartSocial.test.ts`). The store (`appMartSocialStore.ts`) and the
// routes (`routes/appMartSocial.ts`) only move data through these functions.
//
// 🔒 FOUR PROMISES THE WHOLE FEATURE IS BUILT ON — do not weaken one to make another easier:
//   1. NO EMAIL, EVER. A person is shown by display name, photo and the public creator code. The name
//      goes through `creatorDisplayName`, which refuses anything email-shaped; the code is
//      `publicCreatorId`, which cannot be turned back into the account.
//   2. WHO DISLIKED IS NOBODY'S BUSINESS. Not the public's and not the creator's: the likers list exists,
//      a dislikers list does not exist anywhere in the code, so no screen can ever draw one.
//   3. COUNTS ARE REAL. They are counted from the reactions and comments themselves, never kept as a
//      separate tally that can drift from what is actually stored.
//   4. A COMMENT IS PUBLIC SPEECH ON SOMEBODY ELSE'S PAGE. So it can be reported, its author can be
//      blocked by the reader, the app's creator can remove it, and an admin can remove it — the four
//      things Google Play's and Apple's user-generated-content rules require of any app that shows it.

import { createHash } from 'node:crypto';
import { scanProfanity } from './pollinationsGuard';

// ─── What an app is called here ───────────────────────────────────────────────────────────────────

/** App Mart has two shelves: instant apps that run in the browser, and Android apps (.apk). */
export type AppMartKind = 'web' | 'apk';

export interface AppKey {
  kind: AppMartKind;
  id: string;
  /** `web:<id>` / `apk:<id>` — the one string every social record is filed under. */
  key: string;
}

const APP_ID_SHAPE = /^[A-Za-z0-9_-]{4,80}$/;

/**
 * Read an app key from a request. Anything else is refused rather than guessed at: the key is used in
 * document ids and queries, so an unexpected character must never reach them.
 */
export function parseAppKey(raw: unknown): AppKey | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const m = /^(web|apk):(.+)$/.exec(s);
  if (!m || !APP_ID_SHAPE.test(m[2])) return null;
  return { kind: m[1] as AppMartKind, id: m[2], key: `${m[1]}:${m[2]}` };
}

/** A batch request may name at most this many apps — one Browse page is 60. */
export const MAX_BATCH_KEYS = 100;

/** The distinct valid keys in a batch request, capped. Invalid entries are dropped, never fatal. */
export function parseAppKeyList(raw: unknown): AppKey[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: AppKey[] = [];
  for (const item of list) {
    const k = parseAppKey(item);
    if (!k || seen.has(k.key)) continue;
    seen.add(k.key);
    out.push(k);
    if (out.length >= MAX_BATCH_KEYS) break;
  }
  return out;
}

// ─── Like / dislike ───────────────────────────────────────────────────────────────────────────────

export type Reaction = 'like' | 'dislike';

export function parseReaction(raw: unknown): Reaction | null {
  return raw === 'like' || raw === 'dislike' ? raw : null;
}

/**
 * What pressing a button does, the way every social app behaves: pressing the one you already chose
 * takes it back; pressing the other one switches to it. `null` means "no reaction".
 */
export function nextReaction(current: Reaction | null, pressed: Reaction): Reaction | null {
  return current === pressed ? null : pressed;
}

/** One reaction per person per app — so the person and the app ARE the document id. */
export function reactionDocId(appKey: string, uid: string): string {
  return `${appKey}__${uid}`;
}

export interface SocialCounts { likes: number; dislikes: number; comments: number }

export const ZERO_COUNTS: SocialCounts = Object.freeze({ likes: 0, dislikes: 0, comments: 0 });

// ─── Comments ─────────────────────────────────────────────────────────────────────────────────────

export const MAX_COMMENT_CHARS = 1000;

/**
 * Clean a comment before it is stored. It is shown as TEXT (never HTML), so this is not an escaping
 * step — it removes what makes a comment unreadable or invisible: control characters, zero-width
 * padding, runs of blank lines, and surrounding space.
 */
export function cleanCommentText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Write something first.' };
  const text = raw
    .replace(/\r\n?/g, '\n')
    // Control characters other than newline and tab, and zero-width characters used to pad or hide text.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return { ok: false, error: 'Write something first.' };
  if (text.length > MAX_COMMENT_CHARS) {
    return { ok: false, error: `A comment can be at most ${MAX_COMMENT_CHARS} characters (this one is ${text.length}).` };
  }
  return { ok: true, text };
}

/**
 * THE WORD FILTER (admin 2026-10-01: "comments me gaali-filter … block karo"). A comment or reply that
 * carries abuse is NOT posted, and the writer is told why in plain words so they can rephrase.
 *
 * 🔒 ONE LIST. It reads `scanProfanity`, the same list (and the same undoing of "f u c k", "b.c",
 * "ch*tiya" disguises) the image generator uses, so a word added there is refused here too and the two
 * can never drift. It reads PROFANITY ONLY: a comment that names what an app is about ("a sex-education
 * app for schools") is not abuse, and refusing it would be wrong. Reports and blocking stay for what a
 * word list cannot see.
 */
export const COMMENT_ABUSE_MESSAGE =
  'Abusive words are not allowed in App Mart comments. Please rephrase your comment and post it again.';

export function commentAbuse(text: string): string | null {
  return scanProfanity(text).ok ? null : COMMENT_ABUSE_MESSAGE;
}

export const MAX_REPORT_REASON_CHARS = 500;

/** Who may take a comment down: the person who wrote it, the creator of the app it is on, or an admin. */
export function canRemoveComment(input: {
  viewerUid: string | null; authorUid: string; appOwnerUid: string | null; isAdmin: boolean;
}): boolean {
  if (input.isAdmin) return true;
  if (!input.viewerUid) return false;
  return input.viewerUid === input.authorUid || (!!input.appOwnerUid && input.viewerUid === input.appOwnerUid);
}

/** Why a comment was removed — shown in its place when it had replies, so the thread still reads. */
export type RemovedBy = 'author' | 'creator' | 'admin';

export function removedBy(input: { viewerUid: string | null; authorUid: string; appOwnerUid: string | null; isAdmin: boolean }): RemovedBy {
  if (input.viewerUid && input.viewerUid === input.authorUid) return 'author';
  if (input.viewerUid && input.appOwnerUid && input.viewerUid === input.appOwnerUid) return 'creator';
  return 'admin';
}

export function removedLabel(by: RemovedBy): string {
  return by === 'author' ? 'This comment was deleted by the person who wrote it.'
    : by === 'creator' ? 'This comment was removed by the app’s creator.'
    : 'This comment was removed for breaking the App Mart rules.';
}

/** Stored comment. `parentId` is '' for a top-level comment so an EQUALITY filter can find them. */
export interface StoredComment {
  id: string;
  appKey: string;
  uid: string;
  text: string;
  parentId: string;
  createdAt: number;
  /** false once removed — every count and every public list filters on this one field. */
  visible: boolean;
  replyCount: number;
  removedBy?: RemovedBy;
  removedAt?: number;
}

/** A person as another person may see them. Never an email, never the account id. */
export interface PublicPerson {
  name: string;
  /** https only; empty when there is no photo (the screen draws the initial). */
  photoUrl: string;
  /** The public creator code — the address of their profile. */
  creatorId: string;
}

export interface PublicComment {
  id: string;
  text: string;
  createdAt: number;
  parentId: string;
  replyCount: number;
  author: PublicPerson;
  /** The author is the app's creator — drawn as a badge, the way every store marks the developer. */
  isCreator: boolean;
  isMine: boolean;
  canRemove: boolean;
  /** Present only on a removed comment that is still shown because it has replies. */
  removedNote?: string;
}

const UNKNOWN_PERSON = (creatorId: string): PublicPerson => ({ name: 'NavBharatAI user', photoUrl: '', creatorId });

/**
 * Turn stored comments into what a viewer sees.
 *
 *  • A removed comment disappears — unless it has replies, when a short note keeps the thread readable.
 *  • A comment by someone the viewer blocked is not sent at all (it is not "hidden in the client").
 *  • The text of a removed comment is never sent, whoever is looking.
 */
export function publicComments(
  rows: readonly StoredComment[],
  ctx: {
    people: ReadonlyMap<string, PublicPerson>;
    creatorIdOf: (uid: string) => string;
    viewerUid: string | null;
    appOwnerUid: string | null;
    isAdmin: boolean;
    blockedUids: ReadonlySet<string>;
  },
): PublicComment[] {
  const out: PublicComment[] = [];
  for (const c of rows) {
    if (ctx.blockedUids.has(c.uid)) continue;
    if (!c.visible && (c.replyCount ?? 0) <= 0) continue;
    const author = ctx.people.get(c.uid) ?? UNKNOWN_PERSON(ctx.creatorIdOf(c.uid));
    if (!c.visible) {
      out.push({
        id: c.id, text: '', createdAt: c.createdAt, parentId: c.parentId, replyCount: c.replyCount ?? 0,
        author: { name: 'Removed comment', photoUrl: '', creatorId: '' },
        isCreator: false, isMine: false, canRemove: false,
        removedNote: removedLabel(c.removedBy ?? 'admin'),
      });
      continue;
    }
    out.push({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      parentId: c.parentId,
      replyCount: Math.max(0, c.replyCount ?? 0),
      author,
      isCreator: !!ctx.appOwnerUid && c.uid === ctx.appOwnerUid,
      isMine: !!ctx.viewerUid && c.uid === ctx.viewerUid,
      canRemove: canRemoveComment({ viewerUid: ctx.viewerUid, authorUid: c.uid, appOwnerUid: ctx.appOwnerUid, isAdmin: ctx.isAdmin }),
    });
  }
  return out;
}

/** Newest first for top-level comments; oldest first for replies, the order a conversation is read in. */
export function orderComments(rows: StoredComment[], replies: boolean): StoredComment[] {
  return [...rows].sort((a, b) => (replies ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
}

/** One page of comments older than `before` (a createdAt), newest first. */
export function pageOfComments(rows: StoredComment[], before: number | null, limit: number): { page: StoredComment[]; hasMore: boolean } {
  const ordered = orderComments(rows, false).filter((c) => before === null || c.createdAt < before);
  return { page: ordered.slice(0, limit), hasMore: ordered.length > limit };
}

// ─── People ───────────────────────────────────────────────────────────────────────────────────────

/** Only an https picture is shown — a data: or javascript: value is somebody's attack, not a photo. */
export function safePhotoUrl(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 1000) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

const CREATOR_ID_SHAPE = /^[0-9a-z]{10}$/;

export function isCreatorIdShape(raw: unknown): raw is string {
  return typeof raw === 'string' && CREATOR_ID_SHAPE.test(raw);
}

// ─── Notifications to the creator ─────────────────────────────────────────────────────────────────

export type SocialNotificationKind = 'like' | 'comment' | 'reply' | 'follow' | 'new-app';

/**
 * The key a follow notification is filed under. A follow is about a PERSON, not an app, so it has no
 * app key; one fixed word groups "Asha and 3 others started following you" into one row per day.
 */
export const FOLLOW_NOTIFICATION_KEY = 'followers';

/**
 * ONE notification per (person, kind, app, day), however many people acted — "Ravi and 12 others liked
 * your app" — the way every social app groups them. One document per like would bury the admin's own
 * messages and a payment receipt under a popular app's afternoon.
 *
 * The id is a digest so it is short (the inbox caps ids at 128 characters) and carries no uid.
 */
export function socialNotificationDocId(recipientUid: string, kind: SocialNotificationKind, appKey: string, day: string): string {
  return `am${createHash('sha256').update(`${recipientUid}|${kind}|${appKey}|${day}`).digest('hex').slice(0, 24)}`;
}

/**
 * The id the INBOX sees: the document id plus its version. A new like on a notification the creator
 * already read produces a NEW id, so it shows as unread again — which is what "new activity" means.
 * The dot cannot appear in a document id, which is how the inbox tells these apart from its own.
 */
export function socialInboxId(docId: string, version: number): string {
  return `${docId}.${Math.max(1, Math.floor(version))}`;
}

export function parseSocialInboxId(raw: unknown): { docId: string; version: number } | null {
  const m = typeof raw === 'string' ? /^(am[0-9a-f]{24})\.(\d{1,9})$/.exec(raw) : null;
  return m ? { docId: m[1], version: Number(m[2]) } : null;
}

export function isSocialInboxId(raw: unknown): boolean {
  return parseSocialInboxId(raw) !== null;
}

/** The most distinct people a grouped notification remembers by id — beyond it, each act counts once more. */
export const MAX_REMEMBERED_ACTORS = 100;
/** How many names a grouped notification carries for its sentence ("Ravi, Asha and 10 others"). */
export const MAX_NAMED_ACTORS = 2;

export interface SocialNotificationDoc {
  recipientUid: string;
  kind: SocialNotificationKind;
  appKey: string;
  appName: string;
  day: string;
  /** Distinct people who acted, as far as remembered. */
  count: number;
  actorUids: string[];
  /** Newest first. */
  actorNames: string[];
  /** The latest comment's opening words, for comment and reply notifications. */
  latestText: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  readVersion: number;
  dismissedVersion: number;
}

/** Fold one more act into a grouped notification. Pure. A repeat by the same person changes nothing. */
export function foldActor(
  prev: SocialNotificationDoc | null,
  input: {
    recipientUid: string; kind: SocialNotificationKind; appKey: string; appName: string; day: string;
    actorUid: string; actorName: string; text?: string; now: number;
  },
): { doc: SocialNotificationDoc; changed: boolean } {
  const base: SocialNotificationDoc = prev ?? {
    recipientUid: input.recipientUid, kind: input.kind, appKey: input.appKey, appName: input.appName,
    day: input.day, count: 0, actorUids: [], actorNames: [], latestText: '', version: 0,
    createdAt: input.now, updatedAt: input.now, readVersion: 0, dismissedVersion: 0,
  };
  const known = base.actorUids.includes(input.actorUid);
  // A comment is always news — the same person can say something new. A like, a follow and a new-app
  // announcement are not: liking (or following) and taking it back and doing it again must not ring
  // the creator three times.
  if (known && !repeatIsNews(input.kind)) return { doc: base, changed: false };
  const actorUids = known ? base.actorUids : [...base.actorUids, input.actorUid].slice(-MAX_REMEMBERED_ACTORS);
  const actorNames = [input.actorName, ...base.actorNames.filter((n) => n !== input.actorName)].slice(0, MAX_NAMED_ACTORS + 1);
  return {
    doc: {
      ...base,
      appName: input.appName || base.appName,
      count: known ? base.count : base.count + 1,
      actorUids,
      actorNames,
      latestText: input.text !== undefined ? snippet(input.text, 80) : base.latestText,
      version: base.version + 1,
      updatedAt: input.now,
    },
    changed: true,
  };
}

/** Can the same person doing the same thing again be new? Only when they said something new. */
export function repeatIsNews(kind: SocialNotificationKind): boolean {
  return kind === 'comment' || kind === 'reply';
}

function snippet(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function whoDidIt(names: readonly string[], count: number): string {
  const shown = names.slice(0, MAX_NAMED_ACTORS);
  const first = shown[0] || 'Someone';
  if (count <= 1) return first;
  if (count === 2 && shown.length >= 2) return `${shown[0]} and ${shown[1]}`;
  const others = count - 1;
  return `${first} and ${others} other${others === 1 ? '' : 's'}`;
}

/** The sentence the creator reads in their notifications. No email can appear: names are pre-cleaned. */
export function socialNotificationMessage(doc: Pick<SocialNotificationDoc, 'kind' | 'appName' | 'actorNames' | 'count' | 'latestText'>): string {
  const who = whoDidIt(doc.actorNames, doc.count);
  const app = `"${doc.appName || 'your app'}"`;
  const quote = doc.latestText ? `: “${doc.latestText}”` : '';
  if (doc.kind === 'like') return `👍 ${who} liked your app ${app} on App Mart.`;
  if (doc.kind === 'comment') return `💬 ${who} commented on ${app}${quote}`;
  if (doc.kind === 'follow') return `👤 ${who} started following you on App Mart.`;
  if (doc.kind === 'new-app') return `🆕 ${who} published a new app ${app} on App Mart.`;
  return `↩️ ${who} replied to your comment on ${app}${quote}`;
}

/** Where tapping the notification leads (the grammar is src/lib/appMartTarget.ts). */
export function socialNotificationTarget(doc: Pick<SocialNotificationDoc, 'kind' | 'appKey'>): string {
  return doc.kind === 'follow' ? 'followers:me' : doc.appKey;
}

/** The short push line for a comment or a reply (likes ring the bell only — a push per like is spam). */
export function socialPushBody(kind: 'comment' | 'reply', actorName: string, appName: string, text: string): string {
  const where = `"${appName || 'your app'}"`;
  return kind === 'comment'
    ? `${actorName} commented on ${where}: ${snippet(text, 90)}`
    : `${actorName} replied to your comment on ${where}: ${snippet(text, 90)}`;
}

/** Is this grouped notification still in the inbox, and has it been read? */
export function inboxState(doc: Pick<SocialNotificationDoc, 'version' | 'readVersion' | 'dismissedVersion'>): { shown: boolean; read: boolean } {
  return { shown: doc.version > (doc.dismissedVersion ?? 0), read: (doc.readVersion ?? 0) >= doc.version };
}

// ─── Blocking ─────────────────────────────────────────────────────────────────────────────────────

/** How many people one account may block. Bounded because the list lives in one document. */
export const MAX_BLOCKED = 500;

export function applyBlock(list: readonly string[], targetUid: string, blocked: boolean): string[] {
  const rest = list.filter((u) => u !== targetUid);
  return blocked ? [...rest, targetUid].slice(-MAX_BLOCKED) : rest;
}


// ─── Following ────────────────────────────────────────────────────────────────────────────────────
//
// Admin 2026-10-01: *"user jis jis creator ko follow kare, uski apps usko app mart me alag se dikhe"*.
// A follow is one document per (follower, creator) — the id IS the pair, so a person can follow a
// creator once by construction, the same shape as a reaction. Counts are COUNTED, never kept: a
// tally beside the records would drift the first time an account is erased.
//
// 🔒 The SAME privacy split as likes: everyone sees how many followers a creator has; only the creator
// sees who they are. A person's own following list is theirs alone.

/** One follow per (follower, creator). */
export function followDocId(followerUid: string, creatorUid: string): string {
  return `${followerUid}__${creatorUid}`;
}

/** How many creators one account may follow. Bounded so the Following feed stays one bounded read. */
export const MAX_FOLLOWING = 1000;

/** How many of the most recent follows the Following feed reads. */
export const FEED_FOLLOW_LIMIT = 300;

/** How many followers a "new app" announcement reaches. A bound, so one publish cannot become an unbounded write. */
export const MAX_NEW_APP_FANOUT = 5000;

export interface FollowCounts { followers: number; following: number }

/**
 * Whether a follow may be made: nobody follows themselves, and an account at the cap must unfollow
 * someone first. Returns the sentence the person reads when the answer is no.
 */
export function followRefusal(input: { followerUid: string; creatorUid: string; followingNow: number; alreadyFollowing: boolean }): string | null {
  if (input.followerUid === input.creatorUid) return 'You cannot follow yourself.';
  if (!input.alreadyFollowing && input.followingNow >= MAX_FOLLOWING) {
    return `You already follow ${MAX_FOLLOWING} creators. Unfollow someone first.`;
  }
  return null;
}

// ─── The Browse views ─────────────────────────────────────────────────────────────────────────────
//
// Admin 2026-10-01: *"browser me 3 button hi bana do — 1. general 2. follower 3. likes app … sabhi page
// me upar play instantly aur apk filter bhi add karo"*.

export type FeedView = 'following' | 'liked';

export function parseFeedView(raw: unknown): FeedView | null {
  return raw === 'following' || raw === 'liked' ? raw : null;
}

/** How many apps one feed answer carries, per shelf. */
export const FEED_APP_LIMIT = 120;

/** How many liked apps the Liked view reads. */
export const LIKED_FEED_LIMIT = 200;

/**
 * Order a feed newest first and cap it. `at` is when the app was published (Following) or when the
 * viewer liked it (Liked) — the order a person expects from each.
 */
export function newestFirstCapped<T extends { at: number }>(rows: readonly T[], limit: number): T[] {
  return [...rows].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, Math.max(0, limit));
}

/** Split a list into chunks — Firestore's `in` filter takes at most 30 values. */
export function chunk<T>(list: readonly T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
