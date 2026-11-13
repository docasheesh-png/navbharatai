// Battle-royale core — the match logic of a "last one standing" game, for ONE player against bots.
//
// WHAT THIS IS AND IS NOT. This is the match: a safe circle that shrinks on a schedule and hurts anyone outside it,
// loot scattered over the map, bots that loot, run for the circle and shoot each other and the player, ranks, and
// a match that always ends. It is a single-player simulation with no drawing and no networking. The game draws the
// map, the people and the zone (three.js, canvas or DOM) from `snapshot()`, moves the player itself, and reports the
// player's shots through `hitBot()` — the weapons, aim and camera are the shooter kit (`generate_game_systems`).
// It is NOT multiplayer: 50-100 real players at once needs live game servers, anti-cheat and matchmaking, which is
// an infrastructure and cost decision this kit does not pretend to make.
//
// WHY THIS IS A RECIPE AND NOT LEFT TO THE MODEL. The match logic of a royale game goes wrong in specific ways:
//
//   • A MATCH THAT NEVER ENDS. Two bots out of each other's range inside a tiny final circle, or a player hiding
//     in a corner, stall a hand-written match for ever. Here the zone does not stop at its last circle: after a
//     hold it keeps shrinking to nothing, so a match ends in bounded time whatever anyone does. A test runs it.
//   • A SAFE ZONE THAT JUMPS OR LEAVES YOU STRANDED. Each new circle is chosen INSIDE the previous one, so the safe
//     area only ever shrinks and the next circle is always reachable; it is announced before it moves.
//   • LOOT THAT IS DUPLICATED OR LOST. Picking up is one atomic step: the inventory accepts the item, and only then
//     is it removed from the ground. A full inventory leaves the item where it lies. Every item is on the ground or
//     in exactly one inventory — a test proves the total across hundreds of pickups.
//   • RANKS THAT DO NOT ADD UP. Two players "in 3rd place", or a winner who is "2nd". A rank is the number alive at
//     the moment of death, so ranks are unique, 1 is the last one standing, and they never skip.
//   • BOTS THAT STAND IN THE ZONE AND DIE, OR NEVER FIGHT. Bots head for the safe circle before it closes on them,
//     pick up a weapon when they have none, and fight what is in range — with a hit chance that falls with distance.
//   • A BOT TABLE THAT DRIFTS FROM THE REAL WEAPONS. The bots' damage and fire rate are the shooter kit's weapon
//     numbers; a test compares the two so the player's rifle and a bot's rifle are the same rifle.
//   • AN UNBOUNDED MATCH. Bots, loot, map size, step size and event rate are capped.
//
// Honest limits: the bots are simple (no cover, no vehicles, no building interiors) and fight by chance, not by
// aiming; there are no vehicles or airdrops; and the player's own movement and shooting are the game's.
//
// PURE — no I/O, no DOM, no three.js, no import from another game layer.

export interface GameRoyaleResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const RNG = String.raw`/** A small seeded generator (mulberry32). One uint32 of state, so a match replays identically from its seed. */
export class RoyaleRng {
  private s: number;
  constructor(seed: number = 1) { this.s = (Math.floor(Number.isFinite(seed) ? seed : 1) >>> 0) || 1; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
}

/** A finite number clamped to [lo, hi]; anything else becomes fallback. */
export function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}
`;

