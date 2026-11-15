// OBJECT FORGE — the emitted source of src/game/forge/behave.ts: HOW AN OBJECT MOVES, from data.
//
// A model never writes movement code. A spec says `behaviour: { type: "rails", path: [...], speed: 12 }` and this file — written once, by us,
// tested — runs it. Five fixed behaviours cover most things a game moves: rails (a train on its track, a guard on a beat), wander (an
// animal, a villager), drive (a car, a bike, a boat under the player's hands), orbit (a plane, a bird), static. The numbers come from the
// spec; the movement is ours.
//
// Conventions: the object faces +z at heading 0; heading is its rotation about y in radians (increasing turns it toward +x, its left);
// steer +1 is right. Speeds are metres per second. Ground is the optional heightAt(x, z) of the world; without it the ground is y = 0.
//
// PURE source string; the generator writes it. Rule for editing: no backticks and no dollar-brace inside the string below.
export const FORGE_BEHAVE = `// Object Forge — fixed behaviours (rails, wander, drive, orbit) run from a spec's data. No movement code is ever generated.
// Technique: arc-length parameterised polylines, a seeded random walk, a throttle/brake/steer arcade model, a banked circle. Own implementation.
import type { ForgeBehaviour, ForgeObject } from './forge';

export interface BehaviourOptions {
  /** Ground height at (x, z) (a world's heightAt): the object stands on it. Without it the ground is flat at y = 0. */
  heightAt?: (x: number, z: number) => number;
  /**
   * How far above the ground (or below the water) the object sits. Default: the group's own y when behave() is called, so a boat set down at
   * y = -0.3 keeps its draft. NOTE: if you placed the object ON the ground by setting its y to the ground height, pass heightOffset: 0 (or the
   * default would add that height a second time). Applies only to moving behaviours.
   */
  heightOffset?: number;
  /** Where it starts. Default: where its group is now. */
  start?: { x: number; z: number; heading?: number };
  /** Overrides the spec's wander seed. */
  seed?: number;
}

export interface MoveInput {
  /** -1 (reverse) to 1 (full throttle). */
  throttle: number;
  /** -1 (left) to 1 (right). */
  steer: number;
  brake?: boolean;
}

export interface Mover {
  /** Advance by dt seconds: moves the object AND advances its animation (call this once a frame, not also obj.update). input is read by a drive behaviour only. */
  update(dt: number, input?: MoveInput): void;
  /** Signed forward speed in metres per second. */
  readonly speed: number;
  /** Radians. */
  readonly heading: number;
  readonly x: number;
  readonly z: number;
  /** moving, turning, idle or finished (a rails behaviour that reached the end of an open path). */
  readonly state: string;
  /** Stand still now (clips stop where they are). */
  stop(): void;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const approach = (v: number, target: number, step: number): number => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

/** An angle held to [-pi, pi). */
export function wrapAngle(a: number): number {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** A small seeded generator, so a wandering animal walks the same way for the same seed. */
export function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The length of a polyline of [x, z] points (closed when loop). */
export function pathLength(path: Array<[number, number]>, loop: boolean): number {
  let len = 0;
  const n = path.length;
  for (let i = 0; i < (loop ? n : n - 1); i++) { const a = path[i]; const b = path[(i + 1) % n]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return len;
}

function atDistance(path: Array<[number, number]>, loop: boolean, d: number): { x: number; z: number } {
  const n = path.length;
  const total = pathLength(path, loop);
  let dist = loop ? ((d % total) + total) % total : clamp(d, 0, total);
  for (let i = 0; i < (loop ? n : n - 1); i++) {
    const a = path[i]; const b = path[(i + 1) % n];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (dist <= seg || i === (loop ? n : n - 1) - 1) { const t = seg > 0 ? clamp(dist / seg, 0, 1) : 0; return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t }; }
    dist -= seg;
  }
  return { x: path[0][0], z: path[0][1] };
}

/** Where a path is at a distance along it, and which way it points there (the chord 1.5 m either side, so a corner is turned, not snapped). */
export function pathPoint(path: Array<[number, number]>, loop: boolean, d: number): { x: number; z: number; heading: number } {
  const here = atDistance(path, loop, d);
  const a = atDistance(path, loop, d - 1.5); const b = atDistance(path, loop, d + 1.5);
  const dx = b.x - a.x; const dz = b.z - a.z;
  return { x: here.x, z: here.z, heading: Math.hypot(dx, dz) > 1e-9 ? Math.atan2(dx, dz) : 0 };
}

export function behave(obj: ForgeObject, behaviour: ForgeBehaviour | undefined, options: BehaviourOptions = {}): Mover {
  const b: ForgeBehaviour = behaviour ?? { type: 'static' };
  const group = obj.group;
  const ground = options.heightAt ?? ((): number => 0);
  const initialY = Number.isFinite(group.position.y) ? group.position.y : 0;
  const heightOffset = options.heightOffset !== undefined && Number.isFinite(options.heightOffset) ? options.heightOffset : initialY;
  let x: number = options.start?.x ?? group.position.x;
  let z: number = options.start?.z ?? group.position.z;
  let heading: number = options.start?.heading ?? group.rotation.y;
  let speed = 0;
  let state = 'idle';

  const place = (pitch = 0, roll = 0, lift = 0): void => {
    group.position.set(x, ground(x, z) + heightOffset + lift, z);
    group.rotation.set(pitch, heading, roll);
  };
  /** Pitch and roll that lay the object on the ground under it (flat ground gives zero). */
  const tilt = (): { pitch: number; roll: number } => {
    if (!options.heightAt) return { pitch: 0, roll: 0 };
    const d = 1.2; const fx = Math.sin(heading); const fz = Math.cos(heading); const rx = Math.cos(heading); const rz = -Math.sin(heading);
    const front = ground(x + fx * d, z + fz * d); const back = ground(x - fx * d, z - fz * d);
    const side = ground(x + rx * d, z + rz * d); const other = ground(x - rx * d, z - rz * d);
    return { pitch: -Math.atan2(front - back, 2 * d), roll: Math.atan2(side - other, 2 * d) };
  };
  const play = (clip: string | undefined): void => { if (clip && obj.clip !== clip) obj.play(clip); };
  /** Turns a clip at the rate that matches the ground speed: a wheel of radius r turns v / (2 pi r) times a second. */
  const rollAt = (v: number, wheelRadius: number | undefined): void => {
    if (!obj.clip) return;
    const base = obj.spinOf(obj.clip);
    obj.setSpeed(wheelRadius && wheelRadius > 0 && base > 0 ? v / (TAU * wheelRadius) / base : v === 0 ? 0 : 1);
  };
  const stopClip = (): void => { obj.setSpeed(0); };

  /** The Mover every behaviour hands back. update() steps the movement, then advances the object's own animation by the same time: ONE call per frame. */
  const make = (step: (dt: number, input?: MoveInput) => void, halt: () => void): Mover => ({
    update(dtIn: number, input?: MoveInput): void {
      const dt = clamp(Number.isFinite(dtIn) ? dtIn : 0, 0, 0.1);
      step(dt, input);
      obj.update(dt);
    },
    get speed(): number { return speed; },
    get heading(): number { return heading; },
    get x(): number { return x; },
    get z(): number { return z; },
    get state(): string { return state; },
    stop(): void { halt(); },
  });

  // A static wrapper advances animation without moving or reorienting an already placed object.
  if (b.type === 'static') return make(() => { /* preserve authored pose */ }, () => { /* already still */ });
  // Yaw first, then pitch and roll in the moving object's own frame.
  group.rotation.order = 'YXZ';

  if (b.type === 'rails') {
    const loop = b.loop === true;
    const total = pathLength(b.path, loop);
    let dist = 0;
    const p0 = pathPoint(b.path, loop, 0);
    x = p0.x; z = p0.z; heading = p0.heading; place();
    return make((dt) => {
      if (state === 'finished') return;
      dist += b.speed * dt;
      if (!loop && dist >= total) { dist = total; state = 'finished'; speed = 0; stopClip(); } else { state = 'moving'; speed = b.speed; }
      const p = pathPoint(b.path, loop, dist);
      x = p.x; z = p.z; heading = p.heading; place();
      if (state === 'moving') { play(b.clip); rollAt(speed, b.wheelRadius); }
    }, () => { state = 'finished'; speed = 0; stopClip(); });
  }

  if (b.type === 'wander') {
    const rand = seeded(options.seed ?? b.seed ?? 1);
    const ox = x; const oz = z;
    const pause = b.pause ?? [1, 4];
    const turnRate = b.turnRate ?? 2.5;
    let tx = x; let tz = z;
    const pick = (): void => { const r = Math.sqrt(rand()) * b.radius; const a = rand() * TAU; tx = ox + Math.cos(a) * r; tz = oz + Math.sin(a) * r; };
    const rest = (): number => pause[0] + (pause[1] - pause[0]) * rand();
    let waiting = rest();
    place();
    return make((dt) => {
      if (waiting > 0) {
        waiting -= dt; state = 'idle'; speed = 0;
        if (b.idleClip) play(b.idleClip); else stopClip();
        const t = tilt(); place(t.pitch, t.roll);
        return;
      }
      const dx = tx - x; const dz = tz - z; const d = Math.hypot(dx, dz);
      if (d < 0.4) { waiting = rest(); pick(); speed = 0; return; }
      const want = Math.atan2(dx, dz);
      const maxTurn = turnRate * dt;
      heading += clamp(wrapAngle(want - heading), -maxTurn, maxTurn);
      if (Math.abs(wrapAngle(want - heading)) < 0.6) {
        // Never past the target, and never out of the circle: a big step taken a little off the line (it walks while still turning) could
        // leave the disc, so the place it arrives at is held to it.
        const step = Math.min(b.speed * dt, d);
        x += Math.sin(heading) * step; z += Math.cos(heading) * step;
        const off = Math.hypot(x - ox, z - oz);
        if (off > b.radius) { x = ox + ((x - ox) * b.radius) / off; z = oz + ((z - oz) * b.radius) / off; }
        speed = dt > 0 ? step / dt : 0; state = 'moving';
        play(b.clip); obj.setSpeed(1);
      } else { speed = 0; state = 'turning'; if (b.idleClip) play(b.idleClip); }
      const t = tilt(); place(t.pitch, t.roll);
    }, () => { waiting = 1e9; speed = 0; state = 'idle'; stopClip(); });
  }

  if (b.type === 'drive') {
    const accel = b.accel ?? b.maxSpeed * 0.6;
    const brake = b.brake ?? b.maxSpeed * 1.2;
    const turn = b.turnRate ?? 1.6;
    place();
    return make((dt, input) => {
      const th = clamp(input && Number.isFinite(input.throttle) ? input.throttle : 0, -1, 1);
      const st = clamp(input && Number.isFinite(input.steer) ? input.steer : 0, -1, 1);
      if (input?.brake) speed = approach(speed, 0, brake * dt);
      else if (th !== 0) speed = (th > 0) === (speed >= 0) || speed === 0 ? speed + th * accel * dt : approach(speed, 0, brake * dt);
      else speed = approach(speed, 0, accel * 0.5 * dt);
      speed = clamp(speed, -b.maxSpeed * 0.3, b.maxSpeed);
      // A vehicle turns only as it moves: full authority from a fifth of top speed, none standing still, reversed in reverse.
      const authority = clamp(Math.abs(speed) / (b.maxSpeed * 0.2 + 1e-6), 0, 1) * Math.sign(speed);
      heading = wrapAngle(heading - st * turn * authority * dt);
      x += Math.sin(heading) * speed * dt; z += Math.cos(heading) * speed * dt;
      state = Math.abs(speed) > 0.01 ? 'moving' : 'idle';
      const t = tilt(); place(t.pitch, t.roll);
      if (b.clip) { play(b.clip); rollAt(speed, b.wheelRadius); }
    }, () => { speed = 0; state = 'idle'; stopClip(); });
  }

  if (b.type === 'orbit') {
    const cx = x; const cz = z;
    const bank = ((b.bank ?? 15) * Math.PI) / 180;
    let angle = 0;
    let stopped = false;
    const set = (): void => {
      x = cx + Math.cos(angle) * b.radius; z = cz + Math.sin(angle) * b.radius;
      heading = Math.atan2(-Math.sin(angle), Math.cos(angle));
      place(0, bank, b.altitude);
    };
    set();
    return make((dt) => {
      if (stopped) return;
      angle += (b.speed / Math.max(1, b.radius)) * dt;
      speed = b.speed; state = 'moving';
      set(); play(b.clip); obj.setSpeed(1);
    }, () => { stopped = true; speed = 0; state = 'idle'; stopClip(); });
  }

  // A static object does not move; its update still advances any animation the game started (a tree swaying).
  return make(() => { /* no movement */ }, () => { /* already still */ });
}
`;
