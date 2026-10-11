/**
 * G1.1 — Firestore-backed persistence for the shared event bus.
 *
 * Local-disk persistence (AppMakerLab JournalManager / CheckpointStorage) doesn't
 * survive Cloud Run's ephemeral, multi-instance containers — so build/agent events
 * are persisted to Firestore instead. Mirrors the proven pattern in
 * `EngineerAI/WorkspaceMemoryStore.ts` (firebase-admin, self-init, test-safe).
 *
 * Hard rule: append() must NEVER throw — persistence is best-effort. It is
 * registered as the bus's sink, so every published event is durably stored without
 * the publisher ever awaiting or being affected by a Firestore failure.
 */
import * as admin from 'firebase-admin';
import { listEqNewestFirst, type EqFilter } from './firestoreIndexSafe';
import { getServerDb } from './serverDb';
import { eventBus, type BusEvent } from './eventBus';

const COLLECTION = 'build_events';

/** Keep stored payloads small — never persist whole file maps into the event log. */
function trimPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  try {
    const s = JSON.stringify(payload);
    if (s.length <= 4000) return payload;
    return { _truncated: true, preview: s.slice(0, 4000) };
  } catch {
    return {};
  }
}

class EventStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    // Skip Firestore under the test runner (no GCP creds → metadata lookup hangs).
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        const db = getServerDb();
        this.db = db;
      }
      return this.db;
    } catch {
      return null;
    }
  }

  /** Persist one event. Best-effort — swallows all errors. */
  async append(event: BusEvent): Promise<void> {
    try {
      const db = this.getDb();
      if (!db) return;
      await db.collection(COLLECTION).add({
        eventId: event.eventId,
        type: event.type,
        workspaceId: event.workspaceId,
        correlationId: event.correlationId,
        sender: event.sender,
        ts: event.ts,
        payload: trimPayload(event.payload),
      });
    } catch {
      /* persistence is best-effort — never break the caller */
    }
  }

  /** Query persisted events (newest first). Falls back to the in-memory ring. */
  async query(opts: { workspaceId?: string; correlationId?: string; limit?: number }): Promise<BusEvent[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    try {
      const db = this.getDb();
      if (!db) return eventBus.recent(opts).slice(0, limit);
      const filters: EqFilter[] = [];
      if (opts.workspaceId) filters.push(['workspaceId', opts.workspaceId]);
      if (opts.correlationId) filters.push(['correlationId', opts.correlationId]);
      // A FILTERED search used to add `orderBy('ts', 'desc')` after the equality filter — a composite index
      // this project has never deployed — so it threw and quietly answered from this instance's in-memory
      // ring (audit 2026-10-11, D12). Filters now go through the index-free helper; only the unfiltered
      // listing orders in the query, which the automatic single-field index on `ts` serves.
      if (filters.length > 0) {
        return await listEqNewestFirst<BusEvent>(db.collection(COLLECTION), filters, 'ts', limit);
      }
      const snap = await db.collection(COLLECTION).orderBy('ts', 'desc').limit(limit).get();
      return snap.docs.map(d => d.data() as BusEvent);
    } catch {
      return eventBus.recent(opts).slice(0, limit);
    }
  }
}

export const eventStore = new EventStore();

// Register persistence as the bus sink — every published event is now durable.
eventBus.setPersistSink((e) => { void eventStore.append(e); });
