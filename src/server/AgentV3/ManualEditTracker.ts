// AgentV3 — Manual IDE edit tracker (Phase S2 of the "one body, many organs" rebuild).
//
// Google-AI-Studio behaviour: when the user manually edits files in Code Studio, the NEXT v5.0
// chat turn must KNOW about it and acknowledge it ("I noticed you changed N files…"), then build on
// top of those edits instead of being blind to them.
//
// The import-files route records IDE edits here (source: 'ide-edit'); the build context assembly
// CONSUMES them (reads + clears) and injects a note into the architect system prompt. Because the
// record and the consume happen in SEPARATE HTTP requests — possibly on different Cloud Run
// instances — the pending set must be DURABLE, not just in-memory. So this is Firestore-backed
// (best-effort) with an in-memory cache for same-instance speed.
//
// Pattern mirrors WorkspaceFileStore: firebase-admin, VITEST-skip, best-effort, never throws.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

const COLLECTION = 'workspace_manual_edits_v3';
/** Cap the stored pending path set so a runaway sync can never grow the doc without bound. */
const MAX_PENDING_PATHS = 300;
/** How many paths to actually name in the prompt note before summarising the rest. */
const MAX_NAMED_IN_NOTE = 20;

export interface PendingManualEdits {
  paths: string[];
  count: number;
  at: number;
}

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

// Same-instance cache so the common case (record + consume on one instance) never needs a read.
const _cache = new Map<string, Set<string>>();
const _cacheAt = new Map<string, number>();

/** Record that the user MANUALLY edited these files in the IDE since the last build. Best-effort, never throws. */
export async function recordManualEdits(workspaceId: string, paths: string[], at: number): Promise<void> {
  const clean = (paths || []).filter((p) => typeof p === 'string' && p);
  if (!workspaceId || clean.length === 0) return;
  // In-memory cache (capped).
  const set = _cache.get(workspaceId) ?? new Set<string>();
  for (const p of clean) { if (set.size >= MAX_PENDING_PATHS) break; set.add(p); }
  _cache.set(workspaceId, set);
  _cacheAt.set(workspaceId, at);
  // Durable (cross-instance) — arrayUnion is race-safe across concurrent edits.
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).doc(workspaceId).set(
      { paths: admin.firestore.FieldValue.arrayUnion(...clean.slice(0, MAX_PENDING_PATHS)), at },
      { merge: true },
    );
  } catch {
    /* best-effort — never blocks an import */
  }
}

/** Read the pending manual edits WITHOUT clearing them (status/preview). Never throws. */
export async function peekManualEdits(workspaceId: string): Promise<PendingManualEdits> {
  if (!workspaceId) return { paths: [], count: 0, at: 0 };
  const db = getDb();
  if (!db) {
    const set = _cache.get(workspaceId);
    const paths = set ? Array.from(set) : [];
    return { paths, count: paths.length, at: _cacheAt.get(workspaceId) ?? 0 };
  }
  try {
    const snap = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!snap.exists) return { paths: [], count: 0, at: 0 };
    const data = snap.data() || {};
    const paths: string[] = Array.isArray(data.paths) ? data.paths.filter((p: unknown) => typeof p === 'string' && p) : [];
    return { paths, count: paths.length, at: typeof data.at === 'number' ? data.at : 0 };
  } catch {
    return { paths: [], count: 0, at: 0 };
  }
}

/** Read AND clear the pending manual edits (called when a build consumes them). Never throws. */
export async function consumeManualEdits(workspaceId: string): Promise<PendingManualEdits> {
  const result = await peekManualEdits(workspaceId);
  _cache.delete(workspaceId);
  _cacheAt.delete(workspaceId);
  const db = getDb();
  if (!db || result.count === 0) return result;
  try {
    // Clear the pending set (keep the doc light) so the SAME edits aren't re-announced next build.
    await db.collection(COLLECTION).doc(workspaceId).set({ paths: [], at: 0 }, { merge: true });
  } catch {
    /* best-effort */
  }
  return result;
}

/**
 * Pure: build the architect-prompt note that tells the agent the user manually edited these files in
 * the IDE since the last build. Returns '' when there is nothing to announce, so callers can prepend
 * it unconditionally. Names up to MAX_NAMED_IN_NOTE paths, then summarises the remainder.
 */
export function manualEditContext(paths: string[]): string {
  const clean = (paths || []).filter((p) => typeof p === 'string' && p);
  if (clean.length === 0) return '';
  const named = clean.slice(0, MAX_NAMED_IN_NOTE);
  const more = clean.length - named.length;
  const list = named.map((p) => `  • ${p}`).join('\n') + (more > 0 ? `\n  • …and ${more} more` : '');
  return [
    '## USER EDITED FILES IN THE IDE SINCE YOUR LAST BUILD',
    `The user manually changed ${clean.length} file${clean.length === 1 ? '' : 's'} in Code Studio after your last turn:`,
    list,
    'These edits are ALREADY SAVED and are the current source of truth. Read them before changing anything,',
    'respect the user\'s changes, and build ON TOP of them — do NOT overwrite or revert them.',
  ].join('\n');
}

/** Pure: the short, user-facing chat line acknowledging manual IDE edits (Google-AI-Studio style). */
export function manualEditNarration(count: number): string {
  return `📝 I noticed you manually edited ${count} file${count === 1 ? '' : 's'} in the IDE since my last build — I've read your changes and will build on top of them.`;
}
