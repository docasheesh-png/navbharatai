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
import { firestoreDatabaseId } from '../lib/firestoreDb';

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
    _db.settings({ databaseId: firestoreDatabaseId() });
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
 * MERGE a PARTIAL set of files into the durable workspace (upsert only the given files, UNION their
 * paths into the authoritative list). Unlike `saveWorkspaceFiles` (which REPLACES the path list and
 * would drop every unchanged file when given a partial set), this never forgets existing files — so
 * a single IDE edit can be persisted durably without wiping the rest of the project. This is what
 * makes a manual IDE edit survive sandbox recycling (the File Guardian then sees the fresh content,
 * not a stale durable copy). Best-effort — never throws.
 */
export async function mergeWorkspaceFiles(workspaceId: string, partial: Record<string, string>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const entries = Object.entries(partial || {}).filter(([, c]) => typeof c === 'string' && Buffer.byteLength(c, 'utf8') <= MAX_FILE_BYTES);
  if (entries.length === 0) return;
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const filesCol = root.collection('files');
    // 1) Upsert ONLY the changed/added content docs.
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = db.batch();
      for (const [path, content] of entries.slice(i, i + BATCH)) {
        batch.set(filesCol.doc(fileDocId(path)), { path, content });
      }
      await batch.commit();
    }
    // 2) UNION the authoritative path list (never drop unchanged files).
    const meta = await root.get();
    const existing: string[] = meta.exists && Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    const union = Array.from(new Set([...existing, ...entries.map(([p]) => p)]));
    await root.set({ paths: union, count: union.length, savedAt: Date.now() }, { merge: true });
  } catch {
    /* best-effort — a merge failure never blocks anything */
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

/**
 * Cheap, metadata-only count of a workspace's persisted files — reads ONLY the metadata doc,
 * NOT every file's content (so it is safe on the hot path before a build). Used to make intent
 * classification workspace-aware: a non-empty workspace means a follow-up instruction should be
 * treated as an EDIT of the existing project, not a fresh rebuild. Returns 0 when absent / no
 * Firestore. Never throws.
 */
export async function countWorkspaceFiles(workspaceId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const meta = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!meta.exists) return 0;
    const data = meta.data();
    if (typeof data?.count === 'number' && data.count >= 0) return data.count;
    return Array.isArray(data?.paths) ? data!.paths.length : 0;
  } catch {
    return 0;
  }
}

/** Pure: split a current path list into what remains after removing `toRemove`, + the removed paths. */
export function diffRemovedPaths(current: string[], toRemove: string[]): { remaining: string[]; removed: string[] } {
  const removeSet = new Set((toRemove || []).filter((p) => typeof p === 'string' && p));
  const remaining: string[] = [];
  const removed: string[] = [];
  for (const p of current || []) (removeSet.has(p) ? removed : remaining).push(p);
  return { remaining, removed };
}

/**
 * Remove specific files from the durable workspace set. The authoritative `paths` metadata is
 * updated so loadWorkspaceFiles no longer returns them — i.e. v3.0 genuinely "forgets" the deleted
 * files (a fresh / restored session won't have them, and the file-guardian won't resurrect them).
 * Handles delete-all (paths → []). Best-effort: also deletes the orphaned content docs. Returns the
 * number of paths removed from the authoritative list. No-op without Firestore; never throws.
 */
export async function removeWorkspaceFiles(workspaceId: string, pathsToRemove: string[]): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const targets = (pathsToRemove || []).filter((p) => typeof p === 'string' && p);
  if (targets.length === 0) return 0;
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const meta = await root.get();
    if (!meta.exists) return 0;
    const current: string[] = Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    const { remaining, removed } = diffRemovedPaths(current, targets);
    if (removed.length === 0) return 0;
    // Update the authoritative path list FIRST — this is what makes the files "gone" for restore.
    await root.set({ paths: remaining, count: remaining.length, savedAt: Date.now() }, { merge: true });
    // Best-effort: delete the now-orphaned content docs (batched).
    const filesCol = root.collection('files');
    for (let i = 0; i < removed.length; i += BATCH) {
      const batch = db.batch();
      for (const p of removed.slice(i, i + BATCH)) batch.delete(filesCol.doc(fileDocId(p)));
      await batch.commit();
    }
    return removed.length;
  } catch {
    return 0;
  }
}
