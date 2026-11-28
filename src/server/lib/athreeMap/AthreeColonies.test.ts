// 🏘️ COLONIES BETWEEN THE ROADS (admin 2026-11-27, wave 2 part 1: "frame → natural boundary → water → ground nobody falls through → roads →
// COLONIES of houses between the roads"). These tests run the EMITTED colonies.ts and world.ts on real worlds (tests/helpers/loadAthree.ts):
// every plot faces a road and touches it; none is in water, on a road, on ground too steep to level or outside the boundary; shops stand
// on main roads and every colony has its park, school, temple, clinic and playground; density orders the town and falls from the centre;
// the same seed is the same town; the drawn ground and the physics heightfield ARE the plot's pad; the phone tier's draw calls and
// triangles hold; and the robot check "no lot in water or on a road" really measures the plots (it fails on a deliberately broken world).
// What they cannot prove — how the town looks — is a render's job.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';
import { loadEmittedAthree } from './mapRobotRun';
import { MAP_CHECKS } from './athreeMapCheckSource';
import { MAP_CHECKS_PATH } from './mapPlanWiring';
import { mapOptionsFor, type Archetype } from './athreeMapKinds';

vi.setConfig({ testTimeout: 600000 });

const A = loadAthree();
const C = loadEmittedAthree({ [MAP_CHECKS_PATH]: MAP_CHECKS }, 'mapChecks') as Record<string, any>;
const cache = new Map<string, any>();
function world(archetype: Archetype, km: number, style: string, density: string | undefined, seed = 5, extra: Record<string, unknown> = {}): any {
  const k = JSON.stringify([archetype, km, style, density, seed, extra]);
  if (!cache.has(k)) cache.set(k, A.createAthreeWorld({ seed, ...mapOptionsFor({ archetype, sizeKm: km }), roadStyle: style, ...(density ? { density } : {}), ...extra }));
  return cache.get(k);
}
/** The worlds every invariant is checked on: a grid town, an old town of lanes, a village on plains with water, superblocks, a hill town. */
const CASES: Array<[Archetype, number, string, string]> = [
  ['island', 2.2, 'grid', 'normal'], ['island', 2.2, 'organic', 'dense'], ['plains', 2.2, 'grid', 'sparse'],
  ['island', 5, 'highway', 'normal'], ['hills', 2.2, 'hill', 'normal'], ['island', 1, 'grid', 'dense'],
];
const MAIN = ['highway', 'main'];
const COMMERCIAL = ['shop', 'market', 'office', 'tower'];
/** A grid of points inside a plot, pulled `inset` metres in from its edges. */
function inside(p: any, inset = 0.3, n = 5): Array<[number, number]> {
  const ux = -p.facing.z, uz = p.facing.x, nx = -p.facing.x, nz = -p.facing.z;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u = (i / (n - 1) - 0.5) * (p.width - 2 * inset), v = (j / (n - 1) - 0.5) * (p.depth - 2 * inset);
    out.push([p.x + ux * u + nx * v, p.z + uz * u + nz * v]);
  }
  return out;
}

describe('colonies are laid on every planned network when a density is given', () => {
  it('each case has plots, colonies and trees; a world without a density has none, and its ground is untouched', () => {
    for (const [a, km, s, d] of CASES) {
      const c = world(a, km, s, d).colonies();
      expect(c.plots.length, `${a} ${km} ${s} ${d}`).toBeGreaterThan(20);
      expect(c.colonies.length, `${a} ${km} ${s} ${d}`).toBeGreaterThan(0);
      expect(c.trees.length, `${a} ${km} ${s} ${d}`).toBeGreaterThan(20);
    }
    const none = world('island', 2.2, 'grid', undefined);
    const off = world('island', 2.2, 'grid', 'dense', 5, { colonies: false });
    expect(none.colonies().plots).toEqual([]);
    expect(off.colonies().plots).toEqual([]);
    for (const [x, z] of [[0, 0], [120, -80], [-300, 210], [415, 415]]) expect(none.heightAt(x, z)).toBe(off.heightAt(x, z));
    // A bad density is said and ignored, never a broken world.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = A.createAthreeWorld({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), density: 'packed' });
    expect(bad.colonies().plots).toEqual([]);
    expect(warn.mock.calls.some((c) => /density "packed"/.test(String(c[0])))).toBe(true);
    warn.mockRestore();
    // The regional network (a 100 km map) has no blocks, so no colonies — said by an empty list, not invented.
    expect(A.createAthreeWorld({ seed: 3, density: 'normal' }).colonies().plots).toEqual([]);
  });
});

