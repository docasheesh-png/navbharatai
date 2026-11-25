/**
 * 👥 ONE WAY TO PUT A CHARACTER IN A GAME (master audit 2026-11-25, Parts B, C and D).
 *
 * The admin's report: enemies sometimes never appear; a spawned enemy stands still; the player walks through other
 * characters; a punch passes through a body. The root cause, confirmed in the kit: every piece existed — the AI
 * (systems/ai.ts), Health (systems/combat.ts), a body (three/humanoid.ts), a walking capsule (play/character.ts) — and
 * NOTHING assembled them. Each game wired them by hand, so one forgot to add the body to the scene (it "spawned" and was
 * never seen), one never called stepEnemyAI each frame (it stood still), and none pushed characters apart (the capsule
 * only collides with marked world meshes, never with another character). The royale practice had its own private copy.
 *
 * So the kit now has one assembler, `Entities`:
 *   • spawn() builds the walking capsule, the body and the Health, adds them to the scene, and VERIFIES it: the entity is
 *     in the scene graph, at a finite position, with a visible body. A failed spawn is rolled back (nothing half-built is
 *     left behind), said with ENTITY_SPAWN_FAILED and counted — never reported as spawned. A good one emits ENTITY_SPAWNED.
 *   • it ticks itself through ctx.onStep (the shell's per-step hook), so an entity cannot be forgotten: the AI decides,
 *     the capsule walks (walls, slopes, ground), the body faces where it walks and plays its walk, Health ticks.
 *   • characters are pushed apart from each other AND from the player, every step — no one walks through anyone.
 *   • targets() / applyHits() connect bullets; melee() is a forward-cone strike — the same hit list for both.
 *   • death plays the body's fall, emits ENTITY_DIED (and Health's own ENEMY_DIED for a hostile one), and after a few
 *     seconds the entity is removed from the scene and disposed (ENTITY_REMOVED). A dead entity is never a target.
 *   • goTo(x, z) walks it to a point and emits ENTITY_ARRIVED only when it is really there (police, a delivery, a guard).
 */
export const GAME_ENTITIES_PATH = 'src/game/systems/entities.ts';

