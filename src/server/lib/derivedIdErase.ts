// ERASING A DOCUMENT WHOSE ID IS DERIVED — the third reachability shape, which neither eraser had.
//
// 🔴 THE CLASS, named plainly (Q-761, Q-762, Q-764 — one root cause, three stores).
// Account deletion had exactly TWO ways to find a document:
//
//   1. `DataRetentionManager.deleteUserData`  — the doc id IS the uid, or a verified field equals it.
//   2. `workspaceDataErase.deleteUserWorkspaceData` — the doc id is a workspace id, swept by the
//      `agentv3-{uid}-…` id RANGE.
//
// A store whose doc id is DERIVED — built out of a key the eraser already holds, but not equal to it
// and not carried in the body — is reachable by neither. There is nothing to query. So each one was
// found, read, correctly judged unreachable, and recorded in `BUILD_REPORT_QUEUE.md` as an open row
// rather than registered on a guess. Three separate rows accumulated that way:
//
//   · Q-762  `adrDecisions/{uid}__{projectId}` and `techDebt/{uid}__{projectId}` — the person's own
//            architecture decisions and tech-debt list. Body is `{records|items, updatedAt}`: no uid
//            field at all (`adrMemory.ts:163/203`, `TechnicalDebtTracker.ts:98`).
//   · Q-764  `build_history/{sessionId}` + its `versions` subcollection — every build's version
//            metadata for every app. A BARE sessionId, which the `agentv3-{uid}-` range cannot match.
//   · Q-761  `bot_sessions/{botId}_{chatId}` (`BotStore.ts:283/296`) — per-chat conversation state for
//            a bot whose owner is gone. Reachable from the BOT, never from the uid.
//
// ⚠️ THE ROWS WERE THE SYMPTOM. The defect is that "I cannot express this key" had no answer except a
// queue row, so the same correct judgement produced a new permanent gap every time a store of this
// shape appeared. This module is that answer: a derived id is resolved from a key the eraser can still
// see, and then deleted exactly.
//
// 🔒 WHY IT RUNS FIRST, BEFORE EITHER OTHER ERASER. Every key here is derived from a PARENT the other
// two erasers delete: bot ids come from `bots` (which `deleteUserData` removes) and build-history
// session ids come from `user_build_history` and from the workspace id range (which the other two
// remove). Run second, the keys would already be gone and this would silently delete nothing while
// reporting success — the exact "an erase that LOOKS complete and is not" failure `workspaceDataErase`
// was written to prevent. Running first also means a partial failure leaves every parent findable, so
// running it again finishes the job.
//
// 🔒 AND NOTHING HERE IS A GUESS. Every collection, doc id and subcollection below was read at its own
// store before being listed. A prefix range is the one construct in this file that could over-delete,
// so each one is refused outright when the key could be a prefix of another key (see the two
// refusals) rather than being made to work in a case that cannot arise with real data.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { workspacePrefixFor } from './workspaceIdentity';

/** U+F8FF is a very high code point, so [prefix, prefix+U+F8FF] is exactly the prefix range. */
const RANGE_END_CHAR = String.fromCharCode(0xf8ff);

/** The separator both composite-id stores use between the uid and the project id. */
export const UID_COMPOSITE_SEPARATOR = '__';

/** A store whose doc id is `${uid}${UID_COMPOSITE_SEPARATOR}${somethingElse}`. */
export interface UidPrefixedCollection {
  collection: string;
  /** The subcollection holding the payload, when the content lives one level down. Neither has one. */
  sub?: string;
}

/**
 * VERIFIED — each read at its own store, never inferred from its name.
 *
 *   adrDecisions  .doc(`${userId}__${projectId}`)  body {records, updatedAt}  (adrMemory.ts:163/203)
 *   techDebt      .doc(`${userId}__${projectId}`)  body {items, updatedAt}    (TechnicalDebtTracker.ts:98)
 *
 * Both bodies are flat and neither store writes a subcollection, so there is nothing one level down to
 * orphan. That was checked rather than assumed: Q-134 was exactly the bug where it had not been.
 */
export const UID_PREFIXED_COLLECTIONS: readonly UidPrefixedCollection[] = [
  { collection: 'adrDecisions' },
  { collection: 'techDebt' },
];

