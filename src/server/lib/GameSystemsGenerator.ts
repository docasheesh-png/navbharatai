// Gameplay systems — phase 6, the layer that finally makes it a GAME rather than a walkable scene.
//
// Phases 1–5 give a runtime, a look, movement, impact and a shell. What is still missing is the part
// people actually mean by "a game": something to fight, something that can kill you, something to
// collect, and a reason the run ends.
//
// WHY THIS IS A PHASE AND NOT LEFT TO THE MODEL. Combat is deceptively hard to write correctly, and
// every mistake in it is a specific, well-known one:
//
//   • DAMAGE APPLIED PER FRAME. An enemy standing next to you deals its damage sixty times a second
//     and you die in half a second. This is THE most common combat bug in a first implementation, and
//     the fix is not "less damage" — it is an attack cooldown plus invulnerability frames.
//   • BULLETS THAT PASS THROUGH ENEMIES. A projectile moving 40 m/s covers 0.66 m per frame; an enemy
//     0.5 m wide is simply not at any sampled point. Testing overlap AT the new position misses it
//     entirely — you must test the SEGMENT it travelled.
//   • ENEMIES THAT STACK INTO ONE. Every enemy steering straight at the player converges on the same
//     coordinate, so five enemies become one enemy-shaped blob. Separation is what makes a crowd read
//     as a crowd.
//   • INSTANT AGGRO FROM ACROSS THE MAP. Without a detection radius and a de-aggro distance, every
//     enemy in the level walks at you from the first frame.
//   • DYING TWICE. Two hits in the same frame emit two deaths, two score awards and two death sounds.
//   • A WAVE THAT NEVER ENDS because one enemy fell through the floor and is still "alive" at y=-800.
//
// The decision-making is written as PURE functions, exactly like the character motor in phase 3, so
// these rules are testable arithmetic instead of something a human has to verify by playing.
//
// PURE builder → the caller writes the files.

export interface GameSystemsResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const COMBAT = `import { events } from '../core/events';

/**
 * Health, damage and death — with the two rules that stop a fight being decided in half a second.
 *
 * INVULNERABILITY FRAMES. Without them, a melee enemy standing next to the player deals its damage on
 * every single frame: 10 damage becomes 600 damage per second and the player dies before they can
 * react. This is the most common combat bug there is, and lowering the damage number does not fix it —
 * it just makes death take two seconds instead of one.
 *
 * DEATH FIRES ONCE. Two hits landing in the same frame would otherwise emit two deaths, award score
 * twice and play two death sounds.
 */
export interface HealthOptions {
  max: number;
  /** Seconds of invulnerability after taking a hit. 0 disables it (correct for destructibles). */
  invulnerable?: number;
  /** Emitted on damage/death so VFX and audio react. Gameplay must not call them directly. */
  damagedEvent?: string;
  diedEvent?: string;
}

export interface DamageResult {
  applied: number;
  blocked: boolean;
  died: boolean;
  remaining: number;
}

export class Health {
  current: number;
  readonly max: number;
  private readonly invulnerable: number;
  private readonly damagedEvent: string;
  private readonly diedEvent: string;
  private invulnerableUntil = 0;
  private dead = false;
  private clock = 0;

  constructor(options: HealthOptions) {
    this.max = Math.max(1, options.max);
    this.current = this.max;
    this.invulnerable = Math.max(0, options.invulnerable ?? 0.5);
    this.damagedEvent = options.damagedEvent ?? 'ENEMY_DAMAGED';
    this.diedEvent = options.diedEvent ?? 'ENEMY_DIED';
  }

  /** Drive from the FIXED update so the i-frame window is frame-rate independent. */
  tick(delta: number): void { this.clock += delta; }

  get isDead(): boolean { return this.dead; }
  get isInvulnerable(): boolean { return this.clock < this.invulnerableUntil; }
  get fraction(): number { return Math.max(0, this.current) / this.max; }

  damage(amount: number, position?: { x: number; y: number; z: number }): DamageResult {
    if (this.dead || amount <= 0) return { applied: 0, blocked: true, died: false, remaining: this.current };
    // The i-frame check. Removing this is what turns a fight into an instant death.
    if (this.isInvulnerable) return { applied: 0, blocked: true, died: false, remaining: this.current };

    const applied = Math.min(this.current, amount);
    this.current -= applied;
    this.invulnerableUntil = this.clock + this.invulnerable;

    if (this.current <= 0) {
      // Guarded, or two hits in one frame kill the same enemy twice.
      this.dead = true;
      events.emit(this.diedEvent, { position, overkill: amount - applied });
      return { applied, blocked: false, died: true, remaining: 0 };
    }
    events.emit(this.damagedEvent, { amount: applied, position, remaining: this.current });
    return { applied, blocked: false, died: false, remaining: this.current };
  }

  heal(amount: number): number {
    if (this.dead || amount <= 0) return 0;
    const healed = Math.min(this.max - this.current, amount);
    this.current += healed;
    if (healed > 0) events.emit('PLAYER_HEALED', { amount: healed, remaining: this.current });
    return healed;
  }

  revive(): void {
    this.dead = false;
    this.current = this.max;
    this.invulnerableUntil = 0;
  }
}

/**
 * An attack COOLDOWN, separate from i-frames. Both are needed and they solve different halves of the
 * same problem: the cooldown limits how often an attacker swings, i-frames limit how often a victim can
 * be hurt by anyone. With only one of them, two enemies together still delete the player instantly.
 */
export class Cooldown {
  private remaining = 0;
  constructor(private readonly seconds: number) {}
  tick(delta: number): void { this.remaining = Math.max(0, this.remaining - delta); }
  get ready(): boolean { return this.remaining <= 0; }
  /** Returns true if it fired; false if still cooling down. */
  tryUse(): boolean {
    if (this.remaining > 0) return false;
    this.remaining = this.seconds;
    return true;
  }
  reset(): void { this.remaining = 0; }
}
`;

