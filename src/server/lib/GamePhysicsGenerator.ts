// Physics — stage A: the Rapier world, with the rules that make a physics world safe to ship in a game.
//
// WHAT THIS IS. A thin, typed layer over Rapier 3D (the official `@dimforge/rapier3d-compat` WASM package, Apache-2.0)
// that gives a game real rigid bodies, colliders, collision events, trigger volumes, raycasts, collision groups,
// snapshots and a debug view. Three.js still draws; Rapier simulates; the binding copies transforms across with
// interpolation. It is OPTIONAL: nothing in the kit imports it unless the game asks for physics, and the WASM is loaded
// lazily the first time `PhysicsWorld.create()` runs, so a simple game never downloads it.
//
// STAGE B (this change) adds a walking, jumping CHARACTER on Rapier's own KinematicCharacterController: slopes, steps,
// walls, snap-to-ground, jump with coyote time and a jump buffer, air control, moving platforms. NOT HERE YET (stage C, its
// own change with its own tests): the VEHICLE controller. Nothing in this file claims a car is physical. The kit's
// own generate_game_controller (a pure-arithmetic motor with no physics world) is unchanged and is still the right choice
// for a game that does not use this module; use this character only when the game has a physics world to collide with.
//
// WHY THIS IS A RECIPE AND NOT LEFT TO THE MODEL. A physics world goes wrong in specific ways:
//
//   • A SIMULATION THAT RUNS AT THE FRAME RATE. Physics stepped once per rendered frame behaves differently at 30, 60 and
//     144 fps — a ball falls further on a slow phone. The world accumulates frame time and steps in FIXED slices, with a
//     bounded number of catch-up steps; a hitch is dropped (and reported) instead of spiralling.
//   • THE SPIRAL OF DEATH. A slow frame demands more steps, which makes the next frame slower. A frame longer than
//     `maxFrameDelta` is clamped, and no more than `maxStepsPerFrame` run; the time that could not be simulated is
//     counted in `stats().droppedSeconds` and announced as 'lagging' — never silently exceeded.
//   • JERKY MOTION. The fixed slice and the render rate differ, so drawing the last physics state looks stuttery. The
//     world keeps the previous state and `getInterpolated(id)` blends by the leftover fraction.
//   • A WASM THAT BREAKS THE GAME. If the module cannot load (blocked, offline, unsupported), `create()` does NOT throw:
//     it returns a world with `available === false` and a reason, every call is a safe no-op that says so, and the game
//     can fall back to its procedural movement. Physics is an upgrade, never a single point of failure.
//   • UNBOUNDED INPUT. Bodies, colliders, joints, extents, masses, mesh triangles and every number in a body spec are
//     validated and capped; a NaN, a negative radius or a million-triangle mesh is refused with a reason, not passed to
//     native code. A dynamic body cannot have a triangle-mesh collider (Rapier cannot simulate one).
//   • LEAKED NATIVE MEMORY. Worlds, event queues and bodies live in WASM memory the garbage collector cannot see.
//     `removeBody`, `reset` and `dispose` free what they own, every map is emptied, and a disposed world is a safe no-op.
//   • EVENTS FIRED MID-STEP. A listener that adds or removes a body from inside a collision callback corrupts the step.
//     Events are collected during the step and delivered after it, each listener isolated from the others' errors.
//   • A SAVE THAT CANNOT BE LOADED BACK. A snapshot carries a version, the id <-> handle map and the body specs; a
//     restore validates all of it and leaves the current world untouched if anything is wrong.
//
// Honest limits: determinism holds on one machine and one binary — not promised across devices or CPU architectures;
// nothing here has been measured on a physical phone or in a Capacitor WebView (only on desktop Chromium/Node), so no
// mobile claim is made; the debug view is for development and is OFF unless asked for.
//
// PURE as a builder → the caller writes the files. The files themselves import `@dimforge/rapier3d-compat` (types
// statically, the module lazily).

export interface GamePhysicsResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** The exact package and version the kit is written and tested against. */
export const RAPIER_PACKAGE = '@dimforge/rapier3d-compat';
export const RAPIER_VERSION = '0.21.0';

