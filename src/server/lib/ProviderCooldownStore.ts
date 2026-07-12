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
 *   • startSync(merge)        — background interval (default 20s) that pulls remote
 *                               cooldowns and merges them into the in-memory map.
 *     isOnCooldown() stays a pure in-memory read (zero added latency); it just
 *     reflects cross-instance state within one sync interval.
 *
 * Pattern mirrors UserCostStore / ErrorPatternStore: VITEST-skip, best-effort,
 * never throws, never blocks.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

interface CooldownDoc {
  provider: string;
  until: number;
  updatedAt: number;
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
      const snap = await db.collection('provider_cooldowns').get();
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
   * unref'd so it never keeps the process alive on its own.
   */
  startSync(merge: (remote: Record<string, number>) => void, intervalMs = 20_000): void {
    if (this.syncTimer) return;
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    const tick = async () => {
      const remote = await this.readAll();
      if (Object.keys(remote).length) merge(remote);
    };
    void tick();
    this.syncTimer = setInterval(() => void tick(), intervalMs);
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
