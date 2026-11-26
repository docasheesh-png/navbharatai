/**
 * 🌐 PLAY WITH FRIENDS ONLINE, ON THE USER'S OWN BACKEND (admin 2026-11-26, list #10: "multiplayer … user ka backend /
 * hosting maange").
 *
 * Root cause: online play existed only for NavBharatAI's own Royale servers (Q-3490: a shared room service needs a shared
 * store across Cloud Run instances). Any other game asking for multiplayer was told it was "infrastructure" — or, worse, got a
 * lobby that pretended to find players. A user's game does not need NavBharatAI's servers at all: the user's own Supabase
 * project already runs Realtime (rooms, broadcast), and the app already has the two keys every Supabase app uses.
 *
 * `src/game/three/rooms.ts`: joinRoom(code) talks to the user's Supabase Realtime directly over its websocket (the Phoenix
 * channel protocol — no package to install): join by a room code, send state a few times a second, receive every other
 * player's, see who joined and left. Without the keys it never pretends: status is 'not-configured', and showRoomNotice()
 * draws a RED line on the game's screen naming the two keys and where to add them (the no-fake-feature rule).
 *
 * String.raw: no backticks and no dollar-brace sequences inside the module text.
 */
export const GAME_ROOMS_PATH = 'src/game/three/rooms.ts';
export const ROOM_KEY_NAMES = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;
/**
 * The RED line, word for word what demoUntilKeySaved (AppContext/navPaths.ts) says for these keys. Written out here because
 * the kit-history command builds this file alone (only src/server/lib resolves at a past revision);
 * tests/friendsPlayOnTheUsersOwnBackend.test.ts fails the moment the two differ.
 */
export const ROOM_NOT_CONFIGURED = 'Online multiplayer is a demo, not real. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in NavBharatAI → Settings → App Settings → Secrets & API Keys to make it real.';

