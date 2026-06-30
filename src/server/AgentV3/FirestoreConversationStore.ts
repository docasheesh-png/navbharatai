// AgentV3 — Firestore-backed ConversationStore (D7 persistence P-C).
//
// The durable backend behind the ConversationStore contract: a v3.0 build survives not just a
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
import type { TurnUsage } from './ClaudeClient';
import { firestoreDatabaseId } from '../lib/firestoreDb';

const COLLECTION = 'agentv3_conversations';
const ZERO_USAGE: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

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
    this.db = admin.firestore();
    this.db.settings({ databaseId: firestoreDatabaseId() });
  }

  private mainDoc(id: string) {
    return this.db.collection(COLLECTION).doc(id);
  }

  private turnsCol(id: string) {
    return this.mainDoc(id).collection('turns');
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

  async get(id: string): Promise<ConversationRecord | null> {
    const snap = await this.mainDoc(id).get();
    if (!snap.exists) return null;
    const meta = snap.data() as ConversationMeta;
    const turns = await this.turnsCol(id).orderBy('seq').get();
    const messages = turns.docs.flatMap((d) => (d.data().messages as unknown[]) ?? []);
    return this.toRecord(id, meta, messages);
  }

  async appendMessages(id: string, messages: unknown[], patch: ConversationPatch): Promise<void> {
    const ref = this.mainDoc(id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`ConversationStore: unknown conversation id "${id}"`);
      const meta = snap.data() as ConversationMeta;
      const seq = meta.nextSeq ?? 0;
      tx.set(this.turnsCol(id).doc(String(seq)), { seq, messages, ts: patch.updatedAt });
      tx.set(
        ref,
        {
          ...this.patchToMeta(patch),
          nextSeq: seq + 1,
          messageCount: (meta.messageCount ?? 0) + messages.length,
        },
        { merge: true },
      );
    });
  }

  async update(id: string, patch: ConversationPatch): Promise<void> {
    const ref = this.mainDoc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`ConversationStore: unknown conversation id "${id}"`);
    await ref.set(this.patchToMeta(patch), { merge: true });
  }

  async listByUser(userId: string, limit = 50): Promise<ConversationRecord[]> {
    const cap = Math.max(0, limit);
    // List view: transcript omitted (empty messages) — call get(id) for the full build.
    try {
      const q = await this.db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .limit(cap)
        .get();
      return q.docs.map((d) => this.toRecord(d.id, d.data() as ConversationMeta, []));
    } catch {
      // FALLBACK — the (userId ASC, updatedAt DESC) composite index may not be deployed yet. Without
      // it the ordered query THROWS ("query requires an index"), the route returns 500, and the
      // history menu silently shows "No saved chats yet" even though chats exist. Query by userId
      // alone (a single-field index always exists), then sort + cap in memory so OLD CHATS still
      // appear. Once the index is live (firestore.indexes.json) the fast ordered path above is used.
      const q = await this.db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .limit(Math.max(cap, 200))
        .get();
      const recs = q.docs.map((d) => this.toRecord(d.id, d.data() as ConversationMeta, []));
      recs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      return cap > 0 ? recs.slice(0, cap) : recs;
    }
  }

  async remove(id: string): Promise<void> {
    const turns = await this.turnsCol(id).get();
    const batch = this.db.batch();
    turns.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(this.mainDoc(id));
    await batch.commit();
  }

  /** Build a ConversationRecord from stored metadata + (possibly empty) messages. */
  private toRecord(id: string, meta: ConversationMeta, messages: unknown[]): ConversationRecord {
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
    };
  }

  /** The subset of metadata a patch updates (only defined fields, plus updatedAt). */
  private patchToMeta(patch: ConversationPatch): Partial<ConversationMeta> {
    const out: Partial<ConversationMeta> = { updatedAt: patch.updatedAt };
    if (patch.status !== undefined) out.status = patch.status;
    if (patch.usage !== undefined) out.usage = { ...patch.usage };
    if (patch.billedUsd !== undefined) out.billedUsd = patch.billedUsd;
    return out;
  }
}
