// ONLINE ROYALE — THE SERVER-AUTHORITATIVE MATCH (admin 2026-11-25, "sab karo": the first real online match,
// small and complete before anything scales).
//
// WHAT THIS FILE IS: one room's whole simulation, PURE — no sockets, no timers, no clock of its own. The service
// (matchService.ts) feeds it inputs and the time; everything a player can win or lose is decided HERE, never on
// a phone:
//   • movement is VALIDATED (speed cap, arena bounds, cover blocks) — a teleport is refused and corrected;
//   • a shot is resolved here (cooldown, range, cover in the line of fire, armour, health);
//   • loot belongs to the room — a crate is taken ONCE, by the first valid claim, never by two players;
//   • the zone follows the server clock, not a device clock;
//   • elimination, placement and the single winner are decided once, and the result is frozen.
//
// The rules mirror the offline practice kit (GameRoyaleFoundationGenerator.ts: zone 38 m shrinking 0.22 m/s,
// 12 dmg/s outside, 34-damage shots soaked by armour, medkits 35, armour 50) so the two modes feel the same.

export const ARENA_HALF = 42;
export const MAX_PLAYERS = 4;
/** The kit's player walks at 6 m/s and sprints at 6 × 1.7 = 10.2 m/s; 11 leaves room for rounding, not for a speed hack. */
export const MAX_SPEED = 11;
/** Network jitter: the distance credit a player starts with and may carry on top of MAX_SPEED × elapsed. */
export const MOVE_SLACK = 0.75;
/** Credit stops growing after this much idle time, so a player who stops sending cannot bank a teleport. */
export const MAX_MOVE_WINDOW_S = 0.5;
export const PLAYER_RADIUS = 0.6;
export const SHOT_RANGE = 60;
export const SHOT_DAMAGE = 34;
export const SHOT_COOLDOWN_MS = 250;
export const BOT_SHOT_DAMAGE = 7;
export const BOT_SHOT_COOLDOWN_MS = 1400;
export const BOT_SHOT_RANGE = 24;
export const BOT_SPEED = 2.2;
export const ZONE_START = 38;
export const ZONE_SHRINK_PER_S = 0.22;
export const ZONE_MIN = 4;
/** After the zone reaches its minimum it closes to nothing over ZONE_COLLAPSE_S, so a match ALWAYS ends. */
export const ZONE_COLLAPSE_S = 10;
export const ZONE_DAMAGE_PER_S = 12;
export const MEDKIT_HEAL = 35;
export const ARMOR_POINTS = 50;
export const PICKUP_RADIUS = 1.6;
export const FEED_LINES = 4;

export type LootKind = 'medkit' | 'armor';
export const LOOT_SPOTS: ReadonlyArray<readonly [number, number, LootKind]> = [
  [-12, -5, 'medkit'], [14, 8, 'armor'], [-22, 22, 'medkit'], [26, -20, 'armor'], [2, -30, 'medkit'], [-30, -24, 'armor'],
];
/** Cover blocks, axis-aligned [minX, minZ, maxX, maxZ]. The server uses them for movement AND line of fire; the client draws the same list. */
export const COVER: ReadonlyArray<readonly [number, number, number, number]> = [
  [-6, -14, 6, -12], [16, -2, 18, 6], [-20, 14, -14, 16], [22, 18, 26, 20], [-28, -12, -26, -4], [-4, 6, -2, 12],
];
export const SPAWNS: ReadonlyArray<readonly [number, number]> = [[0, 32], [32, 0], [0, -32], [-32, 0]];

export type Player = {
  id: string; slot: number; name: string; bot: boolean;
  x: number; z: number; yaw: number;
  hp: number; armor: number; alive: boolean;
  /** 1 = winner. 0 while still in the match. */
  place: number; kills: number; damage: number; cause: string;
  lastMoveAt: number; lastShotAt: number;
  /** Metres this player may still move: earned at MAX_SPEED per second, capped, spent by every accepted move. A
   *  per-move allowance would let a client spam tiny moves at one instant and outrun the cap; a budget cannot be. */
  moveCredit: number;
  /** Inputs refused by the server (speed, bounds, cover, eliminated) — a counter, so abuse is visible. */
  rejected: number;
  /** The last input sequence number the server applied (the client reconciles against it). */
  ack: number;
};
export type Crate = { x: number; z: number; kind: LootKind; takenBy: string | null };
export type MatchResult = {
  winner: string;
  places: Array<{ id: string; name: string; bot: boolean; place: number; kills: number; damage: number; cause: string }>;
  endedAt: number;
};
export type Room = {
  id: string; appId: string; startedAt: number; now: number;
  players: Player[]; crates: Crate[]; feed: string[];
  result: MatchResult | null;
};

