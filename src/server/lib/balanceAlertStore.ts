// The durable half of the balance warning — one record per user, claimed atomically.
//
// 🔴 WHY A TRANSACTION AND NOT A READ-THEN-WRITE. Cloud Run runs many instances, and two builds
// starting together would both read "0 sent", both decide to send, and both write "1 sent" — two
// notices where the admin's rule allows one. The SCALE PLAN in CLAUDE.md names this class directly
// ("per-instance memory that pretends to be global"); a transaction makes "at most N" true by
// construction instead of true most of the time.
//
// ⚠️ IT FAILS CLOSED, unlike `jobLease.ts`. A lease it cannot read runs the job anyway, because a
// purge that never runs is worse than one that runs twice. Here the asymmetry points the other way:
// a warning not sent costs one notice, while sending on an unreadable record is unbounded noise on
// every build — the exact defect this module exists to end. So an unreadable record ⇒ `null` ⇒
// `decideBalanceAlert` holds.
//
// Best-effort throughout: a store failure must never fail or slow the build it was triggered from.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import {
  decideBalanceAlert, observeHealthyBalance, balanceAlertTunables,
  type BalanceAlertKind, type BalanceAlertState, type BalanceAlertDecision,
} from './balanceAlertPolicy';

const COLLECTION = 'wallet_balance_alerts';

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

function readState(raw: unknown): BalanceAlertState {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const kind = r.lastKind === 'low' || r.lastKind === 'blocked' ? (r.lastKind as BalanceAlertKind) : undefined;
  return {
    ...(num(r.lastAlertAt) !== undefined ? { lastAlertAt: num(r.lastAlertAt) } : {}),
    ...(num(r.sentThisEpisode) !== undefined ? { sentThisEpisode: num(r.sentThisEpisode) } : {}),
    ...(num(r.healthySince) !== undefined ? { healthySince: num(r.healthySince) } : {}),
    ...(kind ? { lastKind: kind } : {}),
  };
}

/**
 * Claim the right to warn this user, atomically. Returns the decision; only a `send: true` result
 * means a notice may go out, and by the time it returns the slot is already spent — so a caller that
 * then fails to deliver loses the notice rather than re-sending it. That is the safe direction here:
 * the admin's instruction bounds how often we may SPEAK, not how often we may try.
 */
export async function claimBalanceAlert(
  uid: string | null | undefined,
  kind: BalanceAlertKind,
  now: number = Date.now(),
): Promise<BalanceAlertDecision> {
  if (!uid) return { send: false, reason: 'unknown-state' };
  const db = getDb();
  if (!db) return { send: false, reason: 'unknown-state' }; // fail closed — see the header
  const ref = db.collection(COLLECTION).doc(uid);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = snap.exists ? readState(snap.data()) : {};
      const decision = decideBalanceAlert({ kind, state, now, tunables: balanceAlertTunables() });
      if (decision.send && decision.next) tx.set(ref, decision.next, { merge: false });
      return decision;
    });
  } catch {
    return { send: false, reason: 'unknown-state' };
  }
}

/**
 * Record that this user's balance looks healthy. Starts the cooling clock that ends an episode; it
 * never clears the record outright, which is the bug `monitorAlerts.ts` records (resolving deleted
 * the state, so the cooldown was bypassed by the very thing it existed to survive).
 *
 * Writes only when something actually changes, so the ordinary healthy build costs no write at all.
 */
export async function noteHealthyBalance(uid: string | null | undefined, now: number = Date.now()): Promise<void> {
  if (!uid) return;
  const db = getDb();
  if (!db) return;
  const ref = db.collection(COLLECTION).doc(uid);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;                       // nothing was ever said — nothing to cool
      const state = readState(snap.data());
      const next = observeHealthyBalance(state, now);
      if (!next || next === state) return;            // already cooling, or nothing to clear
      tx.set(ref, next, { merge: false });
    });
  } catch { /* best-effort — a build must never fail over a notification record */ }
}