const ZONE = String.raw`import { RoyaleRng, num } from './rng';

export interface Circle { x: number; z: number; r: number }
/** One step of the closing circle: wait, then shrink to a circle of radius (a FRACTION of the map radius), hurting outsiders. */
export interface ZonePhase { wait: number; shrink: number; radius: number; damage: number }
export type ZoneStatus = 'waiting' | 'shrinking' | 'final';

/** About eight minutes: the circle halves a few times, then closes. Radius is a fraction of the map; damage is hp per second. */
export const DEFAULT_PHASES: readonly ZonePhase[] = [
  { wait: 45, shrink: 40, radius: 0.62, damage: 1 },
  { wait: 40, shrink: 35, radius: 0.42, damage: 2 },
  { wait: 35, shrink: 30, radius: 0.27, damage: 3 },
  { wait: 30, shrink: 25, radius: 0.16, damage: 5 },
  { wait: 25, shrink: 20, radius: 0.09, damage: 8 },
  { wait: 20, shrink: 15, radius: 0.04, damage: 12 },
];

/** After the last circle the zone holds, then closes to NOTHING — so a match always ends. */
const FINAL_HOLD = 45;
const FINAL_CLOSE = 60;

/** Keep only phases that are valid and strictly smaller than the one before; clamp every number. */
export function sanitizePhases(raw: readonly ZonePhase[] | undefined): ZonePhase[] {
  const out: ZonePhase[] = [];
  let last = 1;
  for (const p of Array.isArray(raw) && raw.length ? raw : DEFAULT_PHASES) {
    // an out-of-range radius is REJECTED, not clamped: clamping 2 to 0.99 would quietly invent a phase nobody asked for
    const radius = typeof p?.radius === 'number' && Number.isFinite(p.radius) ? p.radius : 0;
    if (radius < 0.01 || radius >= last) continue;
    out.push({ wait: num(p.wait, 1, 600, 30), shrink: num(p.shrink, 1, 600, 20), radius, damage: num(p.damage, 0, 100, 1) });
    last = radius;
    if (out.length >= 12) break;
  }
  return out.length ? out : DEFAULT_PHASES.map((p) => ({ ...p }));
}

/**
 * The safe circle. It only ever SHRINKS, and each new circle lies entirely inside the one before it, so the next
 * safe area is always reachable and never jumps. It is announced (see next) for the whole wait before it closes.
 * After the last circle it holds, then closes to nothing: nobody can stall a match for ever.
 */
export class Zone {
  private phases: ZonePhase[];
  private idx = 0;
  private clock = 0;
  private cur: Circle;
  private from: Circle;
  private to: Circle;
  private rng: RoyaleRng;
  private readonly mapRadius: number;

  constructor(mapRadius: number, seed: number, phases?: readonly ZonePhase[]) {
    this.mapRadius = num(mapRadius, 50, 20000, 500);
    const base = sanitizePhases(phases);
    const lastDamage = base[base.length - 1].damage;
    // the closing phases: a hold at the last circle, then everything closes to a point
    this.phases = [...base, { wait: FINAL_HOLD, shrink: FINAL_CLOSE, radius: 0, damage: Math.max(10, lastDamage * 2) }];
    this.rng = new RoyaleRng(seed);
    this.cur = { x: 0, z: 0, r: this.mapRadius };
    this.from = { ...this.cur };
    this.to = this.pick(this.cur, this.phases[0].radius * this.mapRadius);
  }

  private pick(inside: Circle, r: number): Circle {
    // a centre that keeps the whole new circle inside the old one (uniform over the allowed disc)
    const slack = Math.max(0, inside.r - r);
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = Math.sqrt(this.rng.next()) * slack;
    return { x: inside.x + Math.cos(angle) * dist, z: inside.z + Math.sin(angle) * dist, r };
  }

  get phase(): number { return Math.min(this.idx, this.phases.length - 1); }
  get status(): ZoneStatus {
    if (this.idx >= this.phases.length) return 'final';
    return this.clock < this.phases[this.idx].wait ? 'waiting' : 'shrinking';
  }
  /** The safe circle right now. */
  get circle(): Circle { return { ...this.cur }; }
  /** The circle it is about to close to — shown to the player for the whole wait. null once everything has closed. */
  get next(): Circle | null { return this.idx >= this.phases.length ? null : { ...this.to }; }
  get timeLeft(): number {
    if (this.idx >= this.phases.length) return 0;
    const p = this.phases[this.idx];
    return this.clock < p.wait ? p.wait - this.clock : p.wait + p.shrink - this.clock;
  }
  /** Seconds the whole schedule takes, from the start until everything has closed. */
  get totalSeconds(): number { return this.phases.reduce((t, p) => t + p.wait + p.shrink, 0); }

  contains(x: number, z: number): boolean {
    const dx = x - this.cur.x;
    const dz = z - this.cur.z;
    return dx * dx + dz * dz <= this.cur.r * this.cur.r;
  }
  distanceOutside(x: number, z: number): number {
    return Math.max(0, Math.hypot(x - this.cur.x, z - this.cur.z) - this.cur.r);
  }
  /** Hit points per second to take at this spot: 0 inside the circle, the current phase's damage outside. */
  damagePerSecond(x: number, z: number): number {
    if (this.contains(x, z)) return 0;
    return this.phases[Math.min(this.idx, this.phases.length - 1)].damage;
  }

  /** Advance by dt seconds. Returns the events that happened: 'announced' (a new circle is shown) and 'shrinking' (it starts to close). */
  update(dt: number): Array<'announced' | 'shrinking' | 'closed'> {
    const events: Array<'announced' | 'shrinking' | 'closed'> = [];
    let left = typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? Math.min(dt, 5) : 0;
    while (left > 0 && this.idx < this.phases.length) {
      const p = this.phases[this.idx];
      const before = this.clock;
      const room = p.wait + p.shrink - this.clock;
      const step = Math.min(left, room);
      this.clock += step;
      left -= step;
      if (before < p.wait && this.clock >= p.wait) { this.from = { ...this.cur }; events.push('shrinking'); }
      if (this.clock >= p.wait) {
        const k = Math.min(1, (this.clock - p.wait) / p.shrink);
        this.cur = { x: this.from.x + (this.to.x - this.from.x) * k, z: this.from.z + (this.to.z - this.from.z) * k, r: this.from.r + (this.to.r - this.from.r) * k };
      }
      if (this.clock >= p.wait + p.shrink) {
        this.cur = { ...this.to };
        this.idx++;
        this.clock = 0;
        if (this.idx < this.phases.length) {
          this.from = { ...this.cur };
          this.to = this.phases[this.idx].radius === 0 ? { x: this.cur.x, z: this.cur.z, r: 0 } : this.pick(this.cur, this.phases[this.idx].radius * this.mapRadius);
          events.push('announced');
        } else events.push('closed');
      }
    }
    return events;
  }
}
`;