export function zoneRadius(elapsedS: number): number {
  const e = Math.max(0, elapsedS);
  const r = ZONE_START - e * ZONE_SHRINK_PER_S;
  if (r > ZONE_MIN) return r;
  const closedAt = (ZONE_START - ZONE_MIN) / ZONE_SHRINK_PER_S;
  return Math.max(0, ZONE_MIN * (1 - (e - closedAt) / ZONE_COLLAPSE_S));
}

export function createRoom(id: string, appId: string, entrants: Array<{ id: string; name: string; bot: boolean }>, now: number): Room {
  if (entrants.length < 1 || entrants.length > MAX_PLAYERS) throw new Error('A room holds 1 to ' + MAX_PLAYERS + ' players.');
  const players = entrants.map((e, slot): Player => ({
    id: e.id, slot, name: e.name, bot: e.bot, x: SPAWNS[slot][0], z: SPAWNS[slot][1], yaw: Math.atan2(-SPAWNS[slot][0], -SPAWNS[slot][1]),
    hp: 100, armor: 0, alive: true, place: 0, kills: 0, damage: 0, cause: '', lastMoveAt: now, lastShotAt: -Infinity, moveCredit: MOVE_SLACK, rejected: 0, ack: 0,
  }));
  return { id, appId, startedAt: now, now, players, crates: LOOT_SPOTS.map(([x, z, kind]) => ({ x, z, kind, takenBy: null })), feed: [], result: null };
}

const say = (room: Room, line: string): void => { room.feed = [...room.feed, line].slice(-FEED_LINES); };
const elapsedS = (room: Room): number => (room.now - room.startedAt) / 1000;
export const roomRadius = (room: Room): number => zoneRadius(elapsedS(room));

/** Inside a cover block, grown by the player's radius. */
export function blocked(x: number, z: number): boolean {
  for (const [a, b, c, d] of COVER) if (x > a - PLAYER_RADIUS && x < c + PLAYER_RADIUS && z > b - PLAYER_RADIUS && z < d + PLAYER_RADIUS) return true;
  return false;
}
const inArena = (x: number, z: number): boolean => Math.abs(x) <= ARENA_HALF - 0.5 && Math.abs(z) <= ARENA_HALF - 0.5;

/** Distance along the ray (ox,oz)+t(dx,dz) to the first cover block, or Infinity. Slab test. */
function coverHit(ox: number, oz: number, dx: number, dz: number, maxT: number): number {
  let best = Infinity;
  for (const [a, b, c, d] of COVER) {
    let t0 = 0, t1 = maxT;
    for (const [o, dir, lo, hi] of [[ox, dx, a, c], [oz, dz, b, d]] as const) {
      if (Math.abs(dir) < 1e-9) { if (o < lo || o > hi) { t0 = Infinity; break; } continue; }
      let n = (lo - o) / dir, f = (hi - o) / dir; if (n > f) [n, f] = [f, n];
      t0 = Math.max(t0, n); t1 = Math.min(t1, f); if (t0 > t1) { t0 = Infinity; break; }
    }
    if (t0 < best) best = t0;
  }
  return best;
}

export type MoveVerdict = { ok: true } | { ok: false; reason: 'ended' | 'eliminated' | 'invalid' | 'speed' | 'bounds' | 'cover' };

/**
 * A client's position claim. Accepted only if it is reachable from the last accepted position at MAX_SPEED in the
 * time since (capped), inside the arena and outside cover. A refusal leaves the server's position as it was.
 */
export function applyMove(room: Room, playerId: string, x: unknown, z: unknown, yaw: unknown, seq: unknown, now: number): MoveVerdict {
  const p = room.players.find((q) => q.id === playerId);
  if (!p || room.result) return { ok: false, reason: 'ended' };
  if (!p.alive) { p.rejected++; return { ok: false, reason: 'eliminated' }; }
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) { p.rejected++; return { ok: false, reason: 'invalid' }; }
  const earned = MAX_SPEED * Math.max(0, (now - p.lastMoveAt) / 1000);
  p.moveCredit = Math.min(MAX_SPEED * MAX_MOVE_WINDOW_S + MOVE_SLACK, p.moveCredit + earned);
  p.lastMoveAt = Math.max(p.lastMoveAt, now);
  const distance = Math.hypot(x - p.x, z - p.z);
  if (distance > p.moveCredit) { p.rejected++; return { ok: false, reason: 'speed' }; }
  if (!inArena(x, z)) { p.rejected++; return { ok: false, reason: 'bounds' }; }
  if (blocked(x, z)) { p.rejected++; return { ok: false, reason: 'cover' }; }
  p.x = x; p.z = z; p.moveCredit -= distance;
  if (typeof yaw === 'number' && Number.isFinite(yaw)) p.yaw = yaw;
  if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq > p.ack) p.ack = seq;
  claimLoot(room, p);
  return { ok: true };
}

