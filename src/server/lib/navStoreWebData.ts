// SHARED DATA for store instant-apps — tiny rows, hard quotas (Kadam 4, admin-approved 2026-08-15).
//
// WHAT THIS IS: the smallest data layer that makes a chat, a guestbook, a leaderboard or a booking
// sheet WORK between viewers of a store app — append a row, list rows. Nothing else. An app that
// needs more than rows (auth, relations, files) is a Supabase app, and the platform's existing
// one-click Supabase provisioning is the path for it — on the CREATOR'S OWN account, exactly as the
// standing rule requires.
//
// ⚠️ THE RULE THIS DELIBERATELY BENDS, with the admin's explicit approval (2026-08-15 plan
// discussion, recorded in CLAUDE.md the same day): "user apps never run on NavBharatAI's accounts."
// These rows DO live on NavBharatAI's Firestore — because requiring a Supabase account before a
// shared guestbook works would lose 90% of creators at the door. The bend is bounded by the quotas
// below, which are not tuning knobs but the terms of the exception: SMALL shared data rides free;
// anything bigger belongs on the creator's own database.
//
// THE QUOTAS ARE THE PRODUCT'S PROMISE TO THE ADMIN — one runaway or malicious app must never
// become the platform's bill:
//   • rows are capped per app (total AND per day), and each row is capped in size;
//   • over-quota is an HONEST 429 the app can show, never a silent drop and never our overdraft;
//   • per-caller rate limits ride the platform's existing tested limiter at the route layer.
//
// PRIVACY, said honestly rather than implied: rows are keyed by the app's unguessable id. A private
// (password) app's DATA is exactly as private as its id — the data API does not re-check the app
// password, because the app's own fetch calls cannot carry it. Do not build medical records on a
// guestbook API; the store's terms say what this is for.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export const MAX_ROWS_PER_APP = 5_000;
export const MAX_WRITES_PER_APP_PER_DAY = 2_000;
export const MAX_ROW_BYTES = 2_048;
export const MAX_LIST_LIMIT = 100;

/** Collection names an app may use: short, lowercase, no path tricks. */
const COLLECTION_NAME = /^[a-z][a-z0-9_-]{0,30}$/;

export function isValidDataCollection(name: unknown): name is string {
  return typeof name === 'string' && COLLECTION_NAME.test(name);
}

/**
 * Validate one row's payload. The row is stored as the JSON the app sent — the size cap is on the
 * SERIALIZED form, because that is what actually occupies the database.
 */
export function validateRow(data: unknown): { ok: boolean; json?: string; reason?: string } {
  if (data === undefined) return { ok: false, reason: 'Send { data: … } — the row to add.' };
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return { ok: false, reason: 'The row must be JSON-serializable.' };
  }
  if (typeof json !== 'string') return { ok: false, reason: 'The row must be JSON-serializable.' };
  if (Buffer.byteLength(json, 'utf8') > MAX_ROW_BYTES) {
    return { ok: false, reason: `A row may be at most ${MAX_ROW_BYTES / 1024} KB — keep rows small (a message, a score, a booking).` };
  }
  return { ok: true, json };
}

/** The server-clock day bucket for the daily write quota (a device clock must not move it). */
export function dayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const APPS = 'nav_store_web_apps';
/**
 * Rows live in a PER-COLLECTION subcollection (`data_<name>`) rather than one `data` subcollection
 * with a `collection` field. Not a style choice — the flat shape forced the read to be
 * `.where('collection','==',…).orderBy('at','desc')`, a composite-index query that throws
 * FAILED_PRECONDITION in production until an index is hand-created in a console no session can
 * reach (the exact failure class behind the store's first real publish, 2026-08-15). One
 * subcollection per app-collection makes the read a single-field orderBy, which Firestore
 * auto-indexes — the index requirement is gone by construction. Safe as a path segment because
 * every caller validates the name against COLLECTION_NAME first (and the functions re-check).
 */
const DATA_SUB_PREFIX = 'data_';
const META_SUB = 'data_meta';

function dataSub(collection: string): string {
  return DATA_SUB_PREFIX + collection;
}

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

export type AddRowResult =
  | { ok: true; row: { id: string; data: unknown; at: number } }
  | { ok: false; status: number; reason: string };

/**
 * Append one row, enforcing BOTH quotas inside one transaction — so two concurrent writes racing the
 * last quota slot cannot both pass, which is the only way a cap is a cap.
 */
export async function addDataRow(appId: string, collection: string, data: unknown): Promise<AddRowResult> {
  const d = db();
  if (!d) return { ok: false, status: 503, reason: 'The data store is unavailable right now.' };
  if (!isValidDataCollection(collection)) return { ok: false, status: 400, reason: 'Invalid collection name.' };
  const valid = validateRow(data);
  if (!valid.ok) return { ok: false, status: 400, reason: valid.reason! };

  const appRef = d.collection(APPS).doc(appId);
  const dayRef = appRef.collection(META_SUB).doc(dayBucket());
  const rowRef = appRef.collection(dataSub(collection)).doc();
  const at = Date.now();
  try {
    const verdict = await d.runTransaction(async (t) => {
      const [appSnap, daySnap] = await Promise.all([t.get(appRef), t.get(dayRef)]);
      if (!appSnap.exists) return 'gone' as const;
      const total = (appSnap.data() as { dataRows?: number }).dataRows ?? 0;
      if (total >= MAX_ROWS_PER_APP) return 'total' as const;
      const today = daySnap.exists ? ((daySnap.data() as { writes?: number }).writes ?? 0) : 0;
      if (today >= MAX_WRITES_PER_APP_PER_DAY) return 'daily' as const;
      t.set(rowRef, { data: JSON.parse(valid.json!), at });
      t.update(appRef, { dataRows: admin.firestore.FieldValue.increment(1) });
      t.set(dayRef, { writes: admin.firestore.FieldValue.increment(1) }, { merge: true });
      return 'ok' as const;
    });
    if (verdict === 'gone') return { ok: false, status: 404, reason: 'This app is not on the store.' };
    if (verdict === 'total') {
      return { ok: false, status: 429, reason: `This app has reached its storage limit (${MAX_ROWS_PER_APP} rows). The creator can move it to their own database (Settings → Database) for room to grow.` };
    }
    if (verdict === 'daily') {
      return { ok: false, status: 429, reason: 'This app has reached today\'s activity limit — try again tomorrow, or the creator can move it to their own database.' };
    }
    return { ok: true, row: { id: rowRef.id, data: JSON.parse(valid.json!), at } };
  } catch {
    return { ok: false, status: 502, reason: 'The row could not be saved — nothing was stored.' };
  }
}

export async function listDataRows(appId: string, collection: string, limit: number): Promise<Array<{ id: string; data: unknown; at: number }>> {
  const d = db();
  if (!d) return [];
  if (!isValidDataCollection(collection)) return [];
  const n = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limit) || 50));
  // Single-field orderBy on a per-collection subcollection — auto-indexed, no composite index ever.
  const snap = await d.collection(APPS).doc(appId).collection(dataSub(collection))
    .orderBy('at', 'desc')
    .limit(n)
    .get();
  return snap.docs.map((x) => {
    const v = x.data() as { data?: unknown; at?: number };
    return { id: x.id, data: v.data, at: typeof v.at === 'number' ? v.at : 0 };
  });
}
