// AgentV3 — Firestore-backed WorkspaceMemory persistence (Level 9).
//
// Persists a WorkspaceMemory snapshot to Firestore so the project graph and
// episodic memory (components, symbols, routes, errors, fixes) survive server
// restarts and Cloud Run cold-starts.
//
// On a cold resume the route loads the last snapshot and restores it into the
// in-memory WorkspaceMemory BEFORE running warmIndexFiles — so the agent has
// full codebase context from its very first tool call in a resumed session.
//
// Pattern: identical to FirestoreConversationStore (firebase-admin, best-effort,
// VITEST-skip, firebase-applet-config.json for database id). Never throws.

import * as admin from 'firebase-admin';
import type { MemorySnapshot, ProjectGraph, Episode } from './WorkspaceMemory';
import { getServerDb } from '../lib/serverDb';
import { notePersistenceFailure } from '../lib/persistenceHealth';

const COLLECTION = 'workspace_memory_v3';
/** Keep snapshots for up to 30 days — after that they are stale and ignored. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Cap episodes stored in Firestore to stay within the 1 MB document limit. */
const MAX_EPISODES = 100;

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  // Unit tests never hit real Firestore.
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch (e) {
    notePersistenceFailure('workspace_memory', 'init', e);
    return null;
  }
}

const EMPTY_GRAPH: ProjectGraph = {
  files: [],
  symbols: [],
  components: [],
  routes: [],
  imports: {},
  dependencies: [],
  references: {},
};

/** Save a WorkspaceMemory snapshot to Firestore. Best-effort — never throws. Retries a TRANSIENT
 *  write failure a few times (exponential backoff) so a brief Firestore hiccup at the end of a build
 *  doesn't silently drop the turn's memory (which would reset the plan / lose lessons next session). */
export async function saveWorkspaceMemory(
  workspaceId: string,
  snapshot: MemorySnapshot,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const payload = {
    workspaceId,
    graph: snapshot.graph,
    // Only persist the most recent episodes to stay within document size limits.
    episodes: snapshot.episodes.slice(-MAX_EPISODES),
    savedAt: Date.now(),
    version: 1,
  };
  const doc = db.collection(COLLECTION).doc(workspaceId);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await doc.set(payload, { merge: false });
      return; // persisted
    } catch (e) {
      // Transient failure (network / quota spike) — back off and retry; give up quietly after the
      // last attempt so a save failure never blocks or fails a build.
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  // All attempts failed — the workspace memory for this build is lost. Surface it (throttled) so a
  // persistence outage is visible instead of silently degrading every future reopen's context.
  notePersistenceFailure('workspace_memory', 'write', lastErr);
}

/** Load a WorkspaceMemory snapshot from Firestore. Returns null when absent or stale. Never throws. */
/**
 * GA-1 — delete a workspace's persisted memory doc (so a deleted project leaves no orphaned memory).
 * Best-effort; never throws; no-op under VITEST / when Firestore is unavailable.
 */
export async function deleteWorkspaceMemory(workspaceId: string): Promise<void> {
  const db = getDb();
  if (!db || !workspaceId) return;
  try {
    await db.collection(COLLECTION).doc(workspaceId).delete();
  } catch (e) {
    notePersistenceFailure('workspace_memory', 'write', e);
  }
}

export async function loadWorkspaceMemory(
  workspaceId: string,
): Promise<MemorySnapshot | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data) return null;
    // Reject snapshots older than 30 days (stale — the user's project may have changed).
    if (typeof data.savedAt === 'number' && Date.now() - data.savedAt > MAX_AGE_MS) return null;
    const graph: ProjectGraph = {
      ...EMPTY_GRAPH,
      ...(data.graph ?? {}),
    };
    const episodes: Episode[] = Array.isArray(data.episodes) ? data.episodes : [];
    return { graph, episodes };
  } catch {
    return null;
  }
}

/**
 * Restore a previously-persisted MemorySnapshot into a live WorkspaceMemory.
 * Replays the graph by calling indexFile for each file with a placeholder so
 * the fileFacts map is warm — then returns the restored snapshot for awareness.
 * Returns null if no snapshot exists. Never throws.
 */
export async function restoreWorkspaceMemory(
  workspaceId: string,
  mem: import('./WorkspaceMemory').WorkspaceMemory,
): Promise<MemorySnapshot | null> {
  // IDEMPOTENT: replay durable episodes into a given live memory object AT MOST ONCE, so calling
  // restore on multiple paths (e.g. an intent-time hydrate + the build path) can't duplicate them.
  // Marked before the load so a null snapshot still counts as "reconciled" (the in-process memory is
  // then the source of truth); the flag resets when the 2h-TTL cache evicts + recreates the object.
  if (mem.isHydrated()) return null;
  mem.markHydrated();
  const snapshot = await loadWorkspaceMemory(workspaceId);
  if (!snapshot) return null;
  try {
    // Replay episodes into the live memory object — PRESERVING each episode's original timestamp so
    // recency ranking stays honest across a restore (re-stamping to now() made old lessons look fresh).
    for (const ep of snapshot.episodes) {
      if (ep.kind === 'error') mem.recordError(ep.text, ep.file, ep.ts);
      else if (ep.kind === 'fix') mem.recordFix(ep.text, ep.file, ep.ts);
      else if (ep.kind === 'note') mem.recordNote(ep.text, ep.file, ep.ts);
      else if (ep.kind === 'request') mem.recordRequest(ep.text, ep.ts);
    }
    // Mark the known files as indexed (content empty — warmIndexFiles will fill them later).
    // This populates the graph.files set so warmIndexFiles skips already-known files.
    for (const file of snapshot.graph.files) {
      if (!mem.graph().files.includes(file)) {
        // Minimal stub so the file shows up in the graph; warmIndexFiles overwrites it.
        mem.indexFile(file, '/* restored */');
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}
