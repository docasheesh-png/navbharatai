// 🏘️ ATHREE MAP — COLONIES BETWEEN THE ROADS (admin 2026-11-27, wave 2 part 1: "frame → natural boundary → water → ground nobody falls
// through → roads → COLONIES of houses between the roads").
//
// Until this the planned road network (athreeRoadPlanSource.ts) handed out BLOCKS — land enclosed by roads on every side — and nothing
// built on them: a game that wanted a town put a separate, flat grid city on levelled ground at one height, beside the roads instead of
// between them. This is the step that fills the blocks, on the REAL terrain:
//
//   1. PLOTS. Each side of a block is cut into straight runs (one road, no sharp turn). A run is cut into plots behind a 3 m footpath,
//      every plot's front parallel to the road and facing it. A plot is kept only when it is dry (no river, lake, pond or sea under or
//      near it), off every road, junction pad and dead-end lane, inside the map's boundary, has real road access (the road is right in
//      front of its gate), and stands on ground gentle enough to level with a small cut and fill (else it is skipped and counted).
//   2. LEVELLING. A kept plot is one flat pad. The world's own heightAt answers the pad's height inside it and eases back to the land
//      over 1.5 m, so the drawn terrain, the physics heightfield and every mover agree on the same ground (no flat city at y = 0).
//   3. ZONING. Plots on a main road or highway are shops (offices and towers near the town centre); plots on colony streets and lanes
//      are homes. Blocks joined by colony streets are ONE colony (a main road or a highway separates colonies), and every colony gets a
//      park, a school, a temple, a clinic and a playground, made from neighbouring plots; the colony nearest the centre also gets a
//      hospital, and a colony with enough shops a market.
//   4. DENSITY. The planner's density (sparse village, normal, dense city) sets plot sizes, how many plots are built and the tallest
//      flats; height falls with distance from the town centre (tall flats in the middle, small houses at the edge).
//   5. TREES along every footpath and in the parks.
//   6. DRAWING. One merged mesh per 160 m tile (houses with compound walls and gates, flats with balconies and black roof water tanks,
//      shops with awnings and signboards, havelis with a chhatri, a temple shikhara, a school, a clinic with a red cross, parks and
//      playgrounds), streamed round the camera, nearest first, inside a per-tier triangle cap (COLONY_TIERS; budget.ts sets it
//      against the other modules) — one draw call per tile.
//
// HONEST LIMITS: houses have no physics collider (world.colonyAt(x, z) answers whether a place is inside a plot, for a game that wants
// to stop a body at a wall); people and traffic are not added by the colonies (the kit's city people and traffic follow the separate
// three/city grid, not this road graph — a game drives its own cars along world.roadNetwork().route(), in the left lane); a block that
// the road network did not close (a superblock cut by the shore) has no plots; plots line the roads, so the middle of a very large block
// stays open land.
//
// PURE source string; rule for editing: no backticks and no dollar-brace inside it.

import { GAME_WORLD_COLLIDER_KEY } from '../GameAssetRuntimeGenerator';