describe('every plot faces a road and touches it', () => {
  it('the gate looks at the road, the entrance is on the footpath just off the kerb, and the road is right beyond it', () => {
    for (const [a, km, s, d] of CASES) {
      const w = world(a, km, s, d);
      for (const p of w.colonies().plots) {
        const ex = p.entrance.x - p.gate.x, ez = p.entrance.z - p.gate.z, el = Math.hypot(ex, ez);
        expect(Math.hypot(p.facing.x, p.facing.z)).toBeCloseTo(1, 6);
        expect((ex * p.facing.x + ez * p.facing.z) / el, `${a} ${s} plot ${p.id} faces its road`).toBeGreaterThan(0.7);
        expect(el, `${a} ${s} plot ${p.id} gate to the footpath`).toBeLessThan(A.COLONY_FOOTPATH + 5);
        expect(w.roadAt(p.entrance.x, p.entrance.z), `${a} ${s} plot ${p.id} entrance is on the footpath, not the road`).toBeNull();
        const hit = w.roadAt(p.entrance.x + (ex / el) * 2, p.entrance.z + (ez / el) * 2);
        expect(hit, `${a} ${s} plot ${p.id} has the road right beyond its entrance`).not.toBeNull();
      }
    }
  });
});

describe('no plot in water, on a road, on steep ground or outside the boundary', () => {
  it('measured on the world itself, at 25 points inside every plot', () => {
    for (const [a, km, s, d] of CASES) {
      const w = world(a, km, s, d);
      const flat = world(a, km, s, d, 5, { colonies: false });
      for (const p of w.colonies().plots) {
        let lo = Infinity, hi = -Infinity;
        for (const [x, z] of inside(p, 0)) {
          expect(w.waterAt(x, z), `${a} ${s} plot ${p.id} in water`).toBeNull();
          expect(w.heightAt(x, z), `${a} ${s} plot ${p.id} under the sea`).toBeGreaterThan(w.seaLevel);
          expect(w.roadAt(x, z), `${a} ${s} plot ${p.id} on a road`).toBeNull();
          const g = flat.heightAt(x, z);
          lo = Math.min(lo, g); hi = Math.max(hi, g);
          // The cut and fill that levelled it stays inside the limit, at every one of these 25 points (the planner reads the same grid).
          expect(Math.abs(g - p.y), `${a} ${s} plot ${p.id} cut/fill`).toBeLessThanOrEqual(A.COLONY_MAX_CUT + 1e-6);
        }
        expect(hi - lo, `${a} ${s} plot ${p.id} slope`).toBeLessThanOrEqual(A.COLONY_MAX_SLOPE * Math.hypot(p.width, p.depth) + 1);
        for (const c of p.corners) expect(w.boundary.inside(c.x, c.z, 0), `${a} ${s} plot ${p.id} outside the boundary`).toBe(true);
        for (const pond of w.ponds()) expect(Math.hypot(pond.x - p.x, pond.z - p.z), `${a} ${s} plot ${p.id} in a pond`).toBeGreaterThan(pond.radius);
      }
    }
  });
  it('plots never overlap, and the refused places are counted, not hidden', () => {
    for (const [a, km, s, d] of CASES) {
      const c = world(a, km, s, d).colonies();
      for (let i = 0; i < c.plots.length; i++) for (let j = i + 1; j < c.plots.length; j++) {
        const p = c.plots[i], q = c.plots[j];
        if (Math.hypot(p.x - q.x, p.z - q.z) > (Math.hypot(p.width, p.depth) + Math.hypot(q.width, q.depth)) / 2) continue;
        const rect = (r: any) => ({ cx: r.x, cz: r.z, ux: -r.facing.z, uz: r.facing.x, nx: -r.facing.x, nz: -r.facing.z, w: r.width, d: r.depth });
        expect(A.rectsOverlap(rect(p), rect(q), A.COLONY_GAP - 0.01), `${a} ${s} plots ${p.id} and ${q.id}`).toBe(false);
      }
      const sk = c.skipped;
      expect(sk.water + sk.road + sk.steep + sk.outside + sk.access + sk.crowded, `${a} ${s}`).toBeGreaterThan(0);
    }
    // The water and the slopes really refuse plots on maps that have them.
    expect(world('plains', 2.2, 'grid', 'sparse').colonies().skipped.water).toBeGreaterThan(0);
    expect(world('hills', 2.2, 'hill', 'normal').colonies().skipped.steep).toBeGreaterThan(0);
  });
  it('a pond on the planned network keeps plots off its banks, and no spawn is ever inside a plot', () => {
    const w = world('island', 2.2, 'grid', 'normal', 5, { water: { ponds: 4 } });
    const ponds = w.ponds();
    expect(ponds.length).toBeGreaterThan(0);
    for (const p of w.colonies().plots) for (const pond of ponds) expect(Math.hypot(pond.x - p.x, pond.z - p.z) - Math.hypot(p.width, p.depth) / 2).toBeGreaterThan(pond.radius);
    for (const [a, km, s, d] of CASES) {
      const ww = world(a, km, s, d);
      for (const sp of [...ww.spawnPoints('player', 12), ...ww.spawnPoints('vehicle', 12)]) expect(ww.colonyAt(sp.x, sp.z), `${a} ${s} spawn`).toBeNull();
    }
  });
  it('trees stand on the footpaths and in the parks: never on a road, in water or inside a building plot', () => {
    for (const [a, km, s, d] of CASES) {
      const w = world(a, km, s, d);
      for (const t of w.colonies().trees) {
        expect(w.roadAt(t.x, t.z), `${a} ${s} tree on a road`).toBeNull();
        expect(w.waterAt(t.x, t.z), `${a} ${s} tree in water`).toBeNull();
        const plot = w.colonyAt(t.x, t.z);
        if (t.park) expect(['park', 'playground']).toContain(plot?.kind);
        else expect(plot, `${a} ${s} street tree inside a plot`).toBeNull();
        expect(t.y).toBeCloseTo(w.heightAt(t.x, t.z), 6);
      }
    }
  });
});

