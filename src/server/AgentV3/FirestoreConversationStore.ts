// AgentV3 — Firestore-backed ConversationStore (D7 persistence P-C).
//
// The durable backend behind the ConversationStore contract: a v5.0 build survives not just a
// reconnect to the same instance (the in-memory store) but a process restart and horizontal
// scaling across Cloud Run instances. Mirrors the proven FirestoreJobStore pattern
// (firebase-admin init + databaseId from firebase-applet-config.json) and is selected at
// runtime in preference to InMemoryConversationStore when Firestore is reachable.
//
// Transcript storage avoids Firestore's 1 MB per-document limit: the metadata lives in the
// `agentv3_conversations/{id}` document, while the transcript is stored as append-only TURN
// documents in the `…/turns` subcollection (one document per appendMessages call, ordered by a
// monotonic `seq`). get() reassembles the full transcript by reading the turns in order.
//
// Like FirestoreJobStore, this class is exercised against real Firestore (integration), not in
// unit tests — the InMemoryConversationStore is the unit-tested reference for the SAME contract,
// and this implementation faithfully reproduces its semantics. The Firestore handle is
// injectable so a future integration test (or the emulator) can drive it without globals.

import * as admin from 'firebase-admin';
import type {
  ConversationStore,
  ConversationRecord,
  ConversationStatus,
  CreateConversationInput,
  ConversationPatch,
} from './ConversationStore';
import { isEnumerableUserId } from './ConversationStore';
import type { TurnUsage } from './ClaudeClient';
import { getServerDb } from '../lib/serverDb';
import { listEqNewestFirst } from '../lib/firestoreIndexSafe';

const COLLECTION = 'agentv3_conversations';
const ZERO_USAGE: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
// Cross-turn bound on the evidence layer: one chunk per build turn (each ≤500 events / ≤300KB),
// oldest chunk deleted once the cap is passed — an eternal session keeps its newest ~40 turns of
// action rows without growing Firestore (or the GET response) without limit.
const MAX_TIMELINE_CHUNKS = 40;

/** Metadata persisted in the main document (everything except the transcript itself). */
interface ConversationMeta {
  userId: string;
  workspaceId: string;
  title: string;
  status: ConversationStatus;
  usage: TurnUsage;
  billedUsd: number;
  createdAt: number;
  updatedAt: number;
  /** Next turn sequence number to write (monotonic). */
  nextSeq: number;
  /** Total messages across all turns (for cheap listing). */
  messageCount: number;
  /** Next timeline chunk sequence number to write (monotonic; absent on legacy docs). */
  nextTimelineSeq?: number;
  /** Terminal facts of the last finished build turn (billing/tokens/build health). */
  finalState?: Record<string, unknown>;
  /** The framework this session builds with. */
  framework?: string;
  /** User pinned this build to the top of their history list (absent/false = normal). */
  pinned?: boolean;
  /** The name the USER chose for this app (admin 2026-09-04). Absent until someone renames. */
  appName?: string;
  /** The GitHub repo this app's code lives in — persisted so a rename cannot strand the app. */
  repoName?: string;
}

export class FirestoreConversationStore implements ConversationStore {
  private readonly db: admin.firestore.Firestore;

  constructor(db?: admin.firestore.Firestore) {
    if (db) {
      this.db = db;
      return;
    }
    if (!admin.apps || admin.apps.length === 0) {
      admin.initializeApp({});
    }
    // Collision-free shared admin handle (getFirestore(app, dbId)) — targets navbharat-prod with NO
    // per-store .settings() race. This is what keeps durable history durable: the old
    // default-instance settings() pattern threw on every store after the first (settings() is
    // once-per-instance), which demoted this conversation store to IN-MEMORY for the life of the
    // Cloud Run instance ("history works while the tab is open, gone after a reload"). The shared
    // handle configures the database exactly once, centrally, so no store is ever demoted.
    this.db = getServerDb() ?? admin.firestore();
  }

  private mainDoc(id: string) {
    return this.db.collection(COLLECTION).doc(id);
  }

  private turnsCol(id: string) {
    return this.mainDoc(id).collection('turns');
  }

