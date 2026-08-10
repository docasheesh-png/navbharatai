// AgentV3 — Durable embedding persistence (P-DATA.3).
//
// EmbeddingSearch keeps file embeddings in an in-memory Map, so on every cold start the whole
// workspace had to be RE-EMBEDDED (latency + OpenAI cost). This persists each file's embedding to
// Firestore keyed by workspace + path, tagged with a content HASH, so on restart the index hydrates
// from the durable copy and only CHANGED files (hash mismatch) are re-embedded.
//
// Pattern mirrors WorkspaceFileStore: firebase-admin, VITEST-skip, best-effort, never throws.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

const COLLECTION = 'workspace_embeddings_v3';
/** Cap how many embedding rows we hydrate per workspace (keeps a huge repo's cold-start bounded). */
const MAX_HYDRATE = 2000;

export interface PersistedEmbedding {
  path: string;
  hash: string;
  embedding: number[];
}

/** Deterministic, Firestore-safe doc id for a workspace-relative file path. Pure. */
export function embeddingDocId(path: string): string {
  return Buffer.from(String(path), 'utf8').toString('base64url').slice(0, 1500);
}

/** Fast, stable content hash (FNV-1a, hex) — used to detect a changed file. Pure. */
export function hashContent(content: string): string {
  let h = 2166136261 >>> 0;
  const s = String(content);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Pure: does a file need re-embedding? True when there is no prior hash or it changed. */
export function needsReembed(prevHash: string | undefined, nextHash: string): boolean {
  return prevHash !== nextHash;
}

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Persist one file's embedding (best-effort). Never throws, never blocks indexing. */
export async function saveEmbedding(workspaceId: string, row: PersistedEmbedding): Promise<void> {
  if (!workspaceId || !row?.path || !Array.isArray(row.embedding) || row.embedding.length === 0) return;
  const db = getDb();
  if (!db) return;
  try {
    await db
      .collection(COLLECTION)
      .doc(workspaceId)
      .collection('files')
      .doc(embeddingDocId(row.path))
      .set({ path: row.path, hash: row.hash, embedding: row.embedding });
  } catch {
    /* best-effort */
  }
}

/** Remove one file's persisted embedding (on delete). Best-effort. */
export async function removeEmbedding(workspaceId: string, path: string): Promise<void> {
  if (!workspaceId || !path) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).doc(workspaceId).collection('files').doc(embeddingDocId(path)).delete();
  } catch {
    /* best-effort */
  }
}

/** Load a workspace's persisted embeddings for cold-start hydration (bounded). Never throws. */
export async function loadEmbeddings(workspaceId: string): Promise<PersistedEmbedding[]> {
  if (!workspaceId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(COLLECTION).doc(workspaceId).collection('files').limit(MAX_HYDRATE).get();
    const out: PersistedEmbedding[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (data && typeof data.path === 'string' && Array.isArray(data.embedding)) {
        out.push({ path: data.path, hash: typeof data.hash === 'string' ? data.hash : '', embedding: data.embedding as number[] });
      }
    }
    return out;
  } catch {
    return [];
  }
}
