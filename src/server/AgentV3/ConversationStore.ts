// AgentV3 — Conversation persistence (D7).
//
// A v3.0 build runs as a growing transcript inside AgentRunner (`messages`). That array
// lives only in memory for the duration of one request, so a dropped connection or a page
// refresh loses the whole build. ConversationStore makes the transcript DURABLE: each build
// is a ConversationRecord that is created when the build starts, appended to as the model
// takes turns, and finalized with its status/usage/billing when it ends — so the build can be
// reloaded (and later resumed) after a reconnect.
//
// Per design decision D7 (2026-06-25), persistence is NavBharatAI-hosted (there is no BYOK /
// "store it on the user's own Claude account" option). This module defines the storage
// CONTRACT plus an in-memory implementation used for dev/CI and as the reference for the
// Firestore-backed implementation that follows. PURE of any framework so it is fully testable.

import type { TurnUsage } from './ClaudeClient';

/** Lifecycle of a persisted build. Mirrors AgentRunResult.ok + the reason it stopped. */
export type ConversationStatus = 'running' | 'complete' | 'stopped' | 'error';

/** One persisted build: the verbatim transcript plus the metadata needed to resume/list it. */
export interface ConversationRecord {
  /** Stable id for this build/conversation (caller-supplied; e.g. the workspace/run id). */
  id: string;
  /** The owner — used to scope listByUser and to enforce access in the route layer. */
  userId: string;
  /** The sandbox/workspace this build runs in. */
  workspaceId: string;
  /** Short human label (typically derived from the first user prompt). */
  title: string;
  status: ConversationStatus;
  /** The AgentRunner transcript, stored VERBATIM so a resumed run sees its exact prior context. */
  messages: unknown[];
  /** Cumulative token usage across the build. */
  usage: TurnUsage;
  /** Amount billed to the user so far (D5/D6). */
  billedUsd: number;
  /** Epoch ms — set on create, never changed. */
  createdAt: number;
  /** Epoch ms — bumped on every mutation. */
  updatedAt: number;
  /**
   * Eternal sessions — the durable Claude-style evidence layer (compact TimelineEvent[] from
   * SessionTimeline). Replayed on reopen so a restored session shows the same action rows,
   * diffs and terminal output it showed live. Absent on records from before the feature.
   */
  timeline?: unknown[];
  /** Terminal facts of the last finished build turn (billing/tokens/build health). */
  finalState?: Record<string, unknown>;
  /** The framework this session builds with — restored so follow-up builds stay correct. */
  framework?: string;
}

/** Fields a caller provides to start a persisted build. */
export interface CreateConversationInput {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  /** The seed transcript (usually `[{ role: 'user', content: prompt }]`). Defaults to []. */
  messages?: unknown[];
  createdAt: number;
}

/** A partial finalize/update applied when appending turns or closing a build. */
export interface ConversationPatch {
  status?: ConversationStatus;
  usage?: TurnUsage;
  billedUsd?: number;
  updatedAt: number;
  /** Append these compact timeline events to the record's durable evidence layer. */
  timelineAppend?: unknown[];
  /** Replace the record's terminal facts (billing/tokens/build health) for the done-footer. */
  finalState?: Record<string, unknown>;
  /** Persist the session's framework so a reopened session's follow-up builds stay correct. */
  framework?: string;
}

/**
 * The persistence contract. Implementations must be safe to call concurrently for DIFFERENT
 * ids; a single build is driven by one runner, so per-id calls are naturally serialized.
 * Every method is async so a real backend (Firestore) drops in without signature changes.
 */