const CONFIG = String.raw`/** Everything the world is allowed to be. Every number has a floor and a ceiling; nothing here can be unbounded. */
export interface PhysicsConfig {
  gravity: { x: number; y: number; z: number };
  /** Seconds per simulation step. 1/60 by default; independent of the render rate. */
  timestep: number;
  /** Most steps one rendered frame may run. The rest of the time is dropped and reported, never simulated late. */
  maxStepsPerFrame: number;
  /** A frame longer than this many seconds is treated as this long (a tab that slept must not run for a minute). */
  maxFrameDelta: number;
  solverIterations: number;
  maxBodies: number;
  maxColliders: number;
  maxJoints: number;
  /** Bodies at rest fall asleep and cost almost nothing. */
  sleeping: boolean;
  /** Bodies may not be placed farther than this from the origin (metres). */
  worldBounds: number;
  /** Development only: allow debugLines(). OFF unless asked for; never ship it on. */
  debug: boolean;
}

export const DEFAULT_PHYSICS: Readonly<PhysicsConfig> = {
  gravity: { x: 0, y: -9.81, z: 0 },
  timestep: 1 / 60,
  maxStepsPerFrame: 5,
  maxFrameDelta: 0.25,
  solverIterations: 4,
  maxBodies: 512,
  maxColliders: 1024,
  maxJoints: 128,
  sleeping: true,
  worldBounds: 2000,
  debug: false,
};

function n(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Turn anything into a valid config: clamp every number, drop unknown keys, never throw. */
export function sanitizePhysicsConfig(raw: unknown): PhysicsConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const g = (r.gravity && typeof r.gravity === 'object' ? r.gravity : {}) as Record<string, unknown>;
  const d = DEFAULT_PHYSICS;
  return {
    gravity: { x: n(g.x, -100, 100, d.gravity.x), y: n(g.y, -100, 100, d.gravity.y), z: n(g.z, -100, 100, d.gravity.z) },
    timestep: n(r.timestep, 1 / 240, 1 / 20, d.timestep),
    maxStepsPerFrame: Math.floor(n(r.maxStepsPerFrame, 1, 20, d.maxStepsPerFrame)),
    maxFrameDelta: n(r.maxFrameDelta, 0.01, 1, d.maxFrameDelta),
    solverIterations: Math.floor(n(r.solverIterations, 1, 16, d.solverIterations)),
    maxBodies: Math.floor(n(r.maxBodies, 1, 5000, d.maxBodies)),
    maxColliders: Math.floor(n(r.maxColliders, 1, 10000, d.maxColliders)),
    maxJoints: Math.floor(n(r.maxJoints, 0, 1000, d.maxJoints)),
    sleeping: typeof r.sleeping === 'boolean' ? r.sleeping : d.sleeping,
    worldBounds: n(r.worldBounds, 10, 100000, d.worldBounds),
    debug: r.debug === true,
  };
}

export type BodyType = 'dynamic' | 'static' | 'kinematic';
export type ShapeSpec =
  | { type: 'box'; hx: number; hy: number; hz: number }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; halfHeight: number; radius: number }
  | { type: 'cylinder'; halfHeight: number; radius: number }
  | { type: 'convex'; points: number[] }
  | { type: 'trimesh'; vertices: number[]; indices: number[] };

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** One physical thing. id is YOUR stable entity id; the world maps it to a native body and back. */
export interface BodySpec {
  id: string;
  type: BodyType;
  shape: ShapeSpec;
  position: Vec3;
  rotation?: Quat;
  /** Give mass OR density, not both. With neither, density is 1. */
  mass?: number;
  density?: number;
  friction?: number;
  restitution?: number;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  lockRotation?: boolean;
  lockTranslation?: boolean;
  canSleep?: boolean;
  /** Continuous collision detection: for a fast, small body that would otherwise tunnel through a thin wall. */
  ccd?: boolean;
  /** A trigger volume: it reports overlaps but nothing bounces off it. */
  sensor?: boolean;
  /** Which group this body belongs to (0..15) and which groups it collides with (a 16-bit mask, default all). */
  collisionGroup?: number;
  collisionMask?: number;
}

export const MAX_EXTENT = 1000;
export const MAX_CONVEX_POINTS = 256;
export const MAX_TRIANGLES = 20000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number): boolean => finite(v) && v >= lo && v <= hi;
const vec = (v: unknown, bound: number): boolean => !!v && typeof v === 'object' && inRange((v as Vec3).x, -bound, bound) && inRange((v as Vec3).y, -bound, bound) && inRange((v as Vec3).z, -bound, bound);

/**
 * Why this body cannot be added, or null when it can. Native code never sees a spec this has not passed: NaN,
 * negatives, absurd sizes, a dynamic triangle mesh, a mesh with a bad index — each is refused here, in words.
 */
export function validateBodySpec(spec: unknown, cfg: PhysicsConfig): string | null {
  if (!spec || typeof spec !== 'object') return 'the body is not an object';
  const s = spec as BodySpec;
  if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 120) return 'a body needs a text id of 1 to 120 characters';
  if (s.type !== 'dynamic' && s.type !== 'static' && s.type !== 'kinematic') return 'type must be dynamic, static or kinematic';
  if (!vec(s.position, cfg.worldBounds)) return 'position must be finite and within ' + cfg.worldBounds + ' m of the origin';
  if (s.rotation !== undefined) {
    const q = s.rotation;
    if (!q || !finite(q.x) || !finite(q.y) || !finite(q.z) || !finite(q.w)) return 'rotation must be four finite numbers';
    if (Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 0.01) return 'rotation must be a unit quaternion';
  }
  const shape = s.shape;
  if (!shape || typeof shape !== 'object') return 'a body needs a shape';
  switch (shape.type) {
    case 'box': if (!inRange(shape.hx, 0.001, MAX_EXTENT) || !inRange(shape.hy, 0.001, MAX_EXTENT) || !inRange(shape.hz, 0.001, MAX_EXTENT)) return 'box half-sizes must be between 0.001 and ' + MAX_EXTENT; break;
    case 'sphere': if (!inRange(shape.radius, 0.001, MAX_EXTENT)) return 'sphere radius must be between 0.001 and ' + MAX_EXTENT; break;
    case 'capsule':
    case 'cylinder': if (!inRange(shape.radius, 0.001, MAX_EXTENT) || !inRange(shape.halfHeight, 0.001, MAX_EXTENT)) return shape.type + ' radius and half height must be between 0.001 and ' + MAX_EXTENT; break;
    case 'convex':
      if (!Array.isArray(shape.points) || shape.points.length < 12 || shape.points.length % 3 !== 0 || shape.points.length > MAX_CONVEX_POINTS * 3) return 'a convex hull needs 4 to ' + MAX_CONVEX_POINTS + ' points (x, y, z each)';
      if (!shape.points.every((p) => inRange(p, -MAX_EXTENT, MAX_EXTENT))) return 'convex points must be finite and within ' + MAX_EXTENT;
      break;
    case 'trimesh': {
      if (s.type !== 'static') return 'a triangle mesh can only be a static body (a moving one is expensive and not simulated correctly) — use a box, sphere, capsule or convex hull for anything that moves';
      const v = shape.vertices;
      const idx = shape.indices;
      if (!Array.isArray(v) || v.length < 9 || v.length % 3 !== 0 || !v.every((p) => inRange(p, -MAX_EXTENT * 10, MAX_EXTENT * 10))) return 'a triangle mesh needs finite vertices (x, y, z each)';
      if (!Array.isArray(idx) || idx.length < 3 || idx.length % 3 !== 0 || idx.length / 3 > MAX_TRIANGLES) return 'a triangle mesh needs 1 to ' + MAX_TRIANGLES + ' triangles';
      const count = v.length / 3;
      if (!idx.every((i) => Number.isInteger(i) && i >= 0 && i < count)) return 'a triangle index points outside the vertices';
      break;
    }
    default: return 'unknown shape type';
  }
  if (s.mass !== undefined && s.density !== undefined) return 'give a mass or a density, not both';
  if (s.mass !== undefined && !inRange(s.mass, 0.001, 1e6)) return 'mass must be between 0.001 and 1,000,000';
  if (s.density !== undefined && !inRange(s.density, 0.001, 1e5)) return 'density must be between 0.001 and 100,000';
  if (s.friction !== undefined && !inRange(s.friction, 0, 10)) return 'friction must be between 0 and 10';
  if (s.restitution !== undefined && !inRange(s.restitution, 0, 1)) return 'restitution must be between 0 and 1';
  if (s.gravityScale !== undefined && !inRange(s.gravityScale, -10, 10)) return 'gravityScale must be between -10 and 10';
  if (s.linearDamping !== undefined && !inRange(s.linearDamping, 0, 100)) return 'linearDamping must be between 0 and 100';
  if (s.angularDamping !== undefined && !inRange(s.angularDamping, 0, 100)) return 'angularDamping must be between 0 and 100';
  if (s.collisionGroup !== undefined && !(Number.isInteger(s.collisionGroup) && s.collisionGroup >= 0 && s.collisionGroup <= 15)) return 'collisionGroup must be a whole number from 0 to 15';
  if (s.collisionMask !== undefined && !(Number.isInteger(s.collisionMask) && s.collisionMask >= 0 && s.collisionMask <= 0xffff)) return 'collisionMask must be a whole number from 0 to 65535';
  return null;
}

/**
 * A walking, jumping character: a capsule on a KINEMATIC body moved by Rapier's own KinematicCharacterController, so it
 * slides along walls, climbs slopes up to a limit, steps over small ledges, snaps down gentle slopes and is carried by
 * moving platforms. Everything has a default; give only what the game needs to change. Total height is
 * 2 * (halfHeight + radius): the defaults are 1.8 m.
 */
export interface CharacterSpec {
  id: string;
  /** The centre of the capsule. */
  position: Vec3;
  radius?: number;
  halfHeight?: number;
  /** The small gap kept between the capsule and what it touches (metres). */
  offset?: number;
  /** Steepest slope it can walk UP, in degrees. */
  maxSlopeClimbDeg?: number;
  /** Slopes steeper than this make it slide down, in degrees. */
  minSlopeSlideDeg?: number;
  /** The tallest ledge it steps over without jumping (metres); 0 turns stepping off. */
  autostepHeight?: number;
  autostepMinWidth?: number;
  /** How far down it follows the ground so walking downhill does not become a series of hops (metres); 0 turns it off. */
  snapToGround?: number;
  jumpSpeed?: number;
  gravityScale?: number;
  maxFallSpeed?: number;
  /** Seconds after leaving a ledge during which a jump still works. */
  coyoteTime?: number;
  /** Seconds a jump pressed just before landing is remembered. */
  jumpBuffer?: number;
  /** 0 = no steering in the air, 1 = as much as on the ground. */
  airControl?: number;
  /** Horizontal acceleration on the ground (m/s squared). */
  acceleration?: number;
  /** Whether walking into a dynamic body pushes it. */
  pushDynamic?: boolean;
  mass?: number;
  collisionGroup?: number;
  collisionMask?: number;
}

export interface ResolvedCharacter {
  radius: number; halfHeight: number; offset: number; maxSlopeClimbDeg: number; minSlopeSlideDeg: number;
  autostepHeight: number; autostepMinWidth: number; snapToGround: number; jumpSpeed: number; gravityScale: number;
  maxFallSpeed: number; coyoteTime: number; jumpBuffer: number; airControl: number; acceleration: number;
  pushDynamic: boolean; mass: number;
}

/** The numbers a character really runs with: the spec's own where it gave one, the default otherwise. */
export function resolveCharacter(spec: CharacterSpec): ResolvedCharacter {
  return {
    radius: spec.radius ?? 0.35, halfHeight: spec.halfHeight ?? 0.55, offset: spec.offset ?? 0.02,
    maxSlopeClimbDeg: spec.maxSlopeClimbDeg ?? 50, minSlopeSlideDeg: spec.minSlopeSlideDeg ?? 55,
    autostepHeight: spec.autostepHeight ?? 0.3, autostepMinWidth: spec.autostepMinWidth ?? 0.2, snapToGround: spec.snapToGround ?? 0.3,
    jumpSpeed: spec.jumpSpeed ?? 6.5, gravityScale: spec.gravityScale ?? 1, maxFallSpeed: spec.maxFallSpeed ?? 40,
    coyoteTime: spec.coyoteTime ?? 0.1, jumpBuffer: spec.jumpBuffer ?? 0.12, airControl: spec.airControl ?? 0.3,
    acceleration: spec.acceleration ?? 40, pushDynamic: spec.pushDynamic ?? true, mass: spec.mass ?? 70,
  };
}

/** Why this character cannot be added, or null when it can. The same discipline as validateBodySpec: nothing odd reaches native code. */
export function validateCharacterSpec(spec: unknown, cfg: PhysicsConfig): string | null {
  if (!spec || typeof spec !== 'object') return 'the character is not an object';
  const s = spec as CharacterSpec;
  if (typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 120) return 'a character needs a text id of 1 to 120 characters';
  if (!vec(s.position, cfg.worldBounds)) return 'position must be finite and within ' + cfg.worldBounds + ' m of the origin';
  const ranges: Array<[string, unknown, number, number]> = [
    ['radius', s.radius, 0.05, 5], ['halfHeight', s.halfHeight, 0.05, 10], ['offset', s.offset, 0.001, 0.5],
    ['maxSlopeClimbDeg', s.maxSlopeClimbDeg, 0, 89], ['minSlopeSlideDeg', s.minSlopeSlideDeg, 0, 89],
    ['autostepHeight', s.autostepHeight, 0, 2], ['autostepMinWidth', s.autostepMinWidth, 0.01, 2], ['snapToGround', s.snapToGround, 0, 2],
    ['jumpSpeed', s.jumpSpeed, 0, 30], ['gravityScale', s.gravityScale, 0, 10], ['maxFallSpeed', s.maxFallSpeed, 1, 200],
    ['coyoteTime', s.coyoteTime, 0, 0.5], ['jumpBuffer', s.jumpBuffer, 0, 0.5], ['airControl', s.airControl, 0, 1],
    ['acceleration', s.acceleration, 1, 500], ['mass', s.mass, 1, 100000],
  ];
  for (const [name, value, lo, hi] of ranges) if (value !== undefined && !inRange(value, lo, hi)) return name + ' must be between ' + lo + ' and ' + hi;
  if (s.pushDynamic !== undefined && typeof s.pushDynamic !== 'boolean') return 'pushDynamic must be true or false';
  if (s.collisionGroup !== undefined && !(Number.isInteger(s.collisionGroup) && s.collisionGroup >= 0 && s.collisionGroup <= 15)) return 'collisionGroup must be a whole number from 0 to 15';
  if (s.collisionMask !== undefined && !(Number.isInteger(s.collisionMask) && s.collisionMask >= 0 && s.collisionMask <= 0xffff)) return 'collisionMask must be a whole number from 0 to 65535';
  return null;
}

/** Rapier packs "I am in group g" (high 16 bits) and "I collide with mask m" (low 16 bits) into one number. */
export function interactionGroups(group: number | undefined, mask: number | undefined): number {
  const membership = 1 << (group ?? 0);
  return (((membership & 0xffff) << 16) | ((mask ?? 0xffff) & 0xffff)) >>> 0;
}
`;

