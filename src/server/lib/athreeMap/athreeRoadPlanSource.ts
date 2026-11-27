// ATHREE MAP — ROADS ON EVERY MAP SIZE: THE PLANNED NETWORK (admin 2026-11-27, "frame -> natural boundary -> water -> ground -> ROADS
// (straight, random, curvy as the user wants; when unsaid, a highway + smart-city road grid) -> colonies between roads").
//
// Until this, a map under 20 km (an island under 6 km) had NO roads at all: the only network was villages joined by A-star highways in
// 12.5 km regions, which a 1 to 5 km map cannot hold. The default game map is now about 5 square km (2.2 km a side), so the road step
// had to work on a small, bounded piece of land. This is that step. It is appended to the emitted roads.ts (src/game/athree/roads.ts),
// so it shares the road types, the carve and the mesh, and adds no new file to the kit.
//
// How it works (public ideas, own code):
//   1. A STYLE lays strokes over the land: grid (regular blocks, main roads every few blocks, a highway ring round the town and a highway
//      through it), highway (superblocks between highways and main roads), organic (an old town of lanes on a jittered lattice, some
//      links missing, every lane gently bent), hill (a coarse jittered lattice whose roads wind along the slope in serpentines), straight
//      (long straight roads right across the land at a seeded angle). The town is put where the land is driest and flattest.
//   2. The strokes are planarised (every crossing is a junction), junctions closer than 22 m are merged, and on a bigger map highways run
//      out from the ring to villages on flat ground, routed by the same A-star as the old highways.
//   3. Every road is checked against the land: never in the sea, a lake or a pond, never through a race circuit or a runway; a river is
//      crossed on a bridge deck 3.5 m above the water. Only the largest connected piece is kept, so the network is ONE graph.
//   4. Junction heights are relaxed until every road between them can climb at no more than 7 percent; each road is flat for its junction
//      pad, then follows the smoothed ground inside a 7 percent grade and a 14 m cut-and-fill limit (a road that cannot is dropped).
//   5. The faces of the planar graph are the BLOCKS: polygons enclosed by roads on every side, the data the colony step builds on.
//   6. route() is a shortest path over the graph in the LEFT lane (India keeps left), round a roundabout with its island on the right.
//
// PURE source string; rule for editing: no backticks and no dollar-brace inside it.