describe('zoning', () => {
  it('shops, markets, offices and towers face main roads or highways; colony streets and lanes have homes; the bazaar holds near the centre', () => {
    for (const [a, km, s, d] of CASES) {
      const c = world(a, km, s, d).colonies();
      for (const p of c.plots) {
        if (COMMERCIAL.includes(p.kind)) expect(MAIN, `${a} ${s} ${p.kind} ${p.id} on a ${p.roadKind}`).toContain(p.roadKind);
        if (!MAIN.includes(p.roadKind)) expect(['residential', 'civic', 'green'], `${a} ${s} ${p.kind} on a ${p.roadKind}`).toContain(p.zone);
        expect(p.zone).toBe(A.COLONY_ZONE[p.kind]);
      }
      const central = c.plots.filter((p: any) => MAIN.includes(p.roadKind) && p.ring < A.COLONY_BAZAAR_RING && (p.zone === 'residential' || p.zone === 'commercial'));
      for (const p of central) expect(p.zone, `${a} ${s} plot ${p.id} on a main road near the centre`).toBe('commercial');
    }
    const grid = world('island', 2.2, 'grid', 'normal').colonies();
    expect(grid.plots.filter((p: any) => p.kind === 'shop').length).toBeGreaterThan(50);
    expect(grid.plots.filter((p: any) => p.kind === 'house' || p.kind === 'flats' || p.kind === 'haveli').length).toBeGreaterThan(200);
  });
  it('EVERY colony has a park, a school, a temple, a clinic and a playground; the central one a hospital', () => {
    for (const [a, km, s, d] of CASES) {
      const c = world(a, km, s, d).colonies();
      const byId = new Map(c.plots.map((p: any) => [p.id, p]));
      for (const col of c.colonies) {
        const kinds = new Set(col.plots.map((id: number) => (byId.get(id) as any).kind));
        for (const need of ['park', 'school', 'temple', 'clinic', 'playground']) expect(kinds.has(need), `${a} ${s} colony ${col.id} has a ${need}`).toBe(true);
      }
      expect(c.plots.filter((p: any) => p.kind === 'hospital').length, `${a} ${s} one hospital`).toBe(1);
    }
  });
  it('a main road or a highway separates colonies: a colony of a grid town is a few blocks, and an old town of lanes is split into neighbourhoods', () => {
    const grid = world('island', 2.2, 'grid', 'normal').colonies();
    expect(grid.colonies.length).toBeGreaterThan(8);
    const lanes = world('island', 2.2, 'organic', 'dense').colonies();
    expect(lanes.colonies.length).toBeGreaterThan(4);
    for (const col of lanes.colonies) expect(col.blocks.length).toBeLessThanOrEqual(A.COLONY_MAX_BLOCKS * 3);
  });
});

