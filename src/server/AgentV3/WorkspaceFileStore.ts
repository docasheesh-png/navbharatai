// AgentV3 — Durable workspace FILE persistence (so a build's source code never vanishes).
//
// The sandbox is ephemeral: if it is paused, garbage-collected, or a later message gets a fresh
// one, every file the agent wrote is gone — and there was nothing to restore them from (only the
// MEMORY snapshot was persisted, not the file CONTENT). That is the "files gayab ho gayi" bug.
//
// This store persists the actual file contents to Firestore, keyed by workspaceId, so:
//   • at the start of a build, a fresh/empty sandbox is re-seeded with the user's saved files;
//   • after a build, the produced files are saved.
// Files are stored one-per-document in a `files` subcollection to stay clear of the 1 MB
// document limit; a metadata doc holds the authoritative current path list (so a file the user
// deleted is not resurrected on the next restore).
//
// Pattern mirrors FirestoreWorkspaceMemoryStore: firebase-admin, VITEST-skip, best-effort, never
// throws — a persistence failure must never break or block a build.

import * as admin from 'firebase-admin';
import firebaseConfig from '../../../firebase-applet-config.json';

const COLLECTION = 'workspace_files_v3';
/** Firestore's hard per-document limit is 1 MB; skip a single file larger than this. */
const MAX_FILE_BYTES = 900 * 1024;
/** Firestore batches allow up to 500 writes; stay under it. */
const BATCH = 400;

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = admin.firestore();
    _db.settings({ databaseId: firebaseConfig.firestoreDatabaseId });
    return _db;
  } catch {
    return null;
  }
}

/** Deterministic, '/'-free Firestore doc id for a workspace-relative file path. */
export function fileDocId(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url').slice(0, 1500);
}

/**
 * Persist the current set of workspace source files. The `paths` metadata list is authoritative:
 * a file removed from `files` won't be returned by loadWorkspaceFiles even if its content doc
 * lingers. Best-effort — never throws.
 */
export async function saveWorkspaceFiles(workspaceId: string, files: Record<string, string>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const entries = Object.entries(files).filter(([, c]) => typeof c === 'string' && Buffer.byteLength(c, 'utf8') <= MAX_FILE_BYTES);
  if (entries.length === 0) return; // never overwrite a good saved set with nothing
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const filesCol = root.collection('files');
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = db.batch();
      for (const [path, content] of entries.slice(i, i + BATCH)) {
        batch.set(filesCol.doc(fileDocId(path)), { path, content });
      }
      await batch.commit();
    }
    await root.set({ paths: entries.map(([p]) => p), count: entries.length, savedAt: Date.now() }, { merge: false });
  } catch {
    /* best-effort — a save failure never blocks a build */
  }
}

/**
 * Load the last persisted file set for a workspace as { path: content }. Returns {} when absent.
 * Only paths in the authoritative metadata list are returned (so deleted files stay deleted).
 * Never throws.
 */
export async function loadWorkspaceFiles(workspaceId: string): Promise<Record<string, string>> {
  const db = getDb();
  if (!db) return {};
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const meta = await root.get();
    if (!meta.exists) return {};
    const paths: string[] = Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    if (paths.length === 0) return {};
    const allowed = new Set(paths);
    const docs = await root.collection('files').get();
    const out: Record<string, string> = {};
    for (const d of docs.docs) {
      const data = d.data();
      if (typeof data.path === 'string' && typeof data.content === 'string' && allowed.has(data.path)) {
        out[data.path] = data.content;
      }
    }
    return out;
  } catch {
    return {};
  }
}
