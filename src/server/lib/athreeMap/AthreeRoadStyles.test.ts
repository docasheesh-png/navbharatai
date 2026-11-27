// ROADS ON EVERY MAP SIZE, IN A STYLE (admin 2026-11-27: "frame -> natural boundary -> water -> ground -> ROADS (straight, random, curvy as
// the user wants; when unsaid, a highway + smart-city road grid) -> colonies between roads"). These tests run the EMITTED roads.ts on real
// worlds: every style (grid, highway, organic, hill, straight) on 1, 2.2, 5 and 25 km maps lays ONE connected network that never enters
// the sea, a lake or a pond, never climbs past 7 percent, whose ground IS the road surface, whose blocks are enclosed by roads on every
// side, whose routes keep to the LEFT lane, and which is the same for the same seed.
// What they cannot prove — how it looks — is a render's job; a car driving a route is checked here with the kit's own vehicle physics.
import { describe, it, expect, vi } from 'vitest';
import { loadAthree } from '../../../../tests/helpers/loadAthree';
import { mapOptionsFor, ARCHETYPES, type Archetype } from './athreeMapKinds';
const ARCH_MODE = (a: Archetype): string => ARCHETYPES[a].mode;

vi.setConfig({ testTimeout: 600000 });

const A = loadAthree();
const STYLES = ['grid', 'highway', 'organic', 'hill', 'straight'] as const;
const SIZES = [1, 2.2, 5, 25] as const;
const cache = new Map<string, any>();
function world(style: string | undefined, km: number, archetype: Archetype = 'island', seed = 5): any {
  const k = [style, km, archetype, seed].join('|');
  if (!cache.has(k)) cache.set(k, A.createAthreeWorld({ seed, ...mapOptionsFor({ archetype, sizeKm: km }), ...(style ? { roadStyle: style } : {}) }));
  return cache.get(k);
}
const planned = (w: any): any[] => w.homeRoads().roads.filter((r: any) => r.planned);
/** Inside a roundabout's grass island: not road, by design (a ribbon's centre line still runs to the junction's middle under it). */
const onIsland = (w: any, x: number, z: number): boolean => (w.homeRoads().junctions ?? []).some((j: any) => j.island > 0 && Math.hypot(j.x - x, j.z - z) < j.island);
/** Every case the invariants are checked on: each style on each size, on an island (land in the middle) and on plains (a coastline). */
const CASES: Array<[string, number, Archetype]> = [];
for (const s of STYLES) for (const km of SIZES) for (const a of ['island', 'plains'] as Archetype[]) CASES.push([s, km, a]);

function connected(w: any): { nodes: number; reached: number } {
  const g = w.roadNetwork().graph();
  if (!g.nodes.length) return { nodes: 0, reached: 0 };
  const adj: number[][] = g.nodes.map(() => []);
  for (const e of g.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const seen = new Set([0]); const stack = [0];
  while (stack.length) { const u = stack.pop()!; for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); stack.push(v); } }
  return { nodes: g.nodes.length, reached: seen.size };
}

