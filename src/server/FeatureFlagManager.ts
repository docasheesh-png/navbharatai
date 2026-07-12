import crypto from 'crypto';
// ADMIN-SDK binding (bypasses security rules) — see lib/serverDb.ts. Reads/writes feature flags (server-only).
import { doc, getDoc, setDoc, getServerDb as getDb } from './lib/serverDb';

/**
 * P-PME.8 — Feature Flag Manager.
 *
 * Feature flags lived in-memory (`serverStats.featureFlags`) — toggling survived only until the
 * next Cloud Run restart, and there was no per-user or percentage rollout. This adds:
 *   - Firestore persistence (`config/featureFlags`) so admin toggles survive deploys/restarts.
 *   - Per-user overrides + percentage rollout, with deterministic per-(user,flag) bucketing.
 *
 * `isFlagEnabled` is pure + unit-tested; the load/save are best-effort (no DB → no-op, never throws).
 */

export interface FeatureFlagConfig {
  /** Global on/off per flag. */
  flags: Record<string, boolean>;
  /** Optional percentage rollout (0–100) per flag — applied when the global flag is off. */
  rollout?: Record<string, number>;
  /** Optional per-user overrides: overrides[userId][flag] = true|false (wins over everything). */
  overrides?: Record<string, Record<string, boolean>>;
}

/** Deterministic bucket 0–99 for a (userId, flag) pair — stable across calls/instances. */
export function stableHashPercent(userId: string, flag: string): number {
  const h = crypto.createHash('sha256').update(`${flag}:${userId}`).digest();
  // Use the first 4 bytes as an unsigned int.
  const n = h.readUInt32BE(0);
  return n % 100;
}

/**
 * Resolve a flag for a user. Precedence: per-user override → percentage rollout (needs userId) →
 * global flag → false. Pure.
 */
export function isFlagEnabled(config: FeatureFlagConfig | null | undefined, flag: string, userId?: string): boolean {
  if (!config) return false;
  const override = userId && config.overrides?.[userId];
  if (override && Object.prototype.hasOwnProperty.call(override, flag)) return !!override[flag];
  if (config.flags?.[flag] === true) return true;
  const pct = config.rollout?.[flag];
  if (typeof pct === 'number' && pct > 0 && userId) {
    return stableHashPercent(userId, flag) < Math.min(100, pct);
  }
  // Global flag was already checked above (and returned true if set); nothing else enables it.
  return false;
}

const FLAGS_DOC = 'config';
const FLAGS_ID = 'featureFlags';

/** Load the persisted flag config from Firestore. Best-effort → null when unavailable. */
export async function loadFlagConfig(): Promise<FeatureFlagConfig | null> {
  const db = getDb() as any;
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, FLAGS_DOC, FLAGS_ID));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      flags: data?.flags && typeof data.flags === 'object' ? data.flags : {},
      rollout: data?.rollout && typeof data.rollout === 'object' ? data.rollout : undefined,
      overrides: data?.overrides && typeof data.overrides === 'object' ? data.overrides : undefined,
    };
  } catch (err) {
    console.error('[FEATURE_FLAGS] load failed:', err);
    return null;
  }
}

/** Persist the flag config to Firestore. Best-effort; returns whether it was written. */
export async function saveFlagConfig(config: FeatureFlagConfig): Promise<boolean> {
  const db = getDb() as any;
  if (!db) return false;
  try {
    await setDoc(doc(db, FLAGS_DOC, FLAGS_ID), {
      flags: config.flags || {},
      ...(config.rollout ? { rollout: config.rollout } : {}),
      ...(config.overrides ? { overrides: config.overrides } : {}),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('[FEATURE_FLAGS] save failed:', err);
    return false;
  }
}
