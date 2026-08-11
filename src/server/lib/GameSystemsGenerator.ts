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
}

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

export interface EnemyState {
  mode: EnemyMode;
  position: Vec2;
  facing: number;
  /** Patrol target; ignored in other modes. */
  home: Vec2;
  patrolRadius: number;
  timeInMode: number;
}

export interface EnemyPerception {
  player: Vec2;
  /** Other enemies near enough to matter. Pass the neighbours, not the whole level. */
  neighbours: Vec2[];
  /** False when a wall is in the way — the AI itself does no raycasting. */
  canSeePlayer: boolean;
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

  // Asymmetric radii: a single radius makes the enemy flicker between chase and idle at the boundary.
  const engaged = perception.canSeePlayer
    && (wasChasing ? toPlayer <= config.loseRadius : toPlayer <= config.detectRadius);

  let mode: EnemyMode;
  if (!engaged) mode = s.patrolRadius > 0 ? 'patrol' : 'idle';
  else if (toPlayer <= config.attackRadius) mode = 'attack';
  else mode = 'chase';

  const alerted = !wasChasing && (mode === 'chase' || mode === 'attack');
  if (mode !== s.mode) { s.mode = mode; s.timeInMode = 0; }

  let desired: Vec2 = { x: 0, z: 0 };
  let speed = 0;

  if (mode === 'chase') {
    desired = normalise({ x: perception.player.x - s.position.x, z: perception.player.z - s.position.z });
    speed = config.chaseSpeed;
  } else if (mode === 'patrol') {
    // A deterministic loop around home: no Math.random, so a replay is identical.
    const t = s.timeInMode * 0.5;
    const target = { x: s.home.x + Math.cos(t) * s.patrolRadius, z: s.home.z + Math.sin(t) * s.patrolRadius };
    desired = normalise({ x: target.x - s.position.x, z: target.z - s.position.z });
    speed = config.speed;
  }

  // Separation applies even while attacking, or the pack piles into one square metre.
  const sep = separationVector(s.position, perception.neighbours, config.separationRadius);
  let vx = desired.x * speed + sep.x * config.separation * Math.max(speed, config.speed);
  let vz = desired.z * speed + sep.z * config.separation * Math.max(speed, config.speed);

  // Never exceed the mode's speed, however hard separation pushes.
  const mag = Math.hypot(vx, vz);
  const cap = Math.max(speed, mode === 'attack' ? config.speed : speed);
  if (mag > cap && mag > 1e-6) { vx = (vx / mag) * cap; vz = (vz / mag) * cap; }

  // Face where it is going (or the player while attacking), turning at a finite rate.
  const faceTarget = mode === 'attack'
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
    events.emit('WEAPON_FIRED', { position: { ...options.position } });
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
        events.emit('PROJECTILE_HIT', { position: hit.point, damage: s.damage });
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

const FILES: Record<string, string> = {
  'src/game/systems/combat.ts': COMBAT,
  'src/game/systems/ai.ts': AI,
  'src/game/systems/projectile.ts': PROJECTILE,
  'src/game/systems/spawner.ts': SPAWNER,
};

export const GAME_SYSTEM_MODULES: readonly string[] = ['combat', 'ai', 'projectile', 'spawner'];

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
      '```\n' +
      'THE RULES THESE ENCODE — do not re-implement them by hand:\n' +
      '- Damage needs BOTH an attack cooldown and i-frames. With neither, an adjacent enemy deals its\n' +
      '  damage 60 times a second and the player dies in half a second. Lowering the damage is not a fix.\n' +
      '- Projectiles test the SEGMENT they travelled, not their new position. A 40 m/s bullet moves 0.66m\n' +
      '  per frame and would otherwise pass straight through a 0.5m enemy.\n' +
      '- Enemies need separation, or a group converges to one point and reads as a single enemy.\n' +
      '- De-aggro radius must be LARGER than the detect radius, or enemies flicker at the boundary.\n' +
      '- The AI only REQUESTS an attack; a Cooldown decides if it happens.\n' +
      '- A wave is cleared when every enemy is dead OR has fallen out of the world — otherwise one enemy\n' +
      '  through the floor hangs the level forever.\n' +
      '- Everything is seeded and pure, so a run replays identically and difficulty is tunable.',
  };
}
