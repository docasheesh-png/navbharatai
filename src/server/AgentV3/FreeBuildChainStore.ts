/**
 * The free-build UNATTENDED CHAIN, kept where every Cloud Run instance can read it (queue Q-130).
 *
 * `freeBuildTimeCap.ts` counted a free request's unattended windows in ONE instance's memory, so an
 * auto-continue that landed on another instance started a fresh allowance — one free request could hold
 * sandboxes far past `AGENTV3_FREE_BUILD_AUTO_SECONDS`, at NavBharatAI's cost. This store is the durable half:
 * one tiny document per workspace.
 *
 * FAILURE MODE, matching TerminalUsageStore: every read fails OPEN (null ⇒ the in-memory count alone, which
 * is exactly the behaviour before this store), every write is best-effort. A Firestore glitch can only ever
 * be as generous as the old code, never stop a build it should not.
 *
 * Collection: `free_build_chains` (doc id = workspaceId)
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import type { FreeChain, FreeChainStore } from './freeBuildTimeCap';

const COLLECTION = 'free_build_chains';

class FirestoreFreeChainStore implements FreeChainStore {
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

  async load(workspaceId: string): Promise<FreeChain | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection(COLLECTION).doc(workspaceId).get();
      const d = snap.exists ? (snap.data() as Partial<FreeChain> | undefined) : undefined;
      if (!d || typeof d.spentMs !== 'number' || typeof d.touchedAt !== 'number') return null;
      return { spentMs: Math.max(0, d.spentMs), touchedAt: d.touchedAt };
    } catch {
      return null;
    }
  }

  async save(workspaceId: string, chain: FreeChain): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try { await db.collection(COLLECTION).doc(workspaceId).set({ spentMs: chain.spentMs, touchedAt: chain.touchedAt }); } catch { /* best-effort */ }
  }

  async clear(workspaceId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try { await db.collection(COLLECTION).doc(workspaceId).delete(); } catch { /* best-effort */ }
  }
}

export const freeChainStore: FreeChainStore = new FirestoreFreeChainStore();