const WORLD = String.raw`import type { World as RWorld, RigidBody, Collider, EventQueue as REventQueue } from '@dimforge/rapier3d-compat';
import { sanitizePhysicsConfig, validateBodySpec, validateCharacterSpec, interactionGroups, MAX_TRIANGLES, type BodySpec, type CharacterSpec, type PhysicsConfig, type Quat, type Vec3 } from './config';
import { PhysicsCharacter, type CharacterEvent, type CharacterHost, type CharacterSaved } from './character';

/** The Rapier module: what the default import of the package gives after init(). */
type Rapier = typeof import('@dimforge/rapier3d-compat').default;
export type RapierLoader = () => Promise<Rapier>;

/**
 * The default loader pulls the module in LAZILY (a dynamic import, so the bundler splits it out) and initialises its
 * WASM. A game that never calls PhysicsWorld.create() never downloads it.
 */
export const defaultRapierLoader: RapierLoader = async () => {
  const mod = await import('@dimforge/rapier3d-compat');
  const R = mod.default;
  await R.init();
  return R;
};

export type PhysicsEventName = 'collision_started' | 'collision_stopped' | 'sensor_entered' | 'sensor_exited' | 'character_jumped' | 'character_landed' | 'lagging' | 'unavailable';
export type PhysicsListener = (name: PhysicsEventName, payload: Record<string, unknown>) => void;

export type AddResult = { ok: true; id: string } | { ok: false; reason: string };

export interface RayHit { id: string; distance: number; point: Vec3; normal: Vec3 }
export interface PhysicsStats {
  available: boolean; bodies: number; colliders: number; characters: number;
  /** Fixed steps run since the start (or the last reset). */
  steps: number;
  /** Smoothed milliseconds one fixed step takes. */
  stepMs: number;
  /** Seconds of simulation that could not be run because a frame was too long or too many steps were due. */
  droppedSeconds: number;
  /** Simulated seconds since the start (or the last reset). */
  simSeconds: number;
  paused: boolean;
}

export const SNAPSHOT_VERSION = 2;
export interface PhysicsSnapshot {
  v: number;
  state: Uint8Array;
  specs: BodySpec[];
  /** id -> [body handle, collider handles] — rebuilt on restore so ids keep pointing at the same bodies. */
  handles: Array<[string, number, number[]]>;
  /** The characters (their specs and where they were), rebuilt on restore on top of their kinematic bodies. */
  characters: Array<{ spec: CharacterSpec; saved: CharacterSaved }>;
  accumulator: number;
  steps: number;
  simSeconds: number;
}

interface Entry {
  spec: BodySpec;
  body: RigidBody;
  colliders: Collider[];
  prevP: Vec3;
  prevQ: Quat;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The simulation. Create it with await PhysicsWorld.create(config) — it never throws; if the WASM cannot load it
 * returns a world whose available is false and whose every method is a safe no-op. Step it ONCE per rendered frame
 * with step(frameDt) (it accumulates and runs fixed slices), or once per fixed update with the same dt — never both.
 */
export class PhysicsWorld {
  readonly config: PhysicsConfig;
  private R: Rapier | null;
  private world: RWorld | null = null;
  private queue: REventQueue | null = null;
  private entries = new Map<string, Entry>();
  private colliderOwner = new Map<number, string>();
  private sensorColliders = new Set<number>();
  private characters = new Map<string, PhysicsCharacter>();
  private acc = 0;
  private _alpha = 0;
  private _paused = false;
  private disposed = false;
  private stepCount = 0;
  private sim = 0;
  private dropped = 0;
  private ms = 0;
  private listeners = new Set<PhysicsListener>();
  private readonly _reason: string;

  private constructor(config: PhysicsConfig, R: Rapier | null, reason: string) {
    this.config = config;
    this.R = R;
    this._reason = reason;
    if (R) this.build();
  }

  /** Never throws. available is false (with a reason) when the module could not be loaded. */
  static async create(config?: unknown, loader: RapierLoader = defaultRapierLoader, onEvent?: PhysicsListener): Promise<PhysicsWorld> {
    const cfg = sanitizePhysicsConfig(config);
    let R: Rapier | null = null;
    let reason = '';
    try { R = await loader(); } catch (err) { reason = 'The physics engine could not be loaded: ' + (err instanceof Error ? err.message : String(err)); }
    if (R && (typeof R.World !== 'function' || typeof R.RigidBodyDesc !== 'function')) { R = null; reason = 'The physics engine loaded but is not the expected module.'; }
    const w = new PhysicsWorld(cfg, R, reason);
    if (onEvent) w.on(onEvent);
    if (!R) w.emit([{ name: 'unavailable', payload: { reason } }]);
    return w;
  }

  private build(): void {
    const R = this.R!;
    const w = new R.World(this.config.gravity);
    w.timestep = this.config.timestep;
    w.numSolverIterations = this.config.solverIterations;
    this.world = w;
    this.queue = new R.EventQueue(true);
  }

  get available(): boolean { return this.R !== null && !this.disposed; }
  /** Why it is not available, or '' when it is. */
  get reason(): string { return this.disposed ? 'This physics world has been disposed.' : this._reason; }
  /** The fraction of a step left over after the last step() — blend previous and current by this. */
  get alpha(): number { return this._alpha; }
  get paused(): boolean { return this._paused; }

  on(listener: PhysicsListener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(events: Array<{ name: PhysicsEventName; payload: Record<string, unknown> }>): void {
    for (const e of events) for (const l of Array.from(this.listeners)) { try { l(e.name, e.payload); } catch { /* a listener's bug must not corrupt the simulation */ } }
  }

  // ---- bodies -----------------------------------------------------------------------------------------------------

  /** Add a body. Validated first; refused with a reason instead of reaching native code. */
  addBody(spec: BodySpec): AddResult {
    if (!this.available || !this.world || !this.R) return { ok: false, reason: this.reason || 'physics is not available' };
    const bad = validateBodySpec(spec, this.config);
    if (bad) return { ok: false, reason: bad };
    if (this.entries.has(spec.id)) return { ok: false, reason: 'a body with the id "' + spec.id + '" already exists' };
    if (this.entries.size >= this.config.maxBodies) return { ok: false, reason: 'the body limit of ' + this.config.maxBodies + ' is reached' };
    if (this.world.colliders.len() >= this.config.maxColliders) return { ok: false, reason: 'the collider limit of ' + this.config.maxColliders + ' is reached' };
    const R = this.R;
    const desc = (spec.type === 'dynamic' ? R.RigidBodyDesc.dynamic() : spec.type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed())
      .setTranslation(spec.position.x, spec.position.y, spec.position.z)
      .setCanSleep(this.config.sleeping && spec.canSleep !== false);
    if (spec.rotation) desc.setRotation(spec.rotation);
    if (spec.gravityScale !== undefined) desc.setGravityScale(spec.gravityScale);
    if (spec.linearDamping !== undefined) desc.setLinearDamping(spec.linearDamping);
    if (spec.angularDamping !== undefined) desc.setAngularDamping(spec.angularDamping);
    if (spec.lockRotation) desc.lockRotations();
    if (spec.lockTranslation) desc.lockTranslations();
    if (spec.ccd) desc.setCcdEnabled(true);

    const shape = spec.shape;
    const cd = (() => {
      switch (shape.type) {
        case 'box': return R.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
        case 'sphere': return R.ColliderDesc.ball(shape.radius);
        case 'capsule': return R.ColliderDesc.capsule(shape.halfHeight, shape.radius);
        case 'cylinder': return R.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
        case 'convex': return R.ColliderDesc.convexHull(new Float32Array(shape.points));
        case 'trimesh': return shape.indices.length / 3 > MAX_TRIANGLES ? null : R.ColliderDesc.trimesh(new Float32Array(shape.vertices), new Uint32Array(shape.indices));
      }
    })();
    if (!cd) return { ok: false, reason: 'the ' + shape.type + ' shape could not be built (is the convex hull flat or degenerate?)' };
    if (spec.mass !== undefined) cd.setMass(spec.mass); else cd.setDensity(spec.density ?? 1);
    if (spec.friction !== undefined) cd.setFriction(spec.friction);
    if (spec.restitution !== undefined) cd.setRestitution(spec.restitution);
    if (spec.sensor) { cd.setSensor(true); cd.setActiveCollisionTypes(R.ActiveCollisionTypes.ALL); } // so a kinematic body (a character) walking into a static trigger is seen by it
    cd.setCollisionGroups(interactionGroups(spec.collisionGroup, spec.collisionMask));
    cd.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);

    const body = this.world.createRigidBody(desc);
    const collider = this.world.createCollider(cd, body);
    this.colliderOwner.set(collider.handle, spec.id);
    if (spec.sensor) this.sensorColliders.add(collider.handle);
    const t = body.translation();
    const q = body.rotation();
    this.entries.set(spec.id, { spec: { ...spec }, body, colliders: [collider], prevP: { x: t.x, y: t.y, z: t.z }, prevQ: { x: q.x, y: q.y, z: q.z, w: q.w } });
    return { ok: true, id: spec.id };
  }

  /** Remove a body and free its native memory. true when it existed. */
  removeBody(id: string): boolean {
    const e = this.entries.get(id);
    if (!e || !this.world) return false;
    const ch = this.characters.get(id);
    if (ch) { ch.dispose(); this.characters.delete(id); }
    for (const c of e.colliders) { this.colliderOwner.delete(c.handle); this.sensorColliders.delete(c.handle); }
    this.world.removeRigidBody(e.body);
    this.entries.delete(id);
    return true;
  }

  // ---- characters -------------------------------------------------------------------------------------------------

  private host(): CharacterHost {
    const self = this;
    return { R: this.R!, get world() { return self.world!; }, config: this.config, ownerOf: (h: number) => self.colliderOwner.get(h) };
  }

  /**
   * Add a walking, jumping character (a capsule on a kinematic body, moved by Rapier's character controller). Validated like
   * any body; counts toward the body and collider limits. Drive it with world.character(id).setMove / jump.
   */
  addCharacter(spec: CharacterSpec): AddResult {
    if (!this.available || !this.world || !this.R) return { ok: false, reason: this.reason || 'physics is not available' };
    const bad = validateCharacterSpec(spec, this.config);
    if (bad) return { ok: false, reason: bad };
    const r = this.addBody({
      id: spec.id, type: 'kinematic', position: spec.position, canSleep: false,
      shape: { type: 'capsule', halfHeight: spec.halfHeight ?? 0.55, radius: spec.radius ?? 0.35 },
      collisionGroup: spec.collisionGroup, collisionMask: spec.collisionMask,
    });
    if (!r.ok) return r;
    const e = this.entries.get(spec.id)!;
    try {
      this.characters.set(spec.id, new PhysicsCharacter(this.host(), e.body, e.colliders[0], spec));
    } catch (err) {
      this.removeBody(spec.id);
      return { ok: false, reason: 'the character could not be created: ' + (err instanceof Error ? err.message : String(err)) };
    }
    return { ok: true, id: spec.id };
  }

  /** The character with this id, or null. */
  character(id: string): PhysicsCharacter | null { return this.characters.get(id) ?? null; }

  has(id: string): boolean { return this.entries.has(id); }
  ids(): string[] { return Array.from(this.entries.keys()); }

  /** The body's current transform, or null for an unknown id. */
  getTransform(id: string): { position: Vec3; rotation: Quat } | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const t = e.body.translation();
    const q = e.body.rotation();
    return { position: { x: t.x, y: t.y, z: t.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w } };
  }

  /** The transform to DRAW: the previous and current physics states blended by alpha, so motion is smooth at any render rate. */
  getInterpolated(id: string): { position: Vec3; rotation: Quat } | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const cur = this.getTransform(id)!;
    if (e.spec.type === 'static' || this._paused) return cur;
    const a = this._alpha;
    const p = e.prevP;
    const q0 = e.prevQ;
    const q1 = cur.rotation;
    // shortest-path normalised lerp: indistinguishable from slerp at one physics step's rotation
    const dot = q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w;
    const s = dot < 0 ? -1 : 1;
    const qx = lerp(q0.x * s, q1.x, a); const qy = lerp(q0.y * s, q1.y, a); const qz = lerp(q0.z * s, q1.z, a); const qw = lerp(q0.w * s, q1.w, a);
    const len = Math.hypot(qx, qy, qz, qw) || 1;
    return { position: { x: lerp(p.x, cur.position.x, a), y: lerp(p.y, cur.position.y, a), z: lerp(p.z, cur.position.z, a) }, rotation: { x: qx / len, y: qy / len, z: qz / len, w: qw / len } };
  }

  linearVelocity(id: string): Vec3 | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const v = e.body.linvel();
    return { x: v.x, y: v.y, z: v.z };
  }
  isSleeping(id: string): boolean { return this.entries.get(id)?.body.isSleeping() ?? false; }

  private finiteVec(v: Vec3): boolean { return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); }
  private dynamicEntry(id: string): Entry | null { const e = this.entries.get(id); return e && e.spec.type === 'dynamic' ? e : null; }

  /** Set a dynamic body's velocity. false for an unknown id, a non-dynamic body or a non-finite value. */
  setVelocity(id: string, v: Vec3): boolean {
    const e = this.dynamicEntry(id);
    if (!e || !this.finiteVec(v)) return false;
    e.body.setLinvel(v, true);
    return true;
  }
  /** A sudden push (kg·m/s). */
  applyImpulse(id: string, impulse: Vec3): boolean {
    const e = this.dynamicEntry(id);
    if (!e || !this.finiteVec(impulse)) return false;
    e.body.applyImpulse(impulse, true);
    return true;
  }
  /** A force that stays applied until reset: call resetForces(id) when you stop pushing. */
  applyForce(id: string, force: Vec3): boolean {
    const e = this.dynamicEntry(id);
    if (!e || !this.finiteVec(force)) return false;
    e.body.addForce(force, true);
    return true;
  }
  resetForces(id: string): boolean {
    const e = this.dynamicEntry(id);
    if (!e) return false;
    e.body.resetForces(true);
    return true;
  }
  /** Move a KINEMATIC body to where the game wants it (a moving platform, a door); things on it are carried. */
  moveKinematic(id: string, position: Vec3, rotation?: Quat): boolean {
    const e = this.entries.get(id);
    if (!e || e.spec.type !== 'kinematic' || this.characters.has(id) || !this.finiteVec(position)) return false; // a character is moved by its own controller
    if (Math.hypot(position.x, position.y, position.z) > this.config.worldBounds) return false;
    e.body.setNextKinematicTranslation(position);
    if (rotation) e.body.setNextKinematicRotation(rotation);
    return true;
  }

  // ---- the loop ---------------------------------------------------------------------------------------------------

  /**
   * Advance by one rendered frame's time. Runs whole FIXED steps only, at most maxStepsPerFrame, and clamps a long
   * frame to maxFrameDelta; time that could not be simulated is counted and announced as 'lagging', never run late.
   * Returns the number of fixed steps taken. Safe with NaN, negative, zero; a no-op while paused or unavailable.
   */
  step(frameDt: number): number {
    if (!this.available || !this.world || !this.queue || this._paused) return 0;
    if (typeof frameDt !== 'number' || !Number.isFinite(frameDt) || frameDt <= 0) return 0;
    const dt = this.config.timestep;
    const clamped = Math.min(frameDt, this.config.maxFrameDelta);
    const events: Array<{ name: PhysicsEventName; payload: Record<string, unknown> }> = [];
    if (clamped < frameDt) this.dropped += frameDt - clamped;
    this.acc += clamped;
    let steps = 0;
    while (this.acc >= dt - 1e-9 && steps < this.config.maxStepsPerFrame) {
      for (const e of this.entries.values()) {
        if (e.spec.type === 'static') continue;
        const t = e.body.translation(); const q = e.body.rotation();
        e.prevP.x = t.x; e.prevP.y = t.y; e.prevP.z = t.z; e.prevQ.x = q.x; e.prevQ.y = q.y; e.prevQ.z = q.z; e.prevQ.w = q.w;
      }
      const charEvents: CharacterEvent[] = [];
      for (const c of this.characters.values()) c.update(dt, charEvents);
      for (const ce of charEvents) events.push(ce);
      const t0 = now();
      this.world.step(this.queue);
      const took = now() - t0;
      this.ms = this.stepCount === 0 ? took : this.ms * 0.9 + took * 0.1;
      this.queue.drainCollisionEvents((h1, h2, started) => {
        const a = this.colliderOwner.get(h1);
        const b = this.colliderOwner.get(h2);
        if (a === undefined || b === undefined) return;
        const sensorA = this.sensorColliders.has(h1);
        const sensorB = this.sensorColliders.has(h2);
        if (sensorA || sensorB) events.push({ name: started ? 'sensor_entered' : 'sensor_exited', payload: { sensor: sensorA ? a : b, other: sensorA ? b : a } });
        else if (this.characters.has(a) || this.characters.has(b)) return; // a character's own contacts flicker as it walks; use its state, and sensors
        else events.push({ name: started ? 'collision_started' : 'collision_stopped', payload: { a, b } });
      });
      this.acc -= dt;
      this.stepCount++;
      this.sim += dt;
      steps++;
    }
    if (this.acc >= dt - 1e-9) {
      // more steps were due than we allow: drop the rest, count it, say so
      const lost = this.acc - (this.acc % dt);
      this.dropped += lost;
      this.acc -= lost;
      events.push({ name: 'lagging', payload: { droppedSeconds: lost, steps } });
    }
    this._alpha = Math.max(0, Math.min(1, this.acc / dt));
    if (events.length > 0) this.emit(events);
    return steps;
  }

  pause(): void { this._paused = true; }
  resume(): void { this._paused = false; }

  /** Remove every body and start a fresh world with the same config. Counters and the accumulator restart. */
  reset(): void {
    if (!this.R || this.disposed) return;
    this.freeNative();
    this.entries.clear(); this.colliderOwner.clear(); this.sensorColliders.clear();
    this.acc = 0; this._alpha = 0; this.stepCount = 0; this.sim = 0; this.dropped = 0; this.ms = 0;
    this.build();
  }

  private freeNative(): void {
    for (const c of this.characters.values()) c.dispose();
    this.characters.clear();
    try { this.queue?.free(); } catch { /* already freed */ }
    try { this.world?.free(); } catch { /* already freed */ }
    this.queue = null; this.world = null;
  }

  /** Free all native memory. The world is a safe no-op afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.freeNative();
    this.entries.clear(); this.colliderOwner.clear(); this.sensorColliders.clear(); this.listeners.clear();
    this.disposed = true;
  }

  // ---- queries ----------------------------------------------------------------------------------------------------

  /** The first body a ray hits within maxDistance, or null. mask limits it to groups (16-bit, default all). */
  castRay(origin: Vec3, direction: Vec3, maxDistance: number, mask: number = 0xffff): RayHit | null {
    if (!this.available || !this.world || !this.R) return null;
    if (!this.finiteVec(origin) || !this.finiteVec(direction) || !(maxDistance > 0) || !Number.isFinite(maxDistance)) return null;
    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len < 1e-9) return null;
    const dir = { x: direction.x / len, y: direction.y / len, z: direction.z / len };
    const hit = this.world.castRayAndGetNormal(new this.R.Ray(origin, dir), Math.min(maxDistance, this.config.worldBounds * 2), true, undefined, ((0xffff0000 | (mask & 0xffff)) >>> 0));
    if (!hit) return null;
    const id = this.colliderOwner.get(hit.collider.handle);
    if (id === undefined) return null;
    const d = hit.timeOfImpact;
    return { id, distance: d, point: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d }, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } };
  }

  // ---- save / restore ---------------------------------------------------------------------------------------------

  /** A versioned snapshot of the whole world, or null when unavailable. */
  snapshot(): PhysicsSnapshot | null {
    if (!this.available || !this.world) return null;
    return {
      v: SNAPSHOT_VERSION,
      state: this.world.takeSnapshot(),
      specs: Array.from(this.entries.values()).map((e) => ({ ...e.spec })),
      handles: Array.from(this.entries, ([id, e]) => [id, e.body.handle, e.colliders.map((c) => c.handle)] as [string, number, number[]]),
      characters: Array.from(this.characters.values(), (c) => ({ spec: { ...c.spec, position: { ...c.spec.position } }, saved: c.saved() })),
      accumulator: this.acc, steps: this.stepCount, simSeconds: this.sim,
    };
  }

  /** Restore a snapshot. All-or-nothing: anything wrong leaves the current world untouched and returns the reason. */
  restore(snap: PhysicsSnapshot): { ok: true } | { ok: false; reason: string } {
    if (!this.available || !this.R) return { ok: false, reason: this.reason || 'physics is not available' };
    if (!snap || typeof snap !== 'object' || snap.v !== SNAPSHOT_VERSION) return { ok: false, reason: 'this snapshot is from a different version' };
    if (!(snap.state instanceof Uint8Array) || !Array.isArray(snap.specs) || !Array.isArray(snap.handles) || !Array.isArray(snap.characters)) return { ok: false, reason: 'the snapshot is malformed' };
    if (snap.specs.length > this.config.maxBodies) return { ok: false, reason: 'the snapshot has more bodies than the limit of ' + this.config.maxBodies };
    let next: RWorld;
    try { next = this.R.World.restoreSnapshot(snap.state); } catch (err) { return { ok: false, reason: 'the snapshot could not be read: ' + (err instanceof Error ? err.message : String(err)) }; }
    const entries = new Map<string, Entry>();
    const owner = new Map<number, string>();
    const sensors = new Set<number>();
    const chars = new Map<string, PhysicsCharacter>();
    try {
      for (const spec of snap.specs) {
        const row = snap.handles.find((h) => h[0] === spec.id);
        if (!row) throw new Error('no handle for ' + spec.id);
        const body = next.getRigidBody(row[1]);
        if (!body) throw new Error('the body "' + spec.id + '" is missing from the snapshot');
        const colliders = row[2].map((h) => next.getCollider(h)).filter((c): c is Collider => !!c);
        if (colliders.length !== row[2].length) throw new Error('a collider of "' + spec.id + '" is missing');
        for (const c of colliders) { owner.set(c.handle, spec.id); if (spec.sensor) sensors.add(c.handle); }
        const t = body.translation(); const q = body.rotation();
        entries.set(spec.id, { spec: { ...spec }, body, colliders, prevP: { x: t.x, y: t.y, z: t.z }, prevQ: { x: q.x, y: q.y, z: q.z, w: q.w } });
      }
      const host: CharacterHost = { R: this.R, world: next, config: this.config, ownerOf: (h: number) => owner.get(h) };
      for (const row of snap.characters) {
        const bad = validateCharacterSpec(row?.spec, this.config);
        if (bad) throw new Error('a saved character is invalid: ' + bad);
        const e = entries.get(row.spec.id);
        if (!e) throw new Error('the character "' + row.spec.id + '" has no body in the snapshot');
        const ch = new PhysicsCharacter(host, e.body, e.colliders[0], row.spec);
        ch.restoreSaved(row.saved);
        chars.set(row.spec.id, ch);
      }
    } catch (err) {
      for (const c of chars.values()) c.dispose();
      try { next.free(); } catch { /* nothing to free */ }
      return { ok: false, reason: 'the snapshot does not match its bodies: ' + (err instanceof Error ? err.message : String(err)) };
    }
    next.timestep = this.config.timestep;
    next.numSolverIterations = this.config.solverIterations;
    for (const c of this.characters.values()) c.dispose();
    try { this.queue?.free(); } catch { /* already freed */ }
    try { this.world?.free(); } catch { /* already freed */ }
    this.world = next;
    this.queue = new this.R.EventQueue(true);
    this.entries = entries; this.colliderOwner = owner; this.sensorColliders = sensors; this.characters = chars;
    this.acc = Number.isFinite(snap.accumulator) ? Math.max(0, Math.min(snap.accumulator, this.config.timestep)) : 0;
    this.stepCount = Number.isFinite(snap.steps) ? Math.max(0, Math.floor(snap.steps)) : 0;
    this.sim = Number.isFinite(snap.simSeconds) ? Math.max(0, snap.simSeconds) : 0;
    this._alpha = 0;
    return { ok: true };
  }

  // ---- diagnostics ------------------------------------------------------------------------------------------------

  stats(): PhysicsStats {
    return {
      available: this.available, bodies: this.entries.size, colliders: this.world?.colliders.len() ?? 0, characters: this.characters.size, steps: this.stepCount,
      stepMs: this.ms, droppedSeconds: this.dropped, simSeconds: this.sim, paused: this._paused,
    };
  }

  /**
   * Development only: wireframe lines of every collider (vertices as x,y,z triples; colors as r,g,b,a) for a three.js
   * LineSegments. null unless config.debug is true — it is never on in a published game unless the builder asks.
   */
  debugLines(): { vertices: Float32Array; colors: Float32Array } | null {
    if (!this.config.debug || !this.available || !this.world) return null;
    const b = this.world.debugRender();
    return { vertices: new Float32Array(b.vertices), colors: new Float32Array(b.colors) };
  }
}
`;