describe('density', () => {
  it('sparse < normal < dense: more plots, and taller homes, on the same land', () => {
    const t: Record<string, any> = {};
    for (const d of ['sparse', 'normal', 'dense']) t[d] = world('island', 2.2, 'grid', d).colonies();
    const homes = (c: any) => c.plots.filter((p: any) => p.zone === 'residential');
    const meanFloors = (c: any) => homes(c).reduce((s: number, p: any) => s + p.floors, 0) / homes(c).length;
    const maxFloors = (c: any) => Math.max(...homes(c).map((p: any) => p.floors));
    expect(t.sparse.plots.length).toBeLessThan(t.normal.plots.length);
    expect(t.normal.plots.length).toBeLessThan(t.dense.plots.length);
    expect(meanFloors(t.sparse)).toBeLessThan(meanFloors(t.normal));
    expect(meanFloors(t.normal)).toBeLessThan(meanFloors(t.dense));
    expect(maxFloors(t.sparse)).toBeLessThanOrEqual(3);
    expect(maxFloors(t.dense)).toBeGreaterThan(maxFloors(t.normal));
    expect(homes(t.sparse).filter((p: any) => p.kind === 'flats').length).toBe(0);
    expect(t.dense.plots.reduce((s: number, p: any) => s + p.width, 0) / t.dense.plots.length).toBeLessThan(t.sparse.plots.reduce((s: number, p: any) => s + p.width, 0) / t.sparse.plots.length);
  });
  it('height falls with distance from the town centre: tall flats in the middle, small houses at the edge', () => {
    for (const d of ['normal', 'dense']) {
      for (const [a, s] of [['island', 'grid'], ['island', 'organic']] as Array<[Archetype, string]>) {
        const homes = world(a, 2.2, s, d).colonies().plots.filter((p: any) => p.zone === 'residential');
        const mean = (l: any[]) => l.reduce((t: number, p: any) => t + p.floors, 0) / Math.max(1, l.length);
        const middle = homes.filter((p: any) => p.ring < 0.35), edge = homes.filter((p: any) => p.ring > 0.65);
        expect(middle.length, `${a} ${s} ${d}`).toBeGreaterThan(5);
        expect(edge.length, `${a} ${s} ${d}`).toBeGreaterThan(5);
        expect(mean(middle), `${a} ${s} ${d}`).toBeGreaterThan(mean(edge) + 1);
        expect(edge.filter((p: any) => p.kind === 'house' || p.kind === 'haveli').length / edge.length, `${a} ${s} ${d}`).toBeGreaterThan(0.6);
      }
    }
  });
});

describe('the same seed is the same town', () => {
  it('two worlds with the same options lay identical colonies; another seed lays another town', () => {
    const opts = { seed: 11, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), density: 'normal' };
    const a = A.createAthreeWorld(opts).colonies();
    const b = A.createAthreeWorld(opts).colonies();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const other = A.createAthreeWorld({ ...opts, seed: 12 }).colonies();
    expect(JSON.stringify(other.plots)).not.toBe(JSON.stringify(a.plots));
  });
});

