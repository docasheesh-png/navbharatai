/**
 * Phase 2.1 — Git-native versioning: persist every successful build as a
 * numbered version checkpoint in Firestore.
 *
 * Every build (ok: true) writes one entry here. The frontend can list all
 * versions for a workspace and restore any of them — giving users "go back to
 * version 3" semantics without a real git server.
 *
 * Collection layout:
 *   build_history/{sessionId}              — workspace metadata doc
 *   build_history/{sessionId}/versions/{versionId}  — one doc per build
 *
 * Versions are capped at MAX_VERSIONS_PER_WORKSPACE per workspace (oldest
 * dropped). Each version doc is capped at MAX_VERSION_BYTES (Firestore 1MB
 * limit). Never throws — build must never be blocked by history writes.
 */
import * as admin from 'firebase-admin';

export interface VersionEntry {
  id: string;
  sessionId: string;
  commitMessage: string;
  createdAt: string;
  fileCount: number;
  isEdit: boolean;
  tier?: string;
  ok: boolean;
  /** Only present on get(), not on list() */
  files?: Record<string, string>;
}

export type VersionMeta = Omit<VersionEntry, 'files'>;

const MAX_VERSIONS_PER_WORKSPACE = 50;
const MAX_VERSION_BYTES = 900_000; // 900KB — safely under Firestore 1MB doc limit

/** Truncate files payload to fit Firestore doc size limit. */
function capFiles(files: Record<string, string>): Record<string, string> {
  const entries = Object.entries(files);
  const result: Record<string, string> = {};
  let bytes = 0;
  for (const [path, content] of entries) {
    const size = path.length + content.length;
    if (bytes + size > MAX_VERSION_BYTES) break;
    result[path] = content;
    bytes += size;
  }
  return result;
}

class BuildHistoryStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = admin.firestore();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private versionsCol(db: admin.firestore.Firestore, sessionId: string) {
    return db.collection('build_history').doc(sessionId).collection('versions');
  }

  async save(
    sessionId: string,
    entry: {
      commitMessage: string;
      fileCount: number;
      files: Record<string, string>;
      isEdit: boolean;
      tier?: string;
      ok: boolean;
    },
  ): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      const col = this.versionsCol(db, sessionId);
      const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const doc: VersionEntry = {
        id,
        sessionId,
        commitMessage: entry.commitMessage,
        createdAt: new Date().toISOString(),
        fileCount: entry.fileCount,
        isEdit: entry.isEdit,
        tier: entry.tier,
        ok: entry.ok,
        files: capFiles(entry.files),
      };
      await col.doc(id).set(doc);
      // Enforce MAX_VERSIONS_PER_WORKSPACE: drop the oldest if needed.
      const all = await col.orderBy('createdAt', 'asc').get();
      if (all.size > MAX_VERSIONS_PER_WORKSPACE) {
        const toDelete = all.docs.slice(0, all.size - MAX_VERSIONS_PER_WORKSPACE);
        const batch = db.batch();
        toDelete.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch { /* best-effort — never block the build */ }
  }

  /** List version metadata for a workspace, newest first. No file payloads. */
  async list(sessionId: string): Promise<VersionMeta[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const snap = await this.versionsCol(db, sessionId)
        .orderBy('createdAt', 'desc')
        .limit(MAX_VERSIONS_PER_WORKSPACE)
        .get();
      return snap.docs.map(d => {
        const { files: _files, ...meta } = d.data() as VersionEntry;
        return meta as VersionMeta;
      });
    } catch {
      return [];
    }
  }

  /** Get a single version with full file payload. */
  async get(sessionId: string, versionId: string): Promise<VersionEntry | null> {
    const db = this.getDb();
    if (!db) return null;
    try {
      const doc = await this.versionsCol(db, sessionId).doc(versionId).get();
      if (!doc.exists) return null;
      return doc.data() as VersionEntry;
    } catch {
      return null;
    }
  }
}

export const buildHistoryStore = new BuildHistoryStore();