/** The ONE place loot changes hands. A crate with a holder is never handed out again. */
export function claimLoot(room: Room, p: Player): Crate | null {
  if (room.result || !p.alive) return null;
  const crate = room.crates.find((c) => c.takenBy === null && Math.hypot(c.x - p.x, c.z - p.z) <= PICKUP_RADIUS);
  if (!crate) return null;
  crate.takenBy = p.id;
  if (crate.kind === 'medkit') p.hp = Math.min(100, p.hp + MEDKIT_HEAL); else p.armor = Math.min(100, p.armor + ARMOR_POINTS);
  say(room, p.name + ' picked up ' + (crate.kind === 'medkit' ? 'a medkit' : 'armour'));
  return crate;
}

export type ShotVerdict = { ok: false; reason: 'ended' | 'eliminated' | 'cooldown' | 'invalid' } | { ok: true; hit: string | null };

/** A shot along a horizontal yaw (0 = +z, as atan2(dx, dz)). Hits the nearest living opponent the cover does not hide. */
export function applyShot(room: Room, shooterId: string, yaw: unknown, now: number): ShotVerdict {
  const s = room.players.find((q) => q.id === shooterId);
  if (!s || room.result) return { ok: false, reason: 'ended' };
  if (!s.alive) { s.rejected++; return { ok: false, reason: 'eliminated' }; }
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) { s.rejected++; return { ok: false, reason: 'invalid' }; }
  const cooldown = s.bot ? BOT_SHOT_COOLDOWN_MS : SHOT_COOLDOWN_MS;
  if (now - s.lastShotAt < cooldown) return { ok: false, reason: 'cooldown' };
  s.lastShotAt = now; s.yaw = yaw;
  const range = s.bot ? BOT_SHOT_RANGE : SHOT_RANGE;
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  let target: Player | null = null, targetT = Infinity;
  for (const p of room.players) {
    if (p === s || !p.alive) continue;
    const ox = p.x - s.x, oz = p.z - s.z, t = ox * dx + oz * dz;
    if (t <= 0 || t > range) continue;
    const miss = Math.abs(ox * dz - oz * dx);
    if (miss <= PLAYER_RADIUS && t < targetT) { target = p; targetT = t; }
  }
  if (!target || coverHit(s.x, s.z, dx, dz, targetT) < targetT) return { ok: true, hit: null };
  damage(room, target, s.bot ? BOT_SHOT_DAMAGE : SHOT_DAMAGE, s);
  return { ok: true, hit: target.id };
}

function damage(room: Room, target: Player, amount: number, by: Player): void {
  const soaked = Math.min(target.armor, amount);
  const before = target.hp;
  target.armor -= soaked;
  target.hp = Math.max(0, target.hp - (amount - soaked));
  by.damage += soaked + (before - target.hp);
  if (target.hp <= 0) {
    by.kills++;
    say(room, by.name + ' eliminated ' + target.name);
    eliminate(room, target, by.name);
  }
}

function eliminate(room: Room, p: Player, cause: string): void {
  if (!p.alive || room.result) return;
  p.alive = false; p.cause = cause;
  p.place = room.players.filter((q) => q.alive).length + 1;
  checkEnd(room);
}

/** A player whose reconnect grace ran out leaves the match: eliminated, never silently kept alive. */
export function forfeit(room: Room, playerId: string): void {
  const p = room.players.find((q) => q.id === playerId);
  if (!p || !p.alive || room.result) return;
  p.hp = 0;
  say(room, p.name + ' left the match');
  eliminate(room, p, 'left');
}

/**
 * The match ends when one player stands, or when no human is left alive (a bots-only room is not kept running on
 * the platform's CPU). Remaining players are ranked by health; the result is written exactly ONCE.
 */