const AI = `/**
 * Enemy decision-making as PURE arithmetic — no three.js, no side effects, no randomness.
 *
 * Written this way for the same reason the character motor was: the rules that make enemies feel alive
 * are subtle, and asserting them is far more reliable than sensing them in a browser.
 *
 * THE THREE THINGS A NAIVE ENEMY GETS WRONG:
 *   1. It steers straight at the player, so a group converges on one coordinate and five enemies become
 *      one enemy-shaped blob. SEPARATION fixes this and nothing else does.
 *   2. It aggros from anywhere on the map. A detection radius — plus a LARGER de-aggro radius, so it
 *      does not flicker in and out of chasing at exactly the boundary — is what gives a level pacing.
 *   3. It attacks every frame it is in range. That belongs to a cooldown, and the AI only ever REQUESTS
 *      an attack.
 */
import { findPath, lineClear, type NavGrid } from './nav';
export type EnemyMode = 'idle' | 'patrol' | 'chase' | 'attack' | 'dead';

export interface Vec2 { x: number; z: number; }

export interface EnemyConfig {
  speed: number;
  chaseSpeed: number;
  /** Starts chasing inside this. */
  detectRadius: number;
  /** Stops chasing outside this. MUST be larger than detectRadius or the enemy flickers at the edge. */
  loseRadius: number;
  attackRadius: number;
  /** How hard it steers away from its neighbours. 0 makes a crowd collapse into one point. */
  separation: number;
  separationRadius: number;
  /** Turn rate, radians per second. Instant turning reads as robotic. */
  turnRate: number;
  /**
   * How it fights. 'melee' (the default) closes in. 'ranged' holds \`preferredRange\` and strafes, shooting
   * from there. 'flanker' comes in from the side, so a group SURROUNDS the player instead of queueing.
   */
  role?: EnemyRole;
  /** Ranged only: the distance it fights from. Default 10. */
  preferredRange?: number;
}

export type EnemyRole = 'melee' | 'ranged' | 'flanker';

export const DEFAULT_ENEMY: EnemyConfig = {
  speed: 2.2,
  chaseSpeed: 4.2,
  detectRadius: 16,
  loseRadius: 24,
  attackRadius: 2.0,
  separation: 1.6,
  separationRadius: 2.4,
  turnRate: 6,
};

/** A shooter: holds its distance, strafes, and shoots when it can see the player. */
export const RANGED_ENEMY: EnemyConfig = { ...DEFAULT_ENEMY, role: 'ranged', preferredRange: 10, detectRadius: 20, loseRadius: 28, attackRadius: 13, chaseSpeed: 3.4 };
/** A flanker: comes in from the side, so three of them surround rather than queue. */
export const FLANKER_ENEMY: EnemyConfig = { ...DEFAULT_ENEMY, role: 'flanker', chaseSpeed: 4.8 };

export interface EnemyState {
  mode: EnemyMode;
  position: Vec2;
  facing: number;
  /** Patrol target; ignored in other modes. */
  home: Vec2;
  patrolRadius: number;
  timeInMode: number;
  /** With a nav grid: the path being followed around the walls, and how old it is (filled by stepEnemyAI). */
  path?: Vec2[];
  pathAge?: number;
}

export interface EnemyPerception {
  player: Vec2;
  /** Other enemies near enough to matter. Pass the neighbours, not the whole level. */
  neighbours: Vec2[];
  /** False when a wall is in the way — the AI itself does no raycasting. */
  canSeePlayer: boolean;
  /**
   * The level's walls (systems/nav.ts). With it the enemy never sees, or strikes, THROUGH a wall, and a player who
   * ducks behind one is HUNTED around it along a path instead of forgotten or walked into the wall.
   */
  nav?: NavGrid;
}

export interface EnemyDecision {
  state: EnemyState;
  /** Desired velocity this step, world units per second. */
  velocity: Vec2;
  /** True on the frame the enemy WANTS to attack. A cooldown decides whether it may. */
  wantsAttack: boolean;
  /** True on the frame it started chasing — the right moment for an alert sound. */
  alerted: boolean;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function normalise(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.z);
  return len > 1e-6 ? { x: v.x / len, z: v.z / len } : { x: 0, z: 0 };
}

/**
 * Steer away from neighbours, weighted by CLOSENESS — a neighbour at arm's length must push far harder
 * than one at the edge of the radius, or the crowd still collapses.
 */
export function separationVector(self: Vec2, neighbours: Vec2[], radius: number): Vec2 {
  let x = 0;
  let z = 0;
  for (const other of neighbours) {
    const d = dist(self, other);
    if (d <= 1e-6 || d > radius) continue;
    const push = (radius - d) / radius;
    x += ((self.x - other.x) / d) * push;
    z += ((self.z - other.z) / d) * push;
  }
  return { x, z };
}

/** Shortest signed angle from a to b — turning the long way round looks broken. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** PURE. Same inputs, same decision — which is what makes the rules above assertable. */
export function stepEnemyAI(
  prev: EnemyState,
  perception: EnemyPerception,
  config: EnemyConfig,
  delta: number,
): EnemyDecision {
  const s: EnemyState = { ...prev, position: { ...prev.position }, home: { ...prev.home } };
  if (s.mode === 'dead') {
    return { state: s, velocity: { x: 0, z: 0 }, wantsAttack: false, alerted: false };
  }

  s.timeInMode += delta;
  const toPlayer = dist(s.position, perception.player);
  const wasChasing = prev.mode === 'chase' || prev.mode === 'attack';
  const nav = perception.nav;
  // With walls known, sight needs a clear line; without them the caller's canSeePlayer is the answer, as before.
  const sees = perception.canSeePlayer && (!nav || lineClear(nav, s.position, perception.player));

  // Asymmetric radii: a single radius makes the enemy flicker between chase and idle at the boundary. An enemy
  // already chasing keeps hunting a player who stepped behind a wall — when it can path to them.
  const engaged = (sees || (nav !== undefined && wasChasing))
    && (wasChasing ? toPlayer <= config.loseRadius : toPlayer <= config.detectRadius);

  let mode: EnemyMode;
  if (!engaged) mode = s.patrolRadius > 0 ? 'patrol' : 'idle';
  else if (toPlayer <= config.attackRadius && sees) mode = 'attack';
  else mode = 'chase';

  const alerted = !wasChasing && (mode === 'chase' || mode === 'attack');
  if (mode !== s.mode) { s.mode = mode; s.timeInMode = 0; }

  let desired: Vec2 = { x: 0, z: 0 };
  let speed = 0;

  const role = config.role ?? 'melee';
  const toward = normalise({ x: perception.player.x - s.position.x, z: perception.player.z - s.position.z });
  // Its own side: a stable per-enemy sign from where it started, so flankers split left and right and a
  // ranged enemy circles one way — with no randomness, so a replay is identical.
  const side = (Math.floor(s.home.x * 7.13 + s.home.z * 3.71) & 1) ? 1 : -1;
  if (role === 'ranged' && (mode === 'chase' || mode === 'attack')) {
    // Hold the band around preferredRange: close in when far, back off when the player rushes it, and
    // STRAFE inside the band — a shooter that stands still is a target, one that walks at you is a melee enemy.
    const range = config.preferredRange ?? 10;
    const radial = toPlayer > range + 2 ? 1 : toPlayer < range - 3 ? -1 : 0;
    const strafe = radial === 0 ? 1 : 0.35;
    desired = normalise({ x: toward.x * radial + -toward.z * side * strafe, z: toward.z * radial + toward.x * side * strafe });
    speed = radial === 0 ? config.speed : config.chaseSpeed;
    mode = toPlayer <= config.attackRadius ? 'attack' : 'chase';
    if (mode !== s.mode) { s.mode = mode; s.timeInMode = 0; }
  } else if (role === 'flanker' && mode === 'chase' && toPlayer > config.attackRadius + 2.5) {
    // Aim at a point BESIDE the player, swinging in as it closes — the group arrives from several sides.
    const lateral = Math.min(1, (toPlayer - config.attackRadius) / 8) * 0.9;
    desired = normalise({ x: toward.x - toward.z * side * lateral * 1.6, z: toward.z + toward.x * side * lateral * 1.6 });
    speed = config.chaseSpeed;
  } else if (mode === 'chase') {
    desired = toward;
    speed = config.chaseSpeed;
  } else if (mode === 'patrol') {
    // A deterministic loop around home: no Math.random, so a replay is identical.
    const t = s.timeInMode * 0.5;
    const target = { x: s.home.x + Math.cos(t) * s.patrolRadius, z: s.home.z + Math.sin(t) * s.patrolRadius };
    desired = normalise({ x: target.x - s.position.x, z: target.z - s.position.z });
    speed = config.speed;
  }

  // 🧭 AROUND THE WALL, NOT INTO IT: chasing with no clear line, follow a path (re-planned twice a second, or when
  // the player has moved two cells from where it ended).
  if (nav && mode === 'chase' && !lineClear(nav, s.position, perception.player)) {
    const end = s.path && s.path.length ? s.path[s.path.length - 1] : null;
    s.pathAge = (prev.pathAge ?? 0) + delta;
    if (!s.path || !end || s.pathAge > 0.5 || dist(end, perception.player) > nav.cell * 2) {
      s.path = findPath(nav, s.position, perception.player) ?? undefined;
      s.pathAge = 0;
    }
    while (s.path && s.path.length > 1 && dist(s.path[0], s.position) < nav.cell * 0.6) s.path = s.path.slice(1);
    const wp = s.path?.[0];
    if (wp) desired = normalise({ x: wp.x - s.position.x, z: wp.z - s.position.z });
    else { desired = { x: 0, z: 0 }; speed = 0; }   // no way through: wait rather than walk into the wall
  } else if (s.path) { s.path = undefined; s.pathAge = 0; }

  // Separation applies even while attacking, or the pack piles into one square metre.
  const sep = separationVector(s.position, perception.neighbours, config.separationRadius);
  let vx = desired.x * speed + sep.x * config.separation * Math.max(speed, config.speed);
  let vz = desired.z * speed + sep.z * config.separation * Math.max(speed, config.speed);

  // Never exceed the mode's speed, however hard separation pushes.
  const mag = Math.hypot(vx, vz);
  const cap = Math.max(speed, mode === 'attack' ? config.speed : speed);
  if (mag > cap && mag > 1e-6) { vx = (vx / mag) * cap; vz = (vz / mag) * cap; }

  // Face where it is going (or the player while attacking), turning at a finite rate.
  const faceTarget = mode === 'attack' || (role === 'ranged' && engaged)
    ? Math.atan2(perception.player.x - s.position.x, perception.player.z - s.position.z)
    : (mag > 1e-6 ? Math.atan2(vx, vz) : s.facing);
  const turn = angleDelta(s.facing, faceTarget);
  const maxTurn = config.turnRate * delta;
  s.facing += Math.max(-maxTurn, Math.min(maxTurn, turn));

  s.position.x += vx * delta;
  s.position.z += vz * delta;

  return {
    state: s,
    velocity: { x: vx, z: vz },
    // Only a REQUEST. A cooldown decides whether the swing actually happens.
    wantsAttack: mode === 'attack' && perception.canSeePlayer,
    alerted,
  };
}

/**
 * A TELEGRAPHED attack: the enemy winds up where the player can SEE it (raise the arm, flash, crouch),
 * the blow lands at the end of the wind-up, then it recovers. A hit with no wind-up cannot be dodged and
 * reads as cheap; this is the half-second that makes combat feel fair and skilful.
 *
 * At 'strike' check the range AGAIN: a player who stepped away during the wind-up has dodged it.
 * PURE: drive it with update(dt) and read the phase.
 */
export type TelegraphPhase = 'ready' | 'windup' | 'strike' | 'recover';
export class AttackTelegraph {
  phase: TelegraphPhase = 'ready';
  private t = 0;
  constructor(public readonly windup = 0.45, public readonly recover = 0.6) {}
  /** Start a wind-up. False unless ready. */
  request(): boolean {
    if (this.phase !== 'ready') return false;
    this.phase = 'windup'; this.t = 0;
    return true;
  }
  /** 0..1 through the wind-up — scale a glow or a raised arm with it. */
  get progress(): number { return this.phase === 'windup' ? Math.min(1, this.t / this.windup) : 0; }
  /** Advance. 'strike' is returned for exactly ONE step: deal the damage then, if still in range. */
  update(dt: number): TelegraphPhase {
    this.t += Math.max(0, dt);
    if (this.phase === 'strike') { this.phase = 'recover'; this.t = 0; }
    else if (this.phase === 'windup' && this.t >= this.windup - 1e-9) { this.phase = 'strike'; this.t = 0; }
    else if (this.phase === 'recover' && this.t >= this.recover - 1e-9) { this.phase = 'ready'; this.t = 0; }
    return this.phase;
  }
}

/**
 * A boss fight in PHASES: below each health threshold the boss changes (faster, a new attack, adds). The
 * phase only ever ADVANCES — a boss that heals back over a threshold must not replay its transition.
 * changed is true on the one update a new phase begins: emit BOSS_PHASE_CHANGED then.
 */
export class BossPhases {
  phase = 0;
  constructor(public readonly thresholds: readonly number[] = [0.66, 0.33]) {}
  update(healthFraction: number): { phase: number; changed: boolean } {
    let p = 0;
    for (const t of this.thresholds) if (healthFraction <= t) p++;
    const changed = p > this.phase;
    if (changed) this.phase = p;
    return { phase: this.phase, changed };
  }
}

export function initialEnemyState(x: number, z: number, patrolRadius = 0): EnemyState {
  return {
    mode: patrolRadius > 0 ? 'patrol' : 'idle',
    position: { x, z },
    facing: 0,
    home: { x, z },
    patrolRadius,
    timeInMode: 0,
  };
}
`;