const LOOT = String.raw`import { RoyaleRng } from './rng';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export type LootKind = 'weapon' | 'ammo' | 'heal' | 'armor';
/** The weapon kinds of the shooter kit (generate_game_systems), so loot maps straight onto new Weapon(kind). */
export type WeaponKind = 'pistol' | 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'bow';

export interface LootItem { id: number; kind: LootKind; rarity: Rarity; x: number; z: number; weapon?: WeaponKind; amount: number }

/** Heal and armor are small and common; the strong weapons are rare. Weights, not percentages. */
const KIND_WEIGHT: ReadonlyArray<readonly [LootKind, number]> = [['weapon', 30], ['ammo', 30], ['heal', 25], ['armor', 15]];
const RARITY_WEIGHT: ReadonlyArray<readonly [Rarity, number]> = [['common', 55], ['uncommon', 28], ['rare', 14], ['epic', 3]];
const WEAPONS_BY_RARITY: Readonly<Record<Rarity, readonly WeaponKind[]>> = {
  common: ['pistol', 'bow'],
  uncommon: ['smg', 'shotgun', 'pistol'],
  rare: ['rifle', 'shotgun', 'smg'],
  epic: ['sniper', 'rifle'],
};

function weighted<T>(rng: RoyaleRng, table: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, w] of table) total += w;
  let roll = rng.next() * total;
  for (const [v, w] of table) { roll -= w; if (roll <= 0) return v; }
  return table[table.length - 1][0];
}

export const MAX_LOOT = 500;

/**
 * Scatter loot over the map: at least minGap apart, inside the map, deterministic from the seed. A bounded number
 * of attempts per item, so a crowded request returns fewer items instead of looping.
 */
export function spawnLoot(rng: RoyaleRng, mapRadius: number, count: number, minGap: number = 8): LootItem[] {
  const n = Math.max(0, Math.min(MAX_LOOT, Math.floor(Number.isFinite(count) ? count : 0)));
  const R = Math.max(10, mapRadius * 0.95);
  const out: LootItem[] = [];
  for (let i = 0; i < n; i++) {
    let spot: { x: number; z: number } | null = null;
    for (let attempt = 0; attempt < 30 && !spot; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * R;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (out.every((o) => (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) >= minGap * minGap)) spot = { x, z };
    }
    if (!spot) continue;
    const kind = weighted(rng, KIND_WEIGHT);
    const rarity = weighted(rng, RARITY_WEIGHT);
    const item: LootItem = { id: i + 1, kind, rarity, x: spot.x, z: spot.z, amount: 1 };
    if (kind === 'weapon') {
      const pool = WEAPONS_BY_RARITY[rarity];
      item.weapon = pool[Math.floor(rng.next() * pool.length)];
    } else if (kind === 'ammo') {
      item.weapon = (['pistol', 'rifle', 'smg', 'shotgun', 'sniper', 'bow'] as const)[Math.floor(rng.next() * 6)];
      item.amount = { common: 20, uncommon: 30, rare: 45, epic: 60 }[rarity];
    } else if (kind === 'heal') item.amount = { common: 25, uncommon: 40, rare: 60, epic: 100 }[rarity];
    else item.amount = { common: 20, uncommon: 35, rare: 50, epic: 75 }[rarity];
    out.push(item);
  }
  return out;
}

export const WEAPON_SLOTS = 3;
export const MAX_HEALS = 5;
export const MAX_ARMOR = 100;
export const MAX_AMMO = 240;

export type PickResult = { ok: true; item: LootItem } | { ok: false; reason: 'nothing_there' | 'slots_full' | 'already_have' | 'ammo_full' | 'heals_full' | 'armor_full' };

/** What one fighter carries. Bounded everywhere: three weapon slots, five heals, 100 armor, 240 rounds per weapon kind. */
export class Inventory {
  weapons: WeaponKind[] = [];
  ammo: Partial<Record<WeaponKind, number>> = {};
  heals = 0;
  armor = 0;

  /** Can this item be taken right now? The SAME check pickUp runs, so a prompt never offers what would fail. */
  accepts(item: LootItem): PickResult {
    if (item.kind === 'weapon') {
      if (!item.weapon) return { ok: false, reason: 'nothing_there' };
      if (this.weapons.includes(item.weapon)) return { ok: false, reason: 'already_have' };
      if (this.weapons.length >= WEAPON_SLOTS) return { ok: false, reason: 'slots_full' };
    } else if (item.kind === 'ammo') {
      if (!item.weapon) return { ok: false, reason: 'nothing_there' };
      if ((this.ammo[item.weapon] ?? 0) >= MAX_AMMO) return { ok: false, reason: 'ammo_full' };
    } else if (item.kind === 'heal') {
      if (this.heals >= MAX_HEALS) return { ok: false, reason: 'heals_full' };
    } else if (this.armor >= MAX_ARMOR) return { ok: false, reason: 'armor_full' };
    return { ok: true, item };
  }

  /** Take an item that accepts() said yes to. */
  add(item: LootItem): void {
    if (item.kind === 'weapon' && item.weapon) {
      this.weapons.push(item.weapon);
      this.ammo[item.weapon] = Math.min(MAX_AMMO, (this.ammo[item.weapon] ?? 0) + 24);
    } else if (item.kind === 'ammo' && item.weapon) this.ammo[item.weapon] = Math.min(MAX_AMMO, (this.ammo[item.weapon] ?? 0) + item.amount);
    else if (item.kind === 'heal') this.heals++;
    else if (item.kind === 'armor') this.armor = Math.min(MAX_ARMOR, this.armor + item.amount);
  }

  /** The best weapon we hold that still has ammo, or null. Strongest first. */
  best(): WeaponKind | null {
    for (const k of ['sniper', 'rifle', 'smg', 'shotgun', 'pistol', 'bow'] as const) {
      if (this.weapons.includes(k) && (this.ammo[k] ?? 0) > 0) return k;
    }
    return null;
  }
}

/** The loot lying on the map. */
export class LootField {
  private items = new Map<number, LootItem>();
  constructor(items: LootItem[]) { for (const it of items) this.items.set(it.id, it); }

  remaining(): number { return this.items.size; }
  list(): LootItem[] { return Array.from(this.items.values()).map((i) => ({ ...i })); }
  get(id: number): LootItem | undefined { return this.items.get(id); }

  /** The nearest item within radius, or null. Ties go to the lower id, so the choice is deterministic. */
  nearest(x: number, z: number, radius: number): LootItem | null {
    let best: LootItem | null = null;
    let bestD = radius * radius;
    for (const it of this.items.values()) {
      const d = (it.x - x) * (it.x - x) + (it.z - z) * (it.z - z);
      if (d < bestD || (d === bestD && best && it.id < best.id)) { best = it; bestD = d; }
    }
    return best;
  }

  /**
   * ATOMIC pickup: the inventory is asked FIRST, and the item leaves the ground only if it said yes. So an item is
   * never lost (a full inventory leaves it where it lies) and never duplicated (it is gone the moment it is taken).
   */
  pickUp(inv: Inventory, id: number): PickResult {
    const item = this.items.get(id);
    if (!item) return { ok: false, reason: 'nothing_there' };
    const can = inv.accepts(item);
    if (!can.ok) return can;
    inv.add(item);
    this.items.delete(id);
    return { ok: true, item };
  }
}
`;

