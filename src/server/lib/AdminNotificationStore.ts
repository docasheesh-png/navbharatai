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
    const state = uid ? await getUserState(uid) : { readIds: new Set<string>(), dismissedIds: new Set<string>() };
    // Dismissed ones are filtered out entirely — to this user they are deleted, and they never come
    // back. The document itself survives for everyone else (see dismissNotifications).
    const applicable = all.filter((n) => notificationMatchesUser(n, uid, email) && !state.dismissedIds.has(n.id));
    return applicable.map((n) => ({ ...n, read: state.readIds.has(n.id) }));
  } catch {
    return [];
  }
}

/** Per-user state: which notifications this user has read, and which they have dismissed. */
interface UserNotificationState {
  readIds: Set<string>;
  dismissedIds: Set<string>;
}

async function getUserState(uid: string): Promise<UserNotificationState> {
  const empty: UserNotificationState = { readIds: new Set(), dismissedIds: new Set() };
  const db = getDb();
  if (!db) return empty;
  try {
    const doc = await db.collection(READS_COLLECTION).doc(uid).get();
    if (!doc.exists) return empty;
    const data = doc.data() ?? {};
    return {
      readIds: new Set(Array.isArray(data.readIds) ? (data.readIds as string[]) : []),
      dismissedIds: new Set(Array.isArray(data.dismissedIds) ? (data.dismissedIds as string[]) : []),
    };
  } catch {
    return empty;
  }
}

/** Keep either list bounded for a very old account. Newest wins — the oldest ids fall off the end. */
const STATE_CAP = 500;
const capIds = (s: Set<string>): string[] => Array.from(s).slice(-STATE_CAP);

/**
 * The ONE writer for a user's notification state.
 *
 * 🔴 WHY IT IS ONE FUNCTION (2026-09-11, adding dismissal). The read-state write was
 * `ref.set({ readIds }, { merge: false })` — a FULL document replace. Adding `dismissedIds` as a
 * second independent writer would have meant that opening the bell (which marks things read) silently
 * WIPED every dismissal, and dismissing silently wiped read state: deleted notifications would
 * reappear, with nothing failing anywhere to explain it. Both fields are now read and written
 * together, by this function only, so they cannot erase each other.
 *
 * Best-effort; never throws.
 */
async function updateUserState(uid: string, add: { read?: string[]; dismissed?: string[] }): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const state = await getUserState(uid);
    for (const id of add.read ?? []) if (typeof id === 'string' && id) state.readIds.add(id);
    for (const id of add.dismissed ?? []) if (typeof id === 'string' && id) state.dismissedIds.add(id);
    await db.collection(READS_COLLECTION).doc(uid).set(
      { readIds: capIds(state.readIds), dismissedIds: capIds(state.dismissedIds), updatedAt: Date.now() },
      { merge: false },
    );
  } catch { /* best-effort */ }
}

/** Mark notifications read for a user (idempotent union). Best-effort; never throws. */
export async function markNotificationsRead(uid: string, ids: string[]): Promise<void> {
  if (!uid || !Array.isArray(ids) || ids.length === 0 || process.env.VITEST) return;
  await updateUserState(uid, { read: ids });
}

/**
 * Dismiss ("delete") notifications FOR THIS USER ONLY.
 *
 * 🔒 IT DOES NOT DELETE THE DOCUMENT, AND MUST NOT. A broadcast (`target: {type:'all'}`) is ONE
 * document that every user's list reads. Deleting it because one person pressed a delete button would
 * remove that message from everybody's inbox — including people who never saw it. Dismissal is
 * per-user, exactly like read state, so the button does what the person expects and nothing more.
 *
 * Idempotent: dismissing the same id twice is a no-op, and dismissing an id the user cannot see
 * changes nothing they can observe. Best-effort; never throws.
 */
export async function dismissNotifications(uid: string, ids: string[]): Promise<void> {
  if (!uid || !Array.isArray(ids) || ids.length === 0 || process.env.VITEST) return;
  await updateUserState(uid, { dismissed: ids });
}