const PROJECTILE = `import { events } from '../core/events';

/**
 * Pooled projectiles with SEGMENT collision.
 *
 * THE BUG THIS EXISTS TO PREVENT. A bullet at 40 m/s moves 0.66 m in one 60Hz frame. An enemy 0.5 m
 * wide occupies less than that, so testing "is the bullet inside a target" at each new position finds
 * nothing at all — the bullet passes clean through and the player is told their aim was bad. It is one
 * of the most demoralising bugs a shooter can ship, and it only appears at high speed, so it survives
 * every slow-motion test.
 *
 * The fix is to test the SEGMENT from the previous position to the new one, not the endpoint. This is
 * a closest-point-on-segment test, which is exact and costs almost nothing.
 *
 * Everything is pooled: a firefight allocating a hundred objects a second is what causes the GC pause
 * that reads as "the game stutters when it gets busy".
 */
export interface Vec3 { x: number; y: number; z: number; }

export interface ProjectileTarget {
  position: Vec3;
  radius: number;
  /** Anything you need to resolve the hit — an enemy, its Health, an id. */
  ref?: unknown;
}

export interface ProjectileHit {
  target: ProjectileTarget;
  point: Vec3;
  damage: number;
  /** Who fired it, so friendly fire can be resolved by the caller. */
  ownerId?: string;
}

/**
 * Closest approach between a point and a SEGMENT (not an infinite line).
 *
 * Returns the squared distance AND \`t\`, how far along the segment that approach happens. Both are
 * needed: the distance decides WHETHER the bullet hit, and t decides WHICH target it hit first. Rank
 * by distance alone and a bullet through two enemies lined up dead ahead credits whichever happened to
 * be earlier in the array — both are at distance zero.
 */
export function closestApproach(p: Vec3, a: Vec3, b: Vec3): { distSq: number; t: number } {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  // A stationary "segment" degenerates to a point; without this guard t is 0/0 = NaN and every test
  // silently fails to hit.
  let t = abLenSq > 1e-12 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t)); // clamped: past the ends it is no longer the segment
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return { distSq: dx * dx + dy * dy + dz * dz, t };
}

/** Squared distance only, for callers that just need "is it within reach". */
export function distanceToSegmentSq(p: Vec3, a: Vec3, b: Vec3): number {
  return closestApproach(p, a, b).distSq;
}

interface Slot {
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  damage: number;
  radius: number;
  gravity: number;
  ownerId?: string;
}

export interface FireOptions {
  position: Vec3;
  direction: Vec3;
  speed?: number;
  damage?: number;
  life?: number;
  radius?: number;
  gravity?: number;
  ownerId?: string;
  /**
   * Fire without announcing it. A weapon that sends several projectiles per shot (a shotgun's pellets)
   * emits ONE WEAPON_FIRED itself; per-projectile events gave one shot eight flashes and eight bangs.
   */
  silent?: boolean;
}

export class ProjectileSystem {
  private readonly slots: Slot[] = [];
  private cursor = 0;

  constructor(max = 256) {
    for (let i = 0; i < max; i++) {
      this.slots.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, damage: 0, radius: 0.15, gravity: 0 });
    }
  }

  get activeCount(): number { return this.slots.reduce((n, s) => n + (s.active ? 1 : 0), 0); }

  fire(options: FireOptions): boolean {
    const dir = options.direction;
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-6) return false; // a zero direction would sit at the muzzle forever

    // Reuse the oldest slot rather than dropping the shot: a weapon that silently does nothing when
    // the pool is full feels broken in exactly the moment the game is most exciting.
    let slot: Slot | undefined = this.slots.find((s) => !s.active);
    if (!slot) { slot = this.slots[this.cursor]; this.cursor = (this.cursor + 1) % this.slots.length; }

    const speed = options.speed ?? 40;
    slot.active = true;
    slot.x = options.position.x; slot.y = options.position.y; slot.z = options.position.z;
    slot.vx = (dir.x / len) * speed;
    slot.vy = (dir.y / len) * speed;
    slot.vz = (dir.z / len) * speed;
    slot.life = options.life ?? 3;
    slot.damage = options.damage ?? 10;
    slot.radius = options.radius ?? 0.15;
    slot.gravity = options.gravity ?? 0;
    slot.ownerId = options.ownerId;
    if (!options.silent) events.emit('WEAPON_FIRED', { position: { ...options.position }, ownerId: options.ownerId });
    return true;
  }

  /**
   * Advance and resolve hits. Call from the FIXED update.
   * \`targets\` is re-read every step so a dead enemy stops being hittable immediately.
   */
  update(delta: number, targets: ProjectileTarget[] = []): ProjectileHit[] {
    const hits: ProjectileHit[] = [];
    for (const s of this.slots) {
      if (!s.active) continue;
      s.life -= delta;
      if (s.life <= 0) { s.active = false; continue; }

      const from = { x: s.x, y: s.y, z: s.z };
      s.vy += s.gravity * delta;
      s.x += s.vx * delta; s.y += s.vy * delta; s.z += s.vz * delta;
      const to = { x: s.x, y: s.y, z: s.z };

      // The whole point: test the path travelled, not the endpoint.
      let best: ProjectileTarget | null = null;
      let bestT = Infinity;
      for (const t of targets) {
        const reach = t.radius + s.radius;
        const { distSq, t: along } = closestApproach(t.position, from, to);
        if (distSq > reach * reach) continue;
        // FIRST along the path, not nearest to the line. Two enemies lined up dead ahead are both at
        // distance zero, so ranking by distance would credit whichever came first in the array.
        if (along < bestT) { bestT = along; best = t; }
      }

      if (best) {
        s.active = false;
        const hit: ProjectileHit = { target: best, point: { ...best.position }, damage: s.damage, ownerId: s.ownerId };
        hits.push(hit);
        events.emit('PROJECTILE_HIT', { position: hit.point, damage: s.damage, ownerId: s.ownerId });
      }
    }
    return hits;
  }

  /** Positions for rendering — drive an InstancedMesh or a particle layer from this. */
  forEachActive(fn: (x: number, y: number, z: number, index: number) => void): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.active) fn(s.x, s.y, s.z, i);
    }
  }

  clear(): void { for (const s of this.slots) s.active = false; }
}
`;