describe('the ground under a plot is ONE ground: heightAt, the drawn terrain and the physics heightfield are the pad', () => {
  it('heightAt is the pad height everywhere inside every plot', () => {
    for (const [a, km, s, d] of CASES) {
      const w = world(a, km, s, d);
      for (const p of w.colonies().plots) for (const [x, z] of inside(p, 0)) expect(w.heightAt(x, z), `${a} ${s} plot ${p.id}`).toBeCloseTo(p.y, 6);
    }
  });
  it('every terrain vertex and heightfield node inside a plot is at the pad height', () => {
    const w = world('island', 2.2, 'grid', 'normal');
    const plots = w.colonies().plots;
    let checked = 0;
    for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 1], [-2, 1]]) {
      const geo = A.buildChunkGeometry(THREE, w, cx, cz, 256, 64);
      const pos = geo.getAttribute('position');
      for (let i = 0; i < 65 * 65; i++) {
        const x = cx * 256 + pos.getX(i), z = cz * 256 + pos.getZ(i);
        const p = w.colonyAt(x, z);
        if (!p) continue;
        expect(pos.getY(i)).toBeCloseTo(p.y, 3);
        checked++;
      }
      geo.dispose();
      const hf = A.heightfieldFor(w, cx * 256, cz * 256, 256, 64);
      for (let col = 0; col <= 64; col++) for (let row = 0; row <= 64; row++) {
        const p = w.colonyAt(cx * 256 + col * 4, cz * 256 + row * 4);
        if (p) { expect(hf.heights[col * 65 + row]).toBeCloseTo(p.y, 3); checked++; }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(plots.length).toBeGreaterThan(0);
  });
  it('ground the game levels over plots takes them away (and the pad with them); a road it lays too', () => {
    const w = A.createAthreeWorld({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: 'grid', density: 'normal' });
    const before = w.colonies().plots;
    const p = before[Math.floor(before.length / 2)];
    const y = w.levelGround(p.x, p.z, 30, 30, 10);
    const after = w.colonies().plots;
    expect(after.length).toBeLessThan(before.length);
    expect(after.some((q: any) => q.id === p.id)).toBe(false);
    expect(w.colonyAt(p.x, p.z)).toBeNull();
    expect(w.heightAt(p.x, p.z)).toBeCloseTo(y, 6);
    for (const q of after) expect(Math.max(Math.abs(q.x - p.x) - 30, Math.abs(q.z - p.z) - 30)).toBeGreaterThan(10 - Math.hypot(q.width, q.depth) / 2 - 0.01);
    const r = before[5];
    w.addRoad([{ x: r.x - 60, z: r.z }, { x: r.x + 60, z: r.z }], 9);
    expect(w.colonies().plots.some((q: any) => q.id === r.id)).toBe(false);
  });
});