const BOTS = String.raw`import { RoyaleRng } from './rng';
import { Inventory, LootField, type WeaponKind } from './loot';
import type { Zone } from './zone';

/**
 * What a bot needs to fight with. The numbers are the shooter kit's WEAPONS table (a test compares them), so the
 * player's rifle and a bot's rifle are the same rifle. range = how far a bot will shoot from, in metres.
 */
export const BOT_WEAPONS: Readonly<Record<WeaponKind, { damage: number; fireRate: number; pellets: number; range: number }>> = {
  pistol:  { damage: 20, fireRate: 4,   pellets: 1, range: 35 },
  rifle:   { damage: 14, fireRate: 9,   pellets: 1, range: 70 },
  smg:     { damage: 9,  fireRate: 13,  pellets: 1, range: 40 },
  shotgun: { damage: 9,  fireRate: 1.2, pellets: 8, range: 18 },
  sniper:  { damage: 90, fireRate: 0.8, pellets: 1, range: 130 },
  bow:     { damage: 35, fireRate: 1.1, pellets: 1, range: 45 },
};

export type BotState = 'loot' | 'zone' | 'fight' | 'roam' | 'dead';

export interface Fighter {
  id: number;
  name: string;
  isPlayer: boolean;
  x: number; z: number;
  hp: number; maxHp: number;
  inv: Inventory;
  alive: boolean;
  kills: number;
}

export interface Bot extends Fighter {
  state: BotState;
  cooldown: number;
  /** 0.4 .. 0.9 — how well this bot shoots. */
  skill: number;
  roam: { x: number; z: number };
  healT: number;
}

export interface BotWorld {
  zone: Zone;
  loot: LootField;
  rng: RoyaleRng;
  mapRadius: number;
  fighters: readonly Fighter[];
  /** Called when a shot lands. The match applies it (armor, death, ranks, events). */
  shoot(attacker: Fighter, target: Fighter, weapon: WeaponKind, damage: number): void;
  /** Called when a bot takes loot, so the match can report it. */
  picked(who: Fighter, item: { id: number; kind: string }): void;
}

export const BOT_SPEED = 5.5;
export const PICKUP_RADIUS = 2.5;
const LOOT_SEEK = 70;

export function dist(a: { x: number; z: number }, b: { x: number; z: number }): number { return Math.hypot(a.x - b.x, a.z - b.z); }

/** Chance one shot hits, by distance: close shots land, far ones mostly miss; skill scales it. Never below 4% or above 92%. */
export function hitChance(distance: number, range: number, skill: number): number {
  // a distance that is not a number is as far as it gets (never NaN); a skill that is not a number is an average shot
  const d = typeof distance === 'number' && Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
  const s = typeof skill === 'number' && Number.isFinite(skill) ? Math.max(0, Math.min(1, skill)) : 0.6;
  const closeness = 1 - Math.min(1, d / Math.max(1, Number.isFinite(range) ? range : 1));
  return Math.max(0.04, Math.min(0.92, (0.15 + 0.85 * closeness) * s));
}

function moveToward(f: Fighter, tx: number, tz: number, speed: number, dt: number, limit: number): void {
  const dx = tx - f.x;
  const dz = tz - f.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  const s = Math.min(d, speed * dt);
  f.x += (dx / d) * s;
  f.z += (dz / d) * s;
  const r = Math.hypot(f.x, f.z);
  if (r > limit) { f.x *= limit / r; f.z *= limit / r; }
}

/** One bot, one step. Priority: get out of the zone, then arm up, then fight what is in range, else head for the next circle. */
export function stepBot(bot: Bot, w: BotWorld, dt: number): void {
  if (!bot.alive) { bot.state = 'dead'; return; }
  bot.cooldown = Math.max(0, bot.cooldown - dt);

  // heal when hurt and not in a fight (a few seconds to use one)
  if (bot.healT > 0) { bot.healT -= dt; if (bot.healT <= 0) bot.hp = Math.min(bot.maxHp, bot.hp + 40); return; }

  const zone = w.zone;
  const next = zone.next;
  const outside = !zone.contains(bot.x, bot.z);
  const aim = next ?? zone.circle;
  // run for the circle if outside it, or if it is about to close on us (inside the current one but outside the next)
  const closing = next !== null && zone.status === 'shrinking' && Math.hypot(bot.x - aim.x, bot.z - aim.z) > aim.r * 0.9;

  const weapon = bot.inv.best();
  let enemy: Fighter | null = null;
  let enemyD = Infinity;
  for (const f of w.fighters) {
    if (f === bot || !f.alive) continue;
    const d = dist(bot, f);
    if (d < enemyD) { enemy = f; enemyD = d; }
  }
  const reach = weapon ? BOT_WEAPONS[weapon].range : 0;

  if (bot.hp < 45 && bot.inv.heals > 0 && (!enemy || enemyD > 25)) {
    bot.inv.heals--; bot.healT = 3; bot.state = 'loot'; return;
  }

  if (outside || closing) {
    bot.state = 'zone';
    moveToward(bot, aim.x, aim.z, BOT_SPEED * 1.15, dt, w.mapRadius);
  } else if (!weapon) {
    const spot = w.loot.nearest(bot.x, bot.z, LOOT_SEEK);
    if (spot) {
      bot.state = 'loot';
      moveToward(bot, spot.x, spot.z, BOT_SPEED, dt, w.mapRadius);
    } else { bot.state = 'roam'; moveToward(bot, bot.roam.x, bot.roam.z, BOT_SPEED, dt, w.mapRadius); }
  } else if (enemy && enemyD <= reach * 1.1) {
    bot.state = 'fight';
    // hold a comfortable distance: close in when far, back off when a shotgun is on us
    const want = reach * 0.55;
    if (enemyD > want * 1.2) moveToward(bot, enemy.x, enemy.z, BOT_SPEED * 0.7, dt, w.mapRadius);
    else if (enemyD < want * 0.5) moveToward(bot, bot.x - (enemy.x - bot.x), bot.z - (enemy.z - bot.z), BOT_SPEED * 0.6, dt, w.mapRadius);
    if (bot.cooldown <= 0 && (bot.inv.ammo[weapon] ?? 0) > 0) {
      const spec = BOT_WEAPONS[weapon];
      bot.cooldown = 1 / spec.fireRate;
      bot.inv.ammo[weapon] = (bot.inv.ammo[weapon] ?? 0) - 1;
      if (w.rng.next() < hitChance(enemyD, spec.range, bot.skill)) w.shoot(bot, enemy, weapon, spec.damage * spec.pellets);
    }
  } else {
    // pick up anything useful on the way, otherwise walk to the next circle
    const spot = w.loot.nearest(bot.x, bot.z, 25);
    if (spot && bot.inv.accepts(spot).ok) {
      bot.state = 'loot';
      moveToward(bot, spot.x, spot.z, BOT_SPEED, dt, w.mapRadius);
    } else {
      bot.state = 'roam';
      moveToward(bot, aim.x, aim.z, BOT_SPEED * 0.85, dt, w.mapRadius);
    }
  }

  // take what is underfoot (atomic: the inventory is asked first)
  const here = w.loot.nearest(bot.x, bot.z, PICKUP_RADIUS);
  if (here) {
    const r = w.loot.pickUp(bot.inv, here.id);
    if (r.ok) w.picked(bot, r.item);
  }
}
`;

