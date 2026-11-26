/**
 * PEOPLE IN THE CITY (admin 2026-11-21 plan: "people walking in the city"). The city had streets, buildings and traffic,
 * and its pavements were empty. This module walks people around the blocks on the pavements and across the streets —
 * only on the zebra crossings, only when the cars on that street have red now AND will still have red by the time the
 * walker is across, and only when no car is near the crossing. Cars give way to them too: pass people.bodies to
 * traffic.update as things to avoid.
 *
 * Drawn for budget phones: every walker is an instance of two shared meshes (body and head), so a crowd of a hundred is
 * two draw calls, not two thousand. They bob and sway as they walk.
 *
 * String.raw: no backticks and no dollar-brace sequences inside the module text.
 */
export const GAME_CITY_PEOPLE = String.raw`import * as THREE from 'three';
import { CITY_KERB, CITY_ROAD_Y, CITY_ZEBRA, type City, type CityPlan } from './city';
import { geometryTier, mergeGeometries, type GeometryTier } from './surfaces';

/** What the walkers need from city traffic (createCityTraffic returns it): the lights and where the cars are. */
export interface TrafficLike {
  lightAt(i: number, j: number, axis: 'x' | 'z', ahead?: number): string;
  /** Each vehicle, its length along its heading (a bus is 10 m; a crossing is judged by the whole body, not its centre). */
  cars: Array<{ object: THREE.Object3D; length?: number }>;
}

export interface CityPeopleOptions {
  /** People on the pavements (1 to 150, default 30). */
  count?: number;
  /** The city's traffic, so people cross on red and never in front of a car. */
  traffic?: TrafficLike | null;
  /** Walking speed, m/s (default 1.3). */
  speed?: number;
  /** Chance, at a corner, of crossing to the next block (default 0.35). */
  crossChance?: number;
  seed?: number;
  /**
   * 'light' (queue Q-2698: a device with no GPU or a weak phone): at most LIGHT_PEOPLE walkers, with plainer bodies and heads
   * (6-sided, not 8; a 6 x 4 head, not 10 x 8). 'full': up to 150. Left out: geometryTier().
   */
  tier?: GeometryTier;
}

/** The most people a light-tier city walks, whatever count asked (a full-tier city keeps up to 150). */
export const LIGHT_PEOPLE = 12;

export type WalkerState = 'walk' | 'toCrossing' | 'wait' | 'cross' | 'leave' | 'down';

export interface Crossing {
  /** The near and far kerb on the zebra: a walker waits at a, crosses only the road, and steps off at b. */
  ax: number; az: number; bx: number; bz: number;
  node: [number, number];
  /** The axis the CARS on this street travel along — their light is the one that must be red. */
  axis: 'x' | 'z';
  to: [number, number];
}

export interface Walker {
  block: [number, number];
  /** Metres along the block's pavement loop. */
  s: number;
  dir: 1 | -1;
  speed: number;
  state: WalkerState;
  x: number; z: number; heading: number;
  crossing: Crossing | null;
  waited: number;
  /** Seconds left lying on the ground after a punch (state 'down'), and the state to return to. */
  downFor?: number;
  /** A stand-in body at the walker's feet — pass these to traffic.update so cars stop for people. */
  body: THREE.Object3D;
}

export interface CityPeople {
  root: THREE.Group;
  walkers: Walker[];
  bodies: THREE.Object3D[];
  /** Advance. avoid: what people must not walk into (the player). */
  update(dt: number, avoid?: THREE.Object3D[]): void;
  /**
   * 🧍 NOBODY WALKS THROUGH A PERSON (admin 2026-11-25, open-world problem #6: "citizens aar paar ho jate hai"). The people
   * stepped aside for the player, but the player walked straight through them. Anything inside a person (the player on
   * foot) is pushed out the shortest way, in the crowd's frame, back to its own parent's frame. True when it was pushed.
   */
  pushOut(object: THREE.Object3D, radius?: number): boolean;
  /**
   * 👊 A PUNCH LANDS ("punch to maar hi nahi sakta"): the nearest standing person in front of origin (WORLD position, facing
   * yaw, within range metres and arc radians) falls down, lies a few seconds, gets up and walks on. Returns where the person
   * fell (WORLD metres), or null when nobody was in reach. The open world announces it as CITIZEN_HIT (a crime, a score).
   */
  hit(origin: THREE.Vector3, yaw: number, range?: number, arc?: number): THREE.Vector3 | null;
  dispose(): void;
}

/** How long a punched person lies on the ground, in seconds. */
export const DOWN_SECONDS = 4;

/** How fast people cross a road, at least (m/s). */
export const CROSS_SPEED = 1.4;

function rngOf(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 11;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pavement loop around block (i, j): its four corners and length. PURE. */
export function pavementLoop(plan: CityPlan, i: number, j: number) {
  const inset = plan.sidewalk / 2;
  const x0 = plan.streetsX[i] + plan.road / 2 + inset, x1 = plan.streetsX[i + 1] - plan.road / 2 - inset;
  const z0 = plan.streetsZ[j] + plan.road / 2 + inset, z1 = plan.streetsZ[j + 1] - plan.road / 2 - inset;
  const w = x1 - x0, h = z1 - z0;
  return { x0, x1, z0, z1, w, h, length: 2 * (w + h) };
}

/** The point s metres along a block's pavement loop (corners at 0, w, w+h, 2w+h). PURE. */
export function pointOnLoop(plan: CityPlan, i: number, j: number, s: number): { x: number; z: number } {
  const L = pavementLoop(plan, i, j);
  let t = ((s % L.length) + L.length) % L.length;
  if (t < L.w) return { x: L.x0 + t, z: L.z0 };
  t -= L.w;
  if (t < L.h) return { x: L.x1, z: L.z0 + t };
  t -= L.h;
  if (t < L.w) return { x: L.x1 - t, z: L.z1 };
  t -= L.w;
  return { x: L.x0, z: L.z1 - t };
}

/** The loop position nearest a point on that block's pavement line. PURE. */
export function loopPosition(plan: CityPlan, i: number, j: number, x: number, z: number): number {
  const L = pavementLoop(plan, i, j);
  const cx = Math.min(L.x1, Math.max(L.x0, x)), cz = Math.min(L.z1, Math.max(L.z0, z));
  const d = [Math.abs(cz - L.z0), Math.abs(cx - L.x1), Math.abs(cz - L.z1), Math.abs(cx - L.x0)];
  const k = d.indexOf(Math.min(...d));
  if (k === 0) return cx - L.x0;
  if (k === 1) return L.w + (cz - L.z0);
  if (k === 2) return L.w + L.h + (L.x1 - cx);
  return 2 * L.w + L.h + (L.z1 - cz);
}

/**
 * The zebra crossings reachable from a block corner (sx, sz = ±1, the corner's side): over the street beside it, to the
 * next block. A walker walks along the pavement to the zebra, then straight across it. PURE.
 */
export function crossingsAt(plan: CityPlan, i: number, j: number, sx: 1 | -1, sz: 1 | -1): Crossing[] {
  const ni = i + (sx > 0 ? 1 : 0), nj = j + (sz > 0 ? 1 : 0);
  const X = plan.streetsX[ni], Z = plan.streetsZ[nj];
  const c = plan.road / 2 + CITY_ZEBRA.gap + CITY_ZEBRA.depth / 2;
  // Kerb to kerb: the crossing is only the road (plus a step either side), so it fits inside one red light.
  const edge = plan.road / 2 + 0.2;
  const out: Crossing[] = [];
  // Over the street running along z (cars travel along z) to the block beside.
  if (i + sx >= 0 && i + sx < plan.blocksX) {
    const zc = Z - sz * c;
    out.push({ ax: X - sx * edge, az: zc, bx: X + sx * edge, bz: zc, node: [ni, nj], axis: 'z', to: [i + sx, j] });
  }
  // Over the street running along x (cars travel along x) to the block above or below.
  if (j + sz >= 0 && j + sz < plan.blocksZ) {
    const xc = X - sx * c;
    out.push({ ax: xc, az: Z - sz * edge, bx: xc, bz: Z + sz * edge, node: [ni, nj], axis: 'x', to: [i, j + sz] });
  }
  return out;
}

/** Walk people around a city's pavements and across its zebra crossings. */
export function createCityPeople(city: City, options: CityPeopleOptions = {}): CityPeople {
  const plan = city.plan;
  const rand = rngOf(options.seed ?? plan.seed + 303);
  const light = (options.tier === 'light' || options.tier === 'full' ? options.tier : geometryTier()) === 'light';
  const count = Math.max(1, Math.min(light ? LIGHT_PEOPLE : 150, Math.round(options.count ?? 30)));
  const baseSpeed = Math.max(0.3, options.speed ?? 1.3);
  const crossChance = Math.min(1, Math.max(0, options.crossChance ?? 0.35));
  const traffic = options.traffic ?? null;
  const pave = CITY_ROAD_Y + CITY_KERB;
  const root = new THREE.Group();
  root.name = 'City people';
  // 🧍 A PERSON, NOT A CYLINDER WITH A BALL (admin 2026-11-25, open-world problem #7: "villeges human jaise nahi … gol cylinder
  // ke upar ek ball"). A low-poly person in three instanced parts — shirt (torso and arms), trousers (two legs), skin (neck,
  // head and hands) — each part one draw call for the whole crowd, so a city full of people costs what the old shapes did.
  const part = (w: number, h: number, d: number, x: number, y: number, z = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  /** One geometry from its pieces; the pieces are freed at once. */
  const merged = (list: THREE.BufferGeometry[]) => { const g = mergeGeometries(list); for (const x of list) x.dispose(); return g; };
  const bodyGeo = merged([
    part(0.4, 0.56, 0.22, 0, 1.12),                                       // torso, shoulders at 1.4 m
    part(0.1, 0.52, 0.11, -0.26, 1.12), part(0.1, 0.52, 0.11, 0.26, 1.12), // arms
  ]);
  const legGeo = merged([
    part(0.15, 0.8, 0.17, -0.1, 0.44), part(0.15, 0.8, 0.17, 0.1, 0.44),  // legs, feet at the pavement
    part(0.16, 0.06, 0.24, -0.1, 0.03, 0.03), part(0.16, 0.06, 0.24, 0.1, 0.03, 0.03), // shoes
  ]);
  const head = light ? new THREE.SphereGeometry(0.12, 6, 4) : new THREE.SphereGeometry(0.12, 10, 8);
  head.translate(0, 1.6, 0);
  const headGeo = merged([head, part(0.09, 0.08, 0.09, 0, 1.44), part(0.08, 0.1, 0.09, -0.26, 0.81), part(0.08, 0.1, 0.09, 0.26, 0.81)]);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
  const legs = new THREE.InstancedMesh(legGeo, legMat, count);
  const heads = new THREE.InstancedMesh(headGeo, headMat, count);
  bodies.name = 'people'; legs.name = 'people legs'; heads.name = 'people heads';
  const shirts = [0xd62828, 0x1d4ed8, 0xf59e0b, 0x15803d, 0x7c3aed, 0xf3f4f6, 0x0f766e, 0xbe185d, 0x374151];
  const skins = [0x8d5524, 0xc68642, 0xe0ac69, 0x6b3e26, 0xf1c27d];
  const trousers = [0x1f2937, 0x334155, 0x1e3a8a, 0x78350f, 0x111827, 0x57534e, 0xf5f5f4];
  const colour = new THREE.Color();
  const walkers: Walker[] = [];
  for (let k = 0; k < count; k++) {
    const block: [number, number] = [Math.floor(rand() * plan.blocksX), Math.floor(rand() * plan.blocksZ)];
    const L = pavementLoop(plan, block[0], block[1]);
    const s = rand() * L.length;
    const p = pointOnLoop(plan, block[0], block[1], s);
    walkers.push({ block, s, dir: rand() < 0.5 ? 1 : -1, speed: baseSpeed * (0.8 + rand() * 0.4), state: 'walk', x: p.x, z: p.z, heading: 0, crossing: null, waited: 0, body: new THREE.Object3D() });
    bodies.setColorAt(k, colour.setHex(shirts[Math.floor(rand() * shirts.length)]));
    heads.setColorAt(k, colour.setHex(skins[Math.floor(rand() * skins.length)]));
    // From the index, never from rand(): the look must not change the crowd's walks (the same seed, the same crossings).
    legs.setColorAt(k, colour.setHex(trousers[(k * 5 + 2) % trousers.length]));
  }
  root.add(bodies, legs, heads);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
  const lying = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const tmp = new THREE.Vector3();
  let clock = 0;

  const draw = () => {
    walkers.forEach((w, k) => {
      const moving = w.state === 'walk' || w.state === 'toCrossing' || w.state === 'cross' || w.state === 'leave';
      const bob = moving ? Math.abs(Math.sin(clock * 7 + k)) * 0.04 : 0;
      const y = (w.state === 'cross' || (w.state === 'down' && w.crossing) ? CITY_ROAD_Y : pave) + bob;
      q.setFromAxisAngle(up, w.heading);
      if (w.state === 'down') q.multiply(lying);                       // flat on the ground, head where it fell
      m.compose(at.set(w.x, y, w.z), q, one);
      bodies.setMatrixAt(k, m); legs.setMatrixAt(k, m); heads.setMatrixAt(k, m);
      w.body.position.set(w.x, y, w.z);
    });
    bodies.instanceMatrix.needsUpdate = true; legs.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (legs.instanceColor) legs.instanceColor.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  };

  // Safe to cross: the cars on that street have red for the WHOLE time it takes to cross (every half second of it, not
  // only now and at the far kerb — a light can be red at both and green in between), and no car is near.
  const safe = (c: Crossing, crossTime: number): boolean => {
    if (traffic) {
      for (let t = 0; t <= crossTime + 1; t += 0.5) if (traffic.lightAt(c.node[0], c.node[1], c.axis, t) !== 'red') return false;
      const mx = (c.ax + c.bx) / 2, mz = (c.az + c.bz) / 2;
      const p = new THREE.Vector3();
      // 🚌 The whole BODY, not its centre (Q-3547: a 10 m bus pulled out of the junction and stopped across the zebra; judged
      // by its centre it was "far", and the person walked through it).
      for (const car of traffic.cars) {
        inCity(car.object, p);
        if (Math.hypot(p.x - mx, p.z - mz) - (car.length ?? 4.5) / 2 < plan.road / 2 + 4) return false;
      }
    }
    return true;
  };
  // In THIS crowd's frame (the city's), never raw world space — see citytraffic.ts inCity: on the open-world map a city stands
  // anywhere, and a world-space check never matched, so people walked through the player and stepped in front of cars.
  const toCity = new THREE.Matrix4();
  const inCity = (o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 => { o.getWorldPosition(out); return out.applyMatrix4(toCity); };
  const blocked = (w: Walker, avoid: THREE.Object3D[], fx: number, fz: number): boolean => {
    const p = new THREE.Vector3();
    for (const a of avoid) {
      inCity(a, p);
      const ahead = (p.x - w.x) * fx + (p.z - w.z) * fz;
      const side = Math.abs((p.x - w.x) * fz - (p.z - w.z) * fx);
      if (ahead > 0 && ahead < 1.2 && side < 0.6) return true;
    }
    return false;
  };
  /** A vehicle's body (its length along its heading, 2.4 m wide with a margin) is where a crossing person must not step. */
  const inACar = (x: number, z: number): boolean => {
    if (!traffic) return false;
    const p = new THREE.Vector3();
    for (const car of traffic.cars) {
      inCity(car.object, p);
      const h = car.object.rotation.y, fx = Math.sin(h), fz = Math.cos(h);
      const along = (x - p.x) * fx + (z - p.z) * fz, side = (x - p.x) * fz - (z - p.z) * fx;
      if (Math.abs(along) < (car.length ?? 4.5) / 2 + 0.4 && Math.abs(side) < 1.2) return true;
    }
    return false;
  };
  const moveToward = (w: Walker, tx: number, tz: number, step: number): boolean => {
    const dx = tx - w.x, dz = tz - w.z, d = Math.hypot(dx, dz);
    if (d > 1e-6) w.heading = Math.atan2(dx, dz);
    if (d <= step) { w.x = tx; w.z = tz; return true; }
    w.x += (dx / d) * step; w.z += (dz / d) * step;
    return false;
  };

  draw();
  return {
    root, walkers, bodies: walkers.map((w) => w.body),
    update: (dt, avoid = []) => {
      root.updateWorldMatrix(true, false); toCity.copy(root.matrixWorld).invert();   // the crowd's frame, once per step
      if (!(dt > 0)) return;
      clock += dt;
      for (const w of walkers) {
        const step = w.speed * dt;
        if (w.state === 'down') {
          w.downFor = (w.downFor ?? 0) - dt;
          // Up again: back to the pavement it was on (a person knocked down mid-crossing finishes crossing first).
          if (w.downFor <= 0) { w.downFor = 0; w.state = w.crossing ? 'cross' : 'leave'; if (!w.crossing) w.s = loopPosition(plan, w.block[0], w.block[1], w.x, w.z); }
          continue;
        }
        if (w.state === 'walk') {
          const L = pavementLoop(plan, w.block[0], w.block[1]);
          const next = pointOnLoop(plan, w.block[0], w.block[1], w.s + w.dir * Math.min(step, 0.5));
          const fx = next.x - w.x, fz = next.z - w.z, fl = Math.hypot(fx, fz) || 1;
          if (blocked(w, avoid, fx / fl, fz / fl)) continue;
          const before = w.s;
          w.s += w.dir * step;
          // Reaching a corner: sometimes cross to the next block on its zebra.
          const corners = [0, L.w, L.w + L.h, 2 * L.w + L.h];
          const a = Math.min(before, w.s), b = Math.max(before, w.s);
          for (const cs of corners) {
            const hit = [cs, cs + L.length, cs - L.length].some((v) => v > a && v <= b);
            if (!hit || rand() >= crossChance) continue;
            const cp = pointOnLoop(plan, w.block[0], w.block[1], cs);
            const sx: 1 | -1 = cp.x > (L.x0 + L.x1) / 2 ? 1 : -1, sz: 1 | -1 = cp.z > (L.z0 + L.z1) / 2 ? 1 : -1;
            const options2 = crossingsAt(plan, w.block[0], w.block[1], sx, sz);
            if (!options2.length) continue;
            w.crossing = options2[Math.floor(rand() * options2.length)];
            w.s = cs; w.x = cp.x; w.z = cp.z; w.state = 'toCrossing'; w.waited = 0;
            break;
          }
          if (w.state === 'walk') { const p = pointOnLoop(plan, w.block[0], w.block[1], w.s); w.heading = Math.atan2(p.x - w.x, p.z - w.z) || w.heading; w.x = p.x; w.z = p.z; }
        } else if (w.state === 'toCrossing' && w.crossing) {
          if (moveToward(w, w.crossing.ax, w.crossing.az, step)) w.state = 'wait';
        } else if (w.state === 'wait' && w.crossing) {
          const c = w.crossing;
          w.waited += dt;
          w.heading = Math.atan2(c.bx - c.ax, c.bz - c.az);
          const crossTime = Math.hypot(c.bx - c.ax, c.bz - c.az) / Math.max(w.speed, CROSS_SPEED);
          if (safe(c, crossTime)) { w.state = 'cross'; continue; }
          if (w.waited > 30) {                       // a long wait: walk on round the block instead
            w.state = 'walk'; w.crossing = null; w.dir = (w.dir * -1) as 1 | -1;
            w.s = loopPosition(plan, w.block[0], w.block[1], w.x, w.z);
          }
        } else if (w.state === 'cross' && w.crossing) {
          const c = w.crossing;
          const fx = c.bx - c.ax, fz = c.bz - c.az, fl = Math.hypot(fx, fz) || 1;
          if (blocked(w, avoid, fx / fl, fz / fl)) continue;
          // Never into a vehicle on the zebra: wait at the edge of its body until it has gone (Q-3547).
          const stride = Math.max(w.speed, CROSS_SPEED) * dt + 0.3;
          if (inACar(w.x + (fx / fl) * stride, w.z + (fz / fl) * stride)) continue;
          // People cross briskly (at least CROSS_SPEED), as they do on a real zebra.
          if (moveToward(w, c.bx, c.bz, Math.max(w.speed, CROSS_SPEED) * dt)) {
            w.block = c.to; w.state = 'leave';
            w.s = loopPosition(plan, w.block[0], w.block[1], w.x, w.z);
          }
        } else if (w.state === 'leave') {
          // Off the kerb and back onto the pavement's walking line, then on round the new block.
          const p = pointOnLoop(plan, w.block[0], w.block[1], w.s);
          if (moveToward(w, p.x, p.z, step)) { w.state = 'walk'; w.crossing = null; w.dir = rand() < 0.5 ? 1 : -1; }
        }
      }
      draw();
    },
    pushOut: (object, radius = 0.4) => {
      if (!object.parent) return false;
      root.updateWorldMatrix(true, false); toCity.copy(root.matrixWorld).invert();
      inCity(object, tmp);
      let pushed = false;
      for (const w of walkers) {
        if (w.state === 'down') continue;                               // a person on the ground is stepped over
        const dx = tmp.x - w.x, dz = tmp.z - w.z, d = Math.hypot(dx, dz), min = radius + 0.25;
        if (d >= min - 1e-4) continue;                                 // already outside (a hair's tolerance, so a push settles)
        const ux = d > 1e-6 ? dx / d : Math.sin(w.heading + Math.PI / 2), uz = d > 1e-6 ? dz / d : Math.cos(w.heading + Math.PI / 2);
        tmp.x = w.x + ux * min; tmp.z = w.z + uz * min;
        pushed = true;
      }
      if (pushed) { root.localToWorld(tmp); object.parent.worldToLocal(tmp); object.position.x = tmp.x; object.position.z = tmp.z; }
      return pushed;
    },
    hit: (origin, yaw, range = 1.6, arc = Math.PI * 0.6) => {
      root.updateWorldMatrix(true, false); toCity.copy(root.matrixWorld).invert();
      const o = tmp.copy(origin).applyMatrix4(toCity);
      // The facing, turned into the crowd's frame too (a city can stand rotated on the map).
      const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).transformDirection(toCity);
      let best: Walker | null = null, bestD = Infinity;
      for (const w of walkers) {
        if (w.state === 'down') continue;
        const dx = w.x - o.x, dz = w.z - o.z, d = Math.hypot(dx, dz);
        if (d > range || d >= bestD) continue;
        if (d > 0.05 && Math.acos(Math.max(-1, Math.min(1, (dx * f.x + dz * f.z) / d))) > arc / 2) continue;
        best = w; bestD = d;
      }
      if (!best) return null;
      if (best.state !== 'cross') best.crossing = null;                 // only a person already crossing finishes crossing
      best.state = 'down'; best.downFor = DOWN_SECONDS;
      best.heading = Math.atan2(best.x - o.x, best.z - o.z);           // falls away from the punch
      draw();
      return root.localToWorld(new THREE.Vector3(best.x, pave, best.z));
    },
    dispose: () => {
      root.removeFromParent();
      bodyGeo.dispose(); legGeo.dispose(); headGeo.dispose(); bodyMat.dispose(); legMat.dispose(); headMat.dispose();
      bodies.dispose(); legs.dispose(); heads.dispose();
    },
  };
}
`;
