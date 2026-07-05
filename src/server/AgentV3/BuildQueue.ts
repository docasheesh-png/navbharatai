// AgentV3 — durable per-app command QUEUE (admin's 3-role model, FIX #4).
//
// The model: ONE serial EXECUTOR per app (Chat 1 "Main build") drains a queue of commands one at a
// time — so the same app's files are never written by two builds at once (safety by construction). The
// read-only advisor chats (Chat 2 "Planner", Chat 3 "Auditor/…") never write; they ENQUEUE commands
// here for the executor to run. A user can queue 10+ approved steps (a roadmap) and they execute in
// order, hands-free, while the advisor chats keep planning/auditing concurrently.
//
// This module is the PURE state machine for that queue (enqueue / claim-next / complete / cancel /
// reorder), fully unit-testable. The durable store + the route executor wire on top of it.

export type QueueItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export type QueueItemSource = 'user' | 'planner' | 'advisor';

export interface QueueItem {
  /** Stable id (caller-supplied — deterministic, so this stays pure/replayable). */
  id: string;
  prompt: string;
  source: QueueItemSource;
  status: QueueItemStatus;
  createdTs: number;
  /** Set when a step ends: a short honest note (e.g. a failure reason). */
  note?: string;
}

export interface CommandQueue {
  workspaceId: string;
  items: QueueItem[];
}

/** Max pending commands a single app's queue may hold (bounds runaway roadmaps + cost). */
export const MAX_QUEUE_ITEMS = 25;

export function emptyQueue(workspaceId: string): CommandQueue {
  return { workspaceId, items: [] };
}

/** A pure clone so operations never mutate the caller's state (durable store reads stay intact). */
function clone(q: CommandQueue): CommandQueue {
  return { workspaceId: q.workspaceId, items: q.items.map((i) => ({ ...i })) };
}

export function pendingItems(q: CommandQueue): QueueItem[] {
  return q.items.filter((i) => i.status === 'pending');
}

/** Is a command currently executing for this app? (At most one — the serial executor invariant.) */
export function runningItem(q: CommandQueue): QueueItem | undefined {
  return q.items.find((i) => i.status === 'running');
}

export interface EnqueueResult {
  queue: CommandQueue;
  /** True when the item was added; false when rejected (blank prompt or the queue is full). */
  added: boolean;
  reason?: 'empty-prompt' | 'queue-full' | 'duplicate-id';
}

/** Append a command. Rejected (added:false) on a blank prompt, a full queue, or a duplicate id. Pure. */
export function enqueue(q: CommandQueue, item: { id: string; prompt: string; source: QueueItemSource; createdTs: number }): EnqueueResult {
  const prompt = (item.prompt || '').trim();
  if (!prompt) return { queue: q, added: false, reason: 'empty-prompt' };
  if (q.items.some((i) => i.id === item.id)) return { queue: q, added: false, reason: 'duplicate-id' };
  if (pendingItems(q).length >= MAX_QUEUE_ITEMS) return { queue: q, added: false, reason: 'queue-full' };
  const next = clone(q);
  next.items.push({ id: item.id, prompt, source: item.source, status: 'pending', createdTs: item.createdTs });
  return { queue: next, added: true };
}

export interface ClaimResult {
  queue: CommandQueue;
  /** The item that was moved to 'running', or null when nothing was claimable. */
  claimed: QueueItem | null;
}

/**
 * Claim the next command for execution: the OLDEST pending item becomes 'running'. Refuses (claimed:null)
 * when a command is already running (serial invariant — one writer per app) or nothing is pending. Pure.
 */
export function claimNext(q: CommandQueue): ClaimResult {
  if (runningItem(q)) return { queue: q, claimed: null };
  const idx = q.items.findIndex((i) => i.status === 'pending');
  if (idx === -1) return { queue: q, claimed: null };
  const next = clone(q);
  next.items[idx].status = 'running';
  return { queue: next, claimed: { ...next.items[idx] } };
}