export const GAME_ROOMS = String.raw`import * as THREE from 'three';

/** What the screen says until the user's own Supabase keys are saved (never a fake "searching for players"). */
export const ROOM_NOT_CONFIGURED = ` + JSON.stringify(ROOM_NOT_CONFIGURED) + String.raw`;

export type RoomStatus = 'not-configured' | 'connecting' | 'open' | 'closed' | 'error';
export interface Peer { id: string; name: string; state: Record<string, unknown>; lastSeen: number }
export interface RoomOptions {
  /** The room code friends type to join the same game (newRoomCode() makes one). */
  room: string;
  /** This player's name, shown to the others. */
  name?: string;
  /** The user's Supabase project URL and anon key. Left out: import.meta.env.VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. */
  url?: string;
  anonKey?: string;
  /** State updates sent per second at most (default 10). */
  sendRate?: number;
  /** A player not heard from for this many seconds has left (default 10). */
  timeout?: number;
  /** Tests only: a WebSocket class and a clock. */
  WebSocketImpl?: { new (url: string): WebSocket };
  now?: () => number;
}
export interface Room {
  readonly status: RoomStatus;
  /** Why it is not open (empty when it is). */
  readonly reason: string;
  readonly code: string;
  readonly me: string;
  /** Every other player in the room, by id. */
  readonly peers: Map<string, Peer>;
  /** Send this player's state (position, heading, animation…); throttled to sendRate. */
  sendState(state: Record<string, unknown>): void;
  /** Send a one-off event to everyone (a shot, a goal, a chat line). */
  send(event: string, payload: Record<string, unknown>): void;
  /** Hear an event: 'join', 'leave', 'state', 'status', or one of your own. Returns a function that stops listening. */
  on(event: string, fn: (payload: any, from: Peer | null) => void): () => void;
  /** Drop expired players (call every frame, or let remotePlayers do it). */
  tick(): void;
  leave(): void;
}

/** A short code a friend can type (no 0/O/1/I to misread). */
export function newRoomCode(length = 6): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < length; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/** The user's Supabase keys from the app's environment, or null when either is missing. */
export function roomConfig(o: { url?: string; anonKey?: string } = {}): { url: string; anonKey: string } | null {
  let env: Record<string, string | undefined> = {};
  try { env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {}; } catch { env = {}; }
  const url = String(o.url ?? env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = String(o.anonKey ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!/^https:\/\/[^\s/]+/.test(url) || anonKey.length < 20) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

/** Join a room on the user's own Supabase Realtime. Never throws; a missing key is status 'not-configured'. */
export function joinRoom(o: RoomOptions): Room {
  const now = o.now ?? (() => Date.now());
  const code = String(o.room || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32) || 'LOBBY';
  const me = Math.random().toString(36).slice(2, 10);
  const name = String(o.name ?? 'Player').slice(0, 24);
  const minGap = 1000 / Math.max(1, Math.min(30, o.sendRate ?? 10));
  const timeout = Math.max(2, o.timeout ?? 10) * 1000;
  const peers = new Map<string, Peer>();
  const listeners = new Map<string, Set<(p: any, from: Peer | null) => void>>();
  let status: RoomStatus = 'connecting';
  let reason = '';
  let ws: WebSocket | null = null;
  let ref = 0;
  let lastSent = -Infinity;
  let pending: Record<string, unknown> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const topic = 'realtime:nb-room-' + code;
  const emit = (event: string, payload: unknown, from: Peer | null) => { for (const fn of listeners.get(event) ?? []) { try { fn(payload, from); } catch (e) { console.error('[rooms] a listener failed', e); } } };
  const setStatus = (s: RoomStatus, why = '') => { status = s; reason = why; emit('status', { status: s, reason: why }, null); };
  const frame = (event: string, payload: unknown, t = topic) => {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++ref), join_ref: t === topic ? '1' : undefined }));
    return true;
  };
  const broadcast = (event: string, payload: Record<string, unknown>) => frame('broadcast', { type: 'broadcast', event, payload: { ...payload, from: me, name } });
  const hear = (from: string, fromName: string) => {
    let p = peers.get(from);
    if (!p) { p = { id: from, name: fromName, state: {}, lastSeen: now() }; peers.set(from, p); emit('join', { id: from, name: fromName }, p); }
    p.lastSeen = now(); p.name = fromName || p.name;
    return p;
  };
  const room: Room = {
    get status() { return status; },
    get reason() { return reason; },
    code, me, peers,
    sendState(state) {
      pending = state;
      if (status !== 'open' || now() - lastSent < minGap) return;
      lastSent = now();
      broadcast('state', { state: pending });
      pending = null;
    },
    send(event, payload) { if (status === 'open') broadcast('ev:' + event, payload); },
    on(event, fn) {
      let set = listeners.get(event); if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(fn);
      return () => { set!.delete(fn); };
    },
    tick() {
      const t = now();
      for (const [id, p] of peers) if (t - p.lastSeen > timeout) { peers.delete(id); emit('leave', { id, name: p.name }, p); }
      if (pending && status === 'open' && t - lastSent >= minGap) room.sendState(pending);
    },
    leave() {
      if (status === 'open') broadcast('bye', {});
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      try { ws?.close(); } catch { /* already closed */ }
      ws = null;
      if (status !== 'not-configured') setStatus('closed');
    },
  };
  const cfg = roomConfig(o);
  if (!cfg) { status = 'not-configured'; reason = ROOM_NOT_CONFIGURED; return room; }
  try {
    const Impl = o.WebSocketImpl ?? (globalThis as { WebSocket?: { new (url: string): WebSocket } }).WebSocket;
    if (!Impl) { setStatus('error', 'This browser cannot open a live connection.'); return room; }
    ws = new Impl(cfg.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.anonKey) + '&vsn=1.0.0');
    ws.onopen = () => {
      frame('phx_join', { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false }, access_token: cfg.anonKey });
      heartbeat = setInterval(() => frame('heartbeat', {}, 'phoenix'), 25000);
    };
    ws.onmessage = (m: MessageEvent) => {
      let msg: { topic?: string; event?: string; payload?: any } | null = null;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (!msg || msg.topic !== topic) return;
      if (msg.event === 'phx_reply' && status === 'connecting') {
        if (msg.payload?.status === 'ok') { setStatus('open'); broadcast('hello', {}); }
        else setStatus('error', 'The room could not be joined: ' + String(msg.payload?.response?.reason ?? 'refused') + '. Check that Realtime is on in the Supabase project.');
        return;
      }
      if (msg.event !== 'broadcast') return;
      const b = msg.payload ?? {};
      const data = b.payload ?? {};
      const from = String(data.from ?? '');
      if (!from || from === me) return;
      if (b.event === 'bye') { const p = peers.get(from); if (p) { peers.delete(from); emit('leave', { id: from, name: p.name }, p); } return; }
      const peer = hear(from, String(data.name ?? ''));
      if (b.event === 'hello') { broadcast('state', { state: pending ?? {} }); return; }
      if (b.event === 'state') { peer.state = (data.state && typeof data.state === 'object') ? data.state : {}; emit('state', peer.state, peer); return; }
      if (typeof b.event === 'string' && b.event.startsWith('ev:')) { const { from: _f, name: _n, ...rest } = data; emit(b.event.slice(3), rest, peer); }
    };
    ws.onerror = () => { if (status === 'connecting' || status === 'open') setStatus('error', 'The live connection to the Supabase project failed. Check the project URL and the anon key.'); };
    ws.onclose = () => { if (heartbeat) clearInterval(heartbeat); heartbeat = null; if (status === 'open' || status === 'connecting') setStatus('closed', 'The connection closed.'); };
  } catch (error) {
    setStatus('error', 'The live connection could not start: ' + String(error instanceof Error ? error.message : error));
  }
  return room;
}

/**
 * Every other player as a body in the scene: one made by makeBody() per player who joins, moved smoothly to the position and
 * heading they last sent (state.x / y / z / heading), removed when they leave. Call update(dt) every frame.
 */
export function remotePlayers(room: Room, scene: THREE.Object3D, makeBody: (peer: Peer) => THREE.Object3D): { bodies: Map<string, THREE.Object3D>; update(dt: number): void; dispose(): void } {
  const bodies = new Map<string, THREE.Object3D>();
  const offLeave = room.on('leave', (p: { id: string }) => { const b = bodies.get(p.id); if (b) { scene.remove(b); bodies.delete(p.id); } });
  return {
    bodies,
    update(dt) {
      room.tick();
      const k = 1 - Math.exp(-12 * Math.max(0, dt));
      for (const [id, peer] of room.peers) {
        let b = bodies.get(id);
        if (!b) { b = makeBody(peer); b.name = 'Player ' + peer.name; scene.add(b); bodies.set(id, b); }
        const s = peer.state as { x?: number; y?: number; z?: number; heading?: number };
        if (Number.isFinite(s.x) && Number.isFinite(s.z)) {
          b.position.x += (Number(s.x) - b.position.x) * k;
          b.position.z += (Number(s.z) - b.position.z) * k;
          if (Number.isFinite(s.y)) b.position.y += (Number(s.y) - b.position.y) * k;
        }
        if (Number.isFinite(s.heading)) b.rotation.y = Number(s.heading);
      }
    },
    dispose() { offLeave(); for (const b of bodies.values()) scene.remove(b); bodies.clear(); },
  };
}

/** The room's honest state on the game's screen: a RED line until the keys are saved, or when the connection failed. */
export function showRoomNotice(room: Room, container: HTMLElement): () => void {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:absolute;left:8px;right:8px;top:8px;padding:8px 12px;border-radius:8px;background:rgba(127,0,0,0.85);color:#fff;font:600 14px system-ui;z-index:20;pointer-events:none';
  const draw = () => {
    const bad = room.status === 'not-configured' || room.status === 'error' || room.status === 'closed';
    el.textContent = bad ? room.reason || 'Online multiplayer is not connected.' : '';
    el.style.display = bad ? 'block' : 'none';
  };
  draw();
  container.appendChild(el);
  const off = room.on('status', draw);
  return () => { off(); el.remove(); };
}
`;

