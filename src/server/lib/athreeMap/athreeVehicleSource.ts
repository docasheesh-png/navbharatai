// ATHREE MAP — phase 5b: VEHICLES — a sports car and a sports bike, with their own driving physics (the emitted source of src/game/athree/vehicles.ts).
//
// 100% ours. Techniques (public ideas, own code): a car body is LOFTED — a stack of cross-sections (superellipses) along its length, whose
// width and height follow two hand-drawn profile curves — closed at the ends and given smooth normals; wheels are cylinders with a rim and
// spokes; the bike is tubes plus a lofted tank. Driving is an arcade model with a real structure: engine force that falls with speed,
// drag and rolling resistance, braking limited by the surface, steering that narrows with speed, a lateral-grip model (the sideways part of
// the velocity is bled off at a rate set by the surface, so a handbrake or a slippery surface gives a slide), yaw rate limited by the
// friction circle, four wheel contacts sampled on the ground (the same height function the terrain, the roads and the bridge decks come from),
// a spring-damper body that pitches and rolls with the ground and flies off a crest. The car drives on world.drivableHeightAt, so a bridge
// deck carries it and the river runs underneath.
//
// Everything but createVehicle is PURE (no three.js): the shapes are arrays and the physics is numbers, so every rule is unit-testable.
//
// PURE source string; the generator writes it. Rule for editing: no backticks and no dollar-brace inside the string below.

