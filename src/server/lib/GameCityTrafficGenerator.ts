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
import { geometryTier, type GeometryTier } from './surfaces';

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
  /**
   * 'light' (queue Q-2698: a device with no GPU or a weak phone): each vehicle is drawn as ONE mesh (a car was 17 draw calls,
   * a bus 22) and at most LIGHT_TRAFFIC vehicles drive. 'full': every part its own mesh, up to 60. Left out: geometryTier().
   */
  tier?: GeometryTier;
}

/** The most vehicles a light-tier city drives, whatever count asked (a full-tier city keeps up to 60). */
export const LIGHT_TRAFFIC = 6;

/**
 * One mesh for a whole model (the light tier): every part's triangles, moved into the model's own frame and coloured with
 * its material's colour, in one geometry with one vertex-coloured material. The model's shared part geometry is left
 * untouched (other vehicles use it); the merged geometry is the caller's to dispose. Parts that are not drawn are left out.
 */
export function flattenModel(model: THREE.Object3D, material: THREE.Material): THREE.Mesh {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const c = new THREE.Color(), m = new THREE.Matrix4();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    let hidden = false;
    for (let p: THREE.Object3D | null = mesh.parent; p && p !== model; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    if (!src.getAttribute('normal')) src.computeVertexNormals();
    src.applyMatrix4(m.multiplyMatrices(toModel, mesh.matrixWorld));
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const p = src.getAttribute('position'), n = src.getAttribute('normal');
    const groups = src.groups.length && Array.isArray(mesh.material) ? src.groups : [{ start: 0, count: p.count, materialIndex: 0 }];
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0] as THREE.Material & { color?: THREE.Color };
      if (!mat || mat.visible === false) continue;
      c.set(mat.color ?? 0xffffff);
      const end = Math.min(p.count, g.start + (Number.isFinite(g.count) ? g.count : p.count));
      for (let i = g.start; i < end; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        col.push(c.r, c.g, c.b);
      }
    }
    src.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const out = new THREE.Mesh(geometry, material);
  out.name = (model.name || 'vehicle') + ' (one mesh)';
  out.castShadow = true; out.receiveShadow = true;
  return out;
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
  /** Push an object (the player, the car they drive) out of any vehicle it is inside. True when it touched one. */
  pushOut(object: THREE.Object3D, radius?: number): boolean;
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

// ---- SHARED BY EVERY TRAFFIC (the city grid below and the map's planned roads, createRoadTraffic): one rule each, never a copy ----------

const TRAFFIC_PAINTS = [0xb42b2b, 0x1d4ed8, 0xf3f4f6, 0x111827, 0x9ca3af, 0x0f766e, 0xf59e0b];
/** How long each kind of vehicle is, metres (its body along its heading). */
export const VEHICLE_LENGTH: Record<CityTrafficKind, number> = { car: 4.4, auto: 3, bus: 10 };
/** The gap a vehicle keeps to the one ahead in its lane, metres. */
export const TRAFFIC_GAP = 3;

/** The kit's vehicles for a traffic: built full, or (light tier) as one mesh each; dispose() frees only what it merged. */
export function trafficFleet(rand: () => number, light: boolean): { build(kind: CityTrafficKind): THREE.Group; dispose(): void } {
  const model = (k: CityTrafficKind): THREE.Group => {
    if (k === 'auto') return createAutoRickshaw({ detail: 'lite' });
    if (k === 'bus') return createBus({ detail: 'lite' });
    return createCar({ detail: 'lite', color: TRAFFIC_PAINTS[Math.floor(rand() * TRAFFIC_PAINTS.length)] });
  };
  // Light tier: the same model, drawn as one mesh inside a group that moves exactly as the model would have.
  const bodyMat = light ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }) : null;
  const merged: THREE.BufferGeometry[] = [];
  return {
    build: (k) => {
      const full = model(k);
      if (!bodyMat) return full;
      const one = flattenModel(full, bodyMat);
      merged.push(one.geometry);
      const g = new THREE.Group(); g.name = full.name; g.userData = { ...full.userData }; g.add(one);
      return g;
    },
    dispose: () => { for (const g of merged) g.dispose(); bodyMat?.dispose(); },
  };
}

/** A vehicle's next speed: brake to stop within the room left (limit, metres), else ease up to cruise. PURE. */
export function followSpeed(speed: number, cruise: number, limit: number, dt: number): number {
  const room = Math.max(0, limit);
  const safe = Math.sqrt(2 * 6 * room);
  const target = Math.min(cruise, safe);
  let v = speed + Math.max(-8 * dt, Math.min(3 * dt, target - speed));
  v = Math.max(0, Math.min(v, room / dt));
  return v;
}

