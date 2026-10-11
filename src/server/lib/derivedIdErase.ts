// ERASING A DOCUMENT WHOSE ID IS DERIVED — the third reachability shape, which neither eraser had.
//
// 🔴 THE CLASS, named plainly (Q-761, Q-764 — one root cause, two stores here, and see the scope note).
// Account deletion had exactly TWO ways to find a document:
//
//   1. `DataRetentionManager.deleteUserData`  — the doc id IS the uid, or a verified field equals it.
//   2. `workspaceDataErase.deleteUserWorkspaceData` — the doc id is a workspace id, swept by the
//      `agentv3-{uid}-…` id RANGE.
//
// A store whose doc id is DERIVED — built out of a key the eraser already holds, but not equal to it
// and not carried in the body — is reachable by neither. There is nothing to query. So each one was
// found, read, correctly judged unreachable, and recorded in `BUILD_REPORT_QUEUE.md` as an open row
// rather than registered on a guess:
//
//   · Q-764  `build_history/{sessionId}` + its `versions` subcollection — every build's version
//            metadata for every app. A BARE sessionId, which the `agentv3-{uid}-` range cannot match.
//   · Q-761  `bot_sessions/{botId}_{chatId}` (`BotStore.ts:283/296`) — per-chat conversation state for
//            a bot whose owner is gone. Reachable from the BOT, never from the uid.
//
// ⚠️ SCOPE, AND WHY IT IS NARROWER THAN THE CLASS (2026-10-09). `adrDecisions` and `techDebt`
// (`{uid}__{projectId}`, body `{records|items, updatedAt}`) are the same class and are NOT here. PR
// #3611, from another session and opened before this module existed, fixes them a different way: it
// makes the WRITERS store `userId` and registers the plain field. It also refuses a doc-id prefix
// range outright, on the grounds that a uid containing the separator makes `a__b` ambiguous with `a` +
// `b__…` — "a compliance gap is recoverable; deleting a different person's data is not".
//
// That reasoning is sound, their row, and theirs first, so this module stays off those two stores
// rather than racing them to the same file. One difference is worth recording because it is real and
// not settled here: their fix cannot reach a row written BEFORE it (they say so themselves — a live
// project self-heals on its next build, an abandoned one does not), while a uid prefix range would,
// and the ambiguity they refuse is impossible once any uid outside [A-Za-z0-9] is refused. That is a
// question for the admin, not something to take by overwriting somebody else's in-flight change.
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
// so it is refused outright when the key could be a prefix of another key, rather than being made to
// work in a case that cannot arise with real data.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { workspacePrefixFor } from './workspaceIdentity';
// Q-784: the same ownership predicate the workspace eraser applies to every document its range matched.
import { eraseableWorkspaceId } from './workspaceDataErase';

/** U+F8FF is a very high code point, so [prefix, prefix+U+F8FF] is exactly the prefix range. */
const RANGE_END_CHAR = String.fromCharCode(0xf8ff);

export type DerivedEraseRefusal = 'unusable-uid';

export interface PrefixRange { startAt: string; endAt: string }

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
/**
 * The range of `workspaceId` FIELD values belonging to `uid`, or null when it cannot be formed safely.
 *
 * 🔴 THE FOURTH REACHABILITY SHAPE (Q-784). `build_events` is appended with `.add()`, so its document
 * id is random, and its only link to a person is a `workspaceId` FIELD — `agentv3-{uid}-…`. So:
 *  · `deleteUserData`'s `{field}` strategy cannot reach it: that is EQUALITY against the uid, and this
 *    field holds a workspace id, of which one person has many.
 *  · `deleteUserWorkspaceData` cannot reach it: that sweeps a range over the DOCUMENT ID, and this
 *    document's id says nothing about anybody.
 *  · `planBotSessionErase` above cannot reach it: there is no key to derive and then look up.
 * A RANGE over the FIELD is the one query that matches exactly those documents, and Firestore serves it
 * from the single-field index it maintains automatically — no composite index to deploy.
 *
 * ⚠️ IT REFUSES THE SAME UID `ownedWorkspaceIds` REFUSES, and for the same reason: the prefix is
 * `agentv3-{uid}-`, so a uid containing `-` makes `agentv3-a-b-` ambiguous between uid `a-b` and uid `a`
 * with a workspace suffix starting `b-`. A compliance gap is recoverable; deleting a different person's
 * data is not. Every caller still verifies each matched document before deleting it, because "the range
 * should already guarantee this" is not a safety property when the action is irreversible.
 */
export function planWorkspaceFieldErase(uid: string | null | undefined): PrefixRange | null {
  const id = String(uid ?? '').trim();
  if (!id || id.includes('-')) return null;
  const prefix = workspacePrefixFor(id);
  if (!prefix) return null;
  return { startAt: prefix, endAt: `${prefix}${RANGE_END_CHAR}` };
}

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

/**
 * Delete every document of `collection` whose `field` falls in `range`, verifying each one first.
 *
 * Re-queries from the start of the range each page rather than paging with a cursor: the deletions
 * shrink the result set, and a cursor over a field with repeated values can stall. `progressed` is the
 * guard that makes that safe — a page where every document was REFUSED by the verifier would otherwise
 * be re-read until MAX_PAGES, so the loop stops the moment a page deletes nothing.
 */
async function deleteFieldRange(
  store: admin.firestore.Firestore,
  collection: string,
  field: string,
  range: PrefixRange,
  keep: (value: string) => boolean,
): Promise<number> {
  let documents = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const snap = await store.collection(collection)
      .orderBy(field).startAt(range.startAt).endAt(range.endAt)
      .limit(PAGE)
      .get();
    if (snap.empty) break;
    let progressed = false;
    for (const doc of snap.docs) {
      const value = String((doc.data() as Record<string, unknown>)[field] ?? '');
      if (!keep(value)) continue;
      await doc.ref.delete();
      documents++;
      progressed = true;
    }
    if (!progressed) break;
    if (snap.size < PAGE) break;
  }
  return documents;
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

  // ── `build_events`, found by a RANGE over its `workspaceId` FIELD (Q-784) ────────────────────────
  //
  // Every event the build bus ever published for one of this person's apps: the event type, the sender,
  // a trimmed payload preview and the workspace id — which contains their uid. Neither other eraser can
  // see it (see planWorkspaceFieldErase), so it survived account deletion entirely; Q-767's 90-day
  // window bounded that to 90 days, and §9 publishes 30 for personal data after a deletion, so the
  // window alone was not enough to keep the promise.
  let eventDocs = 0;
  let eventError: string | undefined;
  const eventRange = planWorkspaceFieldErase(uid);
  try {
    if (eventRange) {
      eventDocs = await deleteFieldRange(
        store, 'build_events', 'workspaceId', eventRange,
        // The same ownership question the workspace eraser asks of each document it matched.
        (workspaceId) => eraseableWorkspaceId(uid, workspaceId),
      );
    }
  } catch (e) {
    eventError = e instanceof Error ? e.message : String(e);
  }
  collections.push({ collection: 'build_events', documents: eventDocs, children: 0, error: eventError });

  return {
    uid,
    collections,
    totalDeleted: collections.reduce((s, c) => s + c.documents + c.children, 0),
    keys: { bots: botIds.length, historySessions: historyKeys.length },
  };
}
