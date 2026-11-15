// ATHREE MAP — phase 2b: RIVERS AND LAKES (the emitted source of src/game/athree/rivers.ts and riverwater.ts).
//
// 100% ours. Technique (public idea, own code): water runs downhill. Sources are picked by a hash in the highlands; each river is traced
// down the steepest descent of the terrain WITHOUT rivers (with a little momentum, so it meanders); where two traces meet they join (a
// confluence, flow adds up, the river gets wider); where the ground has no way down, a lake fills the basin up to its lowest rim and an
// outlet river leaves from that rim; every river ends in the sea, in a lake, or in another river. The water level only ever goes down
// along a river. The terrain is then carved along the paths, so the SAME height function feeds the renderer, the physics collider and the
// water mesh, and a boat or a car meets exactly the bed that is drawn.
//
// rivers.ts is PURE (no three.js). riverwater.ts draws it: ribbons and lake discs with a flowing-water shader, built per tile.
//
// PURE source strings; the generator writes them. Rule for editing: no backticks and no dollar-brace inside the strings below.

export const RIVERS = `// Athree map — rivers and lakes (pure: no three.js).
// Technique: steepest-descent tracing with momentum on the carving-free terrain, confluences that add flow, pit-filling lakes with an
// outlet, a monotone water level, a spatial grid for queries, and a carve profile (bed, bank, terrain). Own implementation.

import { mulberry32 } from './noise';

export const RIVER_STEP = 62.5;
const GRID = 125;
const MAX_STEPS = 1400;
/** The widest a bank may be, whatever the depth of the cut: the grid below lists every segment out to this reach, so none can pop in at a cell edge. */
const MAX_BANK = 90;
/** A river that would have to climb more than this above its lowest point treats the ground as a rim: it fills a lake or breaches. */
const MAX_CLIMB = 15;
const EPS = 25;

export interface RiverPoint {
  x: number;
  z: number;
  /** Water surface height. Never rises along a river. */
  surface: number;
  width: number;
}

export type RiverEnd = 'sea' | 'lake' | 'river' | 'limit';

export interface River {
  id: number;
  points: RiverPoint[];
  end: RiverEnd;
  /** end === 'river': the river this one joins, and the point of that river where it does. */
  host: number;
  hostIndex: number;
  /** end === 'lake': the lake it fills. */
  lake: number;
  /** A river that leaves a lake starts at that lake's rim. */
  fromLake: number;
}

export interface Lake {
  id: number;
  x: number;
  z: number;
  radius: number;
  level: number;
}

export interface WaterHit {
  kind: 'river' | 'lake';
  surface: number;
  /** Unit flow direction (zero on a lake). */
  fx: number;
  fz: number;
  width: number;
}

export interface RiverOptions {
  seed: number;
  /** Loop period in metres, or 0 for a bounded world. */
  period: number;
  /** Bounded world: the island radius (sources are only placed inside it). */
  radius: number;
  /** The terrain WITHOUT rivers. */
  baseHeight(x: number, z: number): number;
  /** A source must stand at least this high (metres). */
  minSource: number;
}

export interface RiverNetwork {
  readonly rivers: River[];
  readonly lakes: Lake[];
  /** The terrain height with the rivers and lakes carved in. */
  carve(x: number, z: number, baseH: number): number;
  /** The water at a place, or null on dry ground. */
  waterAt(x: number, z: number): WaterHit | null;
  /** Metres to the nearest water edge (negative inside water). Infinity when no water is within about a hundred metres. */
  edgeDistance(x: number, z: number): number;
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function mix32(a: number, b: number, c: number): number {
  return (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) | 0;
}

export function createRiverNetwork(o: RiverOptions): RiverNetwork {
  const P = o.period;
  const bh = o.baseHeight;
  const cellsPer = P > 0 ? Math.round(P / RIVER_STEP) : 0;
  const gridPer = P > 0 ? Math.round(P / GRID) : 0;
  const wrapC = (i: number): number => (cellsPer > 0 ? ((i % cellsPer) + cellsPer) % cellsPer : i);
  const wrapG = (i: number): number => (gridPer > 0 ? ((i % gridPer) + gridPer) % gridPer : i);
  const wrapD = (d: number): number => (P > 0 ? d - Math.round(d / P) * P : d);
  const rivers: River[] = [];
  const lakes: Lake[] = [];
  const occupied = new Map<number, { r: number; i: number }>();
  const ckey = (cx: number, cz: number): number => (wrapC(cx) + 100000) * 400009 + (wrapC(cz) + 100000);

  const occupy = (x: number, z: number, r: number, i: number): void => {
    const k = ckey(Math.floor(x / RIVER_STEP), Math.floor(z / RIVER_STEP));
    if (!occupied.has(k)) occupied.set(k, { r, i });
  };

  function findOccupied(x: number, z: number, id: number, step: number): { r: number; i: number } | null {
    const cx = Math.floor(x / RIVER_STEP);
    const cz = Math.floor(z / RIVER_STEP);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const hit = occupied.get(ckey(cx + dx, cz + dz));
        if (!hit) continue;
        const host = rivers[hit.r];
        if (hit.i >= host.points.length) continue;
        if (hit.r === id && step - hit.i < 16) continue;
        return hit;
      }
    }
    return null;
  }

  function trace(sx: number, sz: number, initDir: [number, number] | null, chain: number, fromLake: number): void {
    const id = rivers.length;
    const river: River = { id, points: [], end: 'limit', host: -1, hostIndex: -1, lake: -1, fromLake };
    rivers.push(river);
    let x = sx;
    let z = sz;
    let dx = initDir ? initDir[0] : 0;
    let dz = initDir ? initDir[1] : 0;
    let minH = bh(x, z);
    let minIdx = 0;
    let up = 0;
    let breaches = 0;
    river.points.push({ x, z, surface: minH, width: 4 });
    occupy(x, z, id, 0);
    for (let step = 1; step < MAX_STEPS; step++) {
      // Which way is down: the local slope, and the slope over a few hundred metres (so a flat plain still drains towards the sea).
      let tx = 0;
      let tz = 0;
      for (const [eps, weight] of [[EPS, 1], [160, 2], [1000, 24], [4000, 80]] as Array<[number, number]>) {
        tx -= ((bh(x + eps, z) - bh(x - eps, z)) / (2 * eps)) * weight;
        tz -= ((bh(x, z + eps) - bh(x, z - eps)) / (2 * eps)) * weight;
      }
      const tl = Math.hypot(tx, tz);
      if (tl > 1e-6) { tx /= tl; tz /= tl; } else { tx = dx; tz = dz; }
      // Meander: on gentle ground the river swings from side to side; on a steep slope it runs straight down.
      const steep = Math.min(1, Math.hypot(bh(x + EPS, z) - bh(x - EPS, z), bh(x, z + EPS) - bh(x, z - EPS)) / (2 * EPS) * 4);
      const swing = 0.55 * Math.sin(step * 0.13 + id * 1.7) * (1 - steep);
      const cs = Math.cos(swing);
      const sn = Math.sin(swing);
      const mx = tx * cs - tz * sn;
      tz = tx * sn + tz * cs;
      tx = mx;
      if (dx === 0 && dz === 0) { dx = tx; dz = tz; }
      // On gentle ground a river has momentum (it keeps its heading and only bends slowly); on a steep slope it follows the fall line.
      const mom = 0.45 + 0.4 * (1 - steep);
      dx = dx * mom + tx * (1 - mom);
      dz = dz * mom + tz * (1 - mom);
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const nx = x + dx * RIVER_STEP;
      const nz = z + dz * RIVER_STEP;
      const nh = bh(nx, nz);
      const hit = step > 2 ? findOccupied(nx, nz, id, step) : null;
      let stuck = false;
      if (hit && hit.r !== id) {
        const hp = rivers[hit.r].points[hit.i];
        river.points.push({ x: nx + wrapD(hp.x - nx), z: nz + wrapD(hp.z - nz), surface: hp.surface, width: 4 });
        river.end = 'river';
        river.host = hit.r;
        river.hostIndex = hit.i;
        return;
      }
      if (hit && hit.r === id) {
        // The river came back onto its own path: it is circling in a basin, which is a pit.
        stuck = true;
      } else {
        river.points.push({ x: nx, z: nz, surface: nh, width: 4 });
        occupy(nx, nz, id, river.points.length - 1);
        x = nx;
        z = nz;
        if (nh < 0) { river.end = 'sea'; return; }
        if (nh < minH - 0.01) { minH = nh; minIdx = river.points.length - 1; up = 0; } else up++;
        // Water does not climb a ridge: more than 15 m above the lowest ground it has reached means the way is blocked (a pit).
        if (nh > minH + MAX_CLIMB) up = 99;
      }
      const lastStep = step === MAX_STEPS - 1;
      if (stuck || up > 12 || lastStep) {
        // A pit: no way down from here. The basin fills up to its lowest rim and becomes a lake; the river leaves from that rim.
        const low = river.points[minIdx];
        river.points.length = minIdx + 1;
        const R0 = 110;
        let rimMin = Infinity;
        let rimAng = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rh = bh(low.x + Math.cos(a) * R0, low.z + Math.sin(a) * R0);
          if (rh < rimMin) { rimMin = rh; rimAng = a; }
        }
        const bottom = bh(low.x, low.z);
        const shallow = rimMin - bottom < 0.2 || lakes.length >= 120 || chain >= 4;
        if (shallow && breaches < 6 && !lastStep) {
          // Too shallow to hold water: the river runs straight for the lowest ground within a kilometre.
          breaches++;
          // Which way is out: the lowest ground within a kilometre, but never turning back the way the river came.
          const before = river.points[Math.max(0, minIdx - 1)];
          const hl = Math.hypot(low.x - before.x, low.z - before.z) || 1;
          const hx = (low.x - before.x) / hl;
          const hz = (low.z - before.z) / hl;
          let farMin = Infinity;
          let farAng = Math.atan2(hz, hx);
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            if (Math.cos(a) * hx + Math.sin(a) * hz < 0.2) continue;
            const fh = bh(low.x + Math.cos(a) * 1000, low.z + Math.sin(a) * 1000);
            if (fh < farMin) { farMin = fh; farAng = a; }
          }
          dx = Math.cos(farAng);
          dz = Math.sin(farAng);
          x = low.x;
          z = low.z;
          let blocked = false;
          for (let k = 0; k < 8; k++) {
            x += dx * RIVER_STEP;
            z += dz * RIVER_STEP;
            const bz = bh(x, z);
            if (bz > bottom + MAX_CLIMB) { blocked = true; break; }
            river.points.push({ x, z, surface: bz, width: 4 });
            occupy(x, z, id, river.points.length - 1);
            if (bz < 0) { river.end = 'sea'; return; }
          }
          if (blocked) {
            // The only way out climbs a ridge: this basin has no outlet, so the river ends in a lake here.
            river.points.length = minIdx + 1;
            breaches = 99;
            up = 99;
            x = low.x;
            z = low.z;
            continue;
          }
          up = 0;
          minH = bh(x, z);
          minIdx = river.points.length - 1;
          continue;
        }
        // A basin with a real rim fills to just under its lowest rim and has an outlet. A river that found no way out after six
        // breaches (or ran out of length) ends in a dug terminal lake, which is what such rivers do (the Caspian is one): the level
        // is still under the lowest rim, so the water can never sit above the ground around it.
        const lake: Lake = { id: lakes.length, x: low.x, z: low.z, radius: R0 * 0.9, level: Math.max(0.05, rimMin - 0.25) };
        lakes.push(lake);
        river.end = 'lake';
        river.lake = lake.id;
        if (!shallow) trace(low.x + Math.cos(rimAng) * R0 * 1.05, low.z + Math.sin(rimAng) * R0 * 1.05, [Math.cos(rimAng), Math.sin(rimAng)], chain + 1, lake.id);
        return;
      }
    }
  }

  // Sources: one candidate per cell, in the highlands.
  const cell = P > 0 ? 3125 : 1200;
  const chance = P > 0 ? 0.2 : 0.35;
  const lo = P > 0 ? 0 : -o.radius;
  const n = P > 0 ? Math.round(P / cell) : Math.ceil((2 * o.radius) / cell);
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const rng = mulberry32(mix32(cx, cz, o.seed + 77));
      const sx = lo + (cx + 0.15 + 0.7 * rng()) * cell;
      const sz = lo + (cz + 0.15 + 0.7 * rng()) * cell;
      const roll = rng();
      if (roll >= chance) continue;
      if (o.radius > 0 && Math.hypot(sx, sz) > o.radius * 0.8) continue;
      if (bh(sx, sz) < o.minSource) continue;
      trace(sx, sz, null, 0, -1);
    }
  }

  // A river that is too short to be seen is not a river, unless another river flows into it (then it is part of the network).
  const joinedBy = new Set<number>();
  for (const r of rivers) if (r.end === 'river') joinedBy.add(r.host);
  const keep = rivers.filter((r) => r.points.length >= 6 || joinedBy.has(r.id));
  const remap = new Map<number, number>();
  keep.forEach((r, i) => remap.set(r.id, i));
  for (const r of keep) {
    r.id = remap.get(r.id)!;
    if (r.host >= 0) r.host = remap.get(r.host) ?? -1;
  }
  rivers.length = 0;
  rivers.push(...keep);

  // A river ends AT the shore of its lake, not somewhere inside it: the part of its path under the lake is cut off (unless another
  // river joins it there).
  const keepAtLeast = new Map<number, number>();
  for (const r of rivers) if (r.end === 'river') keepAtLeast.set(r.host, Math.max(keepAtLeast.get(r.host) ?? 0, r.hostIndex + 2));
  for (const r of rivers) {
    if (r.end !== 'lake') continue;
    const lk = lakes[r.lake];
    const floor = Math.max(6, keepAtLeast.get(r.id) ?? 0);
    while (r.points.length > floor) {
      const last = r.points[r.points.length - 1];
      if (Math.hypot(wrapD(last.x - lk.x), wrapD(last.z - lk.z)) >= lk.radius * 0.95) break;
      r.points.pop();
    }
  }

  // Water level: follows the bed, never rises, never below the sea, never above the ground on either side, smoothed.
  for (const r of rivers) {
    const pts = r.points;
    const bound: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      const l = Math.hypot(q.x - o.x, q.z - o.z) || 1;
      const nx = -(q.z - o.z) / l;
      const nz = (q.x - o.x) / l;
      // The water must not stand above the ground on either side of it: take the lowest of the middle and the two banks (40 m out).
      bound.push(Math.max(0, Math.min(bh(p.x, p.z), bh(p.x + nx * 40, p.z + nz * 40), bh(p.x - nx * 40, p.z - nz * 40)) - 0.3));
    }
    const settle = (): void => {
      let run = Infinity;
      for (let i = 0; i < pts.length; i++) { run = Math.min(run, pts[i].surface, bound[i]); pts[i].surface = run; }
    };
    for (const p of pts) p.surface = Infinity;
    settle();
    for (let pass = 0; pass < 4; pass++) {
      const copy = pts.map((p) => p.surface);
      for (let i = 1; i < pts.length - 1; i++) pts[i].surface = (copy[i - 1] + copy[i] + copy[i + 1]) / 3;
      settle();
    }
    if (r.end === 'sea') pts[pts.length - 1].surface = 0;
  }
  for (const r of rivers) {
    const last = r.points[r.points.length - 1];
    if (r.end === 'river') last.surface = Math.min(last.surface, rivers[r.host].points[r.hostIndex].surface);
    if (r.end === 'lake') last.surface = Math.min(last.surface, lakes[r.lake].level);
    let run = Infinity;
    for (const p of r.points) { run = Math.min(run, p.surface); p.surface = run; }
  }

  // Flow: a river collects more with every step, and everything its tributaries bring. Tributaries come later than their host.
  const flow = rivers.map((r) => r.points.map((_, i) => 1 + i * 0.12));
  for (let i = rivers.length - 1; i >= 0; i--) {
    const r = rivers[i];
    if (r.end !== 'river') continue;
    const total = flow[i][flow[i].length - 1];
    const f = flow[r.host];
    for (let k = r.hostIndex; k < f.length; k++) f[k] += total;
  }
  rivers.forEach((r, i) => r.points.forEach((p, k) => { p.width = Math.min(80, 4 + 4 * Math.sqrt(flow[i][k])); }));

  // Spatial grid: every segment and lake is listed in the cells it can reach.
  const segGrid = new Map<number, Array<{ r: number; j: number }>>();
  const lakeGrid = new Map<number, number[]>();
  const gkey = (cx: number, cz: number): number => (wrapG(cx) + 100000) * 400009 + (wrapG(cz) + 100000);
  const register = <T>(map: Map<number, T[]>, x0: number, z0: number, x1: number, z1: number, item: T): void => {
    for (let cz = Math.floor(z0 / GRID); cz <= Math.floor(z1 / GRID); cz++) {
      for (let cx = Math.floor(x0 / GRID); cx <= Math.floor(x1 / GRID); cx++) {
        const k = gkey(cx, cz);
        const list = map.get(k);
        if (list) list.push(item); else map.set(k, [item]);
      }
    }
  };
  rivers.forEach((r, ri) => {
    for (let j = 0; j < r.points.length - 1; j++) {
      const a = r.points[j];
      const b = r.points[j + 1];
      const pad = Math.max(a.width, b.width) * 0.58 + Math.max(6 + 0.8 * Math.max(a.width, b.width), MAX_BANK) + 10;
      register(segGrid, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad, { r: ri, j });
    }
  });
  for (const l of lakes) register(lakeGrid, l.x - l.radius * 1.6, l.z - l.radius * 1.6, l.x + l.radius * 1.6, l.z + l.radius * 1.6, l.id);

  type Metrics = { e: number; d: number; w: number; surface: number; fx: number; fz: number };

  function eachSegment(x: number, z: number, cb: (m: Metrics) => void): void {
    const list = segGrid.get(gkey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (!list) return;
    for (const s of list) {
      const a = rivers[s.r].points[s.j];
      const b = rivers[s.r].points[s.j + 1];
      const ax = wrapD(a.x - x);
      const az = wrapD(a.z - z);
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1;
      const t = Math.min(1, Math.max(0, -(ax * ex + az * ez) / len2));
      const d = Math.hypot(ax + t * ex, az + t * ez);
      const w = a.width + t * (b.width - a.width);
      const l = Math.sqrt(len2);
      cb({ e: d - w / 2, d, w, surface: a.surface + t * (b.surface - a.surface), fx: ex / l, fz: ez / l });
    }
  }

  function nearestRiver(x: number, z: number): Metrics | null {
    let best: Metrics | null = null;
    eachSegment(x, z, (m) => { if (!best || m.e < best.e) best = m; });
    return best;
  }

  function nearestLake(x: number, z: number): { e: number; d: number; lake: Lake } | null {
    const list = lakeGrid.get(gkey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (!list) return null;
    let best: { e: number; d: number; lake: Lake } | null = null;
    for (const id of list) {
      const l = lakes[id];
      const d = Math.hypot(wrapD(l.x - x), wrapD(l.z - z));
      const e = d - l.radius;
      if (!best || e < best.e) best = { e, d, lake: l };
    }
    return best;
  }

  // The carved height is the LOWEST of what every river segment and lake asks for here (and never above the terrain). A minimum of
  // continuous functions is continuous, so two rivers at different levels that come close (a confluence, a meander) never make a cliff.
  function carve(x: number, z: number, baseH: number): number {
    let h = baseH;
    eachSegment(x, z, (r) => {
      // The bank is at least as wide as the cut is deep (slope at most 45 degrees), so a river through a ridge makes a gorge, not a cliff.
      const bank = Math.min(MAX_BANK, Math.max(6 + 0.8 * r.w, 1.5 * (baseH - r.surface)));
      if (r.e < 0) {
        const t = r.d / (r.w / 2);
        h = Math.min(h, r.surface - (0.9 + 0.04 * r.w) * (1 - t * t));
      } else if (r.e < bank) {
        h = Math.min(h, r.surface + (baseH - r.surface) * smooth(r.e / bank));
      }
    });
    const list = lakeGrid.get(gkey(Math.floor(x / GRID), Math.floor(z / GRID)));
    if (list) {
      for (const id of list) {
        const lk = lakes[id];
        const d = Math.hypot(wrapD(lk.x - x), wrapD(lk.z - z));
        const e = d - lk.radius;
        const bank = Math.min(lk.radius * 0.6, Math.max(lk.radius * 0.4, 1.5 * (baseH - lk.level)));
        if (e < 0) {
          const t = d / lk.radius;
          h = Math.min(h, lk.level - (2 + lk.radius * 0.03) * (1 - t * t));
        } else if (e < bank) {
          h = Math.min(h, lk.level + (baseH - lk.level) * smooth(e / bank));
        }
      }
    }
    return h;
  }

  function waterAt(x: number, z: number): WaterHit | null {
    // A lake wins over the river that feeds it: inside the lake the water is flat and does not flow.
    const l = nearestLake(x, z);
    if (l && l.e < 0) return { kind: 'lake', surface: l.lake.level, fx: 0, fz: 0, width: l.lake.radius * 2 };
    const r = nearestRiver(x, z);
    if (r && r.e < 0) return { kind: 'river', surface: r.surface, fx: r.fx, fz: r.fz, width: r.w };
    return null;
  }

  function edgeDistance(x: number, z: number): number {
    let best = Infinity;
    eachSegment(x, z, (m) => { if (m.e < best) best = m.e; });
    const l = nearestLake(x, z);
    if (l && l.e < best) best = l.e;
    return best;
  }

  return { rivers, lakes, carve, waterAt, edgeDistance };
}

const cache = new Map<string, RiverNetwork>();

/** One network per terrain: building it costs a fraction of a second, so worlds with the same terrain share it. */
export function riverNetworkFor(key: string, o: RiverOptions): RiverNetwork {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = createRiverNetwork(o);
  if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  cache.set(key, made);
  return made;
}
`;