const MATCH = String.raw`import { RoyaleRng, num } from './rng';
import { Zone, type ZonePhase, type Circle, type ZoneStatus } from './zone';
import { Inventory, LootField, spawnLoot, MAX_LOOT, type LootItem, type WeaponKind } from './loot';
import { BOT_WEAPONS, PICKUP_RADIUS, stepBot, dist, type Bot, type Fighter } from './bots';

export interface MatchOptions {
  seed?: number;
  /** Radius of the playable map, in metres. */
  mapRadius?: number;
  /** Bots in the match (the player is one more). */
  botCount?: number;
  lootCount?: number;
  phases?: readonly ZonePhase[];
  /** Where the player starts; defaults to a random spot inside the map. */
  start?: { x: number; z: number };
  /** Called for everything that happens: ZONE_ANNOUNCED, ZONE_SHRINKING, ZONE_CLOSED, LOOT_PICKED, KILL, PLAYER_HIT, PLAYER_DIED, MATCH_ENDED. */
  onEvent?: (name: string, payload: Record<string, unknown>) => void;
}

export type MatchStatus = 'playing' | 'ended';
export interface MatchSnapshot {
  time: number; status: MatchStatus; alive: number; total: number;
  zone: { circle: Circle; next: Circle | null; status: ZoneStatus; timeLeft: number; phase: number };
  player: { x: number; z: number; hp: number; maxHp: number; armor: number; alive: boolean; weapons: WeaponKind[]; ammo: Partial<Record<WeaponKind, number>>; heals: number; kills: number; rank: number | null; outsideZone: boolean };
  bots: Array<{ id: number; x: number; z: number; hp: number; state: string; alive: boolean }>;
  loot: LootItem[];
}

const MAX_BOTS = 99;
const STEP = 0.1;
const NAMES = ['Arjun', 'Bhim', 'Chetan', 'Dev', 'Esha', 'Farhan', 'Gauri', 'Hari', 'Isha', 'Jai', 'Kabir', 'Lata', 'Mohan', 'Neha', 'Om', 'Priya', 'Qadir', 'Ravi', 'Sana', 'Tara'];

/**
 * A single-player battle royale match. update(dt) from the fixed step; snapshot() to draw; movePlayer / pickUp /
 * heal / hitBot are how the game talks to it. It ends in bounded time (the zone closes to nothing), ranks are the
 * number alive at the moment of death (unique, 1 = last one standing), and every loot item is on the ground or in
 * exactly one inventory.
 */
export class Match {
  readonly zone: Zone;
  readonly loot: LootField;
  readonly player: Fighter;
  private bots: Bot[] = [];
  private fighters: Fighter[] = [];
  private rng: RoyaleRng;
  private clock = 0;
  private _status: MatchStatus = 'playing';
  private ranks = new Map<number, number>();
  private _winner: number | null = null;
  private acc = 0;
  private readonly mapRadius: number;
  private readonly onEvent?: MatchOptions['onEvent'];

  constructor(opts: MatchOptions = {}) {
    const seed = opts.seed ?? 1;
    this.rng = new RoyaleRng(seed);
    this.mapRadius = num(opts.mapRadius, 50, 20000, 500);
    this.onEvent = opts.onEvent;
    this.zone = new Zone(this.mapRadius, seed + 7, opts.phases);
    this.loot = new LootField(spawnLoot(new RoyaleRng(seed + 13), this.mapRadius, Math.min(MAX_LOOT, Math.floor(num(opts.lootCount, 0, MAX_LOOT, 120)))));

    const start = opts.start ?? this.randomSpot();
    this.player = { id: 0, name: 'You', isPlayer: true, x: start.x, z: start.z, hp: 100, maxHp: 100, inv: new Inventory(), alive: true, kills: 0 };
    this.clampInside(this.player);
    this.fighters.push(this.player);

    const n = Math.floor(num(opts.botCount, 0, MAX_BOTS, 19));
    for (let i = 0; i < n; i++) {
      const s = this.randomSpot();
      const bot: Bot = {
        id: i + 1, name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + (Math.floor(i / NAMES.length) + 1) : ''), isPlayer: false,
        x: s.x, z: s.z, hp: 100, maxHp: 100, inv: new Inventory(), alive: true, kills: 0,
        state: 'loot', cooldown: this.rng.range(0, 1), skill: this.rng.range(0.4, 0.9), roam: this.randomSpot(), healT: 0,
      };
      this.bots.push(bot);
      this.fighters.push(bot);
    }
  }

  private randomSpot(): { x: number; z: number } {
    const a = this.rng.range(0, Math.PI * 2);
    const d = Math.sqrt(this.rng.next()) * this.mapRadius * 0.9;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d };
  }
  private clampInside(f: Fighter): void {
    const r = Math.hypot(f.x, f.z);
    if (r > this.mapRadius) { f.x *= this.mapRadius / r; f.z *= this.mapRadius / r; }
    if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) { f.x = 0; f.z = 0; }
  }
  private emit(name: string, payload: Record<string, unknown>): void {
    try { this.onEvent?.(name, payload); } catch { /* a listener's bug must not corrupt the match */ }
  }

  get status(): MatchStatus { return this._status; }
  get time(): number { return this.clock; }
  /** The id of the last one standing (0 = the player), or null while it is still going. */
  get winner(): number | null { return this._winner; }
  aliveCount(): number { return this.fighters.filter((f) => f.alive).length; }
  /** The player's final placement once dead or the winner, else null. 1 = last one standing. */
  playerRank(): number | null { return this.ranks.get(0) ?? null; }
  rankOf(id: number): number | null { return this.ranks.get(id) ?? null; }

  // ---- how the game talks to the match --------------------------------------------------------------------------

  /** The game moved the player (it owns movement and collision). Clamped to the map; ignored once dead. */
  movePlayer(x: number, z: number): void {
    if (!this.player.alive || this._status !== 'playing') return;
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return;
    this.player.x = x; this.player.z = z;
    this.clampInside(this.player);
  }

  /** Pick up the nearest item within reach. Atomic: a full inventory leaves it on the ground and says why. */
  pickUp(): { ok: boolean; message: string; item?: LootItem } {
    if (!this.player.alive || this._status !== 'playing') return { ok: false, message: 'You are out of the match.' };
    const spot = this.loot.nearest(this.player.x, this.player.z, PICKUP_RADIUS * 1.6);
    if (!spot) return { ok: false, message: 'Nothing to pick up here.' };
    const r = this.loot.pickUp(this.player.inv, spot.id);
    if (!r.ok) {
      const why = { slots_full: 'Your weapon slots are full.', already_have: 'You already carry that weapon.', ammo_full: 'You cannot carry more ammo for that.', heals_full: 'You cannot carry more bandages.', armor_full: 'Your armor is already full.', nothing_there: 'Nothing to pick up here.' }[r.reason];
      return { ok: false, message: why };
    }
    this.emit('LOOT_PICKED', { who: 0, kind: r.item.kind, weapon: r.item.weapon, id: r.item.id });
    return { ok: true, message: 'Picked up ' + (r.item.weapon ?? r.item.kind) + '.', item: r.item };
  }

  /** Use a bandage (+40 hp). Refused with a reason when there is none or health is full. */
  heal(): { ok: boolean; message: string } {
    const p = this.player;
    if (!p.alive || this._status !== 'playing') return { ok: false, message: 'You are out of the match.' };
    if (p.inv.heals < 1) return { ok: false, message: 'You have no bandages.' };
    if (p.hp >= p.maxHp) return { ok: false, message: 'Your health is already full.' };
    p.inv.heals--;
    p.hp = Math.min(p.maxHp, p.hp + 40);
    return { ok: true, message: 'Healed.' };
  }

  /** The game's weapon hit a bot. Returns whether it killed. Armor, ranks and events are handled here. */
  hitBot(botId: number, amount: number): { hit: boolean; killed: boolean } {
    const bot = this.bots.find((b) => b.id === botId);
    if (!bot || !bot.alive || this._status !== 'playing') return { hit: false, killed: false };
    const dmg = num(amount, 0, 1000, 0);
    if (dmg <= 0) return { hit: false, killed: false };
    this.damage(bot, dmg, this.player, 'player');
    return { hit: true, killed: !bot.alive };
  }

  /** What a player's shot would aim at: the alive bots, nearest first, with their distance. */
  targetsNear(radius: number): Array<{ id: number; x: number; z: number; distance: number }> {
    return this.bots.filter((b) => b.alive).map((b) => ({ id: b.id, x: b.x, z: b.z, distance: dist(b, this.player) }))
      .filter((t) => t.distance <= radius).sort((a, b) => a.distance - b.distance);
  }

  // ---- the loop ---------------------------------------------------------------------------------------------------

  /** Advance by dt seconds. Safe with any dt; a long one is split into 0.1 s steps (at most 100 per call). */
  update(dt: number): void {
    if (this._status !== 'playing') return;
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return;
    this.acc += Math.min(dt, STEP * 100);
    while (this.acc >= STEP - 1e-9 && this._status === 'playing') { this.acc -= STEP; this.step(STEP); }
  }

  private step(dt: number): void {
    this.clock += dt;
    for (const e of this.zone.update(dt)) {
      this.emit(e === 'announced' ? 'ZONE_ANNOUNCED' : e === 'shrinking' ? 'ZONE_SHRINKING' : 'ZONE_CLOSED', { circle: this.zone.circle, next: this.zone.next });
    }
    // the zone hurts everyone outside it
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const dps = this.zone.damagePerSecond(f.x, f.z);
      if (dps > 0) this.damage(f, dps * dt, null, 'zone');
    }
    const world = {
      zone: this.zone, loot: this.loot, rng: this.rng, mapRadius: this.mapRadius, fighters: this.fighters,
      shoot: (a: Fighter, t: Fighter, w: WeaponKind, d: number) => this.damage(t, d, a, w),
      picked: (who: Fighter, item: { id: number; kind: string }) => this.emit('LOOT_PICKED', { who: who.id, kind: item.kind, id: item.id }),
    };
    for (const b of this.bots) { if (b.alive && this._status === 'playing') stepBot(b, world, dt); }
    this.checkEnd();
  }

  /** Armor soaks up to 60% of a hit until it is gone; the rest comes off hit points. Death is recorded exactly once. */
  private damage(target: Fighter, amount: number, by: Fighter | null, source: string): void {
    if (!target.alive || amount <= 0) return;
    const soak = Math.min(target.inv.armor, amount * 0.6);
    target.inv.armor -= soak;
    target.hp -= amount - soak;
    if (target.isPlayer && by) this.emit('PLAYER_HIT', { from: by.id, x: by.x, z: by.z, amount, weapon: source });
    if (target.hp > 0) return;
    target.hp = 0;
    target.alive = false;
    const rank = this.fighters.filter((f) => f.alive).length + 1; // everyone still alive, plus this one
    this.ranks.set(target.id, rank);
    if (by && by !== target) by.kills++;
    this.emit('KILL', { killer: by ? by.id : null, victim: target.id, weapon: source, rank });
    if (target.isPlayer) this.emit('PLAYER_DIED', { rank, kills: target.kills, time: this.clock, by: by ? by.id : null, source });
  }

  private checkEnd(): void {
    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length > 1) return;
    this._status = 'ended';
    if (alive.length === 1) { this._winner = alive[0].id; this.ranks.set(alive[0].id, 1); }
    else {
      // the last two fell in the same step: whoever fell last holds rank 1 (it was recorded as one more than the survivors, which were none)
      for (const [id, rank] of this.ranks) if (rank === 1) this._winner = id;
    }
    this.emit('MATCH_ENDED', { winner: this._winner, rank: this.ranks.get(0) ?? null, kills: this.player.kills, time: this.clock });
  }

  snapshot(): MatchSnapshot {
    const p = this.player;
    return {
      time: this.clock, status: this._status, alive: this.aliveCount(), total: this.fighters.length,
      zone: { circle: this.zone.circle, next: this.zone.next, status: this.zone.status, timeLeft: this.zone.timeLeft, phase: this.zone.phase },
      player: {
        x: p.x, z: p.z, hp: p.hp, maxHp: p.maxHp, armor: p.inv.armor, alive: p.alive, weapons: [...p.inv.weapons], ammo: { ...p.inv.ammo },
        heals: p.inv.heals, kills: p.kills, rank: this.ranks.get(0) ?? null, outsideZone: !this.zone.contains(p.x, p.z),
      },
      bots: this.bots.map((b) => ({ id: b.id, x: b.x, z: b.z, hp: b.hp, state: b.state, alive: b.alive })),
      loot: this.loot.list(),
    };
  }

  /** The weapon numbers a bot uses — the game can show the same stats. */
  static botWeapons(): typeof BOT_WEAPONS { return BOT_WEAPONS; }
}
`;