/** The user asked to play with others online (not two players on one device). PURE. */
export function onlineMultiplayerWanted(prompt: string | null | undefined): boolean {
  const t = String(prompt ?? '');
  const asks = /\b(?:multi\s*-?\s*player|online\s+(?:game|khel\w*|play\w*|match|mode)|friends?\s+(?:ke\s+saath|ke\s+sath|with|online)|dosto\w*\s+(?:ke\s+)?(?:saath|sath)|play\s+with\s+friends|pvp|co\s*-?\s*op|room\s+code|lobby|matchmaking)\b|मल्टीप्लेयर|दोस्तों\s+के\s+साथ/i;
  if (!asks.test(t)) return false;
  if (/\b(?:same\s+(?:device|screen|phone)|ek\s+hi\s+(?:phone|device|screen)|split\s*-?\s*screen|local\s+multi\s*-?\s*player)\b/i.test(t)) return false;
  return !/\b(?:no|not|don'?t|without|bina|nahi|nahin|mat)\b[^.!?\n]{0,16}\b(?:multi\s*-?\s*player|online)\b|\b(?:multi\s*-?\s*player|online)\b[^.!?\n]{0,12}\b(?:nahi|nahin|mat)\b/i.test(t);
}

/** What the builder is told for a multiplayer request: the module, the keys to ask for, the honest notice. */
export const ROOMS_HANDOFF = '🌐 ONLINE MULTIPLAYER runs on the USER\'S OWN Supabase project (src/game/three/rooms.ts): call request_secrets for '
  + ROOM_KEY_NAMES.join(' and ') + ' (the project URL and the anon public key, from the Supabase dashboard → Project Settings → API), then '
  + 'const room = joinRoom({ room: code, name }); show the room code (newRoomCode()) so a friend can type it; every frame room.sendState({ x, y, z, heading }) '
  + 'and remotePlayers(room, scene, makeBody).update(dt) draws the others; room.send(\'shot\', {...}) / room.on(\'shot\', fn) for events. '
  + 'showRoomNotice(room, container) puts the honest RED line on the screen while the keys are missing or the connection fails. '
  + 'Never a fake lobby, fake players or a "searching…" that finds nobody; never NavBharatAI\'s own servers for this.';