export interface ConversationStore {
  /** Create a new record. Throws if `id` already exists (a build id must be unique). */
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  /**
   * Fetch a record, or null if it does not exist. The timeline (evidence layer) is returned
   * ONLY when `opts.includeTimeline` is set — hot paths (existence probes, transcript recaps)
   * read conversations far more often than anything renders the timeline, and it can be large.
   */
  get(id: string, opts?: { includeTimeline?: boolean }): Promise<ConversationRecord | null>;
  /** Append transcript turns and apply a patch (usage/status/billing). Throws if id is unknown. */
  appendMessages(id: string, messages: unknown[], patch: ConversationPatch): Promise<void>;
  /** Apply a patch without appending messages (e.g. finalize status). Throws if id is unknown. */
  update(id: string, patch: ConversationPatch): Promise<void>;
  /**
   * A user's builds, most-recently-updated first, capped at `limit` (default 50). This is the
   * LIST view: implementations MAY return records with an empty `messages` array (the full
   * transcript is fetched on demand via `get(id)`) so listing stays cheap. The in-memory store
   * returns full records; the Firestore store omits the transcript here.
   */
  listByUser(userId: string, limit?: number): Promise<ConversationRecord[]>;
  /** Delete a build. No-op if it does not exist. */
  remove(id: string): Promise<void>;
}

/**
 * Cross-turn bound on a record's total timeline events (newest kept). The Firestore store bounds
 * the same growth by chunk count (MAX_TIMELINE_CHUNKS × ≤500 events/chunk ≈ this figure).
 */
export const MAX_TIMELINE_EVENTS_TOTAL = 20_000;

/**
 * SECURITY Phase 3.1 (admin-approved 2026-07-07) — the shared-anon sentinel is NEVER enumerable.
 * `listByUser` groups records by their stored `userId`; the literal `'anon'` bucket holds EVERY
 * identity-degraded session of EVERY user (Fix 26). Listing it (e.g. `?userId=anon` with no token)
 * would dump every user's workspaceIds/sessionIds — the "key" that unlocks the diagnostics/decision
 * IDORs. So both stores refuse to enumerate it. Anon records stay reachable ONLY by their exact
 * unguessable id via get() (Fix-26 restore is by-id, not by-list — so it is unaffected). Pure.
 */
export function isEnumerableUserId(userId: string | null | undefined): boolean {
  const id = (userId ?? '').trim();
  return id !== '' && id !== 'anon';
}

/** Deep-ish clone so stored records never alias a caller's mutable arrays/objects. */
function cloneRecord(rec: ConversationRecord): ConversationRecord {
  return {
    ...rec,
    messages: rec.messages.slice(),
    usage: { ...rec.usage },
    ...(rec.timeline ? { timeline: rec.timeline.slice() } : {}),
    ...(rec.finalState ? { finalState: { ...rec.finalState } } : {}),
  };
}

/**
 * Stamp a wall-clock timestamp onto persisted message copies (object messages only, never
 * overwriting an existing ts). The transcript is stored as Claude-API-shaped {role, content}
 * turns with no time — but a faithful reopen must interleave prose with the timeline's real
 * timestamps, so every message carries the epoch time of the write that persisted it. Mirrors
 * the Firestore store, which derives the same value from its per-turn `ts` field.
 */
export function stampMessageTs(messages: unknown[], ts: number): unknown[] {
  return messages.map((m) =>
    m && typeof m === 'object' && (m as { ts?: unknown }).ts === undefined ? { ...m, ts } : m,
  );
}

