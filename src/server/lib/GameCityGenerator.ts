/**
 * CITY BLOCKS (admin game-gap audit, 2026-11-20). Before this, a "city" game was a single straight road with
 * a row of houses beside it, because that is all the kit had: createRoad() is one strip, createTraffic() drives
 * along one strip, and createHouse() is one or two storeys. Every builder that wanted streets, crossings,
 * shops and tall buildings hand-placed boxes — streets that did not meet, buildings standing in the road,
 * pavements at the wrong height, and a frame rate that fell with every box.
 *
 * So the kit now plans a whole grid of city blocks and builds it in a few meshes:
 *   - planCity() — PURE (no three.js): streets, crossings, lots, parks, street lights and a spawn point,
 *     deterministic per seed. Every lot touches a street and none stands in one.
 *   - cityRoute() — a driving route between any two points along the streets, in the LEFT lane (India).
 *   - createCity() — the meshes: asphalt with centre lines and zebra crossings, raised pavements, shops with
 *     awnings and signboards, apartment blocks with balconies and water tanks, office towers, houses with a
 *     compound wall, parks with trees, benches and a fountain, and street lights. Each block is merged into a
 *     handful of meshes, so a 6 x 6 city is about 200 draw calls, not thousands.
 *
 * Vehicles: buildings and poles are solid colliders, so driveVehicle() already stops a car at them; city.heightAt is
 * the ground to pass it, and city.solidAt answers the same question for a mover the game positions by hand.
 *
 * String.raw: no backticks and no dollar-brace sequences inside the module text.
 */
