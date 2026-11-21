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

/** What the walkers need from city traffic (createCityTraffic returns it): the lights and where the cars are. */
export interface TrafficLike {
  lightAt(i: number, j: number, axis: 'x' | 'z', ahead?: number): string;
  cars: Array<{ object: THREE.Object3D }>;
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
}

export type WalkerState = 'walk' | 'toCrossing' | 'wait' | 'cross' | 'leave';

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
  /** A stand-in body at the walker's feet — pass these to traffic.update so cars stop for people. */
  body: THREE.Object3D;
}

export interface CityPeople {
  root: THREE.Group;
  walkers: Walker[];
  bodies: THREE.Object3D[];
  /** Advance. avoid: what people must not walk into (the player). */
  update(dt: number, avoid?: THREE.Object3D[]): void;
  dispose(): void;
}

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
  const count = Math.max(1, Math.min(150, Math.round(options.count ?? 30)));
  const baseSpeed = Math.max(0.3, options.speed ?? 1.3);
  const crossChance = Math.min(1, Math.max(0, options.crossChance ?? 0.35));
  const traffic = options.traffic ?? null;
  const pave = CITY_ROAD_Y + CITY_KERB;
  const root = new THREE.Group();
  root.name = 'City people';
  const bodyGeo = new THREE.CylinderGeometry(0.2, 0.24, 1.15, 8);
  bodyGeo.translate(0, 0.78, 0);
  const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
  headGeo.translate(0, 1.55, 0);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
  const heads = new THREE.InstancedMesh(headGeo, headMat, count);
  bodies.name = 'people'; heads.name = 'people heads';
  const shirts = [0xd62828, 0x1d4ed8, 0xf59e0b, 0x15803d, 0x7c3aed, 0xf3f4f6, 0x0f766e, 0xbe185d, 0x374151];
  const skins = [0x8d5524, 0xc68642, 0xe0ac69, 0x6b3e26, 0xf1c27d];
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
  }
  root.add(bodies, heads);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
  let clock = 0;

  const draw = () => {
    walkers.forEach((w, k) => {
      const moving = w.state === 'walk' || w.state === 'toCrossing' || w.state === 'cross' || w.state === 'leave';
      const bob = moving ? Math.abs(Math.sin(clock * 7 + k)) * 0.04 : 0;
      const y = (w.state === 'cross' ? CITY_ROAD_Y : pave) + bob;
      q.setFromAxisAngle(up, w.heading);
      m.compose(at.set(w.x, y, w.z), q, one);
      bodies.setMatrixAt(k, m); heads.setMatrixAt(k, m);
      w.body.position.set(w.x, y, w.z);
    });
    bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  };

  // Safe to cross: the cars on that street have red for the WHOLE time it takes to cross (every half second of it, not
  // only now and at the far kerb — a light can be red at both and green in between), and no car is near.
  const safe = (c: Crossing, crossTime: number): boolean => {
    if (traffic) {
      for (let t = 0; t <= crossTime + 1; t += 0.5) if (traffic.lightAt(c.node[0], c.node[1], c.axis, t) !== 'red') return false;
      const mx = (c.ax + c.bx) / 2, mz = (c.az + c.bz) / 2;
      const p = new THREE.Vector3();
      for (const car of traffic.cars) {
        car.object.getWorldPosition(p);
        if (Math.hypot(p.x - mx, p.z - mz) < plan.road / 2 + 4) return false;
      }
    }
    return true;
  };
  const blocked = (w: Walker, avoid: THREE.Object3D[], fx: number, fz: number): boolean => {
    const p = new THREE.Vector3();
    for (const a of avoid) {
      a.getWorldPosition(p);
      const ahead = (p.x - w.x) * fx + (p.z - w.z) * fz;
      const side = Math.abs((p.x - w.x) * fz - (p.z - w.z) * fx);
      if (ahead > 0 && ahead < 1.2 && side < 0.6) return true;
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
      if (!(dt > 0)) return;
      clock += dt;
      for (const w of walkers) {
        const step = w.speed * dt;
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
    dispose: () => {
      root.removeFromParent();
      bodyGeo.dispose(); headGeo.dispose(); bodyMat.dispose(); headMat.dispose();
      bodies.dispose(); heads.dispose();
    },
  };
}
`;