export const ROAD_PLAN = `
// ===================================================================================================================================
// THE PLANNED NETWORK: roads on any map size, in a style (grid, highway, organic, hill, straight). See the header of athreeRoadPlanSource.
// ===================================================================================================================================

export type RoadStyle = 'grid' | 'highway' | 'organic' | 'hill' | 'straight';
export const ROAD_STYLES: readonly RoadStyle[] = ['grid', 'highway', 'organic', 'hill', 'straight'];
/** A planned network is laid on a map up to this side (metres). A bigger map keeps the regional village network. */
export const PLAN_MAX_SIDE = 25000;
/** Below these sides a map always gets the planned network (the regional network cannot fit), even when no style is asked for. */
export const PLAN_BELOW: { loop: number; bounded: number } = { loop: 20000, bounded: 6000 };
/** The steepest a planned road climbs (the same 7 percent as every other road). */
export const PLAN_MAX_GRADE = 0.07;

export type PlannedKind = 'highway' | 'main' | 'street' | 'lane';

/** Lanes (both directions together) and paved width of each kind of road. A highway is 4 lanes, or 6 on a map of 5 km and up. */
export function plannedClass(kind: PlannedKind, big: boolean): { lanes: number; width: number } {
  if (kind === 'highway') return big ? { lanes: 6, width: 21 } : { lanes: 4, width: 14 };
  if (kind === 'main') return { lanes: 4, width: 12 };
  if (kind === 'street') return { lanes: 2, width: 7 };
  return { lanes: 2, width: 4.5 };
}

/** How far left of the centre line the kerb-side (left) lane runs, for a road of this width and lane count (India keeps left). */
export function leftLaneOffset(width: number, lanes: number): number {
  const lw = width / Math.max(2, lanes);
  return width / 2 - lw / 2;
}

export interface Junction {
  id: number;
  x: number;
  z: number;
  /** Height of the flat junction pad. */
  y: number;
  /** Radius of the paved pad (and of the roundabout's outer edge). */
  radius: number;
  /** A roundabout's central island radius, or 0 for a plain crossing. */
  island: number;
  /** Ids of the roads that meet here. */
  roads: number[];
  /** Water is within the pad's shoulder: the carve leaves the water alone. */
  nearWater?: boolean;
}

/** A piece of land enclosed by roads on every side: where the colony step builds. Pure data. */
export interface Block {
  id: number;
  /** The enclosing road CENTRE lines, in order round the block (no repeated last point). Inset each side by sides[i].half to reach the kerb. */
  polygon: Array<{ x: number; z: number }>;
  /** For each polygon side i (polygon[i] to polygon[i + 1]): the road along it and half its paved width. */
  sides: Array<{ road: number; half: number }>;
  /** Dead-end roads that run INTO the block (a lane cut short by the shore, a village highway): keep them clear too. */
  inner: number[];
  /** Area inside the centre lines, in square metres. */
  area: number;
  centroid: { x: number; z: number };
}

export interface RoadGraph {
  nodes: Array<{ id: number; x: number; z: number; y: number; roads: number[] }>;
  edges: Array<{ road: number; a: number; b: number; length: number; kind: string; lanes: number; width: number }>;
}

export interface RoutePoint { x: number; y: number; z: number }

type XZ = [number, number];

interface PNode { x: number; z: number; y: number; edges: number[]; frame: boolean; pad: number; flat: number; island: number; fixed: boolean; joint: boolean }
interface PEdge { a: number; b: number; kind: PlannedKind; mid: XZ[]; alive: boolean; frame: boolean; curvy: boolean; site: number }

const PLAN_RANK: Record<PlannedKind, number> = { highway: 3, main: 2, street: 1, lane: 0 };
const PLAN_JSHOULDER = 6;
const PLAN_MIN_EDGE = 22;

export interface PlanInput {
  seed: number;
  style: RoadStyle;
  /** The square the town may use. */
  cx: number;
  cz: number;
  half: number;
  /** The whole map's side, metres (highways are 6 lanes from 5 km up). */
  side: number;
  /** A loop map's period (0 on an island): river and lake geometry from any copy of the world is moved to the copy the town is in. */
  period: number;
  /** Below this height (and outside a river) the ground is sea or beach: no road. */
  landLine: number;
  terrain(x: number, z: number): number;
  water(x: number, z: number): { surface: number; kind: string } | null;
  /** A race circuit or runway is there: no road. */
  blocked(x: number, z: number): boolean;
  /** Rivers and lakes as lines and circles (see RoadOptions.bodies). */
  bodies?(): { rivers: Array<{ points: Array<{ x: number; z: number; surface: number; width: number }> }>; lakes: Array<{ x: number; z: number; radius: number }> };
  /** The A-star of the regional highways, from one point to another; avoid() marks cells it must not enter. */
  route(ax: number, az: number, bx: number, bz: number, avoid: (x: number, z: number) => boolean): XZ[] | null;
  firstRoad: number;
  firstSite: number;
}

export interface PlanOutput {
  roads: Road[];
  sites: Site[];
  junctions: Junction[];
  blocks: Block[];
  graph: RoadGraph;
}

function planCross(p: XZ, q: XZ, r: XZ, s: XZ, eps: number): number | null {
  const dx = q[0] - p[0]; const dz = q[1] - p[1]; const ex = s[0] - r[0]; const ez = s[1] - r[1];
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((r[0] - p[0]) * ez - (r[1] - p[1]) * ex) / den;
  const u = ((r[0] - p[0]) * dz - (r[1] - p[1]) * dx) / den;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return Math.min(1, Math.max(0, t));
}

/** The least distance between two polylines, leaving out the first and last skip metres of each (where they may meet at a junction). */
function planGap(a: XZ[], b: XZ[], skip: number): number {
  const trimmed = (p: XZ[]): XZ[] => {
    const L = planLength(p);
    if (L <= 2 * skip + 1) return [];
    const n = Math.max(2, Math.ceil((L - 2 * skip) / 4));
    return planAt(p, Array.from({ length: n + 1 }, (_, i) => skip + ((L - 2 * skip) * i) / n));
  };
  const pa = trimmed(a); const pb = trimmed(b);
  let best = Infinity;
  for (const p of pa) for (const q of pb) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
}

/** Two open polylines cross somewhere other than at their end points. */
function planPolylinesCross(a: XZ[], b: XZ[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    const ax0 = Math.min(a[i][0], a[i + 1][0]); const ax1 = Math.max(a[i][0], a[i + 1][0]);
    const az0 = Math.min(a[i][1], a[i + 1][1]); const az1 = Math.max(a[i][1], a[i + 1][1]);
    for (let j = 0; j < b.length - 1; j++) {
      if (Math.max(b[j][0], b[j + 1][0]) < ax0 || Math.min(b[j][0], b[j + 1][0]) > ax1 || Math.max(b[j][1], b[j + 1][1]) < az0 || Math.min(b[j][1], b[j + 1][1]) > az1) continue;
      const dx = a[i + 1][0] - a[i][0]; const dz = a[i + 1][1] - a[i][1]; const ex = b[j + 1][0] - b[j][0]; const ez = b[j + 1][1] - b[j][1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((b[j][0] - a[i][0]) * ez - (b[j][1] - a[i][1]) * ex) / den;
      const u = ((b[j][0] - a[i][0]) * dz - (b[j][1] - a[i][1]) * dx) / den;
      const e = 1e-4;
      if (t > e && t < 1 - e && u > e && u < 1 - e) return true;
    }
  }
  return false;
}

function planChaikin(raw: XZ[], passes: number): XZ[] {
  let pts = raw;
  for (let pass = 0; pass < passes; pass++) {
    const next: XZ[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function planLength(pts: XZ[]): number {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}

/** Points of a polyline at the given arc lengths (sorted). */
function planAt(pts: XZ[], arcs: number[]): XZ[] {
  const out: XZ[] = [];
  let seg = 0; let acc = 0;
  for (const s of arcs) {
    while (seg < pts.length - 2) {
      const l = Math.hypot(pts[seg + 1][0] - pts[seg][0], pts[seg + 1][1] - pts[seg][1]);
      if (acc + l >= s) break;
      acc += l; seg++;
    }
    const a = pts[seg]; const b = pts[seg + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(1, Math.max(0, (s - acc) / l));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

export interface PlanWater {
  /** The highest river surface within reach (half metres either side) of a stretch p..q, or null. */
  riverNear(px: number, pz: number, qx: number, qz: number, half: number): number | null;
  /** A lake (or pond) within reach (half metres) of a point. */
  lakeNear(x: number, z: number, half: number): boolean;
}

/**
 * Rivers as segments in 100 m cells and lakes as circles. A small map's rivers are under a metre wide, so a road, a junction pad, a
 * runway or a road's shoulder is kept off them by this geometry, not by point tests that could step over one. On a loop map the
 * geometry of any copy of the world is moved to the copy round cx.
 */
export function planWaterIndex(bodies: { rivers: Array<{ points: Array<{ x: number; z: number; surface: number; width: number }> }>; lakes: Array<{ x: number; z: number; radius: number }> } | null, period: number, cx: number): PlanWater {
  const cells = new Map<number, Array<{ ax: number; az: number; bx: number; bz: number; half: number; surface: number }>>();
  const ckey = (x: number, z: number): number => (Math.floor(x / 100) + 50000) * 100003 + (Math.floor(z / 100) + 50000);
  const shift = (x: number): number => (period > 0 ? -Math.round((x - cx) / period) * period : 0);
  for (const rv of bodies ? bodies.rivers : []) {
    const p = rv.points;
    for (let i = 0; i < p.length - 1; i++) {
      const sx = shift((p[i].x + p[i + 1].x) / 2); const sz = shift((p[i].z + p[i + 1].z) / 2);
      const seg = { ax: p[i].x + sx, az: p[i].z + sz, bx: p[i + 1].x + sx, bz: p[i + 1].z + sz, half: Math.max(p[i].width, p[i + 1].width) / 2, surface: Math.min(p[i].surface, p[i + 1].surface) };
      const pad = seg.half + 50;
      for (let gx = Math.floor((Math.min(seg.ax, seg.bx) - pad) / 100); gx <= Math.floor((Math.max(seg.ax, seg.bx) + pad) / 100); gx++) {
        for (let gz = Math.floor((Math.min(seg.az, seg.bz) - pad) / 100); gz <= Math.floor((Math.max(seg.az, seg.bz) + pad) / 100); gz++) {
          const k = (gx + 50000) * 100003 + (gz + 50000);
          const l = cells.get(k);
          if (l) l.push(seg); else cells.set(k, [seg]);
        }
      }
    }
  }
  const pt = (x: number, z: number, x0: number, z0: number, x1: number, z1: number): number => {
    const ex = x1 - x0; const ez = z1 - z0; const l2 = ex * ex + ez * ez || 1;
    const t = Math.min(1, Math.max(0, ((x - x0) * ex + (z - z0) * ez) / l2));
    return Math.hypot(x0 + ex * t - x, z0 + ez * t - z);
  };
  const segDist = (px: number, pz: number, qx: number, qz: number, ax: number, az: number, bx: number, bz: number): number =>
    planCross([px, pz], [qx, qz], [ax, az], [bx, bz], 0) !== null ? 0 : Math.min(pt(px, pz, ax, az, bx, bz), pt(qx, qz, ax, az, bx, bz), pt(ax, az, px, pz, qx, qz), pt(bx, bz, px, pz, qx, qz));
  const lakes = (bodies ? bodies.lakes : []).map((l) => ({ x: l.x + shift(l.x), z: l.z + shift(l.z), radius: l.radius }));
  return {
    riverNear(px, pz, qx, qz, half) {
      let hit: number | null = null;
      const seen = new Set<object>();
      const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qz - pz) / 50));
      for (let i = 0; i <= n; i++) {
        for (const sg of cells.get(ckey(px + ((qx - px) * i) / n, pz + ((qz - pz) * i) / n)) ?? []) {
          if (seen.has(sg)) continue;
          seen.add(sg);
          if (segDist(px, pz, qx, qz, sg.ax, sg.az, sg.bx, sg.bz) <= sg.half + half + 1) hit = hit === null ? sg.surface : Math.max(hit, sg.surface);
        }
      }
      return hit;
    },
    lakeNear: (x, z, half) => lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.radius + half + 2),
  };
}

/** Lay out, check, profile and measure a planned network. Deterministic for a seed. */
export function planRoadNetwork(o: PlanInput): PlanOutput {
  const rng = mulberry32(mix32(o.seed, ROAD_STYLES.indexOf(o.style) + 1, 7717));
  const nodes: PNode[] = [];
  const edges: PEdge[] = [];
  const nodeHash = new Map<number, number[]>();
  const hkey = (x: number, z: number): number => (Math.floor(x / 4) + 50000) * 100003 + (Math.floor(z / 4) + 50000);
  const big = o.side >= 5000;

  function node(x: number, z: number, frame: boolean): number {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = nodeHash.get(hkey(x + dx * 4, z + dz * 4));
      if (list) for (const id of list) if (Math.hypot(nodes[id].x - x, nodes[id].z - z) < 1) { if (frame) nodes[id].frame = true; return id; }
    }
    nodes.push({ x, z, y: 0, edges: [], frame, pad: 0, flat: 0, island: 0, fixed: false, joint: false });
    const id = nodes.length - 1;
    const k = hkey(x, z);
    const list = nodeHash.get(k);
    if (list) list.push(id); else nodeHash.set(k, [id]);
    return id;
  }
  function edge(a: number, b: number, kind: PlannedKind, frame: boolean): number {
    if (a === b) return -1;
    for (const e of nodes[a].edges) {
      const E = edges[e];
      if ((E.a === a && E.b === b) || (E.a === b && E.b === a)) { if (PLAN_RANK[kind] > PLAN_RANK[E.kind]) E.kind = kind; E.frame = E.frame || frame; return e; }
    }
    edges.push({ a, b, kind, mid: [], alive: true, frame, curvy: false, site: -1 });
    const id = edges.length - 1;
    nodes[a].edges.push(id); nodes[b].edges.push(id);
    return id;
  }
  function kill(e: number): void {
    const E = edges[e];
    if (!E.alive) return;
    E.alive = false;
    nodes[E.a].edges = nodes[E.a].edges.filter((x) => x !== e);
    nodes[E.b].edges = nodes[E.b].edges.filter((x) => x !== e);
  }
  const degree = (n: number): number => nodes[n].edges.length;

  /** Every crossing of two strokes becomes a junction. */
  function planarise(strokes: Array<{ p: XZ; q: XZ; kind: PlannedKind; frame: boolean }>): void {
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i];
      const ts = [0, 1];
      for (let j = 0; j < strokes.length; j++) {
        if (j === i) continue;
        const t = planCross(s.p, s.q, strokes[j].p, strokes[j].q, 1e-6);
        if (t !== null) ts.push(t);
      }
      ts.sort((a, b) => a - b);
      const len = Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1]);
      const keep: number[] = [];
      for (const t of ts) if (!keep.length || (t - keep[keep.length - 1]) * len > 0.5) keep.push(t);
      if (keep[keep.length - 1] < 1) keep[keep.length - 1] = 1;
      let prev = node(s.p[0], s.p[1], s.frame);
      for (let k = 1; k < keep.length; k++) {
        const t = keep[k];
        const cur = node(s.p[0] + (s.q[0] - s.p[0]) * t, s.p[1] + (s.q[1] - s.p[1]) * t, s.frame);
        edge(prev, cur, s.kind, s.frame);
        prev = cur;
      }
    }
  }

  /** Junctions closer than PLAN_MIN_EDGE are one junction (no 5 m stub of road between two crossings). */
  function contractShort(): void {
    for (let guard = 0; guard < 4; guard++) {
      let merged = false;
      for (let e = 0; e < edges.length; e++) {
        const E = edges[e];
        if (!E.alive || E.mid.length) continue;
        const A = nodes[E.a]; const B = nodes[E.b];
        if (Math.hypot(A.x - B.x, A.z - B.z) >= PLAN_MIN_EDGE) continue;
        const keepA = A.frame || !B.frame;
        const into = keepA ? E.a : E.b; const gone = keepA ? E.b : E.a;
        if (!(nodes[into].frame && nodes[gone].frame)) {
          if (!nodes[into].frame) { nodes[into].x = (A.x + B.x) / 2; nodes[into].z = (A.z + B.z) / 2; }
        }
        kill(e);
        for (const f of nodes[gone].edges.slice()) {
          const F = edges[f];
          const other = F.a === gone ? F.b : F.a;
          kill(f);
          if (other !== into) {
            const g = edge(into, other, F.kind, F.frame);
            if (g >= 0) { edges[g].mid = F.mid; edges[g].curvy = F.curvy; }
          }
        }
        merged = true;
      }
      if (!merged) break;
    }
  }

  // ---- 1. the town: where, and how big ----------------------------------------------------------------------------------------------
  const coreMax = o.style === 'organic' ? 1500 : o.style === 'highway' ? 3200 : o.style === 'straight' ? 6000 : 2600;
  const C = Math.min(o.half * 2, coreMax);
  let ccx = o.cx; let ccz = o.cz;
  const dryAt = (x: number, z: number): boolean => {
    const w = o.water(x, z);
    return !o.blocked(x, z) && (w ? false : o.terrain(x, z) >= o.landLine);
  };
  if (C < o.half * 2 - 1) {
    let best = -Infinity;
    const span = o.half - C / 2;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      const x = o.cx + (i / 3) * span; const z = o.cz + (j / 3) * span;
      let dry = 0; let rough = 0;
      for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
        const px = x - C / 2 + (a / 8) * C; const pz = z - C / 2 + (b / 8) * C;
        if (dryAt(px, pz)) dry++;
        rough += Math.abs(o.terrain(px + 20, pz) - o.terrain(px - 20, pz)) / 40;
      }
      const score = dry - rough * 2 - Math.hypot(x - o.cx, z - o.cz) / Math.max(1, span) * 4;
      if (score > best) { best = score; ccx = x; ccz = z; }
    }
  }
  const X0 = ccx - C / 2; const X1 = ccx + C / 2; const Z0 = ccz - C / 2; const Z1 = ccz + C / 2;

  // ---- 2. the style's strokes ----------------------------------------------------------------------------------------------------------
  const strokes: Array<{ p: XZ; q: XZ; kind: PlannedKind; frame: boolean }> = [];
  const frameKind: PlannedKind = o.style === 'organic' || o.style === 'hill' || o.style === 'straight' ? 'main' : 'highway';
  strokes.push({ p: [X0, Z0], q: [X1, Z0], kind: frameKind, frame: true }, { p: [X1, Z0], q: [X1, Z1], kind: frameKind, frame: true });
  strokes.push({ p: [X1, Z1], q: [X0, Z1], kind: frameKind, frame: true }, { p: [X0, Z1], q: [X0, Z0], kind: frameKind, frame: true });
  const lattice = (cellX: number, cellZ: number, kindOf: (axis: 0 | 1, i: number, n: number) => PlannedKind): void => {
    const nx = Math.max(2, Math.round(C / cellX)); const nz = Math.max(2, Math.round(C / cellZ));
    for (let i = 1; i < nx; i++) { const x = X0 + (i / nx) * C; strokes.push({ p: [x, Z0], q: [x, Z1], kind: kindOf(0, i, nx), frame: false }); }
    for (let j = 1; j < nz; j++) { const z = Z0 + (j / nz) * C; strokes.push({ p: [X0, z], q: [X1, z], kind: kindOf(1, j, nz), frame: false }); }
  };
  if (o.style === 'grid') {
    // A smart-city grid: blocks of 100 to 130 m by 75 to 100 m, a main road every fourth line, one highway through the middle.
    lattice(100 + 30 * rng(), 75 + 25 * rng(), (axis, i, n) => (axis === 0 && i === Math.round(n / 2) && C >= 1200 ? 'highway' : i === Math.round(n / 2) || i % 4 === 0 ? 'main' : 'street'));
  } else if (o.style === 'highway') {
    // Superblocks of 300 to 420 m between main roads; the two middle lines are highways, crossing at a roundabout.
    lattice(300 + 120 * rng(), 300 + 120 * rng(), (_axis, i, n) => (i === Math.round(n / 2) ? 'highway' : 'main'));
  } else if (o.style === 'organic') {
    lattice(60 + 22 * rng(), 60 + 22 * rng(), (_axis, i) => (i % 3 === 0 ? 'street' : 'lane'));
  } else if (o.style === 'hill') {
    lattice(210 + 60 * rng(), 210 + 60 * rng(), (_axis, i) => (i % 2 === 0 ? 'main' : 'street'));
  } else {
    // Long straight roads right across the land, two families at a seeded angle; the middle one of each is a highway.
    const th = (rng() - 0.5) * 0.8;
    const c = Math.cos(th); const s = Math.sin(th);
    const sp = Math.max(180, Math.min(600, C / 5));
    for (const fam of [0, 1]) {
      const dir: XZ = fam === 0 ? [c, s] : [-s, c];
      const nrm: XZ = [-dir[1], dir[0]];
      const n = Math.floor((C * 0.75) / sp);
      for (let k = -n; k <= n; k++) {
        const off = k * sp + (k === 0 ? 0 : (rng() - 0.5) * sp * 0.3);
        const px = ccx + nrm[0] * off; const pz = ccz + nrm[1] * off;
        // Clip the infinite line p + t * dir to the town square.
        let t0 = -Infinity; let t1 = Infinity;
        for (const [p0, d, lo, hi] of [[px, dir[0], X0, X1], [pz, dir[1], Z0, Z1]] as Array<[number, number, number, number]>) {
          if (Math.abs(d) < 1e-9) { if (p0 <= lo || p0 >= hi) { t0 = 1; t1 = 0; } continue; }
          const a = (lo - p0) / d; const b = (hi - p0) / d;
          t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
        }
        if (t1 - t0 < sp) continue;
        const p: XZ = [px + dir[0] * t0, pz + dir[1] * t0]; const q: XZ = [px + dir[0] * t1, pz + dir[1] * t1];
        // A line that meets the frame within 30 m of a corner would leave a sliver of a block: leave it out.
        const nearCorner = (pt: XZ): boolean => [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]].some((cn) => Math.hypot(cn[0] - pt[0], cn[1] - pt[1]) < 30);
        if (nearCorner(p) || nearCorner(q)) continue;
        strokes.push({ p, q, kind: k === 0 ? 'highway' : 'main', frame: false });
      }
    }
  }
  planarise(strokes);
  contractShort();
  // A long road is split at JOINTS (no pad, no crossing) about every 130 m, so where one stretch meets the shore or a cliff only that
  // stretch is lost, not the whole road from crossing to crossing.
  for (let e = 0, n0 = edges.length; e < n0; e++) {
    const E = edges[e];
    if (!E.alive) continue;
    const A = nodes[E.a]; const B = nodes[E.b];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const k = Math.ceil(L / 130);
    if (k < 2 || o.style === 'organic') continue;
    const { a, b, kind, frame } = E;
    kill(e);
    let prev = a;
    for (let i = 1; i <= k; i++) {
      const cur = i === k ? b : node(A.x + ((B.x - A.x) * i) / k, A.z + ((B.z - A.z) * i) / k, frame);
      if (i < k) nodes[cur].joint = true;
      edge(prev, cur, kind, frame);
      prev = cur;
    }
  }
  const live = (): number => edges.filter((x) => x.alive).length;

  // ---- 3. the style's shape: jitter, missing links, bends and serpentines --------------------------------------------------------------
  if (o.style === 'organic' || o.style === 'hill') {
    const j = o.style === 'organic' ? 0.17 : 0.14;
    const cell = o.style === 'organic' ? 70 : 240;
    for (const n of nodes) if (!n.frame) { n.x += (rng() - 0.5) * 2 * j * cell; n.z += (rng() - 0.5) * 2 * j * cell; }
  }
  if (o.style === 'organic') {
    // An old town: about a quarter of the inner links are not there (two lanes join into one bigger block), and every lane bends a little.
    for (let e = 0; e < edges.length; e++) {
      const E = edges[e];
      if (!E.alive || E.frame) continue;
      if (rng() < 0.27 && degree(E.a) >= 3 && degree(E.b) >= 3) { kill(e); continue; }
      const A = nodes[E.a]; const B = nodes[E.b];
      const L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const off = (rng() - 0.5) * 0.18 * L;
      E.mid = [[(A.x + B.x) / 2 - ((B.z - A.z) / L) * off, (A.z + B.z) / 2 + ((B.x - A.x) / L) * off]];
      E.curvy = true;
    }
  }
  const serpentine = (A: PNode, B: PNode, n: number, amp: number): XZ[] => {
    const L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
    const nx = -(B.z - A.z) / L; const nz = (B.x - A.x) / L;
    const out: XZ[] = [];
    const steps = Math.max(4, n * 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const off = Math.sin(t * Math.PI * n) * amp * L * Math.sin(t * Math.PI);
      out.push([A.x + (B.x - A.x) * t + nx * off, A.z + (B.z - A.z) * t + nz * off]);
    }
    return out;
  };
  if (o.style === 'hill') {
    // Each road winds: of a few serpentines (1 to 3 bends, 12 to 30 percent of its length to the side) one that keeps the raw ground
    // nearest a 6 percent climb wins; a road on level ground still winds.
    for (const E of edges) {
      if (!E.alive) continue;
      const A = nodes[E.a]; const B = nodes[E.b];
      let best: XZ[] = serpentine(A, B, 1, 0.12); let bestScore = Infinity;
      for (const n of [1, 2, 3]) for (const amp of [0.12, 0.18, 0.24, 0.3]) {
        const mid = serpentine(A, B, n, amp);
        const poly = planChaikin([[A.x, A.z], ...mid, [B.x, B.z]], 1);
        const L = planLength(poly);
        const pts = planAt(poly, Array.from({ length: Math.max(2, Math.round(L / 20)) + 1 }, (_, i) => (i / Math.max(2, Math.round(L / 20))) * L));
        let worst = 0;
        for (let i = 1; i < pts.length; i++) worst = Math.max(worst, Math.abs(o.terrain(pts[i][0], pts[i][1]) - o.terrain(pts[i - 1][0], pts[i - 1][1])) / (L / (pts.length - 1)));
        // On ground the road can climb anyway, a seeded choice among the serpentines that do (so a hill town winds, and no two look alike).
        const score = Math.max(0, worst - 0.06) * 1000 + rng() * 0.5;
        if (score < bestScore) { bestScore = score; best = mid; }
      }
      E.mid = best; E.curvy = true;
    }
  }

  // ---- 4. highways out to villages on a bigger map ------------------------------------------------------------------------------------
  const sites: Site[] = [];
  const outer = o.half - C / 2;
  if (outer > 700) {
    const want = o.half > 5000 ? 6 : 4;
    const rot = rng() * Math.PI * 2;
    const inCore = (x: number, z: number): boolean => x > X0 - 40 && x < X1 + 40 && z > Z0 - 40 && z < Z1 + 40;
    for (let k = 0; k < want; k++) {
      const ang = rot + (k / want) * Math.PI * 2;
      let site: Site | null = null;
      for (let d = C / 2 + 450; d < C / 2 + outer - 250 && !site; d += 150) {
        for (const da of [0, 0.15, -0.15, 0.3, -0.3]) {
          const sx = ccx + Math.cos(ang + da) * d; const sz = ccz + Math.sin(ang + da) * d;
          if (Math.abs(sx - o.cx) > o.half - 150 || Math.abs(sz - o.cz) > o.half - 150 || o.blocked(sx, sz)) continue;
          const h0 = o.terrain(sx, sz);
          if (h0 < o.landLine * 4 || o.water(sx, sz)) continue;
          let ok = true;
          for (let i = 0; i < 8 && ok; i++) {
            const a = (i / 8) * Math.PI * 2;
            const px = sx + Math.cos(a) * 65; const pz = sz + Math.sin(a) * 65;
            if (Math.abs(o.terrain(px, pz) - h0) > 6 || o.water(px, pz) || o.terrain(px, pz) < o.landLine * 2 || o.blocked(px, pz)) ok = false;
          }
          if (ok) { site = { id: o.firstSite + sites.length, x: sx, z: sz, y: h0, radius: PLAZA_RADIUS }; break; }
        }
      }
      if (!site) continue;
      // From the nearest junction on the town's ring.
      let from = -1; let bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        if (!nodes[i].frame || !nodes[i].edges.length) continue;
        const d = Math.hypot(nodes[i].x - site.x, nodes[i].z - site.z);
        if (d < bd) { bd = d; from = i; }
      }
      if (from < 0) continue;
      const path = o.route(nodes[from].x, nodes[from].z, site.x, site.z, (x, z) => inCore(x, z) && Math.hypot(x - nodes[from].x, z - nodes[from].z) > 160);
      if (!path || path.length < 3) continue;
      let poly: XZ[] = planChaikin([[nodes[from].x, nodes[from].z], ...path.slice(1, -1), [site.x, site.z]], 2);
      // The highway ends exactly at the plaza's edge (4 m inside the shoulder), on the segment that crosses it.
      let cut = poly.length - 1;
      while (cut > 1 && Math.hypot(poly[cut][0] - site.x, poly[cut][1] - site.z) < PLAZA_RADIUS + 4) cut--;
      if (cut < poly.length - 1) {
        const p0 = poly[cut]; const p1 = poly[cut + 1];
        let lo = 0; let hi = 1;
        for (let it = 0; it < 30; it++) { const t = (lo + hi) / 2; if (Math.hypot(p0[0] + (p1[0] - p0[0]) * t - site.x, p0[1] + (p1[1] - p0[1]) * t - site.z) > PLAZA_RADIUS + 4) lo = t; else hi = t; }
        poly = [...poly.slice(0, cut + 1), [p0[0] + (p1[0] - p0[0]) * lo, p0[1] + (p1[1] - p0[1]) * lo]];
      }
      if (poly.length < 3) continue;
      const end = node(poly[poly.length - 1][0], poly[poly.length - 1][1], false);
      nodes[end].y = site.y; nodes[end].fixed = true;
      const e = edge(from, end, big ? 'highway' : 'main', false);
      if (e < 0) continue;
      edges[e].mid = poly.slice(1, -1); edges[e].site = sites.length;
      sites.push(site);
    }
  }

  // The centre line of an edge: its end junctions and its bends, smoothed.
  const polyOf = (E: PEdge): XZ[] => {
    const A = nodes[E.a]; const B = nodes[E.b];
    const raw: XZ[] = [[A.x, A.z], ...E.mid, [B.x, B.z]];
    return E.mid.length ? planChaikin(raw, E.site >= 0 ? 0 : 2) : raw;
  };
  const widthOf = (E: PEdge): number => plannedClass(E.kind, big).width;

  // ---- 5. no crossing without a junction ----------------------------------------------------------------------------------------------
  const order = edges.map((_, i) => i).filter((i) => edges[i].alive).sort((p, q) => PLAN_RANK[edges[q].kind] - PLAN_RANK[edges[p].kind] || p - q);
  const placed: Array<{ e: number; poly: XZ[]; x0: number; z0: number; x1: number; z1: number }> = [];
  const boxOf = (poly: XZ[]): { x0: number; z0: number; x1: number; z1: number } => {
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    return { x0, z0, x1, z1 };
  };
  for (const e of order) {
    const E = edges[e];
    const tryPoly = (): boolean => {
      const poly = polyOf(E);
      const b = boxOf(poly);
      const pad = E.curvy ? 40 : 0;
      for (const p of placed) {
        if (p.x1 < b.x0 - pad || p.x0 > b.x1 + pad || p.z1 < b.z0 - pad || p.z0 > b.z1 + pad) continue;
        if (planPolylinesCross(poly, p.poly)) return false;
        // A winding road keeps clear of every other road (their shoulders would fight over the ground between them), away from the
        // junctions they share.
        if (E.curvy || edges[p.e].curvy) {
          const clear = (widthOf(E) + widthOf(edges[p.e])) / 2 + 8;
          if (planGap(poly, p.poly, 30) < clear) return false;
        }
      }
      placed.push({ e, poly, ...b });
      return true;
    };
    if (tryPoly()) continue;
    if (E.curvy && E.site < 0) { E.mid = []; E.curvy = false; if (tryPoly()) continue; }
    kill(e);
  }

  // Rivers as segments and lakes as circles, for the crossings (see PlanInput.bodies).
  const waterIdx = planWaterIndex(o.bodies ? o.bodies() : null, o.period, o.cx);
  const riverNear = waterIdx.riverNear; const lakeNear = waterIdx.lakeNear;
  // ---- 6. never in the sea, a lake or a pond, never through a circuit or runway; a river is bridged -----------------------------------
  for (const E of edges) {
    if (!E.alive) continue;
    const poly = polyOf(E);
    const L = planLength(poly);
    const half = widthOf(E) / 2;
    const n = Math.max(2, Math.ceil(L / 5));
    const pts = planAt(poly, Array.from({ length: n + 1 }, (_, i) => (i / n) * L));
    let wetRun = 0; let bad = false;
    for (let i = 0; i <= n && !bad; i++) {
      const [x, z] = pts[i];
      const k = Math.min(n - 1, i);
      const dx = pts[k + 1][0] - pts[k][0]; const dz = pts[k + 1][1] - pts[k][1]; const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l; const nz = dx / l;
      let river = false;
      for (const side of [0, -half, half]) {
        const px = x + nx * side; const pz = z + nz * side;
        if (o.blocked(px, pz)) { bad = true; break; }
        const w = o.water(px, pz);
        if (w) { if (w.kind !== 'river') { bad = true; break; } river = true; }
        else if (side === 0 && o.terrain(px, pz) < o.landLine) { bad = true; break; }
      }
      if (!bad && lakeNear(x, z, half)) bad = true;
      if (i < n && riverNear(x, z, pts[i + 1][0], pts[i + 1][1], half) !== null) river = true;
      wetRun = river ? wetRun + L / n : 0;
      if (wetRun > 160) bad = true;
    }
    if (bad) kill(edges.indexOf(E));
  }

  const keepLargest = (): void => {
    const comp = new Array(nodes.length).fill(-1);
    let best = -1; let bestLen = -1; let c = 0;
    for (let s = 0; s < nodes.length; s++) {
      if (comp[s] >= 0 || !nodes[s].edges.length) continue;
      let len = 0;
      const stack = [s]; comp[s] = c;
      while (stack.length) {
        const u = stack.pop()!;
        for (const e of nodes[u].edges) {
          const E = edges[e];
          const v = E.a === u ? E.b : E.a;
          len += Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z) / 2;
          if (comp[v] < 0) { comp[v] = c; stack.push(v); }
        }
      }
      if (len > bestLen) { bestLen = len; best = c; }
      c++;
    }
    for (let e = 0; e < edges.length; e++) if (edges[e].alive && comp[edges[e].a] !== best) kill(e);
  };
  keepLargest();

  // ---- 7. junction pads and roundabouts ------------------------------------------------------------------------------------------------
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      const N = nodes[i];
      const deg = N.edges.length;
      N.pad = 0; N.flat = 0; N.island = 0;
      if (deg < 2 || (N.joint && deg === 2)) continue;
      let maxHalf = 0; let hw = 0; let mains = 0;
      for (const e of N.edges) { const E = edges[e]; maxHalf = Math.max(maxHalf, widthOf(E) / 2); if (E.kind === 'highway') hw++; if (E.kind === 'main') mains++; }
      let R = Math.hypot(maxHalf + 2.5, maxHalf) + 0.3;
      const roundabout = deg >= 3 && (hw >= 2 || (hw >= 1 && mains >= 2 && deg === 4) || (o.style === 'highway' && hw >= 1 && deg === 4));
      if (roundabout) { R = Math.max(R, maxHalf * 2 + 8); N.island = Math.max(4, R - (maxHalf + 2)); }
      N.pad = R; N.flat = R + PLAN_JSHOULDER;
      // A junction pad must be dry land.
      let dry = true;
      for (let k = 0; k <= 8 && dry; k++) {
        const a = (k / 8) * Math.PI * 2; const r = k === 8 ? 0 : R;
        const x = N.x + Math.cos(a) * r; const z = N.z + Math.sin(a) * r;
        if (o.water(x, z) || o.terrain(x, z) < o.landLine || o.blocked(x, z)) dry = false;
      }
      if (dry && (riverNear(N.x, N.z, N.x, N.z, R) !== null || lakeNear(N.x, N.z, R))) dry = false;
      if (!dry) for (const e of N.edges.slice()) kill(e);
    }
    keepLargest();
  }

  // ---- 8. junction heights: every road between two junctions can climb at 7 percent or less -------------------------------------------
  const polys: Array<XZ[] | null> = edges.map((E) => (E.alive ? polyOf(E) : null));
  const lens: number[] = polys.map((p) => (p ? planLength(p) : 0));
  const g = PLAN_MAX_GRADE * 0.92;
  // A road whose ends differ by more than a 7 percent climb plus the cut and fill at BOTH ends can never be built: it goes first, so it
  // does not drag the junctions round it off their ground.
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    if (!E.alive) continue;
    const A = nodes[E.a]; const B = nodes[E.b];
    if (Math.abs(o.terrain(A.x, A.z) - o.terrain(B.x, B.z)) > g * Math.max(0, lens[e] - A.flat - B.flat) + MAX_CUT_FILL * 1.5) kill(e);
  }
  keepLargest();
  const profiles: Array<RoadPoint[] | null> = edges.map(() => null);
  // Heights and profiles in rounds: a road that fails is dropped, and the junctions it was pulling are relaxed again without it.
  for (let round = 0; round < 6; round++) {
  const before = live();
  profiles.fill(null);
  for (const N of nodes) {
    if (!N.edges.length || N.fixed) continue;
    const r = Math.max(4, N.pad / 2);
    N.y = (o.terrain(N.x, N.z) * 2 + o.terrain(N.x + r, N.z) + o.terrain(N.x - r, N.z) + o.terrain(N.x, N.z + r) + o.terrain(N.x, N.z - r)) / 6;
  }
  for (let it = 0; it < 80; it++) {
    let moved = 0;
    for (let e = 0; e < edges.length; e++) {
      const E = edges[e];
      if (!E.alive) continue;
      const A = nodes[E.a]; const B = nodes[E.b];
      const lim = g * Math.max(0, lens[e] - A.flat - B.flat);
      const d = B.y - A.y;
      if (Math.abs(d) <= lim) continue;
      const ex = Math.abs(d) - lim; const sg = Math.sign(d);
      if (A.fixed && B.fixed) continue;
      if (A.fixed) B.y -= sg * ex; else if (B.fixed) A.y += sg * ex; else { A.y += (sg * ex) / 2; B.y -= (sg * ex) / 2; }
      moved = Math.max(moved, ex);
    }
    if (moved < 1e-4) break;
  }

  // ---- 9. each road's profile: flat on its pads, bridged over rivers, the smoothed ground inside 7 percent and 14 m of cut and fill -------
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    if (!E.alive) continue;
    const poly = polys[e]!; const L = lens[e];
    const A = nodes[E.a]; const B = nodes[E.b];
    const width = widthOf(E); const half = width / 2;
    const trimA = A.pad > 0 ? Math.sqrt(Math.max(0, A.pad * A.pad - half * half)) : 0;
    const trimB = B.pad > 0 ? Math.sqrt(Math.max(0, B.pad * B.pad - half * half)) : 0;
    if (L < 3) { kill(e); continue; }
    if (L < A.flat + B.flat + 2) {
      if (Math.abs(A.y - B.y) > 0.02) { kill(e); continue; }
    }
    // Arc lengths of the points: the ends, the ribbon trims (the mesh starts and stops exactly there) and the ends of the flat pads (the
    // road is level up to exactly there) first, then every 10 m, each at least 1.5 m from a point already taken.
    const arc: number[] = [];
    const take = (s: number): void => { if (s >= 0 && s <= L && arc.every((t) => Math.abs(t - s) >= 1.5)) arc.push(s); };
    for (const s of [0, L, trimA, L - trimB, Math.min(A.flat, L), Math.max(0, L - B.flat)]) take(s);
    const nUni = Math.max(1, Math.round(L / ROAD_STEP));
    for (let i = 1; i < nUni; i++) take((i / nUni) * L);
    arc.sort((p, q) => p - q);
    const xy = planAt(poly, arc);
    const m = xy.length;
    const ground = xy.map((p) => o.terrain(p[0], p[1]));
    const pinned: Array<number | null> = new Array(m).fill(null);
    const bridge: boolean[] = new Array(m).fill(false);
    for (let i = 0; i < m; i++) {
      if (arc[i] <= A.flat + 1e-9) pinned[i] = A.y;
      else if (arc[i] >= L - B.flat - 1e-9) pinned[i] = B.y;
    }
    // A river under the road (at the centre or either edge, at a point or halfway to the next) makes a bridge from 25 m before it to 25 m
    // after it, on one flat deck. The edges are looked at half a metre outside the paved width, so no water is ever under the asphalt.
    const wetAt = (x: number, z: number, nx: number, nz: number): boolean => [0, -half - 0.5, half + 0.5].some((sd) => !!o.water(x + nx * sd, z + nz * sd));
    const wet: boolean[] = xy.map((p, i) => {
      const q = xy[Math.min(m - 1, i + 1)]; const pr = xy[Math.max(0, i - 1)];
      const dx = q[0] - pr[0]; const dz = q[1] - pr[1]; const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l; const nz = dx / l;
      if (wetAt(p[0], p[1], nx, nz)) return true;
      if (i < m - 1 && riverNear(p[0], p[1], q[0], q[1], half) !== null) return true;
      if (i > 0 && riverNear(pr[0], pr[1], p[0], p[1], half) !== null) return true;
      return i < m - 1 && wetAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, nx, nz);
    });
    let bad = false;
    for (let i = 0; i < m; i++) if (wet[i]) for (let k = 0; k < m; k++) if (Math.abs(arc[k] - arc[i]) <= 25) bridge[k] = true;
    for (let i = 0; i < m && !bad; i++) {
      if (!bridge[i]) continue;
      let j = i;
      while (j + 1 < m && bridge[j + 1]) j++;
      let deck = -Infinity;
      for (let k = i; k <= j; k++) {
        if (pinned[k] !== null) bad = true;
        const w = o.water(xy[k][0], xy[k][1]);
        const rs = riverNear(xy[Math.max(0, k - 1)][0], xy[Math.max(0, k - 1)][1], xy[Math.min(m - 1, k + 1)][0], xy[Math.min(m - 1, k + 1)][1], half);
        deck = Math.max(deck, (w ? w.surface : ground[k]) + BRIDGE_CLEARANCE, (rs ?? -Infinity) + BRIDGE_CLEARANCE, ground[k] + 0.5);
      }
      for (let k = i; k <= j; k++) pinned[k] = deck;
      i = j;
    }
    if (bad) { kill(e); continue; }
    const y: number[] = [];
    for (let i = 0; i < m; i++) {
      if (pinned[i] !== null) { y.push(pinned[i] as number); continue; }
      let s = 0; let c = 0;
      for (let k = 0; k < m; k++) if (Math.abs(arc[k] - arc[i]) <= 50) { s += ground[k]; c++; }
      y.push(s / c);
    }
    for (let pass = 0; pass < 10; pass++) {
      for (let i = 1; i < m; i++) if (pinned[i] === null) { const lim = PLAN_MAX_GRADE * 0.999 * (arc[i] - arc[i - 1]); y[i] = Math.min(y[i - 1] + lim, Math.max(y[i - 1] - lim, y[i])); }
      for (let i = m - 2; i >= 0; i--) if (pinned[i] === null) { const lim = PLAN_MAX_GRADE * 0.999 * (arc[i + 1] - arc[i]); y[i] = Math.min(y[i + 1] + lim, Math.max(y[i + 1] - lim, y[i])); }
    }
    for (let i = 0; i < m - 1 && !bad; i++) if (Math.abs(y[i + 1] - y[i]) > PLAN_MAX_GRADE * (arc[i + 1] - arc[i]) + 1e-9) bad = true;
    for (let i = 0; i < m && !bad; i++) if (!bridge[i] && Math.abs(y[i] - ground[i]) > MAX_CUT_FILL) bad = true;
    if (bad) { kill(e); continue; }
    // A point whose cut-and-fill shoulder (up to 16 m past the kerb) reaches water: the carve leaves the water alone there.
    const reach = half + 16;
    profiles[e] = xy.map((p, i) => {
      const q = xy[Math.min(m - 1, i + 1)];
      const nearWater = riverNear(p[0], p[1], q[0], q[1], reach) !== null || lakeNear(p[0], p[1], reach);
      return nearWater ? { x: p[0], z: p[1], y: y[i], bank: 0, width, bridge: bridge[i], s: arc[i], nearWater } : { x: p[0], z: p[1], y: y[i], bank: 0, width, bridge: bridge[i], s: arc[i] };
    });
  }
  keepLargest();
  if (live() === before) break;
  }

  // ---- 10. the roads, the junctions and the graph ---------------------------------------------------------------------------------------
  const roads: Road[] = [];
  const roadOfEdge = new Map<number, number>();
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    if (!E.alive || !profiles[e]) continue;
    const pts = profiles[e]!;
    const A = nodes[E.a]; const B = nodes[E.b];
    const cls = plannedClass(E.kind, big);
    const half = cls.width / 2;
    const L = pts[pts.length - 1].s ?? lens[e];
    const id = o.firstRoad + roads.length;
    roadOfEdge.set(e, id);
    roads.push({
      id, kind: E.kind, closed: false, points: pts, length: L, from: -1, to: E.site >= 0 ? sites[E.site].id : -1,
      planned: true, lanes: cls.lanes, a: E.a, b: E.b, shoulder: 16,
      trim: [A.pad > 0 ? Math.sqrt(Math.max(0, A.pad * A.pad - half * half)) : 0, B.pad > 0 ? Math.sqrt(Math.max(0, B.pad * B.pad - half * half)) : 0],
    });
  }
  // A village whose highway did not survive the checks is not on the map; the rest are numbered again from firstSite (a site's id is
  // its index in the region's list).
  const liveSites: Site[] = [];
  const siteId = new Map<number, number>();
  sites.forEach((st, k) => {
    if (!edges.some((E, e) => E.alive && E.site === k && roadOfEdge.has(e))) return;
    siteId.set(k, o.firstSite + liveSites.length);
    liveSites.push({ ...st, id: o.firstSite + liveSites.length });
  });
  for (const r of roads) if (r.to >= 0) r.to = siteId.get(r.to - o.firstSite) ?? -1;
  const nodeIds = new Map<number, number>();
  const graph: RoadGraph = { nodes: [], edges: [] };
  for (let i = 0; i < nodes.length; i++) {
    const rs = nodes[i].edges.filter((e) => roadOfEdge.has(e)).map((e) => roadOfEdge.get(e)!);
    if (!rs.length) continue;
    nodeIds.set(i, graph.nodes.length);
    graph.nodes.push({ id: graph.nodes.length, x: nodes[i].x, z: nodes[i].z, y: nodes[i].y, roads: rs });
  }
  for (const r of roads) {
    r.a = nodeIds.get(r.a!)!; r.b = nodeIds.get(r.b!)!;
    graph.edges.push({ road: r.id, a: r.a, b: r.b, length: r.length, kind: r.kind, lanes: r.lanes!, width: r.points[0].width });
  }
  const junctions: Junction[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const N = nodes[i];
    if (!nodeIds.has(i) || N.pad <= 0) continue;
    const gn = graph.nodes[nodeIds.get(i)!];
    if (gn.roads.length < 2) continue;
    const nearWater = riverNear(N.x, N.z, N.x, N.z, N.pad + PLAN_JSHOULDER) !== null || lakeNear(N.x, N.z, N.pad + PLAN_JSHOULDER);
    junctions.push({ id: junctions.length, x: N.x, z: N.z, y: N.y, radius: N.pad, island: N.island, roads: gn.roads.slice(), ...(nearWater ? { nearWater } : {}) });
  }

  // ---- 11. blocks: the faces of the planar graph (dead-end roads left out), enclosed by roads on every side ---------------------------
  const blocks: Block[] = [];
  {
    const byId = new Map<number, Road>(roads.map((r) => [r.id, r]));
    const deg = graph.nodes.map((n) => n.roads.length);
    const live = new Set<number>(roads.map((r) => r.id));
    const queue = graph.nodes.filter((n) => deg[n.id] === 1).map((n) => n.id);
    while (queue.length) {
      const u = queue.pop()!;
      for (const rid of graph.nodes[u].roads) {
        if (!live.has(rid)) continue;
        live.delete(rid);
        const r = byId.get(rid)!;
        const v = r.a === u ? r.b! : r.a!;
        deg[u]--; deg[v]--;
        if (deg[v] === 1) queue.push(v);
      }
    }
    // Outgoing half-edges round each junction, by angle (the direction of the road's first point off the junction).
    const around = new Map<number, Array<{ road: number; ang: number }>>();
    for (const rid of live) {
      const r = byId.get(rid)!;
      const p = r.points;
      const k = Math.min(p.length - 1, 1);
      const kb = Math.max(0, p.length - 2);
      const la = around.get(r.a!) ?? []; la.push({ road: rid, ang: Math.atan2(p[k].z - p[0].z, p[k].x - p[0].x) }); around.set(r.a!, la);
      const lb = around.get(r.b!) ?? []; lb.push({ road: rid, ang: Math.atan2(p[kb].z - p[p.length - 1].z, p[kb].x - p[p.length - 1].x) }); around.set(r.b!, lb);
    }
    for (const l of around.values()) l.sort((p, q) => p.ang - q.ang);
    const used = new Set<string>();
    const faces: Array<{ pts: Array<{ x: number; z: number }>; sides: Array<{ road: number; half: number }>; area: number }> = [];
    for (const rid of live) {
      for (const fwd of [true, false]) {
        if (used.has(rid + (fwd ? '+' : '-'))) continue;
        const pts: Array<{ x: number; z: number }> = []; const sides: Array<{ road: number; half: number }> = [];
        let cur = rid; let dir = fwd; let guard = 0;
        while (!used.has(cur + (dir ? '+' : '-')) && guard++ < 100000) {
          used.add(cur + (dir ? '+' : '-'));
          const r = byId.get(cur)!;
          const p = dir ? r.points : r.points.slice().reverse();
          for (let i = 0; i < p.length - 1; i++) { pts.push({ x: p[i].x, z: p[i].z }); sides.push({ road: cur, half: p[i].width / 2 }); }
          const v = dir ? r.b! : r.a!;
          const list = around.get(v)!;
          const at = list.findIndex((h) => h.road === cur);
          const next = list[(at - 1 + list.length) % list.length];
          cur = next.road;
          const nr = byId.get(cur)!;
          dir = nr.a === v;
        }
        let area = 0;
        for (let i = 0; i < pts.length; i++) { const a = pts[i]; const b = pts[(i + 1) % pts.length]; area += a.x * b.z - b.x * a.z; }
        faces.push({ pts, sides, area: area / 2 });
      }
    }
    if (faces.length) {
      let outer = 0;
      for (let i = 1; i < faces.length; i++) if (Math.abs(faces[i].area) > Math.abs(faces[outer].area)) outer = i;
      const sign = Math.sign(faces[outer].area);
      const insidePoly = (pts: Array<{ x: number; z: number }>, x: number, z: number): boolean => {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i]; const b = pts[j];
          if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
        }
        return inside;
      };
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        if (i === outer || Math.sign(f.area) === sign || Math.abs(f.area) < 600) continue;
        let cx = 0; let cz = 0; let a6 = 0;
        for (let k = 0; k < f.pts.length; k++) {
          const a = f.pts[k]; const b = f.pts[(k + 1) % f.pts.length];
          const cr = a.x * b.z - b.x * a.z; a6 += cr; cx += (a.x + b.x) * cr; cz += (a.z + b.z) * cr;
        }
        const centroid = { x: cx / (3 * a6), z: cz / (3 * a6) };
        // A block that is mostly water (a lake inside a ring of roads), or holds a circuit or runway, is not land to build on.
        let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
        for (const p of f.pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
        let tot = 0; let wetN = 0; let blockedN = 0;
        for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) {
          const x = x0 + ((x1 - x0) * a) / 8; const z = z0 + ((z1 - z0) * b) / 8;
          if (!insidePoly(f.pts, x, z)) continue;
          tot++;
          if (o.water(x, z) || o.terrain(x, z) < o.landLine) wetN++;
          if (o.blocked(x, z)) blockedN++;
        }
        if (tot > 0 && (wetN / tot > 0.35 || blockedN > 0)) continue;
        // Every block is listed counter-clockwise in (x, z) (a positive shoelace area). Reversing the points turns side i (p[i] -> p[i + 1])
        // into side n - 2 - i of the reversed list, so the reversed sides are rotated by one to line up again.
        const rev = f.area < 0;
        const poly = rev ? f.pts.slice().reverse() : f.pts;
        const sides = rev ? f.sides.slice().reverse() : f.sides;
        const fixedSides = rev ? sides.slice(1).concat(sides.slice(0, 1)) : sides;
        const inner: number[] = [];
        for (const r of roads) {
          if (live.has(r.id)) continue;
          const mp = r.points[Math.floor(r.points.length / 2)];
          if (mp.x >= x0 && mp.x <= x1 && mp.z >= z0 && mp.z <= z1 && insidePoly(f.pts, mp.x, mp.z)) inner.push(r.id);
        }
        blocks.push({ id: blocks.length, polygon: poly, sides: fixedSides, inner, area: Math.abs(f.area), centroid });
      }
    }
  }
  return { roads, sites: liveSites, junctions, blocks, graph };
}

interface PlanSnap { road: Road; s: number; d: number }

/** The point of a planned road at arc length s (interpolated between its points). */
function planPointAt(r: Road, s: number): { x: number; z: number; y: number } {
  const p = r.points;
  let k = 0;
  while (k < p.length - 2 && (p[k + 1].s ?? 0) < s) k++;
  const a = p[k]; const b = p[k + 1];
  const sa = a.s ?? 0; const sb = b.s ?? sa + 1;
  const t = Math.min(1, Math.max(0, (s - sa) / Math.max(1e-9, sb - sa)));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * A driving route over a planned network (see RoadNetwork.route). Points are on the centre lines first, then moved into the LEFT lane of
 * their road; a roundabout is driven round its ring with the island on the right (the angle grows: facing along the ring, the centre is
 * on the right in this world, where facing (dx, dz) the left is (dz, -dx)).
 */
export function planRoute(roads: Road[], junctions: Junction[], graph: RoadGraph, from: { x: number; z: number }, to: { x: number; z: number }): RoutePoint[] {
  const planned = roads.filter((r) => r.planned && r.a !== undefined && r.b !== undefined);
  if (!planned.length || !graph.nodes.length) return [];
  const snap = (q: { x: number; z: number }): PlanSnap | null => {
    let best: PlanSnap | null = null;
    for (const r of planned) {
      const p = r.points;
      for (let j = 0; j < p.length - 1; j++) {
        const a = p[j]; const b = p[j + 1];
        const ex = b.x - a.x; const ez = b.z - a.z; const l2 = ex * ex + ez * ez || 1;
        const t = Math.min(1, Math.max(0, ((q.x - a.x) * ex + (q.z - a.z) * ez) / l2));
        const d = Math.hypot(a.x + ex * t - q.x, a.z + ez * t - q.z);
        if (!best || d < best.d) best = { road: r, s: (a.s ?? 0) + t * ((b.s ?? 0) - (a.s ?? 0)), d };
      }
    }
    return best && best.d <= 80 ? best : null;
  };
  const s0 = snap(from); const s1 = snap(to);
  if (!s0 || !s1) return [];
  // Pieces of road in driving order: [road, from arc, to arc].
  const pieces: Array<{ road: Road; a: number; b: number; node: number }> = [];
  if (s0.road === s1.road) pieces.push({ road: s0.road, a: s0.s, b: s1.s, node: -1 });
  else {
    const n = graph.nodes.length;
    const adj: Array<Array<{ to: number; road: Road }>> = Array.from({ length: n }, () => []);
    for (const r of planned) { adj[r.a!].push({ to: r.b!, road: r }); adj[r.b!].push({ to: r.a!, road: r }); }
    const dist = new Array(n).fill(Infinity);
    const prev: Array<{ node: number; road: Road } | null> = new Array(n).fill(null);
    const heap = createHeap<number>();
    const r0 = s0.road;
    dist[r0.a!] = s0.s; dist[r0.b!] = Math.min(dist[r0.b!], r0.length - s0.s);
    heap.push(r0.a!, dist[r0.a!]); heap.push(r0.b!, dist[r0.b!]);
    const done = new Array(n).fill(false);
    while (heap.size()) {
      const u = heap.pop()!;
      if (done[u]) continue;
      done[u] = true;
      for (const e of adj[u]) {
        if (e.road === r0) continue;
        const nd = dist[u] + e.road.length;
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = { node: u, road: e.road }; heap.push(e.to, nd); }
      }
    }
    const r1 = s1.road;
    const viaA = dist[r1.a!] + s1.s; const viaB = dist[r1.b!] + (r1.length - s1.s);
    if (!isFinite(Math.min(viaA, viaB))) return [];
    const end = viaA <= viaB ? r1.a! : r1.b!;
    const chain: Array<{ node: number; road: Road | null }> = [];
    for (let v = end; ; ) { const pv = prev[v]; chain.unshift({ node: v, road: pv ? pv.road : null }); if (!pv) break; v = pv.node; }
    const start = chain[0].node;
    pieces.push({ road: r0, a: s0.s, b: start === r0.a ? 0 : r0.length, node: start });
    for (let k = 1; k < chain.length; k++) {
      const r = chain[k].road!;
      const fromNode = chain[k - 1].node;
      pieces.push({ road: r, a: fromNode === r.a ? 0 : r.length, b: fromNode === r.a ? r.length : 0, node: chain[k].node });
    }
    pieces.push({ road: r1, a: end === r1.a ? 0 : r1.length, b: s1.s, node: -1 });
  }
  const jAt = new Map<number, Junction>();
  for (const j of junctions) for (const g of graph.nodes) if (Math.hypot(g.x - j.x, g.z - j.z) < 0.5) jAt.set(g.id, j);
  const out: Array<{ x: number; z: number; y: number; off: number }> = [];
  for (let k = 0; k < pieces.length; k++) {
    const pc = pieces[k];
    const r = pc.road;
    const off = leftLaneOffset(r.points[0].width, r.lanes ?? 2);
    let a = pc.a; let b = pc.b;
    const jIn = k > 0 ? jAt.get(pieces[k - 1].node) : undefined;
    const jOut = jAt.get(pc.node);
    const ring = (j: Junction): number => (j.island + j.radius) / 2;
    const dir = b >= a ? 1 : -1;
    if (jIn && jIn.island > 0) a += dir * ring(jIn);
    if (jOut && jOut.island > 0) b -= dir * ring(jOut);
    if ((b - a) * dir < 0) { a = (pc.a + pc.b) / 2; b = a; }
    const arcs = [a];
    for (const p of r.points) { const s = p.s ?? 0; if ((s - a) * dir > 0.5 && (b - s) * dir > 0.5) arcs.push(s); }
    arcs.push(b);
    if (dir < 0) arcs.sort((p, q) => q - p); else arcs.sort((p, q) => p - q);
    for (const s of arcs) { const q = planPointAt(r, s); out.push({ ...q, off }); }
    if (jOut && jOut.island > 0 && k < pieces.length - 1) {
      // Round the ring: from the angle we arrive at to the angle we leave by, the angle always growing.
      const rr = ring(jOut);
      const last = out[out.length - 1];
      const nr = pieces[k + 1].road; const na = pieces[k + 1].a; const nb = pieces[k + 1].b;
      const nxt = planPointAt(nr, na + (nb >= na ? 1 : -1) * rr);
      const a0 = Math.atan2(last.z - jOut.z, last.x - jOut.x);
      let a1 = Math.atan2(nxt.z - jOut.z, nxt.x - jOut.x);
      while (a1 <= a0 + 0.05) a1 += Math.PI * 2;
      const steps = Math.max(3, Math.ceil((a1 - a0) / 0.35));
      for (let i = 1; i < steps; i++) { const t = a0 + ((a1 - a0) * i) / steps; out.push({ x: jOut.x + Math.cos(t) * rr, z: jOut.z + Math.sin(t) * rr, y: jOut.y, off: 0 }); }
    }
  }
  const pts = out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.z - out[i - 1].z) > 0.05);
  return pts.map((p, i) => {
    if (p.off <= 0 || pts.length < 2) return { x: p.x, y: p.y, z: p.z };
    const left = (u: { x: number; z: number }, v: { x: number; z: number }): [number, number] => {
      const dx = v.x - u.x; const dz = v.z - u.z; const l = Math.hypot(dx, dz) || 1;
      return [dz / l, -dx / l];
    };
    const lin = i > 0 ? left(pts[i - 1], p) : null;
    const lout = i < pts.length - 1 ? left(p, pts[i + 1]) : null;
    let lx = 0; let lz = 0;
    if (lin && lout) { lx = lin[0] + lout[0]; lz = lin[1] + lout[1]; const l = Math.hypot(lx, lz); if (l < 0.5) { lx = lout[0]; lz = lout[1]; } else { const c = l / 2; lx = (lx / l) / Math.max(0.6, c); lz = (lz / l) / Math.max(0.6, c); } }
    else { const l = (lout ?? lin)!; lx = l[0]; lz = l[1]; }
    return { x: p.x + lx * p.off, y: p.y, z: p.z + lz * p.off };
  });
}
`;
