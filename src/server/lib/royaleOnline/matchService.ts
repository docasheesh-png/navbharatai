// ONLINE ROYALE — QUEUE, ROOMS, RECONNECT AND THE HARD QUOTAS (admin 2026-11-25).
//
// Transport-agnostic: a connection is anything with send() and close() (royaleWs.ts binds it to `ws`; the tests bind
// it to real sockets too). The clock is injected, so a whole match can be played in a test without waiting minutes.
//
// ⚠️ THIS RUNS ON NAVBHARATAI'S OWN SERVER, for games published in its App Store — the same quota-bound exception
// the NavData rows use (CLAUDE.md, 2026-08-15): small, bounded, an honest refusal when a cap is hit, never an
// unbounded bill. The caps below ARE that boundary; widening them needs the admin's sign-off, like NavData's.
//
// ⚠️ PER INSTANCE, AND SAID SO: rooms live in one Cloud Run instance's memory. Two players who reach DIFFERENT
// instances do not meet; each still gets a real match (with labelled bots after the wait). A shared matchmaker is
// an open item (BUILD_REPORT_QUEUE Q-3391), not something this file pretends to be.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_PLAYERS, applyMove, applyShot, createRoom, forfeit, snapshot, stepRoom, COVER, LOOT_SPOTS, ARENA_HALF, type Room, type MatchResult } from './matchCore';

export interface Conn { send(msg: Record<string, unknown>): void; close(code: number, reason: string): void }

export const QUOTAS = {
  /** Live rooms one app may run at once on an instance. */
  MAX_ROOMS_PER_APP: 5,
  /** Live rooms on one instance, all apps together. */
  MAX_ROOMS_TOTAL: 50,
  /** Players one app may have waiting in its queue. */
  MAX_QUEUE_PER_APP: 16,
  /** Matches one app may START per server-clock day (per instance). */
  MAX_MATCHES_PER_APP_PER_DAY: 300,
  /** Open match connections on one instance. */
  MAX_CONNECTIONS_TOTAL: 400,
  /** Messages a connection may send per second (moves go at ~15/s), with a small burst. */
  MSG_RATE_PER_S: 30,
  MSG_BURST: 45,
  /** Messages dropped for rate before the connection is closed. */
  MAX_DROPPED: 200,
} as const;
export type Quotas = { -readonly [K in keyof typeof QUOTAS]: number };

export const TICK_MS = 50;
export const SNAPSHOT_EVERY_TICKS = 2;
/** With two or more people waiting, the match starts after this long (bots fill the empty seats). */
export const QUEUE_FILL_MS = 10_000;
/** A lone player waits this long for company before the match starts with labelled bots. */
export const LONE_WAIT_MS = 30_000;
/** A dropped player keeps their place this long; after it they forfeit. */
export const RECONNECT_GRACE_MS = 15_000;
/** An ended room is kept this long, so a player who reconnects late still gets THE result (never a second one). */
export const ENDED_ROOM_KEEP_MS = 60_000;

type Session = {
  playerId: string; appId: string; conn: Conn | null;
  state: 'idle' | 'queued' | 'playing';
  roomId: string | null; queuedAt: number; disconnectedAt: number;
  tokens: number; refilledAt: number; dropped: number;
};
type RoomEntry = { room: Room; humans: string[]; ticks: number; reported: boolean; endedAt: number };

