// Physics — stage A: the Rapier world, with the rules that make a physics world safe to ship in a game.
//
// WHAT THIS IS. A thin, typed layer over Rapier 3D (the official `@dimforge/rapier3d-compat` WASM package, Apache-2.0)
// that gives a game real rigid bodies, colliders, collision events, trigger volumes, raycasts, collision groups,
// snapshots and a debug view. Three.js still draws; Rapier simulates; the binding copies transforms across with
// interpolation. It is OPTIONAL: nothing in the kit imports it unless the game asks for physics, and the WASM is loaded
// lazily the first time `PhysicsWorld.create()` runs, so a simple game never downloads it.
//
// WHAT IS NOT HERE YET (stages B and C, each its own change, each with its own tests): the character controller and the
// vehicle controller. Rapier ships both; this stage does not wrap them, and nothing in this file claims a character or a
// car is physical. Stated plainly so a builder does not assume it.
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

/** Rapier packs "I am in group g" (high 16 bits) and "I collide with mask m" (low 16 bits) into one number. */
export function interactionGroups(group: number | undefined, mask: number | undefined): number {
  const membership = 1 << (group ?? 0);
  return (((membership & 0xffff) << 16) | ((mask ?? 0xffff) & 0xffff)) >>> 0;
}
`;

const WORLD = String.raw`import type { World as RWorld, RigidBody, Collider, EventQueue as REventQueue } from '@dimforge/rapier3d-compat';
import { sanitizePhysicsConfig, validateBodySpec, interactionGroups, MAX_TRIANGLES, type BodySpec, type PhysicsConfig, type Quat, type Vec3 } from './config';

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

export type PhysicsEventName = 'collision_started' | 'collision_stopped' | 'sensor_entered' | 'sensor_exited' | 'lagging' | 'unavailable';
export type PhysicsListener = (name: PhysicsEventName, payload: Record<string, unknown>) => void;

export type AddResult = { ok: true; id: string } | { ok: false; reason: string };

export interface RayHit { id: string; distance: number; point: Vec3; normal: Vec3 }
export interface PhysicsStats {
  available: boolean; bodies: number; colliders: number;
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

export const SNAPSHOT_VERSION = 1;
export interface PhysicsSnapshot {
  v: number;
  state: Uint8Array;
  specs: BodySpec[];
  /** id -> [body handle, collider handles] — rebuilt on restore so ids keep pointing at the same bodies. */
  handles: Array<[string, number, number[]]>;
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
    if (spec.sensor) cd.setSensor(true);
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
    for (const c of e.colliders) { this.colliderOwner.delete(c.handle); this.sensorColliders.delete(c.handle); }
    this.world.removeRigidBody(e.body);
    this.entries.delete(id);
    return true;
  }

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
    if (!e || e.spec.type !== 'kinematic' || !this.finiteVec(position)) return false;
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
      accumulator: this.acc, steps: this.stepCount, simSeconds: this.sim,
    };
  }

  /** Restore a snapshot. All-or-nothing: anything wrong leaves the current world untouched and returns the reason. */
  restore(snap: PhysicsSnapshot): { ok: true } | { ok: false; reason: string } {
    if (!this.available || !this.R) return { ok: false, reason: this.reason || 'physics is not available' };
    if (!snap || typeof snap !== 'object' || snap.v !== SNAPSHOT_VERSION) return { ok: false, reason: 'this snapshot is from a different version' };
    if (!(snap.state instanceof Uint8Array) || !Array.isArray(snap.specs) || !Array.isArray(snap.handles)) return { ok: false, reason: 'the snapshot is malformed' };
    if (snap.specs.length > this.config.maxBodies) return { ok: false, reason: 'the snapshot has more bodies than the limit of ' + this.config.maxBodies };
    let next: RWorld;
    try { next = this.R.World.restoreSnapshot(snap.state); } catch (err) { return { ok: false, reason: 'the snapshot could not be read: ' + (err instanceof Error ? err.message : String(err)) }; }
    const entries = new Map<string, Entry>();
    const owner = new Map<number, string>();
    const sensors = new Set<number>();
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
    } catch (err) {
      try { next.free(); } catch { /* nothing to free */ }
      return { ok: false, reason: 'the snapshot does not match its bodies: ' + (err instanceof Error ? err.message : String(err)) };
    }
    next.timestep = this.config.timestep;
    next.numSolverIterations = this.config.solverIterations;
    try { this.queue?.free(); } catch { /* already freed */ }
    try { this.world?.free(); } catch { /* already freed */ }
    this.world = next;
    this.queue = new this.R.EventQueue(true);
    this.entries = entries; this.colliderOwner = owner; this.sensorColliders = sensors;
    this.acc = Number.isFinite(snap.accumulator) ? Math.max(0, Math.min(snap.accumulator, this.config.timestep)) : 0;
    this.stepCount = Number.isFinite(snap.steps) ? Math.max(0, Math.floor(snap.steps)) : 0;
    this.sim = Number.isFinite(snap.simSeconds) ? Math.max(0, snap.simSeconds) : 0;
    this._alpha = 0;
    return { ok: true };
  }

  // ---- diagnostics ------------------------------------------------------------------------------------------------

  stats(): PhysicsStats {
    return {
      available: this.available, bodies: this.entries.size, colliders: this.world?.colliders.len() ?? 0, steps: this.stepCount,
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
export { PhysicsBinding, type Transformable } from './sync';
export { DEFAULT_PHYSICS, sanitizePhysicsConfig, validateBodySpec, interactionGroups, MAX_EXTENT, MAX_CONVEX_POINTS, MAX_TRIANGLES, type PhysicsConfig, type BodySpec, type BodyType, type ShapeSpec, type Vec3, type Quat } from './config';
`;

const FILES: Record<string, string> = {
  'src/game/physics/config.ts': CONFIG,
  'src/game/physics/world.ts': WORLD,
  'src/game/physics/sync.ts': SYNC,
  'src/game/physics/index.ts': INDEX,
};

export const GAME_PHYSICS_MODULES: readonly string[] = ['config', 'world', 'sync', 'index'];

const NEEDS: Record<string, string[]> = { config: [], world: ['config'], sync: ['world'], index: ['config', 'world', 'sync'] };

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
      `Added the physics core (${Object.keys(files).length} files under src/game/physics) on Rapier 3D (${RAPIER_PACKAGE}@${RAPIER_VERSION}, loaded lazily). Three.js still draws; Rapier simulates. This stage has rigid bodies, colliders, events, triggers, raycasts, snapshots and a debug view — NOT a character controller or a vehicle yet, so do not call a walking player or a car "physical" on the strength of this.\n` +
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
      '- Honest limits to tell the user: determinism holds on one device, not across all of them; it has not been measured on a physical phone or in a WebView yet; the debug view (config.debug) is for development and is off by default.',
  };
}