const INDEX = String.raw`export { Match, type MatchOptions, type MatchSnapshot, type MatchStatus } from './match';
export { Zone, DEFAULT_PHASES, sanitizePhases, type Circle, type ZonePhase, type ZoneStatus } from './zone';
export { Inventory, LootField, spawnLoot, WEAPON_SLOTS, MAX_HEALS, MAX_ARMOR, MAX_AMMO, type LootItem, type LootKind, type Rarity, type WeaponKind, type PickResult } from './loot';
export { BOT_WEAPONS, hitChance, type Bot, type BotState, type Fighter } from './bots';
export { RoyaleRng } from './rng';
`;

const FILES: Record<string, string> = {
  'src/game/royale/rng.ts': RNG,
  'src/game/royale/zone.ts': ZONE,
  'src/game/royale/loot.ts': LOOT,
  'src/game/royale/bots.ts': BOTS,
  'src/game/royale/match.ts': MATCH,
  'src/game/royale/index.ts': INDEX,
};

export const GAME_ROYALE_MODULES: readonly string[] = ['rng', 'zone', 'loot', 'bots', 'match', 'index'];

/** Which modules each one imports (so a subset is always import-closed). */
const NEEDS: Record<string, string[]> = {
  rng: [], zone: ['rng'], loot: ['rng'], bots: ['rng', 'loot', 'zone'], match: ['rng', 'zone', 'loot', 'bots'], index: ['rng', 'zone', 'loot', 'bots', 'match'],
};

