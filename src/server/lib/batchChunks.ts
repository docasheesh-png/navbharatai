// FIRESTORE TAKES AT MOST 500 WRITES PER BATCH — every unbounded delete goes through here (audit 2026-10-11).
//
// Two deletes put an unbounded list into ONE batch: removing a conversation (every turn page and timeline page
// of a long chat) and the metrics-timeline retention sweep (up to 1,600 documents at the default shard count).
// Firestore refuses the whole batch past 500, so a long chat could not be deleted at all, and the retention
// sweep threw, was swallowed as "housekeeping", and never deleted anything again once 500 buckets were stale.

import type * as admin from 'firebase-admin';

/** Comfortably under Firestore's 500-write limit, leaving room for a final write a caller adds. */
export const SAFE_BATCH_WRITES = 400;

/**
 * Delete `refs` in batches of at most `size`, in order, then (optionally) `last` in its own final batch — so a
 * parent document goes only after everything under it did, and a failure part-way leaves it to retry.
 * Returns how many documents were deleted.
 */
export async function deleteInChunks(
  db: Pick<admin.firestore.Firestore, 'batch'>,
  refs: ReadonlyArray<admin.firestore.DocumentReference>,
  last?: admin.firestore.DocumentReference,
  size: number = SAFE_BATCH_WRITES,
): Promise<number> {
  const step = Math.max(1, Math.min(size, SAFE_BATCH_WRITES));
  let deleted = 0;
  for (let i = 0; i < refs.length; i += step) {
    const batch = db.batch();
    const chunk = refs.slice(i, i + step);
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deleted += chunk.length;
  }
  if (last) {
    const batch = db.batch();
    batch.delete(last);
    await batch.commit();
    deleted += 1;
  }
  return deleted;
}
