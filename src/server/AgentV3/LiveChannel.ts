// AgentV3 — Live Channel (cross-device live sync transport).
//
// A SHARED, instance-independent channel for a build's live events, so a second device — whose request
// may land on a different Cloud Run instance than the one running the build — can still watch the
// activity. This is the boundary the rest of the app talks to; the backing store is swappable:
//   • FirestoreLiveChannel (this file) — no new infra, THROTTLED writes (one batched write ~every
//     1.5 s, a capped 200-event ring per channel), so it is cheap even at very high user counts and
//     never durably stores the throwaway events beyond the recent tail.
//   • A RedisLiveChannel can drop in later behind the SAME interface for pure-pub/sub at extreme scale.
//
// Security: only the SERVER (Firebase Admin SDK) ever touches this store — clients talk to our API,
// never to Firestore directly — so there is no client-exposed DB surface to abuse.
//
// PURE ring/seq logic lives in LiveEventBuffer (unit-tested). This file is the best-effort,
// VITEST-skipped I/O wrapper (mirrors FirestoreWorkspaceMemoryStore): never throws, never blocks a build.

import * as admin from 'firebase-admin';
import { firestoreDatabaseId } from '../lib/firestoreDb';
import { appendEvents, eventsSince, emptyLiveBuffer, type LiveBuffer } from './LiveEventBuffer';

export interface LiveChannel {
  /** Queue events for the channel; flushed to the shared store on a throttle. Fire-and-forget. */
  publish(channelId: string, events: readonly unknown[]): void;
  /** Read everything after `sinceSeq` for a (re)attaching device. Never throws. */
  readSince(channelId: string, sinceSeq: number): Promise<{ events: unknown[]; seq: number; gap: boolean }>;
  /** Flush any pending events and release the in-memory mirror for a finished build. */
  close(channelId: string): void;
}

const COLLECTION = 'agentv3_live';
const FLUSH_MS = 1500;          // one batched write at most this often per channel (cost control)
const RING_MAX = 200;           // events retained per channel (capped doc → tiny + cheap)

interface ChannelState {
  buf: LiveBuffer;              // in-memory mirror — the build instance is the SINGLE writer
  pending: unknown[];
  timer: ReturnType<typeof setTimeout> | null;
}

class FirestoreLiveChannel implements LiveChannel {
  private db: admin.firestore.Firestore | null = null;
  private readonly channels = new Map<string, ChannelState>();

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST) return null;
    if (this.db) return this.db;
    try {
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      this.db = admin.firestore();
      this.db.settings({ databaseId: firestoreDatabaseId() });
      return this.db;
    } catch {
      return null;
    }
  }

  publish(channelId: string, events: readonly unknown[]): void {
    if (!channelId || !Array.isArray(events) || events.length === 0) return;
    let st = this.channels.get(channelId);
    if (!st) { st = { buf: emptyLiveBuffer(), pending: [], timer: null }; this.channels.set(channelId, st); }
    for (const e of events) st.pending.push(e);
    if (st.timer) return;                          // a flush is already scheduled → coalesce
    st.timer = setTimeout(() => this.flush(channelId), FLUSH_MS);
  }

  private flush(channelId: string): void {
    const st = this.channels.get(channelId);
    if (!st) return;
    st.timer = null;
    if (st.pending.length === 0) return;
    st.buf = appendEvents(st.buf, st.pending, RING_MAX);
    st.pending = [];
    const db = this.getDb();
    if (!db) return;                               // tests / no Firestore → in-memory mirror only
    db.collection(COLLECTION).doc(channelId)
      .set({ seq: st.buf.seq, events: st.buf.events, updatedAt: Date.now() }, { merge: false })
      .catch(() => { /* best-effort — a mirror write never affects the build */ });
  }

  async readSince(channelId: string, sinceSeq: number): Promise<{ events: unknown[]; seq: number; gap: boolean }> {
    const empty = { events: [] as unknown[], seq: typeof sinceSeq === 'number' ? sinceSeq : 0, gap: false };
    if (!channelId) return empty;
    // Prefer the live in-memory mirror when THIS instance is the one running the build (freshest, free).
    const local = this.channels.get(channelId);
    if (local) return eventsSince(local.buf, sinceSeq);
    const db = this.getDb();
    if (!db) return empty;
    try {
      const snap = await db.collection(COLLECTION).doc(channelId).get();
      if (!snap.exists) return empty;
      const data = snap.data() as Partial<LiveBuffer> | undefined;
      const buf: LiveBuffer = {
        seq: typeof data?.seq === 'number' ? data.seq : 0,
        events: Array.isArray(data?.events) ? data!.events! : [],
      };
      return eventsSince(buf, sinceSeq);
    } catch {
      return empty;
    }
  }

  close(channelId: string): void {
    const st = this.channels.get(channelId);
    if (!st) return;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (st.pending.length > 0) this.flush(channelId);
    this.channels.delete(channelId);
  }
}

export const liveChannel: LiveChannel = new FirestoreLiveChannel();
