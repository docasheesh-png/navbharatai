// Account erasure for derived ids. Exact bot ownership is read from bots.ownerUid;
// legacy workspace ids and histories do not have equivalent verified owner proof.
// A session reference in an owned build row cannot authenticate bytes at a colliding
// agentv3-{uid}-{sessionId} key. Keep workspace-derived data pending verified review,
// including fresh history namespaces that still use those ambiguous physical keys.
// Run exact-owner erasure before other account erasers remove its parent keys.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { workspacePrefixFor, WORKSPACE_PREFIX, ANON_WORKSPACE_PREFIX } from './workspaceIdentity';
// Q-784: the same ownership predicate the workspace eraser applies to every document its range matched.
import { eraseableWorkspaceId, planWorkspaceErase } from './workspaceDataErase';

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

/** A legacy workspaceId field is not independent owner proof; share the destructive planner's refusal. */
export function planWorkspaceFieldErase(uid: string | null | undefined): PrefixRange | null {
  return planWorkspaceErase(uid).range;
}

/** Resolve only independently attributable histories; legacy workspace keys currently resolve nothing. PURE. */
export function buildHistoryKeysFor(
  uid: string,
  sessionIds: readonly string[],
  workspaceIds: readonly string[],
): string[] {
  // A trusted source row owns its own session reference, not every record at the
  // colliding legacy workspace key. Fresh v2 collection names do not repair that key.
  if (!planWorkspaceErase(uid).range) return [];
  const prefix = workspacePrefixFor(uid);
  if (!prefix || uid === 'anon') return [];
  const keys = new Set<string>();
  // Future ownership proof must cover the physical key, not merely a source reference.
  // The current legacy-key planner refuses both old global and canonical full-key histories.
  const addWorkspace = (ws: string): void => {
    if (!ws.startsWith(ANON_WORKSPACE_PREFIX) && eraseableWorkspaceId(uid, ws)
      && /^[A-Za-z0-9_-]{1,128}$/.test(ws.slice(prefix.length))) keys.add(ws);
  };
  for (const s of sessionIds) {
    const id = String(s ?? '').trim();
    if (!id) continue;
    if (id.startsWith(WORKSPACE_PREFIX)) addWorkspace(id);
    else if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) addWorkspace(`${prefix}${id}`);
  }
  for (const w of workspaceIds) {
    const ws = String(w ?? '').trim();
    if (ws) addWorkspace(ws);
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
  /** Known attribution limitation, not a claim that any particular user has retained snapshots. */
  limitations?: readonly { code: string; collection: string; message: string }[];
}

export const LEGACY_HISTORY_ERASURE_LIMITATION = {
  code: 'legacy-history-ownership-unverified',
  collection: 'build_history',
  message: 'Old build snapshots whose owner cannot be verified are retained pending ownership review.',
} as const;

export const WORKSPACE_OWNERSHIP_ERASURE_LIMITATION = {
  code: 'workspace-ownership-unverified',
  collection: 'workspace-scoped-data',
  message: 'Older records, including workspaces, synced copies, conversations, voice memory, engineering notes and app identities, without independently verified ownership are retained pending ownership review.',
} as const;

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

/** List only independently attributable workspace ids; never bypass the destructive planner. */
async function ownedWorkspaceIds(store: admin.firestore.Firestore, uid: string): Promise<string[]> {
  const plan = planWorkspaceErase(uid);
  if (!plan.range) return [];
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
      const q = (after ? base.startAfter(after) : base.startAt(plan.range.startAt))
        .endAt(plan.range.endAt)
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
  const empty: DerivedEraseReport = {
    uid, collections: [], totalDeleted: 0, keys: { bots: 0, historySessions: 0 },
    limitations: [LEGACY_HISTORY_ERASURE_LIMITATION, WORKSPACE_OWNERSHIP_ERASURE_LIMITATION],
  };
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

  // ── Canonical `build_history_v2/{workspaceId}` + `versions`, resolved from owned sources ─────────
  // Neither old global nor full-key history rows have independent owner proof.
  // An own source reference cannot authorize bytes at a key that another owner also derives.
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
      const ref = store.collection('build_history_v2').doc(key);
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
  collections.push({ collection: 'build_history_v2', documents: historyDocs, children: historyChildren, error: historyError });

  // ── `build_events`, found by a RANGE over its `workspaceId` FIELD (Q-784) ────────────────────────
  //
  // The event's legacy workspaceId field is not independently verified ownership.
  // The shared planner refuses this sweep; retention and verified attribution remain open.
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
    limitations: [LEGACY_HISTORY_ERASURE_LIMITATION, WORKSPACE_OWNERSHIP_ERASURE_LIMITATION],
  };
}
