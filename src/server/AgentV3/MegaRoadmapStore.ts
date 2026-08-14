// AgentV3 — Mega-app roadmap: durable per-workspace persistence.
//
// When NavBharatAI recognises a MEGA app (Phase 1 scope pre-screen) and builds an honest step-by-step
// roadmap (Phase 2), that roadmap is the spine of a multi-session journey — the user builds step 1 today,
// comes back tomorrow and taps "next step". So it must survive reloads and Cloud Run instance rotations,
// exactly like the project plan. This store mirrors ProjectPlanStore.ts (firebase-admin, best-effort,
// VITEST-skip, bounded retries, in-process cache, never throws) with its own collection.

import * as admin from 'firebase-admin';
import type { MegaRoadmap } from '../lib/megaRoadmap';
import { getServerDb } from '../lib/serverDb';
import { notePersistenceFailure } from '../lib/persistenceHealth';

const COLLECTION = 'mega_roadmaps_v3';
/** A roadmap the user has not advanced in this long is stale (they moved on). */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — a multi-step app journey can legitimately span weeks
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** The durable record: the guardrailed roadmap plus how far the user has progressed. */
export interface StoredMegaRoadmap {
  roadmap: MegaRoadmap;
  /** 1-based index of the NEXT step to build (1 = only the first checkpoint is under way / done). */
  currentStep: number;
  /** The original user request that produced this roadmap (kept for context / debugging). */
  sourcePrompt: string;
  createdAt: number;
  updatedAt: number;
}

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    _db = getServerDb();
    return _db;
  } catch (e) {
    notePersistenceFailure('mega_roadmap', 'init', e);
    return null;
  }
}

interface CacheEntry { record: StoredMegaRoadmap | null; at: number }
const cache = new Map<string, CacheEntry>();

function pruneCache(): void {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
}

/** Strict parse of a stored JSON blob → a StoredMegaRoadmap, or null if it is corrupt/incomplete. */
export function parseStoredMegaRoadmap(raw: unknown): StoredMegaRoadmap | null {
  if (typeof raw !== 'string' || !raw) return null;
  let o: any;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const r = o.roadmap;
  if (!r || typeof r !== 'object' || !Array.isArray(r.steps) || r.steps.length === 0) return null;
  // Every step must carry the required shape (a half-written step is not a roadmap).
  for (const s of r.steps) {
    if (!s || typeof s.title !== 'string' || typeof s.goal !== 'string' || typeof s.buildPrompt !== 'string') return null;
  }
  const roadmap: MegaRoadmap = {
    famousApp: typeof r.famousApp === 'string' ? r.famousApp : null,
    userMessage: typeof r.userMessage === 'string' ? r.userMessage : '',
    achievableSummary: typeof r.achievableSummary === 'string' ? r.achievableSummary : '',
    note: typeof r.note === 'string' ? r.note : null,
    steps: r.steps.map((s: any, i: number) => ({
      n: typeof s.n === 'number' ? s.n : i + 1,
      title: s.title,
      goal: s.goal,
      buildPrompt: s.buildPrompt,
      infraCeiling: !!s.infraCeiling,
    })),
  };
  const currentStep = typeof o.currentStep === 'number' && o.currentStep >= 1 ? Math.floor(o.currentStep) : 1;
  return {
    roadmap,
    currentStep,
    sourcePrompt: typeof o.sourcePrompt === 'string' ? o.sourcePrompt : '',
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
  };
}

/** Persist a workspace's roadmap (cache + Firestore, write-through). Best-effort; never blocks a build. */
export async function saveMegaRoadmap(workspaceId: string, record: StoredMegaRoadmap): Promise<void> {
  pruneCache();
  cache.set(workspaceId, { record, at: Date.now() });
  const db = getDb();
  if (!db) return;
  const payload = { workspaceId, record: JSON.stringify(record), savedAt: Date.now(), version: 1 };
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
  notePersistenceFailure('mega_roadmap', 'write', lastErr);
}

/** Load a workspace's roadmap: cache first, then Firestore. Null when there is no fresh valid roadmap. */
export async function loadMegaRoadmap(workspaceId: string): Promise<StoredMegaRoadmap | null> {
  pruneCache();
  const hit = cache.get(workspaceId);
  if (hit) return hit.record;
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(COLLECTION).doc(workspaceId).get();
    const data = snap.exists ? snap.data() : null;
    let record: StoredMegaRoadmap | null = null;
    if (data && typeof data.record === 'string' && !(typeof data.savedAt === 'number' && Date.now() - data.savedAt > MAX_AGE_MS)) {
      record = parseStoredMegaRoadmap(data.record);
    }
    cache.set(workspaceId, { record, at: Date.now() });
    return record;
  } catch {
    return null;
  }
}

/** Remove a workspace's roadmap (user abandoned it / finished the journey). Never throws. */
export async function deleteMegaRoadmap(workspaceId: string): Promise<void> {
  cache.delete(workspaceId);
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).doc(workspaceId).delete();
  } catch (e) {
    notePersistenceFailure('mega_roadmap', 'write', e);
  }
}

/** Test-only: reset the in-process cache between unit tests. */
export function __clearMegaRoadmapCacheForTests(): void {
  cache.clear();
}