export const COLONIES = `// Athree map — colonies: plots facing the roads in every block, zoned (shops on main roads, homes inside, a park, school, temple,
// clinic and playground per colony), denser near the town centre, each plot levelled with cut and fill into the world's own height.
// Technique: every side of a block is walked as straight runs and cut into plots behind a footpath; oriented-rectangle tests (separating
// axes, point and segment distances) keep each plot off roads, junctions and water; union-find over shared colony streets groups blocks
// into colonies; buildings are merged into one mesh per tile and streamed nearest first inside a triangle cap. Own implementation.

import { mulberry32, drainSteps, type Steps } from './noise';
import type { AthreeQuality } from './config';
import type { Block } from './roads';
import type { AthreeWorld } from './world';

export type ColonyDensity = 'sparse' | 'normal' | 'dense';
export const COLONY_DENSITIES: readonly ColonyDensity[] = ['sparse', 'normal', 'dense'];
export type ColonyKind = 'house' | 'haveli' | 'flats' | 'tower' | 'shop' | 'market' | 'office' | 'school' | 'temple' | 'clinic' | 'hospital' | 'park' | 'playground';
export type ColonyZone = 'commercial' | 'residential' | 'civic' | 'green';
export const COLONY_ZONE: Record<ColonyKind, ColonyZone> = {
  house: 'residential', haveli: 'residential', flats: 'residential',
  tower: 'commercial', shop: 'commercial', market: 'commercial', office: 'commercial',
  school: 'civic', temple: 'civic', clinic: 'civic', hospital: 'civic',
  park: 'green', playground: 'green',
};
/** Road kinds whose frontage is commercial (shops, a market, offices). */
export const COLONY_MAIN_ROADS: readonly string[] = ['highway', 'main'];

/** The footpath between the kerb and a plot's front, metres. */
export const COLONY_FOOTPATH = 3;
/** The gap between two plots, metres (wider than the pad margin, so one plot's levelling never reaches another plot). */
export const COLONY_GAP = 1.6;
/** How far a plot's levelled pad eases back into the land around it, metres. */
export const COLONY_PAD_MARGIN = 1.5;
/** The most ground a plot cuts or fills, metres, and the steepest ground it levels (rise over the plot's diagonal). */
export const COLONY_MAX_CUT = 3.5;
export const COLONY_MAX_SLOPE = 0.2;
/** A plot whose nine ground points stay within this of its pad is not read on the full 5 x 5 grid (see measure). */
export const COLONY_SMOOTH_CUT = 1.5;

export interface ColonyPoint { x: number; z: number }

export interface ColonyPlot {
  id: number;
  colony: number;
  block: number;
  kind: ColonyKind;
  zone: ColonyZone;
  /** Centre of the plot. */
  x: number;
  z: number;
  /** Frontage along the road, and depth back from it, metres. */
  width: number;
  depth: number;
  /** Unit vector from the plot toward the road its front faces. */
  facing: ColonyPoint;
  /** Front-left, front-right, back-right, back-left (as seen from the road). */
  corners: ColonyPoint[];
  /** Height of the levelled pad: heightAt answers exactly this inside the plot. */
  y: number;
  /** The road the front faces (an id in roadNetwork().graph()), and its kind. */
  road: number;
  roadKind: string;
  /** The gate (middle of the front edge) and the entrance on the footpath just off the kerb, at ground height. */
  gate: ColonyPoint;
  entrance: { x: number; y: number; z: number };
  floors: number;
  /** Top of the building above the pad, metres (0 for a park or a playground). */
  height: number;
  color: number;
  /** 0 at the town centre, 1 at the farthest block corner, measured at the plot's gate. */
  ring: number;
}

export interface Colony {
  id: number;
  centre: ColonyPoint;
  blocks: number[];
  /** Ids of its plots. */
  plots: number[];
  ring: number;
}

export interface ColonyTree { x: number; y: number; z: number; scale: number; park: boolean }
/** Why candidate plots were not built (each is a real place that was measured and refused). */
export interface ColonySkips { water: number; road: number; steep: number; outside: number; access: number; crowded: number }

export interface ColonyPlan {
  density: ColonyDensity;
  /** The town centre the density falls away from. */
  centre: ColonyPoint;
  colonies: Colony[];
  plots: ColonyPlot[];
  trees: ColonyTree[];
  skipped: ColonySkips;
}

export interface ColonyInput {
  seed: number;
  density: ColonyDensity;
  blocks: ReadonlyArray<Block>;
  roadKind(road: number): string;
  /** A road's centre line with its paved width (used for the dead-end roads inside a block). */
  roadLine(road: number): ReadonlyArray<{ x: number; z: number; width: number }> | null;
  junctions: ReadonlyArray<{ x: number; z: number; radius: number }>;
  /** River centre lines with their widths, and round water (lakes, ponds with their banks). */
  rivers: ReadonlyArray<ReadonlyArray<{ x: number; z: number; width: number }>>;
  pools: ReadonlyArray<{ x: number; z: number; radius: number }>;
  /** The ground before any plot is levelled (the land with the roads carved in). */
  ground(x: number, z: number): number;
  /** A river, a lake or a pond at the point (the sea is ground below landLine). */
  wet(x: number, z: number): boolean;
  onRoad(x: number, z: number): boolean;
  /** Inside the map's boundary with a margin. */
  inside(x: number, z: number): boolean;
  landLine: number;
}

interface DensityRule { home: [number, number]; depth: [number, number]; shop: [number, number]; fill: number; maxFloors: number; haveli: number; treeEvery: number }
/** Plot frontage and depth ranges (metres), the share of home plots built, the tallest flats, how often a house is a haveli, tree spacing. */
export const COLONY_DENSITY: Record<ColonyDensity, DensityRule> = {
  sparse: { home: [15, 21], depth: [20, 26], shop: [10, 13], fill: 0.6, maxFloors: 3, haveli: 0.25, treeEvery: 11 },
  normal: { home: [11, 15], depth: [16, 22], shop: [8, 11], fill: 0.9, maxFloors: 8, haveli: 0.1, treeEvery: 13 },
  dense: { home: [8, 11], depth: [14, 18], shop: [6.5, 9], fill: 1, maxFloors: 14, haveli: 0.04, treeEvery: 16 },
};

/** Inside this ring (0 the centre, 1 the edge) every plot on a main road or highway is a shop; beyond it, about two in five are. */
export const COLONY_BAZAAR_RING = 0.5;
/** A colony of more blocks than this is split into neighbourhoods about COLONY_SPAN metres across (an old town of lanes is one web). */
export const COLONY_MAX_BLOCKS = 12;
export const COLONY_SPAN = 400;

/** A colony civic need: the kind and how many neighbouring plots it is made from (fewer when that many are not side by side). */
export const COLONY_NEEDS: ReadonlyArray<[ColonyKind, number]> = [['park', 3], ['school', 3], ['temple', 2], ['clinic', 2], ['playground', 2]];
/** A colony smaller than this many plots joins the nearest colony (so each colony can hold its park, school, temple and clinic). */
export const COLONY_MIN_PLOTS = 10;
/** A colony of at least this many plots may hold the town's hospital. */
export const COLONY_HOSPITAL_PLOTS = 24;

const WASH = [0xe9c46a, 0xf4a6a6, 0x9ec9e6, 0xf1e3c8, 0xc7e0b4, 0xe8b07a, 0xd7c3e6, 0xf6f1e7];
const OFFICE = [0x8fa3b0, 0xa7b4bd, 0x6f8796, 0xc9d3d9, 0x9aa5ad];

// ---- geometry ------------------------------------------------------------------------------------------------------------------------

/** An oriented rectangle: centre, u along the frontage, n from the road into the block, w along u, d along n. */
interface Rect { cx: number; cz: number; ux: number; uz: number; nx: number; nz: number; w: number; d: number }

function rectCorners(r: Rect): ColonyPoint[] {
  const hw = r.w / 2, hd = r.d / 2;
  // front-left, front-right, back-right, back-left (front is toward the road, -n).
  return [
    { x: r.cx - r.ux * hw - r.nx * hd, z: r.cz - r.uz * hw - r.nz * hd },
    { x: r.cx + r.ux * hw - r.nx * hd, z: r.cz + r.uz * hw - r.nz * hd },
    { x: r.cx + r.ux * hw + r.nx * hd, z: r.cz + r.uz * hw + r.nz * hd },
    { x: r.cx - r.ux * hw + r.nx * hd, z: r.cz - r.uz * hw + r.nz * hd },
  ];
}

/** Distance from a point to an oriented rectangle (0 inside). */
export function pointRectDistance(x: number, z: number, r: Rect): number {
  const px = x - r.cx, pz = z - r.cz;
  const u = Math.abs(px * r.ux + pz * r.uz) - r.w / 2;
  const v = Math.abs(px * r.nx + pz * r.nz) - r.d / 2;
  return Math.hypot(Math.max(0, u), Math.max(0, v));
}

function segPointDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function segsCross(a: ColonyPoint, b: ColonyPoint, c: ColonyPoint, d: ColonyPoint): boolean {
  const o = (p: ColonyPoint, q: ColonyPoint, r: ColonyPoint): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance from a segment to an oriented rectangle (0 when it touches or crosses it). */
export function segRectDistance(ax: number, az: number, bx: number, bz: number, r: Rect): number {
  const da = pointRectDistance(ax, az, r), db = pointRectDistance(bx, bz, r);
  if (da === 0 || db === 0) return 0;
  const c = rectCorners(r);
  const a = { x: ax, z: az }, b = { x: bx, z: bz };
  for (let i = 0; i < 4; i++) if (segsCross(a, b, c[i], c[(i + 1) % 4])) return 0;
  let m = Math.min(da, db);
  for (const p of c) m = Math.min(m, segPointDistance(p.x, p.z, ax, az, bx, bz));
  return m;
}

/** Do two oriented rectangles come closer than gap (separating axes on both rectangles' edges)? */
export function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  const axes: Array<[number, number]> = [[a.ux, a.uz], [a.nx, a.nz], [b.ux, b.uz], [b.nx, b.nz]];
  for (const [ax, az] of axes) {
    const ra = Math.abs(a.ux * ax + a.uz * az) * a.w / 2 + Math.abs(a.nx * ax + a.nz * az) * a.d / 2;
    const rb = Math.abs(b.ux * ax + b.uz * az) * b.w / 2 + Math.abs(b.nx * ax + b.nz * az) * b.d / 2;
    const dist = Math.abs((b.cx - a.cx) * ax + (b.cz - a.cz) * az);
    if (dist >= ra + rb + gap) return false;
  }
  return true;
}

function insidePolygon(pts: ReadonlyArray<ColonyPoint>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Five sample points of a rectangle grown by e: the centre and the four corners (roads and water near a plot are also tested by geometry). */
function samples(r: Rect, e: number): ColonyPoint[] {
  const g: Rect = { ...r, w: r.w + 2 * e, d: r.d + 2 * e };
  return [{ x: r.cx, z: r.cz }, ...rectCorners(g)];
}

/** A grid of 64 m cells over boxes, so a test looks only at what is near it (a town has hundreds of junctions and river pieces). */
class Grid<T> {
  private cells = new Map<string, T[]>();
  constructor(private cell = 64) {}
  add(item: T, x0: number, z0: number, x1: number, z1: number): void {
    for (let cx = Math.floor(x0 / this.cell); cx <= Math.floor(x1 / this.cell); cx++) {
      for (let cz = Math.floor(z0 / this.cell); cz <= Math.floor(z1 / this.cell); cz++) {
        const k = cx + ',' + cz; const l = this.cells.get(k); if (l) l.push(item); else this.cells.set(k, [item]);
      }
    }
  }
  near(x0: number, z0: number, x1: number, z1: number): T[] {
    const out = new Set<T>();
    for (let cx = Math.floor(x0 / this.cell); cx <= Math.floor(x1 / this.cell); cx++) {
      for (let cz = Math.floor(z0 / this.cell); cz <= Math.floor(z1 / this.cell); cz++) for (const t of this.cells.get(cx + ',' + cz) ?? []) out.add(t);
    }
    return [...out];
  }
}

// ---- the plan ------------------------------------------------------------------------------------------------------------------------

interface Run { points: ColonyPoint[]; road: number; half: number; rank: number; key: number }
interface Draft { rect: Rect; block: number; run: number; s0: number; s1: number; road: number; roadKind: string; y: number; access: ColonyPoint; half: number; kind: ColonyKind; floors: number; color: number }

const RANK: Record<string, number> = { highway: 3, main: 2, street: 1, lane: 0 };

/** Cut a block's polygon into straight runs (one road each, no turn sharper than about 20 degrees inside a run). */
function blockRuns(block: Block, roadKind: (road: number) => string): Run[] {
  const pts = block.polygon, n = pts.length;
  if (n < 3) return [];
  const edges: Array<{ a: ColonyPoint; b: ColonyPoint; road: number; half: number; ang: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) continue;
    edges.push({ a, b, road: block.sides[i] ? block.sides[i].road : -1, half: block.sides[i] ? block.sides[i].half : 3.5, ang: Math.atan2(b.z - a.z, b.x - a.x) });
  }
  if (edges.length < 3) return [];
  const turn = (p: number, q: number): number => { let d = q - p; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };
  // Start at an edge that begins a run (a road change or a sharp turn), so no run wraps round the start.
  let start = 0;
  for (let i = 0; i < edges.length; i++) {
    const p = edges[(i - 1 + edges.length) % edges.length], e = edges[i];
    if (p.road !== e.road || turn(p.ang, e.ang) > 0.35) { start = i; break; }
  }
  const runs: Run[] = [];
  let cur: { pts: ColonyPoint[]; road: number; half: number; ang: number } | null = null;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[(start + k) % edges.length];
    if (!cur || cur.road !== e.road || turn(cur.ang, e.ang) > 0.35) {
      if (cur) runs.push({ points: cur.pts, road: cur.road, half: cur.half, rank: RANK[roadKind(cur.road)] ?? 1, key: runs.length });
      cur = { pts: [e.a, e.b], road: e.road, half: e.half, ang: e.ang };
    } else { cur.pts.push(e.b); cur.half = Math.max(cur.half, e.half); }
  }
  if (cur) runs.push({ points: cur.pts, road: cur.road, half: cur.half, rank: RANK[roadKind(cur.road)] ?? 1, key: runs.length });
  return runs;
}

/** The colonies of a town: plots, their kinds and pads, colonies, trees. PURE and deterministic per seed. */
export function planColonies(input: ColonyInput): ColonyPlan {
  return drainSteps(planColonySteps(input));
}

/**
 * The same plan as planColonies, as steps (Q-3763): it pauses after every measured plot, civic plot and footpath, so a frame can plan a
 * few milliseconds of the town and the next frame go on. Run to its end it returns exactly what planColonies returns (it IS planColonies).
 */
export function* planColonySteps(input: ColonyInput): Steps<ColonyPlan> {
  const rule = COLONY_DENSITY[input.density] ?? COLONY_DENSITY.normal;
  const density: ColonyDensity = COLONY_DENSITY[input.density] ? input.density : 'normal';
  const skipped: ColonySkips = { water: 0, road: 0, steep: 0, outside: 0, access: 0, crowded: 0 };
  const blocks = input.blocks.filter((b) => b && b.polygon && b.polygon.length >= 3);
  // The town centre: the area-weighted middle of the blocks. Ring 0 there, 1 at the farthest block.
  let ax = 0, az = 0, at = 0;
  for (const b of blocks) { ax += b.centroid.x * b.area; az += b.centroid.z * b.area; at += b.area; }
  const centre = at > 0 ? { x: ax / at, z: az / at } : { x: 0, z: 0 };
  let reach = 1;
  for (const b of blocks) for (const p of b.polygon) reach = Math.max(reach, Math.hypot(p.x - centre.x, p.z - centre.z));
  const ringAt = (x: number, z: number): number => Math.min(1, Math.hypot(x - centre.x, z - centre.z) / reach);

  const blockDrafts = new Map<number, Draft[]>();
  const junctionGrid = new Grid<{ x: number; z: number; radius: number }>();
  for (const j of input.junctions) junctionGrid.add(j, j.x - j.radius, j.z - j.radius, j.x + j.radius, j.z + j.radius);
  const riverGrid = new Grid<{ ax: number; az: number; bx: number; bz: number; reach: number }>();
  for (const river of input.rivers) {
    for (let i = 0; i < river.length - 1; i++) {
      const a = river[i], b = river[i + 1], reach = Math.max(a.width, b.width) / 2 + 4;
      riverGrid.add({ ax: a.x, az: a.z, bx: b.x, bz: b.z, reach }, Math.min(a.x, b.x) - reach, Math.min(a.z, b.z) - reach, Math.max(a.x, b.x) + reach, Math.max(a.z, b.z) + reach);
    }
  }
  const poolGrid = new Grid<{ x: number; z: number; radius: number }>();
  for (const p of input.pools) poolGrid.add(p, p.x - p.radius - 3, p.z - p.radius - 3, p.x + p.radius + 3, p.z + p.radius + 3);

  /** Measure a plot rectangle on the real land: null and a reason when it may not be built, else its pad height and road access. */
  function measure(rect: Rect, block: Block, run: Run, others: ReadonlyArray<Draft>, skip: ReadonlyArray<Draft> = []): { y: number; access: ColonyPoint } | keyof ColonySkips {
    const c = rectCorners(rect);
    const probe = [{ x: rect.cx, z: rect.cz }, ...c];
    for (const p of probe) if (!insidePolygon(block.polygon, p.x, p.z)) return 'road';
    // Off every road round the block (the kerb is half its width from its centre line), with the footpath kept clear.
    const poly = block.polygon, n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const half = block.sides[i] ? block.sides[i].half : 3.5;
      if (segRectDistance(a.x, a.z, b.x, b.z, rect) < half + COLONY_FOOTPATH - 0.05) return 'road';
    }
    for (const id of block.inner) {
      const line = input.roadLine(id);
      if (!line) continue;
      for (let i = 0; i < line.length - 1; i++) if (segRectDistance(line[i].x, line[i].z, line[i + 1].x, line[i + 1].z, rect) < line[i].width / 2 + COLONY_PAD_MARGIN + 0.5) return 'road';
    }
    const rr = Math.hypot(rect.w, rect.d) / 2;
    for (const j of junctionGrid.near(rect.cx - rr - 2, rect.cz - rr - 2, rect.cx + rr + 2, rect.cz + rr + 2)) {
      if (pointRectDistance(j.x, j.z, rect) < j.radius + COLONY_PAD_MARGIN + 0.5) return 'road';
    }
    for (const o of others) if (!skip.includes(o) && rectsOverlap(rect, o.rect, COLONY_GAP)) return 'crowded';
    // Dry: no river, lake or pond under or beside it, and no sea.
    for (const g of riverGrid.near(rect.cx - rr, rect.cz - rr, rect.cx + rr, rect.cz + rr)) if (segRectDistance(g.ax, g.az, g.bx, g.bz, rect) < g.reach) return 'water';
    for (const p of poolGrid.near(rect.cx - rr, rect.cz - rr, rect.cx + rr, rect.cz + rr)) if (pointRectDistance(p.x, p.z, rect) < p.radius + 3) return 'water';
    // Water at the plot and just round it (where its pad eases back into the land); the road asked at the centre and the two front
    // corners (the geometry above already keeps every corner off the roads round the block, the lanes inside it and the junctions).
    const ring5 = samples(rect, COLONY_PAD_MARGIN);
    for (const p of ring5) if (input.wet(p.x, p.z)) return 'water';
    for (const k of [0, 1, 2]) if (input.onRoad(ring5[k].x, ring5[k].z)) return 'road';
    // The ground on a 5 x 5 grid over the plot: the nine points of its 3 x 3 sub-grid (corners, edge middles, centre) set the pad.
    const grid: number[] = [];
    const at = (i: number, j: number): number => {
      const u = (i / 4 - 0.5) * rect.w, v = (j / 4 - 0.5) * rect.d;
      return input.ground(rect.cx + rect.ux * u + rect.nx * v, rect.cz + rect.uz * u + rect.nz * v);
    };
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let i = 0; i <= 4; i += 2) for (let j = 0; j <= 4; j += 2) {
      const g = at(i, j);
      if (!Number.isFinite(g) || g < input.landLine + 0.3) return 'water';
      lo = Math.min(lo, g); hi = Math.max(hi, g); sum += g;
      grid.push(g);
    }
    for (const p of c) if (!input.inside(p.x, p.z)) return 'outside';
    // Road access: the road the front faces is right in front of the gate.
    const gx = (c[0].x + c[1].x) / 2, gz = (c[0].z + c[1].z) / 2;
    let best = Infinity, qx = gx, qz = gz;
    for (let i = 0; i < run.points.length - 1; i++) {
      const a = run.points[i], b = run.points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((gx - a.x) * dx + (gz - a.z) * dz) / l2));
      const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(gx - px, gz - pz);
      if (d < best) { best = d; qx = px; qz = pz; }
    }
    if (best > run.half + COLONY_FOOTPATH + 2.5) return 'access';
    const tx = qx + ((gx - qx) / (best || 1)) * (run.half + 1.2), tz = qz + ((gz - qz) / (best || 1)) * (run.half + 1.2);
    if (!input.onRoad(qx + ((gx - qx) / (best || 1)) * Math.max(0, run.half - 1), qz + ((gz - qz) / (best || 1)) * Math.max(0, run.half - 1))) return 'access';
    // Level ground: the pad sits near the mean, within a step of the footpath in front, and cuts or fills no more than the limit.
    const front = input.ground(tx, tz);
    const y = Math.min(front + 1.2, Math.max(front - 1.2, sum / grid.length));
    const diag = Math.hypot(rect.w, rect.d);
    if (hi - lo > COLONY_MAX_SLOPE * diag || Math.max(hi - y, y - lo) > COLONY_MAX_CUT) return 'steep';
    if (y < input.landLine + 0.5) return 'water';
    // A plot that passed every test above is read at the other 16 points of the 5 x 5 grid: a bump or a road's fill between the nine
    // points must not hide a cut or fill past the limit (a hill town's ground is not a plane).
    // Ground that the nine points already find within COLONY_SMOOTH_CUT of the pad is gentle enough (the land's finest detail is
    // ~260 m across, so it cannot hide a step of the remaining ~2 m between points under 13 m apart): only a plot that already cuts or
    // fills more than that is read on the full grid. The 25-point test in AthreeColonies.test.ts holds this on six kinds of town.
    if (Math.max(hi - y, y - lo) > COLONY_SMOOTH_CUT) for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      if (i % 2 === 0 && j % 2 === 0) continue;
      const g = at(i, j);
      if (!Number.isFinite(g) || g < input.landLine + 0.3) return 'water';
      if (Math.abs(g - y) > COLONY_MAX_CUT) return 'steep';
    }
    return { y, access: { x: tx, z: tz } };
  }

  function floorsFor(kind: ColonyKind, ring: number, r: () => number): number {
    const k = Math.pow(1 - ring, 1.6);
    const target = 1 + (rule.maxFloors - 1) * k * (0.75 + 0.5 * r());
    switch (kind) {
      case 'tower': return Math.max(10, Math.round(target * 1.4));
      case 'office': return Math.max(4, Math.round(target));
      case 'flats': return Math.max(4, Math.round(target));
      case 'shop': return Math.max(1, Math.min(4, Math.round(target * 0.5) + 1));
      case 'haveli': return 2 + (r() < 0.4 ? 1 : 0);
      default: return Math.max(1, Math.min(3, Math.round(target)));
    }
  }

  function kindFor(commercial: boolean, ring: number, roadKind: string, width: number, r: () => number): ColonyKind {
    if (commercial) {
      if (density !== 'sparse' && ring < 0.18 && roadKind === 'highway' && r() < 0.5) return 'tower';
      if (density !== 'sparse' && ring < 0.35 && r() < 0.3) return 'office';
      return 'shop';
    }
    const k = Math.pow(1 - ring, 1.6);
    const target = 1 + (rule.maxFloors - 1) * k;
    if (target >= 4 && r() < 0.8) return 'flats';
    if (width >= 12 && r() < rule.haveli * (0.5 + ring)) return 'haveli';
    return 'house';
  }

  // ---- 1. plots along every run of every block (main roads first, so the shops get the corners) ----------------------------------
  for (const block of blocks) {
    const r = mulberry32((input.seed * 7919 + block.id * 104729 + 13) | 0);
    const runs = blockRuns(block, input.roadKind).sort((a, b) => b.rank - a.rank || a.key - b.key);
    const mine: Draft[] = [];
    blockDrafts.set(block.id, mine);
    for (const run of runs) {
      const a = run.points[0], b = run.points[run.points.length - 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 12) continue;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      // The block is on the left of a counter-clockwise run: inward is (-uz, ux).
      const nx = -uz, nz = ux;
      // A bent run bows: the frontage line sits behind its innermost point.
      let bow = 0;
      for (const p of run.points) bow = Math.max(bow, (p.x - a.x) * nx + (p.z - a.z) * nz);
      const inset = run.half + COLONY_FOOTPATH + bow + 0.05;
      const roadKind = input.roadKind(run.road);
      const mainRoad = COLONY_MAIN_ROADS.includes(roadKind);
      let s = 4;
      while (s < L - 6) {
        // A main road is a bazaar near the centre and mostly homes farther out (shops on it, never on a colony street).
        // The ring is measured at the gate (the middle of the plot's front), for a shop-wide and a home-wide plot alike.
        const wShop = rule.shop[0] + (rule.shop[1] - rule.shop[0]) * r();
        const wHome = rule.home[0] + (rule.home[1] - rule.home[0]) * r();
        const gateRing = (w: number): number => ringAt(a.x + ux * (s + w / 2) + nx * inset, a.z + uz * (s + w / 2) + nz * inset);
        const commercial = mainRoad && (Math.min(gateRing(wShop), gateRing(wHome)) < COLONY_BAZAAR_RING || r() < 0.4);
        const w = commercial ? wShop : wHome;
        if (s + w > L - 3) break;
        const ring = gateRing(w);
        if (!commercial && r() > rule.fill) { s += w + COLONY_GAP; yield; continue; }
        const dTarget = (rule.depth[0] + (rule.depth[1] - rule.depth[0]) * r()) * (commercial ? 0.85 : 1);
        let placed = false;
        let reason: keyof ColonySkips = 'crowded';
        for (const d of [dTarget, dTarget * 0.75, dTarget * 0.55]) {
          if (d < 8) break;
          const fx = a.x + ux * (s + w / 2) + nx * inset, fz = a.z + uz * (s + w / 2) + nz * inset;
          const rect: Rect = { cx: fx + nx * d / 2, cz: fz + nz * d / 2, ux, uz, nx, nz, w, d };
          const m = measure(rect, block, run, mine);
          if (typeof m === 'string') { reason = m; if (m !== 'crowded' && m !== 'road' && m !== 'steep') break; continue; }
          const kind = kindFor(commercial, ring, roadKind, w, r);
          const draft: Draft = { rect, block: block.id, run: run.key, s0: s, s1: s + w, road: run.road, roadKind, y: m.y, access: m.access, half: run.half, kind, floors: floorsFor(kind, ring, r), color: kind === 'office' || kind === 'tower' ? OFFICE[Math.floor(r() * OFFICE.length) % OFFICE.length] : WASH[Math.floor(r() * WASH.length) % WASH.length] };
          mine.push(draft);
          placed = true;
          break;
        }
        if (placed) s += w + COLONY_GAP;
        else { skipped[reason]++; s += Math.max(3, w / 2); }
        yield;
      }
    }
  }

  // ---- 2. colonies: blocks joined by a colony street (or lane) are one colony; a main road or highway separates them ---------------
  const parent = new Map<number, number>();
  const find = (k: number): number => { let x = k; while (parent.get(x) !== x) x = parent.get(x)!; let y = k; while (parent.get(y) !== x) { const nx = parent.get(y)!; parent.set(y, x); y = nx; } return x; };
  for (const b of blocks) parent.set(b.id, b.id);
  const byRoad = new Map<number, number[]>();
  for (const b of blocks) for (const sd of b.sides) {
    if (COLONY_MAIN_ROADS.includes(input.roadKind(sd.road))) continue;
    const l = byRoad.get(sd.road) ?? [];
    if (!l.includes(b.id)) l.push(b.id);
    byRoad.set(sd.road, l);
  }
  for (const l of byRoad.values()) for (let i = 1; i < l.length; i++) parent.set(find(l[i]), find(l[0]));
  let groups = new Map<number, number[]>();
  for (const b of blocks) { const g = find(b.id); const l = groups.get(g) ?? []; l.push(b.id); groups.set(g, l); }
  // A web of lanes with no main road through it would be one colony with one school: split it into neighbourhoods.
  for (const [g, bl] of [...groups.entries()]) {
    if (bl.length <= COLONY_MAX_BLOCKS) continue;
    groups.delete(g);
    const parts = new Map<string, number[]>();
    for (const id of bl) {
      const b = blocks.find((x) => x.id === id)!;
      const k = Math.floor(b.centroid.x / COLONY_SPAN) + ',' + Math.floor(b.centroid.z / COLONY_SPAN);
      const l = parts.get(k) ?? []; l.push(id); parts.set(k, l);
    }
    for (const l of parts.values()) groups.set(Math.min(...l), l);
  }
  const plotsIn = (bl: number[]): Draft[] => bl.flatMap((id) => blockDrafts.get(id) ?? []);
  const countIn = (bl: number[]): number => { let n = 0; for (const id of bl) n += (blockDrafts.get(id) ?? []).length; return n; };
  const centreOf = (bl: number[]): ColonyPoint => {
    const ds = plotsIn(bl);
    if (ds.length) return { x: ds.reduce((t, d) => t + d.rect.cx, 0) / ds.length, z: ds.reduce((t, d) => t + d.rect.cz, 0) / ds.length };
    const bs = blocks.filter((b) => bl.includes(b.id));
    return { x: bs.reduce((t, b) => t + b.centroid.x, 0) / Math.max(1, bs.length), z: bs.reduce((t, b) => t + b.centroid.z, 0) / Math.max(1, bs.length) };
  };
  // A colony too small for its own park, school, temple and clinic joins its nearest neighbour.
  for (let guard = 0; guard < 10000; guard++) {
    const list = [...groups.entries()].filter(([, bl]) => countIn(bl) > 0);
    if (list.length < 2) { groups = new Map(list); break; }
    const small = list.filter(([, bl]) => countIn(bl) < COLONY_MIN_PLOTS).sort((p, q) => countIn(p[1]) - countIn(q[1]))[0];
    if (!small) { groups = new Map(list); break; }
    const sc = centreOf(small[1]);
    let best: [number, number[]] | null = null, bd = Infinity;
    for (const g of list) { if (g[0] === small[0]) continue; const c = centreOf(g[1]); const d = Math.hypot(c.x - sc.x, c.z - sc.z); if (d < bd) { bd = d; best = g; } }
    if (!best) break;
    groups.delete(small[0]);
    groups.set(best[0], best[1].concat(small[1]));
    for (const [k, v] of [...groups.entries()]) if (countIn(v) === 0) groups.delete(k);
    yield;
  }

  // ---- 3. every colony's park, school, temple, clinic and playground (a hospital nearest the centre, a market where shops are) -------
  const colonyBlocks = [...groups.values()].filter((bl) => plotsIn(bl).length > 0).sort((p, q) => Math.min(...p) - Math.min(...q));
  const colonyCentres = colonyBlocks.map(centreOf);
  // The hospital goes to the colony nearest the centre that is big enough for one (or, when none is, the biggest).
  let central = -1;
  colonyCentres.forEach((c, i) => {
    if (countIn(colonyBlocks[i]) < COLONY_HOSPITAL_PLOTS) return;
    if (central < 0 || Math.hypot(c.x - centre.x, c.z - centre.z) < Math.hypot(colonyCentres[central].x - centre.x, colonyCentres[central].z - centre.z)) central = i;
  });
  if (central < 0) colonyBlocks.forEach((bl, i) => { if (central < 0 || countIn(bl) > countIn(colonyBlocks[central])) central = i; });
  const runOf = new Map<Draft, Run>();
  for (const block of blocks) {
    const runs = blockRuns(block, input.roadKind);
    for (const d of blockDrafts.get(block.id) ?? []) { const rr = runs.find((x) => x.key === d.run); if (rr) runOf.set(d, rr); }
    yield;
  }
  function* convert(bl: number[], kind: ColonyKind, k: number, from: (d: Draft) => boolean, c: ColonyPoint, r: () => number): Steps<boolean> {
    const pool = plotsIn(bl).filter(from).sort((p, q) => Math.hypot(p.rect.cx - c.x, p.rect.cz - c.z) - Math.hypot(q.rect.cx - c.x, q.rect.cz - c.z));
    for (let want = k; want >= 1; want--) {
      for (const first of pool) {
        const line = (blockDrafts.get(first.block) ?? []).filter((d) => d.run === first.run && from(d)).sort((p, q) => p.s0 - q.s0);
        const i = line.indexOf(first);
        const group = line.slice(i, i + want);
        if (group.length < want) continue;
        let joined = true;
        for (let g = 1; g < group.length; g++) if (group[g].s0 - group[g - 1].s1 > COLONY_GAP + 0.6) joined = false;
        if (!joined) continue;
        const run = runOf.get(first);
        const block = blocks.find((b) => b.id === first.block);
        if (!run || !block) continue;
        let rect = first.rect;
        if (want > 1) {
          const last = group[group.length - 1];
          const d = Math.min(...group.map((x) => x.rect.d));
          const w = last.s1 - first.s0;
          const mid = (first.s0 + last.s1) / 2 - (first.s0 + first.s1) / 2;
          // The joined plot keeps the first plot's front line, so it faces the same road from the same set-back.
          const fx = first.rect.cx - first.rect.nx * first.rect.d / 2 + first.rect.ux * mid, fz = first.rect.cz - first.rect.nz * first.rect.d / 2 + first.rect.uz * mid;
          rect = { ...first.rect, cx: fx + first.rect.nx * d / 2, cz: fz + first.rect.nz * d / 2, w, d };
        }
        const m = measure(rect, block, run, blockDrafts.get(first.block) ?? [], group);
        yield;
        if (typeof m === 'string') continue;
        const merged: Draft = { ...first, rect, s1: group[group.length - 1].s1, y: m.y, access: m.access, kind, floors: civicFloors(kind, r), color: civicColor(kind) };
        const list = blockDrafts.get(first.block)!;
        for (const g of group) list.splice(list.indexOf(g), 1);
        list.push(merged);
        return true;
      }
    }
    return false;
  }
  const isHome = (d: Draft): boolean => COLONY_ZONE[d.kind] === 'residential';
  const notCivic = (d: Draft): boolean => COLONY_ZONE[d.kind] === 'residential' || COLONY_ZONE[d.kind] === 'commercial';
  for (let ci = 0; ci < colonyBlocks.length; ci++) {
    const bl = colonyBlocks[ci];
    const r = mulberry32((input.seed * 31 + ci * 977 + 5) | 0);
    const c = colonyCentres[ci];
    const needs: Array<[ColonyKind, number]> = [...COLONY_NEEDS];
    if (ci === central) needs.splice(3, 0, ['hospital', 3]);
    for (const [kind, k] of needs) if (!(yield* convert(bl, kind, k, isHome, c, r))) yield* convert(bl, kind, 1, notCivic, c, r);
    if (plotsIn(bl).filter((d) => d.kind === 'shop').length >= 6) yield* convert(bl, 'market', 3, (d) => d.kind === 'shop', c, r);
    yield;
  }

  // ---- 4. the final plots, colonies and trees ---------------------------------------------------------------------------------------
  const plots: ColonyPlot[] = [];
  const colonies: Colony[] = [];
  for (let ci = 0; ci < colonyBlocks.length; ci++) {
    const bl = colonyBlocks[ci];
    const ids: number[] = [];
    const ordered = plotsIn(bl).slice().sort((p, q) => p.block - q.block || p.run - q.run || p.s0 - q.s0);
    for (const d of ordered) {
      const c = rectCorners(d.rect);
      const kind = d.kind;
      const gate = { x: (c[0].x + c[1].x) / 2, z: (c[0].z + c[1].z) / 2 };
      const height = kind === 'park' || kind === 'playground' ? 0 : buildingHeight(kind, d.floors);
      const id = plots.length;
      ids.push(id);
      plots.push({
        id, colony: ci, block: d.block, kind, zone: COLONY_ZONE[kind], x: d.rect.cx, z: d.rect.cz, width: d.rect.w, depth: d.rect.d,
        facing: { x: -d.rect.nx, z: -d.rect.nz }, corners: c, y: d.y, road: d.road, roadKind: d.roadKind, gate,
        entrance: { x: d.access.x, y: input.ground(d.access.x, d.access.z), z: d.access.z }, floors: kind === 'park' || kind === 'playground' ? 0 : d.floors,
        height, color: d.color, ring: ringAt(gate.x, gate.z),
      });
      if ((id & 15) === 15) yield;
    }
    colonies.push({ id: ci, centre: colonyCentres[ci], blocks: bl.slice().sort((p, q) => p - q), plots: ids, ring: ringAt(colonyCentres[ci].x, colonyCentres[ci].z) });
    yield;
  }

  const trees: ColonyTree[] = [];
  const plotGrid = new Grid<ColonyPlot>();
  for (const p of plots) { const r = Math.hypot(p.width, p.depth) / 2 + 4; plotGrid.add(p, p.x - r, p.z - r, p.x + r, p.z + r); }
  const near = (x: number, z: number): ColonyPlot[] => plotGrid.near(x, z, x, z);
  const rectOf = (p: ColonyPlot): Rect => ({ cx: p.x, cz: p.z, ux: -p.facing.z, uz: p.facing.x, nx: -p.facing.x, nz: -p.facing.z, w: p.width, d: p.depth });
  for (const block of blocks) {
    const r = mulberry32((input.seed * 131 + block.id * 7 + 3) | 0);
    const poly = block.polygon, n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const half = block.sides[i] ? block.sides[i].half : 3.5;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 4) continue;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, nx = -uz, nz = ux;
      for (let s = rule.treeEvery * (0.3 + 0.4 * r()); s < L; s += rule.treeEvery) {
        const x = a.x + ux * s + nx * (half + 1.3), z = a.z + uz * s + nz * (half + 1.3);
        if (!insidePolygon(poly, x, z)) continue;
        let ok = true;
        for (let k = 0; k < n && ok; k++) { const p = poly[k], q = poly[(k + 1) % n]; if (segPointDistance(x, z, p.x, p.z, q.x, q.z) < (block.sides[k] ? block.sides[k].half : 3.5) + 0.9) ok = false; }
        for (const j of junctionGrid.near(x - 2, z - 2, x + 2, z + 2)) if (ok && Math.hypot(j.x - x, j.z - z) < j.radius + 2) ok = false;
        // Geometry above keeps a tree 0.9 m off every kerb and junction round its block; the road itself is asked once more.
        if (!ok || near(x, z).some((p) => pointRectDistance(x, z, rectOf(p)) < 0.8 || Math.hypot(p.entrance.x - x, p.entrance.z - z) < 3.5)) continue;
        if (!input.inside(x, z) || input.onRoad(x, z) || input.wet(x, z)) continue;
        const gy = input.ground(x, z);
        if (gy < input.landLine + 0.3) continue;
        trees.push({ x, y: gy, z, scale: 0.8 + 0.5 * r(), park: false });
      }
      yield;
    }
  }
  for (const p of plots) {
    if (p.kind !== 'park' && p.kind !== 'playground') continue;
    const r = mulberry32((input.seed * 17 + p.id * 101 + 9) | 0);
    const count = p.kind === 'park' ? 5 + Math.floor(r() * 5) : 2;
    const rect = rectOf(p);
    for (let k = 0; k < count; k++) {
      const u = (r() - 0.5) * Math.max(0, p.width - 4), v = (r() - 0.5) * Math.max(0, p.depth - 4);
      const x = p.x + rect.ux * u + rect.nx * v, z = p.z + rect.uz * u + rect.nz * v;
      // Keep the middle of a park (its fountain) and of a playground (its swings) clear.
      if (Math.abs(u) < 3 && Math.abs(v) < 3) continue;
      trees.push({ x, y: p.y, z, scale: 0.9 + 0.6 * r(), park: true });
    }
  }
  return { density, centre, colonies, plots, trees, skipped };
}

function civicFloors(kind: ColonyKind, r: () => number): number {
  switch (kind) {
    case 'school': return 2 + (r() < 0.5 ? 1 : 0);
    case 'hospital': return 4 + Math.floor(r() * 3);
    case 'clinic': return 2;
    case 'temple': return 1;
    case 'market': return 1 + (r() < 0.4 ? 1 : 0);
    default: return 0;
  }
}

function civicColor(kind: ColonyKind): number {
  switch (kind) {
    case 'school': return 0xf2c14e;
    case 'hospital': case 'clinic': return 0xf7f7f2;
    case 'temple': return 0xf4a259;
    case 'market': return 0xe76f51;
    case 'park': return 0x6aa84f;
    case 'playground': return 0xc9a66b;
    default: return 0xf1e3c8;
  }
}

/** Top of a building above its pad, metres. */
export function buildingHeight(kind: ColonyKind, floors: number): number {
  if (kind === 'temple') return 13;
  if (kind === 'park' || kind === 'playground') return 0;
  return floors * 3.1 + (kind === 'flats' || kind === 'hospital' ? 1.6 : 0.6);
}

// ---- footpaths (Q-3762: the people of the colonies walk here) --------------------------------------------------------------------------

/** How far a footpath's walking line runs from the kerb, metres (inside the 3 m footpath, behind the trees at 1.3 m). */
export const COLONY_WALK_LINE = 2.4;

/** A walking line along a footpath: closed round a block, or open where a road, a plot or water cut it. */
export interface ColonyFootpath { block: number; points: ColonyPoint[]; closed: boolean; length: number }

/**
 * The footpaths of the blocks: each block's road centre lines inset by their own half width and COLONY_WALK_LINE, sampled every 2 m and
 * cut wherever ok(x, z) is false (a road, a junction pad, a plot, water, outside the map), so nobody is ever led onto a road or into a house.
 * PURE given ok.
 */
export function footpathPaths(blocks: ReadonlyArray<Block>, ok: (x: number, z: number) => boolean): ColonyFootpath[] {
  const out: ColonyFootpath[] = [];
  for (const block of blocks) {
    const poly = block.polygon, n = poly.length;
    if (n < 3) continue;
    // One offset line per side (the block is on the left of its counter-clockwise sides), joined at the corners by their meeting point.
    const lines: Array<{ ax: number; az: number; bx: number; bz: number; ux: number; uz: number } | null> = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-6) { lines.push(null); continue; }
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, nx = -uz, nz = ux;
      const d = (block.sides[i] ? block.sides[i].half : 3.5) + COLONY_WALK_LINE;
      lines.push({ ax: a.x + nx * d, az: a.z + nz * d, bx: b.x + nx * d, bz: b.z + nz * d, ux, uz });
    }
    const ring: ColonyPoint[] = [];
    for (let i = 0; i < n; i++) {
      const l0 = lines[(i - 1 + n) % n], l1 = lines[i];
      if (!l1) continue;
      if (!l0) { ring.push({ x: l1.ax, z: l1.az }); continue; }
      const cr = l0.ux * l1.uz - l0.uz * l1.ux;
      let p = { x: (l0.bx + l1.ax) / 2, z: (l0.bz + l1.az) / 2 };
      if (Math.abs(cr) > 0.05) {
        const t = ((l1.ax - l0.ax) * l1.uz - (l1.az - l0.az) * l1.ux) / cr;
        const q = { x: l0.ax + l0.ux * t, z: l0.az + l0.uz * t };
        if (Math.hypot(q.x - poly[i].x, q.z - poly[i].z) < 30) p = q;
      }
      ring.push(p);
    }
    if (ring.length < 3) continue;
    // Sampled every 2 m round the ring; cut into runs of good points.
    const samples: Array<{ x: number; z: number; good: boolean }> = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(L / 2));
      for (let j = 0; j < k; j++) { const x = a.x + ((b.x - a.x) * j) / k, z = a.z + ((b.z - a.z) * j) / k; samples.push({ x, z, good: ok(x, z) }); }
    }
    const all = samples.every((q) => q.good);
    const lengthOf = (pts: ColonyPoint[], closed: boolean): number => {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      return closed && pts.length > 1 ? len + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) : len;
    };
    if (all) { const pts = samples.map((q) => ({ x: q.x, z: q.z })); out.push({ block: block.id, points: pts, closed: true, length: lengthOf(pts, true) }); continue; }
    // Start just after a bad point so no run wraps round the start.
    const first = samples.findIndex((q) => !q.good);
    let run: ColonyPoint[] = [];
    const flush = (): void => { if (run.length >= 4) { const len = lengthOf(run, false); if (len >= 8) out.push({ block: block.id, points: run, closed: false, length: len }); } run = []; };
    for (let k = 1; k <= samples.length; k++) {
      const q = samples[(first + k) % samples.length];
      if (q.good) run.push({ x: q.x, z: q.z }); else flush();
    }
    flush();
  }
  return out;
}

// ---- drawing -------------------------------------------------------------------------------------------------------------------------

/**
 * Per quality tier: how far colonies are drawn, the most triangles they may take, tiles built per update, and how much detail; and how far
 * from the camera a drawn tile also carries its physics wall (physicsRadius, Q-3761: every body and car near the player is stopped by the
 * houses; a tile farther than that has no collider at all, so far colonies cost the physics nothing).
 */
export interface ColonyTier { radius: number; maxTriangles: number; buildsPerUpdate: number; detail: 0 | 1 | 2; physicsRadius: number }
export const COLONY_TIERS: Record<AthreeQuality, ColonyTier> = {
  phone: { radius: 260, maxTriangles: 10000, buildsPerUpdate: 1, detail: 0, physicsRadius: 160 },
  mid: { radius: 420, maxTriangles: 10000, buildsPerUpdate: 2, detail: 1, physicsRadius: 200 },
  desktop: { radius: 800, maxTriangles: 26000, buildsPerUpdate: 3, detail: 2, physicsRadius: 240 },
};
/**
 * The game kit's world-collider mark (three/collision.ts markWorldCollider: the character controller, every driven car and every kit
 * character collide with meshes marked 'solid' and pass meshes marked 'none'). A tile's drawn mesh is 'none' and its invisible wall mesh is
 * 'solid', so a body meets the wall boxes (colonyColliderBoxes), never the awnings and crowns drawn over its head.
 */
export const COLONY_COLLIDER_KEY = ` + JSON.stringify(GAME_WORLD_COLLIDER_KEY) + `;
/** The wall geometry of one tile (positions only, relative to the tile corner), and how many boxes made it. */
export function colonyColliderArrays(tile: { ix: number; iz: number; plots: ReadonlyArray<ColonyPlot>; trees: ReadonlyArray<ColonyTree> }, detail: 0 | 1 | 2): { position: Float32Array; normal: Float32Array; boxes: number; triangles: number } {
  const out = { p: [] as number[], n: [] as number[], c: [] as number[] };
  const ox = tile.ix * COLONY_TILE, oz = tile.iz * COLONY_TILE;
  const boxes = colonyColliderBoxes(tile, detail);
  for (const b of boxes) boxInto(out, ox, oz, b.x, b.y0, b.z, b.w, b.h, b.d, b.ux, b.uz, 0);
  return { position: Float32Array.from(out.p), normal: Float32Array.from(out.n), boxes: boxes.length, triangles: out.p.length / 9 };
}
/** Side of a streamed colony tile, metres: one merged mesh (one draw call) per tile. */
export const COLONY_TILE = 160;

/** The merged geometry of one tile, relative to its corner (x0, z0): plain arrays, so it is measured without three.js. */
export interface ColonyTileArrays { position: Float32Array; normal: Float32Array; color: Float32Array; triangles: number }

/** A box (no bottom face, ten triangles) standing on y0: w along (ux, uz), d along the perpendicular, h tall. */
function boxInto(out: { p: number[]; n: number[]; c: number[] }, ox: number, oz: number, cx: number, y0: number, cz: number, w: number, h: number, d: number, ux: number, uz: number, color: number): void {
  const nx = -uz, nz = ux;
  const hw = w / 2, hd = d / 2;
  const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  const P = (su: number, sv: number, y: number): [number, number, number] => [cx - ox + ux * su * hw + nx * sv * hd, y, cz - oz + uz * su * hw + nz * sv * hd];
  const quad = (a: [number, number, number], bq: [number, number, number], cq: [number, number, number], dq: [number, number, number], fx: number, fy: number, fz: number, shade: number): void => {
    for (const v of [a, bq, cq, a, cq, dq]) { out.p.push(v[0], v[1], v[2]); out.n.push(fx, fy, fz); out.c.push(r * shade, g * shade, b * shade); }
  };
  const y1 = y0 + h;
  quad(P(-1, -1, y1), P(-1, 1, y1), P(1, 1, y1), P(1, -1, y1), 0, 1, 0, 1);
  quad(P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1), -nx, 0, -nz, 0.92);
  quad(P(1, 1, y0), P(-1, 1, y0), P(-1, 1, y1), P(1, 1, y1), nx, 0, nz, 0.8);
  quad(P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1), ux, 0, uz, 0.86);
  quad(P(-1, 1, y0), P(-1, -1, y0), P(-1, -1, y1), P(-1, 1, y1), -ux, 0, -uz, 0.86);
}

/**
 * 🧱 One box of a colony, in WORLD metres: centre (x, z), standing on y0, h tall, w along (ux, uz) and d across it. A SOLID box is a wall a
 * body or a car cannot pass (Q-3761): the building, a compound wall (its gate gap stays open), a temple, a swing frame, a tree trunk. What is
 * not solid is the ground slab of a park, an awning or a signboard over the footpath, a balcony, a roof tank, a flag: drawn, never in the way.
 */
export interface ColonyBox { x: number; z: number; y0: number; h: number; w: number; d: number; ux: number; uz: number }
type BoxSink = (b: ColonyBox, color: number, solid: boolean) => void;

/** Every triangle of one plot's building at a detail level (0: phone, 1: mid, 2: desktop), into the tile arrays. */
export function plotGeometry(out: { p: number[]; n: number[]; c: number[] }, ox: number, oz: number, plot: ColonyPlot, detail: 0 | 1 | 2): void {
  plotBoxes(plot, detail, (b, color) => boxInto(out, ox, oz, b.x, b.y0, b.z, b.w, b.h, b.d, b.ux, b.uz, color));
}

/**
 * The boxes one plot is drawn with at a detail level, each said solid or not. The ONE description of a plot: the drawing (plotGeometry), the
 * physics wall (colonyColliderBoxes, the per-tile collider) and world.colonySolidAt all read it, so a wall is exactly where a wall is drawn.
 */
export function plotBoxes(plot: ColonyPlot, detail: 0 | 1 | 2, sink: BoxSink): void {
  const ux = -plot.facing.z, uz = plot.facing.x;
  const fx = plot.facing.x, fz = plot.facing.z;
  const y = plot.y;
  const box = (along: number, back: number, y0: number, w: number, h: number, d: number, color: number, solid = true): void => {
    // along: offset along the frontage; back: offset from the plot centre away from the road.
    sink({ x: plot.x + ux * along - fx * back, z: plot.z + uz * along - fz * back, y0, h, w, d, ux, uz }, color, solid);
  };
  const W = plot.width, D = plot.depth, H = plot.height;
  // A plinth from below the pad's lowest eased edge to just above it: a slope never shows a gap under a building.
  const plinth = 1.6;
  switch (plot.kind) {
    case 'park': {
      box(0, 0, y - 0.3, W, 0.36, D, 0x5d9b45, false);
      if (detail >= 1) { box(0, 0, y, 2.2, 0.8, 2.2, 0xb8b8b8); box(-W / 4, 0, y, 1.6, 0.45, 0.5, 0x8b5a2b, false); box(W / 4, 0, y, 1.6, 0.45, 0.5, 0x8b5a2b, false); }
      if (detail >= 2) box(0, 0, y + 0.8, 1, 1.2, 1, 0x9fc5e8, false);
      return;
    }
    case 'playground': {
      box(0, 0, y - 0.3, W, 0.34, D, 0xc9a66b, false);
      box(-W / 5, 0, y, 3, 2.4, 0.2, 0xd62828);
      if (detail >= 1) { box(W / 5, D / 6, y, 1.2, 1.8, 3.5, 0x2a9d8f); box(-W / 5, 0, y + 2.3, 3, 0.15, 1.6, 0xd62828, false); }
      return;
    }
    default: break;
  }
  const bw = Math.max(4, W - (plot.kind === 'house' || plot.kind === 'haveli' || plot.kind === 'school' ? 3 : 1.4));
  const bd = Math.max(4, D - (plot.kind === 'shop' || plot.kind === 'market' ? 2 : 4));
  const back = (D - bd) / 2 - (plot.kind === 'shop' || plot.kind === 'market' ? 0.5 : 0);
  box(0, back, y - plinth, bw, H + plinth, bd, plot.color);
  if (plot.kind === 'flats' || plot.kind === 'house' || plot.kind === 'haveli' || plot.kind === 'school' || plot.kind === 'clinic' || plot.kind === 'hospital') {
    // The black roof water tank every Indian roof carries.
    box(bw / 4, back + bd / 4, y + H, 1.6, 1.5, 1.6, 0x1c1c1c, false);
    if (plot.kind === 'flats' && detail >= 1) box(-bw / 4, back + bd / 4, y + H, 1.6, 1.5, 1.6, 0x1c1c1c, false);
  }
  if (plot.kind === 'house' || plot.kind === 'haveli' || plot.kind === 'school') {
    // Compound wall with a gate gap in the front.
    if (detail >= 1) {
      const side = (W - 3) / 2;
      box(-(side / 2 + 1.5), -D / 2 + 0.15, y, side, 1.4, 0.25, 0xd8cfc0);
      box(side / 2 + 1.5, -D / 2 + 0.15, y, side, 1.4, 0.25, 0xd8cfc0);
      box(-W / 2 + 0.15, 0, y, 0.25, 1.4, D, 0xd8cfc0);
      box(W / 2 - 0.15, 0, y, 0.25, 1.4, D, 0xd8cfc0);
      box(0, D / 2 - 0.15, y, W, 1.4, 0.25, 0xd8cfc0);
    }
    if (detail >= 2) { box(-0.9, -D / 2 + 0.2, y, 0.3, 1.9, 0.3, 0x6b4f3a); box(0.9, -D / 2 + 0.2, y, 0.3, 1.9, 0.3, 0x6b4f3a); }
  }
  switch (plot.kind) {
    case 'haveli':
      box(0, back, y + H, 2.4, 2.2, 2.4, 0xe6b566, false);
      break;
    case 'flats':
      if (detail >= 1) for (let f = 1; f < plot.floors; f += 2) box(0, back - bd / 2 - 0.5, y + f * 3.1, bw * 0.8, 0.2, 1, 0xcfcfcf, false);
      break;
    case 'shop': case 'market': {
      // A coloured awning over the shop front and a bright signboard above it.
      const awn = [0xd62828, 0x2a9d8f, 0xf77f00, 0x457b9d, 0x6a4c93][plot.id % 5];
      box(0, back - bd / 2 - 0.9, y + 2.6, bw * 0.95, 0.15, 1.8, awn, false);
      box(0, back - bd / 2 - 0.1, y + 3.1, bw * 0.8, 0.9, 0.2, [0xffd166, 0x06d6a0, 0xef476f, 0x118ab2, 0xffffff][plot.id % 5], false);
      break;
    }
    case 'tower': case 'office':
      box(0, back, y + H, bw * 0.4, 1.5, bd * 0.4, 0x5c6b73, false);
      break;
    case 'temple':
      // A stepped shikhara on a raised plinth, with a saffron flag.
      box(0, back, y + 3, bw * 0.55, 3, bd * 0.55, 0xf7f0e3, false);
      box(0, back, y + 6, bw * 0.38, 3, bd * 0.38, 0xf4a259, false);
      box(0, back, y + 9, bw * 0.2, 3.5, bd * 0.2, 0xe76f51, false);
      if (detail >= 1) box(0, back, y + 12.5, 0.12, 2, 0.12, 0x6b4f3a, false);
      if (detail >= 1) box(0.4, back, y + 13.8, 0.8, 0.5, 0.05, 0xff9933, false);
      break;
    case 'clinic': case 'hospital':
      box(0, back - bd / 2 - 0.05, y + H - 2.2, 1.6, 0.5, 0.1, 0xd62828, false);
      box(0, back - bd / 2 - 0.05, y + H - 2.75, 0.5, 1.6, 0.1, 0xd62828, false);
      break;
    case 'school':
      if (detail >= 1) box(-bw / 2 + 1, back - bd / 2 - 2, y, 0.12, 6, 0.12, 0xdddddd, false);
      break;
    default: break;
  }
}

/** A tree: a trunk and a crown (one crown on a phone). */
export function treeGeometry(out: { p: number[]; n: number[]; c: number[] }, ox: number, oz: number, t: ColonyTree, detail: 0 | 1 | 2): void {
  treeBoxes(t, detail, (b, color) => boxInto(out, ox, oz, b.x, b.y0, b.z, b.w, b.h, b.d, b.ux, b.uz, color));
}

/** A tree's boxes: the trunk is solid (nobody walks through a tree), the crown above head height is not. */
export function treeBoxes(t: ColonyTree, detail: 0 | 1 | 2, sink: BoxSink): void {
  const s = t.scale;
  sink({ x: t.x, z: t.z, y0: t.y - 0.3, h: 2.4 * s, w: 0.35 * s, d: 0.35 * s, ux: 1, uz: 0 }, 0x6b4f3a, true);
  sink({ x: t.x, z: t.z, y0: t.y + 2 * s, h: 2.4 * s, w: 2.6 * s, d: 2.6 * s, ux: 0.7071, uz: 0.7071 }, 0x3f7d3a, false);
  if (detail >= 1) sink({ x: t.x, z: t.z, y0: t.y + 3.8 * s, h: 1.6 * s, w: 1.7 * s, d: 1.7 * s, ux: 1, uz: 0 }, 0x4c9a45, false);
}

/** The SOLID boxes of a tile's plots and trees at a detail level (Q-3761): the walls of the colony, for any physics engine (a Rapier cuboid each). */
export function colonyColliderBoxes(tile: { plots: ReadonlyArray<ColonyPlot>; trees: ReadonlyArray<ColonyTree> }, detail: 0 | 1 | 2): ColonyBox[] {
  const out: ColonyBox[] = [];
  const keep: BoxSink = (b, _c, solid) => { if (solid) out.push(b); };
  for (const p of tile.plots) plotBoxes(p, detail, keep);
  for (const t of tile.trees) treeBoxes(t, detail, keep);
  return out;
}

/** True when a circle of radius r at (x, z) touches a solid box (its footprint, whatever its height). */
export function boxesTouch(boxes: ReadonlyArray<ColonyBox>, x: number, z: number, r = 0): boolean {
  for (const b of boxes) {
    const dx = x - b.x, dz = z - b.z;
    const u = Math.abs(dx * b.ux + dz * b.uz) - b.w / 2, v = Math.abs(-dx * b.uz + dz * b.ux) - b.d / 2;
    if (Math.hypot(Math.max(0, u), Math.max(0, v)) <= r) return true;
  }
  return false;
}

/** The tiles that hold anything, keyed "ix,iz", with their plots and trees. */
export function colonyTiles(plan: Pick<ColonyPlan, 'plots' | 'trees'>): Map<string, { ix: number; iz: number; plots: ColonyPlot[]; trees: ColonyTree[] }> {
  const tiles = new Map<string, { ix: number; iz: number; plots: ColonyPlot[]; trees: ColonyTree[] }>();
  const at = (x: number, z: number) => {
    const ix = Math.floor(x / COLONY_TILE), iz = Math.floor(z / COLONY_TILE), k = ix + ',' + iz;
    let t = tiles.get(k);
    if (!t) { t = { ix, iz, plots: [], trees: [] }; tiles.set(k, t); }
    return t;
  };
  for (const p of plan.plots) at(p.x, p.z).plots.push(p);
  for (const t of plan.trees) at(t.x, t.z).trees.push(t);
  return tiles;
}

/** One tile's merged geometry at a detail level (positions relative to the tile's corner). */
export function colonyTileArrays(tile: { ix: number; iz: number; plots: ReadonlyArray<ColonyPlot>; trees: ReadonlyArray<ColonyTree> }, detail: 0 | 1 | 2): ColonyTileArrays {
  const out = { p: [] as number[], n: [] as number[], c: [] as number[] };
  const ox = tile.ix * COLONY_TILE, oz = tile.iz * COLONY_TILE;
  for (const p of tile.plots) plotGeometry(out, ox, oz, p, detail);
  for (const t of tile.trees) treeGeometry(out, ox, oz, t, detail);
  return { position: Float32Array.from(out.p), normal: Float32Array.from(out.n), color: Float32Array.from(out.c), triangles: out.p.length / 9 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export interface ColonyStats { tiles: number; drawCalls: number; triangles: number; plots: number; trees: number; capped: boolean; colliders: number; colliderBoxes: number }
export interface ColonyMesh {
  readonly group: ThreeLike;
  /** Call every frame with the camera in WORLD metres and the floating origin: builds the nearest tiles, drops far ones. */
  update(cameraX: number, cameraZ: number, origin: { x: number; z: number }): void;
  /** What is drawn now: tiles (one draw call each), triangles, whether the tier's triangle cap held tiles back, and the tiles with a wall. */
  stats(): ColonyStats;
  /** The wall meshes live now (one per tile within physicsRadius), marked 'solid' with COLONY_COLLIDER_KEY: for a game's own physics. */
  colliders(): ThreeLike[];
  dispose(): void;
}

/** The colonies on screen: one merged mesh per tile round the camera, nearest first, never past the tier's triangle cap. */
export function createColonyMesh(THREE: ThreeLike, world: AthreeWorld, quality: AthreeQuality = 'mid'): ColonyMesh {
  const tier = COLONY_TIERS[quality] ?? COLONY_TIERS.mid;
  const group = new THREE.Group();
  group.name = 'Colonies';
  group.userData.ground = false;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  let tiles: ReturnType<typeof colonyTiles> | null = null;
  let seenEdits = -1;
  const wallMaterial = new THREE.MeshBasicMaterial({ visible: false });
  type Live = { mesh: ThreeLike; tile: ThreeLike; triangles: number; plots: number; trees: number; data: { ix: number; iz: number; plots: ColonyPlot[]; trees: ColonyTree[] }; wall: ThreeLike | null; boxes: number };
  const live = new Map<string, Live>();
  let capped = false;
  const dropWall = (t: Live): void => { if (!t.wall) return; t.tile.remove(t.wall); t.wall.geometry.dispose(); t.wall = null; t.boxes = 0; };
  const drop = (k: string): void => { const t = live.get(k); if (!t) return; dropWall(t); group.remove(t.tile); t.mesh.geometry.dispose(); live.delete(k); };
  const buildWall = (t: Live): void => {
    const arr = colonyColliderArrays(t.data, tier.detail);
    if (!arr.boxes) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(arr.normal, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const wall = new THREE.Mesh(geo, wallMaterial);
    wall.name = 'Colony walls';
    wall.visible = false;
    wall.userData[COLONY_COLLIDER_KEY] = 'solid';
    wall.userData.ground = false;
    t.tile.add(wall);
    t.wall = wall;
    t.boxes = arr.boxes;
  };
  function refresh(): void {
    // A ground edit by the game (a levelled place, a road) can take plots away: the tiles are rebuilt from the world's live list.
    const edits = world.editCount ? world.editCount() : 0;
    if (tiles && edits === seenEdits) return;
    seenEdits = edits;
    tiles = colonyTiles(world.colonies ? world.colonies() : { plots: [], trees: [] });
    for (const k of [...live.keys()]) drop(k);
  }
  return {
    group,
    update(cameraX, cameraZ, origin) {
      refresh();
      group.position.set(-origin.x, 0, -origin.z);
      if (!tiles || tiles.size === 0) return;
      const R = tier.radius;
      const dist = (ix: number, iz: number): number => {
        const x0 = ix * COLONY_TILE, z0 = iz * COLONY_TILE;
        return Math.hypot(Math.max(x0 - cameraX, 0, cameraX - x0 - COLONY_TILE), Math.max(z0 - cameraZ, 0, cameraZ - z0 - COLONY_TILE));
      };
      for (const [k, t] of [...live.entries()]) { const tile = tiles.get(k); if (!tile || dist(tile.ix, tile.iz) > R * 1.15) drop(k); void t; }
      const want = [...tiles.entries()].map(([k, t]) => ({ k, t, d: dist(t.ix, t.iz) })).filter((e) => e.d <= R).sort((p, q) => p.d - q.d);
      let used = 0;
      for (const t of live.values()) used += t.triangles;
      // A far tile gives way to a nearer one when the cap is reached.
      for (const e of want.slice().reverse()) {
        if (used <= tier.maxTriangles) break;
        const t = live.get(e.k);
        if (t) { used -= t.triangles; drop(e.k); }
      }
      let builds = 0;
      capped = false;
      for (const e of want) {
        if (live.has(e.k)) continue;
        if (builds >= tier.buildsPerUpdate) break;
        const arr = colonyTileArrays(e.t, tier.detail);
        if (used + arr.triangles > tier.maxTriangles) { capped = true; break; }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(arr.position, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(arr.normal, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(arr.color, 3));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = 'Colony tile ' + e.k;
        mesh.userData.ground = false;
        // The drawn mesh is never a wall (its awnings and crowns hang over the footpath); the tile's wall mesh is (buildWall).
        mesh.userData[COLONY_COLLIDER_KEY] = 'none';
        const tile = new THREE.Group();
        tile.name = 'Colony ' + e.k;
        tile.position.set(e.t.ix * COLONY_TILE, 0, e.t.iz * COLONY_TILE);
        tile.add(mesh);
        group.add(tile);
        live.set(e.k, { mesh, tile, triangles: arr.triangles, plots: e.t.plots.length, trees: e.t.trees.length, data: e.t, wall: null, boxes: 0 });
        used += arr.triangles;
        builds++;
      }
      // 🧱 The walls (Q-3761): a drawn tile near the camera carries its collider; one that moved away drops it. Built with the tile's
      // own data and detail, so a wall stands exactly where a wall is drawn and nowhere else.
      const P = tier.physicsRadius;
      for (const t of live.values()) {
        const d = dist(t.data.ix, t.data.iz);
        if (!t.wall && d <= P) buildWall(t);
        else if (t.wall && d > P * 1.15) dropWall(t);
      }
    },
    stats() {
      let triangles = 0, plots = 0, trees = 0, colliders = 0, colliderBoxes = 0;
      for (const t of live.values()) { triangles += t.triangles; plots += t.plots; trees += t.trees; if (t.wall) { colliders++; colliderBoxes += t.boxes; } }
      return { tiles: live.size, drawCalls: live.size, triangles, plots, trees, capped, colliders, colliderBoxes };
    },
    colliders() { return [...live.values()].filter((t) => t.wall).map((t) => t.wall); },
    dispose() { for (const k of [...live.keys()]) drop(k); material.dispose(); wallMaterial.dispose(); },
  };
}
`;
