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
import type { GateCheckRecord } from './releaseGateEnforcement';

const COLLECTION = 'platform_config';
const DOC_ID = 'release_gate';
/** Evidence that a pipeline really asks the gate — a SEPARATE doc; see `noteChecked`. */
const CHECKS_DOC_ID = 'release_gate_checks';

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

  /**
   * Record that a deploy pipeline really asked the gate (Q-141).
   *
   * 🔴 A SEPARATE DOCUMENT ON PURPOSE. `set()` below writes the config with `merge: false`, so a field
   * kept on the same document would be silently erased the next time an admin changed the freeze — and
   * the erased field is the evidence that the wiring works, which is the one thing that must not be
   * guessable. Best-effort and never awaited by the route: a storage hiccup must not slow, or fail, the
   * answer a pipeline is waiting on.
   */
  async noteChecked(sha?: string): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.collection(COLLECTION).doc(CHECKS_DOC_ID).set({
        lastCheckedAtMs: Date.now(),
        lastCheckedSha: typeof sha === 'string' ? sha.slice(0, 64) : '',
        checkCount: admin.firestore.FieldValue.increment(1),
      }, { merge: true });
    } catch {
      /* the gate's answer matters; this record does not */
    }
  }

  /** What the last recorded pipeline check was, or null when nothing is recorded. */
  async lastChecked(): Promise<GateCheckRecord | null> {
    const db = this.getDb();
    if (!db) return null;
    try {
      const snap = await db.collection(COLLECTION).doc(CHECKS_DOC_ID).get();
      if (!snap.exists) return null;
      const d = snap.data() ?? {};
      return {
        lastCheckedAtMs: typeof d.lastCheckedAtMs === 'number' ? d.lastCheckedAtMs : undefined,
        lastCheckedSha: typeof d.lastCheckedSha === 'string' ? d.lastCheckedSha : undefined,
        checkCount: typeof d.checkCount === 'number' ? d.checkCount : undefined,
      };
    } catch {
      return null;
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