export const RIVERWATER = `// Athree map — river and lake water on screen.
// Technique: ribbons along the river paths and discs for lakes, built per tile and streamed a few per frame; a fragment shader scrolls
// layered noise along the flow direction, shades depth from the middle to the edge, and foams at the banks. Own implementation.

import { QUALITY, OCEAN_TIERS, maxTriangles, oceanTriangles, type AthreeQuality } from './config';
import { VEGETATION_TIERS, vegetationTriangles } from './vegetation';
import type { AthreeWorld } from './world';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export interface RiverTier {
  /** Water is drawn out to this distance (metres). Beyond it the terrain mesh is too coarse to hold a river bed anyway. */
  radius: number;
  tile: number;
  /** The most triangles of water ever drawn. */
  maxTriangles: number;
  tilesPerUpdate: number;
}

export const RIVER_TIERS: Record<AthreeQuality, RiverTier> = {
  phone: { radius: 400, tile: 256, maxTriangles: 2000, tilesPerUpdate: 2 },
  mid: { radius: 700, tile: 256, maxTriangles: 6000, tilesPerUpdate: 3 },
  desktop: { radius: 1300, tile: 512, maxTriangles: 8000, tilesPerUpdate: 4 },
};

/** What is left of the tier's triangle budget once terrain, sea and vegetation have taken their worst case. */
export function riverBudget(quality: AthreeQuality): number {
  return QUALITY[quality].budgetTriangles - maxTriangles(QUALITY[quality]) - oceanTriangles(OCEAN_TIERS[quality]) - vegetationTriangles(VEGETATION_TIERS[quality]);
}

export interface WaterArrays {
  /** Vertex positions in WORLD metres, relative to (originX, originZ) in x and z. */
  position: Float32Array;
  /** World x and z in metres, for the shader's noise. */
  world: Float32Array;
  /** 0 at the bank, 1 in the middle. */
  edge: Float32Array;
  /** Unit flow direction (zero on a lake). */
  flow: Float32Array;
  index: Uint16Array;
  triangles: number;
}

const LAKE_SIDES = 24;

/**
 * The water whose centre lies inside [x0, x1) x [z0, z1): every river segment (a ribbon of three vertices across, four triangles) and
 * every lake (a fan of 24 triangles). A loop world repeats, so the rectangle may be any copy of the world.
 */
export function waterInRect(world: AthreeWorld, x0: number, z0: number, x1: number, z1: number): WaterArrays {
  const pos: number[] = [];
  const wor: number[] = [];
  const edge: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const P = world.mode === 'loop' ? world.sizeMeters : 0;
  const shiftFor = (mx: number, mz: number): [number, number] => {
    if (P <= 0) return [0, 0];
    return [Math.round(((x0 + x1) / 2 - mx) / P) * P, Math.round(((z0 + z1) / 2 - mz) / P) * P];
  };
  const inside = (x: number, z: number): boolean => x >= x0 && x < x1 && z >= z0 && z < z1;
  const vert = (x: number, y: number, z: number, e: number, fx: number, fz: number): number => {
    pos.push(x - x0, y, z - z0);
    wor.push(x, z);
    edge.push(e);
    flow.push(fx, fz);
    return pos.length / 3 - 1;
  };
  const { rivers, lakes } = world.waterBodies();
  for (const r of rivers) {
    const pts = r.points;
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j];
      const b = pts[j + 1];
      const [sx, sz] = shiftFor((a.x + b.x) / 2, (a.z + b.z) / 2);
      if (!inside((a.x + b.x) / 2 + sx, (a.z + b.z) / 2 + sz)) continue;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len = Math.hypot(ex, ez) || 1;
      const fx = ex / len;
      const fz = ez / len;
      const ends = [a, b];
      const base = pos.length / 3;
      for (let k = 0; k < 2; k++) {
        const p = ends[k];
        const half = (p.width / 2) * 1.15;
        const y = p.surface + 0.03;
        // Each end overlaps its neighbour by 25 cm along the flow, so rounding in two tiles can never open a crack.
        const cx = p.x + sx + fx * (k === 0 ? -0.25 : 0.25);
        const cz = p.z + sz + fz * (k === 0 ? -0.25 : 0.25);
        vert(cx - fz * half, y, cz + fx * half, 0, fx, fz);
        vert(cx, y, cz, 1, fx, fz);
        vert(cx + fz * half, y, cz - fx * half, 0, fx, fz);
      }
      idx.push(base, base + 1, base + 3, base + 1, base + 4, base + 3, base + 1, base + 2, base + 4, base + 2, base + 5, base + 4);
    }
  }
  for (const l of lakes) {
    const [sx, sz] = shiftFor(l.x, l.z);
    if (!inside(l.x + sx, l.z + sz)) continue;
    const y = l.level + 0.03;
    const centre = vert(l.x + sx, y, l.z + sz, 1, 0, 0);
    const ring: number[] = [];
    for (let k = 0; k < LAKE_SIDES; k++) {
      const a = (k / LAKE_SIDES) * Math.PI * 2;
      ring.push(vert(l.x + sx + Math.cos(a) * l.radius * 1.04, y, l.z + sz + Math.sin(a) * l.radius * 1.04, 0, 0, 0));
    }
    for (let k = 0; k < LAKE_SIDES; k++) idx.push(centre, ring[k], ring[(k + 1) % LAKE_SIDES]);
  }
  return {
    position: Float32Array.from(pos),
    world: Float32Array.from(wor),
    edge: Float32Array.from(edge),
    flow: Float32Array.from(flow),
    index: Uint16Array.from(idx),
    triangles: idx.length / 3,
  };
}

export function riverVertexShader(): string {
  return [
    'attribute vec2 aWorld; attribute float aEdge; attribute vec2 aFlow;',
    'varying vec2 vWorld; varying float vEdge; varying vec2 vFlow; varying vec3 vView;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorld = aWorld; vEdge = aEdge; vFlow = aFlow; vView = cameraPosition - wp.xyz;',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\\n');
}

export function riverFragmentShader(): string {
  return [
    'uniform float uTime; uniform vec3 uSun; uniform vec3 uSky;',
    'varying vec2 vWorld; varying float vEdge; varying vec2 vFlow; varying vec3 vView;',
    '#include <fog_pars_fragment>',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'void main() {',
    '  float moving = step(0.001, length(vFlow));',
    '  vec2 drift = vFlow * uTime * (1.6 * moving) + vec2(0.05, 0.03) * uTime * (1.0 - moving);',
    '  vec2 p = vWorld * 0.35 - drift;',
    '  float n1 = vnoise(p); float n2 = vnoise(p * 2.3 + 5.0 - drift * 0.5);',
    '  vec3 n = normalize(vec3((n1 - 0.5) * 0.7, 1.0, (n2 - 0.5) * 0.7));',
    '  vec3 v = normalize(vView);',
    '  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);',
    '  float depth = smoothstep(0.0, 0.7, vEdge);',
    '  vec3 col = mix(vec3(0.2, 0.46, 0.42), vec3(0.04, 0.2, 0.3), depth);',
    '  col = mix(col, uSky, fres * 0.55);',
    '  vec3 h = normalize(uSun + v); col += pow(max(dot(n, h), 0.0), 90.0) * vec3(1.0, 0.95, 0.8) * 0.7;',
    '  float foam = smoothstep(0.38, 0.0, vEdge) * (0.45 + 0.55 * vnoise(p * 3.0));',
    '  col = mix(col, vec3(0.92, 0.95, 0.97), clamp(foam, 0.0, 1.0) * 0.8);',
    '  gl_FragColor = vec4(col, smoothstep(0.0, 0.18, vEdge) * 0.92);',
    '  #include <fog_fragment>',
    '}',
  ].join('\\n');
}

export interface RiverWater {
  readonly group: ThreeLike;
  update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }): void;
  /** What a boat on a river or lake floats on: the surface height and the way the water flows (zero on a lake), or null on dry ground. */
  floatAt(x: number, z: number): { y: number; flowX: number; flowZ: number; kind: 'river' | 'lake' } | null;
  /** Match the light: the direction towards the sun and the sky colour the water reflects. */
  setLight(sun: { x: number; y: number; z: number }, skyColor: number): void;
  stats(): { tiles: number; triangles: number };
  dispose(): void;
}

export function createRiverWater(THREE: ThreeLike, world: AthreeWorld, quality: AthreeQuality = 'mid'): RiverWater {
  const tier = RIVER_TIERS[quality];
  const group = new THREE.Group();
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-0.5, 0.8, 0.3).normalize() }, uSky: { value: new THREE.Color(0x9ec7e8) } },
  ]);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: riverVertexShader(),
    fragmentShader: riverFragmentShader(),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const tiles = new Map<string, { mesh: ThreeLike; x0: number; z0: number; triangles: number }>();
  let scanned = { x: Infinity, z: Infinity };
  let pending: Array<{ i: number; j: number; d: number }> = [];
  const key = (i: number, j: number): string => i + ',' + j;
  let triangles = 0;

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
      const x0 = p.i * tier.tile;
      const z0 = p.j * tier.tile;
      const a = waterInRect(world, x0, z0, x0 + tier.tile, z0 + tier.tile);
      if (a.triangles === 0 || triangles + a.triangles > tier.maxTriangles) { tiles.set(key(p.i, p.j), { mesh: null, x0, z0, triangles: 0 }); continue; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      g.setAttribute('aWorld', new THREE.BufferAttribute(a.world, 2));
      g.setAttribute('aEdge', new THREE.BufferAttribute(a.edge, 1));
      g.setAttribute('aFlow', new THREE.BufferAttribute(a.flow, 2));
      g.setIndex(new THREE.BufferAttribute(a.index, 1));
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      group.add(mesh);
      triangles += a.triangles;
      tiles.set(key(p.i, p.j), { mesh, x0, z0, triangles: a.triangles });
    }
  }

  function update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }): void {
    uniforms.uTime.value = time;
    const ti = Math.floor(cameraX / tier.tile);
    const tj = Math.floor(cameraZ / tier.tile);
    if (ti !== scanned.x || tj !== scanned.z || pending.length > 0) {
      if (ti !== scanned.x || tj !== scanned.z) { scanned = { x: ti, z: tj }; scan(cameraX, cameraZ); }
      buildTiles();
    }
    for (const t of tiles.values()) if (t.mesh) t.mesh.position.set(t.x0 - origin.x, 0, t.z0 - origin.z);
  }

  function floatAt(x: number, z: number): { y: number; flowX: number; flowZ: number; kind: 'river' | 'lake' } | null {
    const w = world.waterAt(x, z);
    return w ? { y: w.surface, flowX: w.fx, flowZ: w.fz, kind: w.kind } : null;
  }

  function dispose(): void {
    for (const t of tiles.values()) { if (t.mesh) { group.remove(t.mesh); t.mesh.geometry.dispose(); } }
    tiles.clear();
    material.dispose();
    triangles = 0;
  }

  function setLight(sun: { x: number; y: number; z: number }, skyColor: number): void {
    uniforms.uSun.value.set(sun.x, Math.max(sun.y, 0.05), sun.z).normalize();
    uniforms.uSky.value.set(skyColor);
  }

  return { group, update, floatAt, setLight, stats: () => ({ tiles: Array.from(tiles.values()).filter((t) => t.mesh).length, triangles }), dispose };
}

`;
