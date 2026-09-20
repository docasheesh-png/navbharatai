// WHAT THE USER MUST DO — the durable half (admin 2026-09-20).
//
// The asks the engine makes have never been written down anywhere: `pendingSecrets`,
// `pendingPermission` and `pendingClarify` are React state on one screen, so a reload, a tab change,
// or coming back tomorrow loses the record entirely. That is half of why the admin could say the thing
// gets buried — it does not merely scroll away, it ceases to exist.
//
// This is the persistence, and nothing else: every decision lives in the PURE `userActions.ts`.
// Pattern mirrors `CheckpointStore` — firebase-admin, VITEST-skip, best-effort, never throws, because
// failing to record a task must never be able to fail a build.
//
// 🔒 ONE DOC PER ROW, AT A DETERMINISTIC ID. The id comes from `actionKey`, which is derived from the
// THING being asked for, so "we still need RAZORPAY_KEY_ID" written twice is one document by
// construction rather than by a read-modify-write that two concurrent writers could race. It also
// means the merge below reads ONE document instead of the whole list, so two rows being recorded at
// the same moment never touch each other.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import {
  MAX_ACTIONS, mergeUserActions,
  type UserAction, type UserActionClosedBy, type UserActionKind, type UserActionStatus,
} from './userActions';

const COLLECTION = 'workspace_user_actions_v1';

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

const KINDS: readonly UserActionKind[] = ['secret', 'approve', 'question'];
const STATUSES: readonly UserActionStatus[] = ['open', 'done', 'not_needed', 'superseded'];
const CLOSED_BY: readonly UserActionClosedBy[] = ['user', 'verified', 'ai', 'system'];

/**
 * Validate a stored row back into a `UserAction`, or null. PURE and exported for tests.
 *
 * A row that cannot be read is DROPPED rather than repaired into a plausible one. This list is shown
 * to a user as "here is what you have to do"; a half-understood record turned into a confident task is
 * the kind of invented instruction the honesty rules forbid, and an absent row costs only that the
 * engine asks again.
 */
export function normalizeUserAction(raw: unknown): UserAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const kind = r.kind as UserActionKind;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const status = r.status as UserActionStatus;
  if (!id || !title || !KINDS.includes(kind) || !STATUSES.includes(status)) return null;
  const out: UserAction = {
    id,
    kind,
    title: title.slice(0, 300),
    why: typeof r.why === 'string' ? r.why.slice(0, 500) : '',
    blocking: r.blocking === true,
    buildId: typeof r.buildId === 'string' ? r.buildId : '',
    status,
    createdAt: typeof r.createdAt === 'number' && r.createdAt > 0 ? r.createdAt : Date.now(),
  };
  // Firestore rejects an explicit `undefined`, and `saveUserActions`' catch would hide that as a
  // silently-empty tray — so every optional field is set only when it genuinely has a value.
  if (typeof r.envName === 'string' && r.envName) out.envName = r.envName;
  if (typeof r.callId === 'string' && r.callId) out.callId = r.callId;
  if (typeof r.closedAt === 'number' && r.closedAt > 0) out.closedAt = r.closedAt;
  if (CLOSED_BY.includes(r.closedBy as UserActionClosedBy)) out.closedBy = r.closedBy as UserActionClosedBy;
  return out;
}

function itemsRef(db: admin.firestore.Firestore, workspaceId: string) {
  return db.collection(COLLECTION).doc(workspaceId).collection('items');
}

/**
 * Record asks against a workspace, applying the merge rules of `userActions.ts` per row.
 *
 * Best-effort and per-document: one row failing to write never stops the next, and a failure never
 * reaches the build. Returns the rows that were actually written, so a caller can tell the difference
 * between "nothing new" and "we could not store it" instead of assuming.
 */
export async function saveUserActions(workspaceId: string, actions: readonly UserAction[]): Promise<UserAction[]> {
  if (!workspaceId || !actions?.length) return [];
  const db = getDb();
  if (!db) return [];
  const written: UserAction[] = [];
  for (const action of actions) {
    try {
      const ref = itemsRef(db, workspaceId).doc(action.id);
      const snap = await ref.get();
      const prev = snap.exists ? normalizeUserAction(snap.data()) : null;
      // No stored row → write this one. A stored row → let the PURE merge decide, which is where the
      // "a closed row is not re-opened by the same build" rule lives. An unchanged result is not
      // written at all, so a build that repeats an ask costs no write.
      const next = prev ? mergeUserActions([prev], [action])[0] : action;
      if (prev && JSON.stringify(next) === JSON.stringify(prev)) continue;
      await ref.set(next);
      written.push(next);
    } catch {
      /* best-effort — recording a task must never affect the build that raised it */
    }
  }
  return written;
}

/** Every row for a workspace, oldest first. Never throws; an unreadable store reads as empty. */
export async function loadUserActions(workspaceId: string): Promise<UserAction[]> {
  if (!workspaceId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await itemsRef(db, workspaceId).orderBy('createdAt', 'desc').limit(MAX_ACTIONS).get();
    const rows = snap.docs.map((d) => normalizeUserAction(d.data())).filter((a): a is UserAction => !!a);
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/**
 * Close one row. Returns false when there was nothing to close, and that honesty is the point.
 *
 * 🔒 An UPDATE, never a merge-set. A `set(..., { merge: true })` against a missing document CREATES
 * it, so a close for an id that does not exist would MINT a row that is already done — a task nobody
 * ever had, sitting in the user's history for ever. Same defect class as `DeploymentStore.setStatus`
 * (2026-09-18) and the reason `setCheckpointLabel` is an update too.
 */
export async function closeUserAction(
  workspaceId: string,
  id: string,
  status: Exclude<UserActionStatus, 'open'>,
  by: UserActionClosedBy,
  now: number = Date.now(),
): Promise<boolean> {
  if (!workspaceId || !id) return false;
  const db = getDb();
  if (!db) return false;
  try {
    await itemsRef(db, workspaceId).doc(id).update({ status, closedBy: by, closedAt: now, blocking: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a row claiming a build is waiting on it. Best-effort, and deliberately NOT a close.
 *
 * A gate the build gave up on is no longer blocking, but it is still something the user was asked and
 * never answered — closing it here would erase that. The tray simply stops opening itself for it.
 */
export async function releaseUserActionGate(workspaceId: string, callId: string): Promise<void> {
  if (!workspaceId || !callId) return;
  const db = getDb();
  if (!db) return;
  try {
    const snap = await itemsRef(db, workspaceId).where('callId', '==', callId).where('blocking', '==', true).get();
    await Promise.all(snap.docs.map((d) => d.ref.update({ blocking: false }).catch(() => {})));
  } catch {
    /* best-effort */
  }
}
