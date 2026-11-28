// ATHREE MAP — phase 5a: ROADS, RACE CIRCUIT, RUNWAY, VILLAGE PLAZAS, BRIDGES (the emitted source of src/game/athree/roads.ts and roadmesh.ts).
//
// 100% ours. Techniques (public ideas, own code): villages stand on flat ground picked by a hash; a highway between two villages is the
// cheapest path on a 100 m grid (A-star, cost rising with slope, rivers crossable at a price, sea, lakes and cliffs forbidden), smoothed
// and resampled every 10 m; its height profile is the ground averaged along the road and then limited to a 7 percent grade; where it
// crosses a river the road becomes a bridge on a flat deck 3.5 m above the water. A race circuit is a closed spline round a flat place,
// banked by its own curvature, its profile closed exactly. The ground is then carved to the roads (cut and fill, with a shoulder as wide
// as the cut is deep), as a weighted blend of continuous candidates, so the SAME height function feeds the renderer, the physics
// collider and the road mesh. A loop world is generated in 12.5 km regions on demand, so 100 km needs no up-front work.
//
// EVERY MAP SIZE (admin 2026-11-27): a map under 20 km (an island under 6 km), or any map up to 25 km that asks for a roadStyle, gets the
// PLANNED network of athreeRoadPlanSource.ts instead (appended to roads.ts): a town laid in a style (grid, highway, organic, hill,
// straight) with a highway hierarchy, junctions and roundabouts, ONE connected graph, the blocks between its roads as data, and a
// left-lane route() over it. The regional network above is unchanged for the big maps.
//
// roads.ts is PURE (no three.js). roadmesh.ts draws it: asphalt ribbons with procedural lane markings, kerbs, a start line, bridge decks,
// rails and piers, built per tile.
//
// PURE source strings; the generator writes them. Rule for editing: no backticks and no dollar-brace inside the strings below.

import { ROAD_PLAN } from './athreeRoadPlanSource';

