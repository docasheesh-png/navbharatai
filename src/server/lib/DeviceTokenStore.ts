// Push notifications — per-user FCM device token registry (admin request 2026-07-26: "push notification
// kaam nahi kar raha" — root cause was that push notifications were never built at all, see mobileNative.ts
// for the two features that WERE built: app-update-check + in-app-review).
//
// Mirrors MentionNotificationStore.ts exactly: VITEST-skip getDb, best-effort (never throws), path-scoped
// collection so a user can only ever read/write their OWN tokens. Collection: `users/{uid}/deviceTokens/{token}`
// — the FCM token itself is the document id (idempotent re-registration: the same token always overwrites
// the same doc instead of accumulating duplicates).

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export type DevicePlatform = 'android' | 'ios' | 'web';

export interface DeviceToken {
  token: string;
  platform: DevicePlatform;
  createdAt: number;
  lastSeenAt: number;
}

/** Max tokens kept per user (old/stale devices age out on registration, oldest-first). */
export const MAX_TOKENS_PER_USER = 10;

class DeviceTokenStore {
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

  private col(uid: string) {
    const db = this.getDb();
    return db && uid ? db.collection('users').doc(uid).collection('deviceTokens') : null;
  }

  /** Register (or refresh) a device token for a user. Idempotent — re-registering the same token just
   *  bumps lastSeenAt. Prunes the oldest token(s) past MAX_TOKENS_PER_USER so a user re-installing many
   *  times can't grow this collection unboundedly. Returns true on success, false on any failure. */
  async saveToken(uid: string, token: string, platform: DevicePlatform): Promise<boolean> {
    const col = this.col(uid);
    if (!col || !token) return false;
    try {
      const now = Date.now();
      await col.doc(token).set(
        { token, platform, lastSeenAt: now, createdAt: admin.firestore.FieldValue.serverTimestamp() as unknown as number },
        { merge: true },
      );
      // Best-effort prune — never blocks the registration itself.
      const snap = await col.orderBy('lastSeenAt', 'desc').get();
      if (snap.size > MAX_TOKENS_PER_USER) {
        const stale = snap.docs.slice(MAX_TOKENS_PER_USER);
        await Promise.all(stale.map((d) => d.ref.delete())).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Unregister one token (e.g. on sign-out). Best-effort. */
  async removeToken(uid: string, token: string): Promise<boolean> {
    const col = this.col(uid);
    if (!col || !token) return false;
    try {
      await col.doc(token).delete();
      return true;
    } catch {
      return false;
    }
  }

  /** All live tokens for a user, for sending a push. Empty array on any failure (never throws). */
  async listTokensForUser(uid: string): Promise<DeviceToken[]> {
    const col = this.col(uid);
    if (!col) return [];
    try {
      const snap = await col.get();
      const out: DeviceToken[] = [];
      snap.forEach((d) => out.push(d.data() as DeviceToken));
      return out;
    } catch {
      return [];
    }
  }

  /** Remove tokens FCM reported as invalid/unregistered (called after a send). Best-effort. */
  async removeTokens(uid: string, tokens: string[]): Promise<void> {
    const col = this.col(uid);
    if (!col || !tokens.length) return;
    try {
      await Promise.all(tokens.map((t) => col.doc(t).delete())).catch(() => {});
    } catch {
      /* best-effort */
    }
  }
}

export const deviceTokenStore = new DeviceTokenStore();