const CHARACTER = String.raw`import type { World as RWorld, RigidBody, Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { interactionGroups, resolveCharacter, type CharacterSpec, type PhysicsConfig, type ResolvedCharacter, type Vec3 } from './config';

type Rapier = typeof import('@dimforge/rapier3d-compat').default;

/** What a character needs from the world it lives in. The world implements this; the character never imports the world. */
export interface CharacterHost {
  readonly R: Rapier;
  readonly world: RWorld;
  readonly config: PhysicsConfig;
  ownerOf(colliderHandle: number): string | undefined;
}

export interface CharacterState {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  /** The id of the body it is standing on, or null in the air. */
  groundId: string | null;
  /** Horizontal speed, m/s. */
  speed: number;
}

/** What a snapshot keeps so a restored character carries on exactly where it was. */
export interface CharacterSaved { vx: number; vy: number; vz: number; mx: number; mz: number; grounded: boolean; coyote: number; buffer: number; jumping: boolean }
export interface CharacterEvent { name: 'character_jumped' | 'character_landed'; payload: Record<string, unknown> }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const DEG = Math.PI / 180;

/**
 * A walking, jumping, capsule-shaped character on a kinematic body, moved by Rapier's own KinematicCharacterController.
 * The GAME says where it wants to go (setMove, a world-space velocity — it owns the camera and the input) and when to jump;
 * this works out what is actually possible: it slides along walls, climbs slopes up to a limit, steps over small ledges,
 * stays on the ground going downhill, falls, lands, and rides moving platforms. It is stepped by the world, inside the fixed
 * timestep, so it behaves the same at any frame rate and its drawn position is interpolated like every other body.
 */
export class PhysicsCharacter {
  readonly id: string;
  readonly spec: CharacterSpec;
  private readonly p: ResolvedCharacter;
  private readonly ctrl: KinematicCharacterController;
  private readonly groups: number;
  private mx = 0;
  private mz = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private _grounded = false;
  private coyote = 0;
  private buffer = 0;
  private jumping = false;
  private jumpRequested = false;
  private groundId: string | null = null;
  private groundHandle: number | null = null;

  constructor(private readonly host: CharacterHost, readonly body: RigidBody, readonly collider: Collider, spec: CharacterSpec) {
    this.id = spec.id;
    this.spec = { ...spec, position: { ...spec.position } };
    const p = resolveCharacter(spec);
    this.p = p;
    this.groups = interactionGroups(spec.collisionGroup, spec.collisionMask);
    const c = host.world.createCharacterController(p.offset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle(p.maxSlopeClimbDeg * DEG);
    c.setMinSlopeSlideAngle(p.minSlopeSlideDeg * DEG);
    if (p.autostepHeight > 0) c.enableAutostep(p.autostepHeight, p.autostepMinWidth, false);
    if (p.snapToGround > 0) c.enableSnapToGround(p.snapToGround);
    c.setApplyImpulsesToDynamicBodies(p.pushDynamic);
    c.setCharacterMass(p.mass);
    this.ctrl = c;
    // a character walking into a static trigger volume must be seen by it (kinematic-versus-fixed is off by default)
    collider.setActiveCollisionTypes(host.R.ActiveCollisionTypes.ALL);
  }

  /** The velocity the game wants, in the world's axes (m/s). false for a non-finite value. Clamped to 100 m/s. */
  setMove(x: number, z: number): boolean {
    if (!finite(x) || !finite(z)) return false;
    const len = Math.hypot(x, z);
    const k = len > 100 ? 100 / len : 1;
    this.mx = x * k;
    this.mz = z * k;
    return true;
  }

  /** Ask for a jump. It happens now if it can, or within jumpBuffer seconds if the character is about to land. */
  jump(): void { this.jumpRequested = true; }

  /** Put it somewhere else and stop it. false for a non-finite or out-of-bounds position. */
  teleport(position: Vec3): boolean {
    if (!position || !finite(position.x) || !finite(position.y) || !finite(position.z)) return false;
    if (Math.hypot(position.x, position.y, position.z) > this.host.config.worldBounds) return false;
    this.body.setTranslation(position, true);
    this.body.setNextKinematicTranslation(position);
    this.vx = 0; this.vy = 0; this.vz = 0;
    this._grounded = false; this.coyote = 0; this.buffer = 0; this.jumping = false; this.jumpRequested = false;
    this.groundId = null; this.groundHandle = null;
    return true;
  }

  state(): CharacterState {
    const t = this.body.translation();
    return {
      position: { x: t.x, y: t.y, z: t.z }, velocity: { x: this.vx, y: this.vy, z: this.vz },
      grounded: this._grounded, groundId: this.groundId, speed: Math.hypot(this.vx, this.vz),
    };
  }

  get grounded(): boolean { return this._grounded; }

  saved(): CharacterSaved {
    return { vx: this.vx, vy: this.vy, vz: this.vz, mx: this.mx, mz: this.mz, grounded: this._grounded, coyote: this.coyote, buffer: this.buffer, jumping: this.jumping };
  }
  restoreSaved(s: CharacterSaved): void {
    if (!s || typeof s !== 'object') return;
    const n = (v: unknown): number => (finite(v) ? v : 0);
    this.vx = clamp(n(s.vx), -200, 200); this.vy = clamp(n(s.vy), -200, 200); this.vz = clamp(n(s.vz), -200, 200);
    this.mx = clamp(n(s.mx), -100, 100); this.mz = clamp(n(s.mz), -100, 100);
    this._grounded = s.grounded === true; this.coyote = clamp(n(s.coyote), 0, 1); this.buffer = clamp(n(s.buffer), 0, 1); this.jumping = s.jumping === true;
  }

  /** How far the body it stands on will move in the coming step (a lift, a moving platform), so the character rides it. */
  private platformCarry(): Vec3 {
    if (this.groundHandle === null) return { x: 0, y: 0, z: 0 };
    try {
      const b = this.host.world.getRigidBody(this.groundHandle);
      if (!b || !b.isKinematic()) return { x: 0, y: 0, z: 0 };
      const next = b.nextTranslation();
      const cur = b.translation();
      return { x: next.x - cur.x, y: next.y - cur.y, z: next.z - cur.z };
    } catch {
      this.groundHandle = null; // the body it stood on is gone
      return { x: 0, y: 0, z: 0 };
    }
  }

  /** One FIXED step. Called by the world before the physics step; appends what happened to out. */
  update(dt: number, out: CharacterEvent[]): void {
    if (!(dt > 0)) return;
    const p = this.p;
    const gravity = this.host.config.gravity.y * p.gravityScale;
    if (this.jumpRequested) { this.buffer = Math.max(p.jumpBuffer, dt); this.jumpRequested = false; }
    const wasGrounded = this._grounded;

    // steer toward what the game asked for: on the ground fully, in the air by airControl (0 keeps the momentum)
    if (this._grounded || p.airControl > 0) {
      const a = p.acceleration * (this._grounded ? 1 : p.airControl) * dt;
      this.vx += clamp(this.mx - this.vx, -a, a);
      this.vz += clamp(this.mz - this.vz, -a, a);
    }

    // a jump works on the ground, or for coyoteTime after leaving it; a press just before landing is remembered
    this.coyote = this._grounded ? p.coyoteTime : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && (this._grounded || this.coyote > 0)) {
      this.vy = p.jumpSpeed;
      this.buffer = 0; this.coyote = 0; this.jumping = true; this._grounded = false;
      out.push({ name: 'character_jumped', payload: { id: this.id } });
    }
    this.buffer = Math.max(0, this.buffer - dt);

    const fallSpeed = Math.max(0, -this.vy);
    // Gravity only acts in the AIR. On the ground the controller's own snap-to-ground holds the character down: a small
    // constant downward request makes Rapier's controller drop a whole step of horizontal movement every half second or so.
    if (this._grounded && this.vy <= 0) this.vy = 0;
    else this.vy = Math.max(-p.maxFallSpeed, this.vy + gravity * dt);

    const carry = this.platformCarry();
    const t = this.body.translation();
    const dx = this.vx * dt + carry.x;
    const dy = this.vy * dt + carry.y;
    const dz = this.vz * dt + carry.z;
    // trigger volumes are not obstacles: the character walks INTO them (and they report it)
    this.ctrl.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, this.host.R.QueryFilterFlags.EXCLUDE_SENSORS, this.groups);
    const m = this.ctrl.computedMovement();
    this._grounded = this.ctrl.computedGrounded();

    if (this.vy > 0 && m.y < dy - 1e-4) this.vy = 0; // hit a ceiling
    if (this._grounded && this.vy <= 0) { this.vy = 0; this.jumping = false; }
    // Walking INTO a wall removes the velocity that pushes into it (and only that: sliding along it, and the way a slope
    // turns horizontal movement into climbing, are left alone — comparing the movement achieved with the movement asked for
    // would confuse a steep slope with a wall and slow the character to a crawl).
    const walkable = Math.cos(p.maxSlopeClimbDeg * DEG); // a surface at least this flat is ground it can climb, not a wall
    for (let i = 0, n = this.ctrl.numComputedCollisions(); i < n; i++) {
      const hit = this.ctrl.computedCollision(i);
      if (!hit || hit.normal1.y >= walkable || hit.normal1.y < -0.7) continue; // ground it can walk on, or a ceiling: not a wall
      const into = this.vx * hit.normal1.x + this.vz * hit.normal1.z;
      if (into < 0) { this.vx -= into * hit.normal1.x; this.vz -= into * hit.normal1.z; }
    }

    const to = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.body.setNextKinematicTranslation(to);
    if (!wasGrounded && this._grounded) out.push({ name: 'character_landed', payload: { id: this.id, speed: fallSpeed } });

    // what is it standing on (for the platform carry and for the game)
    this.groundId = null; this.groundHandle = null;
    if (this._grounded) {
      const R = this.host.R;
      const reach = p.halfHeight + p.radius + p.offset + 0.3;
      const hit = this.host.world.castRay(new R.Ray(to, { x: 0, y: -1, z: 0 }), reach, true, R.QueryFilterFlags.EXCLUDE_SENSORS, this.groups, this.collider);
      if (hit) {
        this.groundId = this.host.ownerOf(hit.collider.handle) ?? null;
        this.groundHandle = hit.collider.parent()?.handle ?? null;
      }
    }
  }

  /** Free the native controller. */
  dispose(): void {
    try { this.host.world.removeCharacterController(this.ctrl); } catch { /* already freed with its world */ }
  }
}
`;

