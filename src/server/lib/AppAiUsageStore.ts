// WHAT AN APP'S ASSISTANT HAS SPENT TODAY — the counters the gateway's caps are enforced against.
//
// The gateway endpoint is called by STRANGERS on somebody else's website, so the cap is the only real
// defence the design has (appAiGateway.ts says so at length). These are the numbers it compares
// against: one running total per app per day, and one per visitor per app per day.
//
// Two documents rather than one map, on purpose. A single app-day document holding a `{visitor: ₹}`
// map would grow with the app's audience and eventually hit Firestore's 1 MB document ceiling — on
// the most popular apps, which is exactly where a silent write failure would be worst. A document per
// visitor-day costs one extra read and one extra write per call and cannot grow.
//
// Collections: `app_ai_usage` (`<appId>_<day>`) · `app_ai_visitors` (`<appId>_<day>_<hash>`)
//
// 📏 WRITE RATE, stated so nobody has to re-derive it: the app-day document takes one increment per
// gateway call, and the per-app daily ₹ cap bounds how many calls a day can contain — at the ₹20
// default and a realistic per-answer cost that is hundreds of calls, i.e. far below Firestore's
// ~1 write/second/document limit. If the cap is ever raised by two orders of magnitude, this becomes
// the §SCALE-PLAN item 1 shape (shard the document) — not before.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const APP_COLLECTION = 'app_ai_usage';
const VISITOR_COLLECTION = 'app_ai_visitors';

export interface AppAiSpentToday {
  appSpentInr: number;
  visitorSpentInr: number;
  /**
   * False when the counters could not be read.
   *
   * 🔒 UNREADABLE IS NOT ZERO, and the two are kept apart even though the caller currently ALLOWS in
   * both cases. Allowing matches every other money gate on the platform (the build gate, the chat
   * gate, `gatewayDecision`'s unreadable balance): refusing on a database hiccup would take every
   * published app's assistant down at once, while allowing risks one call's cost against a cap that
   * is deliberately small. Carrying the flag is what lets the route log the difference instead of
   * reporting a confident ₹0.
   */
  known: boolean;
}

class AppAiUsageStore {
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

  private appDoc(appId: string, day: string): string { return `${appId}_${day}`; }
  private visitorDoc(appId: string, day: string, hash: string): string { return `${appId}_${day}_${hash}`; }

  /** Both running totals, in one round trip. */
  async spentToday(appId: string, visitorHash: string, day: string): Promise<AppAiSpentToday> {
    const db = this.getDb();
    if (!db || !appId) return { appSpentInr: 0, visitorSpentInr: 0, known: false };
    try {
      const [app, visitor] = await Promise.all([
        db.collection(APP_COLLECTION).doc(this.appDoc(appId, day)).get(),
        visitorHash
          ? db.collection(VISITOR_COLLECTION).doc(this.visitorDoc(appId, day, visitorHash)).get()
          : Promise.resolve(null),
      ]);
      return {
        appSpentInr: numberOf(app.exists ? (app.data() as { spentInr?: unknown }).spentInr : 0),
        visitorSpentInr: numberOf(visitor?.exists ? (visitor.data() as { spentInr?: unknown }).spentInr : 0),
        known: true,
      };
    } catch {
      return { appSpentInr: 0, visitorSpentInr: 0, known: false };
    }
  }

  /**
   * Add one answered call's ₹ to both totals.
   *
   * `increment` rather than read-modify-write: concurrent visitors are the normal case here, and a
   * transaction per call would serialise an endpoint whose whole point is that it is cheap. A call
   * that cost ₹0 (a free model, or an unmeasured answer we refuse to price) still increments the
   * CALL count, because "the assistant answered" is true either way and the count is what a rate
   * question is asked of later.
   */
  async record(appId: string, visitorHash: string, day: string, billedInr: number): Promise<void> {
    const db = this.getDb();
    if (!db || !appId) return;
    const inr = Number.isFinite(billedInr) && billedInr > 0 ? billedInr : 0;
    const now = Date.now();
    const inc = admin.firestore.FieldValue.increment;
    try {
      const writes: Array<Promise<unknown>> = [
        db.collection(APP_COLLECTION).doc(this.appDoc(appId, day)).set(
          { appId, day, spentInr: inc(inr), calls: inc(1), updatedAt: now }, { merge: true },
        ),
      ];
      if (visitorHash) {
        writes.push(db.collection(VISITOR_COLLECTION).doc(this.visitorDoc(appId, day, visitorHash)).set(
          { appId, day, spentInr: inc(inr), calls: inc(1), updatedAt: now }, { merge: true },
        ));
      }
      await Promise.all(writes);
    } catch (e) {
      // Loudly, not silently: a counter that stopped moving means the cap has stopped biting, which
      // is the one failure here that could cost the owner real money.
      console.error(`[APPAI] could not record gateway spend for ${appId}:`, e);
    }
  }

  /** The app's own total for a day — for the owner's screen. */
  async appSpentOn(appId: string, day: string): Promise<{ spentInr: number; calls: number; known: boolean }> {
    const db = this.getDb();
    if (!db || !appId) return { spentInr: 0, calls: 0, known: false };
    try {
      const snap = await db.collection(APP_COLLECTION).doc(this.appDoc(appId, day)).get();
      const d = (snap.exists ? snap.data() : null) as { spentInr?: unknown; calls?: unknown } | null;
      return { spentInr: numberOf(d?.spentInr), calls: numberOf(d?.calls), known: true };
    } catch {
      return { spentInr: 0, calls: 0, known: false };
    }
  }
}

function numberOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const appAiUsageStore = new AppAiUsageStore();
