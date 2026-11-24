import { getServerDb } from './serverDb';

export type AppMartPinKind = 'apk' | 'web';
export interface AppMartPin { kind: AppMartPinKind; id: string; pinnedAt: number }
const COLLECTION = 'nav_store_admin';
const DOCUMENT = 'app_mart_pins';
export const APP_MART_PIN_LIMIT = 6;

export async function getAppMartPins(): Promise<AppMartPin[]> {
  const db = getServerDb();
  if (!db) return [];
  const snap = await db.collection(COLLECTION).doc(DOCUMENT).get();
  if (!snap.exists) return [];
  const raw = snap.data()?.pins;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p: any) => p && (p.kind === 'apk' || p.kind === 'web') && typeof p.id === 'string')
    .slice(0, APP_MART_PIN_LIMIT) as AppMartPin[];
}

/** A single Firestore transaction makes the six-slot limit global across APKs and web apps. */
export async function setAppMartPin(kind: AppMartPinKind, id: string, pinned: boolean): Promise<AppMartPin[]> {
  const db = getServerDb();
  if (!db) throw new Error('Pin storage is unavailable.');
  const ref = db.collection(COLLECTION).doc(DOCUMENT);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (Array.isArray(snap.data()?.pins) ? snap.data()!.pins : [])
      .filter((p: any) => p && (p.kind === 'apk' || p.kind === 'web') && typeof p.id === 'string')
      .slice(0, APP_MART_PIN_LIMIT) as AppMartPin[];
    const exists = current.some((p) => p.kind === kind && p.id === id);
    if (pinned && !exists) {
      if (current.length >= APP_MART_PIN_LIMIT) throw new Error('APP_MART_PIN_LIMIT_REACHED');
      current.push({ kind, id, pinnedAt: Date.now() });
    } else if (!pinned && exists) {
      current.splice(current.findIndex((p) => p.kind === kind && p.id === id), 1);
    }
    tx.set(ref, { pins: current, updatedAt: Date.now() }, { merge: true });
    return current;
  });
}