const SYNC = String.raw`import type { PhysicsWorld } from './world';

/** Anything with a position and a quaternion — a three.js Object3D fits without importing three. */
export interface Transformable {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

/**
 * Keeps drawn objects where the physics says they are. bind(id, object) once per body; sync(world) once per rendered
 * frame AFTER world.step(): it writes the INTERPOLATED transform, so motion is smooth at any frame rate. Rendering is
 * three.js's job and simulation is Rapier's; this is the only place the two meet.
 */
export class PhysicsBinding {
  private bound = new Map<string, Transformable>();

  bind(id: string, object: Transformable): void { this.bound.set(id, object); }
  unbind(id: string): boolean { return this.bound.delete(id); }
  clear(): void { this.bound.clear(); }
  get size(): number { return this.bound.size; }

  /** Copy every bound body's interpolated transform to its object. Bodies the world no longer has are unbound. Returns how many were written. */
  sync(world: PhysicsWorld): number {
    let n = 0;
    for (const [id, obj] of Array.from(this.bound)) {
      const t = world.getInterpolated(id);
      if (!t) { this.bound.delete(id); continue; }
      obj.position.x = t.position.x; obj.position.y = t.position.y; obj.position.z = t.position.z;
      obj.quaternion.x = t.rotation.x; obj.quaternion.y = t.rotation.y; obj.quaternion.z = t.rotation.z; obj.quaternion.w = t.rotation.w;
      n++;
    }
    return n;
  }
}
`;

