// U-7 (foundation) — persistence for public API keys.
//
// Stores only the SHA-256 HASH of each key (never the plaintext), plus display-safe metadata and the
// owning user + scopes. Mirrors UserCostStore: VITEST-skip so tests never touch Firestore, best-effort
// (never throws, never blocks a request). Ownership is enforced on revoke (a user can only revoke keys
// they own). Lookup-by-hash powers API-key auth.
//
// Collection: `api_keys`  ·  Doc ID: keyId
// Fields: id, userId, name, hash, displayPrefix, last4, scopes[], createdAt, lastUsedAt, revoked

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  hash: string;
  displayPrefix: string;
  last4: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revoked: boolean;
}

/** Display-safe view (no hash) returned to the owner. */
export type ApiKeyMeta = Omit<ApiKeyRecord, 'hash'>;

/** Auth resolution result for a presented key. */
export interface ApiKeyAuth {
  userId: string;
  keyId: string;
  scopes: string[];
}

class ApiKeyStore {
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

  /** Persist a new key record (hash only). */
  async create(record: ApiKeyRecord): Promise<boolean> {
    const db = this.getDb();
    if (!db || !record.userId || !record.id || !record.hash) return false;
    try {
      await db.collection('api_keys').doc(record.id).set(record, { merge: false });
      return true;
    } catch {
      return false;
    }
  }

  /** List a user's keys (metadata only — never the hash), newest first. */
  async listForUser(userId: string): Promise<ApiKeyMeta[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const snap = await db.collection('api_keys').where('userId', '==', userId).get();
      const out: ApiKeyMeta[] = [];
      snap.forEach((doc) => {
        const { hash, ...meta } = doc.data() as ApiKeyRecord;
        void hash; // intentionally dropped — never leave the server
        out.push(meta);
      });
      return out.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  /** Revoke a key, but only if it belongs to `userId`. Returns true when a key was revoked. */
  async revoke(userId: string, keyId: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userId || !keyId) return false;
    try {
      const ref = db.collection('api_keys').doc(keyId);
      const doc = await ref.get();
      if (!doc.exists) return false;
      const rec = doc.data() as ApiKeyRecord;
      if (rec.userId !== userId) return false; // ownership guard — cannot revoke someone else's key
      await ref.update({ revoked: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve a presented key's hash to its owner + scopes (only for a live, non-revoked key). */
  async findByHash(hash: string): Promise<ApiKeyAuth | null> {
    const db = this.getDb();
    if (!db || !hash) return null;
    try {
      const snap = await db.collection('api_keys').where('hash', '==', hash).limit(1).get();
      if (snap.empty) return null;
      const rec = snap.docs[0].data() as ApiKeyRecord;
      if (rec.revoked) return null;
      return { userId: rec.userId, keyId: rec.id, scopes: rec.scopes || [] };
    } catch {
      return null;
    }
  }

  /** Best-effort: stamp when a key was last used (never blocks the request). */
  async touchLastUsed(keyId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !keyId) return;
    try {
      await db.collection('api_keys').doc(keyId).update({ lastUsedAt: Date.now() });
    } catch { /* best-effort */ }
  }
}

export const apiKeyStore = new ApiKeyStore();
