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
import { verifiedOwnerKeySegment } from './workspaceAssetStorage';

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
      const path = shareHtmlObjectPath(share.ownerId, share.token);
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

/**
 * Where a large share's HTML is kept (Q-3611). A share created by a VERIFIED owner (the share route takes `ownerId`
 * from the token, never the body) is filed under that owner — `shares/<owner>/<token>.html`, the same one-level owner
 * encoding the workspace-asset and proof-picture erasers use — so account deletion reaches it with one prefix delete
 * even if its Firestore pointer is already gone. An owner with no usable id keeps the legacy `shares/<token>.html`,
 * which only its record can point at. PURE.
 */
export function shareHtmlObjectPath(ownerId: string, token: string): string {
  const owner = verifiedOwnerKeySegment(ownerId);
  return owner ? `${SHARE_HTML_PREFIX}/${owner}/${token}.html` : `${SHARE_HTML_PREFIX}/${token}.html`;
}

/** The prefix holding every share HTML filed under this verified owner, or null when the uid is unusable. PURE. */
export function shareHtmlOwnerPrefix(verifiedUid: string): string | null {
  const owner = verifiedOwnerKeySegment(verifiedUid);
  return owner ? `${SHARE_HTML_PREFIX}/${owner}/` : null;
}

const SHARE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Is `htmlPath` the object THIS share (token, owner) could have written? Only such a path is ever deleted by the
 * account eraser: a record's pointer is data, and a pointer to anything else (another owner's folder, a different
 * token, another prefix) is refused rather than trusted. PURE.
 */
export function isOwnShareHtmlPath(htmlPath: string, token: string, verifiedUid: string): boolean {
  if (!SHARE_TOKEN.test(token)) return false;
  if (htmlPath === `${SHARE_HTML_PREFIX}/${token}.html`) return true;
  const owner = verifiedOwnerKeySegment(verifiedUid);
  return !!owner && htmlPath === `${SHARE_HTML_PREFIX}/${owner}/${token}.html`;
}

/** What account deletion needs from the share store. firebase-admin in production; a fake in tests. */
export interface ShareEraseDeps {
  /** Every share record this owner has (`shares` where `ownerId == uid`): its token and stored pointer. Throws when unreadable. */
  listOwnedShares(uid: string): Promise<Array<{ token: string; ownerId: string; htmlPath?: string }>>;
  /** Delete one object. A missing object is success; any other failure THROWS (never swallowed). */
  deleteObject(path: string): Promise<void>;
  /** Delete every object under a prefix. Throws on failure. */
  deletePrefix(prefix: string): Promise<void>;
}

export interface ShareHtmlEraseReport {
  attempted: boolean;
  /** Every large-share HTML of this owner that could be found was confirmed deleted. */
  htmlRemoved: boolean;
  /** Share records whose legacy (owner-less) HTML object was deleted through the record's pointer. */
  legacyObjectsDeleted: number;
  /** Whether the owner's `shares/<owner>/` folder was deleted. */
  ownerFolderDeleted: boolean;
  failures: string[];
}

/** The production dependencies, or null when Firestore or the bucket is not configured. */
export function liveShareEraseDeps(): ShareEraseDeps | null {
  const db = getDb();
  const name = shareBucketName();
  if (!db || !name) return null;
  const bucket = () => admin.storage().bucket(name);
  return {
    async listOwnedShares(uid) {
      const snap = await db.collection(SHARES_COLLECTION).where('ownerId', '==', uid).get();
      return snap.docs.map((d) => {
        const data = (d.data() ?? {}) as Partial<ShareRecord>;
        return { token: d.id, ownerId: String(data.ownerId ?? ''), ...(typeof data.htmlPath === 'string' ? { htmlPath: data.htmlPath } : {}) };
      });
    },
    async deleteObject(path) { await bucket().file(path).delete({ ignoreNotFound: true }); },
    async deletePrefix(prefix) { await bucket().deleteFiles({ prefix, force: true }); },
  };
}