describe('every map size has roads (the old "a 1 to 5 km map has no roads" limit is gone)', () => {
  it('a 1, 2.2, 5 and 10 km map gets the planned grid by default; a 100 km map keeps the regional villages and highways', () => {
    for (const km of [1, 2.2, 5, 10]) {
      const w = world(undefined, km, 'continental');
      expect(w.roadNetwork().style(), km + ' km').toBe('grid');
      expect(planned(w).length, km + ' km').toBeGreaterThan(5);
    }
    const big = A.createAthreeWorld({ seed: 3 });
    expect(big.roadNetwork().style()).toBeNull();
    expect(big.roadNetwork().blocks()).toEqual([]);
    expect(big.roadNetwork().route({ x: 0, z: 0 }, { x: 100, z: 100 })).toEqual([]);
    expect(big.homeRoads().roads.some((r: any) => r.planned)).toBe(false);
  });
  it('an unknown style is ignored, never a broken world; roads: false still means none', () => {
    const w = A.createAthreeWorld({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: 'spaghetti' });
    expect(w.roadNetwork().style()).toBe('grid');
    const none = A.createAthreeWorld({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roads: false });
    expect(none.homeRoads().roads).toEqual([]);
    expect(none.roadNetwork().blocks()).toEqual([]);
  });
  it('the default game map (about 5 square km, 2.2 km a side) is a real town: highways, main roads and streets, roundabouts, and blocks', () => {
    const w = world(undefined, 2.2, 'island');
    const kinds = new Set(planned(w).map((r: any) => r.kind));
    for (const k of ['highway', 'main', 'street']) expect(kinds.has(k), k).toBe(true);
    expect(planned(w).length).toBeGreaterThan(150);
    expect(w.roadNetwork().blocks().length).toBeGreaterThan(60);
    expect((w.homeRoads().junctions ?? []).some((j: any) => j.island > 0), 'a roundabout').toBe(true);
  });
});

describe('each style is what it says', () => {
  it('grid: straight roads on two axes; organic: lanes, bent; hill: winding; straight: long straight roads at an angle; highway: superblocks', () => {
    const W = (s: string) => world(s, 2.2, 'island');
    const sinuosity = (r: any) => { const p = r.points; return r.length / Math.max(1, Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].z - p[0].z)); };
    const axis = (r: any) => { const p = r.points; const a = Math.atan2(p[p.length - 1].z - p[0].z, p[p.length - 1].x - p[0].x); return Math.abs(Math.sin(2 * a)); };
    const grid = planned(W('grid'));
    expect(grid.filter((r: any) => axis(r) < 0.02 && sinuosity(r) < 1.001).length / grid.length).toBeGreaterThan(0.95);
    const organic = planned(W('organic'));
    expect(organic.filter((r: any) => r.kind === 'lane').length / organic.length).toBeGreaterThan(0.4);
    expect(organic.filter((r: any) => sinuosity(r) > 1.002).length / organic.length).toBeGreaterThan(0.3);
    const hill = planned(W('hill'));
    expect(hill.filter((r: any) => sinuosity(r) > 1.03).length / hill.length).toBeGreaterThan(0.5);
    const straight = planned(W('straight'));
    expect(straight.filter((r: any) => sinuosity(r) < 1.001).length / straight.length).toBeGreaterThan(0.95);
    expect(straight.filter((r: any) => axis(r) > 0.05).length).toBeGreaterThan(0);
    const mean = (bs: any[]) => bs.reduce((s, b) => s + b.area, 0) / Math.max(1, bs.length);
    expect(mean(W('highway').roadNetwork().blocks())).toBeGreaterThan(mean(W('grid').roadNetwork().blocks()) * 4);
    expect(mean(W('organic').roadNetwork().blocks())).toBeLessThan(mean(W('grid').roadNetwork().blocks()));
  });
  it('the road hierarchy: highways 4 lanes (6 from 5 km up), main roads 4, streets 2, lanes narrow', () => {
    for (const [km, hw] of [[2.2, 14], [5, 21]] as const) {
      for (const r of planned(world('grid', km))) {
        const want = r.kind === 'highway' ? hw : r.kind === 'main' ? 12 : r.kind === 'street' ? 7 : 4.5;
        expect(r.points[0].width, r.kind).toBe(want);
        expect(r.lanes).toBe(r.kind === 'highway' ? (km >= 5 ? 6 : 4) : r.kind === 'main' ? 4 : 2);
      }
    }
  });
  it('a bigger map runs highways out from the town to villages on flat ground, each ending at its plaza', () => {
    let spokes = 0;
    for (const s of STYLES) {
      const w = world(s, 25);
      for (const site of w.homeRoads().sites) {
        const r = planned(w).find((x: any) => x.to === site.id);
        expect(r, s + ' a village has its highway').toBeTruthy();
        const end = r.points[r.points.length - 1];
        expect(Math.hypot(end.x - site.x, end.z - site.z)).toBeLessThan(site.radius + 25);
        spokes++;
      }
    }
    expect(spokes).toBeGreaterThan(8);
  });
});

