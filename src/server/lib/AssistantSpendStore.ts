// Durable home for the assistant-spend rollup — one document per calendar day.
//
// The decision lives in assistantSpendRollup.ts (pure, tested); this is only its storage, and it
// mirrors AgentV3CostTelemetry exactly: VITEST-skipped, best-effort, never throws, one doc per day
// keyed 'YYYY-MM-DD'. A telemetry write must never be able to cost a user their answer, so every path
// here swallows its own failure — losing a day of counters is a reporting gap, not a broken assistant.
//
// The day is stamped from the SERVER clock. A device clock cannot move a cost bucket.
//
// Collection: `assistant_spend`
// Doc ID:     `YYYY-MM-DD`

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import {
  foldAssistantTurn, assistantSpendVerdict, freeShare,
  type AssistantTurn, type AssistantSpendDay, type AssistantSpendVerdict,
} from './assistantSpendRollup';

const COLLECTION = 'assistant_spend';

export interface AssistantSpendSummary {
  days: AssistantSpendDay[];
  /** Verdict for the most recent day that has data. */
  today: AssistantSpendVerdict;
}

class AssistantSpendStore {
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

  /** Server-clock day key. */
  private dayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Fold one answered assistant turn into today's document.
   *
   * A transaction because several turns land concurrently and a read-modify-write without one would
   * silently drop counts — which would understate exactly the free/paid split this exists to watch.
   */
  async record(turn: AssistantTurn): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    const date = this.dayKey();
    try {
      const ref = db.collection(COLLECTION).doc(date);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as AssistantSpendDay) : null;
        tx.set(ref, foldAssistantTurn(existing, date, turn), { merge: false });
      });
    } catch { /* best-effort — telemetry must never cost a user their answer */ }
  }

  /** Last N days, newest first, with an honest verdict on the newest. */
  async summary(days = 14): Promise<AssistantSpendSummary> {
    const db = this.getDb();
    const n = Math.max(1, Math.min(365, Math.floor(days)));
    if (!db) return { days: [], today: assistantSpendVerdict(null) };
    try {
      const snap = await db.collection(COLLECTION).orderBy('date', 'desc').limit(n).get();
      const rows = snap.docs.map((d) => d.data() as AssistantSpendDay);
      return { days: rows, today: assistantSpendVerdict(rows[0] ?? null) };
    } catch {
      // A read failure is NOT "everything is fine" — return the unknown verdict rather than a
      // reassuring empty-but-healthy one.
      return { days: [], today: assistantSpendVerdict(null) };
    }
  }
}

export const assistantSpendStore = new AssistantSpendStore();
export { freeShare };