/**
 * DELETE /api/profile's step for share-link HTML (Q-3611). MUST run BEFORE the `shares` records are erased: a legacy
 * offload (`shares/<token>.html`) is reachable only through its record's `htmlPath`, and the record is the pointer
 * `deleteUserData` removes. Deletes (1) the owner's `shares/<owner>/` folder — every share filed by owner, pointer or
 * not — and (2) each legacy HTML its own record points at, only when the pointer is exactly that share's own path.
 * `verifiedUid` is the deletion route's VERIFIED identity. A failure is reported as a failure, never as a removal.
 * Never throws.
 */
export async function eraseUserShareHtml(
  verifiedUid: string,
  deps: ShareEraseDeps | null = liveShareEraseDeps(),
): Promise<ShareHtmlEraseReport> {
  const report: ShareHtmlEraseReport = { attempted: false, htmlRemoved: false, legacyObjectsDeleted: 0, ownerFolderDeleted: false, failures: [] };
  const prefix = shareHtmlOwnerPrefix(verifiedUid);
  if (!prefix) return { ...report, failures: ['No usable account id: share link pages could not be selected for removal.'] };
  if (!deps) return { ...report, failures: ['Share link storage is not configured; removal of large share pages could not be confirmed.'] };
  report.attempted = true;
  try { await deps.deletePrefix(prefix); report.ownerFolderDeleted = true; } catch {
    report.failures.push('The folder of your large share link pages could not be confirmed removed.');
  }
  let shares: Array<{ token: string; ownerId: string; htmlPath?: string }>;
  try { shares = await deps.listOwnedShares(verifiedUid); } catch {
    report.failures.push('Your share links could not be listed; pages stored before they were filed by owner could not be confirmed removed.');
    return report;
  }
  let failed = 0;
  let refused = 0;
  for (const share of shares) {
    const path = share.htmlPath ?? '';
    if (!path || share.ownerId !== verifiedUid) continue;
    if (path.startsWith(prefix)) continue; // inside the owner folder deleted above
    if (!isOwnShareHtmlPath(path, share.token, verifiedUid)) { refused++; continue; }
    try { await deps.deleteObject(path); report.legacyObjectsDeleted++; } catch { failed++; }
  }
  if (failed) report.failures.push(`${failed} large share link page(s) could not be confirmed removed.`);
  if (refused) report.failures.push(`${refused} share link record(s) pointed at a page outside their own path; it was not deleted and needs review.`);
  report.htmlRemoved = report.failures.length === 0;
  return report;
}

// ─────────────────────────────── Expired shares (Q-3704) ───────────────────────────────
//
// A share stops working at `expiresAt`, but nothing ever deleted it: the record, its visitors' feedback and its
// offloaded page stayed for ever. The owner can only read a share's feedback while they hold its token (the
// ShareForReview panel keeps it in memory), so after a further SHARE_PURGE_GRACE_MS nobody can reach it at all.
// The sweep deletes, in pointer order: the page (only the share's OWN path), then the feedback, then the record —
// and a share whose page or feedback could not be confirmed deleted KEEPS its record, so the next run can retry.

/** How long after a share's expiry it is purged. */
export const SHARE_PURGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/** At most this many shares per run: the sweep is daily, and a backlog drains over several nights. */
export const SHARE_PURGE_BATCH = 200;

/** What the sweep needs. firebase-admin in production; a fake in tests. Every method THROWS on failure. */
export interface ExpiredShareDeps {
  /** Shares whose `expiresAt` is before `beforeMs`, at most `limit`. */
  listExpired(beforeMs: number, limit: number): Promise<Array<{ token: string; ownerId: string; htmlPath?: string }>>;
  /** Delete one object; a missing object is success. */
  deleteObject(path: string): Promise<void>;
  /** Delete every feedback document under the share; returns how many. */
  deleteFeedback(token: string): Promise<number>;
  deleteRecord(token: string): Promise<void>;
}