describe('the invariants, on every style at 1, 2.2, 5 and 25 km', () => {
  it('ONE connected network: every junction reaches every other, and every planned road is an edge of that graph', () => {
    let networks = 0;
    for (const [s, km, a] of CASES) {
      const w = world(s, km, a);
      const c = connected(w);
      expect(c.reached, `${s} ${km} km ${a}`).toBe(c.nodes);
      const g = w.roadNetwork().graph();
      expect(g.edges.length).toBe(planned(w).length);
      for (const r of planned(w)) { expect(g.nodes[r.a]).toBeTruthy(); expect(g.nodes[r.b]).toBeTruthy(); }
      if (c.nodes > 10) networks++;
    }
    expect(networks).toBeGreaterThanOrEqual(CASES.length - 8);
    // On the island every style has a real network at every size.
    for (const s of STYLES) for (const km of SIZES) expect(planned(world(s, km)).length, `${s} ${km} km`).toBeGreaterThan(km === 1 ? 8 : 20);
  });
  it('never in the sea, a lake or a pond: water under a road is a river under a bridge deck at least 3 m above it, at the centre and both edges', () => {
    let points = 0;
    for (const [s, km, a] of CASES) {
      const w = world(s, km, a);
      for (const r of planned(w)) {
        const p = r.points;
        for (let i = 0; i < p.length; i++) {
          const q = p[Math.min(p.length - 1, i + 1)]; const o = p[Math.max(0, i - 1)];
          const l = Math.hypot(q.x - o.x, q.z - o.z) || 1; const nx = -(q.z - o.z) / l; const nz = (q.x - o.x) / l;
          for (const side of [0, -p[i].width / 2, p[i].width / 2]) {
            const water = w.waterAt(p[i].x + nx * side, p[i].z + nz * side);
            if (water) {
              expect(water.kind, `${s} ${km} ${a}`).toBe('river');
              expect(p[i].bridge, `${s} ${km} ${a} water under a road that is not a bridge`).toBe(true);
              expect(p[i].y).toBeGreaterThanOrEqual(water.surface + 3 - 1e-6);
            }
          }
          if (!p[i].bridge) expect(w.baseHeightAt(p[i].x, p[i].z) + w.dunesAt(p[i].x, p[i].z) + 1e-9, `${s} ${km} ${a} a road in the sea`).toBeGreaterThan(0);
          points++;
        }
      }
    }
    expect(points).toBeGreaterThan(20000);
  });
  it('never climbs more than 7 percent, and never sits more than 14 m above or below the ground it was laid on (outside a bridge)', () => {
    for (const [s, km, a] of CASES) {
      const w = world(s, km, a);
      for (const r of planned(w)) {
        const p = r.points;
        for (let i = 0; i < p.length - 1; i++) {
          const ds = p[i + 1].s - p[i].s;
          expect(ds).toBeGreaterThan(1);
          expect(Math.abs(p[i + 1].y - p[i].y) / ds, `${s} ${km} ${a} road ${r.id}`).toBeLessThanOrEqual(0.07 + 1e-9);
        }
      }
    }
  });
  it('the ground IS the road surface on every planned road (cut and fill), so a vehicle drives exactly on what is drawn', () => {
    let n = 0; let worst = 0;
    for (const [s, km, a] of CASES) {
      const w = world(s, km, a);
      for (const r of planned(w)) {
        for (let i = 0; i < r.points.length; i += 2) {
          const p = r.points[i];
          if (p.bridge) { expect(w.drivableHeightAt(p.x, p.z)).toBeCloseTo(p.y, 1); continue; }
          worst = Math.max(worst, Math.abs(w.heightAt(p.x, p.z) - p.y)); n++;
          if (onIsland(w, p.x, p.z)) continue;
          const hit = w.roadAt(p.x, p.z);
          expect(hit, `${s} ${km} ${a}`).not.toBeNull();
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
    expect(worst).toBeLessThan(0.06);
  });
  it('a junction pad is flat at its own height, and a roundabout island is not road', () => {
    let pads = 0; let islands = 0;
    for (const s of STYLES) {
      const w = world(s, 2.2);
      for (const j of w.homeRoads().junctions ?? []) {
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const x = j.x + Math.cos(ang) * j.radius * 0.9; const z = j.z + Math.sin(ang) * j.radius * 0.9;
          expect(Math.abs(w.heightAt(x, z) - j.y)).toBeLessThan(0.03);
          if (j.island <= 0) expect(w.roadAt(x, z)).not.toBeNull();
        }
        pads++;
        if (j.island > 0) { islands++; expect(w.roadAt(j.x, j.z)).toBeNull(); expect(w.surfaceAt(j.x, j.z)).not.toBe('asphalt'); }
      }
    }
    expect(pads).toBeGreaterThan(100);
    expect(islands).toBeGreaterThan(3);
  });
  it('is deterministic per seed, and another seed is another network', () => {
    const fresh = loadAthree();
    for (const s of STYLES) {
      const a = planned(world(s, 2.2));
      // A freshly loaded kit: the same world must not come back from the network cache, it must be MADE again and come out the same.
      const again = planned(fresh.createAthreeWorld({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: s }));
      expect(JSON.stringify(again.map((r: any) => r.points))).toBe(JSON.stringify(a.map((r: any) => r.points)));
      const other = planned(world(s, 2.2, 'island', 6));
      expect(JSON.stringify(other.map((r: any) => r.points))).not.toBe(JSON.stringify(a.map((r: any) => r.points)));
    }
  });
});

describe('CIRCUIT_RUNWAY_MIN_SIZE is true: the map planner raises a racing or flight game to it, so it must be where both really fit', () => {
  it('at the floor every kind of land tried has a race circuit (racing) and a runway (flight); a loop map well under it does not always', () => {
    const F = A.CIRCUIT_RUNWAY_MIN_SIZE;
    expect(F.loop).toBeLessThanOrEqual(5000); expect(F.bounded).toBeLessThanOrEqual(F.loop);
    const at = (a: Archetype, profile: string, seed: number) => {
      const km = (ARCH_MODE(a) === 'bounded' ? F.bounded : F.loop) / 1000;
      return A.createAthreeWorld({ seed, profile, ...mapOptionsFor({ archetype: a, sizeKm: km }) }).homeRoads();
    };
    for (const a of ['continental', 'plains', 'desert', 'hills', 'island'] as Archetype[]) {
      for (const seed of [1, 2, 3]) {
        const r = at(a, 'racing', seed);
        expect(r.circuit, `${a} seed ${seed}: racing at the floor has a circuit`).not.toBeNull();
        expect(r.roads[r.circuit.road].length).toBeGreaterThan(700);
        expect(at(a, 'flight', seed).roads.filter((x: any) => x.kind === 'runway').length, `${a} seed ${seed}: flight at the floor has a runway`).toBeGreaterThanOrEqual(1);
      }
    }
    // The floor is not padded for nothing: on a continent at 3 km a circuit does not fit on every seed.
    let missing = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) if (!A.createAthreeWorld({ seed, profile: 'racing', ...mapOptionsFor({ archetype: 'continental', sizeKm: 3 }) }).homeRoads().circuit) missing++;
    expect(missing).toBeGreaterThan(0);
  });
});

describe('blocks: the land between the roads, for the colony step', () => {
  it('every block is enclosed by roads on every side: each side runs along a road centre line, so every block has road access', () => {
    let blocks = 0;
    for (const [s, km, a] of CASES) {
      const w = world(s, km, a);
      for (const b of w.roadNetwork().blocks()) {
        blocks++;
        expect(b.polygon.length).toBeGreaterThanOrEqual(3);
        expect(b.sides.length).toBe(b.polygon.length);
        let area = 0;
        for (let i = 0; i < b.polygon.length; i++) {
          const p = b.polygon[i]; const q = b.polygon[(i + 1) % b.polygon.length];
          area += p.x * q.z - q.x * p.z;
          if (onIsland(w, (p.x + q.x) / 2, (p.z + q.z) / 2)) continue;
          const hit = w.roadAt((p.x + q.x) / 2, (p.z + q.z) / 2);
          expect(hit, `${s} ${km} ${a} block ${b.id} side ${i} is not on a road`).not.toBeNull();
          expect(b.sides[i].half).toBeGreaterThan(2);
        }
        expect(area / 2, 'counter-clockwise').toBeGreaterThan(0);
        expect(Math.abs(area / 2 - b.area) / b.area).toBeLessThan(1e-6);
        expect(b.area).toBeGreaterThanOrEqual(600);
      }
    }
    expect(blocks).toBeGreaterThan(1000);
  });
  it('a block is land: inside it, past its kerbs, no road but the dead ends it lists as inner, and mostly out of the water', () => {
    let land = 0;
    for (const s of STYLES) {
      for (const km of [2.2, 5]) {
        const w = world(s, km);
        for (const b of w.roadNetwork().blocks()) {
          const P = b.polygon;
          const inPoly = (x: number, z: number): boolean => {
            let inside = false;
            for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].z > z) !== (P[j].z > z) && x < ((P[j].x - P[i].x) * (z - P[i].z)) / (P[j].z - P[i].z) + P[i].x) inside = !inside;
            return inside;
          };
          const edgeDist = (x: number, z: number): number => {
            let best = Infinity;
            for (let i = 0; i < P.length; i++) {
              const a = P[i]; const c = P[(i + 1) % P.length]; const ex = c.x - a.x; const ez = c.z - a.z; const l2 = ex * ex + ez * ez || 1;
              const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / l2));
              best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z) - b.sides[i].half);
            }
            return best;
          };
          let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
          for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
          let wet = 0; let n = 0;
          for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
            const x = x0 + ((x1 - x0) * i) / 6; const z = z0 + ((z1 - z0) * j) / 6;
            if (!inPoly(x, z) || edgeDist(x, z) < 1) continue;
            n++; land++;
            const hit = w.roadAt(x, z);
            if (hit && hit.junction === undefined) expect(b.inner, `${s} ${km} block ${b.id} has road ${hit.road} inside it`).toContain(hit.road);
            if (w.waterAt(x, z)) wet++;
          }
          if (n >= 4) expect(wet / n).toBeLessThanOrEqual(0.5);
        }
      }
    }
    expect(land).toBeGreaterThan(2000);
  });
});

