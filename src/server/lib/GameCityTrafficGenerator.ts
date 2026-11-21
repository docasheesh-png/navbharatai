/**
 * CITY TRAFFIC (admin 2026-11-20 engine plan, item 4: a living city). The city blocks (city.ts) gave a 3D game streets,
 * crossings and buildings — and nothing moved on them: createTraffic() drives one straight road, never a grid. This
 * module drives the kit's own vehicles (cars, autos, buses) around the city's street grid:
 *   - in the LEFT lane (India), turning at crossings (never a U-turn unless the street ends);
 *   - stopping at red at the crossing's stop line — every crossing has lights, one street green at a time, with amber;
 *   - keeping a safe gap to the vehicle ahead in its lane, and stopping for the player (or anything passed as avoid);
 *   - deterministic per seed.
 * PURE where it can be: planTrafficStep() is the rule, without three.js.
 *
 * String.raw: no backticks and no dollar-brace sequences inside the module text.
 */
export const GAME_CITY_TRAFFIC = String.raw`import * as THREE from 'three';
import { CITY_ROAD_Y, CITY_ZEBRA, type City, type CityPlan } from './city';
import { createAutoRickshaw, createBus, createCar } from './objects';

export type CityTrafficKind = 'car' | 'auto' | 'bus';
export type LightColour = 'green' | 'amber' | 'red';

export interface CityTrafficOptions {
  /** Vehicles on the streets (1 to 60, default 12). */
  count?: number;
  kinds?: CityTrafficKind[];
  /** Cruising speed, m/s (default 9 ≈ 32 km/h — a city, not a highway). */
  speed?: number;
  /** Seconds each street stays green (default 8); amber lasts 2 s. */
  greenSeconds?: number;
  /** false: no traffic lights (vehicles still keep their gap and stop for the player). */
  lights?: boolean;
  seed?: number;
}

/** A vehicle on its way from one crossing (grid node) to the next. */
export interface TrafficCar {
  object: THREE.Object3D;
  kind: CityTrafficKind;
  from: [number, number];
  to: [number, number];
  /** The crossing after 'to' — chosen in advance, so the car knows the street it is about to turn into has room. */
  next: [number, number];
  /** Metres travelled from the centre of 'from' toward 'to'. */
  along: number;
  speed: number;
  cruise: number;
  length: number;
}

export interface CityTraffic {
  root: THREE.Group;
  cars: TrafficCar[];
  /** The light a vehicle travelling along this axis sees at crossing (i, j) — now, or ahead seconds from now. */
  lightAt(i: number, j: number, axis: 'x' | 'z', ahead?: number): LightColour;
  /** Advance. avoid: objects no vehicle may drive into (the player, the player's car). */
  update(dt: number, avoid?: THREE.Object3D[]): void;
  dispose(): void;
}

const AMBER = 2;
function rngOf(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 7;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The light for an axis at a crossing at time t. Neighbouring crossings are offset, so the city is not one blink. PURE. */
export function trafficLight(i: number, j: number, axis: 'x' | 'z', t: number, greenSeconds = 8): LightColour {
  const g = Math.max(1, greenSeconds);
  const cycle = 2 * (g + AMBER);
  const phase = (((t + (i + j) * 2.5) % cycle) + cycle) % cycle;
  const zGreen = phase < g, zAmber = phase >= g && phase < g + AMBER;
  const xGreen = phase >= g + AMBER && phase < 2 * g + AMBER, xAmber = phase >= 2 * g + AMBER;
  if (axis === 'z') return zGreen ? 'green' : zAmber ? 'amber' : 'red';
  return xGreen ? 'green' : xAmber ? 'amber' : 'red';
}

/** Crossings a vehicle at node may go on to (grid neighbours), never back the way it came unless it must. PURE. */
export function nextCrossings(plan: CityPlan, node: [number, number], came: [number, number]): Array<[number, number]> {
  const [i, j] = node;
  const all: Array<[number, number]> = ([[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as Array<[number, number]>)
    .filter(([a, b]) => a >= 0 && b >= 0 && a <= plan.blocksX && b <= plan.blocksZ);
  const forward = all.filter(([a, b]) => a !== came[0] || b !== came[1]);
  return forward.length ? forward : all;
}

/** Where a vehicle is: on the street from 'from' to 'to', in the LEFT lane, and the way it faces. PURE. */
export function trafficPose(plan: CityPlan, from: [number, number], to: [number, number], along: number): { x: number; z: number; heading: number } {
  const ax = plan.streetsX[from[0]], az = plan.streetsZ[from[1]];
  const bx = plan.streetsX[to[0]], bz = plan.streetsZ[to[1]];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  // Facing (dx, dz) the driver's left is (dz, -dx): +Z forward has +X on the left.
  const off = plan.road / 4;
  return { x: ax + dx * along + dz * off, z: az + dz * along - dx * off, heading: Math.atan2(dx, dz) };
}

/** Distance from a crossing's centre back to the stop line: past the crossing, the zebra and a metre more. PURE. */
export function stopBack(plan: CityPlan): number {
  return plan.road / 2 + CITY_ZEBRA.gap + CITY_ZEBRA.depth + 1;
}

/** Length of the street between two neighbouring crossings. PURE. */
export function edgeLength(plan: CityPlan, from: [number, number], to: [number, number]): number {
  return Math.hypot(plan.streetsX[to[0]] - plan.streetsX[from[0]], plan.streetsZ[to[1]] - plan.streetsZ[from[1]]);
}

/** Drive the kit's vehicles around a city's street grid. */
export function createCityTraffic(city: City, options: CityTrafficOptions = {}): CityTraffic {
  const plan = city.plan;
  const rand = rngOf(options.seed ?? plan.seed + 101);
  const count = Math.max(1, Math.min(60, Math.round(options.count ?? 12)));
  const kinds: CityTrafficKind[] = options.kinds && options.kinds.length ? options.kinds : ['car', 'car', 'auto', 'car', 'bus', 'auto'];
  const cruiseBase = Math.max(2, options.speed ?? 9);
  const green = Math.max(1, options.greenSeconds ?? 8);
  const useLights = options.lights !== false;
  const root = new THREE.Group();
  root.name = 'City traffic';
  const paints = [0xb42b2b, 0x1d4ed8, 0xf3f4f6, 0x111827, 0x9ca3af, 0x0f766e, 0xf59e0b];
  const build = (k: CityTrafficKind): THREE.Group => {
    if (k === 'auto') return createAutoRickshaw({ detail: 'lite' });
    if (k === 'bus') return createBus({ detail: 'lite' });
    return createCar({ detail: 'lite', color: paints[Math.floor(rand() * paints.length)] });
  };
  const lengthOf: Record<CityTrafficKind, number> = { car: 4.4, auto: 3, bus: 10 };
  const cars: TrafficCar[] = [];
  // Spread the vehicles over distinct streets so none starts inside another.
  const used = new Set<string>();
  for (let n = 0; n < count; n++) {
    let from: [number, number] = [0, 0], to: [number, number] = [1, 0], tries = 0;
    do {
      from = [Math.floor(rand() * (plan.blocksX + 1)), Math.floor(rand() * (plan.blocksZ + 1))];
      const options2 = nextCrossings(plan, from, [-1, -1]);
      to = options2[Math.floor(rand() * options2.length)];
      tries++;
    } while (used.has(from.join(',') + '>' + to.join(',')) && tries < 50);
    used.add(from.join(',') + '>' + to.join(','));
    const kind = kinds[n % kinds.length];
    const object = build(kind);
    const cruise = cruiseBase * (kind === 'bus' ? 0.8 : kind === 'auto' ? 0.85 : 1) * (0.9 + rand() * 0.2);
    const len = edgeLength(plan, from, to);
    const after = nextCrossings(plan, to, from);
    cars.push({ object, kind, from, to, next: after[Math.floor(rand() * after.length)], along: plan.road / 2 + 2 + rand() * Math.max(0, len - plan.road - 6), speed: cruise, cruise, length: lengthOf[kind] });
    root.add(object);
  }

  // Lights: one lamp per approach axis at each crossing, as two instanced meshes (two draw calls for the whole city).
  const nodes: Array<[number, number]> = [];
  for (let i = 0; i <= plan.blocksX; i++) for (let j = 0; j <= plan.blocksZ; j++) nodes.push([i, j]);
  const lampGeo = new THREE.SphereGeometry(0.28, 10, 8);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const poleGeo = new THREE.BoxGeometry(0.14, 4, 0.14);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.7 });
  const lampsZ = new THREE.InstancedMesh(lampGeo, lampMat, nodes.length);
  const lampsX = new THREE.InstancedMesh(lampGeo, lampMat, nodes.length);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, nodes.length);
  const m = new THREE.Matrix4();
  const half = plan.road / 2 + 0.8;
  nodes.forEach(([i, j], k) => {
    const x = plan.streetsX[i], z = plan.streetsZ[j];
    poles.setMatrixAt(k, m.makeTranslation(x - half, CITY_ROAD_Y + 2, z - half));
    lampsZ.setMatrixAt(k, m.makeTranslation(x - half, CITY_ROAD_Y + 4.1, z - half + 0.3));
    lampsX.setMatrixAt(k, m.makeTranslation(x - half + 0.3, CITY_ROAD_Y + 3.5, z - half));
  });
  if (useLights) root.add(poles, lampsZ, lampsX);
  const COLOUR: Record<LightColour, THREE.Color> = { green: new THREE.Color(0x22c55e), amber: new THREE.Color(0xf59e0b), red: new THREE.Color(0xef4444) };
  let clock = 0;
  const paintLights = () => {
    nodes.forEach(([i, j], k) => {
      lampsZ.setColorAt(k, COLOUR[trafficLight(i, j, 'z', clock, green)]);
      lampsX.setColorAt(k, COLOUR[trafficLight(i, j, 'x', clock, green)]);
    });
    if (lampsZ.instanceColor) lampsZ.instanceColor.needsUpdate = true;
    if (lampsX.instanceColor) lampsX.instanceColor.needsUpdate = true;
  };
  const lightAt = (i: number, j: number, axis: 'x' | 'z', ahead = 0): LightColour => (useLights ? trafficLight(i, j, axis, clock + Math.max(0, ahead), green) : 'green');

  const place = (c: TrafficCar) => {
    const p = trafficPose(plan, c.from, c.to, c.along);
    c.object.position.set(p.x, CITY_ROAD_Y, p.z);
    c.object.rotation.y = p.heading;
  };
  cars.forEach(place);
  if (useLights) paintLights();

  const sameLane = (a: TrafficCar, b: TrafficCar) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
  const GAP = 3;
  const key = (n: [number, number]) => n[0] + ',' + n[1];
  // ONE VEHICLE IN A CROSSING AT A TIME: whoever holds a crossing has passed its stop line and is not yet clear of the
  // crossing on the far side. Without it, two vehicles turning in from opposite sides met inside the crossing, and a
  // vehicle turned onto a street right on top of the one that had just entered it (measured: 52 times in two minutes).
  const holder = new Map<string, TrafficCar>();
  const roomOnNext = (c: TrafficCar): number => {
    let room = Infinity;
    for (const o of cars) {
      if (o === c || key(o.from) !== key(c.to) || key(o.to) !== key(c.next)) continue;
      room = Math.min(room, o.along - o.length / 2);
    }
    return room;
  };
  const tmp = new THREE.Vector3();

  return {
    root, cars, lightAt,
    update: (dt, avoid = []) => {
      if (!(dt > 0)) return;
      clock += dt;
      if (useLights) paintLights();
      for (const c of cars) {
        const len = edgeLength(plan, c.from, c.to);
        // The stop line, 1 m BEHIND the zebra crossing (2026-11-21: it used to sit 1 m past the crossing's edge, which put
        // a waiting car's bumper on the zebra stripes). A vehicle that has not reached it holds there on amber or red.
        const stopAt = len - stopBack(plan) - c.length / 2;
        const axis: 'x' | 'z' = c.from[0] !== c.to[0] ? 'x' : 'z';
        let limit = Infinity;
        if (c.along <= stopAt + 0.01) {
          const owner = holder.get(key(c.to));
          const clear = lightAt(c.to[0], c.to[1], axis) === 'green' && (!owner || owner === c)
            && roomOnNext(c) >= plan.road / 2 + c.length + GAP;
          if (!clear) limit = stopAt - c.along;
        }
        // Keep the gap to the vehicle ahead in the same lane.
        for (const o of cars) {
          if (o === c || !sameLane(o, c) || o.along <= c.along) continue;
          limit = Math.min(limit, o.along - c.along - (o.length + c.length) / 2 - GAP);
        }
        // Never drive into the player (or anything passed as avoid) ahead in this lane.
        const p = trafficPose(plan, c.from, c.to, c.along);
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        for (const a of avoid) {
          a.getWorldPosition(tmp);
          const ahead = (tmp.x - p.x) * fx + (tmp.z - p.z) * fz;
          const side = Math.abs((tmp.x - p.x) * fz - (tmp.z - p.z) * fx);
          if (ahead > 0 && ahead < 12 && side < 1.8) limit = Math.min(limit, ahead - c.length / 2 - 2);
        }
        // Speed: brake to stop within the room left, otherwise ease up to cruise.
        const room = Math.max(0, limit);
        const safe = Math.sqrt(2 * 6 * room);
        const target = Math.min(c.cruise, safe);
        c.speed += Math.max(-8 * dt, Math.min(3 * dt, target - c.speed));
        c.speed = Math.max(0, Math.min(c.speed, room / dt));
        const wasBefore = c.along <= stopAt + 0.01;
        c.along += c.speed * dt;
        if (wasBefore && c.along > stopAt + 0.01) holder.set(key(c.to), c);   // into the crossing: it is ours
        // Through the crossing: on to the street chosen in advance, and choose the one after it.
        while (c.along >= len) {
          c.along -= len;
          c.from = c.to; c.to = c.next;
          const choices = nextCrossings(plan, c.to, c.from);
          c.next = choices[Math.floor(rand() * choices.length)];
        }
        // Clear of the crossing behind it: let it go.
        const behind = key(c.from);
        if (holder.get(behind) === c && c.along > plan.road / 2 + c.length / 2) holder.delete(behind);
        place(c);
      }
    },
    dispose: () => {
      root.removeFromParent();
      lampGeo.dispose(); lampMat.dispose(); poleGeo.dispose(); poleMat.dispose();
      lampsZ.dispose(); lampsX.dispose(); poles.dispose();
      // The vehicles' own geometry is NOT freed here: the kit shares parts (wheels, shells) between every vehicle,
      // the player's car included, so disposing them would break cars that are still on screen.
    },
  };
}
`;
