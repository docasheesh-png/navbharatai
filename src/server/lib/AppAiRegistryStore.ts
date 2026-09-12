// WHICH APP IS ASKING — the registry behind the published-app AI gateway (ROADMAP §13, 3.1).
//
// The gateway's token is PUBLIC (see appAiGateway.ts), so it carries a public app identity — the same
// `nbai-<hash>` already in the app's own URL — and never the workspace id. This is the one document
// that turns that public identity back into "whose workspace, whose wallet", plus the nonce pair that
// makes a republish a real rotation.
//
// 🔒 IT IS A LOOKUP, NOT A PERMISSION. Holding a valid token proves only which app is spending; the
// caps in appAiGateway.ts are what bound that spending, and the live-deployment check is what makes an
// unpublished app's assistant go quiet. Nothing here should ever be read as authorisation.
//
// Collection: `app_ai_apps`   ·   Doc ID: the public app id (`nbai-<20 hex>`)
//
// Written at PUBLISH and read on every gateway call, so the read path is one `get` by document id —
// no query, no index, nothing to keep in sync.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { rotateNonce, type AppNoncePair } from './appAiGateway';

const COLLECTION = 'app_ai_apps';

export interface AppAiRecord extends AppNoncePair {
  appId: string;
  workspaceId: string;
  userId: string;
  updatedAt: number;
}

/**
 * 🔒 THERE IS DELIBERATELY NO PER-APP CAP OVERRIDE HERE YET.
 *
 * A `capInr` field was written and then removed before this shipped: nothing in the product can set
 * it, so it would have been a promise with no screen behind it — and the generated app's own
 * instructions would have told the owner to go and raise a limit they cannot reach. Every app is on
 * the platform default (`APP_AI_DAILY_CAP_INR`, ₹20), which is real, enforced and admin-tunable. The
 * owner-facing control is a later change, and it adds the field back in the same PR as the screen.
 */

class AppAiRegistryStore {
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

  async get(appId: string): Promise<AppAiRecord | null> {
    const db = this.getDb();
    const id = String(appId ?? '').trim();
    if (!db || !id) return null;
    try {
      const snap = await db.collection(COLLECTION).doc(id).get();
      return snap.exists ? (snap.data() as AppAiRecord) : null;
    } catch {
      // A read failure is NOT "this app does not exist" — the caller treats null as unavailable and
      // says so honestly, which is the right direction here: a Firestore hiccup must not let an
      // unknown token spend somebody's wallet.
      return null;
    }
  }

  /**
   * Record a publish: the fresh nonce becomes current and the outgoing one is kept for one generation.
   *
   * Returns false when the write did not land, and the caller must then NOT stamp the token into the
   * page — a token whose registry row is missing would produce an assistant that fails on every
   * question, which is the "built but not really working" state that must not exist.
   */
  async mint(appId: string, workspaceId: string, userId: string, nonce: string): Promise<boolean> {
    const db = this.getDb();
    const id = String(appId ?? '').trim();
    if (!db || !id || !workspaceId || !nonce) return false;
    try {
      const ref = db.collection(COLLECTION).doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as AppAiRecord) : null;
        const pair = rotateNonce(existing, nonce);
        tx.set(ref, {
          appId: id,
          workspaceId,
          userId: userId || '',
          updatedAt: Date.now(),
          ...pair,
        } satisfies AppAiRecord, { merge: false });
      });
      return true;
    } catch (e) {
      console.error(`[APPAI] could not record the gateway token for ${id}:`, e);
      return false;
    }
  }
}

export const appAiRegistryStore = new AppAiRegistryStore();
