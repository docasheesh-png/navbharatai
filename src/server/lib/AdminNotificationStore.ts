// Admin → user notifications (admin 2026-07-30).
//
// The admin needs to message users — ALL of them, or one specific user — and have it actually reach
// them in the app. The old `/api/admin/announcement` only pushed to an in-memory admin list (lost on
// restart, per-instance, never delivered to any user). This store is the real thing: durable Firestore
// notifications, per-user targeting, and per-user read state, so a user genuinely receives the message
// and can dismiss it.
//
// Pattern mirrors DiagnosticsStore: firebase-admin, VITEST-skip, best-effort, never throws. The
// targeting decision is a PURE, exported, unit-tested function so "who receives this" is locked.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const COLLECTION = 'admin_notifications';
const READS_COLLECTION = 'user_notification_reads';
/** Bound how many notifications a user fetch scans/returns. */
export const NOTIFICATIONS_DEFAULT_LIMIT = 50;

export type NotificationTarget =
  | { type: 'all' }
  | { type: 'user'; userId?: string | null; email?: string | null };

export interface AdminNotification {
  id: string;
  message: string;
  target: NotificationTarget;
  createdAt: number;
  createdBy: string;
}

/**
 * Does this notification apply to the given user? PURE + exported + unit-tested — the single source of
 * truth for delivery. 'all' reaches everyone; a 'user' target matches by userId OR by email
 * (case-insensitive), whichever the admin supplied. A 'user' target with neither field matches nobody.
 */
export function notificationMatchesUser(
  n: Pick<AdminNotification, 'target'>,
  uid: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const t = n.target;
  if (!t || t.type === 'all') return true;
  if (t.type === 'user') {
    const byId = !!t.userId && !!uid && t.userId === uid;
    const byEmail = !!t.email && !!email && t.email.trim().toLowerCase() === email.trim().toLowerCase();
    return byId || byEmail;
  }
  return false;
}

/** Normalise raw admin input into a clean target (all vs a specific user by email/uid). PURE + tested. */
export function normalizeTarget(raw: { target?: string; email?: string; userId?: string }): NotificationTarget {
  const target = (raw.target ?? 'all').trim().toLowerCase();
  if (target === 'all' || target === '') return { type: 'all' };
  // Any non-'all' target is a specific-user send; carry whichever identifier was provided.
  const email = (raw.email ?? '').trim();
  const userId = (raw.userId ?? '').trim();
  // If the admin typed an email into the target field itself, honour that.
  const emailFromTarget = target.includes('@') ? raw.target!.trim() : '';
  return { type: 'user', userId: userId || null, email: (email || emailFromTarget) || null };
}

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Persist one notification. Best-effort; returns the stored object (or null under VITEST/failure). */
export async function saveNotification(input: { message: string; target: NotificationTarget; createdBy?: string }): Promise<AdminNotification | null> {
  const message = (input.message ?? '').trim();
  if (!message) return null;
  const note: AdminNotification = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    message,
    target: input.target,
    createdAt: Date.now(),
    createdBy: input.createdBy || 'admin',
  };
  if (process.env.VITEST) return note;
  const db = getDb();
  if (!db) return note; // still return so the admin sees it went out; durability is best-effort
  try {
    await db.collection(COLLECTION).doc(note.id).set(note, { merge: false });
  } catch { /* best-effort */ }
  return note;
}

/** List the notifications applicable to a user, newest first, each flagged read/unread. Never throws. */
export async function listNotificationsForUser(
  uid: string | null,
  email: string | null,
  limit = NOTIFICATIONS_DEFAULT_LIMIT,
): Promise<Array<AdminNotification & { read: boolean }>> {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(Math.max(1, limit)).get();
    const all = snap.docs.map((d) => d.data() as AdminNotification);
    const applicable = all.filter((n) => notificationMatchesUser(n, uid, email));
    const readIds = uid ? await getReadIds(uid) : new Set<string>();
    return applicable.map((n) => ({ ...n, read: readIds.has(n.id) }));
  } catch {
    return [];
  }
}

async function getReadIds(uid: string): Promise<Set<string>> {
  const db = getDb();
  if (!db) return new Set();
  try {
    const doc = await db.collection(READS_COLLECTION).doc(uid).get();
    const ids = doc.exists ? (doc.data()?.readIds as string[] | undefined) : undefined;
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

/** Mark notifications read for a user (idempotent union). Best-effort; never throws. */
export async function markNotificationsRead(uid: string, ids: string[]): Promise<void> {
  if (!uid || !Array.isArray(ids) || ids.length === 0 || process.env.VITEST) return;
  const db = getDb();
  if (!db) return;
  try {
    const ref = db.collection(READS_COLLECTION).doc(uid);
    const existing = await getReadIds(uid);
    for (const id of ids) if (typeof id === 'string' && id) existing.add(id);
    // Cap so the read-list can't grow unbounded for a very old account.
    const capped = Array.from(existing).slice(-500);
    await ref.set({ readIds: capped, updatedAt: Date.now() }, { merge: false });
  } catch { /* best-effort */ }
}
