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
// WORKSPACE SCOPING (2026-07-01 — closes the cross-instance gap documented in the #804 fix): the
// channel is keyed by userId, but ONE account can have many v5.0 sessions. Events are now stamped
// with the workspaceId of the build that produced them, and `close()` DELETES the Firestore doc
// instead of only releasing the in-memory mirror. Root-caused ghost: a finished/dead build's last
// 200 events used to sit in `agentv3_live/{userId}` FOREVER; every live-mirror poll starts at
// sinceSeq=0, and on any instance without the build in local memory (i.e. after any instance
// recycle) the stale doc replayed UNFILTERED into whatever session was open — making one stuck chat
// reappear in "+ New chat" and every reopened chat, unrecoverably, from any device.
//
// PURE ring/seq logic lives in LiveEventBuffer (unit-tested). This file is the best-effort,
// VITEST-friendly I/O wrapper (in-memory mirror only under tests): never throws, never blocks a build.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { appendEvents, eventsSince, emptyLiveBuffer, type LiveBuffer } from './LiveEventBuffer';

export interface LiveRead {
  events: unknown[];
  seq: number;
  gap: boolean;
  /** Which v5.0 session produced these events. Undefined for a pre-upgrade (ghost) doc. */
  workspaceId?: string;
}

export interface LiveChannel {
  /** Queue events for the channel; flushed to the shared store on a throttle. Fire-and-forget.
   *  `workspaceId` stamps which session the events belong to so readers can refuse a mismatch. */
  publish(channelId: string, events: readonly unknown[], workspaceId?: string): void;
  /** Read everything after `sinceSeq` for a (re)attaching device. Never throws. */
  readSince(channelId: string, sinceSeq: number): Promise<LiveRead>;
  /** Flush any pending events, release the in-memory mirror AND delete the shared doc for a
   *  finished build — a closed channel must leave NO stale tail behind for later polls to replay. */
  close(channelId: string): void;
}

/**
 * Should a live read's events be delivered to a caller watching `requestedWorkspaceId`?
 * Pure + exported + unit-tested — this is the decision that stops one session's build events
 * bleeding into a DIFFERENT session under the same account (the "stuck chat that reappears
 * everywhere" bug):
 *  • caller didn't say which session it's watching → deliver (back-compat, account-wide).
 *  • events stamped with the SAME workspace → deliver.
 *  • events stamped with a DIFFERENT workspace → refuse.
 *  • events NOT stamped at all (a pre-upgrade ghost doc) and the caller asked for a specific
 *    session → refuse. Conservative deny: an unstamped tail is exactly the stale-ghost case this
 *    exists to kill, and a LIVE build on current code always stamps its events.
 */
export function liveEventsAllowedFor(requestedWorkspaceId: string | null | undefined, eventsWorkspaceId: string | undefined): boolean {
  if (!requestedWorkspaceId) return true;
  return eventsWorkspaceId === requestedWorkspaceId;
}

const COLLECTION = 'agentv3_live';
const FLUSH_MS = 1500;          // one batched write at most this often per channel (cost control)
const RING_MAX = 200;           // events retained per channel (capped doc → tiny + cheap)

interface ChannelState {
  buf: LiveBuffer;              // in-memory mirror — the build instance is the SINGLE writer
  pending: unknown[];
  timer: ReturnType<typeof setTimeout> | null;
  workspaceId?: string;         // which session this channel's current build belongs to
}

class FirestoreLiveChannel implements LiveChannel {
  private db: admin.firestore.Firestore | null = null;
  private readonly channels = new Map<string, ChannelState>();

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST) return null;
    if (this.db) return this.db;
    try {
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      this.db = getServerDb();
      return this.db;
    } catch {
      return null;
    }
  }

  publish(channelId: string, events: readonly unknown[], workspaceId?: string): void {
    if (!channelId || !Array.isArray(events) || events.length === 0) return;
    let st = this.channels.get(channelId);
    if (!st) { st = { buf: emptyLiveBuffer(), pending: [], timer: null }; this.channels.set(channelId, st); }
    if (workspaceId) st.workspaceId = workspaceId;
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
      .set({ seq: st.buf.seq, events: st.buf.events, workspaceId: st.workspaceId ?? null, updatedAt: Date.now() }, { merge: false })
      .catch(() => { /* best-effort — a mirror write never affects the build */ });
  }

  async readSince(channelId: string, sinceSeq: number): Promise<LiveRead> {
    const empty: LiveRead = { events: [], seq: typeof sinceSeq === 'number' ? sinceSeq : 0, gap: false };
    if (!channelId) return empty;
    // Prefer the live in-memory mirror when THIS instance is the one running the build (freshest, free).
    const local = this.channels.get(channelId);
    if (local) return { ...eventsSince(local.buf, sinceSeq), workspaceId: local.workspaceId };
    const db = this.getDb();
    if (!db) return empty;
    try {
      const snap = await db.collection(COLLECTION).doc(channelId).get();
      if (!snap.exists) return empty;
      const data = snap.data() as (Partial<LiveBuffer> & { workspaceId?: string | null }) | undefined;
      const buf: LiveBuffer = {
        seq: typeof data?.seq === 'number' ? data.seq : 0,
        events: Array.isArray(data?.events) ? data!.events! : [],
      };
      return { ...eventsSince(buf, sinceSeq), workspaceId: typeof data?.workspaceId === 'string' ? data.workspaceId : undefined };
    } catch {
      return empty;
    }
  }

  close(channelId: string): void {
    const st = this.channels.get(channelId);
    if (st?.timer) { clearTimeout(st.timer); st.timer = null; }
    // Do NOT flush pending events on close — the build is over; writing one last batch would
    // re-create the very stale-tail doc the delete below removes. Pending events at close time are
    // throwaway by design (the durable result reaches the client via the conversation store).
    this.channels.delete(channelId);
    // Delete the shared doc so a finished/stopped build leaves NO tail for later polls to replay —
    // this (not the in-memory release) is what actually kills the "ghost chat" across instances.
    const db = this.getDb();
    if (!db) return;
    db.collection(COLLECTION).doc(channelId).delete()
      .catch(() => { /* best-effort — an undeleted doc only means the ghost lives until the next build overwrites it */ });
  }
}

export const liveChannel: LiveChannel = new FirestoreLiveChannel();
