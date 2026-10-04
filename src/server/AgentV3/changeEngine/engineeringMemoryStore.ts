// CHANGE ENGINE — durable storage for an app's engineering memory (requirements, issues, change log).
//
// WHERE IT LIVES, AND WHY NOT INSIDE THE USER'S APP (audit 2026-10-04). One document per workspace in
// `app_engineering_memory_v1`, server-side only. A `.navbharat/` folder inside the app was considered and
// rejected on five concrete grounds: the GitHub sync runs `git add -A` and would push it into the user's
// repo; Green Freeze refuses post-latch writes to it; the model's own tools, an imported repo and Code
// Studio could all write it — an imported repo shipping its own ledger would be a prompt-injection channel
// straight into orchestration; the dev server serves any root file on the public preview URL; and every
// scanner over the app's files would read it as app code. Server-side, the user's app code and the
// builder's memory of it can never be confused.
//
// NOT `workspace_memory_v3`: that store replaces its whole document on save and keeps 100 episodes, so a
// requirement written there would be evicted by an ordinary busy build — the same reason
// ProjectPlanStore has its own collection.
//
// 🔒 SECURITY. Everything here is platform-authored except one field (a change's `summary`), and that is
// redacted of secrets, PII and provider names before it is written and capped at 160 chars. Labels come
// from the platform's own feature table, issue messages from the platform's own checks (also redacted),
// and nothing stored here is ever read back as an instruction — renderers frame it as context the current
// request outranks. The collection is erased with the rest of a user's workspaces (workspaceDataErase).
//
// Pattern: ProjectPlanStore — firebase-admin, best-effort, VITEST-skipped, bounded retries, in-process
// cache, never throws. Writes are TRANSACTIONAL read-modify-write, so two builds settling at once cannot
// erase each other's records.

import * as admin from 'firebase-admin';
import { getServerDb } from '../../lib/serverDb';
import { notePersistenceFailure } from '../../lib/persistenceHealth';
import { parseEngineeringMemory, emptyMemory, type EngineeringMemory } from './changeLog';

export const ENGINEERING_MEMORY_COLLECTION = 'app_engineering_memory_v1';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** Kill switch: `AGENTV3_CHANGE_ENGINE=off` stops every read, write and prompt block. Default ON. */
export function changeEngineEnabled(): boolean {
  return (process.env.AGENTV3_CHANGE_ENGINE || '').trim().toLowerCase() !== 'off';
}

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    _db = getServerDb();
    return _db;
  } catch (e) {
    notePersistenceFailure('engineering_memory', 'init', e);
    return null;
  }
}

const cache = new Map<string, { mem: EngineeringMemory; at: number }>();

function pruneCache(): void {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
}

/** Test seam: the in-process cache doubles as the store under VITEST (no Firestore there). */
export function __resetEngineeringMemoryCache(): void {
  cache.clear();
}

/** Load an app's memory. Empty memory on any failure — never a half-parsed one, never a throw. */
export async function loadEngineeringMemory(workspaceId: string): Promise<EngineeringMemory> {
  if (!workspaceId) return emptyMemory();
  pruneCache();
  const hit = cache.get(workspaceId);
  if (hit) return hit.mem;
  const db = getDb();
  if (!db) return emptyMemory();
  try {
    const snap = await db.collection(ENGINEERING_MEMORY_COLLECTION).doc(workspaceId).get();
    const mem = snap.exists ? parseEngineeringMemory(snap.data()) : emptyMemory();
    cache.set(workspaceId, { mem, at: Date.now() });
    return mem;
  } catch (e) {
    notePersistenceFailure('engineering_memory', 'read', e);
    return emptyMemory();
  }
}

/**
 * Read-modify-write the memory in one transaction. `fold` is pure and receives the CURRENT stored memory,
 * so a concurrent settle is folded in rather than overwritten. Returns the new memory, or null when the
 * write could not be made (the in-process cache still carries it, so this instance stays coherent).
 */
export async function updateEngineeringMemory(
  workspaceId: string,
  fold: (mem: EngineeringMemory) => EngineeringMemory,
): Promise<EngineeringMemory | null> {
  if (!workspaceId) return null;
  const db = getDb();
  if (!db) {
    // No Firestore (tests / outage at init): fold over the cache so the same instance stays coherent.
    const base = cache.get(workspaceId)?.mem ?? emptyMemory();
    const next = { ...fold(base), updatedAt: Date.now() };
    cache.set(workspaceId, { mem: next, at: Date.now() });
    return next;
  }
  const ref = db.collection(ENGINEERING_MEMORY_COLLECTION).doc(workspaceId);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const next = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? parseEngineeringMemory(snap.data()) : emptyMemory();
        const out = { ...fold(cur), updatedAt: Date.now() };
        tx.set(ref, { ...out, workspaceId });
        return out;
      });
      cache.set(workspaceId, { mem: next, at: Date.now() });
      return next;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  notePersistenceFailure('engineering_memory', 'write', lastErr);
  return null;
}
