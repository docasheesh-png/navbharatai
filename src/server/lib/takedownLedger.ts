// WHAT WAS REMOVED, WHY, AND WHO PUBLISHED IT — kept for 180 days, as the law requires.
//
// ADMIN 2026-09-12: "Hataye gaye content ka record 180 din rakho — kanoon yahi maangta hai jaanch ke
// liye." Phase 4 of the agreed safety plan.
//
// ── WHY A LEDGER AND NOT "THE STATUS FIELD ALREADY SAYS REMOVED" ─────────────────────────────────
// Each surface already flags its own record (`status: 'removed'` + a reason on the app document,
// `taken_down` on a deployment). Three things make that insufficient for the purpose:
//
//   1. It is SCATTERED. An investigator's question is "what has this platform removed, and why?" —
//      not "please check three collections with three different field names".
//   2. It is DELETABLE. A takedown flag lives on the app's own document, which an account deletion
//      erases along with everything else. The one record that must outlive the account was stored on
//      the very thing that goes away with it.
//   3. It has no CLOCK. The Rules want 180 days — which means both that it must survive that long
//      and that it should not be kept forever. A flag on a document does neither deliberately.
//
// ── 🔒 A RECORD OF REMOVAL, NOT A COPY OF THE CONTENT ────────────────────────────────────────────
// This stores what was removed, from where, why, by whom, and a HASH of the content — never the
// content itself. Keeping a copy of an unlawful app in order to prove we removed an unlawful app is
// not compliance, it is the same file in a different folder. The hash is enough to answer "was this
// the same thing?" if the same app is published again, which is the question that actually gets
// asked.
//
// ── 🔒 IT SURVIVES ACCOUNT DELETION, AND THAT IS A DELIBERATE, DISCLOSED EXCEPTION ───────────────
// `takedown_records` is deliberately NOT in USER_SCOPED_COLLECTIONS. Deleting an account must not
// erase the record of why that account's app was taken down — that is precisely the case the
// retention duty exists for, and the same shape as the payment/tax records that already survive.
// It is disclosed in the Privacy Policy (§6) and on the Grievance page, because an exception nobody
// is told about is not an exception, it is a surprise.
//
// The 180-day clock is enforced by RETENTION_POLICIES, so the record is purged ON TIME — the other
// half of the duty, and the half that gets forgotten.

import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { getServerDb } from './serverDb';

export const TAKEDOWN_COLLECTION = 'takedown_records';

/** How long a removal record is kept. IT Rules, 2021 Rule 3(1)(g). */
export const TAKEDOWN_RETENTION_DAYS = 180;

/** Which surface the content was removed from. */
export type TakedownSurface = 'app_mart_web' | 'app_mart_apk' | 'navbharat_hosting';

/** Who decided. An owner unpublishing their own app is NOT a takedown and is recorded as such. */
export type TakedownActor = 'admin' | 'owner' | 'automated';

export interface TakedownRecord {
  /** `<surface>_<contentId>_<removedAt>` — unique per removal, so a re-removal is its own row. */
  id: string;
  surface: TakedownSurface;
  /** The app id or workspace id, whichever identifies the thing on its surface. */
  contentId: string;
  /** What it was called, so a record is readable a year later without joining anything. */
  name: string;
  /** The publisher. Kept because the duty is explicitly to retain who published it. */
  ownerUid: string;
  /** Their address at the time of removal. '' when unknown — never guessed. */
  ownerEmail: string;
  reason: string;
  actor: TakedownActor;
  /** The admin's identity when `actor` is 'admin'. '' otherwise. */
  removedBy: string;
  removedAt: number;
  /**
   * SHA-256 of the removed content, or '' when there was nothing to hash.
   *
   * Not the content — see the header. It answers "is this the same thing again?" without keeping
   * the thing itself, which is the only question a stored copy would have answered anyway.
   */
  contentHash: string;
  /** What the safety scan had said about it, if anything. Short strings, never the matched text. */
  findings: string[];
}

/** Hash a file map. PURE and order-independent, so the same app always hashes the same. */
export function hashContent(files: Record<string, string> | null | undefined): string {
  if (!files) return '';
  const paths = Object.keys(files).filter((p) => typeof files[p] === 'string').sort();
  if (paths.length === 0) return '';
  const h = createHash('sha256');
  for (const p of paths) {
    h.update(p);
    h.update('\0');
    h.update(files[p]);
    h.update('\0');
  }
  return h.digest('hex');
}

/** Build the record. PURE — every field normalised and bounded, so one bad input cannot poison a row. */
export function buildTakedownRecord(input: {
  surface: TakedownSurface;
  contentId: string;
  name?: string;
  ownerUid?: string;
  ownerEmail?: string;
  reason?: string;
  actor: TakedownActor;
  removedBy?: string;
  removedAt: number;
  contentHash?: string;
  findings?: string[];
}): TakedownRecord {
  const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const contentId = s(input.contentId, 200);
  const removedAt = Number.isFinite(input.removedAt) && input.removedAt > 0 ? input.removedAt : Date.now();
  return {
    id: `${input.surface}_${contentId || 'unknown'}_${removedAt}`,
    surface: input.surface,
    contentId,
    name: s(input.name, 120),
    ownerUid: s(input.ownerUid, 200),
    ownerEmail: s(input.ownerEmail, 200),
    // A removal with no stated reason is a removal nobody can defend later, so there is a default
    // that says exactly that rather than an empty string that reads like data we lost.
    reason: s(input.reason, 500) || 'No reason recorded',
    actor: input.actor,
    removedBy: s(input.removedBy, 200),
    removedAt,
    contentHash: s(input.contentHash, 64),
    findings: (input.findings ?? []).slice(0, 10).map((f) => s(f, 120)).filter(Boolean),
  };
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

/**
 * Write the record. NEVER THROWS.
 *
 * A failed ledger write must not stop a takedown: leaving unlawful content up because we could not
 * file the paperwork would be the worst possible trade. It is logged loudly instead, because a
 * silently missing record is the one thing that makes this whole file pointless.
 */
export async function recordTakedown(input: Parameters<typeof buildTakedownRecord>[0]): Promise<boolean> {
  const record = buildTakedownRecord(input);
  const d = db();
  if (!d) return false;
  try {
    await d.collection(TAKEDOWN_COLLECTION).doc(record.id).set(record);
    return true;
  } catch (e) {
    console.error('[TAKEDOWN_LEDGER] could not record a removal — the content was still removed:', record.id, e);
    return false;
  }
}

/** The most recent removals, newest first. Admin-only at every call site. */
export async function listTakedowns(limit = 200): Promise<TakedownRecord[]> {
  const d = db();
  if (!d) return [];
  const cap = Math.max(1, Math.min(500, limit));
  try {
    const snap = await d.collection(TAKEDOWN_COLLECTION).orderBy('removedAt', 'desc').limit(cap).get();
    return snap.docs.map((doc) => doc.data() as TakedownRecord);
  } catch {
    return [];
  }
}