function checkEnd(room: Room): void {
  if (room.result) return;
  const alive = room.players.filter((p) => p.alive);
  if (alive.length > 1 && alive.some((p) => !p.bot)) return;
  const ranked = [...alive].sort((a, b) => b.hp - a.hp || a.slot - b.slot);
  ranked.forEach((p, i) => { p.place = i + 1; });
  const winner = ranked[0];
  if (!winner) throw new Error('A match cannot end with no player at all.');
  room.result = {
    winner: winner.id,
    places: [...room.players].sort((a, b) => a.place - b.place).map((p) => ({ id: p.id, name: p.name, bot: p.bot, place: p.place, kills: p.kills, damage: Math.round(p.damage), cause: p.cause })),
    endedAt: room.now,
  };
  say(room, winner.name + ' wins the match');
  Object.freeze(room.result.places);
  Object.freeze(room.result);
}

/** Advance the server clock: the zone, the bots. `now` is the service's clock; dt is capped so a stall cannot skip the zone ahead. */
export function stepRoom(room: Room, now: number): void {
  if (room.result) return;
  const dt = Math.min(0.1, Math.max(0, (now - room.now) / 1000));
  room.now = now;
  if (dt <= 0) return;
  for (const p of room.players) if (p.alive && p.bot) stepBot(room, p, dt, now);
  // Zone damage lands on everyone in the same instant. If it would take the last players down together, the one with
  // the most health BEFORE the tick stands — a match always has a single winner.
  const radius = roomRadius(room);
  const before = new Map(room.players.map((p) => [p.id, p.hp]));
  const hurt: Player[] = [];
  for (const p of room.players) {
    if (!p.alive || Math.hypot(p.x, p.z) <= radius) continue;
    p.hp = Math.max(0, p.hp - ZONE_DAMAGE_PER_S * dt);
    if (p.hp <= 0) hurt.push(p);
  }
  if (hurt.length) {
    const aliveAfter = room.players.filter((p) => p.alive && p.hp > 0).length;
    hurt.sort((a, b) => before.get(a.id)! - before.get(b.id)! || b.slot - a.slot);
    if (aliveAfter === 0) { const last = hurt.pop()!; last.hp = Math.max(1, last.hp); }
    // Lowest health first, so the one who lasted longer gets the better place. checkEnd runs once, after all of them.
    for (const p of hurt) {
      say(room, p.name + ' was caught by the zone');
      p.alive = false; p.cause = 'zone';
      p.place = room.players.filter((q) => q.alive).length + 1;
    }
  }
  checkEnd(room);
}

function stepBot(room: Room, b: Player, dt: number, now: number): void {
  const radius = roomRadius(room);
  let goal: { x: number; z: number } | null = null, target: Player | null = null, targetD = Infinity;
  for (const p of room.players) {
    if (p === b || !p.alive) continue;
    const d = Math.hypot(p.x - b.x, p.z - b.z);
    if (d < targetD) { target = p; targetD = d; }
  }
  if (Math.hypot(b.x, b.z) > radius - 2) goal = { x: 0, z: 0 };
  else if (target && targetD < 20) goal = targetD > 8 ? target : null;
  else {
    let best = Infinity;
    for (const c of room.crates) {
      if (c.takenBy || Math.hypot(c.x, c.z) > radius - 2) continue;
      const d = Math.hypot(c.x - b.x, c.z - b.z); if (d < best) { best = d; goal = c; }
    }
  }
  if (goal) {
    const dx = goal.x - b.x, dz = goal.z - b.z, d = Math.hypot(dx, dz);
    if (d > 0.01) {
      const step = Math.min(d, BOT_SPEED * dt), nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
      // Slide along cover rather than through it.
      if (!blocked(nx, nz)) { b.x = nx; b.z = nz; } else if (!blocked(nx, b.z)) b.x = nx; else if (!blocked(b.x, nz)) b.z = nz;
      b.yaw = Math.atan2(dx, dz);
      b.lastMoveAt = now;
      claimLoot(room, b);
    }
  }
  if (target && targetD <= BOT_SHOT_RANGE) applyShot(room, b.id, Math.atan2(target.x - b.x, target.z - b.z), now);
}

/** What every client sees each tick. Positions only for the living; no hidden state leaks (no other player's cooldowns). */
export function snapshot(room: Room) {
  return {
    t: 'state' as const,
    time: Math.floor(elapsedS(room)),
    radius: Math.round(roomRadius(room) * 10) / 10,
    players: room.players.map((p) => ({ id: p.id, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, yaw: Math.round(p.yaw * 100) / 100, hp: Math.ceil(p.hp), armor: Math.ceil(p.armor), alive: p.alive, place: p.place, ack: p.ack })),
    crates: room.crates.map((c) => c.takenBy === null),
    feed: room.feed,
  };
}