describe('performance: the phone tier holds its draw calls and triangles on the default 5 km² map', () => {
  it('the colony cap fits the budget left after the roads, and vehicles still fit after it', () => {
    for (const q of ['phone', 'mid', 'desktop']) {
      expect(A.COLONY_TIERS[q].maxTriangles, q).toBeLessThanOrEqual(A.colonyBudget(q));
      expect(A.vehicleBudget(q), q).toBeGreaterThanOrEqual(8);
    }
  });
  it('a dense town drawn at the phone tier from its busiest spot never passes the cap, one draw call per tile', () => {
    const w = world('island', 2.2, 'grid', 'dense');
    const c = w.colonies();
    const mesh = A.createColonyMesh(THREE, w, 'phone');
    const tier = A.COLONY_TIERS.phone;
    const maxTiles = (2 * Math.ceil(tier.radius / A.COLONY_TILE) + 1) ** 2;
    let capped = false;
    for (const spot of [c.centre, { x: c.centre.x + 300, z: c.centre.z - 200 }, { x: c.centre.x - 500, z: c.centre.z + 400 }]) {
      for (let i = 0; i < 40; i++) mesh.update(spot.x, spot.z, { x: 0, z: 0 });
      const st = mesh.stats();
      let tris = 0, meshes = 0;
      mesh.group.traverse((o: any) => { if (o.isMesh) { meshes++; tris += o.geometry.getAttribute('position').count / 3; } });
      expect(st.triangles).toBe(tris);
      expect(st.drawCalls).toBe(meshes);
      expect(tris).toBeLessThanOrEqual(tier.maxTriangles);
      expect(meshes).toBeLessThanOrEqual(maxTiles);
      expect(st.tiles).toBeGreaterThan(0);
      capped = capped || st.capped;
    }
    // The busiest spot of a dense town wants more than the phone may draw, so the cap is what held it (it is not a lucky small town).
    expect(capped).toBe(true);
    mesh.dispose();
  });
  it('a tile is rebuilt when the game takes plots away, and the floating origin moves the whole group', () => {
    const w = A.createAthreeWorld({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: 'grid', density: 'normal' });
    const mesh = A.createColonyMesh(THREE, w, 'mid');
    const p = w.colonies().plots[0];
    for (let i = 0; i < 30; i++) mesh.update(p.x, p.z, { x: 100, z: -50 });
    const before = mesh.stats().plots;
    expect(mesh.group.position.x).toBe(-100);
    expect(mesh.group.position.z).toBe(50);
    w.levelGround(p.x, p.z, 25, 25, 8);
    for (let i = 0; i < 30; i++) mesh.update(p.x, p.z, { x: 100, z: -50 });
    expect(mesh.stats().plots).toBeLessThan(before);
    mesh.dispose();
  });
  it('createAthreeMap draws the colonies when MAP_OPTIONS has a density, and not without', () => {
    const withC = A.createAthreeMap({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), density: 'normal', quality: 'phone', three: THREE });
    expect(withC.colonyMesh).not.toBeNull();
    const sp = withC.world.colonies().centre;
    for (let i = 0; i < 20; i++) withC.update(sp.x, sp.z, i * 0.1);
    expect(withC.colonyMesh.stats().tiles).toBeGreaterThan(0);
    withC.dispose();
    const without = A.createAthreeMap({ seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), quality: 'phone', three: THREE });
    expect(without.colonyMesh).toBeNull();
    without.dispose();
  });
});

describe('the robot check "no lot in water or on a road" now measures the colonies', () => {
  it('on a colony world it applies by itself (no lots passed) and passes', () => {
    for (const [a, km, s, d] of CASES) {
      const w = world(a, km, s, d);
      const r = C.checkLotsClear(w, C.colonyLots(w));
      expect(r.applicable, `${a} ${s}`).toBe(true);
      expect(r.ok, `${a} ${s}: ${r.detail}`).toBe(true);
      const all = C.runMapChecks(w);
      const lots = all.results.find((x: any) => x.id === 'lots-clear');
      expect(lots.applicable).toBe(true);
      expect(lots.detail).toMatch(new RegExp('All ' + w.colonies().plots.length + ' lots'));
    }
  });
  it('FAILS on a deliberately broken world: plots moved onto a road, and into water', () => {
    const w = world('island', 2.2, 'grid', 'normal');
    const real = w.colonies();
    const road = w.roadNetwork().graph().edges[0];
    const line = w.homeRoads().roads.find((r: any) => r.id === road.road).points;
    const onRoad = line[Math.floor(line.length / 2)];
    const broken = Object.create(w);
    broken.colonies = () => ({ ...real, plots: real.plots.map((p: any, i: number) => (i === 3 ? { ...p, x: onRoad.x, z: onRoad.z, corners: p.corners.map((c: any) => ({ x: c.x - p.x + onRoad.x, z: c.z - p.z + onRoad.z })) } : p)) });
    const r = C.runMapChecks(broken);
    expect(r.failed).toContain('lots-clear');
    expect(r.results.find((x: any) => x.id === 'lots-clear').detail).toMatch(/is on a road/);
    // Into the sea: a plot moved far out past the shore.
    let sea = { x: 0, z: 0 };
    for (let x = 0; x < 6000; x += 50) if (w.heightAt(x, 0) < w.seaLevel - 2) { sea = { x, z: 0 }; break; }
    expect(w.heightAt(sea.x, sea.z)).toBeLessThan(w.seaLevel);
    const wet = Object.create(w);
    wet.colonies = () => ({ ...real, plots: real.plots.map((p: any, i: number) => (i === 7 ? { ...p, x: sea.x, z: sea.z, corners: [] } : p)) });
    const r2 = C.runMapChecks(wet);
    expect(r2.failed).toContain('lots-clear');
    expect(r2.results.find((x: any) => x.id === 'lots-clear').detail).toMatch(/is in water/);
  });
});