const SPAWNER = `import { makeRng } from '../three/world';

/**
 * Waves — the structure that turns "enemies exist" into "a run with a shape".
 *
 * WHAT GOES WRONG WITHOUT IT:
 *   • Enemies spawn on top of the player, which reads as cheating rather than difficulty.
 *   • A wave never completes because one enemy fell through the floor and is still "alive" at y=-800,
 *     so the game hangs on a level the player has already cleared.
 *   • Difficulty either never rises or doubles every wave; both are boring within a minute.
 *
 * SEEDED, so the same seed produces the same run — which is what makes a difficulty curve tunable
 * rather than guesswork.
 */
export interface WavePlan {
  index: number;
  count: number;
  healthMultiplier: number;
  speedMultiplier: number;
  /** Seconds before the next wave once this one is cleared. */
  restSeconds: number;
}

/**
 * Linear-plus-gentle-curve rather than doubling. Doubling makes wave 8 unwinnable and wave 2 trivial;
 * the shape below stays playable for a long run and can be tuned by one number.
 */
export function planWave(index: number, difficulty = 1): WavePlan {
  const i = Math.max(0, Math.floor(index));
  return {
    index: i,
    count: Math.round((3 + i * 1.6) * difficulty),
    healthMultiplier: 1 + i * 0.14 * difficulty,
    speedMultiplier: Math.min(1.7, 1 + i * 0.045 * difficulty), // capped: unoutrunnable is not "hard"
    restSeconds: Math.max(2, 6 - i * 0.25),
  };
}

export interface SpawnPoint { x: number; z: number; }

/**
 * Ring placement around the player: never closer than minDistance, never outside the arena.
 * Deterministic for a given seed.
 */
export function spawnRing(
  count: number,
  player: SpawnPoint,
  options: { minDistance?: number; maxDistance?: number; arenaRadius?: number; seed?: number } = {},
): SpawnPoint[] {
  const min = Math.max(1, options.minDistance ?? 14);
  const max = Math.max(min + 1, options.maxDistance ?? 26);
  const arena = options.arenaRadius ?? 60;
  const rng = makeRng(options.seed ?? 1);
  const out: SpawnPoint[] = [];

  for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
    // Even angular spread plus jitter: pure random clusters, and a clustered wave arrives from one
    // side and is trivially kited.
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const radius = min + rng() * (max - min);
    let x = player.x + Math.cos(angle) * radius;
    let z = player.z + Math.sin(angle) * radius;

    // Two constraints that fight each other when the player stands near the edge: inside the arena,
    // and at least min away from the player. Pushing radially away from the player after clamping is
    // the obvious move and it is WRONG — it walks the point straight back outside the arena.
    // Instead, clamp onto the arena circle and then slide ALONG that circle until it is far enough.
    const fromCentre = Math.hypot(x, z);
    if (fromCentre > arena) {
      x = (x / fromCentre) * arena;
      z = (z / fromCentre) * arena;

      if (Math.hypot(x - player.x, z - player.z) < min) {
        const playerFromCentre = Math.hypot(player.x, player.z);
        if (playerFromCentre > 1e-6) {
          // Law of cosines: the angular separation from the player at which a point on the arena
          // circle is exactly min away. cos may fall outside [-1,1] when the arena is too small to
          // satisfy min at all — then the antipode is the furthest we can honestly get.
          const cos = (arena * arena + playerFromCentre * playerFromCentre - min * min) / (2 * arena * playerFromCentre);
          const sep = Math.acos(Math.max(-1, Math.min(1, cos)));
          const playerAngle = Math.atan2(player.z, player.x);
          const current = Math.atan2(z, x);
          // Rotate to whichever side is closer to where it already was, so the ring keeps its spread.
          let delta = current - playerAngle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          const target = playerAngle + (delta >= 0 ? sep : -sep);
          x = Math.cos(target) * arena;
          z = Math.sin(target) * arena;
        }
      }
    } else if (Math.hypot(x - player.x, z - player.z) < min) {
      // Comfortably inside the arena: pushing away is safe here.
      const away = Math.atan2(z - player.z, x - player.x) || 0;
      x = player.x + Math.cos(away) * min;
      z = player.z + Math.sin(away) * min;
    }
    out.push({ x, z });
  }
  return out;
}

export interface WaveTrackable {
  alive: boolean;
  position: { x: number; y: number; z: number };
}

/**
 * Is the wave finished? An enemy below killFloorY counts as gone.
 *
 * Without that check a single enemy that clipped through the ground keeps the wave open forever, and
 * the player is left standing in an empty arena wondering what to do — a bug report we would never be
 * able to reproduce.
 */
export function waveCleared(enemies: WaveTrackable[], killFloorY = -50): boolean {
  return enemies.every((e) => !e.alive || e.position.y < killFloorY);
}

/** Enemies that fell out of the world, so the caller can despawn them honestly. */
export function fallenOutOfWorld<T extends WaveTrackable>(enemies: T[], killFloorY = -50): T[] {
  return enemies.filter((e) => e.alive && e.position.y < killFloorY);
}
`;