export const GAME_CITY = String.raw`import * as THREE from 'three';
import { markWorldCollider, type WorldColliderKind } from './collision';
import { geometryTier, type GeometryTier } from './surfaces';
import { createEnterableHouse } from './buildings';

export type LotKind = 'apartment' | 'shop' | 'office' | 'house' | 'park';
export type CityStyle = 'town' | 'mixed' | 'downtown';
export interface CityPoint { x: number; z: number }

export interface CityOptions {
  /** Blocks across (x) and deep (z). 1 to 12; default 4 x 4. */
  blocksX?: number; blocksZ?: number;
  /** Block size in metres, pavement included. 24 to 90; default 44. */
  block?: number;
  /** Street width in metres (two lanes). 6 to 20; default 10. */
  road?: number;
  /** Pavement width. 1.5 to 6; default 3. */
  sidewalk?: number;
  /** 'town' — shops and houses, low; 'downtown' — towers in the middle; 'mixed' (default) — both. */
  style?: CityStyle;
  /** Share of blocks that are parks, 0 to 0.5; default 0.12. */
  parks?: number;
  /** Tallest building, in floors. 1 to 40; default 18. */
  maxFloors?: number;
  seed?: number;
  /** Street lights at block corners (default true). */
  streetLights?: boolean;
  /**
   * How much geometry to draw (queue Q-2698): 'full' — a box per window, sills and pilasters; 'light' — the same streets,
   * buildings and colliders, with each facade's windows painted on one panel and the small details left out, for a device
   * with no GPU or a weak phone. Left out: geometryTier() — the device decides, and the player's Settings override it.
   */
  tier?: GeometryTier;
  /**
   * 🚪 HOUSES YOU CAN WALK INTO (admin 2026-11-26: "user bole — ghar me game open karo, to painted gate ko real gate banao, ghar
   * andar se khokhla hota hi hai, hero andar chala jayega"). Off by default: a house is one solid shell with its door painted
   * on. When the user asks, every HOUSE lot is the kit's enterable house instead (three/buildings.ts, the same one the
   * enterable-house rule uses): its own colour, a real door that swings open with the interact key (E, or Use on a phone),
   * hollow rooms with a floor to stand on and walls that collide. Shops, apartments and offices stay shells.
   */
  enterableHouses?: boolean;
}

export interface CityLot {
  id: number;
  block: [number, number];
  kind: LotKind;
  /** Centre and size of the lot on the ground. */
  x: number; z: number; width: number; depth: number;
  /** Unit vector toward the street the front faces. */
  facing: CityPoint;
  /** Where the front door meets the pavement — a delivery, a mission, an NPC's home. */
  entrance: CityPoint;
  floors: number; height: number; color: number;
  /** Opened with city.openLot: its ground floors are a walk-in building (the door opens with Use), not a solid block. */
  open?: boolean;
  /** Shops only: the middle of the signboard's face, for the game to write the shop's name on. */
  sign?: { x: number; y: number; z: number; width: number; height: number; rotationY: number };
}

export interface CityPlan {
  blocksX: number; blocksZ: number; block: number; road: number; sidewalk: number; seed: number; style: CityStyle;
  width: number; depth: number;
  /** x of each north-south street (they run along z). */
  streetsX: number[];
  /** z of each east-west street (they run along x). */
  streetsZ: number[];
  lots: CityLot[];
  parks: Array<[number, number]>;
  lights: Array<CityPoint & { towardX: number; towardZ: number }>;
  /** On a street, in the left lane, between two crossings, heading +Z (rotation.y = heading). */
  spawn: CityPoint & { heading: number };
}

/** Road surface height — the same 3 cm as createRoad()'s ROAD_SURFACE_Y, so the two meet without a step. */
export const CITY_ROAD_Y = 0.03;
/** Kerb height: the pavement top is CITY_ROAD_Y + CITY_KERB. */
export const CITY_KERB = 0.15;
/**
 * The zebra crossing on every arm of a crossing: it starts gap metres past the crossing's edge and runs depth metres
 * along the street. ONE place (2026-11-21): traffic stops behind it and pedestrians walk on it, from these numbers.
 */
export const CITY_ZEBRA = { gap: 0.8, depth: 3 } as const;

const WASHES = [0xe9c46a, 0xf4a6a6, 0x9ec9e6, 0xf1e3c8, 0xc7e0b4, 0xe8b07a, 0xd7c3e6, 0xf6f1e7];
const OFFICE = [0x8fa3b0, 0xa7b4bd, 0x6f8796, 0xc9d3d9, 0x9aa5ad];
const AWNINGS = [0xd62828, 0x2a9d8f, 0xf77f00, 0x457b9d, 0x6a4c93, 0xe9c46a, 0x2b9348];
const SIGNS = [0xffd166, 0x06d6a0, 0xef476f, 0x118ab2, 0xffffff, 0xf4a261];

const clamp = (v: number | undefined, fallback: number, low: number, high: number) =>
  Number.isFinite(v) ? Math.max(low, Math.min(high, v as number)) : fallback;
function rngOf(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(list: readonly T[], r: () => number): T => list[Math.floor(r() * list.length) % list.length];

/** Lay out the city. Pure and deterministic: the same options give the same city. */
export function planCity(options: CityOptions = {}): CityPlan {
  const blocksX = Math.round(clamp(options.blocksX, 4, 1, 12));
  const blocksZ = Math.round(clamp(options.blocksZ, 4, 1, 12));
  const block = clamp(options.block, 44, 24, 90);
  const road = clamp(options.road, 10, 6, 20);
  const sidewalk = Math.min(clamp(options.sidewalk, 3, 1.5, 6), block / 5);
  const style: CityStyle = options.style === 'town' || options.style === 'downtown' ? options.style : 'mixed';
  const parkShare = clamp(options.parks, 0.12, 0, 0.5);
  const maxFloors = Math.round(clamp(options.maxFloors, 18, 1, 40));
  const seed = Math.floor(clamp(options.seed, 1, -1e9, 1e9));
  const r = rngOf(seed);
  const width = blocksX * block + (blocksX + 1) * road;
  const depth = blocksZ * block + (blocksZ + 1) * road;
  const streetsX: number[] = [], streetsZ: number[] = [];
  for (let i = 0; i <= blocksX; i++) streetsX.push(-width / 2 + road / 2 + i * (block + road));
  for (let j = 0; j <= blocksZ; j++) streetsZ.push(-depth / 2 + road / 2 + j * (block + road));

  // Parks: a share of the blocks, never every block.
  const total = blocksX * blocksZ;
  const parkSet = new Set<number>();
  for (let k = 0; k < total; k++) if (r() < parkShare) parkSet.add(k);
  if (parkSet.size >= total) parkSet.delete(Math.floor(r() * total));
  if (parkShare > 0 && parkSet.size === 0 && total >= 4) parkSet.add(Math.floor(r() * total));
  const parks: Array<[number, number]> = [];

  const lots: CityLot[] = [];
  const lights: CityPlan['lights'] = [];
  for (let j = 0; j < blocksZ; j++) for (let i = 0; i < blocksX; i++) {
    const x0 = streetsX[i] + road / 2, x1 = streetsX[i + 1] - road / 2;
    const z0 = streetsZ[j] + road / 2, z1 = streetsZ[j + 1] - road / 2;
    if (options.streetLights !== false) {
      for (const [cx, sx] of [[x0, -1], [x1, 1]] as const) for (const [cz, sz] of [[z0, -1], [z1, 1]] as const) {
        lights.push({ x: cx - sx * 0.6, z: cz - sz * 0.6, towardX: sx, towardZ: sz });
      }
    }
    if (parkSet.has(j * blocksX + i)) { parks.push([i, j]); continue; }
    const bx = (x0 + x1) / 2, bz = (z0 + z1) / 2;
    // How central the block is: 0 at the middle of the city, 1 at the edge.
    const centrality = Math.max(Math.abs(bx) / (width / 2), Math.abs(bz) / (depth / 2));
    const ix0 = x0 + sidewalk, iz0 = z0 + sidewalk;
    const innerW = x1 - x0 - 2 * sidewalk, innerD = z1 - z0 - 2 * sidewalk;
    // Two rows at most, so EVERY lot has a street in front of it.
    const rows = innerD >= 20 ? 2 : 1;
    const cols = Math.max(1, Math.min(5, Math.round(innerW / 16)));
    const gap = 1;
    const lw = (innerW - (cols - 1) * gap) / cols;
    const ld = rows === 2 ? (innerD - gap) / 2 : innerD;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const kind = lotKind(style, centrality, r);
      const x = ix0 + col * (lw + gap) + lw / 2;
      const z = iz0 + row * (ld + gap) + ld / 2;
      const facing = row === 0 ? { x: 0, z: -1 } : { x: 0, z: 1 };
      const floors = floorsFor(kind, centrality, maxFloors, r);
      const height = kind === 'office' ? floors * 3.6 : kind === 'shop' ? 4 + (floors - 1) * 3 : floors * 3;
      const color = kind === 'office' ? pick(OFFICE, r) : pick(WASHES, r);
      const lot: CityLot = {
        id: lots.length, block: [i, j], kind, x, z, width: lw, depth: ld, facing,
        entrance: { x, z: z + facing.z * (ld / 2 + sidewalk / 2) },
        floors, height, color,
      };
      if (kind === 'shop') {
        const frontZ = z + facing.z * (ld / 2 - 0.4);
        lot.sign = { x, y: CITY_ROAD_Y + CITY_KERB + 3.75, z: frontZ + facing.z * 0.13, width: lw - 1, height: 0.9, rotationY: facing.z > 0 ? 0 : Math.PI };
      }
      lots.push(lot);
    }
  }
  const sx = streetsX[Math.floor(blocksX / 2)];
  const sj = Math.min(blocksZ - 1, Math.floor(blocksZ / 2));
  const spawn = { x: sx + road / 4, z: (streetsZ[sj] + streetsZ[sj + 1]) / 2, heading: 0 };
  return { blocksX, blocksZ, block, road, sidewalk, seed, style, width, depth, streetsX, streetsZ, lots, parks, lights, spawn };
}

function lotKind(style: CityStyle, c: number, r: () => number): LotKind {
  const u = r();
  if (style === 'downtown') return c < 0.5 ? 'office' : u < 0.7 ? 'apartment' : 'shop';
  if (style === 'town') return c < 0.5 ? (u < 0.6 ? 'shop' : u < 0.75 ? 'apartment' : 'house') : (u < 0.3 ? 'shop' : 'house');
  if (c < 0.35) return u < 0.7 ? 'office' : 'apartment';
  if (c < 0.7) return u < 0.5 ? 'apartment' : 'shop';
  return u < 0.4 ? 'shop' : 'house';
}

function floorsFor(kind: LotKind, c: number, maxFloors: number, r: () => number): number {
  let f: number;
  if (kind === 'office') f = 6 + Math.round((maxFloors - 6) * (1 - c) * (0.6 + 0.4 * r()));
  else if (kind === 'apartment') f = 4 + Math.floor(r() * 7);
  else if (kind === 'shop') f = 1 + Math.floor(r() * 3);
  else f = 1 + Math.floor(r() * 2);
  return Math.max(1, Math.min(maxFloors, f));
}

/** True when (x, z) is on a street (asphalt), inside the city. */
export function onStreet(plan: CityPlan, x: number, z: number): boolean {
  if (Math.abs(x) > plan.width / 2 || Math.abs(z) > plan.depth / 2) return false;
  const h = plan.road / 2;
  return plan.streetsX.some((sx) => Math.abs(x - sx) <= h) || plan.streetsZ.some((sz) => Math.abs(z - sz) <= h);
}

/** The lot at (x, z), or null. */
export function lotAt(plan: CityPlan, x: number, z: number): CityLot | null {
  for (const lot of plan.lots) if (Math.abs(x - lot.x) <= lot.width / 2 && Math.abs(z - lot.z) <= lot.depth / 2) return lot;
  return null;
}

/** Ground height at (x, z): the asphalt on a street, the pavement top everywhere else in the city, 0 outside. */
export function cityHeightAt(plan: CityPlan, x: number, z: number): number {
  if (Math.abs(x) > plan.width / 2 || Math.abs(z) > plan.depth / 2) return 0;
  return onStreet(plan, x, z) ? CITY_ROAD_Y : CITY_ROAD_Y + CITY_KERB;
}

/**
 * True when a circle of radius r at (x, z) touches a building, a park's solid parts or a light pole — what a
 * car must not drive into. Pavements and parks' grass are not solid.
 */
export function citySolidAt(plan: CityPlan, x: number, z: number, radius = 0.5): boolean {
  const rr = Math.max(0, radius);
  for (const lot of plan.lots) {
    if (lot.open) continue;   // a walk-in building has its own walls (the door is the way in)
    const b = buildingFootprint(lot);
    if (Math.abs(x - b.x) <= b.w / 2 + rr && Math.abs(z - b.z) <= b.d / 2 + rr) return true;
  }
  for (const p of plan.lights) if (Math.hypot(x - p.x, z - p.z) <= 0.1 + rr) return true;
  return false;
}

/** The building's own footprint inside its lot (houses sit back behind a front yard). */
export function buildingFootprint(lot: CityLot): { x: number; z: number; w: number; d: number } {
  const front = lot.kind === 'house' ? 2.5 : 0.4;
  const w = lot.width - 0.4, d = lot.depth - front - 0.4;
  const z = lot.z + lot.facing.z * ((lot.depth / 2 - front) - d / 2);
  return { x: lot.x, z, w, d };
}

interface Snap { p: CityPoint; a: [number, number]; b: [number, number] }
/** Nearest point on a street centre line, with the two crossings (grid indices) at the ends of its stretch. */
function snapToStreet(plan: CityPlan, x: number, z: number): Snap {
  let best: Snap | null = null, bestD = Infinity;
  const { streetsX: X, streetsZ: Z } = plan;
  const span = (list: number[], v: number): [number, number] => {
    if (v <= list[0]) return [0, 0];
    if (v >= list[list.length - 1]) return [list.length - 1, list.length - 1];
    let k = 0; while (k < list.length - 1 && list[k + 1] < v) k++;
    return [k, k + 1];
  };
  for (let i = 0; i < X.length; i++) {
    const cz = Math.max(Z[0], Math.min(Z[Z.length - 1], z));
    const d = Math.hypot(x - X[i], z - cz);
    if (d < bestD) { const [a, b] = span(Z, cz); bestD = d; best = { p: { x: X[i], z: cz }, a: [i, a], b: [i, b] }; }
  }
  for (let j = 0; j < Z.length; j++) {
    const cx = Math.max(X[0], Math.min(X[X.length - 1], x));
    const d = Math.hypot(x - cx, z - Z[j]);
    if (d < bestD) { const [a, b] = span(X, cx); bestD = d; best = { p: { x: cx, z: Z[j] }, a: [a, j], b: [b, j] }; }
  }
  return best as Snap;
}

/**
 * A route along the streets from one point to another: waypoints on the street centre lines, turned at the
 * crossings, then moved into the LEFT lane (India keeps left) unless lane is false. A point off the street
 * (an entrance, a park) is reached from the nearest street and added as the last waypoint.
 */
export function cityRoute(plan: CityPlan, from: CityPoint, to: CityPoint, options: { lane?: boolean } = {}): CityPoint[] {
  const { streetsX: X, streetsZ: Z } = plan;
  const s = snapToStreet(plan, from.x, from.z), t = snapToStreet(plan, to.x, to.z);
  const at = (g: [number, number]): CityPoint => ({ x: X[g[0]], z: Z[g[1]] });
  const dist = (a: CityPoint, b: CityPoint) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  const sameStretch = (s.a[0] === t.a[0] && s.a[1] === t.a[1] && s.b[0] === t.b[0] && s.b[1] === t.b[1])
    && (s.p.x === t.p.x || s.p.z === t.p.z);
  let centre: CityPoint[];
  if (sameStretch) centre = [s.p, t.p];
  else {
    let best: CityPoint[] = [], bestCost = Infinity;
    for (const ga of [s.a, s.b]) for (const gb of [t.a, t.b]) {
      const A = at(ga), B = at(gb);
      const cost = dist(s.p, A) + dist(A, B) + dist(B, t.p);
      if (cost < bestCost) { bestCost = cost; best = [s.p, A, { x: B.x, z: A.z }, B, t.p]; }
    }
    centre = best;
  }
  const path: CityPoint[] = [];
  for (const p of centre) {
    const last = path[path.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.z - p.z) > 1e-6) path.push({ x: p.x, z: p.z });
  }
  // Drop a middle point that is on the straight line between its neighbours.
  for (let k = path.length - 2; k >= 1; k--) {
    const a = path[k - 1], b = path[k], c = path[k + 1];
    if ((a.x === b.x && b.x === c.x) || (a.z === b.z && b.z === c.z)) path.splice(k, 1);
  }
  const out = options.lane === false ? path : laneOffset(path, plan.road / 4);
  const offStreet = Math.hypot(to.x - t.p.x, to.z - t.p.z) > plan.road / 2;
  if (offStreet) out.push({ x: to.x, z: to.z });
  return out;
}

function laneOffset(path: CityPoint[], off: number): CityPoint[] {
  if (path.length < 2) return path.map((p) => ({ ...p }));
  const left = (a: CityPoint, b: CityPoint): CityPoint => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    // Facing (dx, dz), the driver's left is (dz, -dx) in this world (+Z forward has +X on the left).
    return { x: dz / len, z: -dx / len };
  };
  return path.map((p, k) => {
    const lin = k > 0 ? left(path[k - 1], p) : null;
    const lout = k < path.length - 1 ? left(p, path[k + 1]) : null;
    let ox = 0, oz = 0;
    if (lin && lout && Math.abs(lin.x * lout.x + lin.z * lout.z) < 0.5) { ox = lin.x + lout.x; oz = lin.z + lout.z; }
    else { const l = lout ?? lin!; ox = l.x; oz = l.z; }
    return { x: p.x + ox * off, z: p.z + oz * off };
  });
}

/** Merges many simple shapes into one mesh, each with its own colour (vertex colours). */
class Batch {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private readonly colour = new THREE.Color();
  /** withUv: the batch keeps texture coordinates (the light tier's facade panels, whose windows are a repeated texture). */
  constructor(private readonly withUv = false) {}
  /** repeat: how many times the texture repeats across and up the shape (only for a batch made withUv). */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, repeat?: [number, number]): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    flat.applyMatrix4(matrix);
    const p = flat.getAttribute('position'), n = flat.getAttribute('normal'), t = flat.getAttribute('uv');
    this.colour.setHex(color);
    const [ru, rv] = repeat ?? [1, 1];
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(this.colour.r, this.colour.g, this.colour.b);
      if (this.withUv) this.uv.push(t ? t.getX(i) * ru : 0, t ? t.getY(i) * rv : 0);
    }
    flat.dispose();
    geometry.dispose();
  }
  get empty(): boolean { return this.pos.length === 0; }
  build(material: THREE.Material, kind: WorldColliderKind, name: string): THREE.Mesh | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.castShadow = kind === 'solid';
    mesh.receiveShadow = true;
    return markWorldCollider(mesh, kind);
  }
}

interface Batches { ground: Batch; solid: Batch; detail: Batch; glass: Batch; lamp: Batch; facade: Batch }
const batches = (): Batches => ({ ground: new Batch(), solid: new Batch(), detail: new Batch(), glass: new Batch(), lamp: new Batch(), facade: new Batch(true) });

/**
 * The light tier's window: one cell of a facade, a dark pane in a white frame. Multiplied by the panel's colour, the frame
 * is the wall and the pane is the glass, so one panel per facade draws every window of it (two triangles a face, not twelve
 * a window). Built once per city from data — no image to load.
 */
function windowTexture(): THREE.DataTexture {
  const size = 16, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const pane = x >= 3 && x <= 12 && y >= 4 && y <= 13;
    const sheen = pane && x + y > 18 && x + y < 22;
    const i = (y * size + x) * 4;
    data[i] = pane ? (sheen ? 120 : 36) : 255; data[i + 1] = pane ? (sheen ? 140 : 48) : 255; data[i + 2] = pane ? (sheen ? 158 : 60) : 255; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface City {
  root: THREE.Group;
  plan: CityPlan;
  /** The houses you can walk into (CityOptions.enterableHouses), one per house lot; empty when it is off. */
  houses: THREE.Group[];
  /** The geometry tier this city was built at ('full' or 'light'). */
  tier: GeometryTier;
  /** Where to put the player's car or character: on a street, in the left lane, facing spawnHeading. */
  spawn: THREE.Vector3;
  spawnHeading: number;
  /** A route along the streets (left lane), at road height. */
  route(from: CityPoint, to: CityPoint, options?: { lane?: boolean }): THREE.Vector3[];
  /** The ground under (x, z) — pass { ground: city.heightAt } to driveVehicle's tuning. */
  heightAt(x: number, z: number): number;
  /** A body of this radius here would be inside a building or a pole — for a mover your own code positions (driveVehicle already stops at them). */
  solidAt(x: number, z: number, radius?: number): boolean;
  onStreet(x: number, z: number): boolean;
  lotAt(x: number, z: number): CityLot | null;
  /** The lots of one kind ('shop', 'apartment', …) — mission targets, deliveries, homes. */
  lotsOf(kind: LotKind): CityLot[];
  /**
   * 🚪 MAKE A BUILDING ENTERABLE (admin 2026-11-26: "painted door wala ghar, user kahe to andar ja sake"). The lot's ground
   * floors become a real walk-in building on the same footprint, facing its street — a door that swings with Use, hollow
   * rooms, walls that collide, a floor to stand on, a roof that fades while you are inside (three/buildings.ts) — and a tall
   * building keeps its upper floors above it. Only that block is redrawn. Returns the building, or null for a park or a lot
   * already open.
   */
  openLot(lot: CityLot | number): THREE.Group | null;
  /** Remove the city and free its geometry and materials. */
  dispose(): void;
}

/** Build the city: a grid of streets and blocks, centred on the origin. */
export function createCity(options: CityOptions = {}): City {
  const plan = planCity(options);
  const tier: GeometryTier = options.tier === 'light' || options.tier === 'full' ? options.tier : geometryTier();
  const light = tier === 'light';
  const r = rngOf(plan.seed * 7 + 3);
  const root = new THREE.Group();
  root.name = 'City';
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe8b0 });
  const windows = light ? windowTexture() : null;
  const facadeMat = windows ? new THREE.MeshStandardMaterial({ vertexColors: true, map: windows, roughness: 0.55, metalness: 0.1 }) : null;
  const top = CITY_ROAD_Y + CITY_KERB;
  const M = new THREE.Matrix4();
  const at = (x: number, y: number, z: number, rotY = 0) => M.makeRotationY(rotY).setPosition(x, y, z);
  const box = (b: Batch, w: number, h: number, d: number, x: number, y: number, z: number, color: number, rotY = 0) =>
    b.add(new THREE.BoxGeometry(w, h, d), at(x, y, z, rotY), color);

  // STREETS: north-south full length, east-west only between them, so no two asphalt pieces overlap.
  const streets = new Batch(), marks = new Batch();
  const { road, depth: D, streetsX: X, streetsZ: Z } = plan;
  for (const x of X) box(streets, road, 0.06, D, x, CITY_ROAD_Y - 0.03, 0, 0x3a3c40);
  for (const z of Z) for (let i = 0; i < X.length - 1; i++) {
    const len = X[i + 1] - X[i] - road;
    box(streets, len, 0.06, road, (X[i] + X[i + 1]) / 2, CITY_ROAD_Y - 0.03, z, 0x3a3c40);
  }
  const markY = CITY_ROAD_Y + 0.006, white = 0xf2f2f2;
  // A road marking: in the light tier only its top face (two triangles, not a 1 cm box's twelve) — it is only ever seen from above.
  const mark = (w: number, d: number, x: number, z: number) => {
    if (!light) { box(marks, w, 0.012, d, x, markY, z, white); return; }
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
    marks.add(g, at(x, markY + 0.006, z), white);
  };
  const zebraDepth = CITY_ZEBRA.depth, zebraGap = CITY_ZEBRA.gap;
  // Centre dashes on every stretch between two crossings, stopping short of the zebra crossings.
  const dashes = (a: number, b: number, fixed: number, alongX: boolean) => {
    const start = a + road / 2 + zebraGap + zebraDepth + 1, end = b - road / 2 - zebraGap - zebraDepth - 1;
    for (let s = start; s + 3 <= end; s += 6) {
      if (alongX) mark(3, 0.15, s + 1.5, fixed);
      else mark(0.15, 3, fixed, s + 1.5);
    }
  };
  for (const x of X) for (let j = 0; j < Z.length - 1; j++) dashes(Z[j], Z[j + 1], x, false);
  for (const z of Z) for (let i = 0; i < X.length - 1; i++) dashes(X[i], X[i + 1], z, true);
  // Zebra crossings on every arm of every crossing that has a street.
  for (let i = 0; i < X.length; i++) for (let j = 0; j < Z.length; j++) {
    const cx = X[i], cz = Z[j], c = road / 2 + zebraGap + zebraDepth / 2;
    const stripes = Math.floor(road - 1);
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      if ((dz === 1 && j === Z.length - 1) || (dz === -1 && j === 0) || (dx === 1 && i === X.length - 1) || (dx === -1 && i === 0)) continue;
      for (let k = 0; k < stripes; k++) {
        const o = k - (stripes - 1) / 2;
        if (dx === 0) mark(0.5, zebraDepth, cx + o, cz + dz * c);
        else mark(zebraDepth, 0.5, cx + dx * c, cz + o);
      }
    }
  }
  const streetMesh = streets.build(paint, 'ground', 'City streets');
  const markMesh = marks.build(paint, 'none', 'City road markings');
  if (streetMesh) { streetMesh.castShadow = false; root.add(streetMesh); }
  if (markMesh) { markMesh.castShadow = false; root.add(markMesh); }

  const blockGroups = new Map<string, Batches>();
  const batchFor = (i: number, j: number) => {
    const key = i + ',' + j;
    let b = blockGroups.get(key);
    if (!b) { b = batches(); blockGroups.set(key, b); }
    return b;
  };

  // PAVEMENTS: one raised slab per block, the kerb is its edge.
  for (let j = 0; j < plan.blocksZ; j++) for (let i = 0; i < plan.blocksX; i++) {
    const x0 = X[i] + road / 2, x1 = X[i + 1] - road / 2, z0 = Z[j] + road / 2, z1 = Z[j + 1] - road / 2;
    box(batchFor(i, j).ground, x1 - x0, CITY_KERB, z1 - z0, (x0 + x1) / 2, CITY_ROAD_Y + CITY_KERB / 2, (z0 + z1) / 2, 0xb9b4aa);
  }

  // Each block draws from its own random stream, so one block can be drawn again (openLot) exactly as it was.
  // Enterable houses (options.enterableHouses): the lot is still drawn into a discarded batch, so later random draws stay
  // those of the shell city.
  const blockRng = (i: number, j: number) => rngOf(plan.seed * 7 + 3 + i * 131 + j * 977);
  const blockRngs = new Map<string, () => number>();
  const rngFor = (i: number, j: number) => { const k = i + ',' + j; let g = blockRngs.get(k); if (!g) { g = blockRng(i, j); blockRngs.set(k, g); } return g; };
  void r;
  const enterable: THREE.Group[] = [];
  const discard = options.enterableHouses ? batches() : null;
  for (const lot of plan.lots) {
    const lotRng = rngFor(lot.block[0], lot.block[1]);
    if (discard && lot.kind === 'house') {
      buildLot(discard, lot, top, lotRng, box, light);
      const fp = buildingFootprint(lot);
      const house = createEnterableHouse({ width: fp.w, depth: fp.d, storeys: Math.min(2, lot.floors), wallColor: lot.color, roofColor: shade(lot.color, 0.7) });
      house.position.set(fp.x, top, fp.z);
      house.rotation.y = lot.facing.z > 0 ? 0 : Math.PI;                  // the door faces the lot's street, as the painted one did
      house.name = 'City house ' + lot.id;
      root.add(house);
      enterable.push(house);
      continue;
    }
    buildLot(batchFor(lot.block[0], lot.block[1]), lot, top, lotRng, box, light);
  }
  for (const [i, j] of plan.parks) buildPark(batchFor(i, j), plan, i, j, top, rngFor(i, j), box);
  for (const light of plan.lights) {
    const i = Math.min(plan.blocksX - 1, Math.max(0, X.findIndex((x, k) => k < X.length - 1 && light.x > x && light.x < X[k + 1])));
    const j = Math.min(plan.blocksZ - 1, Math.max(0, Z.findIndex((z, k) => k < Z.length - 1 && light.z > z && light.z < Z[k + 1])));
    const b = batchFor(i, j);
    const rot = Math.atan2(light.towardX, light.towardZ);
    box(b.solid, 0.16, 6, 0.16, light.x, top + 3, light.z, 0x4b5563);
    const ax = light.x + Math.sin(rot) * 0.8, az = light.z + Math.cos(rot) * 0.8;
    box(b.detail, 0.1, 0.1, 1.6, ax, top + 5.95, az, 0x4b5563, rot);
    box(b.lamp, 0.5, 0.16, 0.3, light.x + Math.sin(rot) * 1.5, top + 5.85, light.z + Math.cos(rot) * 1.5, 0xffffff, rot);
  }

  const blockMeshes = new Map<string, THREE.Group>();
  const assemble = (key: string, b: Batches) => {
    const g = new THREE.Group();
    g.name = 'City block ' + key;
    const parts: Array<THREE.Mesh | null> = [
      b.ground.build(paint, 'ground', 'pavement'),
      b.solid.build(paint, 'solid', 'buildings'),
      b.detail.build(paint, 'none', 'details'),
      b.glass.build(glass, 'none', 'windows'),
      b.lamp.build(lampMat, 'none', 'lamps'),
      facadeMat ? b.facade.build(facadeMat, 'none', 'facades') : null,
    ];
    for (const m of parts) if (m) g.add(m);
    root.add(g);
    blockMeshes.set(key, g);
  };
  for (const [key, b] of blockGroups) assemble(key, b);
  // The lamps of one block (drawn again with it).
  const lampBlock = (lx: number, lz: number): [number, number] => [
    Math.min(plan.blocksX - 1, Math.max(0, X.findIndex((x, k) => k < X.length - 1 && lx > x && lx < X[k + 1]))),
    Math.min(plan.blocksZ - 1, Math.max(0, Z.findIndex((z, k) => k < Z.length - 1 && lz > z && lz < Z[k + 1]))),
  ];
  /** Draw block (i, j) again from its plan (open lots as their upper floors only). */
  const redrawBlock = (i: number, j: number) => {
    const key = i + ',' + j;
    const old = blockMeshes.get(key);
    if (old) { old.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { markWorldCollider(m, 'none'); m.geometry.dispose(); } }); root.remove(old); }
    const b = batches();
    const rr = blockRng(i, j);
    const x0 = X[i] + road / 2, x1 = X[i + 1] - road / 2, z0 = Z[j] + road / 2, z1 = Z[j + 1] - road / 2;
    box(b.ground, x1 - x0, CITY_KERB, z1 - z0, (x0 + x1) / 2, CITY_ROAD_Y + CITY_KERB / 2, (z0 + z1) / 2, 0xb9b4aa);
    for (const lot of plan.lots) if (lot.block[0] === i && lot.block[1] === j) buildLot(b, lot, top, rr, box, light);
    for (const [pi, pj] of plan.parks) if (pi === i && pj === j) buildPark(b, plan, pi, pj, top, rr, box);
    for (const lamp of plan.lights) {
      const [li, lj] = lampBlock(lamp.x, lamp.z);
      if (li !== i || lj !== j) continue;
      const rot = Math.atan2(lamp.towardX, lamp.towardZ);
      box(b.solid, 0.16, 6, 0.16, lamp.x, top + 3, lamp.z, 0x4b5563);
      const ax = lamp.x + Math.sin(rot) * 0.8, az = lamp.z + Math.cos(rot) * 0.8;
      box(b.detail, 0.1, 0.1, 1.6, ax, top + 5.95, az, 0x4b5563, rot);
      box(b.lamp, 0.5, 0.16, 0.3, lamp.x + Math.sin(rot) * 1.5, top + 5.85, lamp.z + Math.cos(rot) * 1.5, 0xffffff, rot);
    }
    assemble(key, b);
  };
  const opened: THREE.Group[] = [];
  const openLot = (which: CityLot | number): THREE.Group | null => {
    const lot = typeof which === 'number' ? plan.lots.find((l) => l.id === which) : which;
    if (!lot || lot.kind === 'park' || lot.open) return null;
    lot.open = true;
    redrawBlock(lot.block[0], lot.block[1]);
    const fp = buildingFootprint(lot);
    const storeys = lot.height > 5.5 ? 2 : 1;
    const house = createEnterableHouse({ width: Math.min(30, Math.max(5, fp.w)), depth: Math.min(30, Math.max(4, fp.d)), storeys, wallColor: lot.color });
    house.position.set(fp.x, top, fp.z);
    house.rotation.y = lot.facing.z > 0 ? 0 : Math.PI;   // its door (+Z) faces the street, where the painted one was
    house.name = 'Open building ' + lot.id;
    root.add(house);
    opened.push(house);
    return house;
  };

  const toV = (p: CityPoint) => new THREE.Vector3(p.x, CITY_ROAD_Y, p.z);
  return {
    root, plan, tier, houses: enterable,
    spawn: toV(plan.spawn), spawnHeading: plan.spawn.heading,
    route: (from, to, o) => cityRoute(plan, from, to, o).map((p) => new THREE.Vector3(p.x, cityHeightAt(plan, p.x, p.z), p.z)),
    heightAt: (x, z) => cityHeightAt(plan, x, z),
    solidAt: (x, z, radius) => citySolidAt(plan, x, z, radius),
    onStreet: (x, z) => onStreet(plan, x, z),
    lotAt: (x, z) => lotAt(plan, x, z),
    lotsOf: (kind) => plan.lots.filter((l) => l.kind === kind),
    openLot,
    dispose: () => {
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      paint.dispose(); glass.dispose(); lampMat.dispose(); facadeMat?.dispose(); windows?.dispose();
      root.removeFromParent();
    },
  };
}

type BoxFn = (b: Batch, w: number, h: number, d: number, x: number, y: number, z: number, color: number, rotY?: number) => void;

function shade(color: number, k: number): number {
  const c = new THREE.Color(color).multiplyScalar(k);
  return c.getHex();
}

/** One building on its lot. Built facing +Z in its own frame, then turned to face its street. */
function buildLot(b: Batches, lot: CityLot, top: number, r: () => number, box: BoxFn, light = false): void {
  const rot = lot.facing.z > 0 ? 0 : Math.PI;
  const s = Math.cos(rot); // +1 facing +Z, -1 facing -Z: local z maps to world z * s
  const fp = buildingFootprint(lot);
  const H = lot.height, w = fp.w, d = fp.d;
  // Local frame: origin at the footprint centre; front face at +d/2.
  const put = (bb: Batch, bw: number, bh: number, bd: number, lx: number, ly: number, lz: number, color: number) =>
    box(bb, bw, bh, bd, fp.x + lx * s, top + ly, fp.z + lz * s, color, rot);
  // An open lot (city.openLot): its ground floors are the walk-in building; only the floors above it are drawn here.
  if (lot.open) {
    const shell = (H > 5.5 ? 2 : 1) * 3 + 0.35;
    if (H > shell + 0.5) put(b.solid, w, H - shell, d, 0, shell + (H - shell) / 2, 0, lot.color);
    return;
  }
  put(b.solid, w, H, d, 0, H / 2, 0, lot.color);
  put(b.solid, w + 0.1, 0.4, d + 0.1, 0, 0.2, 0, shade(lot.color, 0.7));
  const glassTone = () => (r() < 0.25 ? 0x7a8c99 : 0x1f2d38);
  // 🏙️ LIGHT TIER: each facade's windows are ONE panel whose texture repeats a window per cell (cols across, rows up).
  const panel = (pw: number, ph: number, pd: number, lx: number, ly: number, lz: number, color: number, cols: number, rows: number) =>
    b.facade.add(new THREE.BoxGeometry(pw, ph, pd), new THREE.Matrix4().makeRotationY(rot).setPosition(fp.x + lx * s, top + ly, fp.z + lz * s), color, [cols, rows]);

  if (lot.kind === 'office' && light) {
    // The same glass bands (one per floor, every 3.6 m) as one panel a facade; the light mullions are the texture's frame.
    const ph = lot.floors * 3.6, cols = Math.max(1, Math.round((w - 0.8) / 2.4)), colsD = Math.max(1, Math.round((d - 0.8) / 2.4));
    const tone = shade(lot.color, 1.15);
    // The full tier draws a random glass tone per pane: the same draws are taken here, so every later choice of the city
    // (shop colours, park trees — which are colliders) is the same in both tiers.
    for (let k = 0; k < lot.floors * 4; k++) glassTone();
    panel(w - 0.8, ph, 0.06, 0, ph / 2, d / 2 + 0.03, tone, cols, lot.floors);
    panel(w - 0.8, ph, 0.06, 0, ph / 2, -d / 2 - 0.03, tone, cols, lot.floors);
    panel(0.06, ph, d - 0.8, w / 2 + 0.03, ph / 2, 0, tone, colsD, lot.floors);
    panel(0.06, ph, d - 0.8, -w / 2 - 0.03, ph / 2, 0, tone, colsD, lot.floors);
    put(b.detail, 4.5, 0.2, 2, 0, 3.4, d / 2 + 1, 0xd1d5db);
    put(b.glass, 2.4, 2.4, 0.06, 0, 1.6, d / 2 + 0.07, 0x9bb7c7);
    put(b.solid, 3, 2.5, 3, w / 4, H + 1.25, -d / 4, shade(lot.color, 0.85));
  } else if (lot.kind === 'office') {
    for (let f = 0; f < lot.floors; f++) {
      const y = f * 3.6 + 0.6 + 1.1;
      put(b.glass, w - 0.8, 2.2, 0.06, 0, y, d / 2 + 0.03, glassTone());
      put(b.glass, w - 0.8, 2.2, 0.06, 0, y, -d / 2 - 0.03, glassTone());
      put(b.glass, 0.06, 2.2, d - 0.8, w / 2 + 0.03, y, 0, glassTone());
      put(b.glass, 0.06, 2.2, d - 0.8, -w / 2 - 0.03, y, 0, glassTone());
    }
    for (let x = -w / 2 + 1.5; x <= w / 2 - 1.5; x += 3) put(b.detail, 0.15, H, 0.25, x, H / 2, d / 2 + 0.12, shade(lot.color, 1.15));
    put(b.detail, 4.5, 0.2, 2, 0, 3.4, d / 2 + 1, 0xd1d5db);
    put(b.glass, 2.4, 2.4, 0.06, 0, 1.6, d / 2 + 0.07, 0x9bb7c7);
    put(b.solid, 3, 2.5, 3, w / 4, H + 1.25, -d / 4, shade(lot.color, 0.85));
  } else {
    const first = lot.kind === 'shop' ? 1 : 0;
    if (light && lot.floors > first) {
      // One panel a facade over the window floors: a window every w/n metres across, one row a floor (3 m).
      const n = Math.max(1, Math.floor(w / 3)), base = lot.kind === 'shop' ? 4 : 0, ph = (lot.floors - first) * 3;
      for (let k = 0; k < (lot.floors - first) * n * 2; k++) glassTone();   // the full tier's draws, kept (see the office above)
      panel(w, ph, 0.06, 0, base + ph / 2, d / 2 + 0.03, lot.color, n, lot.floors - first);
      panel(w, ph, 0.06, 0, base + ph / 2, -d / 2 - 0.03, lot.color, n, lot.floors - first);
      if (lot.kind === 'apartment') for (let f = 1; f < lot.floors; f++) put(b.detail, w - 0.6, 0.15, 1.0, 0, f * 3, d / 2 + 0.5, 0xd6d1c7);
    }
    for (let f = first; f < lot.floors && !light; f++) {
      const base = lot.kind === 'shop' ? 4 + (f - 1) * 3 : f * 3;
      const n = Math.max(1, Math.floor(w / 3));
      for (let k = 0; k < n; k++) {
        const x = -w / 2 + (k + 0.5) * (w / n);
        put(b.glass, 1.2, 1.3, 0.06, x, base + 1.6, d / 2 + 0.03, glassTone());
        put(b.glass, 1.2, 1.3, 0.06, x, base + 1.6, -d / 2 - 0.03, glassTone());
        put(b.detail, 1.6, 0.08, 0.5, x, base + 2.35, d / 2 + 0.25, shade(lot.color, 0.8));
      }
      if (lot.kind === 'apartment' && f >= 1) {
        put(b.detail, w - 0.6, 0.15, 1.0, 0, base, d / 2 + 0.5, 0xd6d1c7);
        put(b.detail, w - 0.6, 0.9, 0.05, 0, base + 0.5, d / 2 + 1.0, 0x6b7280);
      }
    }
    if (lot.kind === 'shop') {
      put(b.detail, w - 0.8, 2.8, 0.08, 0, 1.5, d / 2 + 0.04, r() < 0.5 ? 0x9aa0a6 : 0xffd27a);
      put(b.detail, w - 0.4, 0.12, 1.6, 0, 3.1, d / 2 + 0.8, AWNINGS[Math.floor(r() * AWNINGS.length) % AWNINGS.length]);
      put(b.detail, w - 1, 0.9, 0.12, 0, 3.75, d / 2 + 0.06, SIGNS[Math.floor(r() * SIGNS.length) % SIGNS.length]);
    } else {
      put(b.detail, 1.0, 2.1, 0.06, 0, 1.05 + 0.4, d / 2 + 0.03, 0x8b5a2b);
    }
    // Flat roof with a parapet and the black water tank on nearly every Indian roof.
    put(b.solid, w, 0.9, 0.2, 0, H + 0.45, d / 2 - 0.1, shade(lot.color, 0.9));
    put(b.solid, w, 0.9, 0.2, 0, H + 0.45, -d / 2 + 0.1, shade(lot.color, 0.9));
    put(b.solid, 0.2, 0.9, d, w / 2 - 0.1, H + 0.45, 0, shade(lot.color, 0.9));
    put(b.solid, 0.2, 0.9, d, -w / 2 + 0.1, H + 0.45, 0, shade(lot.color, 0.9));
    const tanks = lot.kind === 'apartment' ? 2 : 1;
    for (let k = 0; k < tanks; k++) {
      const lx = w / 2 - 1.2 - k * 1.8, lz = -d / 2 + 1.2;
      b.solid.add(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 10),
        new THREE.Matrix4().makeRotationY(rot).setPosition(fp.x + lx * s, top + H + 0.65, fp.z + lz * s), 0x1b1b1b);
    }
    if (lot.kind === 'house') {
      // A compound wall along the front of the yard with a gate gap at the entrance.
      const yardFront = d / 2 + (lot.depth - d - 0.4) - 0.1;
      const half = (w - 1.6) / 2;
      put(b.solid, half, 1.1, 0.2, -w / 2 + half / 2, 0.55, yardFront, 0xe5e0d5);
      put(b.solid, half, 1.1, 0.2, w / 2 - half / 2, 0.55, yardFront, 0xe5e0d5);
    }
  }
}

/** A park: grass, two crossing paths, trees away from the paths, benches and a fountain in the middle. */
function buildPark(b: Batches, plan: CityPlan, i: number, j: number, top: number, r: () => number, box: BoxFn): void {
  const { road, sidewalk, streetsX: X, streetsZ: Z } = plan;
  const x0 = X[i] + road / 2 + sidewalk, x1 = X[i + 1] - road / 2 - sidewalk;
  const z0 = Z[j] + road / 2 + sidewalk, z1 = Z[j + 1] - road / 2 - sidewalk;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  box(b.ground, w, 0.1, d, cx, top + 0.05, cz, 0x5f9e4f);
  box(b.ground, w, 0.02, 2.4, cx, top + 0.11, cz, 0xd8c9a3);
  box(b.ground, 2.4, 0.02, d, cx, top + 0.11, cz, 0xd8c9a3);
  b.solid.add(new THREE.CylinderGeometry(2.4, 2.6, 0.6, 18), new THREE.Matrix4().setPosition(cx, top + 0.4, cz), 0xa8a29e);
  b.detail.add(new THREE.CylinderGeometry(2.1, 2.1, 0.05, 18), new THREE.Matrix4().setPosition(cx, top + 0.68, cz), 0x4f9fd1);
  for (const [dx, dz, rot] of [[4, 2.2, 0], [-4, -2.2, Math.PI], [2.2, -4, Math.PI / 2], [-2.2, 4, -Math.PI / 2]] as const) {
    box(b.solid, 1.8, 0.45, 0.5, cx + dx, top + 0.33, cz + dz, 0x8b5a2b, rot);
  }
  const trees = Math.max(4, Math.round((w * d) / 70));
  for (let k = 0, tries = 0; k < trees && tries < trees * 8; tries++) {
    const tx = x0 + 1.5 + r() * (w - 3), tz = z0 + 1.5 + r() * (d - 3);
    if (Math.abs(tx - cx) < 2.5 || Math.abs(tz - cz) < 2.5) continue;
    b.solid.add(new THREE.CylinderGeometry(0.18, 0.26, 2.2, 6), new THREE.Matrix4().setPosition(tx, top + 1.1, tz), 0x6b4f2a);
    const size = 1.3 + r() * 0.8;
    b.detail.add(new THREE.IcosahedronGeometry(size, 0), new THREE.Matrix4().setPosition(tx, top + 2.2 + size * 0.8, tz), r() < 0.5 ? 0x3f7d3a : 0x4f8f45);
    k++;
  }
}
`;