  private timelineCol(id: string) {
    return this.mainDoc(id).collection('timeline');
  }

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    const ref = this.mainDoc(input.id);
    const existing = await ref.get();
    if (existing.exists) {
      throw new Error(`ConversationStore.create: id "${input.id}" already exists`);
    }
    const seed = (input.messages ?? []).slice();
    const meta: ConversationMeta = {
      userId: input.userId,
      workspaceId: input.workspaceId,
      title: input.title,
      status: 'running',
      usage: { ...ZERO_USAGE },
      billedUsd: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      nextSeq: seed.length ? 1 : 0,
      messageCount: seed.length,
    };
    await ref.set(meta);
    if (seed.length) {
      await this.turnsCol(input.id).doc('0').set({ seq: 0, messages: seed, ts: input.createdAt });
    }
    return { id: input.id, ...meta, usage: { ...meta.usage }, messages: seed };
  }

  async get(id: string, opts?: { includeTimeline?: boolean }): Promise<ConversationRecord | null> {
    const snap = await this.mainDoc(id).get();
    if (!snap.exists) return null;
    const meta = snap.data() as ConversationMeta;
    const turns = await this.turnsCol(id).orderBy('seq').get();
    // Attach each turn's wall-clock `ts` to its messages (never overwriting an explicit one) —
    // the client needs real timestamps to interleave restored prose with the durable timeline.
    const messages = turns.docs.flatMap((d) => {
      const data = d.data() as { messages?: unknown[]; ts?: number };
      const ts = typeof data.ts === 'number' ? data.ts : undefined;
      return (data.messages ?? []).map((m) =>
        ts !== undefined && m && typeof m === 'object' && (m as { ts?: unknown }).ts === undefined
          ? { ...m, ts }
          : m,
      );
    });
    // Timeline chunks are read ONLY when asked for (the reopen/GET path) — hot paths (existence
    // probes, transcript recaps) skip the extra reads. Optional on legacy docs; a failure to
    // read them must never break opening the transcript itself.
    let timeline: unknown[] | undefined;
    if (opts?.includeTimeline) {
      try {
        const chunks = await this.timelineCol(id).orderBy('seq').get();
        const events = chunks.docs.flatMap((d) => (d.data().events as unknown[]) ?? []);
        if (events.length > 0) timeline = events;
      } catch { /* evidence layer is best-effort */ }
    }
    return this.toRecord(id, meta, messages, timeline);
  }

  async appendMessages(id: string, messages: unknown[], patch: ConversationPatch): Promise<void> {
    const ref = this.mainDoc(id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`ConversationStore: unknown conversation id "${id}"`);
      const meta = snap.data() as ConversationMeta;
      const seq = meta.nextSeq ?? 0;
      tx.set(this.turnsCol(id).doc(String(seq)), { seq, messages, ts: patch.updatedAt });
      // A patch may also carry timeline events (eternal sessions) — written as an append-only
      // chunk in the same transaction so evidence and transcript can never drift apart.
      const timelineSeq = meta.nextTimelineSeq ?? 0;
      const hasTimeline = !!patch.timelineAppend && patch.timelineAppend.length > 0;
      if (hasTimeline) {
        tx.set(this.timelineCol(id).doc(String(timelineSeq)), { seq: timelineSeq, events: patch.timelineAppend, ts: patch.updatedAt });
        if (timelineSeq >= MAX_TIMELINE_CHUNKS) tx.delete(this.timelineCol(id).doc(String(timelineSeq - MAX_TIMELINE_CHUNKS)));
      }
      tx.set(
        ref,
        {
          ...this.patchToMeta(patch),
          nextSeq: seq + 1,
          messageCount: (meta.messageCount ?? 0) + messages.length,
          ...(hasTimeline ? { nextTimelineSeq: timelineSeq + 1 } : {}),
        },
        { merge: true },
      );
    });
  }

  async update(id: string, patch: ConversationPatch): Promise<void> {
    const ref = this.mainDoc(id);
    if (patch.timelineAppend && patch.timelineAppend.length > 0) {
      // Timeline chunks mirror the turns layout: one append-only doc per write, ordered by a
      // monotonic seq claimed transactionally — so per-chunk size stays bounded and two
      // concurrent build turns can never overwrite each other's evidence.
      const events = patch.timelineAppend;
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error(`ConversationStore: unknown conversation id "${id}"`);
        const meta = snap.data() as ConversationMeta;
        const seq = meta.nextTimelineSeq ?? 0;
        tx.set(this.timelineCol(id).doc(String(seq)), { seq, events, ts: patch.updatedAt });
        if (seq >= MAX_TIMELINE_CHUNKS) tx.delete(this.timelineCol(id).doc(String(seq - MAX_TIMELINE_CHUNKS)));
        tx.set(ref, { ...this.patchToMeta(patch), nextTimelineSeq: seq + 1 }, { merge: true });
      });
      return;
    }
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`ConversationStore: unknown conversation id "${id}"`);
    await ref.set(this.patchToMeta(patch), { merge: true });
  }

  async truncateMessages(id: string, keepCount: number, patch: ConversationPatch): Promise<void> {
    const ref = this.mainDoc(id);
    await this.db.runTransaction(async (tx) => {
      // ALL reads before ANY write (Firestore transaction rule).
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`ConversationStore: unknown conversation id "${id}"`);
      const turnsSnap = await tx.get(this.turnsCol(id).orderBy('seq'));
      const keep = Math.max(0, keepCount);
      let acc = 0; // flattened messages surviving so far
      let lastSurvivingSeq = -1;
      for (const d of turnsSnap.docs) {
        const data = d.data() as { seq: number; messages?: unknown[]; ts?: number };
        const msgs = data.messages ?? [];
        if (acc >= keep) {
          tx.delete(d.ref); // this whole turn-doc is past the boundary → drop it
          continue;
        }
        if (acc + msgs.length <= keep) {
          acc += msgs.length; // whole doc survives
          lastSurvivingSeq = data.seq;
          continue;
        }
        // Boundary falls INSIDE this doc — keep only its head slice.
        tx.set(d.ref, { seq: data.seq, messages: msgs.slice(0, keep - acc), ts: data.ts ?? patch.updatedAt });
        acc = keep;
        lastSurvivingSeq = data.seq;
      }
      // Fix the monotonic seq + count so a future append lands after the survivors, never resurrecting
      // a deleted doc or leaving a gap.
      tx.set(ref, { ...this.patchToMeta(patch), nextSeq: lastSurvivingSeq + 1, messageCount: acc }, { merge: true });
    });
  }

  async listByUser(userId: string, limit = 50): Promise<ConversationRecord[]> {
    if (!isEnumerableUserId(userId)) return []; // never enumerate the shared-anon bucket (Phase 3.1)
    const cap = Math.max(0, limit);
    // Pinned builds float to the FRONT (so a pinned older build survives the cap), then newest-updated
    // first within each group — the reference order the InMemory store + UI use. We deliberately do NOT
    // add a (userId, pinned, updatedAt) composite index for this: instead we fetch a wider window
    // ordered by recency and re-sort pinned-first in memory. This keeps pinned builds visible as long as
    // they are within the user's `fetch` most-recent builds (ample for real users) with zero index churn.
    const sortPinnedFirst = (recs: ConversationRecord[]): ConversationRecord[] =>
      recs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    // List view: transcript omitted (empty messages) — call get(id) for the full build.
    //
    // ONE query, filtered on `userId` alone. This used to try an ordered `(userId, updatedAt)` query
    // first and fall back to this one when it threw — but that composite index has never existed:
    // `firestore.indexes.json` declares it, and nothing deploys that file (`firebase.json` has no
    // `indexes` key, and no pipeline runs `firebase deploy --only firestore:indexes`). So the
    // "fast path" threw on every single history load and every user paid for a doomed round-trip
    // before the real query ran. Removing it makes the history list strictly faster, and the result
    // identical — the sort was already happening here in memory either way.
    const rows = await listEqNewestFirst<ConversationRecord>(
      this.db.collection(COLLECTION),
      [['userId', userId]],
      'updatedAt',
      Math.max(cap, 200),
      Math.max(cap, 200),
      (id, data) => this.toRecord(id, data as ConversationMeta, []),
    );
    const recs = sortPinnedFirst(rows);
    return cap > 0 ? recs.slice(0, cap) : recs;
  }

  async remove(id: string): Promise<void> {
    const turns = await this.turnsCol(id).get();
    const timeline = await this.timelineCol(id).get().catch(() => null);
    const batch = this.db.batch();
    turns.docs.forEach((d) => batch.delete(d.ref));
    timeline?.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(this.mainDoc(id));
    await batch.commit();
  }

  /** Build a ConversationRecord from stored metadata + (possibly empty) messages. */
  private toRecord(id: string, meta: ConversationMeta, messages: unknown[], timeline?: unknown[]): ConversationRecord {
    return {
      id,
      userId: meta.userId,
      workspaceId: meta.workspaceId,
      title: meta.title,
      status: meta.status,
      messages,
      usage: { ...ZERO_USAGE, ...(meta.usage ?? {}) },
      billedUsd: meta.billedUsd ?? 0,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      ...(timeline ? { timeline } : {}),
      ...(meta.finalState ? { finalState: meta.finalState } : {}),
      ...(meta.framework ? { framework: meta.framework } : {}),
      ...(meta.pinned ? { pinned: true } : {}),
      ...(meta.appName ? { appName: meta.appName } : {}),
      ...(meta.repoName ? { repoName: meta.repoName } : {}),
    };
  }

  /** The subset of metadata a patch updates (only defined fields, plus updatedAt). */
  private patchToMeta(patch: ConversationPatch): Partial<ConversationMeta> {
    const out: Partial<ConversationMeta> = { updatedAt: patch.updatedAt };
    if (patch.status !== undefined) out.status = patch.status;
    if (patch.usage !== undefined) out.usage = { ...patch.usage };
    if (patch.billedUsd !== undefined) out.billedUsd = patch.billedUsd;
    if (patch.finalState !== undefined) out.finalState = { ...patch.finalState };
    if (patch.framework !== undefined) out.framework = patch.framework;
    if (patch.pinned !== undefined) out.pinned = patch.pinned;
    if (patch.appName !== undefined) out.appName = patch.appName;
    if (patch.repoName !== undefined) out.repoName = patch.repoName;
    return out;
  }
}
