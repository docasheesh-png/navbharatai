// THE ADMIN AUDIT LOG — every admin action in one place, newest first (admin panel audit, PR 3, 2026-10-05).
//
// `audit()` writes every event to `server_logs`, which also holds every other server line and keeps 30 days.
// Querying admin actions out of it needs an equality filter plus a time order, which is a composite index
// this project does not deploy — the index-safe reader then fetches an UNORDERED 500 and sorts them, so
// once there are more than 500 admin lines the "newest" page would be an arbitrary one. A screen that
// shows the wrong 50 rows as the latest is worse than no screen.
//
// So admin actions are ALSO written here, to a collection that holds nothing else: ordering by `ts` alone
// is a single-field index Firestore keeps automatically, so "newest first, then the next page" is exact.
// Kept 180 days (RETENTION_POLICIES). Best-effort and never throws, exactly like the log it copies.

import { randomUUID } from 'node:crypto';
import { getServerDb } from './serverDb';
import { adminAuditRow, type AdminAuditRow } from '../../lib/adminAuditEvents';

export const ADMIN_AUDIT_COLLECTION = 'admin_audit_log';

const MAX_PAGE = 100;

function db() {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try { return getServerDb(); } catch { return null; }
}

/** Keep the entry small and storable: plain values only, long strings cut, no undefined. */
function storable(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 1000);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else {
      try { out[k] = JSON.stringify(v).slice(0, 1000); } catch { /* unserialisable — dropped */ }
    }
  }
  return out;
}

/** Copy one admin action into the log. Fire-and-forget; a failure here never reaches the request. */
export function appendAdminAudit(event: string, meta: Record<string, unknown>, ts: number = Date.now()): void {
  try {
    const d = db();
    if (!d) return;
    const id = randomUUID();
    d.collection(ADMIN_AUDIT_COLLECTION).doc(id).set({ ...storable(meta), id, event, ts }).catch(() => {});
  } catch { /* the stdout audit line remains the record */ }
}

export interface AdminAuditPage {
  rows: AdminAuditRow[];
  /** Pass back as `before` for the next page, or null when this page was the last. */
  nextBefore: number | null;
  /** False when there is no database — the screen says so instead of showing an empty log. */
  available: boolean;
}

/**
 * One page, newest first, strictly older than `before` when given.
 *
 * ⚠️ The cursor is a timestamp, so two admin actions recorded in the SAME millisecond on a page boundary
 * would show only the first. Ordering by a second field to break the tie needs a composite index this
 * project does not deploy; for actions a person takes by hand, a shared millisecond is not a real case.
 */
export async function readAdminAuditPage(opts: { before?: number; limit?: number } = {}): Promise<AdminAuditPage> {
  const d = db();
  if (!d) return { rows: [], nextBefore: null, available: false };
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 50), 1), MAX_PAGE);
  let q = d.collection(ADMIN_AUDIT_COLLECTION).orderBy('ts', 'desc') as FirebaseFirestore.Query;
  if (typeof opts.before === 'number' && Number.isFinite(opts.before)) q = q.where('ts', '<', opts.before);
  const snap = await q.limit(limit + 1).get();
  const docs = snap.docs.map((doc) => doc.data() as Record<string, unknown>);
  const page = docs.slice(0, limit).map((e) => adminAuditRow(e));
  return { rows: page, nextBefore: docs.length > limit && page.length ? page[page.length - 1].ts : null, available: true };
}
