// DURABLE DEDUPE RECORDS FOR MONEY MOVES (DB-14, DB-17 — go-live audit 2026-10-13).
//
// Before this, "has this charge already happened?" was answered only by scanning the wallet's embedded
// `walletLedger`, which keeps the newest 500 rows. A late retry of an older charge was invisible to that
// scan and charged again (DB-17). A hosting-plan purchase keyed itself on the period start, which the
// first purchase moves, so a second tap seconds later looked new and charged twice (DB-14).
//
// A `wallet_ops/{id}` doc is written in the SAME transaction as the charge. It is never deleted by code
// and is server-only (firestore.rules default-deny). The ledger scan stays as a second guard, so this is
// strictly additive: an op written before this change simply has no doc and behaves as before.

import { createHash } from 'crypto';

export const WALLET_OPS = 'wallet_ops';

export type WalletOpKind = 'build' | 'plan';

/** Stable, path-safe doc id for one money move on one wallet. Pure. */
export function walletOpId(ownerId: string, kind: WalletOpKind, ref: string): string {
  const h = createHash('sha256').update(`${ownerId}\u0000${kind}\u0000${ref}`).digest('hex').slice(0, 40);
  return `${kind}_${h}`;
}

/** A client-sent purchase request id: 8–80 chars of [A-Za-z0-9_-]. Anything else is ignored (old clients). */
export function validRequestId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v);
}
