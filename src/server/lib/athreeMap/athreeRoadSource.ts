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
// roads.ts is PURE (no three.js). roadmesh.ts draws it: asphalt ribbons with procedural lane markings, kerbs, a start line, bridge decks,
// rails and piers, built per tile.
//
// PURE source strings; the generator writes them. Rule for editing: no backticks and no dollar-brace inside the strings below.

export const ROADS = `// Athree map — roads, a race circuit, runways, village plazas and bridges (pure: no three.js).
// Technique: flat-site hashing, A-star routing with slope and river costs, Chaikin smoothing, graded height profile, banked closed spline,
// weighted carve of continuous candidates, 125 m spatial grid, regions generated on demand. Own implementation.

import { mulberry32 } from './noise';

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

export type RoadKind = 'circuit' | 'highway' | 'runway';
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
}

export interface Road {
  id: number;
  kind: RoadKind;
  closed: boolean;
  points: RoadPoint[];
  /** Length in metres (a closed road includes the closing segment). */
  length: number;
  /** Site ids at each end of a highway (-1 otherwise). */
  from: number;
  to: number;
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
  /** The surface height of a river or lake at a place, or null on dry ground. kind tells a river (bridgeable) from a lake. */
  water(x: number, z: number): { surface: number; kind: 'river' | 'lake' } | null;
}

export interface Region {
  roads: Road[];
  sites: Site[];
  circuit: Circuit | null;
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
  const regionsPer = P > 0 ? Math.round(P / REGION) : 0;
  const gridPer = P > 0 ? Math.round(P / GRID) : 0;
  const wrapG = (i: number): number => (gridPer > 0 ? ((i % gridPer) + gridPer) % gridPer : i);
  const wrapD = (d: number): number => (P > 0 ? d - Math.round(d / P) * P : d);
  const canon = (v: number): number => (P > 0 ? v - Math.floor(v / P) * P : v);
  const gkey = (cx: number, cz: number): number => (wrapG(cx) + 100000) * 400009 + (wrapG(cz) + 100000);

  interface Built extends Region { grid: Map<number, Seg[]>; siteGrid: Map<number, number[]>; x0: number; z0: number; size: number }
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
    const size = bounded ? o.radius * 2 : REGION;
    const x0 = bounded ? -o.radius : rx * REGION;
    const z0 = bounded ? -o.radius : rz * REGION;
    const rng = mulberry32(mix32(rx, rz, o.seed + 311));
    const roads: Road[] = [];
    const sites: Site[] = [];
    const home = bounded || (rx === 0 && rz === 0);
    const inner = 150;
    const inside = (x: number, z: number, m = inner): boolean => x >= x0 + m && x < x0 + size - m && z >= z0 + m && z < z0 + size - m && (!bounded || Math.hypot(x, z) < o.radius * 0.82);

    // ---- circuit ---------------------------------------------------------------------------------------------------------------
    let circuit: Circuit | null = null;
    let circuitCentre: { x: number; z: number; r: number } | null = null;
    if (home && o.profile === 'racing') {
      const R = bounded ? Math.min(320, o.radius * 0.13) : 600;
      const cands: Array<{ x: number; z: number; score: number }> = [];
      for (let k = 0; k < 260; k++) {
        const cx = x0 + R * 1.6 + rng() * (size - R * 3.2);
        const cz = z0 + R * 1.6 + rng() * (size - R * 3.2);
        if (!inside(cx, cz, R * 1.6)) continue;
        const h0 = terrain(cx, cz);
        if (h0 < 4 || h0 > 150) continue;
        let sum = 0; let sum2 = 0; let wet = 0; let rivers = 0;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const px = cx + Math.cos(a) * R; const pz = cz + Math.sin(a) * R;
          const h = terrain(px, pz); sum += h; sum2 += h * h;
          const w = o.water(px, pz);
          if (h < 1.5 || (w && w.kind === 'lake')) wet++; else if (w) rivers++;
        }
        const mean = sum / 24;
        const score = Math.sqrt(Math.max(0, sum2 / 24 - mean * mean)) + wet * 400 + rivers * 25;
        if (wet === 0) cands.push({ x: cx, z: cz, score });
      }
      cands.sort((p, q) => p.score - q.score);
      const shape = { a: rng() * 6.28, b: rng() * 6.28, c: rng() * 6.28 };
      // The best flat place first; if the road cannot follow the ground there within the cut and fill limit, the next best.
      for (const best of cands.slice(0, 8)) {
        const ctrl: Array<[number, number]> = [];
        for (let i = 0; i < 36; i++) {
          const th = (i / 36) * Math.PI * 2;
          const rr = R * (1 + 0.28 * Math.sin(2 * th + shape.a) + 0.16 * Math.sin(3 * th + shape.b) + 0.08 * Math.sin(5 * th + shape.c));
          ctrl.push([best.x + Math.cos(th) * rr, best.z + Math.sin(th) * rr]);
        }
        const xy = resample(ctrl, true, 2);
        const pts = profile(xy, true, 14, false);
        if (pts.some((p) => !p.bridge && Math.abs(p.y - terrain(p.x, p.z)) > MAX_CUT_FILL)) continue;
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

    // ---- runways: a flat strip along +x --------------------------------------------------------------------------------------------
    const runwayCentres: Array<{ x: number; z: number }> = [];
    if (home && o.profile !== 'racing') {
      const want = o.profile === 'flight' ? 2 : 1;
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
            if (h < 5 || o.water(cx + i * 50, cz + dz)) wet = true;
            sum += h; sum2 += h * h; n++;
          }
          if (wet) continue;
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

    // ---- villages: plazas on flat ground -------------------------------------------------------------------------------------------
    const cell = size / (bounded ? 4 : 5);
    const nCells = bounded ? 4 : 5;
    for (let cz = 0; cz < nCells; cz++) {
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
          if (h0 < 6 || h0 > 150 || o.water(sx, sz)) continue;
          let ok = true;
          for (let i = 0; i < 8 && ok; i++) {
            const a = (i / 8) * Math.PI * 2;
            const px = sx + Math.cos(a) * 65; const pz = sz + Math.sin(a) * 65;
            if (Math.abs(terrain(px, pz) - h0) > 6 || o.water(px, pz) || terrain(px, pz) < 4) ok = false;
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
      if (h < 1.5 || (w && w.kind === 'lake') || !inside(x, z, 60)) c = Infinity;
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
    const route = (a: Site, b: Site): Array<[number, number]> | null => {
      const sx = Math.floor(a.x / CELL); const sz = Math.floor(a.z / CELL);
      const gx = Math.floor(b.x / CELL); const gz = Math.floor(b.z / CELL);
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
            const step = Math.hypot(dx, dz) * (isFinite(c) ? c : 1);
            const g = g0 + step;
            const nk = key(nx, nz);
            if (g < (gScore.get(nk) ?? Infinity)) { gScore.set(nk, g); came.set(nk, key(cur[0], cur[1])); heap.push([nx, nz], g + Math.hypot(gx - nx, gz - nz)); }
          }
        }
      }
      return null;
    };
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

    // ---- spatial grid ----------------------------------------------------------------------------------------------------------------
    const grid = new Map<number, Seg[]>();
    const siteGrid = new Map<number, number[]>();
    const register = <T>(map: Map<number, T[]>, ax: number, az: number, bx: number, bz: number, item: T): void => {
      for (let cz = Math.floor(az / GRID); cz <= Math.floor(bz / GRID); cz++) {
        for (let cx = Math.floor(ax / GRID); cx <= Math.floor(bx / GRID); cx++) {
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
        const pad = Math.max(a.width, b.width) / 2 + MAX_SHOULDER + 5;
        register(grid, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad, { road: r.id, j });
      }
    }
    for (const s of sites) { const pad = PLAZA_RADIUS + PLAZA_SHOULDER + 5; register(siteGrid, s.x - pad, s.z - pad, s.x + pad, s.z + pad, s.id); }
    return { roads, sites, circuit, grid, siteGrid, x0, z0, size };
  }

  function regionFor(x: number, z: number): Built {
    if (bounded) {
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

  interface Cand { w: number; bed: number; d: number; seg: Seg | null; t: number; across: number; width: number; y: number; bridge: boolean }

  function eachCandidate(x: number, z: number, groundHeight: number, cb: (c: Cand) => void): void {
    const reg = regionFor(x, z);
    const gk = gkey(Math.floor(x / GRID), Math.floor(z / GRID));
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
        const shoulder = Math.min(MAX_SHOULDER, Math.max(5, 1.3 * Math.abs(groundHeight - edgeY)));
        const w = bridge ? 0 : e <= 0 ? 1 : 1 - smooth(e / shoulder);
        cb({ w, bed: edgeY, d, seg: s, t, across, width, y, bridge });
      }
    }
    const sl = reg.siteGrid.get(gk);
    if (sl) {
      for (const id of sl) {
        const s = reg.sites[id];
        const d = Math.hypot(wrapD(s.x - x), wrapD(s.z - z));
        const e = d - s.radius;
        const w = e <= 0 ? 1 : 1 - smooth(e / PLAZA_SHOULDER);
        cb({ w, bed: s.y, d, seg: null, t: 0, across: 0, width: s.radius * 2, y: s.y, bridge: false });
      }
    }
  }

  function carve(x: number, z: number, groundHeight: number): number {
    let sumW = 0; let sumB = 0; let maxW = 0;
    eachCandidate(x, z, groundHeight, (c) => { if (c.w > 0) { sumW += c.w; sumB += c.w * c.bed; if (c.w > maxW) maxW = c.w; } });
    if (sumW <= 0) return groundHeight;
    return groundHeight + (sumB / sumW - groundHeight) * maxW;
  }

  function roadAt(x: number, z: number): RoadHit | null {
    const reg = regionFor(x, z);
    let best: RoadHit | null = null;
    let bestD = Infinity;
    eachCandidate(x, z, 0, (c) => {
      if (!c.seg || c.d > c.width / 2 || c.d >= bestD) return;
      const road = reg.roads[c.seg.road];
      bestD = c.d;
      best = { road: road.id, kind: road.kind, across: c.across, along: (c.seg.j + c.t) * ROAD_STEP, width: c.width, y: c.bed, bridge: c.bridge };
    });
    return best;
  }

  function drivableHeightAt(x: number, z: number, groundHeight: number): number {
    const h = roadAt(x, z);
    return h && h.bridge ? Math.max(groundHeight, h.y) : groundHeight;
  }

  function regionsNear(ax: number, az: number, bx: number, bz: number): Region[] {
    if (bounded) return [regionFor(0, 0)];
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

  return { regionAt: regionFor, carve, roadAt, drivableHeightAt, home: () => regionFor(bounded ? 0 : 1, bounded ? 0 : 1), regionsNear };
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
`;