const WEAPON = `/**
 * WEAPONS — the part of a shooter that decides whether it feels like one.
 *
 * A generated shooter usually spawns one projectile per click and calls it a gun. Every weapon a player
 * has held behaves in ways that click cannot: a rifle keeps firing while the trigger is held and a
 * pistol does not; a magazine runs dry and a reload takes time you can be caught in; shots spread wider
 * the longer you hold the trigger and tighten when you stop; the barrel kicks; a shotgun is eight pellets
 * with ONE bang; an arrow falls. All of it is here, pure and seeded, firing through ProjectileSystem.
 *
 * Melee is the same idea for a blade: a swing hits what is IN FRONT, within reach and inside an arc,
 * once per swing — never everything around the player, never sixty times a second.
 */
import { events } from '../core/events';
import type { ProjectileSystem, ProjectileTarget, Vec3 } from './projectile';

export type WeaponKind = 'pistol' | 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'bow';

export interface WeaponSpec {
  /** Shots per second at most. */
  fireRate: number;
  /** Fires while the trigger is HELD (rifle, SMG) — or once per press (pistol, shotgun, sniper, bow). */
  auto: boolean;
  magazine: number;
  /** Seconds to reload — you cannot fire during it. */
  reload: number;
  damage: number;
  /** Projectile speed, m/s. */
  speed: number;
  /** Half-angle of the shot cone, radians, when fired calmly. */
  spread: number;
  /** Projectiles per shot (a shotgun's pellets). */
  pellets: number;
  /** Upward kick per shot, radians — apply weapon.kick to the camera pitch. */
  recoil: number;
  /** Gravity on the projectile (an arrow drops; a bullet, at game ranges, does not). */
  gravity: number;
  /** Seconds a projectile lives — its range. */
  life: number;
}

export const WEAPONS: Readonly<Record<WeaponKind, WeaponSpec>> = {
  pistol:  { fireRate: 4,   auto: false, magazine: 12, reload: 1.2, damage: 20, speed: 70,  spread: 0.012, pellets: 1, recoil: 0.035, gravity: 0,     life: 1.5 },
  rifle:   { fireRate: 9,   auto: true,  magazine: 30, reload: 2.0, damage: 14, speed: 95,  spread: 0.018, pellets: 1, recoil: 0.02,  gravity: 0,     life: 2 },
  smg:     { fireRate: 13,  auto: true,  magazine: 32, reload: 1.6, damage: 9,  speed: 75,  spread: 0.04,  pellets: 1, recoil: 0.012, gravity: 0,     life: 1.2 },
  shotgun: { fireRate: 1.2, auto: false, magazine: 6,  reload: 2.6, damage: 9,  speed: 60,  spread: 0.09,  pellets: 8, recoil: 0.09,  gravity: 0,     life: 0.6 },
  sniper:  { fireRate: 0.8, auto: false, magazine: 5,  reload: 2.8, damage: 90, speed: 170, spread: 0.002, pellets: 1, recoil: 0.13,  gravity: 0,     life: 2.5 },
  bow:     { fireRate: 1.1, auto: false, magazine: 1,  reload: 0.55, damage: 35, speed: 42, spread: 0.006, pellets: 1, recoil: 0,     gravity: -9.8,  life: 4 },
};

/** How far the cone may widen while the trigger is held: this many times the calm spread. */
export const MAX_BLOOM = 2.5;
/**
 * A cooldown counts down in fixed steps of 1/60, which floating point never lands on 0 exactly: 30 steps
 * of 1/60 leave ~1e-16 behind, and a strict \`> 0\` would make every "twice a second" weapon wait one
 * extra frame. Anything under a microsecond is ready.
 */
const READY = 1e-6;

export class Weapon {
  readonly spec: WeaponSpec;
  readonly kind: WeaponKind | 'custom';
  ammo: number;
  /** Seconds of reload left; 0 when ready. */
  reloading = 0;
  /** The camera kick to add to the view's pitch this frame. Decays on its own. */
  kick = 0;
  private cooldown = 0;
  private bloom = 1;
  private wasHeld = false;
  /** The trigger was held and the gun ready last step — a late shot now carries its lateness. */
  private streak = false;
  /** Who fired last (an enemy passes its id) — so the HUD shows only the player's own ammo. */
  private lastOwner: string | undefined;
  private seed: number;

  constructor(kind: WeaponKind | WeaponSpec = 'pistol', seed = 1) {
    this.spec = typeof kind === 'string' ? WEAPONS[kind] : kind;
    this.kind = typeof kind === 'string' ? kind : 'custom';
    this.ammo = this.spec.magazine;
    this.seed = (seed >>> 0) || 1;
  }

  /** The current cone half-angle — wider while firing, back to calm when you stop. */
  get spread(): number { return this.spec.spread * this.bloom; }

  /** Start a reload. False when already full or already reloading. */
  reload(): boolean {
    if (this.reloading > 0 || this.ammo >= this.spec.magazine) return false;
    this.reloading = this.spec.reload;
    events.emit('WEAPON_RELOADING', { kind: this.kind, ammo: this.ammo, magazine: this.spec.magazine, seconds: this.spec.reload, ownerId: this.lastOwner });
    return true;
  }

  /**
   * Advance one FIXED step. Returns how many shots left the barrel. \`muzzle\` is the barrel tip in world
   * space and \`aim\` the direction the player is aiming (it need not be normalised).
   */
  update(dt: number, triggerHeld: boolean, muzzle: Vec3, aim: Vec3, projectiles: ProjectileSystem, ownerId?: string): number {
    this.lastOwner = ownerId;
    // The time between shots rarely divides into 1/60 s steps (13 rounds a second is 4.6 frames). A
    // cooldown RESET on each shot rounds every gap up to whole frames and quietly turns 13/s into 12/s, so
    // a shot that comes due mid-step CARRIES how late it is into the next gap. Only while the trigger is
    // held continuously: the first shot after a pause, a reload or a fresh press is never early.
    const owed = this.cooldown - dt;
    this.cooldown = Math.max(0, owed);
    this.kick *= Math.exp(-10 * dt);
    if (!triggerHeld) this.bloom = Math.max(1, this.bloom - dt * 3);
    const pressed = triggerHeld && !this.wasHeld;
    this.wasHeld = triggerHeld;
    const wantsShot = this.spec.auto ? triggerHeld : pressed;
    const late = this.streak && wantsShot && owed < 0 ? Math.min(dt, -owed) : 0;
    this.streak = wantsShot && this.reloading === 0;

    if (this.reloading > 0) {
      this.reloading = Math.max(0, this.reloading - dt);
      if (this.reloading === 0) {
        this.ammo = this.spec.magazine;
        events.emit('WEAPON_RELOADED', { kind: this.kind, ammo: this.ammo, magazine: this.spec.magazine, ownerId: this.lastOwner });
      }
      return 0;
    }
    if (!wantsShot || this.cooldown > READY) return 0;
    if (this.ammo <= 0) {
      // Dry: say so (a click) — tapped or held through the last round alike — and start the reload the
      // player obviously wants. The reload then blocks this branch, so the click sounds once.
      events.emit('WEAPON_EMPTY', { kind: this.kind, ammo: 0, magazine: this.spec.magazine, ownerId: this.lastOwner });
      this.reload();
      return 0;
    }

    this.ammo -= 1;
    this.cooldown = 1 / this.spec.fireRate - late;
    const len = Math.hypot(aim.x, aim.y, aim.z) || 1;
    const fx = aim.x / len, fy = aim.y / len, fz = aim.z / len;
    // Two axes perpendicular to the aim, so the cone is a cone whichever way the player looks.
    const ux0 = Math.abs(fy) < 0.99 ? 0 : 1, uy0 = Math.abs(fy) < 0.99 ? 1 : 0;   // world up, unless aiming straight up
    let rx = -fz * uy0, ry = fz * ux0, rz = fx * uy0 - fy * ux0;                   // right = aim × up
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const vx = ry * fz - rz * fy, vy = rz * fx - rx * fz, vz = rx * fy - ry * fx;
    for (let i = 0; i < this.spec.pellets; i++) {
      // Uniform over the cone's disc, not its square — a square pattern reads as a bug.
      const r = this.spread * Math.sqrt(this.random());
      const a = this.random() * Math.PI * 2;
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
      projectiles.fire({
        position: { ...muzzle },
        direction: { x: fx + rx * ox + vx * oy, y: fy + ry * ox + vy * oy, z: fz + rz * ox + vz * oy },
        speed: this.spec.speed, damage: this.spec.damage, life: this.spec.life, gravity: this.spec.gravity,
        ownerId, silent: true,
      });
    }
    // ONE shot is one bang and one flash, however many pellets it carried.
    events.emit('WEAPON_FIRED', { position: { ...muzzle }, kind: this.kind, ownerId, ammo: this.ammo, magazine: this.spec.magazine });
    this.kick += this.spec.recoil;
    this.bloom = Math.min(MAX_BLOOM, this.bloom + 0.35);
    if (this.ammo === 0 && this.spec.magazine === 1) this.reload();   // a bow nocks the next arrow itself
    return 1;
  }

  private random(): number {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) % 1000000) / 1000000;
  }
}

/**
 * What a melee swing hits: targets IN FRONT of the attacker (within \`arc\` of where it faces, on the
 * ground plane), within \`range\` of it, counting each target's own radius. Nearest first.
 * \`facingYaw\` is the attacker's rotation.y — every model in the library faces its local +Z.
 */
export function meleeHits(origin: Vec3, facingYaw: number, targets: ProjectileTarget[], range = 1.8, arc = Math.PI * 0.6): ProjectileTarget[] {
  const fx = Math.sin(facingYaw), fz = Math.cos(facingYaw);
  const out: Array<{ t: ProjectileTarget; d: number }> = [];
  for (const t of targets) {
    const dx = t.position.x - origin.x, dz = t.position.z - origin.z;
    const dist = Math.hypot(dx, dz);
    if (dist - t.radius > range) continue;
    if (dist > 1e-6) {
      const cos = (dx * fx + dz * fz) / dist;
      if (cos < Math.cos(arc / 2)) continue;
    }
    out.push({ t, d: dist });
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.t);
}

/**
 * A blade or a fist: one swing per cooldown, and each swing lands ONCE, at its strike moment — not on
 * every frame the arc overlaps a target.
 */
export class MeleeWeapon {
  private cooldown = 0;
  private windup = -1;
  constructor(public readonly damage = 30, public readonly rate = 1.6, public readonly range = 1.8, public readonly arc = Math.PI * 0.6, public readonly strikeDelay = 0.12) {}

  /** Start a swing; false while the last one is still recovering. ownerId names who swings (an enemy's id), so only the player's own swing poses the player's body. */
  swing(ownerId?: string): boolean {
    if (this.cooldown > READY || this.windup >= 0) return false;
    this.windup = this.strikeDelay;
    this.cooldown = 1 / this.rate;
    events.emit('MELEE_SWING', { ownerId });
    return true;
  }

  /** Advance; returns the targets hit on THIS step (empty except at the strike moment). */
  update(dt: number, origin: Vec3, facingYaw: number, targets: ProjectileTarget[]): ProjectileTarget[] {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.windup < 0) return [];
    this.windup -= dt;
    if (this.windup > 0) return [];
    this.windup = -1;
    const hits = meleeHits(origin, facingYaw, targets, this.range, this.arc);
    if (hits.length) events.emit('MELEE_HIT', { count: hits.length });
    return hits;
  }
}
`;

