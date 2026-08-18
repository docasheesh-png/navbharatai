// P-COLLAB.3 — Client / Stakeholder Share Portal + Feedback.
//
// Lets an owner share a BUILT app read-only with a non-member (client/stakeholder) via a token link,
// and collect their feedback/approval — a natural deliverable-handoff for an app builder. The shared
// app is a point-in-time HTML snapshot stored under `shares/{token}`; feedback lives in a subcollection
// so anyone with the link can leave a response without an account.
//
//   • `shares/{token}`               — { token, ownerId, title, html|htmlPath, status, createdAt, expiresAt }.
//   • `shares/{token}/feedback/{id}` — { rating, comment, name, timestamp }.
//
// Pattern mirrors TeamStore: firebase-admin, VITEST-skip, best-effort (never throws). Pure builders /
// validators are unit-tested without I/O. The snapshot is rendered in a sandboxed iframe on the client
// (no same-origin), so a share can never touch the platform.
//
// WHY A STORAGE PATH EXISTS (root cause, not a magic-number bump). A shared app used to live entirely
// inside the `html` field of one Firestore document, and a Firestore document caps at 1 MiB. That cap
// silently blocked exactly the apps most worth showing a client: image-rich, polished builds whose
// inlined base64 assets push the self-contained snapshot past ~600 KB. So a small app stays INLINE in
// Firestore (one read, no round-trip), and anything above the inline limit is offloaded to Cloud Storage
// (the same bucket the App Store uses) with only a pointer kept in the doc — lifting the ceiling from
// ~600 KB to a real abuse-resistant `MAX_HTML`. When no bucket is configured the inline limit is the
// honest hard cap and the route says so, rather than truncating a runnable app into a broken one.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const SHARES_COLLECTION = 'shares';
const FEEDBACK_SUBCOLLECTION = 'feedback';
const SHARE_HTML_PREFIX = 'shares';

/** Shares are valid for 30 days by default. */
export const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Largest snapshot kept INLINE in the Firestore document. A Firestore doc caps at 1 MiB total, so this
 * stays well under it (the doc also carries token/owner/title/timestamps). Anything larger is offloaded
 * to Cloud Storage — see `shouldOffloadToStorage`.
 */
export const INLINE_HTML_LIMIT = 600_000; // ~600 KB
/**
 * Overall hard cap on a shareable snapshot. Above `INLINE_HTML_LIMIT` the bytes live in Cloud Storage,
 * so this ceiling exists only to stay abuse-resistant, not because of the Firestore field limit.
 */
export const MAX_HTML = 5_000_000; // ~5 MB — covers image-rich real apps
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
  /** When set, the snapshot lives in Cloud Storage at this path and `html` is empty until resolved. */
  htmlPath?: string;
  status: ShareStatus;
  createdAt: number;
  expiresAt: number;
}

/** Is the Cloud Storage bucket that backs large shares configured? Mirrors the App Store's resolution. */
export function isShareStorageConfigured(): boolean {
  return !!(process.env.NAV_STORE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
}

function shareBucketName(): string {
  return (process.env.NAV_STORE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
}

/**
 * The effective maximum a share request may carry, given whether Storage is configured. With a bucket
 * the ceiling is the real `MAX_HTML`; without one it is the inline Firestore-safe limit (no truncation).
 * Pure — the route uses it for an honest 413 with an accurate size in the message.
 */
export function effectiveMaxHtml(storageConfigured: boolean): number {
  return storageConfigured ? MAX_HTML : INLINE_HTML_LIMIT;
}

/**
 * Should this snapshot be offloaded to Cloud Storage rather than stored inline? Pure decision so the
 * inline/storage split is unit-tested without any I/O. Offload only when the bytes exceed the inline
 * limit AND a bucket exists; otherwise inline (small apps) — and a large app with no bucket never
 * reaches here because the route rejects it first.
 */
export function shouldOffloadToStorage(htmlLength: number, storageConfigured: boolean): boolean {
  return storageConfigured && htmlLength > INLINE_HTML_LIMIT;
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
  // The overall cap is a last-resort safety valve; the route rejects oversize with an honest 413 first,
  // so a snapshot is never silently truncated into a broken app on the real path.
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

/**
 * Persist a share. Small snapshots go inline; large ones offload their bytes to Cloud Storage and keep
 * only a pointer in the doc. Returns whether it was written (false when Firestore is off). Never throws.
 *
 * If the Storage write fails for a large app we do NOT silently fall back to an inline write that
 * Firestore would then reject for exceeding 1 MiB — that would report success on a doc that never
 * persisted. We return false so the route tells the owner the link was not created.
 */
export async function saveShare(share: ShareRecord): Promise<boolean> {
  const db = getDb();
  if (!db || !share.token) return false;
  try {
    if (shouldOffloadToStorage(share.html.length, isShareStorageConfigured())) {
      const path = `${SHARE_HTML_PREFIX}/${share.token}.html`;
      try {
        await admin
          .storage()
          .bucket(shareBucketName())
          .file(path)
          .save(Buffer.from(share.html, 'utf8'), {
            resumable: false,
            contentType: 'text/html; charset=utf-8',
            metadata: { cacheControl: 'private, max-age=0' },
          });
      } catch {
        return false;
      }
      const { html: _dropped, ...rest } = share;
      await db.collection(SHARES_COLLECTION).doc(share.token).set({ ...rest, html: '', htmlPath: path }, { merge: true });
      return true;
    }
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
    const htmlPath = typeof data.htmlPath === 'string' ? data.htmlPath : '';
    let html = String(data.html ?? '');
    // Storage-backed snapshot: pull the bytes back. A failed read yields null so the viewer sees an
    // honest "not available", never a blank frame presented as the app.
    if (htmlPath && !html) {
      try {
        const [buf] = await admin.storage().bucket(shareBucketName()).file(htmlPath).download();
        html = buf.toString('utf8');
      } catch {
        return null;
      }
    }
    return {
      token: String(data.token),
      ownerId: String(data.ownerId ?? ''),
      title: String(data.title ?? 'Shared app'),
      html,
      ...(htmlPath ? { htmlPath } : {}),
      status: (data.status as ShareStatus) ?? 'active',
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Revoke a share (owner action). The link stops working immediately (status flips), and any offloaded
 * bytes are deleted so a takedown is real — the same "a takedown genuinely removes the bytes" discipline
 * the App Store uses. Best-effort; the status flip is what makes the link dead regardless.
 */
export async function revokeShare(token: string): Promise<void> {
  const db = getDb();
  if (!db || !token) return;
  try {
    const snap = await db.collection(SHARES_COLLECTION).doc(token).get();
    const htmlPath = snap.exists ? (snap.data() as Partial<ShareRecord> | undefined)?.htmlPath : undefined;
    await db.collection(SHARES_COLLECTION).doc(token).set({ status: 'revoked' }, { merge: true });
    if (typeof htmlPath === 'string' && htmlPath) {
      try {
        await admin.storage().bucket(shareBucketName()).file(htmlPath).delete({ ignoreNotFound: true });
      } catch {
        /* the status flip already killed the link; a failed byte-delete is retried on next revoke */
      }
    }
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