export type ServiceOptions = { now?: () => number; botsAllowed?: boolean; quotas?: Partial<Quotas>; secret?: Buffer; onResult?: (room: Room, result: MatchResult) => void };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class RoyaleMatchService {
  readonly quotas: Quotas;
  private readonly now: () => number;
  private readonly botsAllowed: boolean;
  private readonly secret: Buffer;
  private readonly onResult?: ServiceOptions['onResult'];
  private readonly sessions = new Map<string, Session>();
  private readonly queues = new Map<string, string[]>();
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly daily = new Map<string, { day: string; count: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private roomSeq = 0;
  readonly counters = { matchesStarted: 0, resultsRecorded: 0, refusedFull: 0, droppedMessages: 0 };

  constructor(opts: ServiceOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.botsAllowed = opts.botsAllowed ?? true;
    this.quotas = { ...QUOTAS, ...opts.quotas };
    // Per process: a resume token is only meaningful on the instance that holds the room anyway.
    this.secret = opts.secret ?? randomBytes(32);
    this.onResult = opts.onResult;
  }

  // ── identity ──────────────────────────────────────────────────────────────────────────────────────────────
  private sign(appId: string, playerId: string): string {
    return createHmac('sha256', this.secret).update('royale-online-v1:' + appId + ':' + playerId).digest('base64url');
  }
  tokenFor(appId: string, playerId: string): string { return playerId + '.' + this.sign(appId, playerId); }
  private playerFromToken(appId: string, token: unknown): string | null {
    if (typeof token !== 'string' || token.length > 120) return null;
    const m = /^([A-Za-z0-9_-]{8,24})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m) return null;
    const want = Buffer.from(this.sign(appId, m[1])), got = Buffer.from(m[2]);
    return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
  }

  // ── connections ───────────────────────────────────────────────────────────────────────────────────────────
  /** Attach a connection. Returns the player id, or null when refused (the connection has been told why and closed). */
  connect(appId: string, conn: Conn, resumeToken?: string | null): string | null {
    const resumed = resumeToken ? this.playerFromToken(appId, resumeToken) : null;
    const existing = resumed ? this.sessions.get(resumed) : undefined;
    if (!existing && this.connectionCount() >= this.quotas.MAX_CONNECTIONS_TOTAL) {
      this.counters.refusedFull++;
      conn.send({ t: 'full', reason: 'Online matches are full right now. Try again in a few minutes, or play Practice.' });
      conn.close(4429, 'full');
      return null;
    }
    const now = this.now();
    if (existing && existing.appId === appId) {
      if (existing.conn && existing.conn !== conn) existing.conn.close(4000, 'replaced by a newer connection');
      existing.conn = conn; existing.disconnectedAt = 0;
      existing.tokens = this.quotas.MSG_BURST; existing.refilledAt = now; existing.dropped = 0;
      conn.send({ t: 'welcome', token: this.tokenFor(appId, existing.playerId), you: existing.playerId, resumed: true });
      const entry = existing.roomId ? this.rooms.get(existing.roomId) : undefined;
      if (entry) {
        if (entry.room.result) this.sendEnd(existing, entry);
        else { conn.send(this.startMessage(entry, existing.playerId)); conn.send(snapshot(entry.room)); }
      }
      this.ensureTimer();
      return existing.playerId;
    }
    const playerId = randomBytes(12).toString('base64url');
    this.sessions.set(playerId, { playerId, appId, conn, state: 'idle', roomId: null, queuedAt: 0, disconnectedAt: 0, tokens: this.quotas.MSG_BURST, refilledAt: now, dropped: 0 });
    conn.send({ t: 'welcome', token: this.tokenFor(appId, playerId), you: playerId, resumed: false, maxPlayers: MAX_PLAYERS });
    this.ensureTimer();
    return playerId;
  }

  disconnect(playerId: string, conn: Conn): void {
    const s = this.sessions.get(playerId);
    if (!s || s.conn !== conn) return; // an older, replaced connection closing says nothing about the player
    s.conn = null;
    if (s.state === 'playing') { s.disconnectedAt = this.now(); return; } // the grace window starts
    if (s.state === 'queued') this.dequeue(s);
    const entry = s.roomId ? this.rooms.get(s.roomId) : undefined;
    if (!entry) this.sessions.delete(playerId);
    else s.disconnectedAt = this.now();
  }

  private connectionCount(): number { let n = 0; for (const s of this.sessions.values()) if (s.conn) n++; return n; }

  // ── messages ──────────────────────────────────────────────────────────────────────────────────────────────
  message(playerId: string, msg: unknown): void {
    const s = this.sessions.get(playerId);
    if (!s || !s.conn) return;
    const now = this.now();
    s.tokens = Math.min(this.quotas.MSG_BURST, s.tokens + ((now - s.refilledAt) / 1000) * this.quotas.MSG_RATE_PER_S);
    s.refilledAt = now;
    if (s.tokens < 1) {
      s.dropped++; this.counters.droppedMessages++;
      if (s.dropped > this.quotas.MAX_DROPPED) s.conn.close(4408, 'too many messages');
      return;
    }
    s.tokens -= 1;
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;
    switch (m.t) {
      case 'ping': s.conn.send({ t: 'pong', id: typeof m.id === 'number' ? m.id : 0 }); return;
      case 'queue': this.enqueue(s); return;
      case 'leave': if (s.state === 'queued') { this.dequeue(s); s.conn.send({ t: 'left' }); } return;
      case 'move': {
        const entry = this.liveRoomOf(s); if (!entry) return;
        const verdict = applyMove(entry.room, s.playerId, m.x, m.z, m.yaw, m.seq, now);
        if (!verdict.ok) {
          const p = entry.room.players.find((q) => q.id === s.playerId)!;
          s.conn.send({ t: 'correct', x: p.x, z: p.z, reason: verdict.reason });
        }
        return;
      }
      case 'fire': {
        const entry = this.liveRoomOf(s); if (!entry) return;
        const verdict = applyShot(entry.room, s.playerId, m.yaw, now);
        if (verdict.ok) s.conn.send({ t: 'shot', hit: verdict.hit });
        return;
      }
      default: return; // unknown messages are ignored; they still cost rate budget
    }
  }

  private liveRoomOf(s: Session): RoomEntry | null {
    if (s.state !== 'playing' || !s.roomId) return null;
    const entry = this.rooms.get(s.roomId);
    return entry && !entry.room.result ? entry : null;
  }

  // ── queue ─────────────────────────────────────────────────────────────────────────────────────────────────
  private dailyCount(appId: string): number {
    const d = this.daily.get(appId), today = day(this.now());
    return d && d.day === today ? d.count : 0;
  }

  private enqueue(s: Session): void {
    if (!s.conn) return;
    if (s.state === 'playing') {
      // An ELIMINATED player may queue again without waiting for the others to finish; a living one may not.
      const entry = s.roomId ? this.rooms.get(s.roomId) : undefined;
      const me = entry?.room.players.find((p) => p.id === s.playerId);
      if (entry && !entry.room.result && me?.alive) return;
      s.state = 'idle';
    }
    if (s.state !== 'idle') return; // already queued
    if (this.dailyCount(s.appId) >= this.quotas.MAX_MATCHES_PER_APP_PER_DAY) {
      s.conn.send({ t: 'full', reason: "This game has reached today's online match limit. Try again tomorrow, or play Practice." });
      return;
    }
    const q = this.queues.get(s.appId) ?? [];
    if (q.length >= this.quotas.MAX_QUEUE_PER_APP) {
      s.conn.send({ t: 'full', reason: 'The queue for this game is full right now. Try again in a minute, or play Practice.' });
      return;
    }
    q.push(s.playerId); this.queues.set(s.appId, q);
    s.state = 'queued'; s.queuedAt = this.now(); s.roomId = null;
    this.tellQueue(s.appId);
  }

  private dequeue(s: Session): void {
    const q = this.queues.get(s.appId);
    if (q) { const i = q.indexOf(s.playerId); if (i >= 0) q.splice(i, 1); if (!q.length) this.queues.delete(s.appId); else this.tellQueue(s.appId); }
    s.state = 'idle';
  }

  private tellQueue(appId: string, busy = false): void {
    const q = this.queues.get(appId) ?? [];
    for (const id of q) this.sessions.get(id)?.conn?.send({ t: 'queued', waiting: q.length, maxPlayers: MAX_PLAYERS, busy });
  }

  private appRooms(appId: string): number { let n = 0; for (const e of this.rooms.values()) if (e.room.appId === appId && !e.room.result) n++; return n; }
  private liveRooms(): number { let n = 0; for (const e of this.rooms.values()) if (!e.room.result) n++; return n; }

  private matchmake(appId: string, now: number): void {
    const q = this.queues.get(appId);
    if (!q || !q.length) return;
    const oldest = Math.min(...q.map((id) => this.sessions.get(id)?.queuedAt ?? now));
    const due = q.length >= MAX_PLAYERS || (q.length >= 2 && now - oldest >= QUEUE_FILL_MS) || (q.length === 1 && this.botsAllowed && now - oldest >= LONE_WAIT_MS);
    if (!due) return;
    if (this.dailyCount(appId) >= this.quotas.MAX_MATCHES_PER_APP_PER_DAY) {
      for (const id of q.splice(0)) {
        const s = this.sessions.get(id); if (!s) continue;
        s.state = 'idle';
        s.conn?.send({ t: 'full', reason: "This game has reached today's online match limit. Try again tomorrow, or play Practice." });
      }
      this.queues.delete(appId);
      return;
    }
    if (this.appRooms(appId) >= this.quotas.MAX_ROOMS_PER_APP || this.liveRooms() >= this.quotas.MAX_ROOMS_TOTAL) { this.tellQueue(appId, true); return; }
    const humans = q.splice(0, MAX_PLAYERS);
    if (!q.length) this.queues.delete(appId);
    this.startRoom(appId, humans, now);
  }

  private startRoom(appId: string, humans: string[], now: number): void {
    const entrants = humans.map((id, i) => ({ id, name: 'Player ' + (i + 1), bot: false }));
    if (this.botsAllowed) for (let b = 1; entrants.length < MAX_PLAYERS; b++) entrants.push({ id: 'bot-' + b, name: 'Bot ' + b, bot: true });
    const id = 'r' + (++this.roomSeq).toString(36) + '-' + randomBytes(4).toString('hex');
    const entry: RoomEntry = { room: createRoom(id, appId, entrants, now), humans, ticks: 0, reported: false, endedAt: 0 };
    this.rooms.set(id, entry);
    const d = this.daily.get(appId), today = day(now);
    this.daily.set(appId, { day: today, count: (d && d.day === today ? d.count : 0) + 1 });
    this.counters.matchesStarted++;
    for (const pid of humans) {
      const s = this.sessions.get(pid); if (!s) continue;
      s.state = 'playing'; s.roomId = id;
      s.conn?.send(this.startMessage(entry, pid));
    }
  }

  private startMessage(entry: RoomEntry, you: string) {
    const r = entry.room;
    return { t: 'start', room: r.id, you, arenaHalf: ARENA_HALF, cover: COVER, crates: LOOT_SPOTS.map(([x, z, kind]) => ({ x, z, kind })),
      players: r.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, x: p.x, z: p.z })) };
  }

  // ── the clock ─────────────────────────────────────────────────────────────────────────────────────────────
  tick(): void {
    const now = this.now();
    for (const appId of [...this.queues.keys()]) this.matchmake(appId, now);
    for (const [id, entry] of this.rooms) {
      const room = entry.room;
      if (!room.result) {
        for (const pid of entry.humans) {
          const s = this.sessions.get(pid);
          if (s && !s.conn && s.disconnectedAt && now - s.disconnectedAt > RECONNECT_GRACE_MS) forfeit(room, pid);
        }
        if (!room.result) stepRoom(room, now);
        entry.ticks++;
        if (!room.result && entry.ticks % SNAPSHOT_EVERY_TICKS === 0) {
          const snap = snapshot(room);
          for (const pid of entry.humans) this.sessions.get(pid)?.conn?.send(snap);
        }
      }
      if (room.result && !entry.reported) this.finish(entry);
      if (entry.reported && now - entry.endedAt > ENDED_ROOM_KEEP_MS) {
        this.rooms.delete(id);
        for (const pid of entry.humans) {
          const s = this.sessions.get(pid);
          if (s && s.roomId === id) { s.roomId = null; if (!s.conn) this.sessions.delete(pid); }
        }
      }
    }
    if (!this.sessions.size && !this.rooms.size) this.stopTimer();
  }

  /** The result is reported ONCE per room — the `reported` flag is the only door, whatever disconnects happen around it. */
  private finish(entry: RoomEntry): void {
    if (entry.reported || !entry.room.result) return;
    entry.reported = true; entry.endedAt = this.now();
    this.counters.resultsRecorded++;
    this.onResult?.(entry.room, entry.room.result);
    for (const pid of entry.humans) {
      const s = this.sessions.get(pid); if (!s || s.roomId !== entry.room.id) continue; // moved on to a new queue
      if (s.state === 'playing') s.state = 'idle';
      this.sendEnd(s, entry);
    }
  }

  private sendEnd(s: Session, entry: RoomEntry): void {
    const result = entry.room.result!;
    const me = result.places.find((p) => p.id === s.playerId);
    s.conn?.send({ t: 'end', room: entry.room.id, winner: result.winner, places: result.places, you: me ?? null, endedAt: result.endedAt });
  }

  private ensureTimer(): void {
    if (this.timer || this.now !== Date.now) return; // an injected clock is driven by its owner (tests)
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('[royale-online] tick failed:', e); } }, TICK_MS);
    this.timer.unref?.();
  }
  private stopTimer(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  shutdown(): void { this.stopTimer(); }

  /**
   * The instance is going away (a deploy's SIGTERM). Rooms live in this process, so a live match cannot survive it:
   * every player is TOLD so, and no result is invented for a match nobody finished. Returns how many were told.
   */
  drain(): number {
    let told = 0;
    for (const s of this.sessions.values()) {
      if (!s.conn) continue;
      s.conn.send({ t: 'unavailable', reason: 'The match server is restarting for an update, so this match ended without a result. Reopen Online in a minute.' });
      s.conn.close(4503, 'restarting');
      told++;
    }
    this.sessions.clear(); this.queues.clear(); this.rooms.clear();
    this.stopTimer();
    return told;
  }

  /** For tests and the admin's eyes: what is live right now. */
  stats() {
    let queued = 0; for (const q of this.queues.values()) queued += q.length;
    return { sessions: this.sessions.size, connections: this.connectionCount(), queued, liveRooms: this.liveRooms(), rooms: this.rooms.size, ...this.counters };
  }
  /** Test/inspection access to a room. */
  roomOf(playerId: string): Room | null {
    const s = this.sessions.get(playerId);
    const e = s?.roomId ? this.rooms.get(s.roomId) : undefined;
    return e ? e.room : null;
  }
}