export const GAME_ENTITIES = String.raw`import * as THREE from 'three';
import { events } from '../core/events';
import { CharacterController } from '../play/character';
import { createHumanoid, type Humanoid, type HumanoidOptions } from '../three/humanoid';
import { groundHeightAt } from '../three/surfaces';
import { Health, Cooldown } from './combat';
import { stepEnemyAI, initialEnemyState, DEFAULT_ENEMY, RANGED_ENEMY, FLANKER_ENEMY, type EnemyConfig, type EnemyState, type Vec2 } from './ai';
import type { NavGrid } from './nav';
import type { ProjectileHit, ProjectileTarget } from './projectile';

/** What the entities need from the game — ctx is one. Without onStep, call entities.update(dt) yourself every step. */
export interface EntityHost {
  scene: THREE.Scene;
  player: { object: THREE.Object3D };
  onStep?: (fn: (delta: number) => void) => () => void;
}

export interface CharacterSpec {
  x: number;
  z: number;
  /** Feet height; default the ground under (x, z). */
  y?: number;
  /** What it is — 'enemy', 'police', 'villager', 'guard'… Free text; entities.alive('police') finds them. Default 'enemy'. */
  kind?: string;
  /** Chases and attacks the player. Default true for kind 'enemy', false otherwise. */
  hostile?: boolean;
  /** How it fights: 'melee' (default), 'ranged' (keeps its distance), 'flanker' (comes round the side), or a full config. */
  ai?: 'melee' | 'ranged' | 'flanker' | EnemyConfig;
  health?: number;
  /** Damage of one attack on the player (needs options.playerHealth or onAttack). Default 10. */
  damage?: number;
  /** Seconds between attacks. Default 1.2. */
  attackEvery?: number;
  /** Wander this far from where it spawned (0 = stand). Default 4. */
  patrolRadius?: number;
  /** The body: a model (a library character, already loaded) or the kit person's look. Default a kit person. */
  body?: THREE.Object3D | HumanoidOptions;
  radius?: number;
  height?: number;
}

export interface Entity {
  readonly id: string;
  readonly kind: string;
  /** The walking capsule's object — its position is the feet. */
  readonly object: THREE.Object3D;
  readonly controller: CharacterController;
  /** The kit person, or null for a model body. */
  readonly humanoid: Humanoid | null;
  readonly model: THREE.Object3D;
  readonly health: Health;
  hostile: boolean;
  state: EnemyState;
  readonly radius: number;
  readonly height: number;
  readonly alive: boolean;
  /** Walk to (x, z), then onArrive (and ENTITY_ARRIVED). A new goTo replaces the old one; null stops it. */
  goTo(target: Vec2 | null, onArrive?: (e: Entity) => void): void;
  /** Take it out of the game now (no fall, no corpse). */
  remove(): void;
}

export interface EntityOptions {
  /** The player's Health: a hostile entity's attack damages it. */
  playerHealth?: Health;
  /** Called on each landed attack (after playerHealth, if any). */
  onAttack?: (entity: Entity, damage: number) => void;
  /** Walls for the AI's sight and paths (systems/nav.ts). */
  nav?: NavGrid;
  /** Seconds a body lies before it is removed. Default 4. */
  corpseSeconds?: number;
  /** The player's capsule radius, for pushing apart. Default 0.4. */
  playerRadius?: number;
}

/** Push the walking circles of two bodies apart along the ground. 'a' and 'b' share it by weight (0 = does not move). PURE. */
export function separate(a: THREE.Vector3, ra: number, wa: number, b: THREE.Vector3, rb: number, wb: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const min = ra + rb;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || wa + wb <= 0) return false;
  const d = Math.sqrt(d2);
  // Exactly on top of each other: any direction is right, but a fixed one keeps it deterministic.
  const nx = d > 1e-6 ? dx / d : 1;
  const nz = d > 1e-6 ? dz / d : 0;
  const push = min - d;
  const share = wa / (wa + wb);
  a.x -= nx * push * share; a.z -= nz * push * share;
  b.x += nx * push * (1 - share); b.z += nz * push * (1 - share);
  return true;
}

function configOf(ai: CharacterSpec['ai']): EnemyConfig {
  if (ai && typeof ai === 'object') return ai;
  return ai === 'ranged' ? RANGED_ENEMY : ai === 'flanker' ? FLANKER_ENEMY : DEFAULT_ENEMY;
}

function inScene(object: THREE.Object3D, scene: THREE.Scene): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o === scene) return true;
  return false;
}

function hasVisibleMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) found = true; });
  return found;
}

interface Inner extends Entity {
  config: EnemyConfig;
  damage: number;
  cooldown: Cooldown;
  goal: Vec2 | null;
  onArrive?: (e: Entity) => void;
  deadFor: number;
  gone: boolean;
  lastHitByPlayer: boolean;
}

let nextId = 1;

export class Entities {
  private readonly list: Inner[] = [];
  private readonly off: (() => void) | null;
  private readonly options: EntityOptions;
  /** How many spawns were verified, and how many failed and were rolled back — the honest count. */
  readonly report = { spawned: 0, failed: 0, removed: 0 };

  constructor(private readonly host: EntityHost, options: EntityOptions = {}) {
    this.options = options;
    this.off = host.onStep ? host.onStep((dt) => this.update(dt)) : null;
  }

  /** Every entity still in the game (alive, or lying dead before removal). */
  get all(): readonly Entity[] { return this.list; }

  /** The living ones, optionally of one kind. */
  alive(kind?: string): Entity[] { return this.list.filter((e) => e.alive && (!kind || e.kind === kind)); }

  /** Put a character in the game. Returns null — and says why with ENTITY_SPAWN_FAILED — when it could not be verified. */
  spawn(spec: CharacterSpec): Entity | null {
    const kind = String(spec.kind || 'enemy');
    const created: { controller?: CharacterController; humanoid?: Humanoid | null } = {};
    const fail = (reason: string): null => {
      try {
        if (created.controller) this.host.scene.remove(created.controller.object);
        created.humanoid?.dispose();
      } catch { /* a rollback never throws */ }
      this.report.failed++;
      events.emit('ENTITY_SPAWN_FAILED', { kind, reason });
      console.warn('[entities] spawn of ' + kind + ' failed: ' + reason);
      return null;
    };
    try {
      if (!Number.isFinite(spec.x) || !Number.isFinite(spec.z)) return fail('position is not a number');
      const radius = spec.radius ?? 0.4;
      const height = spec.height ?? 1.8;
      const config = configOf(spec.ai);
      const controller = new CharacterController({ radius, height, config: { maxSpeed: config.chaseSpeed } });
      created.controller = controller;
      const y = Number.isFinite(spec.y) ? (spec.y as number) : groundHeightAt(spec.x, spec.z) + 0.05;
      controller.reset(spec.x, y, spec.z);
      let humanoid: Humanoid | null = null;
      let model: THREE.Object3D;
      if (spec.body instanceof THREE.Object3D) model = spec.body;
      else { humanoid = createHumanoid({ height, ...(spec.body || {}) }); model = humanoid.root; }
      created.humanoid = humanoid;
      controller.object.add(model);
      controller.object.name = kind;
      controller.object.userData.bounded = true; // kept inside the map's edge by the shell (play/boundary.ts)
      this.host.scene.add(controller.object);
      controller.object.updateMatrixWorld(true);
      // 🔒 VERIFIED, NOT ASSUMED: in the scene, at a finite position, with something the player can see.
      if (!inScene(controller.object, this.host.scene)) return fail('not in the scene');
      const p = controller.object.position;
      if (!Number.isFinite(p.x + p.y + p.z)) return fail('position is not finite');
      if (!hasVisibleMesh(model)) return fail('the body has no visible mesh');
      const hostile = spec.hostile ?? kind === 'enemy';
      const health = new Health({
        max: spec.health ?? 100,
        invulnerable: 0.15,
        damagedEvent: hostile ? 'ENEMY_DAMAGED' : 'NPC_DAMAGED',
        diedEvent: hostile ? 'ENEMY_DIED' : 'NPC_DIED',
      });
      const list = this.list;
      const report = this.report;
      const scene = this.host.scene;
      const e: Inner = {
        id: kind + '-' + nextId++,
        kind, object: controller.object, controller, humanoid, model, health, hostile,
        state: initialEnemyState(spec.x, spec.z, spec.patrolRadius ?? 4),
        radius, height, config,
        damage: spec.damage ?? 10,
        cooldown: new Cooldown(spec.attackEvery ?? 1.2),
        goal: null, deadFor: 0, gone: false, lastHitByPlayer: false,
        get alive() { return !this.gone && !this.health.isDead; },
        goTo(target, onArrive) { this.goal = target ? { x: target.x, z: target.z } : null; this.onArrive = onArrive; },
        remove() {
          if (this.gone) return;
          this.gone = true;
          scene.remove(this.object);
          try { this.humanoid?.dispose(); } catch { /* disposing never throws */ }
          const i = list.indexOf(this);
          if (i >= 0) list.splice(i, 1);
          report.removed++;
          events.emit('ENTITY_REMOVED', { id: this.id, kind: this.kind });
        },
      };
      list.push(e);
      this.report.spawned++;
      events.emit('ENTITY_SPAWNED', { id: e.id, kind, position: { x: p.x, y: p.y, z: p.z } });
      return e;
    } catch (error) {
      return fail(String((error as { message?: string })?.message ?? error).slice(0, 160));
    }
  }

  /** One step: decide, walk, face, attack, keep apart, die and clear away. ctx.onStep calls it; never call it twice a step. */
  update(delta: number): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
    if (dt === 0) return;
    const player = this.host.player.object.position;
    const me: Vec2 = { x: player.x, z: player.z };
    const far: Vec2 = { x: 1e9, z: 1e9 };
    for (const e of [...this.list]) {
      e.health.tick(dt);
      e.cooldown.tick(dt);
      if (e.health.isDead) { this.whileDead(e, dt); continue; }
      const pos = e.object.position;
      let vx = 0;
      let vz = 0;
      if (e.goal) {
        const dx = e.goal.x - pos.x;
        const dz = e.goal.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d <= Math.max(1, e.radius * 2.5)) {
          const done = e.onArrive;
          e.goal = null; e.onArrive = undefined;
          // It stays where it was sent: that is home now (it used to walk back to where it spawned).
          e.state = { ...e.state, mode: 'idle', timeInMode: 0, home: { x: pos.x, z: pos.z }, path: undefined };
          events.emit('ENTITY_ARRIVED', { id: e.id, kind: e.kind, position: { x: pos.x, y: pos.y, z: pos.z } });
          done?.(e);
        } else { vx = (dx / d) * e.config.chaseSpeed; vz = (dz / d) * e.config.chaseSpeed; }
        e.state = { ...e.state, position: { x: pos.x, z: pos.z } };
        if (!e.goal) { e.controller.update(dt, { moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, jumpHeld: false }); e.humanoid?.update(dt, 0, true); continue; }
      } else {
        const neighbours: Vec2[] = [];
        for (const o of this.list) {
          if (o === e || !o.alive) continue;
          const q = o.object.position;
          if (Math.abs(q.x - pos.x) < 4 && Math.abs(q.z - pos.z) < 4) neighbours.push({ x: q.x, z: q.z });
        }
        e.state = { ...e.state, position: { x: pos.x, z: pos.z } };
        const decision = stepEnemyAI(e.state, { player: e.hostile ? me : far, neighbours, canSeePlayer: e.hostile, nav: this.options.nav }, e.config, dt);
        e.state = decision.state;
        vx = decision.velocity.x; vz = decision.velocity.z;
        if (decision.alerted) events.emit('ENTITY_ALERTED', { id: e.id, kind: e.kind });
        if (e.hostile && decision.wantsAttack && e.cooldown.tryUse()) this.attack(e);
      }
      const max = Math.max(0.01, e.config.chaseSpeed);
      const mx = THREE.MathUtils.clamp(vx / max, -1, 1);
      const mz = THREE.MathUtils.clamp(vz / max, -1, 1);
      e.controller.update(dt, { moveX: mx, moveZ: mz, sprint: false, jumpPressed: false, jumpHeld: false });
      if (Math.hypot(vx, vz) > 0.2) {
        const want = Math.atan2(vx, vz);
        let d = want - e.model.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        e.model.rotation.y += d * Math.min(1, dt * 10);
      } else if (e.hostile && e.state.mode === 'attack') {
        e.model.rotation.y = Math.atan2(player.x - pos.x, player.z - pos.z);
      }
      e.humanoid?.update(dt, e.controller.speed, e.controller.isGrounded);
    }
    this.keepApart();
  }

  /** The living entities as bullet targets (chest height). Pass to ProjectileSystem.update, then applyHits. */
  targets(): ProjectileTarget[] {
    return this.alive().map((e) => {
      const p = e.object.position;
      return { position: { x: p.x, y: p.y + e.height * 0.6, z: p.z }, radius: Math.max(e.radius, 0.35), ref: e };
    });
  }

  /** Damage the entities the bullets hit. Returns the ones that died. Hits on anything else are left alone. */
  applyHits(hits: readonly ProjectileHit[]): Entity[] {
    const killed: Entity[] = [];
    for (const h of hits) {
      const e = h.target.ref as Inner | undefined;
      if (!e || !this.list.includes(e) || !e.alive) continue;
      // No owner is the player's own gun (the kit's convention: an enemy's gun passes its id).
      if (this.hurt(e, h.damage, h.point, !h.ownerId)) killed.push(e);
    }
    return killed;
  }

  /** Any other harm — a grenade's blastDamage, a car that hits someone. Returns true when it died. */
  damage(entity: Entity, amount: number, byPlayer = true): boolean {
    const e = entity as Inner;
    if (!this.list.includes(e) || !e.alive) return false;
    return this.hurt(e, amount, e.object.position, byPlayer);
  }

  /**
   * A punch, a kick, a sword: every living entity in front of origin (facing yaw — models face +Z), within range and the arc,
   * nearest first, takes the damage. Returns who was hit. The attacker itself (by object) is never hit.
   */
  melee(origin: THREE.Vector3, yaw: number, damage: number, options: { range?: number; arc?: number; attacker?: THREE.Object3D; only?: 'first' | 'all'; byPlayer?: boolean } = {}): Entity[] {
    const range = options.range ?? 1.8;
    const half = (options.arc ?? Math.PI * 0.6) / 2;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const inReach = this.alive().filter((e) => e.object !== options.attacker).map((e) => {
      const p = e.object.position;
      const dx = p.x - origin.x;
      const dz = p.z - origin.z;
      const d = Math.hypot(dx, dz);
      const angle = d > 1e-6 ? Math.acos(THREE.MathUtils.clamp((dx * fx + dz * fz) / d, -1, 1)) : 0;
      return { e, d, ok: d - e.radius <= range && angle <= half && Math.abs(p.y - origin.y) < 2 };
    }).filter((x) => x.ok).sort((a, b) => a.d - b.d).map((x) => x.e as Inner);
    const hit = options.only === 'all' ? inReach : inReach.slice(0, 1);
    for (const e of hit) {
      this.hurt(e, damage, e.object.position, options.byPlayer ?? !options.attacker);
      // Knocked back a little, away from the blow, so the hit reads as a hit.
      const p = e.object.position;
      const d = Math.max(1e-6, Math.hypot(p.x - origin.x, p.z - origin.z));
      p.x += ((p.x - origin.x) / d) * 0.25; p.z += ((p.z - origin.z) / d) * 0.25;
    }
    return hit;
  }

  /** Remove every entity and stop ticking. */
  dispose(): void {
    for (const e of [...this.list]) e.remove();
    this.off?.();
  }

  private hurt(e: Inner, amount: number, at: { x: number; y: number; z: number }, byPlayer: boolean): boolean {
    const r = e.health.damage(amount, { x: at.x, y: at.y, z: at.z });
    if (r.applied > 0) {
      e.lastHitByPlayer = byPlayer;
      // Who did it is said, so a crime (systems/dispatch.ts) is the player's only when it really was.
      events.emit('ENTITY_HURT', { id: e.id, kind: e.kind, hostile: e.hostile, byPlayer, amount: r.applied, died: r.died });
    }
    if (r.applied > 0 && !r.died) e.humanoid?.act('hit');
    // Hurt by the player: it fights back, whatever it was doing.
    if (r.applied > 0 && byPlayer && e.kind === 'enemy') e.hostile = true;
    if (r.died) this.died(e);
    return r.died;
  }

  private died(e: Inner): void {
    e.goal = null;
    e.state = { ...e.state, mode: 'dead' };
    const p = e.object.position;
    const player = this.host.player.object.position;
    // Falls away from the player: backward when the player is in front.
    const facing = e.model.rotation.y;
    const front = Math.sin(facing) * (player.x - p.x) + Math.cos(facing) * (player.z - p.z) >= 0;
    e.humanoid?.die(front);
    if (!e.humanoid) e.model.rotation.x = -Math.PI / 2;
    events.emit('ENTITY_DIED', { id: e.id, kind: e.kind, hostile: e.hostile, byPlayer: e.lastHitByPlayer, position: { x: p.x, y: p.y, z: p.z } });
  }

  private whileDead(e: Inner, dt: number): void {
    e.deadFor += dt;
    e.humanoid?.update(dt, 0, true);
    if (e.deadFor >= (this.options.corpseSeconds ?? 4)) e.remove();
  }

  private attack(e: Inner): void {
    e.humanoid?.act(e.config.role === 'ranged' ? 'fire' : 'punch');
    const p = e.object.position;
    this.options.playerHealth?.damage(e.damage, { x: p.x, y: p.y, z: p.z });
    this.options.onAttack?.(e, e.damage);
    events.emit('ENTITY_ATTACKED', { id: e.id, kind: e.kind, damage: e.damage });
  }

  /** Nobody walks through anybody: every pair of living bodies, and each body and the player, are pushed apart. */
  private keepApart(): void {
    const living = this.list.filter((e) => e.alive);
    const player = this.host.player.object.position;
    const pr = this.options.playerRadius ?? 0.4;
    for (let i = 0; i < living.length; i++) {
      const a = living[i];
      // The player is pushed too (weight 1 each): walking into someone stops you, it does not walk through them.
      separate(player, pr, 1, a.object.position, a.radius, 1);
      for (let j = i + 1; j < living.length; j++) {
        const b = living[j];
        separate(a.object.position, a.radius, 1, b.object.position, b.radius, 1);
      }
    }
  }
}
`;
