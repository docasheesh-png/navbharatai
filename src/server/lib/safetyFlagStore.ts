// THE ONLY MESSAGES THAT LEAVE A TRACE.
//
// A clean message writes NOTHING here — no document, no read, not a byte. This collection exists
// solely for the messages the automatic check itself objected to, which is what makes "we do not
// read your chats" true rather than aspirational: there is nothing to read.
//
// 🔒 180 DAYS, and the same two-sided duty as the takedown ledger: it outlives an account deletion
// (an abuse record that a bad actor can erase by pressing "delete my account" is not a record) and
// it is PURGED on schedule rather than kept for ever. Both halves are enforced — the exclusion in
// DataRetentionManager's registry, the clock in RETENTION_POLICIES — and both are disclosed in the
// Privacy Policy.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import type { SafetyVerdict, SafetySurface, PromptTriage } from './promptSafety';

export const SAFETY_FLAG_COLLECTION = 'safety_flags';

/** Matches the takedown ledger, deliberately: one retention story for the whole safety surface. */
export const SAFETY_FLAG_RETENTION_DAYS = 180;

export interface SafetyFlagRecord {
  id: string;
  uid: string;
  verdict: Exclude<SafetyVerdict, 'allow'>;   // an allowed message is never written
  ruleId: string;
  contentClass: string;
  description: string;
  surface: SafetySurface;
  /** Redacted and hard-bounded — see safetyExcerpt. '' when redaction could not run. */
  excerpt: string;
  at: number;
}

/** Build the record. PURE, bounded, and it refuses to represent an ALLOW. */
export function buildSafetyFlag(input: {
  uid: string;
  triage: PromptTriage;
  surface: SafetySurface;
  excerpt: string;
  at: number;
}): SafetyFlagRecord | null {
  // The type already says it, but this is the invariant the whole design rests on: an allowed
  // message must be unrepresentable here, not merely un-written by a caller who remembered.
  if (input.triage.verdict === 'allow') return null;
  const at = Number.isFinite(input.at) && input.at > 0 ? input.at : Date.now();
  const uid = String(input.uid || 'anon').slice(0, 200);
  return {
    id: `${uid}_${at}_${input.triage.ruleId || 'unknown'}`,
    uid,
    verdict: input.triage.verdict,
    ruleId: String(input.triage.ruleId || '').slice(0, 80),
    contentClass: String(input.triage.contentClass || 'general').slice(0, 20),
    description: String(input.triage.description || '').slice(0, 300),
    surface: input.surface,
    excerpt: String(input.excerpt || '').slice(0, 300),
    at,
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
 * Record a flagged or blocked message. NEVER THROWS, never awaited into a user's answer.
 *
 * A failed write must not cost a legitimate user their reply, and must not turn a BLOCK into an
 * allow — the block has already been decided by the time this runs. Logged loudly, because a
 * silently missing flag is the failure that makes this collection pointless.
 */
export async function recordSafetyFlag(record: SafetyFlagRecord | null): Promise<boolean> {
  if (!record) return false;
  const d = db();
  if (!d) return false;
  try {
    await d.collection(SAFETY_FLAG_COLLECTION).doc(record.id).set(record);
    return true;
  } catch (e) {
    console.error('[SAFETY_FLAG] could not record a flagged message — the decision still stands:', record.id, e);
    return false;
  }
}

/** The admin queue, newest first. Admin-gated at every call site. */
export async function listSafetyFlags(limit = 200): Promise<SafetyFlagRecord[]> {
  const d = db();
  if (!d) return [];
  const cap = Math.max(1, Math.min(500, limit));
  try {
    const snap = await d.collection(SAFETY_FLAG_COLLECTION).orderBy('at', 'desc').limit(cap).get();
    return snap.docs.map((doc) => doc.data() as SafetyFlagRecord);
  } catch {
    return [];
  }
}

/** How many times this one account has been flagged — the signal that turns a one-off into a pattern. */
export async function countFlagsFor(uid: string, limit = 100): Promise<number> {
  const d = db();
  if (!d || !uid) return 0;
  try {
    const snap = await d.collection(SAFETY_FLAG_COLLECTION).where('uid', '==', uid).limit(limit).get();
    return snap.size;
  } catch {
    return 0;
  }
}