export type DerivedEraseRefusal = 'unusable-uid' | 'ambiguous-uid';

export interface PrefixRange { startAt: string; endAt: string }
export interface UidPrefixPlan {
  range: PrefixRange | null;
  refusal?: DerivedEraseRefusal;
}

/**
 * The id range that contains exactly this user's composite-id documents — or a REFUSAL, which is a
 * real answer and not a failure.
 *
 * 🔴 THE AMBIGUITY THIS REFUSES, because getting it wrong deletes a different person's work. The
 * prefix is `${uid}__`. For a uid ending in `_` — say `abc_` — that prefix is `abc___`, which also
 * begins the prefix of the uid `abc`. Worse, a uid CONTAINING `__` makes the separator itself
 * ambiguous: `a__b` with project `c` gives the same id as `a` with project `b__c`.
 *
 * Firebase Auth uids are 28 characters of [A-Za-z0-9] and contain no underscore, so this cannot arise
 * with a real account. That is a reason to be confident, NOT a reason to skip the check — the whole
 * point of a prefix range is that a wrong bound is irreversible. So anything outside [A-Za-z0-9] is
 * REFUSED and reported honestly: the caller says these records could not be erased automatically,
 * which a human can then finish. This is `planWorkspaceErase`'s discipline, applied to a tighter key.
 *
 * PURE.
 */
export function planUidPrefixErase(uid: string | null | undefined): UidPrefixPlan {
  const id = String(uid ?? '').trim();
  if (!id) return { range: null, refusal: 'unusable-uid' };
  if (!/^[A-Za-z0-9]+$/.test(id)) return { range: null, refusal: 'ambiguous-uid' };
  const prefix = `${id}${UID_COMPOSITE_SEPARATOR}`;
  return { range: { startAt: prefix, endAt: `${prefix}${RANGE_END_CHAR}` } };
}

/**
 * The `bot_sessions` id range for one bot — or null when the bot id could be a prefix of another.
 *
 * The id is `${botId}_${chatId}`, so the range is `${botId}_`. `routes/bots.ts:89/181` mints a bot id
 * as `crypto.randomBytes(12).toString('hex')` — 24 fixed-length hex characters, so no bot id can be a
 * prefix of another and none contains `_`. A bot id that does not look like that is refused rather
 * than swept, for the same reason as above: the cost of a wrong bound is somebody else's data.
 *
 * PURE.
 */
export function planBotSessionErase(botId: string | null | undefined): PrefixRange | null {
  const id = String(botId ?? '').trim();
  if (!id || !/^[A-Za-z0-9]+$/.test(id)) return null;
  const prefix = `${id}_`;
  return { startAt: prefix, endAt: `${prefix}${RANGE_END_CHAR}` };
}

/**
 * Every `build_history` document id belonging to this user, from the two EXACT sources — never a guess.
 *
 *  · `sessionIds` — the `sessionId` field of `user_build_history where userId == uid`
 *    (`UserBuildHistoryStore.ts:27/79`). Already a uid-indexed collection, so these are exact.
 *  · `workspaceIds` — the ids the `agentv3-{uid}-…` range returns, with that prefix stripped back off.
 *    `buildHistoryAccess.ts` states the relationship and `restorePointKey` is the function that
 *    performs it: "the workspace is `agentv3-{uid}-{sessionId}`, and `restorePointKey` strips the
 *    prefix back off, so the history document id is the bare `pro-<ts>`".
 *
 * BOTH are used, unioned, because neither is provably complete on its own: a build can write version
 * history without a `user_build_history` row, and a workspace can be gone while its history is not.
 * Taking the union can only find MORE of the user's own documents; it cannot reach anyone else's,
 * because every input is already restricted to this user.
 *
 * A workspace id that does not carry this user's prefix is dropped rather than used bare — bare would
 * mean deleting `build_history/{someOtherWorkspaceId}`.
 *
 * 🔴 AND A HYPHENATED UID RESOLVES NOTHING AT ALL, for the reason `planWorkspaceErase` already refuses
 * one: `agentv3-{uid}-` is ambiguous when the uid may contain `-`, so `agentv3-abc-d-pro-1` is both
 * `abc-d`'s workspace `pro-1` and `abc`'s workspace `d-pro-1`. Splitting it would hand this function a
 * key belonging to a DIFFERENT person. The check is repeated here rather than left to the caller
 * because this is the function that performs the split, and a pure guard is the one that can be tested.
 *
 * PURE.
 */