/** Mark the currently-running command done or failed (with an honest note). No-op if none is running. */
export function completeRunning(q: CommandQueue, ok: boolean, note?: string): CommandQueue {
  const idx = q.items.findIndex((i) => i.status === 'running');
  if (idx === -1) return q;
  const next = clone(q);
  next.items[idx].status = ok ? 'done' : 'failed';
  if (note) next.items[idx].note = note;
  return next;
}

/** Cancel a PENDING item (a running one must be Stopped via the build, not cancelled here). Pure. */
export function cancelItem(q: CommandQueue, id: string): CommandQueue {
  const idx = q.items.findIndex((i) => i.id === id && i.status === 'pending');
  if (idx === -1) return q;
  const next = clone(q);
  next.items[idx].status = 'cancelled';
  return next;
}

/** Move a PENDING item to a new position AMONG the pending items (reorder the roadmap). Pure. */
export function reorderPending(q: CommandQueue, id: string, toPendingIndex: number): CommandQueue {
  const pending = pendingItems(q);
  const from = pending.findIndex((i) => i.id === id);
  if (from === -1) return q;
  const clamped = Math.max(0, Math.min(toPendingIndex, pending.length - 1));
  if (from === clamped) return q;
  // Reorder within the pending subsequence, preserving the positions of non-pending items.
  const reordered = pending.slice();
  const [moved] = reordered.splice(from, 1);
  reordered.splice(clamped, 0, moved);
  const next = clone(q);
  let p = 0;
  next.items = next.items.map((i) => (i.status === 'pending' ? reordered[p++] : i));
  return next;
}

/** A compact, honest summary for the queue UI / status line. */
export function queueSummary(q: CommandQueue): { pending: number; running: number; done: number; failed: number; cancelled: number } {
  const s = { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const i of q.items) s[i.status]++;
  return s;
}

// ── Durable serialization (strict — corrupt storage parses to an EMPTY queue, never a half-queue) ──

const STATUSES: QueueItemStatus[] = ['pending', 'running', 'done', 'failed', 'cancelled'];
const SOURCES: QueueItemSource[] = ['user', 'planner', 'advisor'];

export function serializeQueue(q: CommandQueue): string {
  return JSON.stringify({ workspaceId: q.workspaceId, items: q.items, version: 1 });
}

/**
 * Parse a stored queue for `workspaceId`. STRICT: any malformed item is dropped, and unparseable input
 * yields an empty queue — so the executor never runs on garbage. A stale 'running' item (an instance
 * died mid-build) is healed to 'failed' on load, so the serial slot is never permanently stuck.
 */
export function parseStoredQueue(workspaceId: string, raw: unknown): CommandQueue {
  let obj: unknown = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return emptyQueue(workspaceId); } }
  const items = (obj as { items?: unknown })?.items;
  if (!Array.isArray(items)) return emptyQueue(workspaceId);
  let sawRunning = false;
  const parsed: QueueItem[] = [];
  for (const it of items) {
    const o = it as Partial<QueueItem>;
    if (typeof o?.id !== 'string' || typeof o?.prompt !== 'string' || typeof o?.createdTs !== 'number') continue;
    if (!STATUSES.includes(o.status as QueueItemStatus)) continue;
    if (!SOURCES.includes(o.source as QueueItemSource)) continue;
    let status = o.status as QueueItemStatus;
    // A 'running' item from a prior (dead) instance can't still be executing here — heal it so the
    // single serial slot is free (the caller can re-enqueue). Only ONE running is ever valid anyway.
    if (status === 'running') { if (sawRunning) continue; sawRunning = true; status = 'failed'; }
    parsed.push({ id: o.id, prompt: o.prompt, source: o.source as QueueItemSource, status, createdTs: o.createdTs, ...(typeof o.note === 'string' ? { note: o.note } : {}) });
  }
  return { workspaceId, items: parsed };
}