export interface ExpiredSharePurgeReport {
  scanned: number;
  /** Shares whose page, feedback and record are all gone. */
  purged: number;
  pagesDeleted: number;
  feedbackDeleted: number;
  /** Shares kept because a page or feedback delete could not be confirmed (retried next run). */
  kept: number;
  /** Shares kept because their record points at a page outside their own path (needs review, never trusted). */
  refused: number;
  /** The batch was full: more expired shares are waiting for the next run. */
  more: boolean;
  /** Set when the expired shares could not even be listed. */
  error?: string;
}

/** The production dependencies, or null when Firestore is not configured. */
export function liveExpiredShareDeps(): ExpiredShareDeps | null {
  const db = getDb();
  if (!db) return null;
  return {
    async listExpired(beforeMs, limit) {
      const snap = await db.collection(SHARES_COLLECTION).where('expiresAt', '<', beforeMs).limit(limit).get();
      return snap.docs.map((d) => {
        const data = (d.data() ?? {}) as Partial<ShareRecord>;
        return { token: d.id, ownerId: String(data.ownerId ?? ''), ...(typeof data.htmlPath === 'string' ? { htmlPath: data.htmlPath } : {}) };
      });
    },
    async deleteObject(path) {
      const name = shareBucketName();
      if (!name) throw new Error('no share bucket configured');
      await admin.storage().bucket(name).file(path).delete({ ignoreNotFound: true });
    },
    async deleteFeedback(token) {
      let n = 0;
      for (let page = 0; page < 50; page++) {
        const kids = await db.collection(SHARES_COLLECTION).doc(token).collection(FEEDBACK_SUBCOLLECTION).limit(300).get();
        if (kids.empty) return n;
        for (const k of kids.docs) { await k.ref.delete(); n++; }
        if (kids.size < 300) return n;
      }
      throw new Error('feedback not fully deleted within the page cap');
    },
    async deleteRecord(token) { await db.collection(SHARES_COLLECTION).doc(token).delete(); },
  };
}

/**
 * Purge shares that expired more than SHARE_PURGE_GRACE_MS ago, at most `limit` per run (Q-3704). Page first (only
 * the share's own path), then feedback, then the record; anything not confirmed keeps the record. Never throws.
 */
export async function purgeExpiredShares(
  deps: ExpiredShareDeps,
  nowMs = Date.now(),
  limit = SHARE_PURGE_BATCH,
): Promise<ExpiredSharePurgeReport> {
  const report: ExpiredSharePurgeReport = { scanned: 0, purged: 0, pagesDeleted: 0, feedbackDeleted: 0, kept: 0, refused: 0, more: false };
  let shares: Array<{ token: string; ownerId: string; htmlPath?: string }>;
  try { shares = await deps.listExpired(nowMs - SHARE_PURGE_GRACE_MS, limit); } catch {
    return { ...report, error: 'Expired share links could not be listed; nothing was purged.' };
  }
  report.scanned = shares.length;
  report.more = shares.length >= limit;
  for (const share of shares) {
    const path = share.htmlPath ?? '';
    if (path && !isOwnShareHtmlPath(path, share.token, share.ownerId)) { report.refused++; continue; }
    try {
      if (path) { await deps.deleteObject(path); report.pagesDeleted++; }
      report.feedbackDeleted += await deps.deleteFeedback(share.token);
      await deps.deleteRecord(share.token);
      report.purged++;
    } catch {
      report.kept++;
    }
  }
  return report;
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
    // A share that does not exist has nothing to revoke — and a merge-set would MINT a share holding only
    // `status: 'revoked'` (the DeploymentStore.setStatus class, 2026-09-18).
    if (!snap.exists) return;
    await db.collection(SHARES_COLLECTION).doc(token).update({ status: 'revoked' });
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