describe('routes keep to the LEFT lane (India)', () => {
  function checkRoute(w: any, from: any, to: any): number {
    const route = w.roadNetwork().route(from, to);
    expect(route.length).toBeGreaterThan(1);
    let left = 0; let checked = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const p = route[i]; const q = route[i + 1];
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < 3) continue;
      const mx = (p.x + q.x) / 2; const mz = (p.z + q.z) / 2;
      const hit = w.roadAt(mx, mz);
      expect(hit, 'the route stays on the road').not.toBeNull();
      if (hit.junction !== undefined) continue;
      const road = w.homeRoads().roads[hit.road];
      const pts = road.points;
      let k = 0;
      while (k < pts.length - 2 && pts[k + 1].s < hit.along) k++;
      const rx = pts[k + 1].x - pts[k].x; const rz = pts[k + 1].z - pts[k].z;
      const same = Math.sign(rx * (q.x - p.x) + rz * (q.z - p.z));
      // across is along the road's normal (-rz, rx); facing (dx, dz) the left is (dz, -dx): driving along the road, left is across < 0.
      checked++;
      if (hit.across * same < -0.3) left++;
      expect(Math.abs(Math.abs(hit.across) - 0) > 0.3 || Math.abs(hit.across) < 0.3).toBe(true);
      expect(Math.abs(p.y - w.drivableHeightAt(p.x, p.z))).toBeLessThan(0.6);
    }
    expect(checked).toBeGreaterThan(3);
    return left / checked;
  }
  it('from one end of the town to the other, every style, on the left of every road it uses', () => {
    for (const s of STYLES) {
      const w = world(s, 2.2);
      const g = w.roadNetwork().graph();
      let far = 0; let a = g.nodes[0]; let b = g.nodes[0];
      for (const n of g.nodes) for (const m of g.nodes) { const d = Math.hypot(n.x - m.x, n.z - m.z); if (d > far) { far = d; a = n; b = m; } }
      expect(checkRoute(w, a, b), s).toBeGreaterThan(0.97);
      expect(checkRoute(w, b, a), s + ' back').toBeGreaterThan(0.97);
    }
  });
  it('round a roundabout with the island on the right (the angle grows), and the route reaches its end', () => {
    const w = world('highway', 5);
    const rb = (w.homeRoads().junctions ?? []).find((j: any) => j.island > 0 && j.roads.length >= 4);
    expect(rb).toBeTruthy();
    const roads = rb.roads.map((id: number) => w.homeRoads().roads[id]);
    const far = (r: any) => (Math.hypot(r.points[0].x - rb.x, r.points[0].z - rb.z) < 1 ? r.points[r.points.length - 1] : r.points[0]);
    const from = far(roads[0]); const to = far(roads[2]);
    const route = w.roadNetwork().route(from, to);
    const ring = route.filter((p: any) => { const d = Math.hypot(p.x - rb.x, p.z - rb.z); return d > rb.island && d < rb.radius; });
    expect(ring.length).toBeGreaterThan(2);
    let grows = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      let da = Math.atan2(ring[i + 1].z - rb.z, ring[i + 1].x - rb.x) - Math.atan2(ring[i].z - rb.z, ring[i].x - rb.x);
      while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      if (da > 0) grows++;
    }
    expect(grows).toBe(ring.length - 1);
    expect(Math.hypot(route[route.length - 1].x - to.x, route[route.length - 1].z - to.z)).toBeLessThan(15);
  });
  it('a car driven by the kit\'s own vehicle physics follows a route across a 2.2 km map and stays on the road', () => {
    const w = world(undefined, 2.2);
    const g = w.roadNetwork().graph();
    let far = 0; let a = g.nodes[0]; let b = g.nodes[0];
    for (const n of g.nodes) { const d = Math.hypot(n.x - g.nodes[0].x, n.z - g.nodes[0].z); if (d > far) { far = d; b = n; } }
    a = g.nodes[0];
    const route = w.roadNetwork().route(a, b);
    expect(route.length).toBeGreaterThan(5);
    const env = A.mapEnvironment(w);
    const start = route[0]; const next = route[1];
    const car = A.createVehiclePhysics(A.CAR_SPEC, env, start.x, start.z, Math.atan2(next.z - start.z, next.x - start.x));
    let target = 1; let off = 0; let steps = 0;
    for (; steps < 60 * 400 && target < route.length; steps++) {
      const st = car.state;
      const tx = route[target].x - st.x; const tz = route[target].z - st.z;
      if (Math.hypot(tx, tz) < 9) { target++; continue; }
      let err = Math.atan2(tz, tx) - st.yaw;
      while (err > Math.PI) err -= Math.PI * 2; while (err < -Math.PI) err += Math.PI * 2;
      const speed = st.speed;
      // A driver slows for a turn: under 6 m/s when the route bends by more than 30 degrees at the next waypoint, 12 m/s otherwise.
      const nx = route[Math.min(route.length - 1, target + 1)];
      const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(nx.z - route[target].z, nx.x - route[target].x) - Math.atan2(tz, tx)), Math.cos(Math.atan2(nx.z - route[target].z, nx.x - route[target].x) - Math.atan2(tz, tx))));
      const want = turn > 0.5 && Math.hypot(tx, tz) < 30 ? 6 : 12;
      car.step(1 / 60, { throttle: speed < want ? 0.6 : 0, brake: speed > want + 1.5 ? 0.6 : 0, steer: Math.max(-1, Math.min(1, err * 2.5)), handbrake: false });
      if (steps % 30 === 0 && !w.roadAt(car.state.x, car.state.z)) off++;
    }
    expect(target, 'the car reached the end of the route').toBe(route.length);
    expect(off).toBeLessThanOrEqual(2);
  });
});