export function buildHistoryKeysFor(
  uid: string,
  sessionIds: readonly string[],
  workspaceIds: readonly string[],
): string[] {
  if (String(uid ?? '').includes('-')) return [];
  const prefix = workspacePrefixFor(uid);
  const keys = new Set<string>();
  for (const s of sessionIds) {
    const id = String(s ?? '').trim();
    if (id) keys.add(id);
  }
  for (const w of workspaceIds) {
    const ws = String(w ?? '').trim();
    if (!ws || !prefix || !ws.startsWith(prefix)) continue;
    const key = ws.slice(prefix.length);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

export interface DerivedEraseResult {
  collection: string;
  /** Documents removed from the collection itself. */
  documents: number;
  /** Documents removed from a subcollection beneath them (`build_history`'s `versions`). */
  children: number;
  error?: string;
}
export interface DerivedEraseReport {
  uid: string;
  collections: DerivedEraseResult[];
  totalDeleted: number;
  /** How many derived keys were resolved, so the numbers above are checkable rather than a bare claim. */
  keys: { bots: number; historySessions: number };
  /** Present when the composite-id sweep was declined — see planUidPrefixErase. */
  refusal?: DerivedEraseRefusal;
}

const PAGE = 200;
const SUBDOC_PAGE = 300;
/** Hard stop so a pathological collection can never spin forever inside a request. */
const MAX_PAGES = 500;

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never touch real Firestore
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

/** Delete every document in one parent's subcollection, in pages. Returns how many went. */
async function deleteSubcollection(
  parent: admin.firestore.DocumentReference,
  name: string,
): Promise<number> {
  let removed = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const snap = await parent.collection(name).limit(SUBDOC_PAGE).get();
    if (snap.empty) break;
    const batch = parent.firestore.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    removed += snap.size;
    if (snap.size < SUBDOC_PAGE) break;
  }
  return removed;
}

/** Sweep one document-id range, deleting each document (and its subcollection first, when it has one). */
async function deleteIdRange(
  store: admin.firestore.Firestore,
  collection: string,
  range: PrefixRange,
  sub?: string,
): Promise<{ documents: number; children: number }> {
  const byId = admin.firestore.FieldPath.documentId();
  let documents = 0;
  let children = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const snap = await store.collection(collection)
      .orderBy(byId).startAt(range.startAt).endAt(range.endAt)
      .limit(PAGE)
      .get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      // SUBCOLLECTION FIRST, THEN THE PARENT. Reversed, a failure between the two would orphan the
      // payload with its parent already gone — unreachable and still on our disk.
      if (sub) children += await deleteSubcollection(doc.ref, sub);
      await doc.ref.delete();
      documents++;
    }
    if (snap.size < PAGE) break;
  }
  return { documents, children };
}

/** The bot ids this user owns, read BEFORE `deleteUserData` removes them (`BotStore.ts:178`: `ownerUid`). */
async function ownedBotIds(store: admin.firestore.Firestore, uid: string): Promise<string[]> {
  const snap = await store.collection('bots').where('ownerUid', '==', uid).get();
  return snap.docs.map((d) => d.id);
}

/** The `sessionId` of every `user_build_history` row this user owns (`UserBuildHistoryStore.ts:27`). */
async function ownedHistorySessionIds(store: admin.firestore.Firestore, uid: string): Promise<string[]> {
  const snap = await store.collection('user_build_history').where('userId', '==', uid).get();
  return snap.docs.map((d) => String((d.data() as { sessionId?: unknown }).sessionId ?? '').trim()).filter(Boolean);
}