const NAV = `/**
 * PATHFINDING — enemies (and anything else) go AROUND walls instead of into them (admin 2026-11-19 game-gap audit:
 * "dushman seedha chalta hai aur deewar se takrata rehta hai"). Pure arithmetic: a grid of blocked cells, A* over it
 * (eight directions, never cutting a blocked corner), and the path pulled tight so it reads as walking, not stepping.
 *
 *   const nav = createNavGrid({ minX: -50, minZ: -50, maxX: 50, maxZ: 50, cell: 1,
 *     blocked: blockedFromBoxes(walls) });                     // walls: world boxes of your colliders
 *   // 2D world: blocked: (x, z) => world.isSolid(x, z)
 *   stepEnemyAI(state, { player, neighbours, canSeePlayer: true, nav }, DEFAULT_ENEMY, dt);
 */
export interface Vec2 { x: number; z: number }

export interface NavGrid {
  readonly minX: number; readonly minZ: number; readonly cell: number;
  readonly cols: number; readonly rows: number;
  /** 1 = blocked. */
  readonly blocked: Uint8Array;
  isBlocked(x: number, z: number): boolean;
}

export interface NavGridOptions {
  minX: number; minZ: number; maxX: number; maxZ: number;
  /** Cell size in world units. Default 1. Smaller is more exact and slower. */
  cell?: number;
  /** Is this point inside a wall? */
  blocked: (x: number, z: number) => boolean;
  /** Extra cells kept clear around every wall, so a body of that radius never scrapes one. Default 0. */
  inflate?: number;
}

/** A grid larger than this many cells is refused (a level-sized grid at 1 m is far below it). */
export const MAX_NAV_CELLS = 250_000;

export function createNavGrid(o: NavGridOptions): NavGrid {
  const cell = Math.max(0.1, o.cell ?? 1);
  const cols = Math.max(1, Math.ceil((o.maxX - o.minX) / cell));
  const rows = Math.max(1, Math.ceil((o.maxZ - o.minZ) / cell));
  if (cols * rows > MAX_NAV_CELLS) throw new Error('Nav grid too large: ' + cols + ' x ' + rows + ' cells; use a bigger cell size');
  const raw = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (o.blocked(o.minX + (c + 0.5) * cell, o.minZ + (r + 0.5) * cell)) raw[r * cols + c] = 1;
  }
  let blocked = raw;
  const inflate = Math.max(0, Math.floor(o.inflate ?? 0));
  if (inflate > 0) {
    blocked = new Uint8Array(raw);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!raw[r * cols + c]) continue;
      for (let dr = -inflate; dr <= inflate; dr++) for (let dc = -inflate; dc <= inflate; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) blocked[rr * cols + cc] = 1;
      }
    }
  }
  const grid: NavGrid = {
    minX: o.minX, minZ: o.minZ, cell, cols, rows, blocked,
    isBlocked(x, z) {
      const c = Math.floor((x - o.minX) / cell), r = Math.floor((z - o.minZ) / cell);
      return c < 0 || r < 0 || c >= cols || r >= rows || blocked[r * cols + c] === 1;
    },
  };
  return grid;
}

/** Walls given as world boxes (from your colliders' Box3) as a blocked() test for createNavGrid. */
export function blockedFromBoxes(boxes: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number }>): (x: number, z: number) => boolean {
  return (x, z) => boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}

const cellOf = (g: NavGrid, p: Vec2): [number, number] => [Math.floor((p.x - g.minX) / g.cell), Math.floor((p.z - g.minZ) / g.cell)];
const centre = (g: NavGrid, c: number, r: number): Vec2 => ({ x: g.minX + (c + 0.5) * g.cell, z: g.minZ + (r + 0.5) * g.cell });
const free = (g: NavGrid, c: number, r: number): boolean => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.blocked[r * g.cols + c] === 0;

/**
 * Can a body walk straight from a to b without entering a blocked cell? Sampled every quarter cell along the line AND
 * a hair to either side of it, so a line that grazes the exact corner where two blocked cells meet is not "clear" —
 * the gap between them has no width, and nothing can walk through it.
 */
export function lineClear(g: NavGrid, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (g.cell * 0.25)));
  const off = g.cell * 0.05;
  const nx = dist > 0 ? (-dz / dist) * off : 0, nz = dist > 0 ? (dx / dist) * off : 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = a.x + dx * t, z = a.z + dz * t;
    if (g.isBlocked(x, z) || g.isBlocked(x + nx, z + nz) || g.isBlocked(x - nx, z - nz)) return false;
  }
  return true;
}

/** The nearest free cell to p (a target standing inside a wall is still reachable from beside it). */
function nearestFree(g: NavGrid, c: number, r: number): [number, number] | null {
  if (free(g, c, r)) return [c, r];
  for (let rad = 1; rad <= 6; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
    if (Math.max(Math.abs(dr), Math.abs(dc)) === rad && free(g, c + dc, r + dr)) return [c + dc, r + dr];
  }
  return null;
}

/**
 * The shortest walkable path from one point to another (world points, ending at the target), or null when there
 * is none within maxNodes. Eight directions; a diagonal never squeezes between two blocked cells. Pulled tight: a
 * point is kept only where the straight line to the next one would hit a wall.
 */
export function findPath(g: NavGrid, from: Vec2, to: Vec2, maxNodes = 20_000): Vec2[] | null {
  const s0 = cellOf(g, from), t0 = cellOf(g, to);
  const s = nearestFree(g, s0[0], s0[1]), t = nearestFree(g, t0[0], t0[1]);
  if (!s || !t) return null;
  if (lineClear(g, from, to)) return [{ x: to.x, z: to.z }];
  const N = g.cols * g.rows, key = (c: number, r: number) => r * g.cols + c;
  const gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const h = (c: number, r: number) => { const dx = Math.abs(c - t[0]), dz = Math.abs(r - t[1]); return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz); };
  // A small binary heap of [f, key].
  const heap: Array<[number, number]> = [];
  const push = (f: number, k: number) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = (): number => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
  const start = key(s[0], s[1]), goal = key(t[0], t[1]);
  gScore[start] = 0; push(h(s[0], s[1]), start);
  let expanded = 0;
  while (heap.length) {
    const k = pop();
    if (closed[k]) continue;
    if (k === goal) break;
    closed[k] = 1;
    if (++expanded > maxNodes) return null;
    const c = k % g.cols, r = (k - c) / g.cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const nc = c + dc, nr = r + dr;
      if (!free(g, nc, nr)) continue;
      if (dc && dr && (!free(g, c + dc, r) || !free(g, c, r + dr))) continue;   // no corner cutting
      const nk = key(nc, nr), cost = gScore[k] + (dc && dr ? 1.41421356 : 1);
      if (cost < gScore[nk]) { gScore[nk] = cost; came[nk] = k; push(cost + h(nc, nr), nk); }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: Vec2[] = [];
  for (let k = goal; k !== -1 && k !== start; k = came[k]) { const c = k % g.cols; cells.push(centre(g, c, (k - c) / g.cols)); }
  cells.reverse();
  cells[cells.length - 1] = { x: to.x, z: to.z };
  // Pull the string: keep a point only where the line onward is blocked.
  const out: Vec2[] = [];
  let anchor = from;
  for (let i = 0; i < cells.length; i++) {
    const next = cells[i + 1];
    if (!next || !lineClear(g, anchor, next)) { out.push(cells[i]); anchor = cells[i]; }
  }
  return out;
}
`;

