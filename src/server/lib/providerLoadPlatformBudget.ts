import type { Firestore } from 'firebase-admin/firestore';
import { FreeChainStore } from '../AI/FreeChain/store';
import { freeChainConfig } from '../AI/FreeChain/config';
import { monthKey } from '../AI/FreeChain/masterPlan';
import { LoadBatchError, type LoadItem, type LoadBatch } from './providerLoadBatch';
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function monthAmounts(data: FirebaseFirestore.DocumentData | undefined) {
  if (data === undefined) return { heldNanoUsd: 0, spentNanoUsd: 0 };
  if (!integer(data.heldNanoUsd) || !integer(data.spentNanoUsd)) throw new LoadBatchError('corrupt');
  return { heldNanoUsd: data.heldNanoUsd, spentNanoUsd: data.spentNanoUsd };
}
/** Uses the existing shared month document, with a batch request tombstone for exact
 * settlement. Corrupt or uncertain history is never replaced with zero. */
async function reserveMonth(db: Firestore, item: LoadItem, cap: number) {
  const month = monthKey(), ref = db.doc(`free_chat_chain/state/paid_month/${month}`);
  const receipt = db.doc(`${ref.path}/load_reservations/${item.requestId}`);
  await db.runTransaction(async tx => {
    const prior = await tx.get(receipt), snapshot = await tx.get(ref);
    if (prior.exists) throw new LoadBatchError('conflict');
    const amounts = monthAmounts(snapshot.data());
    const total = BigInt(amounts.heldNanoUsd) + BigInt(amounts.spentNanoUsd) + BigInt(item.reservedNanoUsd);
    if (total > BigInt(cap)) throw new LoadBatchError('unavailable');
    tx.set(ref, { ...amounts, heldNanoUsd: amounts.heldNanoUsd + item.reservedNanoUsd, updatedAt: Date.now() }, { merge: true });
    tx.create(receipt, { state: 'held', amount: item.reservedNanoUsd, actual: null });
  });
  return async (actual: number) => db.runTransaction(async tx => {
    const existing = (await tx.get(receipt)).data(), snapshot = await tx.get(ref);
    if (!existing || !snapshot.exists || existing.amount !== item.reservedNanoUsd) throw new LoadBatchError('corrupt');
    if (existing.state === 'settled') { if (existing.actual !== actual) throw new LoadBatchError('conflict'); return; }
    const amounts = monthAmounts(snapshot.data()), spent = amounts.spentNanoUsd + actual;
    if (existing.state !== 'held' || amounts.heldNanoUsd < item.reservedNanoUsd || !integer(spent)) throw new LoadBatchError('corrupt');
    tx.set(ref, { heldNanoUsd: amounts.heldNanoUsd - item.reservedNanoUsd, spentNanoUsd: spent, updatedAt: Date.now() }, { merge: true });
    tx.set(receipt, { ...existing, state: 'settled', actual });
  });
}
/** Existing shared daily/monthly authorities stay effective; no production hold is reset. */
export function loadPlatformAdmission(db: Firestore) {
  return async (item: LoadItem, batch: LoadBatch): Promise<(actual: number | null) => Promise<void>> => {
    const cfg = freeChainConfig(), store = new FreeChainStore(db);
    const settleMonth = cfg.features.monthlyCap ? await reserveMonth(db, item, cfg.features.monthlyCapNanoUsd) : null;
    const reservation = await store.reservePaid({ requestId: item.requestId, uid: `admin-load:${batch.scopeId}`, maxCostNanoUsd: item.reservedNanoUsd,
      capNanoUsd: cfg.paidCapNanoUsd, perUserLimit: batch.authority.totalAttempts });
    // A failed acknowledgement is not evidence a hold was absent. Never refund it blindly.
    if (!reservation?.mayDispatch) throw new LoadBatchError('unavailable');
    return async actual => {
      if (actual === null) return;
      if (!integer(actual) || !await store.settlePaid(reservation, actual)) throw new LoadBatchError('unavailable');
      if (settleMonth) await settleMonth(actual);
    };
  };
}
