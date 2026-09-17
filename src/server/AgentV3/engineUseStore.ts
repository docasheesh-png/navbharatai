// WHICH AI ENGINES ACTUALLY SERVED SOMETHING TODAY — the fact the admin panel could not answer.
//
// 🔴 WHY THIS HAD TO BE BUILT RATHER THAN READ (admin 2026-09-17: *"ai engine wale page ko bhi update
// karo, woh fake hai abhi"*). They were right, and the reason is written in the admin route's own
// comment: every AI number there comes from `ai_usage_logs`, **which is written by the CHAT route
// only**. AgentV3 BUILDS — where nearly all engine work happens — never touch that collection. So the
// AI Engines page showed chat providers and called them the platform's engines, and a badge built on
// the same source would have inherited the same false picture.
//
// This is the missing half: one row per DAY, holding which engines delivered and how often, written
// from the build path where the delivery is already known (`providerTurns` / `dominantProvider`).
//
// 🔑 PATTERNED ON `agentv3_sandbox_starts`, DELIBERATELY. That counter answers "why did machines start
// today?" with the same shape — a doc per day, `FieldValue.increment` per key — so this adds no new
// idea to the codebase and inherits a storage pattern already proven in production. A per-CALL row
// would be a second `ai_usage_logs` (unbounded, and the thing whose cost this panel exists to watch);
// a per-day counter is one small document however many builds run.
//
// 🔒 AN OBSERVATION MUST NEVER BLOCK A BUILD. Every write is best-effort and swallowed, exactly like
// the sandbox counter it mirrors. A failed write costs one day's badge accuracy; a thrown write would
// cost a user their app.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

export const ENGINE_USE_COLLECTION = 'agentv3_engine_use';

/** UTC day key. The SERVER's clock, never a device's — the same rule the wallet rollup follows. */
export function engineUseDayKey(atMs: number = Date.now()): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/**
 * Normalise an engine name for counting. PURE.
 *
 * A key pool reports `GLM`, `GLM#2`, `GLM#17` — one vendor, fifty keys. Counting those as fifty
 * engines would make "engines used today" a measure of our key list rather than of our ladder, and the
 * number the admin reads would jump the day somebody buys more keys. The `#n` suffix is dropped and
 * the FAMILY is what gets counted.
 */
export function engineKey(provider: string | null | undefined): string | null {
  const raw = String(provider ?? '').trim().toUpperCase();
  if (!raw) return null;
  const family = raw.split('#')[0].trim();
  return family || null;
}

/**
 * Record that these engines served something today. Best-effort; never throws.
 *
 * `counts` is keyed by engine FAMILY, so one build that made 30 GLM calls contributes 30 to GLM and
 * nothing to anyone else — which keeps "how much did this engine do" answerable later without a
 * per-call row.
 */
export async function recordEngineUse(
  turns: ReadonlyMap<string, number> | Record<string, number> | null | undefined,
  atMs: number = Date.now(),
): Promise<void> {
  const entries = turns instanceof Map ? [...turns.entries()] : Object.entries(turns ?? {});
  if (entries.length === 0) return;
  const counts: Record<string, unknown> = {};
  let any = false;
  for (const [name, n] of entries) {
    const key = engineKey(name);
    const calls = Number(n);
    if (!key || !Number.isFinite(calls) || calls <= 0) continue;
    counts[key] = admin.firestore.FieldValue.increment(calls);
    any = true;
  }
  if (!any) return;
  try {
    const db = getServerDb();
    if (!db) return;
    const day = engineUseDayKey(atMs);
    await db.collection(ENGINE_USE_COLLECTION).doc(day).set({ day, counts }, { merge: true });
  } catch { /* an observation must never block a build */ }
}

/**
 * The engines that served something on a given day, with their call counts.
 *
 * Returns `null` — NOT an empty object — when the day cannot be read. The caller must be able to tell
 * "nothing ran" from "we could not look", because the badge above it renders a number for the first
 * and nothing at all for the second.
 */
export async function readEngineUse(
  day: string = engineUseDayKey(),
): Promise<Record<string, number> | null> {
  try {
    const db = getServerDb();
    if (!db) return null;
    const snap = await db.collection(ENGINE_USE_COLLECTION).doc(day).get();
    if (!snap.exists) return {};
    const counts = (snap.data() || {}).counts;
    if (!counts || typeof counts !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return null;
  }
}
