/**
 * Professional Pass store (admin 2026-07-15) — one active-until timestamp per user.
 *
 * A user with a non-expired pass gets UNLIMITED access to every professional. Buying/renewing extends
 * the pass (from its current expiry if still active — a fair renewal — else from now). Best-effort +
 * VITEST-skip, mirroring UserProfileStore. On any Firestore failure the read fail-CLOSES to "no pass"
 * (the user then falls to the free quota, never wrongly granted unlimited) while the fulfilment write
 * is retried by the payment path — a money-safe default.
 *
 * Collection: `professional_passes` (doc id = userId)
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

export interface PassStatus {
  active: boolean;
  /** ISO expiry, or null when the user has never held a pass. */
  expiresAt: string | null;
  plan: string | null;
}

interface PassDoc {
  userId: string;
  expiresAt: string;
  plan: string;
  updatedAt: string;
  createdAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PURE: the new expiry after granting `days`. Renewal STACKS on remaining time — if the current pass is
 * still in the future we extend from THERE (the user never loses paid days); otherwise from `now`.
 */
export function computeNewExpiry(currentExpiryIso: string | null | undefined, now: number, days: number): string {
  const cur = currentExpiryIso ? Date.parse(currentExpiryIso) : NaN;
  const base = Number.isFinite(cur) && cur > now ? cur : now;
  const d = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  return new Date(base + d * DAY_MS).toISOString();
}

/** PURE: is this expiry still in the future at `now`? */
export function isPassActive(expiresAt: string | null | undefined, now: number): boolean {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(t) && t > now;
}

class ProfessionalPassStore {
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

  /** The user's pass status. On no-db/error → inactive (fail-closed: never wrongly grant unlimited). */
  async getStatus(userId: string, now: number = Date.now()): Promise<PassStatus> {
    const db = this.getDb();
    if (!db || !userId) return { active: false, expiresAt: null, plan: null };
    try {
      const snap = await db.collection('professional_passes').doc(userId).get();
      if (!snap.exists) return { active: false, expiresAt: null, plan: null };
      const data = snap.data() as PassDoc | undefined;
      const expiresAt = data?.expiresAt ?? null;
      return { active: isPassActive(expiresAt, now), expiresAt, plan: data?.plan ?? null };
    } catch {
      return { active: false, expiresAt: null, plan: null };
    }
  }

  /** Grant/renew a pass by `days`, stacking on any remaining time. Returns the new expiry (or null on failure). */
  async grant(userId: string, days: number, plan: string, now: number = Date.now()): Promise<string | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    const nowIso = new Date(now).toISOString();
    try {
      const ref = db.collection('professional_passes').doc(userId);
      const snap = await ref.get();
      const current = snap.exists ? ((snap.data() as PassDoc | undefined)?.expiresAt ?? null) : null;
      const expiresAt = computeNewExpiry(current, now, days);
      if (snap.exists) {
        await ref.update({ expiresAt, plan, updatedAt: nowIso });
      } else {
        await ref.set({ userId, expiresAt, plan, updatedAt: nowIso, createdAt: nowIso } as PassDoc);
      }
      return expiresAt;
    } catch {
      return null;
    }
  }
}

export const professionalPassStore = new ProfessionalPassStore();
