// THE PLATFORM-WIDE DAILY ALLOWANCE for explorer repairs on the WEAK (free) tier (2026-09-28).
//
// The admin approved the explorer repair with one condition on the free tier: "Weak par din me ek
// limit ke saath". On Normal and Strong the user pays for the repair like any other part of the build.
// On Weak the build is paid from the gifted welcome credit, which is NavBharatAI's own money — so a
// day with thousands of free builds, each finding a broken button, must not become thousands of paid
// repair passes with nothing to stop it.
//
// 🔑 A COUNT, NOT A RUPEE FIGURE — the reason `imageFreePaidBudget.ts` gives applies here too: the
// cost of one repair is not known until it has run, and a ceiling priced on a guess is an invented
// number. A count is true. `AGENTV3_EXPLORER_REPAIR_WEAK_DAILY` — default 100 repairs a day across the
// whole platform; `0` means the free tier never gets one; an unreadable value falls back to the
// default and NEVER to unlimited; only the explicit word `off` lifts it.
//
// ⚠️ THE DEFAULT IS A STARTING POINT, NOT A MEASUREMENT. Nobody has measured what one repair costs on
// the Weak ladder yet. The `EXPLORE_REPAIRED` / `EXPLORE_REPAIR_UNDONE` lines in the admin build report
// and the server log line below are what turn it into one.
//
// 🔒 IT FAILS CLOSED. A counter that cannot be read refuses the repair: the user still gets the honest
// report of the broken button (exactly today's behaviour), whereas opening a paid pass on a counter
// nobody can read is the unbounded spend this exists to prevent.
//
// COUNTED ON ATTEMPT, not on success — the money is spent when the pass runs, whatever it concludes.
// Collection `explorer_repair_weak_daily`, one document per UTC day, dated on the SERVER clock.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export const EXPLORER_REPAIR_WEAK_DAILY_DEFAULT = 100;
export const EXPLORER_REPAIR_WEAK_COLLECTION = 'explorer_repair_weak_daily';

/** The daily cap, or `Infinity` for the explicit word `off`. PURE. */
export function explorerRepairWeakDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.AGENTV3_EXPLORER_REPAIR_WEAK_DAILY ?? '').trim().toLowerCase();
  if (!raw) return EXPLORER_REPAIR_WEAK_DAILY_DEFAULT;
  if (raw === 'off') return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[AGENTV3] AGENTV3_EXPLORER_REPAIR_WEAK_DAILY="${env.AGENTV3_EXPLORER_REPAIR_WEAK_DAILY}" is unreadable — using ${EXPLORER_REPAIR_WEAK_DAILY_DEFAULT}, never unlimited.`);
    return EXPLORER_REPAIR_WEAK_DAILY_DEFAULT;
  }
  return Math.floor(n);
}

/** `YYYY-MM-DD` in UTC. PURE. */
export function repairBudgetDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Allowed iff the count could be read and is under the cap. `null` used ⇒ refused. PURE. */
export function weakRepairAllowed(used: number | null, cap: number): boolean {
  if (cap === Number.POSITIVE_INFINITY) return true;
  if (cap <= 0 || used === null) return false;
  return used < cap;
}

let warnedForDay = '';

export class ExplorerRepairBudget {
  private db(): admin.firestore.Firestore | null {
    try { return getServerDb() as unknown as admin.firestore.Firestore; } catch { return null; }
  }

  /** Today's count, or `null` when it could not be read. */
  async usedToday(day: string): Promise<number | null> {
    const db = this.db();
    if (!db) return null;
    try {
      const snap = await db.collection(EXPLORER_REPAIR_WEAK_COLLECTION).doc(day).get();
      const n = Number((snap.exists ? (snap.data() as { count?: unknown }).count : 0) ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch (e) {
      console.error('[AGENTV3] explorer repair budget could not be read — refusing free-tier repairs for now:', e);
      return null;
    }
  }

  /** May a Weak-tier build spend a repair right now? */
  async allowed(nowMs = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    const cap = explorerRepairWeakDailyCap(env);
    if (cap === Number.POSITIVE_INFINITY) return true;
    if (cap === 0) return false;
    const day = repairBudgetDay(nowMs);
    const used = await this.usedToday(day);
    const ok = weakRepairAllowed(used, cap);
    if (!ok && used !== null && warnedForDay !== day) {
      warnedForDay = day;
      console.warn(`[AGENTV3] free-tier explorer repair allowance reached for ${day} (${used}/${cap}) — broken buttons are reported, not repaired, until tomorrow (AGENTV3_EXPLORER_REPAIR_WEAK_DAILY).`);
    }
    return ok;
  }

  /** One attempted repair. `increment`, so concurrent builds never lose a count. */
  async record(nowMs = Date.now()): Promise<void> {
    const db = this.db();
    if (!db) return;
    const day = repairBudgetDay(nowMs);
    try {
      await db.collection(EXPLORER_REPAIR_WEAK_COLLECTION).doc(day).set(
        { day, count: admin.firestore.FieldValue.increment(1), updatedAt: nowMs }, { merge: true },
      );
    } catch (e) {
      console.error('[AGENTV3] could not record a free-tier explorer repair:', e);
    }
  }
}

export const explorerRepairBudget = new ExplorerRepairBudget();