/** The room a vehicle at (x, z) facing heading (length long) has before something at (px, pz) ahead in its lane, or Infinity. PURE. */
export function roomBefore(x: number, z: number, heading: number, length: number, px: number, pz: number): number {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const ahead = (px - x) * fx + (pz - z) * fz;
  const side = Math.abs((px - x) * fz - (pz - z) * fx);
  return ahead > 0 && ahead < 12 && side < 1.8 ? ahead - length / 2 - 2 : Infinity;
}

/**
 * Push a point (in the traffic's frame, moved in place) out of every vehicle body it is inside: a box its length along its heading,
 * 2 m wide, grown by radius. True when it touched one. PURE but for the point.
 */
export function pushOutOfVehicles(at: { x: number; z: number }, bodies: Iterable<{ x: number; z: number; heading: number; length: number }>, radius: number): boolean {
  let hit = false;
  for (const p of bodies) {
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const dx = at.x - p.x, dz = at.z - p.z;
    const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
    const hl = p.length / 2 + radius, hw = 1 + radius;
    if (Math.abs(along) >= hl || Math.abs(side) >= hw) continue;
    const outAlong = hl - Math.abs(along), outSide = hw - Math.abs(side);
    if (outAlong < outSide) { const s = Math.sign(along) || 1; at.x += fx * outAlong * s; at.z += fz * outAlong * s; }
    else { const s = Math.sign(side) || 1; at.x += fz * outSide * s; at.z -= fx * outSide * s; }
    hit = true;
  }
  return hit;
}

