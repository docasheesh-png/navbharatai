/**
 * Phase 4.1 — Cross-instance AI provider cooldown sharing.
 *
 * The AIRouter circuit breaker keeps each provider's cooldown in an in-memory
 * Map. With multiple Cloud Run instances, instance B keeps hammering a provider
 * that instance A already found rate-limited. This store shares cooldown state
 * via Firestore so a provider that ANY instance marked down is skipped by ALL.
 *
 * Design (latency-safe — the hot path is never touched):
 *   • write(provider, until)  — fire-and-forget on every setCooldown (no await on the request path).
 *   • readAll()               — read every provider's cooldown doc.
 *   • startSync(merge)        — background interval (default 60s) that pulls remote
 *                               cooldowns and merges them into the in-memory map.
 *     isOnCooldown() stays a pure in-memory read (zero added latency); it just
 *     reflects cross-instance state within one sync interval.
 *
 * Pattern mirrors UserCostStore / ErrorPatternStore: VITEST-skip, best-effort,
 * never throws, never blocks.
 *
 * 🔴 READ BUDGET (Firestore bill audit, 2026-11-21). The sync ran every 20 s on every instance, 24/7 —
 * ~1,29,000 runs in 30 days, each reading EVERY provider's document, expired or not. The scheduler that
 * keeps one instance warm (`/api/warm`) meant an instance with no AI traffic at all polled all night. Now:
 *   • a tick reads only LIVE cooldowns (`where('until', '>', now)`) — the merge already discarded expired
 *     ones, so this changes no decision, only what is billed;
 *   • it runs every 60 s, not 20 s;
 *   • it skips entirely while this instance has made no AI call recently (`isActive`), because a remote
 *     cooldown only changes the routing of calls this instance is making.
 * The cost of the slower cadence, stated: another instance's fresh cooldown can take up to 60 s (was 20 s)
 * to reach this one; this instance's OWN breaker still trips on its own first failure immediately.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

interface CooldownDoc {
  provider: string;
  until: number;
  updatedAt: number;
}

/** How often an active instance pulls other instances' cooldowns. Was 20 s (see the read-budget note). */
export const COOLDOWN_SYNC_INTERVAL_MS = 60_000;
/** An instance that made an AI call within this window counts as active and keeps syncing. */
export const COOLDOWN_SYNC_ACTIVE_WINDOW_MS = 10 * 60_000;

/**
 * One sync tick: read and merge only when `isActive()`. Returns whether a read happened. PURE over its
 * arguments (the test passes fakes; the store passes Firestore). Never throws.
 */
export async function cooldownSyncTick(
  read: () => Promise<Record<string, number>>,
  merge: (remote: Record<string, number>) => void,
  isActive: () => boolean,
): Promise<boolean> {
  try {
    if (!isActive()) return false;
    const remote = await read();
    if (Object.keys(remote).length) merge(remote);
    return true;
  } catch {
    return false;
  }
}

class ProviderCooldownStore {
  private db: admin.firestore.Firestore | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

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

  /** Persist a provider cooldown so other instances can see it. Fire-and-forget. */
  async write(provider: string, until: number): Promise<void> {
    const db = this.getDb();
    if (!db || !provider) return;
    try {
      await db.collection('provider_cooldowns').doc(provider).set(
        { provider, until, updatedAt: Date.now() },
        { merge: true },
      );
    } catch {
      /* best-effort — never block the AI call path */
    }
  }

  /** Read every provider's current cooldown deadline (epoch ms). */
  async readAll(): Promise<Record<string, number>> {
    const db = this.getDb();
    if (!db) return {};
    try {
      // Only cooldowns still in force. Single-field range ⇒ the automatic index serves it.
      const snap = await db.collection('provider_cooldowns').where('until', '>', Date.now()).get();
      const out: Record<string, number> = {};
      snap.forEach((d) => {
        const data = d.data() as CooldownDoc;
        if (data?.provider && typeof data.until === 'number') out[data.provider] = data.until;
      });
      return out;
    } catch {
      return {};
    }
  }

  /**
   * Start a background sync loop that merges remote cooldowns into local state.
   * No-op under tests and idempotent (only one timer ever runs). The timer is
   * unref'd so it never keeps the process alive on its own. `isActive` gates each
   * tick: while it returns false nothing is read (see the read-budget note above).
   */
  startSync(
    merge: (remote: Record<string, number>) => void,
    intervalMs = COOLDOWN_SYNC_INTERVAL_MS,
    isActive: () => boolean = () => true,
  ): void {
    if (this.syncTimer) return;
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    const tick = () => void cooldownSyncTick(() => this.readAll(), merge, isActive);
    tick();
    this.syncTimer = setInterval(tick, intervalMs);
    if (typeof (this.syncTimer as any).unref === 'function') (this.syncTimer as any).unref();
  }

  /** Stop the sync loop (used by tests / graceful shutdown). */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

export const providerCooldownStore = new ProviderCooldownStore();
