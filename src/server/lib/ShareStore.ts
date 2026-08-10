// P-COLLAB.3 — Client / Stakeholder Share Portal + Feedback.
//
// Lets an owner share a BUILT app read-only with a non-member (client/stakeholder) via a token link,
// and collect their feedback/approval — a natural deliverable-handoff for an app builder. The shared
// app is a point-in-time HTML snapshot stored under `shares/{token}`; feedback lives in a subcollection
// so anyone with the link can leave a response without an account.
//
//   • `shares/{token}`               — { token, ownerId, title, html, status, createdAt, expiresAt }.
//   • `shares/{token}/feedback/{id}` — { rating, comment, name, timestamp }.
//
// Pattern mirrors TeamStore: firebase-admin, VITEST-skip, best-effort (never throws). Pure builders /
// validators are unit-tested without I/O. The snapshot is rendered in a sandboxed iframe on the client
// (no same-origin), so a share can never touch the platform.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const SHARES_COLLECTION = 'shares';
const FEEDBACK_SUBCOLLECTION = 'feedback';

/** Shares are valid for 30 days by default. */
export const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Size caps — keep documents small and abuse-resistant. */
export const MAX_HTML = 600_000; // ~600 KB snapshot
export const MAX_TITLE = 200;
export const MAX_COMMENT = 2000;
export const MAX_NAME = 80;
const MAX_FEEDBACK_RETURN = 500;

export type ShareStatus = 'active' | 'revoked';
export type FeedbackRating = 'approve' | 'changes' | 'reject';

export interface ShareRecord {
  token: string;
  ownerId: string;
  title: string;
  html: string;
  status: ShareStatus;
  createdAt: number;
  expiresAt: number;
}

export interface FeedbackRecord {
  rating: FeedbackRating;
  comment: string;
  name: string;
  timestamp: number;
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

// ───────────────────────────── Pure logic (unit-tested) ─────────────────────────────

/** Normalise a feedback rating; unknown/missing defaults to 'changes' (a neutral "needs work"). Pure. */
export function normalizeRating(rating: unknown): FeedbackRating {
  const r = String(rating ?? '').trim().toLowerCase();
  if (r === 'approve' || r === 'approved' || r === 'accept') return 'approve';
  if (r === 'reject' || r === 'rejected' || r === 'decline') return 'reject';
  return 'changes';
}

/** Build a normalised, size-capped share record. Pure — caller supplies token + clock. */
export function buildShareRecord(input: {
  token: string;
  ownerId: string;
  title?: unknown;
  html?: unknown;
  now: number;
  ttlMs?: number;
}): ShareRecord {
  const now = Number.isFinite(input.now) && input.now > 0 ? input.now : 0;
  const ttl = Number.isFinite(input.ttlMs as number) && (input.ttlMs as number) > 0 ? (input.ttlMs as number) : SHARE_TTL_MS;
  const title = String(input.title ?? '').trim().slice(0, MAX_TITLE) || 'Shared app';
  const html = String(input.html ?? '').slice(0, MAX_HTML);
  return {
    token: String(input.token),
    ownerId: String(input.ownerId ?? ''),
    title,
    html,
    status: 'active',
    createdAt: now,
    expiresAt: now + ttl,
  };
}

/** Is a share openable right now? (active + not expired). Pure. */
export function isShareValid(share: Pick<ShareRecord, 'status' | 'expiresAt'> | null | undefined, now: number): boolean {
  if (!share) return false;
  if (share.status !== 'active') return false;
  if (typeof share.expiresAt === 'number' && share.expiresAt > 0 && now > share.expiresAt) return false;
  return true;
}

/** Build a normalised, size-capped feedback record. Pure. */
export function buildFeedback(input: { rating?: unknown; comment?: unknown; name?: unknown; now: number }): FeedbackRecord {
  return {
    rating: normalizeRating(input.rating),
    comment: String(input.comment ?? '').trim().slice(0, MAX_COMMENT),
    name: String(input.name ?? '').trim().slice(0, MAX_NAME) || 'Anonymous',
    timestamp: Number.isFinite(input.now) && input.now > 0 ? input.now : 0,
  };
}

// ───────────────────────────── Firestore adapters (best-effort, never throw) ─────────────────────────────

/** Persist a share. Returns whether it was written (false when Firestore is off). */
export async function saveShare(share: ShareRecord): Promise<boolean> {
  const db = getDb();
  if (!db || !share.token) return false;
  try {
    await db.collection(SHARES_COLLECTION).doc(share.token).set(share, { merge: true });
    return true;
  } catch {
    return false;
  }
}

/** Resolve a share by token. Returns null when missing/unreadable. */
export async function getShare(token: string): Promise<ShareRecord | null> {
  if (!token) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(SHARES_COLLECTION).doc(token).get();
    if (!snap.exists) return null;
    const data = snap.data() as Partial<ShareRecord> | undefined;
    if (!data || !data.token) return null;
    return {
      token: String(data.token),
      ownerId: String(data.ownerId ?? ''),
      title: String(data.title ?? 'Shared app'),
      html: String(data.html ?? ''),
      status: (data.status as ShareStatus) ?? 'active',
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

/** Revoke a share (owner action). Best-effort. */
export async function revokeShare(token: string): Promise<void> {
  const db = getDb();
  if (!db || !token) return;
  try {
    await db.collection(SHARES_COLLECTION).doc(token).set({ status: 'revoked' }, { merge: true });
  } catch {
    /* best-effort */
  }
}

/** Append a feedback record to a share. Returns whether it was written. */
export async function addFeedback(token: string, feedback: FeedbackRecord): Promise<boolean> {
  const db = getDb();
  if (!db || !token) return false;
  try {
    await db.collection(SHARES_COLLECTION).doc(token).collection(FEEDBACK_SUBCOLLECTION).add(feedback);
    return true;
  } catch {
    return false;
  }
}

/** List a share's feedback (newest first). Never throws. */
export async function listFeedback(token: string): Promise<FeedbackRecord[]> {
  if (!token) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(SHARES_COLLECTION)
      .doc(token)
      .collection(FEEDBACK_SUBCOLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(MAX_FEEDBACK_RETURN)
      .get();
    const out: FeedbackRecord[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Partial<FeedbackRecord> | undefined;
      if (data) {
        out.push(buildFeedback({ rating: data.rating, comment: data.comment, name: data.name, now: typeof data.timestamp === 'number' ? data.timestamp : 0 }));
      }
    }
    return out;
  } catch {
    return [];
  }
}