/** Drive the kit's vehicles around a city's street grid. */
export function createCityTraffic(city: City, options: CityTrafficOptions = {}): CityTraffic {
  const plan = city.plan;
  const rand = rngOf(options.seed ?? plan.seed + 101);
  const tier: GeometryTier = options.tier === 'light' || options.tier === 'full' ? options.tier : geometryTier();
  const light = tier === 'light';
  const count = Math.max(1, Math.min(light ? LIGHT_TRAFFIC : 60, Math.round(options.count ?? 12)));
  const kinds: CityTrafficKind[] = options.kinds && options.kinds.length ? options.kinds : ['car', 'car', 'auto', 'car', 'bus', 'auto'];
  const cruiseBase = Math.max(2, options.speed ?? 9);
  const green = Math.max(1, options.greenSeconds ?? 8);
  const useLights = options.lights !== false;
  const root = new THREE.Group();
  root.name = 'City traffic';
  const fleet = trafficFleet(rand, light);
  const build = fleet.build;
  const lengthOf = VEHICLE_LENGTH;
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
  const lampGeo = light ? new THREE.SphereGeometry(0.28, 6, 4) : new THREE.SphereGeometry(0.28, 10, 8);
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
  const GAP = TRAFFIC_GAP;
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
  /**
   * Where an object is in THIS city's own frame (the frame the plan, the lanes and every car live in). 🔴 The avoid list used
   * getWorldPosition and compared it with plan coordinates — right only for a city at the scene origin. On the open-world map
   * a city stands anywhere (and the floating origin moves), so a car never saw the player and drove straight through him
   * (admin 2026-11-22: "hero gadiyo se takrata nahi, aar paar chala jata hai").
   */
  const toCity = new THREE.Matrix4();
  /** Read the city's frame ONCE per update (a per-object updateMatrixWorld walked every car for every check). */
  const frame = (): void => { root.updateWorldMatrix(true, false); toCity.copy(root.matrixWorld).invert(); };
  const inCity = (o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 => { o.getWorldPosition(out); return out.applyMatrix4(toCity); };
  const carAt = (c: TrafficCar) => trafficPose(plan, c.from, c.to, c.along);

  return {
    root, cars, lightAt,
    pushOut: (object: THREE.Object3D, radius = 0.45): boolean => {
      // A car is a box (its length along its heading, 2 m wide). Anything inside one is pushed out the shortest way, in the
      // city's frame, and moved back to its own parent's frame — the player cannot walk or drive through a vehicle.
      if (!object.parent) return false;
      frame();
      inCity(object, tmp);
      const hit = pushOutOfVehicles(tmp, cars.map((c) => ({ ...carAt(c), length: c.length })), radius);
      if (hit) { root.localToWorld(tmp); object.parent.worldToLocal(tmp); object.position.x = tmp.x; object.position.z = tmp.z; }
      return hit;
    },

    update: (dt, avoid = []) => {
      if (!(dt > 0)) return;
      clock += dt;
      frame();
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
        for (const a of avoid) {
          inCity(a, tmp);
          limit = Math.min(limit, roomBefore(p.x, p.z, p.heading, c.length, tmp.x, tmp.z));
        }
        // Speed: brake to stop within the room left, otherwise ease up to cruise.
        c.speed = followSpeed(c.speed, c.cruise, limit, dt);
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
      fleet.dispose();
      // The vehicles' own geometry is NOT freed here: the kit shares parts (wheels, shells) between every vehicle,
      // the player's car included, so disposing them would break cars that are still on screen.
    },
  };
}

// ---- TRAFFIC ON THE MAP'S PLANNED ROADS (Q-3762) --------------------------------------------------------------------------------------
// The colonies of the big map (athree/colonies.ts) stand between the roads of its planned network, which is not a grid: a graph of
// junctions and roundabouts. This drives the SAME vehicles with the SAME rules (trafficFleet, followSpeed, roomBefore, pushOutOfVehicles,
// one vehicle in a junction at a time, the gap to the vehicle ahead) along that network's own driving routes: route() gives each one in
// the LEFT lane, round a roundabout with its island on the right, at road height. Vehicles live only near the camera (radius): one that
// falls behind is taken off and a new one starts near the camera, so a town of any size costs only the vehicles in view.

/** What createRoadTraffic needs from a road network (athree's world.roadNetwork() is one, plus its junction pads). WORLD metres. */
export interface RoadTrafficSource {
  /**
   * The places vehicles drive between: a point in the middle of each road (never a junction's centre, which is a roundabout's island).
   * athree: world.roadNetwork().home().roads, each road's middle point.
   */
  targets: ReadonlyArray<{ x: number; z: number }>;
  route(from: { x: number; z: number }, to: { x: number; z: number }): Array<{ x: number; y: number; z: number }>;
  /** The junction pads and roundabouts: one vehicle inside each at a time. */
  junctions?: ReadonlyArray<{ x: number; z: number; radius: number }>;
}

export interface RoadTrafficOptions {
  /** Vehicles at most, near the camera (1 to 60, default 10; the light tier keeps LIGHT_TRAFFIC). */
  count?: number;
  kinds?: CityTrafficKind[];
  /** Cruising speed, m/s (default 9). */
  speed?: number;
  /** Vehicles drive within this many metres of the camera (default 260). */
  radius?: number;
  seed?: number;
  tier?: GeometryTier;
}

export interface RoadCar {
  object: THREE.Object3D;
  kind: CityTrafficKind;
  /** The route it drives (WORLD metres, left lane, road height) and the metres along it. */
  path: Array<{ x: number; y: number; z: number }>;
  along: number;
  speed: number;
  cruise: number;
  length: number;
  x: number; y: number; z: number; heading: number;
}

export interface RoadTraffic {
  /** Put it in the scene and move it by the floating origin: root.position = -origin (its children are in WORLD metres). */
  root: THREE.Group;
  readonly cars: RoadCar[];
  /** Advance. camera: where the player is, WORLD metres. avoid: objects no vehicle may drive into (the player, people). */
  update(dt: number, camera: { x: number; z: number }, avoid?: THREE.Object3D[]): void;
  /** Push an object (the player, the car they drive) out of any vehicle it is inside. True when it touched one. */
  pushOut(object: THREE.Object3D, radius?: number): boolean;
  dispose(): void;
}

interface RoadPath { pts: Array<{ x: number; y: number; z: number }>; arcs: number[]; length: number; gates: Array<{ j: number; s0: number; s1: number }> }

/** Where a route is s metres along it, and the way it faces there. PURE. */
export function poseOnRoute(pts: ReadonlyArray<{ x: number; y: number; z: number }>, arcs: ReadonlyArray<number>, s: number): { x: number; y: number; z: number; heading: number } {
  const length = arcs[arcs.length - 1];
  const t = Math.max(0, Math.min(length, s));
  let i = 1;
  while (i < arcs.length - 1 && arcs[i] < t) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = arcs[i] - arcs[i - 1] || 1;
  const u = Math.max(0, Math.min(1, (t - arcs[i - 1]) / seg));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** Drive the kit's vehicles on a planned road network (the map's colonies), near the camera. */
export function createRoadTraffic(source: RoadTrafficSource, options: RoadTrafficOptions = {}): RoadTraffic {
  const rand = rngOf(options.seed ?? 4041);
  const light = (options.tier === 'light' || options.tier === 'full' ? options.tier : geometryTier()) === 'light';
  const count = Math.max(1, Math.min(light ? LIGHT_TRAFFIC : 60, Math.round(options.count ?? 10)));
  const kinds: CityTrafficKind[] = options.kinds && options.kinds.length ? options.kinds : ['car', 'car', 'auto', 'car', 'bus', 'auto'];
  const cruiseBase = Math.max(2, options.speed ?? 9);
  const R = Math.max(60, options.radius ?? 260);
  const root = new THREE.Group();
  root.name = 'Road traffic';
  const fleet = trafficFleet(rand, light);
  const nodes = source.targets;
  const junctions = source.junctions ?? [];
  const jCells = new Map<string, number[]>();
  junctions.forEach((j, i) => {
    for (let cx = Math.floor((j.x - j.radius) / 64); cx <= Math.floor((j.x + j.radius) / 64); cx++) {
      for (let cz = Math.floor((j.z - j.radius) / 64); cz <= Math.floor((j.z + j.radius) / 64); cz++) {
        const k = cx + ',' + cz; const l = jCells.get(k); if (l) l.push(i); else jCells.set(k, [i]);
      }
    }
  });
  const junctionAt = (x: number, z: number): number => {
    for (const i of jCells.get(Math.floor(x / 64) + ',' + Math.floor(z / 64)) ?? []) if (Math.hypot(junctions[i].x - x, junctions[i].z - z) < junctions[i].radius) return i;
    return -1;
  };
  /** A route as arc lengths, with the stretches of it inside each junction pad (gates). */
  const pathOf = (pts: Array<{ x: number; y: number; z: number }>): RoadPath | null => {
    if (pts.length < 2) return null;
    const arcs = [0];
    for (let i = 1; i < pts.length; i++) arcs.push(arcs[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const length = arcs[arcs.length - 1];
    if (length < 30) return null;
    const gates: RoadPath['gates'] = [];
    let cur = -1;
    for (let s = 0; s <= length; s += 2) {
      const p = poseOnRoute(pts, arcs, s);
      const j = junctionAt(p.x, p.z);
      if (j !== cur) {
        if (cur >= 0) gates[gates.length - 1].s1 = s;
        if (j >= 0) gates.push({ j, s0: s, s1: length });
        cur = j;
      }
    }
    return { pts, arcs, length, gates };
  };
  const near = (x: number, z: number, cam: { x: number; z: number }, r: number): boolean => Math.hypot(x - cam.x, z - cam.z) <= r;
  /**
   * A route from a point to a road picked at random near the camera; null when the network has none there. With a heading, a route that
   * would turn the vehicle round where it stands is the last choice (a U-turn mid-road is not how traffic drives).
   */
  const routeFrom = (x: number, z: number, cam: { x: number; z: number }, heading?: number): RoadPath | null => {
    const pool = nodes.filter((n) => near(n.x, n.z, cam, R * 1.2) && Math.hypot(n.x - x, n.z - z) > 40);
    let fallback: RoadPath | null = null;
    for (let tries = 0; tries < 6 && pool.length; tries++) {
      const n = pool[Math.floor(rand() * pool.length)];
      const path = pathOf(source.route({ x, z }, { x: n.x, z: n.z }));
      if (!path) continue;
      if (heading === undefined) return path;
      const h = poseOnRoute(path.pts, path.arcs, 3).heading;
      if (Math.cos(h - heading) > 0) return path;
      fallback = fallback ?? path;
    }
    return fallback;
  };
  type Live = RoadCar & { route: RoadPath; waited: number };
  const cars: Live[] = [];
  const holder = new Map<number, Live>();
  const place = (c: Live): void => {
    const p = poseOnRoute(c.route.pts, c.route.arcs, c.along);
    c.x = p.x; c.y = p.y; c.z = p.z; c.heading = p.heading;
    c.object.position.set(p.x, p.y, p.z);
    c.object.rotation.y = p.heading;
  };
  const release = (c: Live): void => { for (const [j, h] of [...holder.entries()]) if (h === c) holder.delete(j); };
  /** Start a vehicle near the camera, on a free stretch of a route (never inside another vehicle or inside a junction pad). */
  const spawn = (cam: { x: number; z: number }): boolean => {
    const pool = nodes.filter((n) => near(n.x, n.z, cam, R));
    if (!pool.length) return false;
    const from = pool[Math.floor(rand() * pool.length)];
    const route = routeFrom(from.x, from.z, cam);
    if (!route) return false;
    const along = route.length * (0.15 + 0.5 * rand());
    const kind = kinds[cars.length % kinds.length];
    const length = VEHICLE_LENGTH[kind];
    const p = poseOnRoute(route.pts, route.arcs, along);
    if (route.gates.some((g) => along > g.s0 - length && along < g.s1 + length)) return false;
    for (const o of cars) if (Math.hypot(o.x - p.x, o.z - p.z) < (o.length + length) / 2 + TRAFFIC_GAP + 2) return false;
    const object = fleet.build(kind);
    const cruise = cruiseBase * (kind === 'bus' ? 0.8 : kind === 'auto' ? 0.85 : 1) * (0.9 + rand() * 0.2);
    const c: Live = { object, kind, path: route.pts, route, along, speed: cruise * 0.5, cruise, length, x: p.x, y: p.y, z: p.z, heading: p.heading, waited: 0 };
    cars.push(c);
    root.add(object);
    place(c);
    return true;
  };
  const remove = (c: Live): void => { release(c); root.remove(c.object); cars.splice(cars.indexOf(c), 1); };
  const toRoot = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  const inRoot = (o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 => { o.getWorldPosition(out); return out.applyMatrix4(toRoot); };
  const frame = (): void => { root.updateWorldMatrix(true, false); toRoot.copy(root.matrixWorld).invert(); };

  return {
    root,
    get cars() { return cars; },
    update: (dt, cam, avoid = []) => {
      if (!(dt > 0) || !cam || !Number.isFinite(cam.x) || !Number.isFinite(cam.z)) return;
      frame();
      // Near the camera only: a vehicle left behind gives its place to a new one ahead (two starts a step at most, never a burst).
      for (const c of [...cars]) if (!near(c.x, c.z, cam, R * 1.3)) remove(c);
      for (let starts = 0; starts < 2 && cars.length < count; starts++) if (!spawn(cam)) break;
      const points = avoid.map((a) => { const v = inRoot(a, new THREE.Vector3()); return { x: v.x, z: v.z }; });
      for (const c of cars) {
        let limit = Infinity;
        // The vehicle ahead in its lane (the same way within 50 degrees, inside the lane's width): keep the gap.
        const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
        for (const o of cars) {
          if (o === c) continue;
          const ahead = (o.x - c.x) * fx + (o.z - c.z) * fz;
          const side = Math.abs((o.x - c.x) * fz - (o.z - c.z) * fx);
          if (ahead > 0 && ahead < 40 && side < 1.8 && Math.cos(o.heading - c.heading) > 0.64) limit = Math.min(limit, ahead - (o.length + c.length) / 2 - TRAFFIC_GAP);
        }
        // One vehicle in a junction at a time: wait at its edge until the one inside has left (after 8 s of waiting it goes: no deadlock).
        const gate = c.route.gates.find((g) => g.s1 + c.length / 2 > c.along);
        if (gate) {
          const owner = holder.get(gate.j);
          const before = c.along + c.length / 2 < gate.s0;
          if (before && owner && owner !== c && c.waited < 8) limit = Math.min(limit, gate.s0 - c.length / 2 - 1 - c.along);
          if (before && c.speed < 0.5) c.waited += dt; else if (!before) c.waited = 0;
          if (!before && (!owner || owner === c)) holder.set(gate.j, c);
        }
        for (const q of points) limit = Math.min(limit, roomBefore(c.x, c.z, c.heading, c.length, q.x, q.z));
        c.speed = followSpeed(c.speed, c.cruise, limit, dt);
        c.along += c.speed * dt;
        // Clear of a junction behind it: let it go.
        for (const g of c.route.gates) if (holder.get(g.j) === c && c.along - c.length / 2 > g.s1) holder.delete(g.j);
        // The end of its route: on to a new one from there.
        if (c.along >= c.route.length) {
          const end = c.route.pts[c.route.pts.length - 1];
          const next = routeFrom(end.x, end.z, cam, c.heading);
          if (next) { release(c); c.route = next; c.path = next.pts; c.along = 0; } else { c.along = c.route.length; c.speed = 0; }
        }
        place(c);
      }
    },
    pushOut: (object, radius = 0.45) => {
      if (!object.parent) return false;
      frame();
      inRoot(object, tmp);
      const hit = pushOutOfVehicles(tmp, cars, radius);
      if (hit) { root.localToWorld(tmp); object.parent.worldToLocal(tmp); object.position.x = tmp.x; object.position.z = tmp.z; }
      return hit;
    },
    dispose: () => {
      for (const c of [...cars]) remove(c);
      root.removeFromParent();
      fleet.dispose();
    },
  };
}
`;