export const ROADMESH = `// Athree map — roads on screen: asphalt ribbons with lane markings, kerbs, a start line, runways, plazas, bridge decks, rails and piers.
// Technique: ribbons along the road points built per tile and streamed a few per frame; all markings are drawn in the fragment shader from
// the position across and along the road (no texture); lit by the sky's sun like the plants. Own implementation.

import { type AthreeQuality } from './config';
import { ROAD_STEP } from './roads';
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

export const ROAD_TIERS: Record<AthreeQuality, RoadTier> = {
  phone: { radius: 400, tile: 256, maxTriangles: 1800, tilesPerUpdate: 2 },
  mid: { radius: 700, tile: 256, maxTriangles: 5000, tilesPerUpdate: 3 },
  desktop: { radius: 1300, tile: 512, maxTriangles: 10000, tilesPerUpdate: 4 },
};

/** What a vertex of the road mesh is: how the shader paints it. */
export const ROAD_KIND = { highway: 0, deck: 1, concrete: 2, runway: 3, circuit: 4, plaza: 5 } as const;

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
  for (const reg of regions) {
    for (const road of reg.roads) {
      const n = road.points.length;
      const segs = road.closed ? n : n - 1;
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
    '  } else if (k > 4.5) {',
    '    col = vec3(0.5, 0.46, 0.4) + vnoise(vWorld * 1.7) * 0.12 + vnoise(vWorld * 7.0) * 0.06;',
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