/** Generate the battle-royale core. Pure; never throws. */
export function generateGameRoyale(include?: string[]): GameRoyaleResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter((s) => s in NEEDS))
    : null;
  let names: string[] = GAME_ROYALE_MODULES.slice();
  if (wanted && wanted.size > 0) {
    const closure = new Set<string>();
    const add = (n: string): void => { if (closure.has(n)) return; closure.add(n); for (const d of NEEDS[n]) add(d); };
    for (const n of wanted) add(n);
    names = GAME_ROYALE_MODULES.filter((n) => closure.has(n));
  }
  const files: Record<string, string> = {};
  for (const n of names) files['src/game/royale/' + n + '.ts'] = FILES['src/game/royale/' + n + '.ts'];

  return {
    files,
    dependencies: [], // pure; no three.js and no import from another game layer
    instructions:
      `Added the battle-royale core (${Object.keys(files).length} files under src/game/royale): a single-player match against bots. It is the MATCH only — you draw it, move the player and fire the weapons (the shooter kit, generate_game_systems).\n` +
      '```ts\n' +
      "import { Match } from './game/royale';\n" +
      '\n' +
      'export const match = new Match({\n' +
      '  seed: 7, mapRadius: 500, botCount: 19, lootCount: 120,\n' +
      "  // ZONE_ANNOUNCED, ZONE_SHRINKING, LOOT_PICKED, KILL, PLAYER_HIT (with where it came from), PLAYER_DIED, MATCH_ENDED\n" +
      '  onEvent: (name, payload) => { console.debug(name, payload); },\n' +
      '});\n' +
      '\n' +
      '// Every FIXED update: the game moves the player and tells the match where they are, then steps it.\n' +
      'export function fixedUpdate(dt: number, playerX: number, playerZ: number): void {\n' +
      '  match.movePlayer(playerX, playerZ);\n' +
      '  match.update(dt);\n' +
      '}\n' +
      '\n' +
      '// Buttons / keys: both return a sentence for the player and never lose or duplicate an item.\n' +
      'export const onUse = () => match.pickUp();      // { ok, message }\n' +
      'export const onHeal = () => match.heal();       // { ok, message }\n' +
      '\n' +
      '// The shooter kit reports a hit on a bot — armor, death, rank and kill events are handled by the match:\n' +
      'export const onBulletHitBot = (botId: number, damage: number) => match.hitBot(botId, damage);\n' +
      '\n' +
      '// Every frame DRAW from the snapshot: the safe circle and the NEXT one, the people, the loot, the HUD numbers.\n' +
      'export const frame = () => match.snapshot();   // { zone: { circle, next, timeLeft }, player: { hp, rank, outsideZone }, bots, loot, alive }\n' +
      '```\n' +
      'THE RULES THESE ENCODE — do not re-implement them by hand:\n' +
      '- The zone only SHRINKS, each new circle lies inside the last and is announced for the whole wait; after the last one it holds and then closes to nothing, so a match ALWAYS ends — never write a zone that stops at its last circle.\n' +
      '- Loot is picked up atomically: the inventory is asked first, a full one leaves the item on the ground and pickUp() says why. Never delete a ground item yourself.\n' +
      '- A rank is the number alive at the moment of death: unique, 1 = last one standing. Show playerRank() / snapshot().player.rank, never count it yourself.\n' +
      '- Armor soaks up to 60% of a hit; death is recorded once. Route every hit on a bot through hitBot(); the zone and the bots damage each other inside the match.\n' +
      '- Weapon kinds in loot are the shooter kit names (pistol, rifle, smg, shotgun, sniper, bow): new Weapon(item.weapon). The bots use the same numbers.\n' +
      '- Draw the HUD from the snapshot: alive count, kills, hp, armor, the zone timer and a warning while player.outsideZone.\n' +
      '- Honest limits to tell the user: the bots are simple (no cover, vehicles or building interiors), it is single-player only (no online multiplayer), and the player\'s own movement, aiming and shooting are the game\'s.',
  };
}