/**
 * In-memory ConversationStore — the dev/CI implementation and the reference semantics for the
 * Firestore-backed store. Stores cloned records so callers can never mutate persisted state by
 * holding a reference. Not durable across a process restart (that is what the Firestore backend
 * is for) — but exact in behaviour, so the wiring and tests are identical.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly records = new Map<string, ConversationRecord>();

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    if (this.records.has(input.id)) {
      throw new Error(`ConversationStore.create: id "${input.id}" already exists`);
    }
    const rec: ConversationRecord = {
      id: input.id,
      userId: input.userId,
      workspaceId: input.workspaceId,
      title: input.title,
      status: 'running',
      messages: stampMessageTs((input.messages ?? []).slice(), input.createdAt),
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      billedUsd: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.records.set(rec.id, cloneRecord(rec));
    return cloneRecord(rec);
  }

  async get(id: string, opts?: { includeTimeline?: boolean }): Promise<ConversationRecord | null> {
    const rec = this.records.get(id);
    if (!rec) return null;
    const clone = cloneRecord(rec);
    if (!opts?.includeTimeline) delete clone.timeline; // mirror the Firestore store's read shape
    return clone;
  }

  async appendMessages(id: string, messages: unknown[], patch: ConversationPatch): Promise<void> {
    const rec = this.mustGet(id);
    rec.messages = rec.messages.concat(stampMessageTs(messages, patch.updatedAt));
    this.applyPatch(rec, patch);
    this.records.set(id, rec);
  }

  async update(id: string, patch: ConversationPatch): Promise<void> {
    const rec = this.mustGet(id);
    this.applyPatch(rec, patch);
    this.records.set(id, rec);
  }

  async listByUser(userId: string, limit = 50): Promise<ConversationRecord[]> {
    if (!isEnumerableUserId(userId)) return []; // never enumerate the shared-anon bucket (Phase 3.1)
    return [...this.records.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, limit))
      .map(cloneRecord);
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }

  private mustGet(id: string): ConversationRecord {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`ConversationStore: unknown conversation id "${id}"`);
    return rec;
  }

  private applyPatch(rec: ConversationRecord, patch: ConversationPatch): void {
    if (patch.status !== undefined) rec.status = patch.status;
    if (patch.usage !== undefined) rec.usage = { ...patch.usage };
    if (patch.billedUsd !== undefined) rec.billedUsd = patch.billedUsd;
    if (patch.timelineAppend && patch.timelineAppend.length > 0) {
      rec.timeline = (rec.timeline ?? []).concat(patch.timelineAppend);
      // Cross-turn bound (mirrors the Firestore store's chunk cap): an eternal session must not
      // grow its evidence layer without limit — keep the newest events, drop the oldest.
      if (rec.timeline.length > MAX_TIMELINE_EVENTS_TOTAL) {
        rec.timeline = rec.timeline.slice(rec.timeline.length - MAX_TIMELINE_EVENTS_TOTAL);
      }
    }
    if (patch.finalState !== undefined) rec.finalState = { ...patch.finalState };
    if (patch.framework !== undefined) rec.framework = patch.framework;
    rec.updatedAt = patch.updatedAt;
  }
}

/** Derive a short, clean title from the first user prompt (for the build list). */
export function deriveTitle(prompt: string, max = 80): string {
  const oneLine = (prompt || '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'Untitled build';
  return oneLine.length > max ? oneLine.slice(0, max - 1).trimEnd() + '…' : oneLine;
}

/**
 * UPSERT one chat turn onto a conversation with a STABLE per-session id: the first turn of a
 * session creates the record, every later turn appends to it. This is the ONE write shape used by
 * every server-side history writer (build fast-lane fallback AND the plain-chat lane) so the
 * server store stays the single source of truth for transcripts. Race-safe: if two turns race and
 * both see "no record", the loser's create() throws on the duplicate id and is retried as an
 * append instead of dropping the turn.
 */
export async function upsertConversationTurn(
  store: ConversationStore,
  opts: {
    conversationId: string;
    userId: string;
    workspaceId: string;
    title: string;
    turn: unknown[];
    patch: ConversationPatch;
  },
): Promise<void> {
  const existing = await store.get(opts.conversationId).catch(() => null);
  if (existing) {
    await store.appendMessages(opts.conversationId, opts.turn, opts.patch);
    return;
  }
  try {
    await store.create({
      id: opts.conversationId,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      title: opts.title,
      messages: opts.turn,
      createdAt: opts.patch.updatedAt,
    });
    await store.update(opts.conversationId, opts.patch);
  } catch {
    // Lost a create race (or create is flaky): the record exists now — append the turn instead.
    await store.appendMessages(opts.conversationId, opts.turn, opts.patch);
  }
}
