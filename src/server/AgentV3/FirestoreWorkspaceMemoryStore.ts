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
import { RESTORED_STUB } from './WorkspaceMemory';
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
/**
 * ⚠️ THE RAW WRITE — `{ merge: false }`, so it REPLACES the workspace's durable memory outright.
 *
 * Prefer `saveWorkspaceMemoryFor(workspaceId, mem)`: it hydrates first and refuses to write a memory
 * whose durable read could not be confirmed. Calling this one directly with an un-hydrated snapshot
 * deletes every earlier episode and the whole persisted project graph — which is exactly what one
 * chat lane did, under a comment saying it did the opposite.
 */
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

/**
 * The load, with the ONE distinction `loadWorkspaceMemory` throws away: did we READ the durable
 * document, or merely fail to?
 *
 * 🔴 WHY IT MATTERS (2026-09-17). `loadWorkspaceMemory` answers `null` for BOTH "there is no
 * snapshot" and "the read failed", and `saveWorkspaceMemory` writes with `{ merge: false }`. So a
 * caller that loads, gets null from a transient Firestore blip, and then saves, does not "start
 * fresh" — it DELETES the workspace's entire episode history and project graph, including the
 * `PLAN_STATE` note a "continue" reads back to resume an unfinished plan.
 *
 * `ok: false` means only "we do not know". It is never a licence to overwrite.
 */
export async function loadWorkspaceMemoryResult(
  workspaceId: string,
): Promise<{ ok: true; snapshot: MemorySnapshot | null } | { ok: false }> {
  const db = getDb();
  // No Firestore configured at all (tests, local dev) is a KNOWN state, not a failed read: there is
  // no durable document and nothing a save could destroy.
  if (!db) return { ok: true, snapshot: null };
  try {
    const snap = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!snap.exists) return { ok: true, snapshot: null };
    const data = snap.data();
    if (!data) return { ok: true, snapshot: null };
    // Stale (see MAX_AGE_MS) — read successfully, deliberately not used.
    if (typeof data.savedAt === 'number' && Date.now() - data.savedAt > MAX_AGE_MS) {
      return { ok: true, snapshot: null };
    }
    return {
      ok: true,
      snapshot: {
        graph: { ...EMPTY_GRAPH, ...(data.graph ?? {}) },
        episodes: Array.isArray(data.episodes) ? data.episodes : [],
      },
    };
  } catch (e) {
    notePersistenceFailure('workspace_memory', 'read', e);
    return { ok: false };
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
 * PERSIST A LIVE MEMORY SAFELY — hydrate first, and never overwrite history we could not read.
 *
 * 🔴 THE DEFECT THIS CLOSES (2026-09-17). The Planner/Advisor role-chat lane did exactly this:
 *
 *     const mem = getWorkspaceMemory(roleWorkspaceId);
 *     mem.recordRequest(prompt);
 *     void saveWorkspaceMemory(roleWorkspaceId, mem.snapshot());
 *
 * …under a comment claiming it persisted *"exactly like the plain-chat lane"*. The plain-chat lane
 * has one more line, and its comment says why: *"ensure durable episodes are loaded first"*. On a
 * COLD instance — after every deploy, and after any 2-hour cache eviction — `getWorkspaceMemory`
 * returns an EMPTY object, `recordRequest` gives it exactly one episode, and the save writes that
 * over the durable document with `{ merge: false }`. One Planner chat turn therefore destroyed the
 * workspace's whole episode history AND its persisted project graph, including the `PLAN_STATE` note
 * a "continue" reads back to resume an unfinished plan.
 *
 * 🔑 FIXED AS A CLASS, NOT AT THAT CALL SITE. A rule written into one caller is a rule the next
 * caller never hears about — which is precisely how this one arrived, by copying a lane and dropping
 * a line. Every writer now goes through here, so "save without hydrating" cannot be expressed.
 *
 * Returns what it did, so a caller can log honestly rather than assume it saved. Never throws.
 */
export async function saveWorkspaceMemoryFor(
  workspaceId: string,
  mem: import('./WorkspaceMemory').WorkspaceMemory,
): Promise<'saved' | 'skipped-unconfirmed'> {
  try {
    if (!mem.isHydrationConfirmed()) await restoreWorkspaceMemory(workspaceId, mem);
  } catch { /* restore is best-effort; the check below is what decides */ }
  // 🔒 STILL UNCONFIRMED ⇒ DO NOT WRITE. Losing one turn's episode is strictly better than deleting
  // every earlier one, and the next turn on a healthy instance persists it anyway. This also covers
  // the case a timeout race leaves behind: `markHydrated` may be set while the read never landed.
  if (!mem.isHydrationConfirmed()) return 'skipped-unconfirmed';
  await saveWorkspaceMemory(workspaceId, mem.snapshot());
  return 'saved';
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
  // ⚠️ `markHydrated` above is the RE-ENTRANCY guard and is deliberately set BEFORE the read, so two
  // concurrent restores cannot replay the same episodes twice. It is NOT an answer to "do I hold the
  // durable history?" — see `WorkspaceMemory._hydrationConfirmed`, which only a genuine read sets.
  const result = await loadWorkspaceMemoryResult(workspaceId);
  if (!result.ok) return null;          // could not read — a writer must NOT overwrite on this
  mem.markHydrationConfirmed();         // read succeeded; an ABSENT document is a real answer too
  const snapshot = result.snapshot;
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
    // ⚠️ THE TWO SENTENCES THAT USED TO STAND HERE CONTRADICTED EACH OTHER, AND THE FALSE ONE IS THE
    // ⚠️ UPDATED 2026-09-18: the FIRST sentence is now the true one. These two comments used to
    // contradict each other — "warmIndexFiles will fill them later" beside "warmIndexFiles skips
    // already-known files" — and the code did the second, so a stub kept empty facts for the whole
    // build. `warmIndexFiles` now excludes restored stubs from `known`, so it really does fill them.
    // The original note is kept below because it records how the contradiction was found.
    // They read: "content empty — warmIndexFiles will fill them later"
    // and, immediately after, "This populates the graph.files set so warmIndexFiles skips
    // already-known files." `warmIndexFiles` built `known` from
    // `graph.files` and filters those out, so a file stubbed here KEEPS its empty facts — no
    // imports, no exports, no components, no routes — for the whole build.
    //
    // 🔴 That is open root cause #2 (hollow graph on cold resume), left OPEN on purpose: filling it
    // moves a real build's verdict in both directions and which one dominates has never been
    // measured. `RESTORED_STUB` + `restoredStubPaths()` are that measurement. Do NOT "fix" the stub
    // here without reading `WorkspaceMemory.restoredStubs`' own comment first.
    for (const file of snapshot.graph.files) {
      if (!mem.graph().files.includes(file)) {
        mem.indexFile(file, RESTORED_STUB);
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}