export const VEHICLES = `// Athree map — a sports car and a sports bike: lofted bodies, wheels, driving physics, and the vehicle that draws and drives them.
// Technique: cross-section lofting, cylinders and tubes with computed smooth normals; an arcade physics model with a friction circle,
// a surface friction table, four sampled wheel contacts and a spring-damper body. Own implementation.

import { type AthreeQuality } from './config';
import type { AthreeWorld } from './world';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export type VehicleKind = 'car' | 'bike';
export type Surface = 'asphalt' | 'grass' | 'sand' | 'snow' | 'rock' | 'water';

/** Grip of each surface: the largest sideways acceleration, in g, and how well the brakes bite. */
const GRAVITY = 9.81;

export const SURFACE_FRICTION: Record<Surface, number> = { asphalt: 1.15, grass: 0.62, sand: 0.5, snow: 0.32, rock: 0.8, water: 0.1 };

export interface VehicleTier {
  /** Cross-sections along the body, points round each section, segments round a tyre. */
  stations: number;
  ring: number;
  tyre: number;
}

export const VEHICLE_TIERS: Record<AthreeQuality, VehicleTier> = {
  phone: { stations: 12, ring: 12, tyre: 12 },
  mid: { stations: 16, ring: 14, tyre: 16 },
  desktop: { stations: 22, ring: 18, tyre: 24 },
};

/** The most triangles one vehicle may have at a tier (asserted by a test against the real meshes). */
export const VEHICLE_TRIANGLES_MAX: Record<AthreeQuality, number> = { phone: 900, mid: 1600, desktop: 3200 };

export interface PartArrays {
  position: Float32Array;
  normal: Float32Array;
  index: Uint16Array;
  triangles: number;
}

class Part {
  pos: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  /** Smooth normals: each vertex gets the sum of the area-weighted normals of the triangles that share it. */
  finish(): PartArrays {
    const n = new Float32Array(this.pos.length);
    for (let i = 0; i < this.idx.length; i += 3) {
      const a = this.idx[i] * 3; const b = this.idx[i + 1] * 3; const c = this.idx[i + 2] * 3;
      const ux = this.pos[b] - this.pos[a]; const uy = this.pos[b + 1] - this.pos[a + 1]; const uz = this.pos[b + 2] - this.pos[a + 2];
      const vx = this.pos[c] - this.pos[a]; const vy = this.pos[c + 1] - this.pos[a + 1]; const vz = this.pos[c + 2] - this.pos[a + 2];
      const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
      // A vertex no triangle uses has no normal: point it up rather than leave a zero vector in the array.
      if (l < 1e-12) { n[i + 1] = 1; continue; }
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return { position: Float32Array.from(this.pos), normal: n, index: Uint16Array.from(this.idx), triangles: this.idx.length / 3 };
  }
}

/** Smooth curve through (t, v) control points (cubic Hermite with finite-difference slopes). */
function curve(ts: number[], vs: number[], t: number): number {
  const n = ts.length;
  if (t <= ts[0]) return vs[0];
  if (t >= ts[n - 1]) return vs[n - 1];
  let i = 0;
  while (i < n - 2 && t > ts[i + 1]) i++;
  const h = ts[i + 1] - ts[i];
  const s = (t - ts[i]) / h;
  const m0 = i === 0 ? (vs[1] - vs[0]) / h : (vs[i + 1] - vs[i - 1]) / (ts[i + 1] - ts[i - 1]);
  const m1 = i + 1 === n - 1 ? (vs[n - 1] - vs[n - 2]) / h : (vs[i + 2] - vs[i]) / (ts[i + 2] - ts[i]);
  const s2 = s * s; const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * vs[i + 1] + (s3 - s2) * h * m1;
}

const spow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * A lofted body along +x (front) from x0 to x1: at each station a superellipse of half-width w(t) between a floor and a top y(t); closed at
 * both ends by a fan. keep(y) lets a part cut its section (the glass keeps only the upper arc).
 */
function loft(p: Part, x0: number, x1: number, stations: number, ring: number, ts: number[], top: number[], half: number[], floor: number, power: number, from = 0, to = 1, scale = 1, minY = -Infinity): void {
  const rows: number[][] = [];
  for (let s = 0; s < stations; s++) {
    const t = from + ((to - from) * s) / (stations - 1);
    const x = x0 + (x1 - x0) * t;
    const w = curve(ts, half, t) * scale; const yTop = curve(ts, top, t);
    const mid = (yTop + floor) / 2; const hh = ((yTop - floor) / 2) * scale;
    const row: number[] = [];
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const z = w * spow(Math.cos(a), 2 / power);
      const y = Math.max(minY, mid + hh * spow(Math.sin(a), 2 / power));
      row.push(p.vert(x, y, z));
    }
    rows.push(row);
  }
  for (let s = 0; s < stations - 1; s++) {
    for (let k = 0; k < ring; k++) {
      const a = rows[s][k]; const b = rows[s][(k + 1) % ring]; const c = rows[s + 1][k]; const d = rows[s + 1][(k + 1) % ring];
      p.tri(a, c, b); p.tri(b, c, d);
    }
  }
  for (const [row, atFront] of [[rows[0], false], [rows[stations - 1], true]] as Array<[number[], boolean]>) {
    const t = atFront ? to : from;
    const centre = p.vert(p.pos[row[0] * 3], (curve(ts, top, t) + floor) / 2, 0);
    for (let k = 0; k < ring; k++) { const a = row[k]; const b = row[(k + 1) % ring]; if (atFront) p.tri(centre, b, a); else p.tri(centre, a, b); }
  }
}

/** A cylinder along the z axis centred at (cx, cy, cz): sides plus two caps. */
function wheelCylinder(p: Part, cx: number, cy: number, cz: number, radius: number, width: number, seg: number): void {
  const ring0: number[] = []; const ring1: number[] = [];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    ring0.push(p.vert(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz - width / 2));
    ring1.push(p.vert(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz + width / 2));
  }
  for (let k = 0; k < seg; k++) {
    const a = ring0[k]; const b = ring0[(k + 1) % seg]; const c = ring1[k]; const d = ring1[(k + 1) % seg];
    p.tri(a, b, c); p.tri(b, d, c);
  }
  for (const [ring, z, flip] of [[ring0, cz - width / 2, true], [ring1, cz + width / 2, false]] as Array<[number[], number, boolean]>) {
    const centre = p.vert(cx, cy, z);
    for (let k = 0; k < seg; k++) { const a = ring[k]; const b = ring[(k + 1) % seg]; if (flip) p.tri(centre, b, a); else p.tri(centre, a, b); }
  }
}

/** A rim: a disc a little proud of the tyre with five spokes cut as triangles. */
function rim(p: Part, cx: number, cy: number, cz: number, radius: number, seg: number): void {
  const ring: number[] = [];
  for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; ring.push(p.vert(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz)); }
  const centre = p.vert(cx, cy, cz);
  const period = Math.max(2, Math.round(seg / 5));
  const half = Math.max(1, Math.floor(period / 2));
  for (let k = 0; k < seg; k++) if (k % period < half) p.tri(centre, ring[k], ring[(k + 1) % seg]);
}

function box(p: Part, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
  const v: number[] = [];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) v.push(p.vert(cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2));
  const f = (a: number, b: number, c: number, d: number): void => { p.tri(a, b, c); p.tri(b, d, c); };
  f(v[0], v[1], v[2], v[3]); f(v[4], v[6], v[5], v[7]); f(v[0], v[4], v[1], v[5]); f(v[2], v[3], v[6], v[7]); f(v[0], v[2], v[4], v[6]); f(v[1], v[5], v[3], v[7]);
}

/** An open tube between two points. */
function tubeBetween(p: Part, a: [number, number, number], b: [number, number, number], r: number, seg: number): void {
  const ax = b[0] - a[0]; const ay = b[1] - a[1]; const az = b[2] - a[2];
  const l = Math.hypot(ax, ay, az) || 1;
  const dx = ax / l; const dy = ay / l; const dz = az / l;
  const rx = Math.abs(dy) > 0.9 ? 1 : 0; const ry = Math.abs(dy) > 0.9 ? 0 : 1;
  let ux = dy * 0 - dz * ry; let uy = dz * rx - dx * 0; let uz = dx * ry - dy * rx;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy; const vy = dz * ux - dx * uz; const vz = dx * uy - dy * ux;
  const r0: number[] = []; const r1: number[] = [];
  for (let k = 0; k < seg; k++) {
    const t = (k / seg) * Math.PI * 2; const c = Math.cos(t) * r; const s = Math.sin(t) * r;
    r0.push(p.vert(a[0] + ux * c + vx * s, a[1] + uy * c + vy * s, a[2] + uz * c + vz * s));
    r1.push(p.vert(b[0] + ux * c + vx * s, b[1] + uy * c + vy * s, b[2] + uz * c + vz * s));
  }
  for (let k = 0; k < seg; k++) { const q = (k + 1) % seg; p.tri(r0[k], r1[k], r0[q]); p.tri(r0[q], r1[k], r1[q]); }
}

export const CAR = {
  length: 4.5, width: 1.86, wheelRadius: 0.34, wheelbase: 2.7, track: 1.62, rideHeight: 0.0,
  /** Wheel centres relative to the middle of the car: front axle x, rear axle x, half the track. */
  frontAxle: 1.38, rearAxle: -1.32, halfTrack: 0.84,
};
export const BIKE = { length: 2.1, width: 0.7, wheelRadius: 0.33, wheelbase: 1.45, frontAxle: 0.74, rearAxle: -0.71 };

export interface VehicleParts {
  kind: VehicleKind;
  body: PartArrays;
  glass: PartArrays | null;
  tyre: PartArrays;
  rim: PartArrays;
  lights: PartArrays;
  /** The dark wheel arches: a disc a little larger than each tyre on the body side, so a wheel sits IN the body and not on it (cars only). */
  arches: PartArrays | null;
}

/** The car's meshes at a detail tier: unit scale, metres, +x forward, +y up, +z to the right, wheels on y = 0. */
export function buildCar(tier: VehicleTier): VehicleParts {
  const L = CAR.length;
  const ts = [0, 0.08, 0.25, 0.38, 0.55, 0.7, 0.85, 0.95, 1];
  const top = [0.8, 0.92, 0.98, 1.2, 1.22, 0.92, 0.78, 0.62, 0.46];
  const half = [0.78, 0.88, 0.93, 0.92, 0.92, 0.93, 0.9, 0.82, 0.6];
  const body = new Part();
  loft(body, -L / 2, L / 2, tier.stations, tier.ring, ts, top, half, 0.22, 2.8);
  const glass = new Part();
  loft(glass, -L / 2, L / 2, Math.max(6, Math.floor(tier.stations / 2)), Math.max(8, tier.ring - 4), ts, top, half, 0.22, 2.8, 0.3, 0.62, 1.012, 0.95);
  const tyre = new Part(); const rimP = new Part();
  for (const x of [CAR.frontAxle, CAR.rearAxle]) for (const side of [-1, 1]) {
    const z = side * CAR.halfTrack;
    wheelCylinder(tyre, x, CAR.wheelRadius, z, CAR.wheelRadius, 0.26, tier.tyre);
    rim(rimP, x, CAR.wheelRadius, z + side * 0.135, CAR.wheelRadius * 0.62, tier.tyre);
  }
  const lights = new Part();
  for (const side of [-1, 1]) {
    box(lights, L / 2 - 0.12, 0.62, side * 0.62, 0.12, 0.08, 0.34);
    box(lights, -L / 2 + 0.06, 0.86, side * 0.66, 0.1, 0.08, 0.36);
  }
  const arches = new Part();
  for (const x of [CAR.frontAxle, CAR.rearAxle]) for (const side of [-1, 1]) {
    const z = side * 0.945; const seg = tier.tyre; const ring: number[] = [];
    for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; ring.push(arches.vert(x + Math.cos(a) * 0.44, CAR.wheelRadius + Math.sin(a) * 0.44, z)); }
    const centre = arches.vert(x, CAR.wheelRadius, z);
    for (let k = 0; k < seg; k++) arches.tri(centre, ring[k], ring[(k + 1) % seg]);
  }
  return { kind: 'car', body: body.finish(), glass: glass.finish(), tyre: tyre.finish(), rim: rimP.finish(), lights: lights.finish(), arches: arches.finish() };
}

/** The bike's meshes: a lofted tank and tail, tubes for the frame, fork and bars, an engine block, two wheels. */
export function buildBike(tier: VehicleTier): VehicleParts {
  const body = new Part(); const tyre = new Part(); const rimP = new Part(); const lights = new Part();
  const ts = [0, 0.25, 0.5, 0.75, 1];
  loft(body, -0.55, 0.45, Math.max(8, Math.floor(tier.stations * 0.6)), Math.max(8, tier.ring - 4), ts, [0.86, 0.98, 1.02, 0.9, 0.78], [0.12, 0.2, 0.17, 0.1, 0.06], 0.62, 2.4);
  box(body, -0.05, 0.4, 0, 0.5, 0.36, 0.3);
  const seg = Math.max(6, Math.floor(tier.tyre / 2));
  tubeBetween(body, [-0.7, 0.33, 0], [-0.1, 0.75, 0], 0.025, seg);
  tubeBetween(body, [0.45, 0.8, 0], [0.74, 0.33, 0], 0.03, seg);
  tubeBetween(body, [0.4, 0.95, -0.34], [0.4, 0.95, 0.34], 0.018, seg);
  tubeBetween(body, [0.3, 0.3, 0.14], [-0.5, 0.36, 0.16], 0.04, seg);
  for (const [x, label] of [[BIKE.frontAxle, 0], [BIKE.rearAxle, 1]] as Array<[number, number]>) {
    wheelCylinder(tyre, x, BIKE.wheelRadius, 0, BIKE.wheelRadius, label === 0 ? 0.12 : 0.18, tier.tyre);
    rim(rimP, x, BIKE.wheelRadius, 0.095, BIKE.wheelRadius * 0.6, tier.tyre);
  }
  box(lights, 0.5, 0.92, 0, 0.1, 0.1, 0.16);
  box(lights, -0.58, 0.84, 0, 0.08, 0.06, 0.16);
  return { kind: 'bike', body: body.finish(), glass: null, tyre: tyre.finish(), rim: rimP.finish(), lights: lights.finish(), arches: null };
}

export function vehicleTriangles(parts: VehicleParts): number {
  return parts.body.triangles + (parts.glass ? parts.glass.triangles : 0) + parts.tyre.triangles + parts.rim.triangles + parts.lights.triangles + (parts.arches ? parts.arches.triangles : 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Driving physics (pure).

export interface VehicleInput {
  /** -1 (reverse) to 1 (full throttle). */
  throttle: number;
  /** -1 (left) to 1 (right). */
  steer: number;
  /** 0 to 1. */
  brake: number;
  handbrake: boolean;
}

export const NO_INPUT: VehicleInput = { throttle: 0, steer: 0, brake: 0, handbrake: false };

export interface VehicleSpec {
  kind: VehicleKind;
  wheelbase: number;
  frontAxle: number;
  rearAxle: number;
  halfTrack: number;
  /** Peak acceleration on the flat from rest, m/s2, and the speed at which engine force has all gone, m/s. */
  accel: number;
  topSpeed: number;
  /** Peak brake deceleration in m/s2 on perfect grip. */
  brake: number;
  /** Steering lock in radians at low speed. */
  maxSteer: number;
  /** How fast sideways speed is bled off on perfect grip, 1/s. */
  grip: number;
  /** Lean of the body in a turn: 0 for a car (a little roll), more for a bike. */
  lean: number;
  rideHeight: number;
}

export const CAR_SPEC: VehicleSpec = { kind: 'car', wheelbase: CAR.wheelbase, frontAxle: CAR.frontAxle, rearAxle: CAR.rearAxle, halfTrack: CAR.halfTrack, accel: 8.5, topSpeed: 82, brake: 11, maxSteer: 0.55, grip: 10, lean: 0.06, rideHeight: 0 };
export const BIKE_SPEC: VehicleSpec = { kind: 'bike', wheelbase: BIKE.wheelbase, frontAxle: BIKE.frontAxle, rearAxle: BIKE.rearAxle, halfTrack: 0.0, accel: 10.5, topSpeed: 72, brake: 10, maxSteer: 0.5, grip: 9, lean: 1, rideHeight: 0 };

export interface VehicleState {
  x: number; y: number; z: number;
  /** Heading in radians: the direction of +x of the body in the x-z plane, atan2(dz, dx). */
  yaw: number;
  pitch: number;
  roll: number;
  vx: number; vy: number; vz: number;
  /** Speed along the heading (negative when reversing), m/s. */
  speed: number;
  /** Sideways speed, m/s: a slide when it is not near zero. */
  slip: number;
  steerAngle: number;
  /** Wheel rotation in radians (grows with distance driven). */
  wheelSpin: number;
  onGround: boolean;
  inWater: boolean;
  surface: Surface;
  /** Metres driven. */
  odometer: number;
}

export interface VehicleEnvironment {
  /** The height a wheel meets at a place: the ground, or the deck of a bridge. */
  groundAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
}

export interface VehiclePhysics {
  readonly spec: VehicleSpec;
  readonly state: VehicleState;
  step(dt: number, input: VehicleInput): void;
  reset(x: number, z: number, yaw: number): void;
}

export function createVehiclePhysics(spec: VehicleSpec, env: VehicleEnvironment, x = 0, z = 0, yaw = 0): VehiclePhysics {
  const state: VehicleState = { x, y: env.groundAt(x, z) + spec.rideHeight, z, yaw, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, speed: 0, slip: 0, steerAngle: 0, wheelSpin: 0, onGround: true, inWater: false, surface: env.surfaceAt(x, z), odometer: 0 };

  let prevTarget: number | null = null;

  function contacts(): Array<{ x: number; z: number; h: number }> {
    const c = Math.cos(state.yaw); const s = Math.sin(state.yaw);
    // The body's right (+z of the car) is the x-z direction (-sin, cos) rotated... a vector (a, b) in the body maps to (a c - b s, a s + b c) in the world.
    const pts: Array<[number, number]> = spec.halfTrack > 0
      ? [[spec.frontAxle, -spec.halfTrack], [spec.frontAxle, spec.halfTrack], [spec.rearAxle, -spec.halfTrack], [spec.rearAxle, spec.halfTrack]]
      : [[spec.frontAxle, 0], [spec.rearAxle, 0]];
    return pts.map(([a, b]) => { const wx = state.x + a * c - b * s; const wz = state.z + a * s + b * c; return { x: wx, z: wz, h: env.groundAt(wx, wz) }; });
  }

  function step(dt: number, input: VehicleInput): void {
    const h = Math.min(dt, 1 / 30);
    const c = Math.cos(state.yaw); const s = Math.sin(state.yaw);
    state.surface = env.surfaceAt(state.x, state.z);
    const mu = SURFACE_FRICTION[state.surface];
    // Body frame speeds.
    let vf = state.vx * c + state.vz * s;
    let vl = -state.vx * s + state.vz * c;
    const wet = state.surface === 'water';
    state.inWater = wet;
    const throttle = Math.max(-1, Math.min(1, input.throttle)) * (wet ? 0 : 1);
    const traction = state.onGround ? 1 : 0;
    // Engine: strong from rest, fading to nothing at the top speed; reverse is slow.
    let a = 0;
    if (throttle > 0) a = throttle * spec.accel * Math.max(0, 1 - Math.pow(Math.max(0, vf) / spec.topSpeed, 3)) * Math.min(1, 0.35 + mu * 0.65);
    else if (throttle < 0) a = vf > 1 ? throttle * spec.brake * mu * 0.9 : throttle * spec.accel * 0.35 * Math.max(0, 1 - Math.pow(-vf / (spec.topSpeed * 0.25), 2));
    a *= traction;
    // Brakes bite as hard as the surface lets them.
    const brakeA = Math.max(0, Math.min(1, input.brake)) * spec.brake * mu * traction + (input.handbrake ? spec.brake * 0.5 * mu * traction : 0);
    const drag = 0.0004 * vf * Math.abs(vf) + 0.02 * vf + (wet ? 3.5 * vf : 0);
    let dv = (a - drag) * h;
    if (brakeA > 0) { const b = brakeA * h; dv += vf > 0 ? -Math.min(b, vf) : Math.min(b, -vf); }
    // Gravity along the slope the car stands on.
    dv += -GRAVITY * Math.sin(state.pitch) * traction * h;
    vf += dv;
    // Steering narrows with speed; the yaw rate cannot ask for more sideways acceleration than the surface gives.
    const lock = spec.maxSteer / (1 + Math.pow(Math.abs(vf) / 24, 2));
    const target = Math.max(-1, Math.min(1, input.steer)) * lock;
    state.steerAngle += (target - state.steerAngle) * Math.min(1, h * 9);
    let yawRate = (vf * Math.tan(state.steerAngle)) / spec.wheelbase;
    const limit = (mu * GRAVITY) / Math.max(Math.abs(vf), 1);
    yawRate = Math.max(-limit, Math.min(limit, yawRate)) * traction;
    // The speed changes along the OLD heading; then the car turns while its velocity (in the world) carries on, so a sideways part appears...
    state.vx = vf * c - vl * s;
    state.vz = vf * s + vl * c;
    state.yaw += yawRate * h;
    const c2 = Math.cos(state.yaw); const s2 = Math.sin(state.yaw);
    vf = state.vx * c2 + state.vz * s2;
    vl = -state.vx * s2 + state.vz * c2;
    // ...which the tyres bleed off: quickly on good grip, slowly on a slippery surface, and hardly at all with the handbrake on (a slide).
    const gripRate = spec.grip * mu * (input.handbrake ? 0.12 : 1) * traction;
    vl *= Math.exp(-gripRate * h);
    state.vx = vf * c2 - vl * s2;
    state.vz = vf * s2 + vl * c2;
    state.x += state.vx * h;
    state.z += state.vz * h;
    state.odometer += Math.abs(vf) * h;
    state.wheelSpin += (vf / (spec.kind === 'car' ? CAR.wheelRadius : BIKE.wheelRadius)) * h;
    state.speed = vf;
    state.slip = vl;

    // Wheels on the ground: the body rides on the average of the contacts and tilts to match them.
    const cs = contacts();
    const avg = cs.reduce((n, p) => n + p.h, 0) / cs.length;
    const target0 = avg + spec.rideHeight;
    let pitchT = 0; let rollT = 0;
    if (spec.halfTrack > 0) {
      const front = (cs[0].h + cs[1].h) / 2; const rear = (cs[2].h + cs[3].h) / 2;
      const left = (cs[0].h + cs[2].h) / 2; const right = (cs[1].h + cs[3].h) / 2;
      pitchT = Math.atan2(front - rear, spec.frontAxle - spec.rearAxle);
      rollT = Math.atan2(right - left, spec.halfTrack * 2);
    } else {
      pitchT = Math.atan2(cs[0].h - cs[1].h, spec.frontAxle - spec.rearAxle);
    }
    // Body roll (positive: the right side is the higher one). In a turn a car rolls a little OUTWARDS, a bike leans hard INTO the turn.
    const latAcc = yawRate * vf;
    rollT += Math.max(-0.7, Math.min(0.7, (latAcc / GRAVITY) * spec.lean * (spec.kind === 'bike' ? -1.1 : 0.35)));
    const k = Math.min(1, h * 14);
    state.pitch += (pitchT - state.pitch) * k;
    state.roll += (rollT - state.roll) * k;
    // Vertical: spring and damper while the wheels touch, gravity in the air.
    // The damper works on the speed RELATIVE to the ground (a car climbing a steady slope is not fighting its own damper).
    const groundRate = prevTarget === null ? 0 : (target0 - prevTarget) / h;
    prevTarget = target0;
    if (state.y <= target0 + 0.06) {
      const spring = 180 * (target0 - state.y) - 26 * (state.vy - Math.max(-8, Math.min(8, groundRate)));
      state.vy += spring * h;
      if (state.y < target0 - 0.5) state.y = target0 - 0.5;
      state.onGround = true;
    } else {
      state.vy -= GRAVITY * h;
      state.onGround = false;
    }
    state.y += state.vy * h;
    if (state.y < target0 && state.vy < 0) { state.y = target0; state.vy = 0; }
  }

  return {
    spec, state, step,
    reset(nx: number, nz: number, nyaw: number): void {
      state.x = nx; state.z = nz; state.yaw = nyaw; state.y = env.groundAt(nx, nz) + spec.rideHeight;
      state.vx = 0; state.vy = 0; state.vz = 0; state.speed = 0; state.slip = 0; state.pitch = 0; state.roll = 0; state.steerAngle = 0; state.onGround = true; state.odometer = 0; prevTarget = null;
    },
  };
}

/** The environment of a map: the height a wheel meets and the surface it runs on. */
export function mapEnvironment(world: AthreeWorld): VehicleEnvironment {
  return { groundAt: (x, z) => world.drivableHeightAt(x, z), surfaceAt: (x, z) => world.surfaceAt(x, z) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The vehicle on screen.

export interface VehicleOptions {
  kind?: VehicleKind;
  /** Paint colour as a number (0xrrggbb). */
  color?: number;
  quality?: AthreeQuality;
  /** Where it starts, in WORLD metres, and its heading. Default: a safe spawn point of the right kind. */
  x?: number;
  z?: number;
  yaw?: number;
}

export interface Vehicle {
  readonly group: ThreeLike;
  readonly physics: VehiclePhysics;
  readonly state: VehicleState;
  readonly triangles: number;
  /** Advance the physics by dt seconds and place the model. origin is the map's floating origin (world minus origin = render position). */
  update(dt: number, input: VehicleInput, origin: { x: number; z: number }): void;
  /** Headlights on or off (brake lights follow the brake). */
  setLights(on: boolean): void;
  dispose(): void;
}

function geometryOf(THREE: ThreeLike, a: PartArrays): ThreeLike {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  return g;
}

export function createVehicle(THREE: ThreeLike, world: AthreeWorld, options: VehicleOptions = {}): Vehicle {
  const kind = options.kind ?? 'car';
  const tier = VEHICLE_TIERS[options.quality ?? 'mid'];
  const parts = kind === 'car' ? buildCar(tier) : buildBike(tier);
  const spec = kind === 'car' ? CAR_SPEC : BIKE_SPEC;
  let sx = options.x; let sz = options.z; let syaw = options.yaw ?? 0;
  if (sx === undefined || sz === undefined) {
    const sp = world.spawnPoints('vehicle', 1)[0];
    sx = sp.x; sz = sp.z; syaw = options.yaw ?? sp.heading;
  }
  const physics = createVehiclePhysics(spec, mapEnvironment(world), sx, sz, syaw);
  const group = new THREE.Group();
  const meshes: ThreeLike[] = [];
  const paint = new THREE.MeshPhysicalMaterial({ color: options.color ?? 0xc8102e, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1218, metalness: 0.9, roughness: 0.06, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, metalness: 0, roughness: 0.92, side: THREE.DoubleSide });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 1, roughness: 0.3, side: THREE.DoubleSide });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x000000, metalness: 0, roughness: 0.4, side: THREE.DoubleSide });
  const body = new THREE.Group();
  const add = (parent: ThreeLike, arrays: PartArrays, material: ThreeLike): ThreeLike => {
    const m = new THREE.Mesh(geometryOf(THREE, arrays), material);
    parent.add(m); meshes.push(m);
    return m;
  };
  add(body, parts.body, paint);
  if (parts.glass) add(body, parts.glass, glass);
  add(body, parts.lights, lightMat);
  if (parts.arches) add(body, parts.arches, rubber);
  group.add(body);
  // Each wheel is its own group at its axle so it can spin and (at the front) steer; the tyre and rim arrays hold all wheels, so
  // they are split here by the axle each vertex sits at.
  const wheels: ThreeLike[] = [];
  const axles: Array<[number, number]> = kind === 'car'
    ? [[CAR.frontAxle, -CAR.halfTrack], [CAR.frontAxle, CAR.halfTrack], [CAR.rearAxle, -CAR.halfTrack], [CAR.rearAxle, CAR.halfTrack]]
    : [[BIKE.frontAxle, 0], [BIKE.rearAxle, 0]];
  const wr = kind === 'car' ? CAR.wheelRadius : BIKE.wheelRadius;
  const splitByAxle = (a: PartArrays, ax: number, az: number): PartArrays => {
    const keep: number[] = [];
    for (let i = 0; i < a.index.length; i += 3) {
      const v = a.index[i] * 3;
      if (Math.abs(a.position[v] - ax) < wr * 1.05 && Math.abs(a.position[v + 2] - az) < 0.3) keep.push(a.index[i], a.index[i + 1], a.index[i + 2]);
    }
    const pos: number[] = []; const nor: number[] = []; const map = new Map<number, number>(); const idx: number[] = [];
    for (const i of keep) {
      let j = map.get(i);
      if (j === undefined) { j = pos.length / 3; map.set(i, j); pos.push(a.position[i * 3] - ax, a.position[i * 3 + 1] - wr, a.position[i * 3 + 2] - az); nor.push(a.normal[i * 3], a.normal[i * 3 + 1], a.normal[i * 3 + 2]); }
      idx.push(j);
    }
    return { position: Float32Array.from(pos), normal: Float32Array.from(nor), index: Uint16Array.from(idx), triangles: idx.length / 3 };
  };
  for (const [ax, az] of axles) {
    const pivot = new THREE.Group();
    pivot.position.set(ax, wr, az);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(spin, splitByAxle(parts.tyre, ax, az), rubber);
    add(spin, splitByAxle(parts.rim, ax, az), alloy);
    group.add(pivot);
    wheels.push({ pivot, spin, front: ax > 0 });
  }
  const headlights = new THREE.PointLight(0xfff2d0, 0, 60);
  headlights.position.set(spec.frontAxle + 1, 0.7, 0);
  body.add(headlights);
  const triangles = vehicleTriangles(parts);

  function update(dt: number, input: VehicleInput, origin: { x: number; z: number }): void {
    // A fixed 120 Hz step keeps the physics the same at any frame rate.
    let left = Math.min(dt, 0.25);
    while (left > 1e-9) { const h = Math.min(left, 1 / 120); physics.step(h, input); left -= h; }
    const s = physics.state;
    group.position.set(s.x - origin.x, s.y, s.z - origin.z);
    // The model's +x is forward and the world heading is atan2(dz, dx): rotating about y by -yaw turns +x onto it.
    group.rotation.set(0, -s.yaw, 0, 'YXZ');
    body.rotation.set(-s.roll, 0, s.pitch, 'XYZ');
    for (const w of wheels) {
      w.spin.rotation.z = -s.wheelSpin;
      w.pivot.rotation.y = w.front ? -s.steerAngle : 0;
    }
    lightMat.emissive.setHex(input.brake > 0.05 || input.throttle < -0.05 ? 0xff1010 : 0x000000);
  }

  function setLights(on: boolean): void {
    headlights.intensity = on ? 1.6 : 0;
  }

  function dispose(): void {
    for (const m of meshes) m.geometry.dispose();
    for (const m of [paint, glass, rubber, alloy, lightMat]) m.dispose();
  }

  update(0, NO_INPUT, { x: 0, z: 0 });
  return { group, physics, state: physics.state, triangles, update, setLights, dispose };
}
`;
