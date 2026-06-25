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
}

/**
 * The persistence contract. Implementations must be safe to call concurrently for DIFFERENT
 * ids; a single build is driven by one runner, so per-id calls are naturally serialized.
 * Every method is async so a real backend (Firestore) drops in without signature changes.
 */
export interface ConversationStore {
  /** Create a new record. Throws if `id` already exists (a build id must be unique). */
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  /** Fetch a record, or null if it does not exist. */
  get(id: string): Promise<ConversationRecord | null>;
  /** Append transcript turns and apply a patch (usage/status/billing). Throws if id is unknown. */
  appendMessages(id: string, messages: unknown[], patch: ConversationPatch): Promise<void>;
  /** Apply a patch without appending messages (e.g. finalize status). Throws if id is unknown. */
  update(id: string, patch: ConversationPatch): Promise<void>;
  /** A user's builds, most-recently-updated first, capped at `limit` (default 50). */
  listByUser(userId: string, limit?: number): Promise<ConversationRecord[]>;
  /** Delete a build. No-op if it does not exist. */
  remove(id: string): Promise<void>;
}

/** Deep-ish clone so stored records never alias a caller's mutable arrays/objects. */
function cloneRecord(rec: ConversationRecord): ConversationRecord {
  return {
    ...rec,
    messages: rec.messages.slice(),
    usage: { ...rec.usage },
  };
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
      messages: (input.messages ?? []).slice(),
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      billedUsd: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.records.set(rec.id, cloneRecord(rec));
    return cloneRecord(rec);
  }

  async get(id: string): Promise<ConversationRecord | null> {
    const rec = this.records.get(id);
    return rec ? cloneRecord(rec) : null;
  }

  async appendMessages(id: string, messages: unknown[], patch: ConversationPatch): Promise<void> {
    const rec = this.mustGet(id);
    rec.messages = rec.messages.concat(messages);
    this.applyPatch(rec, patch);
    this.records.set(id, rec);
  }

  async update(id: string, patch: ConversationPatch): Promise<void> {
    const rec = this.mustGet(id);
    this.applyPatch(rec, patch);
    this.records.set(id, rec);
  }

  async listByUser(userId: string, limit = 50): Promise<ConversationRecord[]> {
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
    rec.updatedAt = patch.updatedAt;
  }
}

/** Derive a short, clean title from the first user prompt (for the build list). */
export function deriveTitle(prompt: string, max = 80): string {
  const oneLine = (prompt || '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'Untitled build';
  return oneLine.length > max ? oneLine.slice(0, max - 1).trimEnd() + '…' : oneLine;
}
