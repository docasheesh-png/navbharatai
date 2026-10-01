// Which account a PUBLIC creator code belongs to — the address book behind App Mart profiles.
//
// A profile is opened by its public creator code (`publicCreatorId` in storeCreator.ts: a short digest
// of the account id that cannot be turned back into it). That one-way property is the whole point of
// the code, so the server cannot COMPUTE the account from it; it has to have been told. This module is
// where it is told: whenever the platform shows a person (an app's creator on a card, a commenter, a
// liker), it records code → account here, once per process per account.
//
// 🔒 The document holds the account id and nothing else, and it is read ONLY by the server to open a
// profile. It is never returned to a client — the code on the screen stays the only identifier a
// visitor ever holds. It is erased with the account (USER_SCOPED_COLLECTIONS, key field `uid`).

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export const APP_MART_CREATOR_IDS_COLLECTION = 'app_mart_creator_ids';

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Accounts already recorded by THIS process — so a Browse page of 60 cards writes nothing twice. */
const written = new Set<string>();
const MAX_REMEMBERED = 20_000;

/** Record code → account. Best-effort and fire-and-forget: a missed write only delays one profile. */
export function rememberCreatorId(creatorId: string, uid: string): void {
  if (!creatorId || !uid || written.has(uid)) return;
  const db = getDb();
  if (!db) return;
  if (written.size > MAX_REMEMBERED) written.clear();
  written.add(uid);
  db.collection(APP_MART_CREATOR_IDS_COLLECTION).doc(creatorId)
    .set({ uid, at: Date.now() }, { merge: true })
    .catch(() => { written.delete(uid); });
}

/** The account behind a public code, or null when none is recorded (or the account was deleted). */
export async function uidForCreatorId(creatorId: string): Promise<string | null> {
  const db = getDb();
  if (!db || !creatorId) return null;
  try {
    const snap = await db.collection(APP_MART_CREATOR_IDS_COLLECTION).doc(creatorId).get();
    const uid = snap.exists ? (snap.data()?.uid as unknown) : null;
    return typeof uid === 'string' && uid ? uid : null;
  } catch {
    return null;
  }
}

/** Test seam. */
export function _resetCreatorIndexForTests(): void {
  written.clear();
}