const DIRECTOR = `import { events } from '../core/events';

/**
 * The Director — why a good action game feels "just right" for the whole run.
 *
 * Two jobs, the two things that keep a player playing:
 *
 *   1. PACING. Tension BUILDS as enemies arrive, PEAKS in a real fight, then the game gives a BREATHER —
 *      no new enemies for a few seconds — before it builds again. Constant pressure is exhausting and
 *      constant calm is boring; the rhythm between them is what "one more round" is made of.
 *
 *   2. FLOW. It watches how the player is doing — hurt, dying, killing, untouched — and moves difficulty
 *      SLOWLY toward what that player can handle: a struggling player is eased, a strong one is pushed.
 *      Slowly (about 1% a second at most), so nobody ever feels the game change under them; and after two
 *      quick deaths it eases once, at once, because that is the moment a player quits.
 *
 * Honest by construction: it changes the CHALLENGE (how many enemies, how tough, how often), never the
 * score. Where scores are compared between players (a shared leaderboard), pass \`adapt: false\`: every
 * run then gets the same curve, so a high score means the same thing for everyone.
 *
 * Use it with the spawner:  planWave(wave, director.difficulty)  and only spawn while director.canSpawn.
 */
export type Pace = 'build' | 'peak' | 'relax';

export interface DirectorOptions {
  /** Adapt difficulty to the player. false keeps every run identical (for compared scores). Default true. */
  adapt?: boolean;
  minDifficulty?: number;
  maxDifficulty?: number;
  /** The longest a peak may last before the breather is forced. Default 14 s. */
  peakSeconds?: number;
  /** How long the breather lasts. Default 7 s. */
  relaxSeconds?: number;
  /** Remember the player's skill between sessions under this id (localStorage). */
  gameId?: string;
  /** Where to start when nothing is remembered, 0..1. Default 0.5 (difficulty 1). */
  startSkill?: number;
}

const MAX_RATE = 0.012;           // difficulty change per second, at most
const MERCY_WINDOW = 90;          // two deaths within this many seconds → ease at once
const MERCY_STEP = 0.85;

export class Director {
  /** Multiply challenge by this: planWave(i, difficulty), enemy speed, spawn count. 1 is the designed game. */
  difficulty = 1;
  /** How intense the last few seconds were, 0..1. */
  intensity = 0;
  pace: Pace = 'build';
  /** The running estimate of this player, 0..1. */
  skill: number;
  readonly adapt: boolean;
  private readonly min: number;
  private readonly max: number;
  private readonly peakSeconds: number;
  private readonly relaxSeconds: number;
  private readonly key: string | null;
  private paceTime = 0;
  private sinceHurt = 0;
  private clock = 0;
  private lastDeath = -Infinity;
  private saveIn = 5;

  constructor(options: DirectorOptions = {}) {
    this.adapt = options.adapt !== false;
    this.min = Math.max(0.2, options.minDifficulty ?? 0.6);
    this.max = Math.max(this.min, options.maxDifficulty ?? 1.8);
    this.peakSeconds = Math.max(2, options.peakSeconds ?? 14);
    this.relaxSeconds = Math.max(1, options.relaxSeconds ?? 7);
    this.key = options.gameId ? 'nb-director-v1:' + options.gameId : null;
    this.skill = clamp01(options.startSkill ?? 0.5);
    if (this.key && this.adapt) {
      try {
        const saved = Number(globalThis.localStorage?.getItem(this.key));
        if (Number.isFinite(saved) && saved > 0) this.skill = clamp01(saved);
      } catch { /* storage blocked: start from the default */ }
    }
    if (this.adapt) this.difficulty = this.targetDifficulty();
  }

  /** May a new enemy appear now? False during the breather. */
  get canSpawn(): boolean { return this.pace !== 'relax'; }

  /** Spawn-rate multiplier: full while building, eased at the peak (the fight is already on), 0 in a breather. */
  get spawnRate(): number { return this.pace === 'build' ? 1 : this.pace === 'peak' ? 0.5 : 0; }

  /** The player lost this fraction of their health (0..1). */
  playerHurt(fraction: number): void {
    const f = clamp01(fraction);
    this.intensity = clamp01(this.intensity + f * 1.6);
    this.skill = clamp01(this.skill - f * 0.2);
    this.sinceHurt = 0;
  }

  playerDied(): void {
    this.intensity = 1;
    this.skill = clamp01(this.skill - 0.12);
    // Two deaths close together is the moment a player gives up — ease now, once, not a second later.
    if (this.adapt && this.clock - this.lastDeath < MERCY_WINDOW) {
      this.difficulty = Math.max(this.min, this.difficulty * MERCY_STEP);
      this.lastDeath = -Infinity;
    } else {
      this.lastDeath = this.clock;
    }
    this.sinceHurt = 0;
  }

  enemyKilled(): void {
    this.intensity = clamp01(this.intensity + 0.07);
    this.skill = clamp01(this.skill + 0.008);
  }

  /** Advance. Call once per fixed step. */
  update(dt: number): void {
    const step = Math.max(0, Math.min(dt, 0.25));
    this.clock += step;
    this.paceTime += step;
    this.sinceHurt += step;
    this.intensity *= Math.exp(-step / (this.pace === 'relax' ? 2.5 : 6));

    // Surviving untouched is evidence too: skill creeps up while the player is not being hurt.
    if (this.sinceHurt > 5) this.skill = clamp01(this.skill + step * 0.003);

    const was = this.pace;
    if (this.pace === 'build' && this.intensity >= 0.8) this.pace = 'peak';
    else if (this.pace === 'peak' && (this.paceTime >= this.peakSeconds || this.intensity < 0.35)) this.pace = 'relax';
    else if (this.pace === 'relax' && this.paceTime >= this.relaxSeconds) this.pace = 'build';
    if (this.pace !== was) {
      this.paceTime = 0;
      events.emit('PACE_CHANGED', { pace: this.pace, intensity: this.intensity, difficulty: this.difficulty });
    }

    if (this.adapt) {
      const want = this.targetDifficulty();
      const room = MAX_RATE * step;
      this.difficulty += Math.max(-room, Math.min(room, want - this.difficulty));
      this.difficulty = Math.max(this.min, Math.min(this.max, this.difficulty));
      this.saveIn -= step;
      if (this.saveIn <= 0) { this.saveIn = 5; this.save(); }
    }
  }

  /** Listen to the game's own events. Returns the unsubscribe — call it when the scene ends. */
  bind(): () => void {
    const offs = [
      events.on('PLAYER_DAMAGED', (p: { amount?: number; health?: number; maxHealth?: number }) => {
        const max = p?.maxHealth ?? 100;
        this.playerHurt(max > 0 ? (p?.amount ?? 10) / max : 0.1);
      }),
      events.on('PLAYER_DIED', () => this.playerDied()),
      events.on('ENEMY_DIED', () => this.enemyKilled()),
      events.on('GAME_OVER', () => this.save()),
    ];
    return () => { for (const off of offs) off(); this.save(); };
  }

  /** Remember this player's skill for next time (only with a gameId, only when adapting). */
  save(): void {
    if (!this.key || !this.adapt) return;
    try { globalThis.localStorage?.setItem(this.key, this.skill.toFixed(4)); } catch { /* storage blocked */ }
  }

  private targetDifficulty(): number {
    const s = this.skill;
    return s >= 0.5 ? 1 + (s - 0.5) * 2 * (this.max - 1) : 1 - (0.5 - s) * 2 * (1 - this.min);
  }
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
`;

const GRENADE = `/**
 * GRENADES AND BLASTS — pure arithmetic, like the rest of systems/ (admin 2026-11-19 game-gap audit: no grenade; a
 * hand-rolled one flew in a straight line, exploded on contact and hurt through walls).
 *
 *   const v = throwVelocity(yaw, 0.6, 14);                                    // direction + speed
 *   const flight = simulateThrow({ origin, velocity: v, fuse: 2.5 });          // the SAME path for the aim arc and the throw
 *   flight.points  → draw the arc while aiming;   flight.end  → where it goes off (after flight.time seconds)
 *   const hits = blastDamage(flight.end, enemies, { radius: 6, maxDamage: 100, blocked: (a, b) => !lineOfSight(a, b) });
 *   for (const h of hits) applyDamage(h.id, h.damage), push(h.id, h.impulse);
 * It arcs under gravity, bounces off the ground losing speed, rolls to a stop, and goes off when the fuse runs out. Damage
 * falls off from the centre to the edge, and a target behind cover takes none.
 */
export interface V3 { x: number; y: number; z: number }
export interface ThrowOptions {
  origin: V3; velocity: V3;
  gravity?: number;
  /** Ground height under (x, z). Default flat at 0. */
  ground?: (x: number, z: number) => number;
  /** How much upward speed survives a bounce (0..1). */
  bounce?: number;
  /** Sideways speed kept per bounce (0..1). */
  friction?: number;
  /** Seconds until it goes off. */
  fuse?: number;
  dt?: number;
  /** Radius of the grenade, so it rests on the ground rather than in it. */
  radius?: number;
}
export interface Flight { points: V3[]; end: V3; time: number; bounces: number }

/** A throw's starting velocity: yaw (radians, 0 = +Z), pitch upward (radians), speed (m/s). */
export function throwVelocity(yaw: number, pitch: number, speed: number): V3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c * speed, y: Math.sin(pitch) * speed, z: Math.cos(yaw) * c * speed };
}

export function simulateThrow(o: ThrowOptions): Flight {
  const g = o.gravity ?? -9.8, dt = o.dt ?? 1 / 60, fuse = Math.max(0, o.fuse ?? 2.5);
  const bounce = Math.max(0, Math.min(1, o.bounce ?? 0.35)), friction = Math.max(0, Math.min(1, o.friction ?? 0.7));
  const r = o.radius ?? 0.1, ground = o.ground ?? (() => 0);
  const p = { ...o.origin }, v = { ...o.velocity };
  const points: V3[] = [{ ...p }];
  let t = 0, bounces = 0;
  while (t < fuse) {
    v.y += g * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    const floor = ground(p.x, p.z) + r;
    if (p.y < floor) {
      p.y = floor;
      if (v.y < 0) {
        v.y = Math.abs(v.y) < 0.6 ? 0 : -v.y * bounce;
        v.x *= friction; v.z *= friction;
        if (v.y !== 0) bounces++;
      }
      // Rolling on the ground slows it down.
      if (v.y === 0) { const k = Math.max(0, 1 - 3 * dt); v.x *= k; v.z *= k; }
    }
    t += dt;
    points.push({ ...p });
  }
  return { points, end: { ...p }, time: fuse, bounces };
}

export interface BlastTarget { id: string; position: V3 }
export interface BlastHit { id: string; damage: number; impulse: V3; distance: number }

/**
 * Damage from a blast at center: maxDamage at the centre falling to minDamage at radius (linear), nothing beyond it.
 * blocked(center, target) = true means cover is between them: no damage. Each hit carries a push away from the blast.
 */
export function blastDamage(center: V3, targets: readonly BlastTarget[], o: { radius: number; maxDamage: number; minDamage?: number; force?: number; blocked?: (a: V3, b: V3) => boolean }): BlastHit[] {
  const out: BlastHit[] = [];
  const radius = Math.max(0.001, o.radius), min = Math.max(0, o.minDamage ?? 0), force = o.force ?? 12;
  for (const t of targets) {
    const dx = t.position.x - center.x, dy = t.position.y - center.y, dz = t.position.z - center.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    if (o.blocked?.(center, t.position)) continue;
    const k = 1 - d / radius;
    const damage = Math.round(min + (o.maxDamage - min) * k);
    const len = d || 1;
    out.push({ id: t.id, damage, distance: d, impulse: { x: (dx / len) * force * k, y: Math.max(0.3, dy / len + 0.5) * force * k, z: (dz / len) * force * k } });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
`;