const INDEX = String.raw`export { PhysicsWorld, defaultRapierLoader, SNAPSHOT_VERSION, type RapierLoader, type PhysicsListener, type PhysicsEventName, type AddResult, type RayHit, type PhysicsStats, type PhysicsSnapshot } from './world';
export { PhysicsCharacter, type CharacterState, type CharacterSaved, type CharacterEvent } from './character';
export { PhysicsBinding, type Transformable } from './sync';
export { DEFAULT_PHYSICS, sanitizePhysicsConfig, validateBodySpec, validateCharacterSpec, resolveCharacter, interactionGroups, MAX_EXTENT, MAX_CONVEX_POINTS, MAX_TRIANGLES, type PhysicsConfig, type BodySpec, type BodyType, type ShapeSpec, type CharacterSpec, type ResolvedCharacter, type Vec3, type Quat } from './config';
`;

const FILES: Record<string, string> = {
  'src/game/physics/config.ts': CONFIG,
  'src/game/physics/character.ts': CHARACTER,
  'src/game/physics/world.ts': WORLD,
  'src/game/physics/sync.ts': SYNC,
  'src/game/physics/index.ts': INDEX,
};

export const GAME_PHYSICS_MODULES: readonly string[] = ['config', 'character', 'world', 'sync', 'index'];