/** The workspace ids this user owns, by the same id range `deleteUserWorkspaceData` sweeps. */
async function ownedWorkspaceIds(store: admin.firestore.Firestore, uid: string): Promise<string[]> {
  const prefix = workspacePrefixFor(uid);
  if (!prefix || String(uid).includes('-')) return []; // planWorkspaceErase's own refusals
  const byId = admin.firestore.FieldPath.documentId();
  const ids = new Set<string>();
  // Two collections, because a workspace can exist in one and not the other: the files store holds the
  // app's source, the deployment store holds an app that was published. Both are id-keyed, so this is
  // the same exact range in both cases — not a widening.
  for (const collection of ['workspace_files_v3', 'agentv3_deployments']) {
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const base = store.collection(collection).orderBy(byId);
      // `select()` with no field: REFERENCES ONLY. Nothing about the app's contents is read here —
      // the same economy `adminSubcollectionSource.parentIds` uses.
      const q = (after ? base.startAfter(after) : base.startAt(prefix))
        .endAt(`${prefix}${RANGE_END_CHAR}`)
        .select()
        .limit(PAGE);
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) ids.add(d.id);
      after = snap.docs[snap.docs.length - 1].id;
      if (snap.size < PAGE) break;
    }
  }
  return [...ids];
}

/**
 * Erase every derived-id document belonging to `uid`.
 *
 * MUST RUN BEFORE `deleteUserData` and `deleteUserWorkspaceData` — see the module header. Best-effort
 * per collection, matching both of them: one failing collection is recorded and the rest still run, so
 * a flaky index cannot leave the remainder of someone's data behind.
 */
export async function deleteUserDerivedIdData(uid: string): Promise<DerivedEraseReport> {
  const empty: DerivedEraseReport = { uid, collections: [], totalDeleted: 0, keys: { bots: 0, historySessions: 0 } };
  if (!uid || typeof uid !== 'string') return { ...empty, refusal: 'unusable-uid' };
  const store = db();
  if (!store) return empty;

  const collections: DerivedEraseResult[] = [];
  const plan = planUidPrefixErase(uid);

  // ── The composite-id stores: `${uid}__${projectId}` ──────────────────────────────────────────────
  for (const entry of UID_PREFIXED_COLLECTIONS) {
    if (!plan.range) {
      // Reported, not skipped silently: the caller surfaces the refusal so a human can finish it.
      collections.push({ collection: entry.collection, documents: 0, children: 0, error: `refused: ${plan.refusal}` });
      continue;
    }
    try {
      const n = await deleteIdRange(store, entry.collection, plan.range, entry.sub);
      collections.push({ collection: entry.collection, ...n });
    } catch (e) {
      collections.push({ collection: entry.collection, documents: 0, children: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── `bot_sessions/{botId}_{chatId}`, resolved from the bots this user owns ───────────────────────
  let botIds: string[] = [];
  let sessionDocs = 0;
  let botError: string | undefined;
  try {
    botIds = await ownedBotIds(store, uid);
    for (const botId of botIds) {
      const range = planBotSessionErase(botId);
      if (!range) continue; // a bot id that could be another's prefix is never swept
      const n = await deleteIdRange(store, 'bot_sessions', range);
      sessionDocs += n.documents;
    }
  } catch (e) {
    botError = e instanceof Error ? e.message : String(e);
  }
  collections.push({ collection: 'bot_sessions', documents: sessionDocs, children: 0, error: botError });

  // ── `build_history/{sessionId}` + `versions`, resolved from both exact sources ───────────────────
  let historyKeys: string[] = [];
  let historyDocs = 0;
  let historyChildren = 0;
  let historyError: string | undefined;
  try {
    const [sessionIds, workspaceIds] = await Promise.all([
      ownedHistorySessionIds(store, uid),
      ownedWorkspaceIds(store, uid),
    ]);
    historyKeys = buildHistoryKeysFor(uid, sessionIds, workspaceIds);
    for (const key of historyKeys) {
      const ref = store.collection('build_history').doc(key);
      // The `versions` subcollection holds the actual version metadata, so it goes FIRST — and it is
      // swept whether or not the parent document exists, because Firestore keeps a subcollection under
      // a missing parent perfectly happily and that is precisely how Q-134 lost data.
      historyChildren += await deleteSubcollection(ref, 'versions');
      const snap = await ref.get();
      if (snap.exists) { await ref.delete(); historyDocs++; }
    }
  } catch (e) {
    historyError = e instanceof Error ? e.message : String(e);
  }
  collections.push({ collection: 'build_history', documents: historyDocs, children: historyChildren, error: historyError });

  return {
    uid,
    collections,
    totalDeleted: collections.reduce((s, c) => s + c.documents + c.children, 0),
    keys: { bots: botIds.length, historySessions: historyKeys.length },
    ...(plan.range ? {} : { refusal: plan.refusal }),
  };
}