const AIMASSIST = `/**
 * AIM ASSIST — a gentle pull toward a target near the crosshair, for thumbs and gamepads (admin 2026-11-19 game-gap
 * audit: a touch shooter was nearly unplayable — aiming a phone at a moving target with one thumb). It never snaps:
 * the aim turns part of the way, only toward a target inside a small cone and in range. Leave it OFF for a mouse.
 *
 *   const a = aimAssist({ origin: eye, dir: aimDir }, enemies, { cone: 8, range: 60, strength: 0.35 });
 *   aimDir = a.dir;   a.target  → the id it leaned toward, or null
 */
import type { V3 } from './grenade';

export interface AssistOptions {
  /** Half-angle of the cone, in degrees. */
  cone?: number;
  range?: number;
  /** 0..1: how far toward the target the aim turns each call. */
  strength?: number;
  /** Optional line-of-sight test: no pull toward a target behind a wall. */
  visible?: (from: V3, to: V3) => boolean;
}

const norm = (v: V3): V3 => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };

export function aimAssist(aim: { origin: V3; dir: V3 }, targets: ReadonlyArray<{ id: string; position: V3 }>, o: AssistOptions = {}): { dir: V3; target: string | null } {
  const cone = Math.max(0, o.cone ?? 8) * (Math.PI / 180), range = o.range ?? 60, strength = Math.max(0, Math.min(1, o.strength ?? 0.35));
  const dir = norm(aim.dir);
  let best: { id: string; to: V3; score: number } | null = null;
  for (const t of targets) {
    const v = { x: t.position.x - aim.origin.x, y: t.position.y - aim.origin.y, z: t.position.z - aim.origin.z };
    const d = Math.hypot(v.x, v.y, v.z);
    if (d === 0 || d > range) continue;
    const to = { x: v.x / d, y: v.y / d, z: v.z / d };
    const angle = Math.acos(Math.max(-1, Math.min(1, to.x * dir.x + to.y * dir.y + to.z * dir.z)));
    if (angle > cone) continue;
    if (o.visible && !o.visible(aim.origin, t.position)) continue;
    // Closest to the crosshair first, nearer targets breaking ties.
    const score = angle / Math.max(cone, 1e-6) + (d / range) * 0.25;
    if (!best || score < best.score) best = { id: t.id, to, score };
  }
  if (!best || strength === 0) return { dir, target: null };
  return { dir: norm({ x: dir.x + (best.to.x - dir.x) * strength, y: dir.y + (best.to.y - dir.y) * strength, z: dir.z + (best.to.z - dir.z) * strength }), target: best.id };
}
`;

const FILES: Record<string, string> = {
  'src/game/systems/combat.ts': COMBAT,
  'src/game/systems/ai.ts': AI,
  'src/game/systems/projectile.ts': PROJECTILE,
  'src/game/systems/spawner.ts': SPAWNER,
  // Pacing (build → peak → breather) and slow, bounded difficulty adaptation — 2026-10-05.
  'src/game/systems/director.ts': DIRECTOR,
  'src/game/systems/nav.ts': NAV,
  'src/game/systems/weapon.ts': WEAPON,
  'src/game/systems/grenade.ts': GRENADE,
  'src/game/systems/aimassist.ts': AIMASSIST,
};

export const GAME_SYSTEM_MODULES: readonly string[] = ['combat', 'ai', 'projectile', 'spawner', 'weapon', 'director', 'nav', 'grenade', 'aimassist'];

/** Generate the gameplay systems. Pure; never throws. */
export function generateGameSystems(include?: string[]): GameSystemsResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    // weapon.ts fires through projectile.ts.
    if (files['src/game/systems/weapon.ts']) files['src/game/systems/projectile.ts'] = FILES['src/game/systems/projectile.ts'];
    // ai.ts follows paths around walls (nav.ts).
    if (files['src/game/systems/ai.ts']) files['src/game/systems/nav.ts'] = FILES['src/game/systems/nav.ts'];
    if (files['src/game/systems/aimassist.ts']) files['src/game/systems/grenade.ts'] = FILES['src/game/systems/grenade.ts'];
    if (Object.keys(files).length === 0) files = { ...FILES };
  }

  return {
    files,
    dependencies: [], // pure arithmetic; the spawner reuses the 3D layer's seeded RNG
    instructions:
      `Added gameplay systems (${Object.keys(files).length} files under src/game/systems).\n` +
      '```ts\n' +
      'const hp = new Health({ max: 100, invulnerable: 0.6, damagedEvent: "PLAYER_DAMAGED", diedEvent: "PLAYER_DIED" });\n' +
      'const swing = new Cooldown(1.2);\n' +
      'const bullets = new ProjectileSystem();\n' +
      '\n' +
      '// in the FIXED update:\n' +
      'hp.tick(dt); swing.tick(dt);\n' +
      'const decision = stepEnemyAI(enemy.state, { player, neighbours, canSeePlayer }, DEFAULT_ENEMY, dt);\n' +
      'if (decision.wantsAttack && swing.tryUse()) hp.damage(10, enemy.state.position);\n' +
      'for (const hit of bullets.update(dt, targets)) (hit.target.ref as Health).damage(hit.damage);\n' +
      '// A GUN is a Weapon, not one projectile per click (weapon.ts):\n' +
      "const gun = new Weapon('rifle');   // pistol | rifle | smg | shotgun | sniper | bow\n" +
      '// isDown OR wasPressed: a quick tap that goes down and up inside one step must still fire.\n' +
      'gun.update(dt, input.isDown("attack") || input.wasPressed("attack"), muzzleWorldPos, aimDir, bullets); // camera.pitch += gun.kick\n' +
      'const sword = new MeleeWeapon(30); if (input.wasPressed("attack")) sword.swing();\n' +
      '// An ENEMY\'s gun or sword passes its id, so only the player\'s own shot poses the player\'s body:\n' +
      '// enemyGun.update(dt, wantsShot, enemyMuzzle, enemyAim, bullets, enemy.id); enemySword.swing(enemy.id);\n' +
      'for (const t of sword.update(dt, player.position, player.rotation.y, targets)) (t.ref as Health).damage(sword.damage);\n' +      '// The RHYTHM and the FLOW (director.ts): build → peak → breather, and difficulty that follows the player.\n' +
      "const director = new Director({ gameId: 'my-game' });   // adapt: false when scores are compared\n" +
      'const offDirector = director.bind();                   // listens to PLAYER_DAMAGED / DIED / ENEMY_DIED\n' +
      'const plan = planWave(wave, director.difficulty);      // and: if (director.canSpawn) spawn…\n' +
      '// each fixed step: director.update(dt);  on teardown: offDirector();\n' +
      '```\n' +
      'THE RULES THESE ENCODE — do not re-implement them by hand:\n' +
      '- Damage needs BOTH an attack cooldown and i-frames. With neither, an adjacent enemy deals its\n' +
      '  damage 60 times a second and the player dies in half a second. Lowering the damage is not a fix.\n' +
      '- Projectiles test the SEGMENT they travelled, not their new position. A 40 m/s bullet moves 0.66m\n' +
      '  per frame and would otherwise pass straight through a 0.5m enemy.\n' +
      '- Enemies need separation, or a group converges to one point and reads as a single enemy.\n' +      '- Mix ROLES: DEFAULT_ENEMY closes in, RANGED_ENEMY holds ~10 m and strafes while it shoots,\n' +
      '  FLANKER_ENEMY comes in from the side so a group surrounds. A shooter of only melee chasers is a queue.\n' +
      '- TELEGRAPH every heavy hit with AttackTelegraph: a readable wind-up (scale a glow by .progress),\n' +
      "  the blow on 'strike' ONLY if the player is still in range — that is the dodge. A boss uses BossPhases:\n" +
      "  emit BOSS_PHASE_CHANGED when update(hp / maxHp).changed, and change its attacks per phase.\n" +
      '- De-aggro radius must be LARGER than the detect radius, or enemies flicker at the boundary.\n' +
      '- The AI only REQUESTS an attack; a Cooldown decides if it happens.\n' +
      '- Enemies go AROUND walls: build one nav grid for the level (createNavGrid from nav.ts, blocked from your\n' +
      '  colliders\' boxes or a 2D world\'s isSolid) and pass it as perception.nav — they never see or strike through\n' +
      '  a wall, and a player who hides is hunted along a path instead of walked into the wall.\n' +
      '- A wave is cleared when every enemy is dead OR has fallen out of the world — otherwise one enemy\n' +
      '  through the floor hangs the level forever.\n' +
      '- A gun has a fire rate, semi/auto, a magazine, a reload you can be caught in, spread that blooms\n' +
      '  and recoil — Weapon does all of it. A shotgun is many pellets and ONE bang. An arrow falls.\n' +
      '- A melee swing hits what is IN FRONT, in reach, once per swing — MeleeWeapon, never a radius check\n' +
      '  every frame.\n' +
      '- Every action is SEEN, not only computed: the shell\'s player body plays a recoil when Weapon fires, a sweep\n' +
      '  when MeleeWeapon swings and a punch otherwise. For any other body or action call its pose yourself\n' +
      '  (ctx.hero.act(\'kick\'), an enemy humanoid\'s act(\'swing\') on its telegraph strike).\n' +
      '- A run needs RHYTHM: Director gives build → peak → a breather with no new enemies (canSpawn is\n' +
      '  false), and moves difficulty slowly (≤1.2%/s) toward what THIS player handles, easing at once after\n' +
      '  two quick deaths. It changes the challenge, never the score; pass adapt: false for a leaderboard.\n' +
      '- Everything is seeded and pure, so a run replays identically and difficulty is tunable.',
  };
}