const NEEDS: Record<string, string[]> = { config: [], character: ['config'], world: ['config', 'character'], sync: ['world'], index: ['config', 'character', 'world', 'sync'] };

/** Generate the physics core. Pure; never throws. */
export function generateGamePhysics(include?: string[]): GamePhysicsResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter((s) => s in NEEDS))
    : null;
  let names: string[] = GAME_PHYSICS_MODULES.slice();
  if (wanted && wanted.size > 0) {
    const closure = new Set<string>();
    const add = (m: string): void => { if (closure.has(m)) return; closure.add(m); for (const d of NEEDS[m]) add(d); };
    for (const m of wanted) add(m);
    names = GAME_PHYSICS_MODULES.filter((m) => closure.has(m));
  }
  const files: Record<string, string> = {};
  for (const m of names) files['src/game/physics/' + m + '.ts'] = FILES['src/game/physics/' + m + '.ts'];

  return {
    files,
    dependencies: [{ name: RAPIER_PACKAGE, version: RAPIER_VERSION }],
    instructions:
      `Added the physics core (${Object.keys(files).length} files under src/game/physics) on Rapier 3D (${RAPIER_PACKAGE}@${RAPIER_VERSION}, loaded lazily). Three.js still draws; Rapier simulates. It has rigid bodies, colliders, events, triggers, raycasts, snapshots, a debug view and a walking, jumping CHARACTER (physics.addCharacter) — but NO vehicle controller yet, so do not call a car "physical" on the strength of this.\n` +
      '```ts\n' +
      "import { PhysicsWorld, PhysicsBinding } from './game/physics';\n" +
      '\n' +
      '// Never throws: if the WASM cannot load, physics.available is false and every call is a safe no-op — keep the\n' +
      '// procedural movement as the fallback and check physics.available before relying on it.\n' +
      'export const physics = await PhysicsWorld.create({ gravity: { x: 0, y: -9.81, z: 0 } }, undefined, (name, payload) => {\n' +
      "  if (name === 'collision_started') console.debug('hit', payload);        // { a, b } entity ids\n" +
      "  if (name === 'sensor_entered') console.debug('entered', payload);       // { sensor, other }\n" +
      '});\n' +
      '\n' +
      "physics.addBody({ id: 'ground', type: 'static', shape: { type: 'box', hx: 50, hy: 0.5, hz: 50 }, position: { x: 0, y: -0.5, z: 0 } });\n" +
      "physics.addBody({ id: 'crate', type: 'dynamic', shape: { type: 'box', hx: 0.5, hy: 0.5, hz: 0.5 }, position: { x: 0, y: 8, z: 0 }, mass: 20, friction: 0.8, restitution: 0.1 });\n" +
      "physics.addBody({ id: 'door-zone', type: 'static', sensor: true, shape: { type: 'box', hx: 1, hy: 1, hz: 1 }, position: { x: 5, y: 1, z: 0 } });\n" +
      '\n' +
      '// A walking, jumping character (a capsule on a kinematic body). YOU read the input and the camera; it works out what is possible.\n' +
      "physics.addCharacter({ id: 'hero', position: { x: 0, y: 2, z: 0 } });   // defaults: 1.8 m tall, climbs 50 degrees, steps 0.3 m, jumps 6.5 m/s\n" +
      "const hero = physics.character('hero');                                    // null if the world is not available\n" +
      '// each frame:  hero?.setMove(vx, vz)  (world-space m/s, e.g. camera-relative);  if (jumpPressed) hero?.jump();\n' +
      '// hero?.state() -> { position, velocity, grounded, groundId, speed };  events: character_jumped, character_landed { id, speed }\n' +
      '\n' +
      '// One three.js mesh per body; the binding copies the INTERPOLATED transform across each frame.\n' +
      'export const binding = new PhysicsBinding();\n' +
      "// binding.bind('crate', crateMesh);\n" +
      '\n' +
      '// Once per rendered frame (or once per fixed update with the same dt) — never both:\n' +
      'export function frame(frameDt: number): void {\n' +
      '  physics.step(frameDt);   // fixed slices, bounded catch-up; returns the steps taken\n' +
      '  binding.sync(physics);   // draw the interpolated state\n' +
      '}\n' +
      '\n' +
      "// physics.castRay(origin, direction, 50)   -> { id, distance, point, normal } | null\n" +
      "// physics.applyImpulse('crate', { x: 0, y: 200, z: 0 });  physics.moveKinematic('lift', { x: 0, y: 3, z: 0 });\n" +
      '// physics.pause(); physics.resume(); physics.reset();   const snap = physics.snapshot(); physics.restore(snap!);\n' +
      '// physics.dispose();   // on unmount — frees native memory\n' +
      '```\n' +
      'THE RULES THESE ENCODE — do not re-implement them by hand:\n' +
      '- Step the world ONCE per frame with the frame time (or once per fixed update with the same dt), never both: it runs fixed slices itself and clamps long frames. Never call Rapier\'s own step.\n' +
      '- Always draw through PhysicsBinding.sync (interpolated), and never move a dynamic body by setting its mesh position — use velocity, impulse or force; move a KINEMATIC body with moveKinematic.\n' +
      '- Check physics.available. When false (WASM blocked or unsupported) use the procedural movement; it is an upgrade, not a requirement.\n' +
      '- addBody returns a reason when it refuses: NaN, a negative size, a duplicate id, the body/collider limit, or a triangle mesh on a moving body (use a box, sphere, capsule or convex hull for anything that moves; trimesh is static only).\n' +
      '- Choose colliders by cost: a box, sphere or capsule for anything that moves; convex only when needed; trimesh only for static scenery. Do not give every object a mesh collider.\n' +
      '- Collision groups: collisionGroup 0..15 says what a body IS, collisionMask (16-bit) says what it hits. A sensor reports overlaps and blocks nothing.\n' +
      '- Do not enable physics for every game: use it when the request needs real rigid bodies (crates that topple, objects that fall and bounce, a ragdoll, realistic stacking), not for a tycoon or a card game.\n' +
      '- A character is moved ONLY by setMove / jump / teleport (never by setting its mesh or calling moveKinematic). It slides along walls, climbs slopes up to maxSlopeClimbDeg, steps over ledges up to autostepHeight, follows the ground down small drops (snapToGround) and rides kinematic platforms; a jump works for coyoteTime after leaving a ledge and a press just before landing is remembered (jumpBuffer). Do not rebuild any of that by hand.\n' +
      '- Trigger volumes are NOT obstacles to a character (it walks into them and they report sensor_entered); a character\'s own contacts are not reported as collision events (they flicker as it walks) — use its state and sensors.\n' +
      '- Use the kit\'s generate_game_controller for a game WITHOUT a physics world; use this character only when the game has one (it collides with the physics bodies, pushes crates, rides lifts).\n' +
      '- Honest limits to tell the user: determinism holds on one device, not across all of them; it has not been measured on a physical phone or in a WebView yet; there is NO vehicle controller yet; the debug view (config.debug) is for development and is off by default.',
  };
}
