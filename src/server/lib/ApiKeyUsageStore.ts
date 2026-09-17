// WHAT ONE API KEY HAS SPENT TODAY — the counter its daily cap is enforced against.
//
// A key is a secret the holder may paste somewhere it should not go, so its per-day ₹ ceiling is the
// real defence (developerApi.ts says why). This is the number that ceiling is compared against: one
// running total per key per UTC day.
//
// Patterned on `AppAiUsageStore` deliberately — same document-per-day shape, same `increment`, same
// "unreadable is not zero" flag — so it adds no new idea to the codebase.
//
// Collection: `api_key_usage`  ·  Doc ID: `<keyId>_<day>`  ·  Fields: keyId, day, spentInr, calls, updatedAt

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const COLLECTION = 'api_key_usage';

export interface KeySpentToday {
  spentInr: number;
  calls: number;
  /**
   * False when the counter could not be read. 🔒 UNREADABLE IS NOT ZERO: the route allows in both
   * cases (matching every other money gate) but logs the difference, because a cap that quietly
   * stopped being enforced is the one failure here that could cost the holder real money.
   */
  known: boolean;
}

class ApiKeyUsageStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private docId(keyId: string, day: string): string { return `${keyId}_${day}`; }

  async spentToday(keyId: string, day: string): Promise<KeySpentToday> {
    const db = this.getDb();
    if (!db || !keyId) return { spentInr: 0, calls: 0, known: false };
    try {
      const snap = await db.collection(COLLECTION).doc(this.docId(keyId, day)).get();
      const d = (snap.exists ? snap.data() : null) as { spentInr?: unknown; calls?: unknown } | null;
      return { spentInr: numberOf(d?.spentInr), calls: numberOf(d?.calls), known: true };
    } catch {
      return { spentInr: 0, calls: 0, known: false };
    }
  }

  /** Today's totals for several keys at once — for the holder's key list. Unreadable rows are omitted. */
  async spentTodayForKeys(keyIds: readonly string[], day: string): Promise<Map<string, KeySpentToday>> {
    const out = new Map<string, KeySpentToday>();
    const db = this.getDb();
    if (!db || keyIds.length === 0) return out;
    try {
      const refs = keyIds.map((id) => db.collection(COLLECTION).doc(this.docId(id, day)));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, i) => {
        const d = (snap.exists ? snap.data() : null) as { spentInr?: unknown; calls?: unknown } | null;
        out.set(keyIds[i], { spentInr: numberOf(d?.spentInr), calls: numberOf(d?.calls), known: true });
      });
    } catch { /* an unreadable list shows no usage rather than a confident zero */ }
    return out;
  }

  /**
   * Add one answered call. `increment`, not read-modify-write — concurrent calls on one key are normal.
   * A ₹0 call (free model, or unmeasured and therefore unpriced) still counts as a CALL.
   */
  async record(keyId: string, day: string, billedInr: number): Promise<void> {
    const db = this.getDb();
    if (!db || !keyId) return;
    const inr = Number.isFinite(billedInr) && billedInr > 0 ? billedInr : 0;
    const inc = admin.firestore.FieldValue.increment;
    try {
      await db.collection(COLLECTION).doc(this.docId(keyId, day)).set(
        { keyId, day, spentInr: inc(inr), calls: inc(1), updatedAt: Date.now() }, { merge: true },
      );
    } catch (e) {
      console.error(`[DEVAPI] could not record key spend for ${keyId}:`, e);
    }
  }
}

function numberOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const apiKeyUsageStore = new ApiKeyUsageStore();