export const ROADS = `// Athree map — roads, a race circuit, runways, village plazas and bridges (pure: no three.js).
// Technique: flat-site hashing, A-star routing with slope and river costs, Chaikin smoothing, graded height profile, banked closed spline,
// weighted carve of continuous candidates, 125 m spatial grid, regions generated on demand. Own implementation.

import { mulberry32 } from './noise';
// The planned network (roads on every map size) is appended at the end of this file: planRoadNetwork, RoadStyle, Junction, Block.

export const ROAD_STEP = 10;
export const REGION = 12500;
const GRID = 125;
const MAX_SHOULDER = 40;
const MAX_GRADE = 0.07;
const PLAZA_RADIUS = 45;
const PLAZA_SHOULDER = 25;
const BRIDGE_CLEARANCE = 3.5;
/** A road may sit at most this far above or below the ground it was routed over (cut and fill), or it is not built there. */
const MAX_CUT_FILL = 14;

/** circuit, highway and runway are the regional network's; a planned network adds main roads, colony streets and lanes (galis). */
export type RoadKind = 'circuit' | 'highway' | 'runway' | 'main' | 'street' | 'lane';
export type RoadProfile = 'open-world' | 'racing' | 'battle-royale' | 'flight' | 'explore';

export interface RoadPoint {
  x: number;
  z: number;
  /** Height of the road surface on its centre line. */
  y: number;
  /** Cross tilt in radians: positive raises the edge on the +normal side, n = (-ez, ex) of the direction of travel. */
  bank: number;
  width: number;
  /** On a bridge deck: the ground below is not carved and the deck is above it. */
  bridge: boolean;
  /** Planned roads only: metres along the road from its first point (their points are not all 10 m apart: a junction pad ends where it ends). */
  s?: number;
  /** Planned roads only: water is within this point's cut-and-fill shoulder, so the carve leaves water alone (a stream is never filled). */
  nearWater?: boolean;
}

export interface Road {
  id: number;
  kind: RoadKind;
  closed: boolean;
  points: RoadPoint[];
  /** Length in metres (a closed road includes the closing segment). */
  length: number;
  /** Site ids at each end of a highway (-1 otherwise). A planned highway to a village has its site in to. */
  from: number;
  to: number;
  /** Planned network only: true, the lane count (both ways), the graph junctions at each end, the ribbon trimmed off each end (the
   * junction pad is drawn there), and the widest cut-and-fill shoulder. */
  planned?: boolean;
  lanes?: number;
  a?: number;
  b?: number;
  trim?: [number, number];
  shoulder?: number;
}

export interface Site {
  id: number;
  x: number;
  z: number;
  /** Height of the flat plaza. */
  y: number;
  radius: number;
}

export interface Circuit {
  road: number;
  length: number;
  /** Where a lap starts and ends: point 0 of the road. */
  checkpoints: Array<{ x: number; z: number; index: number }>;
}

export interface RoadHit {
  road: number;
  /** On a planned junction pad (between its roads' ends): the junction's id. */
  junction?: number;
  kind: RoadKind;
  /** Metres along the road's normal n = (-ez, ex) from the centre line (the side a positive bank raises). */
  across: number;
  /** Metres along the road from its first point. */
  along: number;
  width: number;
  /** Height of the road surface here. */
  y: number;
  bridge: boolean;
}

export interface RoadOptions {
  seed: number;
  /** Loop period in metres, or 0 for a bounded world. */
  period: number;
  /** Bounded world: the island radius. */
  radius: number;
  profile: RoadProfile;
  /** The ground WITHOUT roads. */
  terrain(x: number, z: number): number;
  /** The surface height of a river or lake at a place, or null on dry ground. kind tells a river (bridgeable) from a lake (or pond, or any
   * other still water: only a river is ever bridged). */
  water(x: number, z: number): { surface: number; kind: string } | null;
  /** How the roads are laid on a map up to 25 km (default grid on a map too small for the regional network). Unknown values are ignored. */
  roadStyle?: RoadStyle;
  /** The rivers and lakes as geometry. A small map's rivers are under a metre wide, so a planned road finds its crossings on these lines
   * (a point test every few metres could step over one); still water is also kept clear this way. */
  bodies?(): { rivers: Array<{ points: Array<{ x: number; z: number; surface: number; width: number }> }>; lakes: Array<{ x: number; z: number; radius: number }> };
  /** Below this height (outside a river) the ground is sea or beach. Default 1.5 m; a small map whose heights are squeezed passes less. */
  landLine?: number;
}

export interface Region {
  roads: Road[];
  sites: Site[];
  circuit: Circuit | null;
  /** Planned network only: the junction pads and roundabouts, and the blocks enclosed by roads. */
  junctions?: Junction[];
  blocks?: Block[];
}

export interface RoadNetwork {
  /** Every region built so far (a region is built the first time something looks at it). */
  regionAt(x: number, z: number): Region;
  /** The ground height with the roads and plazas cut and filled in. */
  carve(x: number, z: number, groundHeight: number): number;
  /** The road under a place (on the paved width), or null. */
  roadAt(x: number, z: number): RoadHit | null;
  /** What a vehicle drives on: the bridge deck on a bridge, the ground elsewhere. */
  drivableHeightAt(x: number, z: number, groundHeight: number): number;
  /** The region that holds the world origin (loop) or the whole island (bounded): where the circuit and runways are. */
  home(): Region;
  /** Every region that overlaps a rectangle (the rectangle may be any copy of the loop world). Builds them. */
  regionsNear(x0: number, z0: number, x1: number, z1: number): Region[];
  /** The style of the planned network, or null on a map that uses the regional network. */
  style(): RoadStyle | null;
  /**
   * The blocks of the planned network: polygons enclosed by roads on every side (counter-clockwise, on the road centre lines, each side
   * with its road and half-width so the kerb is one inset away). Pure data for the colony step. Empty on the regional network.
   */
  blocks(): Block[];
  /** The planned network as ONE connected graph: junctions (nodes) and the roads between them (edges). Empty on the regional network. */
  graph(): RoadGraph;
  /**
   * A driving route along the planned roads from near one point to near another: the shortest path over the graph, in the LEFT lane
   * (India keeps left; facing (dx, dz) the left is (dz, -dx)), round a roundabout with its island on the right, at road height.
   * Empty when there is no planned network or a point is nowhere near a road.
   */
  route(from: { x: number; z: number }, to: { x: number; z: number }): RoutePoint[];
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function mix32(a: number, b: number, c: number): number {
  return (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) | 0;
}

interface Heap<T> { push(item: T, key: number): void; pop(): T | undefined; size(): number }
function createHeap<T>(): Heap<T> {
  const items: T[] = [];
  const keys: number[] = [];
  return {
    push(item, key) {
      items.push(item); keys.push(key);
      let i = items.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= keys[i]) break;
        [items[p], items[i]] = [items[i], items[p]]; [keys[p], keys[i]] = [keys[i], keys[p]];
        i = p;
      }
    },
    pop() {
      if (items.length === 0) return undefined;
      const top = items[0];
      const last = items.pop()!; const lastKey = keys.pop()!;
      if (items.length > 0) {
        items[0] = last; keys[0] = lastKey;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1; const r = l + 1; let m = i;
          if (l < items.length && keys[l] < keys[m]) m = l;
          if (r < items.length && keys[r] < keys[m]) m = r;
          if (m === i) break;
          [items[m], items[i]] = [items[i], items[m]]; [keys[m], keys[i]] = [keys[i], keys[m]];
          i = m;
        }
      }
      return top;
    },
    size: () => items.length,
  };
}

interface Seg { road: number; j: number }

export function createRoadNetwork(o: RoadOptions): RoadNetwork {
  const P = o.period;
  const bounded = P <= 0;
  // EVERY MAP SIZE: a map too small for 12.5 km regions (or one up to 25 km that names a style) is one planned network instead.
  const side = bounded ? o.radius * 2 : P;
  const askedStyle: RoadStyle | null = typeof o.roadStyle === 'string' && ROAD_STYLES.includes(o.roadStyle) ? o.roadStyle : null;
  const planned = side <= PLAN_MAX_SIDE && (askedStyle !== null || side < (bounded ? PLAN_BELOW.bounded : PLAN_BELOW.loop));
  const planStyle: RoadStyle | null = planned ? (askedStyle ?? 'grid') : null;
  // The sea and land thresholds below are for the reference heights; a small map squeezes its heights, and passes a lower land line.
  // Planned maps only: the regional network of a bigger map keeps the reference thresholds it always had.
  const LAND = planned ? Math.max(0.01, Math.min(1, (typeof o.landLine === 'number' && Number.isFinite(o.landLine) ? o.landLine : 1.5) / 1.5)) : 1;
  const loopPlan = planned && P > 0;
  const regionsPer = P > 0 && !planned ? Math.round(P / REGION) : 0;
  const gridPer = P > 0 && !planned ? Math.round(P / GRID) : 0;
  const wrapG = (i: number): number => (gridPer > 0 ? ((i % gridPer) + gridPer) % gridPer : i);
  const wrapD = (d: number): number => (P > 0 ? d - Math.round(d / P) * P : d);
  const canon = (v: number): number => (P > 0 ? v - Math.floor(v / P) * P : v);
  const gkey = (cx: number, cz: number): number => (wrapG(cx) + 100000) * 400009 + (wrapG(cz) + 100000);
  // ⚡ A planned town's roads are a dense web of 10 m segments: a 125 m cell held dozens of them, and every height and road lookup
  // walked them all (found 2026-11-27: the colony planner spent most of its time here, and a battle-royale island's build-time robot
  // check ran out of its 8 s). A planned network indexes into 32 m cells instead. Every segment is still listed in every cell its
  // padded reach touches (width, shoulder and 5 m), so a lookup sees exactly the segments that can weigh on it: the answers are the
  // same, to the bit (tests/aFinerRoadIndexGivesTheSameAnswers.test.ts). The regional network keeps its 125 m cells (it wraps by them).
  const INDEX_CELL = planned ? 32 : GRID;

  interface Built extends Region { grid: Map<number, Seg[]>; siteGrid: Map<number, number[]>; junctionGrid: Map<number, number[]>; graph: RoadGraph | null; x0: number; z0: number; size: number }
  const regions = new Map<number, Built>();

  const terrain = o.terrain;
  function slopeAt(x: number, z: number): number {
    return Math.hypot(terrain(x + 30, z) - terrain(x - 30, z), terrain(x, z + 30) - terrain(x, z - 30)) / 60;
  }

  /** Close a polyline's sharp corners, then resample it every ROAD_STEP metres (Chaikin twice, then uniform arc length). */
  function resample(raw: Array<[number, number]>, closed: boolean, passes: number): Array<[number, number]> {
    let pts = raw;
    for (let pass = 0; pass < passes; pass++) {
      const next: Array<[number, number]> = [];
      const n = pts.length;
      const last = closed ? n : n - 1;
      if (!closed) next.push(pts[0]);
      for (let i = 0; i < last; i++) {
        const a = pts[i]; const b = pts[(i + 1) % n];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (!closed) next.push(pts[n - 1]);
      pts = next;
    }
    const m = pts.length;
    const cum = [0];
    const lastIdx = closed ? m : m - 1;
    for (let i = 0; i < lastIdx; i++) cum.push(cum[i] + Math.hypot(pts[(i + 1) % m][0] - pts[i][0], pts[(i + 1) % m][1] - pts[i][1]));
    const total = cum[cum.length - 1];
    const count = Math.max(closed ? 24 : 2, Math.round(total / ROAD_STEP));
    const out: Array<[number, number]> = [];
    let seg = 0;
    for (let k = 0; k < (closed ? count : count + 1); k++) {
      const d = closed ? (k / count) * total : (k / count) * total;
      while (seg < lastIdx - 1 && cum[seg + 1] < d) seg++;
      const t = (d - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
      const a = pts[seg]; const b = pts[(seg + 1) % m];
      out.push([a[0] + (b[0] - a[0]) * Math.min(1, Math.max(0, t)), a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, t))]);
    }
    return out;
  }

  /** The height profile of a road: the ground averaged along it, bridge decks pinned flat, then limited to MAX_GRADE. */
  function profile(xy: Array<[number, number]>, closed: boolean, width: number, flat: boolean): RoadPoint[] {
    const n = xy.length;
    const ground = xy.map((p) => terrain(p[0], p[1]));
    const wet = xy.map((p) => (o.water(p[0], p[1]) ? 1 : 0));
    const pinned: Array<number | null> = new Array(n).fill(null);
    const bridge: boolean[] = new Array(n).fill(false);
    if (!flat) {
      const idx = (i: number): number => (closed ? (i + n) % n : Math.min(n - 1, Math.max(0, i)));
      for (let i = 0; i < n; i++) if (wet[i]) for (let k = -3; k <= 3; k++) bridge[idx(i + k)] = true;
      let i = 0;
      while (i < n) {
        if (!bridge[i]) { i++; continue; }
        let j = i;
        while (j + 1 < n && bridge[j + 1]) j++;
        let deck = -Infinity;
        for (let k = i; k <= j; k++) {
          const w = o.water(xy[k][0], xy[k][1]);
          deck = Math.max(deck, (w ? w.surface : ground[k]) + BRIDGE_CLEARANCE, ground[k] + 0.5);
        }
        for (let k = i; k <= j; k++) pinned[k] = deck;
        i = j + 1;
      }
    }
    const R = 12;
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      if (pinned[i] !== null) { y.push(pinned[i] as number); continue; }
      let s = 0; let c = 0;
      for (let k = -R; k <= R; k++) {
        const j = closed ? (i + k + n * 4) % n : i + k;
        if (j < 0 || j >= n) continue;
        s += ground[j]; c++;
      }
      y.push(flat ? 0 : s / c);
    }
    if (flat) { const mean = ground.reduce((a, b) => a + b, 0) / n; for (let i = 0; i < n; i++) y[i] = mean; }
    const lim = MAX_GRADE * ROAD_STEP;
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < n; i++) if (pinned[i] === null) y[i] = Math.min(y[i - 1] + lim, Math.max(y[i - 1] - lim, y[i]));
      for (let i = n - 2; i >= 0; i--) if (pinned[i] === null) y[i] = Math.min(y[i + 1] + lim, Math.max(y[i + 1] - lim, y[i]));
    }
    return xy.map((p, i) => ({ x: p[0], z: p[1], y: y[i], bank: 0, width, bridge: bridge[i] }));
  }

  /** Bank a closed circuit by its own curvature: the faster the turn, the more the road leans into it. */
  function bankCircuit(pts: RoadPoint[]): void {
    const n = pts.length;
    const raw: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n]; const b = pts[i]; const c = pts[(i + 1) % n];
      const a1 = Math.atan2(b.z - a.z, b.x - a.x); const a2 = Math.atan2(c.z - b.z, c.x - b.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      raw.push(d / ROAD_STEP);
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -4; k <= 4; k++) s += raw[(i + k + n) % n];
      // The road's own heading h turns towards its +normal n = (-ez, ex) when the angle grows, so the +normal side is the INSIDE of that turn.
      // A banked turn raises the OUTER edge, so the bank (positive raises the +normal edge) is minus the curvature.
      pts[i].bank = Math.max(-0.14, Math.min(0.14, -(s / 9) * 40));
    }
  }

  function buildRegion(rx: number, rz: number): Built {
    // A planned loop map is one region centred on the origin, [-P/2, P/2) on each axis, kept clear of the seam.
    const size = bounded ? o.radius * 2 : planned ? P : REGION;
    const x0 = bounded ? -o.radius : planned ? -P / 2 : rx * REGION;
    const z0 = bounded ? -o.radius : planned ? -P / 2 : rz * REGION;
    const rng = mulberry32(mix32(rx, rz, o.seed + 311));
    // A planned (small) map's streams are under a metre wide: its circuit and runway keep off them by their geometry.
    const pw: PlanWater | null = planned && o.bodies ? planWaterIndex(o.bodies(), P > 0 ? P : 0, 0) : null;
    const roads: Road[] = [];
    const sites: Site[] = [];
    let junctions: Junction[] | undefined;
    let blocks: Block[] | undefined;
    let graph: RoadGraph | null = null;
    const home = bounded || planned || (rx === 0 && rz === 0);
    const inner = 150;
    const inside = (x: number, z: number, m = inner): boolean => x >= x0 + m && x < x0 + size - m && z >= z0 + m && z < z0 + size - m && (!bounded || Math.hypot(x, z) < o.radius * 0.82);

    // ---- circuit ---------------------------------------------------------------------------------------------------------------
    let circuit: Circuit | null = null;
    let circuitCentre: { x: number; z: number; r: number } | null = null;
    if (home && o.profile === 'racing') {
      // A planned (small) map tries smaller circuits when the big one finds no dry, gentle ring: a 5 km map's land is coast and steep
      // hills, and one fixed size almost never fitted (racing on 5 km got a circuit on 1 seed in 24). The regional network: one size.
      const R0 = planned ? Math.min(600, side * 0.1) : bounded ? Math.min(320, o.radius * 0.13) : 600;
      const radii = planned ? [R0, R0 * 0.7, R0 * 0.5, R0 * 0.35, 120].filter((r, i, all) => r >= 110 && (i === 0 || r < all[i - 1] - 1)) : [R0];
      for (const R of radii) {
      if (circuit) break;
      const cands: Array<{ x: number; z: number; score: number }> = [];
      for (let k = 0; k < 260; k++) {
        const cx = x0 + R * 1.6 + rng() * (size - R * 3.2);
        const cz = z0 + R * 1.6 + rng() * (size - R * 3.2);
        if (!inside(cx, cz, R * 1.6)) continue;
        const h0 = terrain(cx, cz);
        if (h0 < 4 * LAND || h0 > 150) continue;
        let sum = 0; let sum2 = 0; let wet = 0; let rivers = 0;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const px = cx + Math.cos(a) * R; const pz = cz + Math.sin(a) * R;
          const h = terrain(px, pz); sum += h; sum2 += h * h;
          const w = o.water(px, pz);
          if (h < 1.5 * LAND || (w && w.kind !== 'river')) wet++; else if (w) rivers++;
        }
        const mean = sum / 24;
        const score = Math.sqrt(Math.max(0, sum2 / 24 - mean * mean)) + wet * 400 + rivers * 25;
        if (wet === 0) cands.push({ x: cx, z: cz, score });
      }
      cands.sort((p, q) => p.score - q.score);
      const shape = { a: rng() * 6.28, b: rng() * 6.28, c: rng() * 6.28 };
      // The best flat place first; if the road cannot follow the ground there within the cut and fill limit, the next best.
      for (const best of cands.slice(0, planned ? 16 : 8)) {
        const ctrl: Array<[number, number]> = [];
        for (let i = 0; i < 36; i++) {
          const th = (i / 36) * Math.PI * 2;
          const rr = R * (1 + 0.28 * Math.sin(2 * th + shape.a) + 0.16 * Math.sin(3 * th + shape.b) + 0.08 * Math.sin(5 * th + shape.c));
          ctrl.push([best.x + Math.cos(th) * rr, best.z + Math.sin(th) * rr]);
        }
        const xy = resample(ctrl, true, 2);
        const pts = profile(xy, true, 14, false);
        if (pts.some((p) => !p.bridge && Math.abs(p.y - terrain(p.x, p.z)) > MAX_CUT_FILL)) continue;
        if (pw && xy.some((p, i) => { const q = xy[(i + 1) % xy.length]; return pw.riverNear(p[0], p[1], q[0], q[1], 7 + 16) !== null || pw.lakeNear(p[0], p[1], 7 + 16); })) continue;
        bankCircuit(pts);
        let length = 0;
        for (let i = 0; i < pts.length; i++) length += Math.hypot(pts[(i + 1) % pts.length].x - pts[i].x, pts[(i + 1) % pts.length].z - pts[i].z);
        const road: Road = { id: roads.length, kind: 'circuit', closed: true, points: pts, length, from: -1, to: -1 };
        roads.push(road);
        const cps: Array<{ x: number; z: number; index: number }> = [];
        for (let i = 0; i < pts.length; i += Math.max(1, Math.round(250 / ROAD_STEP))) cps.push({ x: pts[i].x, z: pts[i].z, index: i });
        circuit = { road: road.id, length, checkpoints: cps };
        circuitCentre = { x: best.x, z: best.z, r: R * 1.55 };
        break;
      }
      }
    }

    // ---- runways: a flat strip along +x --------------------------------------------------------------------------------------------
    const runwayCentres: Array<{ x: number; z: number }> = [];
    if (home && o.profile !== 'racing') {
      // A small planned map has no room for a 900 m strip unless it is a flight game (or 5 km and up).
      const want = o.profile === 'flight' ? 2 : planned && side < 5000 ? 0 : 1;
      for (let w = 0; w < want; w++) {
        let best: { x: number; z: number; score: number } | null = null;
        for (let k = 0; k < 260; k++) {
          const cx = x0 + 700 + rng() * (size - 1400);
          const cz = z0 + 700 + rng() * (size - 1400);
          if (!inside(cx, cz, 700)) continue;
          if (circuitCentre && Math.hypot(cx - circuitCentre.x, cz - circuitCentre.z) < circuitCentre.r + 600) continue;
          if (runwayCentres.some((r) => Math.hypot(r.x - cx, r.z - cz) < 1500)) continue;
          let sum = 0; let sum2 = 0; let n = 0; let wet = false;
          for (let i = -9; i <= 9; i++) for (const dz of [-25, 0, 25]) {
            const h = terrain(cx + i * 50, cz + dz);
            if (h < 5 * LAND || o.water(cx + i * 50, cz + dz)) wet = true;
            sum += h; sum2 += h * h; n++;
          }
          if (wet) continue;
          if (pw && (pw.riverNear(cx - 470, cz, cx + 470, cz, 32 + 16) !== null || pw.lakeNear(cx - 450, cz, 50) || pw.lakeNear(cx, cz, 50) || pw.lakeNear(cx + 450, cz, 50))) continue;
          // The roughest ground is simply levelled (a runway is cut and filled flat): the flattest of the places tried is the cheapest to build.
          const mean = sum / n;
          const score = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
          if (!best || score < best.score) best = { x: cx, z: cz, score };
        }
        if (best) {
          runwayCentres.push(best);
          const xy: Array<[number, number]> = [];
          for (let i = -45; i <= 45; i++) xy.push([best.x + i * ROAD_STEP, best.z]);
          const pts = profile(xy, false, 64, true);
          roads.push({ id: roads.length, kind: 'runway', closed: false, points: pts, length: 900, from: -1, to: -1 });
        }
      }
    }

    // ---- villages: plazas on flat ground (the regional network; a planned map lays its own) -----------------------------------------
    const cell = size / (bounded ? 4 : 5);
    const nCells = bounded ? 4 : 5;
    for (let cz = 0; cz < (planned ? 0 : nCells); cz++) {
      for (let cx = 0; cx < nCells; cx++) {
        const r2 = mulberry32(mix32(cx + rx * 7, cz + rz * 11, o.seed + 97));
        if (r2() > 0.85) continue;
        // Up to eight tries inside the cell for flat, dry ground: a village needs only one good place.
        for (let attempt = 0; attempt < 8; attempt++) {
          const sx = x0 + (cx + 0.12 + 0.76 * r2()) * cell;
          const sz = z0 + (cz + 0.12 + 0.76 * r2()) * cell;
          if (!inside(sx, sz, 300)) continue;
          if (circuitCentre && Math.hypot(sx - circuitCentre.x, sz - circuitCentre.z) < circuitCentre.r + 200) continue;
          if (runwayCentres.some((r) => Math.hypot(r.x - sx, r.z - sz) < 900)) continue;
          const h0 = terrain(sx, sz);
          if (h0 < 6 * LAND || h0 > 150 || o.water(sx, sz)) continue;
          let ok = true;
          for (let i = 0; i < 8 && ok; i++) {
            const a = (i / 8) * Math.PI * 2;
            const px = sx + Math.cos(a) * 65; const pz = sz + Math.sin(a) * 65;
            if (Math.abs(terrain(px, pz) - h0) > 6 || o.water(px, pz) || terrain(px, pz) < 4 * LAND) ok = false;
          }
          if (ok) { sites.push({ id: sites.length, x: sx, z: sz, y: h0, radius: PLAZA_RADIUS }); break; }
        }
      }
    }

    // ---- highways: the cheapest path between neighbouring villages -----------------------------------------------------------------
    const reach = bounded ? 4200 : 9000;
    const linked = new Set<string>();
    const edges: Array<[number, number]> = [];
    sites.forEach((a) => {
      const near = sites.filter((b) => b.id !== a.id).map((b) => ({ b, d: Math.hypot(b.x - a.x, b.z - a.z) })).filter((e) => e.d < reach).sort((p, q) => p.d - q.d).slice(0, 2);
      for (const e of near) {
        const key = Math.min(a.id, e.b.id) + '-' + Math.max(a.id, e.b.id);
        if (!linked.has(key)) { linked.add(key); edges.push([a.id, e.b.id]); }
      }
    });
    const CELL = 100;
    const costCache = new Map<number, number>();
    const cellCost = (ix: number, iz: number): number => {
      const k = (ix + 1000000) * 4000003 + (iz + 1000000);
      const hit = costCache.get(k);
      if (hit !== undefined) return hit;
      const x = ix * CELL + CELL / 2; const z = iz * CELL + CELL / 2;
      let c: number;
      const h = terrain(x, z);
      const w = o.water(x, z);
      if (h < 1.5 * LAND || (w && w.kind !== 'river') || !inside(x, z, 60)) c = Infinity;
      else {
        // Steep ground is simply dear (25 x slope squared): a road that still has to cross it is refused by the cut and fill limit below.
        const s = slopeAt(x, z);
        c = 1 + 25 * s * s + (w ? 30 : 0);
        if (circuitCentre && Math.hypot(x - circuitCentre.x, z - circuitCentre.z) < circuitCentre.r + 80) c = Infinity;
        if (runwayCentres.some((r) => Math.abs(x - r.x) < 520 && Math.abs(z - r.z) < 90)) c = Infinity;
      }
      costCache.set(k, c);
      return c;
    };
    const route = (a: Site, b: Site): Array<[number, number]> | null => routeXZ(a.x, a.z, b.x, b.z, null);
    function routeXZ(ax: number, az: number, bx: number, bz: number, avoid: ((x: number, z: number) => boolean) | null): Array<[number, number]> | null {
      const sx = Math.floor(ax / CELL); const sz = Math.floor(az / CELL);
      const gx = Math.floor(bx / CELL); const gz = Math.floor(bz / CELL);
      const heap = createHeap<[number, number]>();
      const gScore = new Map<number, number>();
      const came = new Map<number, number>();
      const key = (ix: number, iz: number): number => (ix + 1000000) * 4000003 + (iz + 1000000);
      gScore.set(key(sx, sz), 0);
      heap.push([sx, sz], Math.hypot(gx - sx, gz - sz));
      let explored = 0;
      while (heap.size() > 0 && explored < 6000) {
        const cur = heap.pop()!;
        explored++;
        if (cur[0] === gx && cur[1] === gz) {
          const path: Array<[number, number]> = [];
          let k = key(gx, gz);
          let ix = gx; let iz = gz;
          for (;;) {
            path.push([ix * CELL + CELL / 2, iz * CELL + CELL / 2]);
            if (k === key(sx, sz)) break;
            const pk = came.get(k)!;
            iz = (pk % 4000003) - 1000000;
            ix = Math.floor(pk / 4000003) - 1000000;
            k = pk;
          }
          return path.reverse();
        }
        const g0 = gScore.get(key(cur[0], cur[1]))!;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = cur[0] + dx; const nz = cur[1] + dz;
            const c = cellCost(nx, nz);
            if (!isFinite(c) && !(nx === gx && nz === gz) && !(nx === sx && nz === sz)) continue;
            if (avoid && !(nx === gx && nz === gz) && avoid(nx * CELL + CELL / 2, nz * CELL + CELL / 2)) continue;
            const step = Math.hypot(dx, dz) * (isFinite(c) ? c : 1);
            const g = g0 + step;
            const nk = key(nx, nz);
            if (g < (gScore.get(nk) ?? Infinity)) { gScore.set(nk, g); came.set(nk, key(cur[0], cur[1])); heap.push([nx, nz], g + Math.hypot(gx - nx, gz - nz)); }
          }
        }
      }
      return null;
    }
    for (const [ai, bi] of edges) {
      if (roads.filter((r) => r.kind === 'highway').length >= 40) break;
      const a = sites[ai]; const b = sites[bi];
      const path = route(a, b);
      if (!path || path.length < 4) continue;
      const raw: Array<[number, number]> = [[a.x, a.z], ...path.slice(1, -1), [b.x, b.z]];
      let xy = resample(raw, false, 2);
      // The road starts and ends at the edge of each plaza, not at its middle.
      const trimEnd = (arr: Array<[number, number]>, s: Site): Array<[number, number]> => {
        let i = 0;
        while (i < arr.length - 2 && Math.hypot(arr[i][0] - s.x, arr[i][1] - s.z) < PLAZA_RADIUS + 4) i++;
        return arr.slice(i);
      };
      xy = trimEnd(xy, a);
      xy = trimEnd(xy.slice().reverse(), b).reverse();
      if (xy.length < 6) continue;
      const pts = profile(xy, false, 9, false);
      if (pts.some((p) => !p.bridge && Math.abs(p.y - terrain(p.x, p.z)) > MAX_CUT_FILL)) continue;
      let length = 0;
      for (let i = 0; i < pts.length - 1; i++) length += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      roads.push({ id: roads.length, kind: 'highway', closed: false, points: pts, length, from: a.id, to: b.id });
    }

    // ---- the planned network (a map under 20 km, an island under 6 km, or a map up to 25 km with a roadStyle) ---------------------------
    if (planned && planStyle) {
      const half = bounded ? Math.min(o.radius - inner, o.radius * 0.56) : P / 2 - inner;
      const cc = circuitCentre as { x: number; z: number; r: number } | null;
      const blockedAt = (x: number, z: number): boolean => (cc !== null && Math.hypot(x - cc.x, z - cc.z) < cc.r) || runwayCentres.some((r) => Math.abs(x - r.x) < 480 && Math.abs(z - r.z) < 60);
      const plan = planRoadNetwork({
        seed: o.seed, style: planStyle, cx: 0, cz: 0, half, side, period: P > 0 ? P : 0, landLine: 1.5 * LAND, terrain, water: o.water, blocked: blockedAt, bodies: o.bodies,
        route: (ax, az, bx, bz, avoid) => routeXZ(ax, az, bx, bz, avoid), firstRoad: roads.length, firstSite: sites.length,
      });
      roads.push(...plan.roads); sites.push(...plan.sites);
      junctions = plan.junctions; blocks = plan.blocks; graph = plan.graph;
    }

    // ---- spatial grid ----------------------------------------------------------------------------------------------------------------
    const grid = new Map<number, Seg[]>();
    const siteGrid = new Map<number, number[]>();
    const register = <T>(map: Map<number, T[]>, ax: number, az: number, bx: number, bz: number, item: T): void => {
      for (let cz = Math.floor(az / INDEX_CELL); cz <= Math.floor(bz / INDEX_CELL); cz++) {
        for (let cx = Math.floor(ax / INDEX_CELL); cx <= Math.floor(bx / INDEX_CELL); cx++) {
          const k = gkey(cx, cz);
          const list = map.get(k);
          if (list) list.push(item); else map.set(k, [item]);
        }
      }
    };
    for (const r of roads) {
      const n = r.points.length;
      const segs = r.closed ? n : n - 1;
      for (let j = 0; j < segs; j++) {
        const a = r.points[j]; const b = r.points[(j + 1) % n];
        const pad = Math.max(a.width, b.width) / 2 + (r.shoulder ?? MAX_SHOULDER) + 5;
        register(grid, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad, { road: r.id, j });
      }
    }
    for (const s of sites) { const pad = PLAZA_RADIUS + PLAZA_SHOULDER + 5; register(siteGrid, s.x - pad, s.z - pad, s.x + pad, s.z + pad, s.id); }
    const junctionGrid = new Map<number, number[]>();
    for (const j of junctions ?? []) { const pad = j.radius + PLAN_JSHOULDER + 5; register(junctionGrid, j.x - pad, j.z - pad, j.x + pad, j.z + pad, j.id); }
    const built: Built = { roads, sites, circuit, grid, siteGrid, junctionGrid, graph, x0, z0, size };
    if (planned) { built.junctions = junctions ?? []; built.blocks = blocks ?? []; }
    return built;
  }

  function regionFor(x: number, z: number): Built {
    if (bounded || planned) {
      let r = regions.get(0);
      if (!r) { r = buildRegion(0, 0); regions.set(0, r); }
      return r;
    }
    const rx = Math.floor(canon(x) / REGION) % regionsPer;
    const rz = Math.floor(canon(z) / REGION) % regionsPer;
    const k = rx * 1000 + rz;
    let r = regions.get(k);
    if (!r) { r = buildRegion(rx, rz); regions.set(k, r); }
    return r;
  }

  // sharp: a planned road, pad or plaza, whose carve weight is raised to the 6th power so a road's own surface wins on its paved width
  // (a crossing road's shoulder no longer pulls it). junction: the junction pad's id, or -1.
  interface Cand { w: number; bed: number; d: number; seg: Seg | null; t: number; across: number; width: number; y: number; bridge: boolean; sharp: boolean; junction: number }

  function eachCandidate(x: number, z: number, groundHeight: number, cb: (c: Cand) => void): void {
    if (loopPlan) { x = wrapD(x); z = wrapD(z); }
    const reg = regionFor(x, z);
    const gk = gkey(Math.floor(x / INDEX_CELL), Math.floor(z / INDEX_CELL));
    const list = reg.grid.get(gk);
    if (list) {
      for (const s of list) {
        const road = reg.roads[s.road];
        const n = road.points.length;
        const a = road.points[s.j]; const b = road.points[(s.j + 1) % n];
        // A closed road's last segment joins the end back to the start; coordinates are unwrapped, so use the segment's own vector.
        const ax = wrapD(a.x - x); const az = wrapD(a.z - z);
        const ex = b.x - a.x; const ez = b.z - a.z;
        const len2 = ex * ex + ez * ez || 1;
        const t = Math.min(1, Math.max(0, -(ax * ex + az * ez) / len2));
        const cxp = ax + t * ex; const czp = az + t * ez;
        const d = Math.hypot(cxp, czp);
        const width = a.width + t * (b.width - a.width);
        const y = a.y + t * (b.y - a.y);
        const bank = a.bank + t * (b.bank - a.bank);
        const len = Math.sqrt(len2);
        // Signed distance along the normal n = (-ez, ex) / len, the same side the bank raises.
        const across = -(cxp * (-ez / len) + czp * (ex / len));
        const half = width / 2;
        const bridge = a.bridge && b.bridge;
        const edgeY = y + Math.max(-half, Math.min(half, across)) * Math.tan(bank);
        const e = d - half;
        const shoulder = Math.min(road.shoulder ?? MAX_SHOULDER, Math.max(5, 1.3 * Math.abs(groundHeight - edgeY)));
        let w = bridge ? 0 : e <= 0 ? 1 : 1 - smooth(e / shoulder);
        if (w > 0 && e > 0 && (a.nearWater || b.nearWater) && o.water(x, z)) w = 0;
        cb({ w, bed: edgeY, d, seg: s, t, across, width, y, bridge, sharp: road.planned === true, junction: -1 });
      }
    }
    const sl = reg.siteGrid.get(gk);
    if (sl) {
      for (const id of sl) {
        const s = reg.sites[id];
        const d = Math.hypot(wrapD(s.x - x), wrapD(s.z - z));
        const e = d - s.radius;
        const w = e <= 0 ? 1 : 1 - smooth(e / PLAZA_SHOULDER);
        cb({ w, bed: s.y, d, seg: null, t: 0, across: 0, width: s.radius * 2, y: s.y, bridge: false, sharp: planned, junction: -1 });
      }
    }
    const jl = reg.junctionGrid.get(gk);
    if (jl && reg.junctions) {
      for (const id of jl) {
        const j = reg.junctions[id];
        const d = Math.hypot(wrapD(j.x - x), wrapD(j.z - z));
        const e = d - j.radius;
        let w = e <= 0 ? 1 : 1 - smooth(e / PLAN_JSHOULDER);
        if (w > 0 && e > 0 && j.nearWater && o.water(x, z)) w = 0;
        cb({ w, bed: j.y, d, seg: null, t: 0, across: 0, width: j.radius * 2, y: j.y, bridge: false, sharp: true, junction: id });
      }
    }
  }

  function carve(x: number, z: number, groundHeight: number): number {
    let sumW = 0; let sumB = 0; let maxW = 0;
    // ON A PLANNED ROAD THE GROUND IS THAT ROAD: on its paved width the nearest planned ribbon's surface is the answer, exactly (a blend
    // with a neighbouring segment's end, or another road's shoulder, would put the wheels above or below the asphalt that is drawn).
    // On a junction pad between the ribbons, the pad's height.
    let onD = Infinity; let onBed = 0; let padD = Infinity; let padBed = 0;
    eachCandidate(x, z, groundHeight, (c) => {
      if (c.sharp && c.w >= 1) {
        if (c.seg && !c.bridge && c.d < onD) { onD = c.d; onBed = c.bed; }
        else if (c.junction >= 0 && c.d < padD) { padD = c.d; padBed = c.bed; }
      }
      if (c.w > 0) { const ww = c.sharp ? Math.pow(c.w, 6) : c.w; sumW += ww; sumB += ww * c.bed; if (c.w > maxW) maxW = c.w; }
    });
    if (onD < Infinity) return onBed;
    if (padD < Infinity) return padBed;
    if (sumW <= 0) return groundHeight;
    return groundHeight + (sumB / sumW - groundHeight) * maxW;
  }

  function roadAt(x: number, z: number): RoadHit | null {
    const reg = regionFor(x, z);
    let best: RoadHit | null = null;
    let pad: RoadHit | null = null;
    let island = false;
    let bestD = Infinity;
    eachCandidate(x, z, 0, (c) => {
      if (c.junction >= 0 && reg.junctions) {
        // A junction pad (between the ends of its roads) is road too; a roundabout's island is not.
        const j = reg.junctions[c.junction];
        if (!pad && c.d <= j.radius && c.d >= j.island) { const r = reg.roads[j.roads[0]]; pad = { road: r.id, kind: r.kind, across: 0, along: 0, width: j.radius * 2, y: j.y, bridge: false, junction: j.id }; }
        if (c.d < j.island) island = true;
        return;
      }
      if (!c.seg || c.d > c.width / 2 || c.d >= bestD) return;
      const road = reg.roads[c.seg.road];
      const a = road.points[c.seg.j]; const b = road.points[(c.seg.j + 1) % road.points.length];
      const along = a.s !== undefined && b.s !== undefined ? a.s + c.t * (b.s - a.s) : (c.seg.j + c.t) * ROAD_STEP;
      bestD = c.d;
      best = { road: road.id, kind: road.kind, across: c.across, along, width: c.width, y: c.bed, bridge: c.bridge };
    });
    // On a junction pad the answer is the junction (along and across of one road mean nothing where roads cross), named by the road whose
    // ribbon is nearest; a roundabout's island is not road at all, whichever ribbon runs under it.
    if (island) return null;
    if (pad) { const p = pad as RoadHit; const b = best as RoadHit | null; return b ? { ...p, road: b.road, kind: b.kind } : p; }
    return best;
  }

  function drivableHeightAt(x: number, z: number, groundHeight: number): number {
    const h = roadAt(x, z);
    return h && h.bridge ? Math.max(groundHeight, h.y) : groundHeight;
  }

  function regionsNear(ax: number, az: number, bx: number, bz: number): Region[] {
    if (bounded || planned) return [regionFor(0, 0)];
    const out: Region[] = [];
    const seen = new Set<Region>();
    const cx0 = canon(ax); const cz0 = canon(az);
    for (let rz = Math.floor(cz0 / REGION); rz <= Math.floor((cz0 + (bz - az)) / REGION); rz++) {
      for (let rx = Math.floor(cx0 / REGION); rx <= Math.floor((cx0 + (bx - ax)) / REGION); rx++) {
        const r = regionFor(((rx % regionsPer) + regionsPer) % regionsPer * REGION + 1, ((rz % regionsPer) + regionsPer) % regionsPer * REGION + 1);
        if (!seen.has(r)) { seen.add(r); out.push(r); }
      }
    }
    return out;
  }

  const planHome = (): Built | null => (planned ? regionFor(0, 0) : null);
  return {
    regionAt: regionFor, carve, roadAt, drivableHeightAt, home: () => regionFor(bounded ? 0 : 1, bounded ? 0 : 1), regionsNear,
    style: () => planStyle,
    blocks: () => planHome()?.blocks ?? [],
    graph: () => planHome()?.graph ?? { nodes: [], edges: [] },
    route: (from, to) => {
      const h = planHome();
      if (!h || !h.graph) return [];
      const c = (v: number): number => (loopPlan ? wrapD(v) : v);
      return planRoute(h.roads, h.junctions ?? [], h.graph, { x: c(from.x), z: c(from.z) }, { x: c(to.x), z: c(to.z) });
    },
  };
}

const cache = new Map<string, RoadNetwork>();

/** One network per world: regions are built on demand, so worlds with the same terrain share it. */
export function roadNetworkFor(key: string, o: RoadOptions): RoadNetwork {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = createRoadNetwork(o);
  if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  cache.set(key, made);
  return made;
}
` + ROAD_PLAN;

