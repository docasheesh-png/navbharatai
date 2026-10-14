/**
 * Go-live PR 15 wiring — stores a "Bill of Supply" for every charged purchase when METERING_V1 is on.
 *
 * Idempotent: the receipt id is derived from the purchase reference, so a retried hook never issues
 * a second receipt or burns a second number. Numbers come from one counter doc in the SAME
 * transaction, so they are gap-free and unique. Never throws to the caller: a receipt failure must
 * not undo or fail a purchase that already succeeded (it is logged and can be re-issued).
 * Collections: `bill_of_supply` (receipts) and `bill_of_supply_counters/global`.
 */
import { buildBillOfSupply, meteringEnabled, type BillLine, type BillOfSupply } from './billOfSupply';
import { listEqNewestFirst } from './firestoreIndexSafe';

export const RECEIPTS = 'bill_of_supply';
const COUNTER = 'bill_of_supply_counters';

export function receiptIdFor(ownerId: string, sourceRef: string): string {
  return `${ownerId}__${sourceRef}`.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 300);
}

export interface StoredReceipt extends BillOfSupply { id: string; ownerId: string; sourceRef: string }

export async function issueBillOfSupply(
  db: any,
  input: { ownerId: string; sourceRef: string; customer: BillOfSupply['customer']; lines: BillLine[]; now?: Date },
): Promise<StoredReceipt | null> {
  if (!db || !meteringEnabled()) return null;
  const id = receiptIdFor(input.ownerId, input.sourceRef);
  try {
    return await db.runTransaction(async (t: any) => {
      const ref = db.collection(RECEIPTS).doc(id);
      const existing = await t.get(ref);
      if (existing.exists) return existing.data() as StoredReceipt;
      const cref = db.collection(COUNTER).doc('global');
      const c = await t.get(cref);
      const seq = (c.exists && Number.isInteger(c.data()?.seq) ? c.data().seq : 0) + 1;
      const bill = buildBillOfSupply({ seq, issuedAt: input.now ?? new Date(), customer: input.customer, lines: input.lines });
      const stored: StoredReceipt = { ...bill, id, ownerId: input.ownerId, sourceRef: input.sourceRef };
      t.set(cref, { seq }, { merge: true });
      t.set(ref, stored);
      return stored;
    });
  } catch (e) {
    console.warn('[receipts] could not issue Bill of Supply', input.sourceRef, String((e as Error)?.message ?? e));
    return null;
  }
}

export async function listReceipts(db: any, ownerId: string, limit = 50): Promise<StoredReceipt[]> {
  if (!db) return [];
  try {
    return await listEqNewestFirst<StoredReceipt>(db.collection(RECEIPTS), [['ownerId', ownerId]], 'issuedAt', Math.max(1, Math.min(200, limit)));
  } catch {
    return [];
  }
}
