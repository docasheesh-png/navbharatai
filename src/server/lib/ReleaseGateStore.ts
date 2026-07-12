// P-DEPLOY.5 — persistence for the release freeze/approval gate.
//
// Stores a single config document. VITEST-skip + best-effort (never throws), mirroring UserCostStore.
// With no stored config (or no DB) it returns the fully-OPEN gate, so the pipeline is never accidentally
// blocked by a storage hiccup.
//
// Collection: `platform_config`  ·  Doc ID: `release_gate`

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { normalizeGateConfig, OPEN_GATE, type ReleaseGateConfig } from './ReleaseGate';

const COLLECTION = 'platform_config';
const DOC_ID = 'release_gate';

class ReleaseGateStore {
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

  async get(): Promise<ReleaseGateConfig> {
    const db = this.getDb();
    if (!db) return { ...OPEN_GATE };
    try {
      const snap = await db.collection(COLLECTION).doc(DOC_ID).get();
      return snap.exists ? normalizeGateConfig(snap.data()) : { ...OPEN_GATE };
    } catch {
      return { ...OPEN_GATE }; // fail OPEN — a storage error must not block deploys
    }
  }

  async set(config: ReleaseGateConfig): Promise<boolean> {
    const db = this.getDb();
    if (!db) return false;
    try {
      await db.collection(COLLECTION).doc(DOC_ID).set(normalizeGateConfig(config), { merge: false });
      return true;
    } catch {
      return false;
    }
  }
}

export const releaseGateStore = new ReleaseGateStore();
