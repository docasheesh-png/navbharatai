// The Firestore home of a free build's unattended chain (Q-130). One small record per workspace, written
// only by the server (admin SDK), read back by whichever Cloud Run instance the next window lands on.
// `null` when there is no database, so the caller keeps its memory-only count. See freeBuildTimeCap.ts.

import { getServerDb } from '../lib/serverDb';
import type { FreeChainStore } from './freeBuildTimeCap';

export const FREE_CHAIN_COLLECTION = 'agentv3_free_chains';

export function firestoreFreeChainStore(): FreeChainStore | null {
  const db = getServerDb();
  if (!db) return null;
  const ref = (workspaceId: string) => db.collection(FREE_CHAIN_COLLECTION).doc(encodeURIComponent(workspaceId).slice(0, 1400));
  return {
    async get(workspaceId) {
      const snap = await ref(workspaceId).get();
      if (!snap.exists) return null;
      const d = snap.data() as { spentMs?: unknown; touchedAt?: unknown } | undefined;
      const spentMs = Number(d?.spentMs);
      const touchedAt = Number(d?.touchedAt);
      return Number.isFinite(spentMs) && Number.isFinite(touchedAt) ? { spentMs, touchedAt } : null;
    },
    async set(workspaceId, chain) {
      await ref(workspaceId).set({ spentMs: chain.spentMs, touchedAt: chain.touchedAt });
    },
    async remove(workspaceId) {
      await ref(workspaceId).delete();
    },
  };
}