export const ROADMESH = `// Athree map — roads on screen: asphalt ribbons with lane markings, kerbs, a start line, runways, plazas, bridge decks, rails and piers.
// Technique: ribbons along the road points built per tile and streamed a few per frame; all markings are drawn in the fragment shader from
// the position across and along the road (no texture); lit by the sky's sun like the plants. Own implementation.

import { type AthreeQuality } from './config';
import { ROAD_STEP, type Road } from './roads';
import type { AthreeWorld } from './world';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export interface RoadTier {
  /** Roads are drawn out to this distance (metres): beyond it the terrain mesh is too coarse to hold a road bed. */
  radius: number;
  tile: number;
  /** The most triangles of road ever drawn. */
  maxTriangles: number;
  tilesPerUpdate: number;
}

// A planned town is dense (a junction every 70 to 130 m), so the caps are higher than one highway needed; a straight stretch is one quad,
// not one per 10 m. A tile that would pass the cap is left out whole (buildTiles), never drawn half. All three fit the triangle budget.
export const ROAD_TIERS: Record<AthreeQuality, RoadTier> = {
  phone: { radius: 400, tile: 256, maxTriangles: 9000, tilesPerUpdate: 2 },
  mid: { radius: 700, tile: 256, maxTriangles: 18000, tilesPerUpdate: 3 },
  desktop: { radius: 1300, tile: 512, maxTriangles: 36000, tilesPerUpdate: 4 },
};

/**
 * What a vertex of the road mesh is: how the shader paints it. multilane: a planned highway or main road (lane lines, a double centre
 * line, zebra crossings at its ends); street: a colony street (dashed centre line, zebra crossings); lane: a gali (no markings);
 * junction: a junction pad or roundabout ring; island: a roundabout's grass island.
 */
export const ROAD_KIND = { highway: 0, deck: 1, concrete: 2, runway: 3, circuit: 4, plaza: 5, multilane: 6, street: 7, lane: 8, junction: 9, island: 10 } as const;

export interface RoadArrays {
  /** Positions in WORLD metres, relative to (x0, z0) in x and z. */
  position: Float32Array;
  world: Float32Array;
  /** 0 at the edge on the minus-normal side, 1 on the plus-normal side. */
  across: Float32Array;
  /** Metres along the road from its first point. */
  along: Float32Array;
  kind: Float32Array;
  /** Metres to the nearer end of the road (runway markings). */
  end: Float32Array;
  width: Float32Array;
  index: Uint16Array;
  triangles: number;
}

const PLAZA_SIDES = 24;
const PAD_SIDES = 16;

/**
 * The roads whose segment centre (or plaza centre) lies inside [x0, x1) x [z0, z1): a ribbon of two triangles per segment, rails and piers on
 * bridges, a fan of 24 triangles per plaza. A loop world repeats, so the rectangle may be any copy of the world.
 */
export function roadsInRect(world: AthreeWorld, x0: number, z0: number, x1: number, z1: number): RoadArrays {
  const pos: number[] = []; const wor: number[] = []; const acr: number[] = []; const alo: number[] = []; const kin: number[] = []; const end: number[] = []; const wid: number[] = [];
  const idx: number[] = [];
  const P = world.mode === 'loop' ? world.sizeMeters : 0;
  const shiftFor = (mx: number, mz: number): [number, number] => (P <= 0 ? [0, 0] : [Math.round(((x0 + x1) / 2 - mx) / P) * P, Math.round(((z0 + z1) / 2 - mz) / P) * P]);
  const inside = (x: number, z: number): boolean => x >= x0 && x < x1 && z >= z0 && z < z1;
  const vert = (x: number, y: number, z: number, a: number, al: number, k: number, e: number, w: number): number => {
    pos.push(x - x0, y, z - z0); wor.push(x, z); acr.push(a); alo.push(al); kin.push(k); end.push(e); wid.push(w);
    return pos.length / 3 - 1;
  };
  const quad = (a: number, b: number, c: number, d: number): void => { idx.push(a, b, c, b, d, c); };
  const net = world.roadNetwork();
  const regions = net.regionsNear(x0 - 60, z0 - 60, x1 + 60, z1 + 60);

  /**
   * A planned road: only between its two trims (the junction pads are drawn as discs), each segment in the tile that holds its middle,
   * and a run of segments that is straight and evenly graded drawn as ONE quad (a 400 m straight street is 2 triangles, not 80).
   */
  function plannedRibbon(road: Road): void {
    const p = road.points;
    const L = road.length;
    const [ta, tb] = road.trim ?? [0, 0];
    const kind = road.kind === 'lane' ? ROAD_KIND.lane : road.kind === 'street' ? ROAD_KIND.street : ROAD_KIND.multilane;
    const sOf = (i: number): number => p[i].s ?? i * ROAD_STEP;
    const drawn = (j: number): boolean => sOf(j) >= ta - 1e-6 && sOf(j + 1) <= L - tb + 1e-6;
    let j = 0;
    while (j < p.length - 1) {
      const a = p[j]; const b = p[j + 1];
      const [sx, sz] = shiftFor((a.x + b.x) / 2, (a.z + b.z) / 2);
      if (!drawn(j) || !inside((a.x + b.x) / 2 + sx, (a.z + b.z) / 2 + sz)) { j++; continue; }
      if (a.bridge && b.bridge) {
        bridgeSegment(road, j, sx, sz, ROAD_KIND.deck, sOf(j), sOf(j + 1), ta, tb);
        j++;
        continue;
      }
      // Extend the run while the next segment is drawn here, straight on, off any bridge, and the heights stay on one line.
      let k = j + 1;
      while (k < p.length - 1 && drawn(k) && !(p[k].bridge && p[k + 1].bridge)) {
        const c = p[k + 1];
        const [tx, tz] = shiftFor((p[k].x + c.x) / 2, (p[k].z + c.z) / 2);
        if (tx !== sx || tz !== sz || !inside((p[k].x + c.x) / 2 + sx, (p[k].z + c.z) / 2 + sz)) break;
        const d0 = Math.atan2(b.z - a.z, b.x - a.x); const d1 = Math.atan2(c.z - p[k].z, c.x - p[k].x);
        let dd = d1 - d0; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
        if (Math.abs(dd) > 0.004) break;
        const s0 = sOf(j); const s1 = sOf(k + 1);
        let linear = true;
        for (let m = j + 1; m <= k && linear; m++) { const t = (sOf(m) - s0) / Math.max(1e-9, s1 - s0); if (Math.abs(p[m].y - (a.y + (c.y - a.y) * t)) > 0.02) linear = false; }
        if (!linear) break;
        k++;
      }
      bridgeSegment(road, j, sx, sz, kind, sOf(j), sOf(k), ta, tb, k);
      j = k;
    }
  }

  /** One ribbon quad from point j to point e (default j + 1); a bridge deck also gets its rails and piers. */
  function bridgeSegment(road: Road, j: number, sx: number, sz: number, kind: number, sa: number, sb: number, ta: number, tb: number, e = j + 1): void {
    const a = road.points[j]; const b = road.points[e];
    const ex = b.x - a.x; const ez = b.z - a.z; const len = Math.hypot(ex, ez) || 1;
    const fx = ex / len; const fz = ez / len;
    const nx = -fz; const nz = fx;
    const bridge = kind === ROAD_KIND.deck;
    const ends = [a, b]; const arcs = [sa, sb];
    const rowIdx: number[] = [];
    const rails: number[][] = [[], []];
    for (let k = 0; k < 2; k++) {
      const pt = ends[k];
      const half = pt.width / 2;
      const along = arcs[k];
      const toEnd = Math.min(along - ta, road.length - tb - along);
      const ox = fx * (k === 0 ? -0.25 : 0.25); const oz = fz * (k === 0 ? -0.25 : 0.25);
      const cx = pt.x + sx + ox; const cz = pt.z + sz + oz;
      const yl = pt.y + 0.07; const yr = pt.y + 0.07;
      rowIdx.push(vert(cx - nx * half, yl, cz - nz * half, 0, along, kind, toEnd, pt.width));
      rowIdx.push(vert(cx + nx * half, yr, cz + nz * half, 1, along, kind, toEnd, pt.width));
      if (bridge) {
        rails[0].push(vert(cx - nx * half, yl, cz - nz * half, 0, along, ROAD_KIND.concrete, toEnd, pt.width));
        rails[0].push(vert(cx - nx * half, yl + 1.1, cz - nz * half, 0, along, ROAD_KIND.concrete, toEnd, pt.width));
        rails[1].push(vert(cx + nx * half, yr, cz + nz * half, 1, along, ROAD_KIND.concrete, toEnd, pt.width));
        rails[1].push(vert(cx + nx * half, yr + 1.1, cz + nz * half, 1, along, ROAD_KIND.concrete, toEnd, pt.width));
      }
    }
    quad(rowIdx[0], rowIdx[1], rowIdx[2], rowIdx[3]);
    if (bridge) {
      for (const r of rails) quad(r[0], r[1], r[2], r[3]);
      if (j % 3 === 0) {
        const bed = world.heightAt(a.x, a.z) - 0.6;
        const top = a.y - 0.4;
        const hw = 1.2;
        const corner = (sxn: number, szn: number): number[] => {
          const px = a.x + sx + (fx * sxn + nx * szn) * hw; const pz = a.z + sz + (fz * sxn + nz * szn) * hw;
          return [vert(px, top, pz, 0.5, 0, ROAD_KIND.concrete, 0, a.width), vert(px, bed, pz, 0.5, 0, ROAD_KIND.concrete, 0, a.width)];
        };
        const c0 = corner(-1, -1); const c1 = corner(1, -1); const c2 = corner(1, 1); const c3 = corner(-1, 1);
        quad(c0[0], c0[1], c1[0], c1[1]); quad(c1[0], c1[1], c2[0], c2[1]); quad(c2[0], c2[1], c3[0], c3[1]); quad(c3[0], c3[1], c0[0], c0[1]);
      }
    }
  }
  for (const reg of regions) {
    for (const road of reg.roads) {
      const n = road.points.length;
      const segs = road.closed ? n : n - 1;
      if (road.planned) { plannedRibbon(road); continue; }
      for (let j = 0; j < segs; j++) {
        const a = road.points[j]; const b = road.points[(j + 1) % n];
        const [sx, sz] = shiftFor((a.x + b.x) / 2, (a.z + b.z) / 2);
        if (!inside((a.x + b.x) / 2 + sx, (a.z + b.z) / 2 + sz)) continue;
        const ex = b.x - a.x; const ez = b.z - a.z; const len = Math.hypot(ex, ez) || 1;
        const fx = ex / len; const fz = ez / len;
        const nx = -fz; const nz = fx;
        const bridge = a.bridge && b.bridge;
        const kind = bridge ? ROAD_KIND.deck : road.kind === 'runway' ? ROAD_KIND.runway : road.kind === 'circuit' ? ROAD_KIND.circuit : ROAD_KIND.highway;
        const ends = [a, b];
        const rowIdx: number[] = [];
        const rails: number[][] = [[], []];
        for (let k = 0; k < 2; k++) {
          const p = ends[k];
          const half = p.width / 2;
          const along = (j + k) * ROAD_STEP;
          const toEnd = road.closed ? 1e9 : Math.min(along, road.length - along);
          const ox = fx * (k === 0 ? -0.25 : 0.25); const oz = fz * (k === 0 ? -0.25 : 0.25);
          const cx = p.x + sx + ox; const cz = p.z + sz + oz;
          const t = Math.tan(p.bank);
          const yl = p.y - half * t + 0.07; const yr = p.y + half * t + 0.07;
          rowIdx.push(vert(cx - nx * half, yl, cz - nz * half, 0, along, kind, toEnd, p.width));
          rowIdx.push(vert(cx + nx * half, yr, cz + nz * half, 1, along, kind, toEnd, p.width));
          if (bridge) {
            rails[0].push(vert(cx - nx * half, yl, cz - nz * half, 0, along, ROAD_KIND.concrete, toEnd, p.width));
            rails[0].push(vert(cx - nx * half, yl + 1.1, cz - nz * half, 0, along, ROAD_KIND.concrete, toEnd, p.width));
            rails[1].push(vert(cx + nx * half, yr, cz + nz * half, 1, along, ROAD_KIND.concrete, toEnd, p.width));
            rails[1].push(vert(cx + nx * half, yr + 1.1, cz + nz * half, 1, along, ROAD_KIND.concrete, toEnd, p.width));
          }
        }
        quad(rowIdx[0], rowIdx[1], rowIdx[2], rowIdx[3]);
        if (bridge) {
          for (const r of rails) quad(r[0], r[1], r[2], r[3]);
          if (j % 3 === 0) {
            // A pier under the deck down to the ground (or river bed) below: four faces, eight triangles.
            const bed = world.heightAt(a.x, a.z) - 0.6;
            const top = a.y - 0.4;
            const hw = 1.2;
            const corner = (sxn: number, szn: number): number[] => {
              const px = a.x + sx + (fx * sxn + nx * szn) * hw; const pz = a.z + sz + (fz * sxn + nz * szn) * hw;
              return [vert(px, top, pz, 0.5, 0, ROAD_KIND.concrete, 0, a.width), vert(px, bed, pz, 0.5, 0, ROAD_KIND.concrete, 0, a.width)];
            };
            const c0 = corner(-1, -1); const c1 = corner(1, -1); const c2 = corner(1, 1); const c3 = corner(-1, 1);
            quad(c0[0], c0[1], c1[0], c1[1]); quad(c1[0], c1[1], c2[0], c2[1]); quad(c2[0], c2[1], c3[0], c3[1]); quad(c3[0], c3[1], c0[0], c0[1]);
          }
        }
      }
    }
    for (const s of reg.sites) {
      const [sx, sz] = shiftFor(s.x, s.z);
      if (!inside(s.x + sx, s.z + sz)) continue;
      const y = s.y + 0.07;
      const centre = vert(s.x + sx, y, s.z + sz, 0.5, 0, ROAD_KIND.plaza, 0, s.radius * 2);
      const ring: number[] = [];
      for (let k = 0; k < PLAZA_SIDES; k++) {
        const ang = (k / PLAZA_SIDES) * Math.PI * 2;
        ring.push(vert(s.x + sx + Math.cos(ang) * s.radius, y, s.z + sz + Math.sin(ang) * s.radius, 0.5, 0, ROAD_KIND.plaza, 0, s.radius * 2));
      }
      for (let k = 0; k < PLAZA_SIDES; k++) idx.push(centre, ring[k], ring[(k + 1) % PLAZA_SIDES]);
    }
    for (const j of reg.junctions ?? []) {
      // A junction pad: a 16-sided disc whose edges (not only corners) reach the pad radius; a roundabout adds its grass island on top.
      const [sx, sz] = shiftFor(j.x, j.z);
      if (!inside(j.x + sx, j.z + sz)) continue;
      const fan = (r: number, y: number, kind: number, sides: number): void => {
        const R = r / Math.cos(Math.PI / sides);
        const c = vert(j.x + sx, y, j.z + sz, 0.5, 0, kind, 0, r * 2);
        const ring: number[] = [];
        for (let k = 0; k < sides; k++) { const ang = (k / sides) * Math.PI * 2; ring.push(vert(j.x + sx + Math.cos(ang) * R, y, j.z + sz + Math.sin(ang) * R, 0.5, 0, kind, 0, r * 2)); }
        for (let k = 0; k < sides; k++) idx.push(c, ring[k], ring[(k + 1) % sides]);
      };
      fan(j.radius, j.y + 0.06, ROAD_KIND.junction, PAD_SIDES);
      if (j.island > 0) fan(j.island, j.y + 0.25, ROAD_KIND.island, 12);
    }
  }
  return {
    position: Float32Array.from(pos), world: Float32Array.from(wor), across: Float32Array.from(acr), along: Float32Array.from(alo),
    kind: Float32Array.from(kin), end: Float32Array.from(end), width: Float32Array.from(wid), index: Uint16Array.from(idx), triangles: idx.length / 3,
  };
}

export function roadVertexShader(): string {
  return [
    'attribute vec2 aWorld; attribute float aAcross; attribute float aAlong; attribute float aKind; attribute float aEnd; attribute float aWidth;',
    'varying vec2 vWorld; varying float vAcross; varying float vAlong; varying float vKind; varying float vEnd; varying float vWidth;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vWorld = aWorld; vAcross = aAcross; vAlong = aAlong; vKind = aKind; vEnd = aEnd; vWidth = aWidth;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\\n');
}

export function roadFragmentShader(): string {
  return [
    'uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uAmbient;',
    'varying vec2 vWorld; varying float vAcross; varying float vAlong; varying float vKind; varying float vEnd; varying float vWidth;',
    '#include <fog_pars_fragment>',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'void main() {',
    '  float k = vKind;',
    '  float lat = (vAcross - 0.5) * vWidth;',
    '  float edge = vWidth * 0.5 - abs(lat);',
    '  float grain = vnoise(vWorld * 0.9) * 0.05 + vnoise(vWorld * 6.0) * 0.03;',
    '  vec3 col = vec3(0.15, 0.15, 0.16) + grain;',
    '  if (k > 1.5 && k < 2.5) {',
    '    col = vec3(0.56, 0.56, 0.54) + grain;',
    '  } else if (k > 4.5 && k < 5.5) {',
    '    col = vec3(0.5, 0.46, 0.4) + vnoise(vWorld * 1.7) * 0.12 + vnoise(vWorld * 7.0) * 0.06;',
    '  } else if (k > 9.5) {',
    '    col = vec3(0.22, 0.4, 0.16) + vnoise(vWorld * 2.3) * 0.1;',
    '  } else if (k > 5.5) {',
    '    float pl = 0.0;',
    '    if (k < 8.5 && edge > 0.3 && edge < 0.5) pl = 1.0;',
    '    if (k < 6.5) {',
    '      float lanes = max(1.0, floor(vWidth * 0.5 / 2.9));',
    '      float lw = vWidth * 0.5 / lanes;',
    '      if (abs(abs(lat) - 0.22) < 0.08) { col = mix(col, vec3(0.9, 0.72, 0.15), 0.9); }',
    '      float r = abs(lat) / lw;',
    '      if (abs(lat) > lw * 0.5 && edge > 0.8 && abs(r - floor(r + 0.5)) * lw < 0.07 && fract(vAlong / 9.0) < 0.4) pl = 1.0;',
    '    } else if (k < 7.5) {',
    '      if (abs(lat) < 0.07 && fract(vAlong / 6.0) < 0.5) pl = 1.0;',
    '    } else {',
    '      col += 0.03;',
    '    }',
    '    if (k < 7.5 && vEnd > 0.6 && vEnd < 3.6 && edge > 0.3 && fract(lat * 0.8) < 0.5) pl = 1.0;',
    '    col = mix(col, vec3(0.92, 0.92, 0.88), pl * 0.9);',
    '  } else {',
    '    if (k > 2.5 && k < 3.5) col += 0.04;',
    '    float line = 0.0;',
    '    if (edge > 0.35 && edge < 0.65) line = 1.0;',
    '    if (k < 0.5 || (k > 0.5 && k < 1.5)) { if (abs(lat) < 0.12 && fract(vAlong / 9.0) < 0.45) line = 1.0; }',
    '    if (k > 2.5 && k < 3.5) {',
    '      if (abs(lat) < 0.45 && fract(vAlong / 50.0) < 0.6) line = 1.0;',
    '      if (vEnd > 8.0 && vEnd < 38.0 && abs(lat) < vWidth * 0.42 && fract(lat * 0.4) < 0.5 && abs(lat) > 1.0) line = 1.0;',
    '    }',
    '    if (k > 3.5 && k < 4.5) {',
    '      if (edge < 1.3) { float blk = mod(floor(vAlong / 3.0), 2.0); col = mix(vec3(0.8, 0.1, 0.1), vec3(0.95), blk); line = 0.0; }',
    '      if (vAlong < 6.0) { float chk = mod(floor(lat / 1.4) + floor(vAlong / 1.4), 2.0); col = vec3(mix(0.05, 0.95, chk)); line = 0.0; }',
    '    }',
    '    col = mix(col, vec3(0.92, 0.92, 0.88), line * 0.9);',
    '  }',
    '  float lit = clamp(uSun.y * 0.9 + 0.1, 0.0, 1.0);',
    '  if (k > 1.5 && k < 2.5) lit = max(lit, 0.45);',
    '  gl_FragColor = vec4(col * (uAmbient + uSunColor * lit), 1.0);',
    '  #include <fog_fragment>',
    '}',
  ].join('\\n');
}

export interface RoadMesh {
  readonly group: ThreeLike;
  update(cameraX: number, cameraZ: number, origin: { x: number; z: number }): void;
  /** Match the light: the direction towards the sun, the sun colour and the ambient colour (hex). */
  setLight(sun: { x: number; y: number; z: number }, sunColor: number, ambientColor: number): void;
  stats(): { tiles: number; triangles: number };
  dispose(): void;
}

export function createRoadMesh(THREE: ThreeLike, world: AthreeWorld, quality: AthreeQuality = 'mid'): RoadMesh {
  const tier = ROAD_TIERS[quality];
  const group = new THREE.Group();
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uSun: { value: new THREE.Vector3(-0.5, 0.8, 0.3).normalize() }, uSunColor: { value: new THREE.Color(0.95, 0.92, 0.82) }, uAmbient: { value: new THREE.Color(0.42, 0.46, 0.5) } },
  ]);
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: roadVertexShader(), fragmentShader: roadFragmentShader(), side: THREE.DoubleSide, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const tiles = new Map<string, { mesh: ThreeLike; x0: number; z0: number; triangles: number }>();
  let scanned = { x: Infinity, z: Infinity };
  let pending: Array<{ i: number; j: number; d: number }> = [];
  let triangles = 0;
  const key = (i: number, j: number): string => i + ',' + j;

  function scan(cx: number, cz: number): void {
    pending = [];
    const reach = tier.radius + tier.tile * 0.71;
    for (let j = Math.floor((cz - reach) / tier.tile); j <= Math.floor((cz + reach) / tier.tile); j++) {
      for (let i = Math.floor((cx - reach) / tier.tile); i <= Math.floor((cx + reach) / tier.tile); i++) {
        const d = Math.hypot((i + 0.5) * tier.tile - cx, (j + 0.5) * tier.tile - cz);
        if (d <= reach && !tiles.has(key(i, j))) pending.push({ i, j, d });
      }
    }
    pending.sort((a, b) => a.d - b.d);
    for (const [k, t] of Array.from(tiles)) {
      if (Math.hypot(t.x0 + tier.tile / 2 - cx, t.z0 + tier.tile / 2 - cz) > reach * 1.25) {
        if (t.mesh) { group.remove(t.mesh); t.mesh.geometry.dispose(); }
        triangles -= t.triangles;
        tiles.delete(k);
      }
    }
  }

  function buildTiles(): void {
    for (let built = 0; pending.length > 0 && built < tier.tilesPerUpdate; built++) {
      const p = pending.shift()!;
      const x0 = p.i * tier.tile; const z0 = p.j * tier.tile;
      const a = roadsInRect(world, x0, z0, x0 + tier.tile, z0 + tier.tile);
      if (a.triangles === 0 || triangles + a.triangles > tier.maxTriangles) { tiles.set(key(p.i, p.j), { mesh: null, x0, z0, triangles: 0 }); continue; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      g.setAttribute('aWorld', new THREE.BufferAttribute(a.world, 2));
      g.setAttribute('aAcross', new THREE.BufferAttribute(a.across, 1));
      g.setAttribute('aAlong', new THREE.BufferAttribute(a.along, 1));
      g.setAttribute('aKind', new THREE.BufferAttribute(a.kind, 1));
      g.setAttribute('aEnd', new THREE.BufferAttribute(a.end, 1));
      g.setAttribute('aWidth', new THREE.BufferAttribute(a.width, 1));
      g.setIndex(new THREE.BufferAttribute(a.index, 1));
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      group.add(mesh);
      triangles += a.triangles;
      tiles.set(key(p.i, p.j), { mesh, x0, z0, triangles: a.triangles });
    }
  }

  function update(cameraX: number, cameraZ: number, origin: { x: number; z: number }): void {
    const ti = Math.floor(cameraX / tier.tile); const tj = Math.floor(cameraZ / tier.tile);
    if (ti !== scanned.x || tj !== scanned.z || pending.length > 0) {
      if (ti !== scanned.x || tj !== scanned.z) { scanned = { x: ti, z: tj }; scan(cameraX, cameraZ); }
      buildTiles();
    }
    for (const t of tiles.values()) if (t.mesh) t.mesh.position.set(t.x0 - origin.x, 0, t.z0 - origin.z);
  }

  function setLight(sun: { x: number; y: number; z: number }, sunColor: number, ambientColor: number): void {
    uniforms.uSun.value.set(sun.x, Math.max(sun.y, 0.05), sun.z).normalize();
    uniforms.uSunColor.value.set(sunColor);
    uniforms.uAmbient.value.set(ambientColor);
  }

  function dispose(): void {
    for (const t of tiles.values()) { if (t.mesh) { group.remove(t.mesh); t.mesh.geometry.dispose(); } }
    tiles.clear();
    material.dispose();
    triangles = 0;
  }

  return { group, update, setLight, stats: () => ({ tiles: Array.from(tiles.values()).filter((t) => t.mesh).length, triangles }), dispose };
}
`;
