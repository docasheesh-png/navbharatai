// AgentV3 — Durable git CHECKPOINT history (Phase G1 of the "one body, many organs" rebuild).
//
// v5.0 builds make REAL git commits in the sandbox (GitManager.checkpoint → { id, sha, message, ts }),
// but those commits live ONLY in the ephemeral sandbox + the client's session RAM. When the sandbox is
// recycled or the user returns in a new session / on another device, the checkpoint history is gone —
// so "git" was not yet a persistent organ of the workspace body.
//
// This store persists each checkpoint's metadata to Firestore, keyed by workspaceId, so the timeline
// survives sandbox death and is the SAME across sessions and devices (exactly what WorkspaceFileStore
// did for file content). One doc per commit SHA → natural dedup, no read-modify-write races.
//
// Pattern mirrors WorkspaceFileStore: firebase-admin, VITEST-skip, best-effort, never throws.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

const COLLECTION = 'workspace_checkpoints_v3';
/** Cap how many checkpoints we return (newest first) so a long-lived project stays cheap to load. */
const MAX_RETURN = 200;

/** A durable git checkpoint record. Matches the client GitCheckpoint shape (agentV3Types.ts). */
export interface DurableCheckpoint {
  id: string;
  sha: string;
  message: string;
  ts: number;
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

/** The 'dormant but valid' git status the UI shows when the live sandbox is cold (recycled). */
export interface DormantGitStatus {
  available: true;
  live: false;
  clean: true;
  changed: 0;
  head: string;
  lastCommit: string;
}

/**
 * Build a DORMANT-but-valid git status from durable checkpoints (newest-first) for a workspace whose
 * sandbox has recycled — so the History panel shows the last-known working tree ("Last saved … on
 * <sha>") instead of the scary "not active in this session" dead-end. Returns null when there is no
 * durable history at all (then the caller keeps the honest "not available"). Pure + exported for tests.
 */
export function dormantGitStatusFromCheckpoints(cps: DurableCheckpoint[] | null | undefined): DormantGitStatus | null {
  if (!cps || cps.length === 0) return null;
  const newest = cps[0]; // loadCheckpoints returns newest-first
  return { available: true, live: false, clean: true, changed: 0, head: (newest.sha || '').slice(0, 7), lastCommit: newest.message || '' };
}

/** Deterministic, Firestore-safe doc id for a checkpoint (prefer the commit SHA; fall back to its id). */
export function checkpointDocId(cp: { sha?: string; id?: string }): string {
  const raw = (cp.sha || cp.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return raw.slice(0, 200) || `cp_${Math.abs(hashString(JSON.stringify(cp)))}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Pure: newest-first, deduped by sha (falling back to id). Used by the store and the client merge. */
export function sortDedupeCheckpoints(list: DurableCheckpoint[]): DurableCheckpoint[] {
  const seen = new Set<string>();
  const out: DurableCheckpoint[] = [];
  for (const c of [...(list || [])].sort((a, b) => (b?.ts || 0) - (a?.ts || 0))) {
    if (!c || (typeof c.sha !== 'string' && typeof c.id !== 'string')) continue;
    const key = c.sha || c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Validate + normalise a raw checkpoint into a DurableCheckpoint, or null if it isn't usable. Pure. */
export function normalizeCheckpoint(raw: unknown): DurableCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const sha = typeof c.sha === 'string' ? c.sha : '';
  const id = typeof c.id === 'string' ? c.id : '';
  if (!sha && !id) return null;
  return {
    id: id || `cp_${sha.slice(0, 12)}`,
    sha,
    message: typeof c.message === 'string' ? c.message.slice(0, 300) : '',
    ts: typeof c.ts === 'number' && c.ts > 0 ? c.ts : Date.now(),
  };
}

/** Persist a single checkpoint (idempotent by SHA). Best-effort — never throws, never blocks a build. */
export async function saveCheckpoint(workspaceId: string, raw: unknown): Promise<void> {
  const cp = normalizeCheckpoint(raw);
  if (!workspaceId || !cp) return;
  const db = getDb();
  if (!db) return;
  try {
    await db
      .collection(COLLECTION)
      .doc(workspaceId)
      .collection('items')
      .doc(checkpointDocId(cp))
      .set(cp, { merge: true });
  } catch {
    /* best-effort — a persist failure never blocks anything */
  }
}

/** Load the durable checkpoint history for a workspace, newest first (capped). Never throws. */
export async function loadCheckpoints(workspaceId: string): Promise<DurableCheckpoint[]> {
  if (!workspaceId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(COLLECTION)
      .doc(workspaceId)
      .collection('items')
      .orderBy('ts', 'desc')
      .limit(MAX_RETURN)
      .get();
    const out: DurableCheckpoint[] = [];
    for (const d of snap.docs) {
      const cp = normalizeCheckpoint(d.data());
      if (cp) out.push(cp);
    }
    return sortDedupeCheckpoints(out);
  } catch {
    return [];
  }
}
