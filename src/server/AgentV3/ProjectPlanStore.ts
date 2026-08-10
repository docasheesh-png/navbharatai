// AgentV3 — Software Project Mode: durable persistence for the module plan.
//
// A 5000-file project builds across MANY turns, hours, reloads, and Cloud Run instance
// rotations — the plan is the project's spine, so it must survive all of them. A workspace-memory
// note is NOT good enough here: the durable memory snapshot caps episodes at 100, and a mega-build
// records far more than 100 episodes per session, which would silently evict the plan. So the plan
// gets its own document, one per workspace, in its own collection.
//
// Pattern: identical to FirestoreWorkspaceMemoryStore (firebase-admin, best-effort, VITEST-skip,
// bounded retries, never throws), PLUS the #873 lesson applied up front: `_db` is cached BEFORE
// settings() is called, and a settings() throw (another store already configured the same shared
// Firestore instance — every store passes the same firestoreDatabaseId()) is survivable, not
// disabling. An in-process cache fronts Firestore so the every-turn read in a long build is free.

import * as admin from 'firebase-admin';
import type { ProjectPlan } from './ProjectPlan';
import { serializeProjectPlan, parseStoredProjectPlan } from './ProjectPlan';
import { getServerDb } from '../lib/serverDb';
import { notePersistenceFailure } from '../lib/persistenceHealth';

const COLLECTION = 'project_plans_v3';
/** Plans older than this are stale — the project has moved on without them. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days: mega-projects legitimately span weeks
/** In-process cache TTL — long enough to cover a build session, short enough to stay fresh. */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    // Collision-free shared admin handle (getFirestore(app, dbId)) — no per-store .settings() race.
    _db = getServerDb();
    return _db;
  } catch (e) {
    notePersistenceFailure('project_plan', 'init', e);
    return null;
  }
}

interface CacheEntry {
  plan: ProjectPlan | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();

function pruneCache(): void {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
}

/**
 * Persist the plan (cache + Firestore, write-through). Best-effort with bounded retries — a save
 * failure never blocks a build, but IS surfaced via persistence health so an outage can't silently
 * strand a mega-project's progress. The in-process cache is updated FIRST so the same instance
 * keeps working even through a Firestore outage.
 */
export async function saveProjectPlan(workspaceId: string, plan: ProjectPlan): Promise<void> {
  pruneCache();
  cache.set(workspaceId, { plan, at: Date.now() });
  const db = getDb();
  if (!db) return;
  const payload = { workspaceId, plan: serializeProjectPlan(plan), savedAt: Date.now(), version: 1 };
  const doc = db.collection(COLLECTION).doc(workspaceId);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await doc.set(payload, { merge: false });
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  notePersistenceFailure('project_plan', 'write', lastErr);
}

/**
 * Load the plan for a workspace: in-process cache first, then Firestore. Returns null when there
 * is no (valid, fresh) plan — corrupt or stale storage parses to null rather than a half-plan
 * (parseStoredProjectPlan is strict), so scheduling can never run on garbage. Never throws.
 */
export async function loadProjectPlan(workspaceId: string): Promise<ProjectPlan | null> {
  pruneCache();
  const hit = cache.get(workspaceId);
  if (hit) return hit.plan;
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(COLLECTION).doc(workspaceId).get();
    const data = snap.exists ? snap.data() : null;
    let plan: ProjectPlan | null = null;
    if (data && typeof data.plan === 'string' && !(typeof data.savedAt === 'number' && Date.now() - data.savedAt > MAX_AGE_MS)) {
      plan = parseStoredProjectPlan(data.plan);
    }
    cache.set(workspaceId, { plan, at: Date.now() });
    return plan;
  } catch {
    // Do NOT cache a read failure — the next call should retry Firestore.
    return null;
  }
}

/** Remove a workspace's plan (e.g. the user abandoned the project / re-planned). Never throws. */
export async function deleteProjectPlan(workspaceId: string): Promise<void> {
  cache.delete(workspaceId);
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).doc(workspaceId).delete();
  } catch (e) {
    notePersistenceFailure('project_plan', 'write', e);
  }
}

/** Test-only: reset the in-process cache between unit tests. */
export function __clearProjectPlanCacheForTests(): void {
  cache.clear();
}
