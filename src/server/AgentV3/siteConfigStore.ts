/**
 * Where a published app's site settings live (ROADMAP §13, 1.6) — one document per workspace,
 * `site_configs/<workspaceId>`. Read at publish time by the deployer; written by the settings route
 * after validateSiteConfig has refused anything unsafe.
 *
 * Pattern mirrors HostingUsageStore: VITEST-skip, best-effort, never throws. A store that cannot be
 * read yields NULL — the deployer then publishes with the DEFAULT config (SPA rewrite + safe headers),
 * which is exactly today's behaviour plus the headers, never a broken site.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { validateSiteConfig, type SiteConfig } from './siteConfig';

export const SITE_CONFIG_COLLECTION = 'site_configs';

class SiteConfigStore {
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

  /** The saved settings, re-validated on read so a hand-edited document cannot smuggle a bad rule. */
  async get(workspaceId: string): Promise<SiteConfig | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection(SITE_CONFIG_COLLECTION).doc(workspaceId).get();
      if (!snap.exists) return null;
      return validateSiteConfig(snap.data()).config;
    } catch {
      return null;
    }
  }

  /** Persist an already-validated config. Returns false when the store is unavailable. */
  async set(workspaceId: string, userId: string, config: SiteConfig): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId) return false;
    try {
      await db.collection(SITE_CONFIG_COLLECTION).doc(workspaceId).set(
        { workspaceId, userId, redirects: config.redirects, allowEmbedding: config.allowEmbedding, updatedAt: Date.now() },
        { merge: true },
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const siteConfigStore = new SiteConfigStore();