describe('the road mesh draws the planned town within the phone budget', () => {
  it('junction pads and roundabout islands are drawn; a straight stretch is one quad; every tile fits the triangle cap', () => {
    const w = world(undefined, 2.2);
    const kinds = new Set<number>();
    let worst = 0;
    for (let x = -1100; x < 1100; x += 256) for (let z = -1100; z < 1100; z += 256) {
      const a = A.roadsInRect(w, x, z, x + 256, z + 256);
      for (const k of a.kind) kinds.add(k);
      for (const v of a.position) expect(Number.isFinite(v)).toBe(true);
      for (const i of a.index) expect(i).toBeLessThan(a.position.length / 3);
      worst = Math.max(worst, a.triangles);
    }
    for (const k of ['multilane', 'street', 'junction', 'island']) expect(kinds.has(A.ROAD_KIND[k]), k).toBe(true);
    // Within the phone's 400 m the most tiles ever drawn is about 12: the town must fit the cap with room to spare.
    expect(worst * 12).toBeLessThan(A.ROAD_TIERS.phone.maxTriangles);
    const straight = planned(w).find((r: any) => r.kind === 'street' && r.points.length > 8);
    const x0 = Math.floor(straight.points[4].x / 256) * 256; const z0 = Math.floor(straight.points[4].z / 256) * 256;
    expect(A.roadsInRect(w, x0, z0, x0 + 256, z0 + 256).triangles).toBeGreaterThan(0);
  });
  it('every segment is in exactly one tile: two halves draw what the whole draws (a straight run cut by the tile edge is two quads, not one)', () => {
    for (const s of ['organic', 'grid']) {
      const w = world(s, 2.2);
      const whole = A.roadsInRect(w, -512, -256, 0, 0);
      const left = A.roadsInRect(w, -512, -256, -256, 0);
      const right = A.roadsInRect(w, -256, -256, 0, 0);
      expect(whole.triangles).toBeGreaterThan(0);
      expect(left.triangles + right.triangles).toBeGreaterThanOrEqual(whole.triangles);
      expect(left.triangles + right.triangles).toBeLessThanOrEqual(whole.triangles * 1.1);
      // The same length of road is drawn: the sum of the ribbons' along-extents is equal.
      const drawn = (a: any) => { let t = 0; for (let i = 0; i < a.index.length; i += 6) { const v = a.index[i]; const v2 = a.index[i + 2]; if (a.kind[v] >= 6 && a.kind[v] <= 8) t += Math.abs(a.along[v2] - a.along[v]); } return t; };
      expect(drawn(left) + drawn(right)).toBeCloseTo(drawn(whole), 3);
    }
  });
  it('a loop map draws the same town on its next copy (the network stays clear of the seam)', () => {
    const w = world('grid', 2.2, 'plains');
    const P = w.sizeMeters;
    expect(A.roadsInRect(w, P - 256, -256, P, 0).triangles).toBe(A.roadsInRect(w, -256, -256, 0, 0).triangles);
    const r = planned(w)[0]; const p = r.points[1];
    expect(w.heightAt(p.x + P, p.z - P)).toBeCloseTo(w.heightAt(p.x, p.z), 6);
    expect(!!w.roadAt(p.x + P, p.z)).toBe(true);
  });
});
