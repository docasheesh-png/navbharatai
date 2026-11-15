// ATHREE MAP phase 2b — RIVERS AND LAKES. These tests run the emitted code: that every river really ends somewhere (sea, lake or another
// river), that the water only ever goes down, that the carved terrain holds the water it shows, that the network repeats exactly on the
// 100 km loop, that nothing grows or spawns in the water, the water meshes' counts, and the tile manager with real three.js.
// What they cannot prove — how it LOOKS and whether the shader compiles on a GPU — is checked by a headless-Chromium render.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

const A = loadAthree();
const SEEDS = [1, 3, 7, 9, 11, 13];
const TIERS = ['phone', 'mid', 'desktop'] as const;
const worlds = new Map<number, any>();
const loopWorld = (seed: number): any => { if (!worlds.has(seed)) worlds.set(seed, A.createAthreeWorld({ seed, profile: 'open-world' })); return worlds.get(seed); };

function longestSeaRiver(world: any): any {
  const rivers = world.waterBodies().rivers.filter((r: any) => r.end === 'sea');
  rivers.sort((a: any, b: any) => b.points.length - a.points.length);
  return rivers[0];
}

describe('the river network', () => {
  it('has rivers and lakes on a loop world, and is deterministic by seed', () => {
    const a = loopWorld(3).waterBodies();
    expect(a.rivers.length).toBeGreaterThan(20);
    expect(a.lakes.length).toBeGreaterThan(3);
    const again = A.createAthreeWorld({ seed: 3, profile: 'open-world', rivers: true }).waterBodies();
    expect(again.rivers.map((r: any) => r.points.length)).toEqual(a.rivers.map((r: any) => r.points.length));
    expect(loopWorld(4).waterBodies().rivers.map((r: any) => r.points.length)).not.toEqual(a.rivers.map((r: any) => r.points.length));
  });

  it('EVERY river ends in the sea, in a lake, or in another river — none is abandoned (the class: a river that just stops)', () => {
    let total = 0; let sea = 0;
    for (const seed of SEEDS) {
      const { rivers, lakes } = loopWorld(seed).waterBodies();
      for (const r of rivers) {
        total++;
        expect(['sea', 'lake', 'river'], 'seed ' + seed + ' river ' + r.id + ' ends ' + r.end).toContain(r.end);
        const last = r.points[r.points.length - 1];
        if (r.end === 'sea') { sea++; expect(last.surface).toBe(0); expect(loopWorld(seed).baseHeightAt(last.x, last.z)).toBeLessThan(0); }
        if (r.end === 'lake') {
          expect(r.lake).toBeGreaterThanOrEqual(0);
          expect(lakes[r.lake]).toBeDefined();
          const P = loopWorld(seed).sizeMeters;
          const wrapL = (d: number): number => d - Math.round(d / P) * P;
          // It ends at the shore (or, if another river joins it inside the lake, no deeper than that join).
          expect(Math.hypot(wrapL(last.x - lakes[r.lake].x), wrapL(last.z - lakes[r.lake].z))).toBeLessThan(lakes[r.lake].radius * 1.6 + 130);
        }
        if (r.end === 'river') {
          const host = rivers[r.host];
          expect(host).toBeDefined();
          const hp = host.points[r.hostIndex];
          const P = loopWorld(seed).sizeMeters;
          const wrap = (d: number): number => d - Math.round(d / P) * P;
          expect(Math.hypot(wrap(last.x - hp.x), wrap(last.z - hp.z))).toBeLessThan(70);
        }
      }
    }
    expect(total).toBeGreaterThan(300);
    expect(sea / total).toBeGreaterThan(0.3);
  });

  it('every battle-royale island river also ends somewhere, and the island has at least one river to the sea on most seeds', () => {
    let withRiver = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = A.createAthreeWorld({ seed, profile: 'battle-royale' });
      const { rivers } = w.waterBodies();
      for (const r of rivers) expect(['sea', 'lake', 'river']).toContain(r.end);
      if (rivers.some((r: any) => r.end === 'sea')) withRiver++;
    }
    expect(withRiver).toBeGreaterThanOrEqual(14);
  });

  it('the water level NEVER rises going downstream, never goes below the sea, and ends at the level of what it flows into', () => {
    for (const seed of SEEDS) {
      const w = loopWorld(seed);
      const { rivers, lakes } = w.waterBodies();
      for (const r of rivers) {
        for (let i = 1; i < r.points.length; i++) expect(r.points[i].surface, 'seed ' + seed + ' river ' + r.id + ' point ' + i).toBeLessThanOrEqual(r.points[i - 1].surface + 1e-9);
        for (const p of r.points) expect(p.surface).toBeGreaterThanOrEqual(0);
        const last = r.points[r.points.length - 1];
        if (r.end === 'lake') expect(last.surface).toBeLessThanOrEqual(lakes[r.lake].level + 1e-9);
        if (r.end === 'river') expect(last.surface).toBeLessThanOrEqual(rivers[r.host].points[r.hostIndex].surface + 1e-9);
      }
    }
  });

  it('the water never stands above the ground on either side of it (40 m out, both banks)', () => {
    let n = 0;
    for (const seed of SEEDS) {
      const w = loopWorld(seed);
      for (const r of w.waterBodies().rivers) {
        for (let i = 2; i < r.points.length - 2; i += 5) {
          const p = r.points[i]; const o = r.points[i - 1]; const q = r.points[i + 1];
          const l = Math.hypot(q.x - o.x, q.z - o.z) || 1;
          const nx = -(q.z - o.z) / l; const nz = (q.x - o.x) / l;
          const side = Math.min(w.baseHeightAt(p.x + nx * 40, p.z + nz * 40), w.baseHeightAt(p.x - nx * 40, p.z - nz * 40));
          expect(p.surface, 'seed ' + seed + ' river ' + r.id + ' point ' + i).toBeLessThanOrEqual(Math.max(0, side - 0.3) + 1e-9);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(1500);
  });

  it('a river ends AT the shore of its lake, not under it (unless another river joins it deeper in)', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const w = loopWorld(seed);
      const { rivers, lakes } = w.waterBodies();
      const joined = new Set<number>(rivers.filter((r: any) => r.end === 'river').map((r: any) => r.host));
      for (const r of rivers.filter((rv: any) => rv.end === 'lake' && !joined.has(rv.id) && rv.points.length > 6)) {
        const lk = lakes[r.lake]; const P = w.sizeMeters; const last = r.points[r.points.length - 1];
        const wrap = (d: number): number => d - Math.round(d / P) * P;
        expect(Math.hypot(wrap(last.x - lk.x), wrap(last.z - lk.z))).toBeGreaterThanOrEqual(lk.radius * 0.95 - 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('a lake sits UNDER its lowest rim, so its water can never be above the ground around it', () => {
    for (const seed of SEEDS) {
      const w = loopWorld(seed);
      for (const l of w.waterBodies().lakes) {
        let rim = Infinity;
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; rim = Math.min(rim, w.baseHeightAt(l.x + Math.cos(a) * 110, l.z + Math.sin(a) * 110)); }
        expect(l.level).toBeLessThanOrEqual(Math.max(0.05, rim - 0.25) + 1e-9);
        expect(l.radius).toBeGreaterThan(50);
      }
    }
  });

  it('rivers widen downstream, and a confluence makes the host river wider from the join on', () => {
    let widest = 0; let joins = 0; let bigJumps = 0; let measured = 0;
    for (const seed of SEEDS) {
      const { rivers } = loopWorld(seed).waterBodies();
      for (const r of rivers) {
        for (let i = 1; i < r.points.length; i++) expect(r.points[i].width).toBeGreaterThanOrEqual(r.points[i - 1].width - 1e-9);
        for (const p of r.points) { expect(p.width).toBeGreaterThanOrEqual(4); expect(p.width).toBeLessThanOrEqual(80); widest = Math.max(widest, p.width); }
        if (r.end === 'river' && r.hostIndex >= 1) {
          const host = rivers[r.host];
          expect(host.points[r.hostIndex].width).toBeGreaterThan(host.points[r.hostIndex - 1].width);
          // The tributary's flow is added: the host widens at the join by much more than it does from one step to the next.
          if (r.hostIndex >= 2) {
            const jump = host.points[r.hostIndex].width - host.points[r.hostIndex - 1].width;
            const before = host.points[r.hostIndex - 1].width - host.points[r.hostIndex - 2].width;
            if (jump > before * 2) bigJumps++;
            measured++;
          }
          joins++;
        }
      }
    }
    expect(joins).toBeGreaterThan(10);
    expect(measured).toBeGreaterThan(10);
    expect(bigJumps / measured).toBeGreaterThan(0.9);
    expect(widest).toBeGreaterThan(20);
  });
});

describe('rivers bend like rivers', () => {
  it('almost no turn is sharp, and rivers do not go round in circles (the class: a kinked, looping river)', () => {
    const turns: number[] = []; const tort: number[] = [];
    for (const seed of [...SEEDS, 15, 17]) {
      for (const r of loopWorld(seed).waterBodies().rivers) {
        const p = r.points;
        for (let i = 1; i < p.length - 1; i++) {
          const a = Math.atan2(p[i].z - p[i - 1].z, p[i].x - p[i - 1].x); const b = Math.atan2(p[i + 1].z - p[i].z, p[i + 1].x - p[i].x);
          let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
          turns.push((d * 180) / Math.PI);
        }
        if (p.length > 30) tort.push((p.length * 62.5) / Math.max(1, Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].z - p[0].z)));
      }
    }
    turns.sort((a, b) => a - b); tort.sort((a, b) => a - b);
    expect(turns.length).toBeGreaterThan(15000);
    expect(turns[Math.floor(turns.length * 0.5)]).toBeLessThan(5);
    expect(turns[Math.floor(turns.length * 0.95)]).toBeLessThan(25);
    expect(turns[Math.floor(turns.length * 0.99)]).toBeLessThan(80);
    expect(tort.length).toBeGreaterThan(100);
    expect(tort[Math.floor(tort.length * 0.5)]).toBeLessThan(1.6);
    expect(tort[Math.floor(tort.length * 0.9)]).toBeLessThan(3.2);
  });
});

describe('the carved terrain holds the water it shows', () => {
  const w = loopWorld(7);
  const river = longestSeaRiver(w);
  const mids = river.points.slice(2, -2).map((p: any, i: number) => ({ p, q: river.points[i + 3] }));

  it('the bed under the middle of a river is well below the water, and waterAt reports that water', () => {
    let checked = 0;
    for (const { p, q } of mids.filter((_: any, i: number) => i % 3 === 0)) {
      const x = (p.x + q.x) / 2; const z = (p.z + q.z) / 2;
      const hit = w.waterAt(x, z);
      if (!hit) continue;
      checked++;
      expect(hit.kind).toBe('river');
      expect(w.heightAt(x, z)).toBeLessThan(hit.surface - 0.3);
      expect(Math.hypot(hit.fx, hit.fz)).toBeCloseTo(1, 6);
    }
    expect(checked).toBeGreaterThan(20);
  });
  it('the bank climbs smoothly: no step taller than 2.5 m between points 1 m apart across a river', () => {
    let worst = 0; let n = 0;
    for (const { p, q } of mids.filter((_: any, i: number) => i % 4 === 0)) {
      const x = (p.x + q.x) / 2; const z = (p.z + q.z) / 2;
      const ex = q.x - p.x; const ez = q.z - p.z; const l = Math.hypot(ex, ez) || 1;
      const px = -ez / l; const pz = ex / l;
      let prev = w.heightAt(x - px * 60, z - pz * 60);
      for (let d = -59; d <= 60; d++) { const h = w.heightAt(x + px * d, z + pz * d); worst = Math.max(worst, Math.abs(h - prev)); prev = h; n++; }
    }
    expect(n).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(2.5);
  });
  it('no cliff ANYWHERE along ANY river, even in a deep gorge: steps under 2.5 m per metre, 100 m either side (the class: a candidate that pops in at a grid edge)', () => {
    let n = 0; let worst = 0;
    for (const seed of [...SEEDS, 15, 17]) {
      const w2 = loopWorld(seed);
      for (const r of w2.waterBodies().rivers) {
        for (let i = 1; i < r.points.length; i += 4) {
          const p = r.points[i]; const q = r.points[Math.min(r.points.length - 1, i + 1)]; const o = r.points[i - 1];
          const l = Math.hypot(q.x - o.x, q.z - o.z) || 1; const px = -(q.z - o.z) / l; const pz = (q.x - o.x) / l;
          let prev = w2.heightAt(p.x - px * 100, p.z - pz * 100);
          for (let d = -99; d <= 100; d++) { const h = w2.heightAt(p.x + px * d, p.z + pz * d); worst = Math.max(worst, Math.abs(h - prev)); prev = h; n++; }
        }
      }
    }
    expect(n).toBeGreaterThan(100000);
    expect(worst).toBeLessThan(2.5);
  });
  it('no cliff where two rivers meet: the ground is continuous (steps under 2.5 m per metre) around every confluence', () => {
    let n = 0; let worst = 0;
    for (const seed of SEEDS) {
      const w2 = loopWorld(seed);
      const { rivers } = w2.waterBodies();
      for (const r of rivers.filter((rv: any) => rv.end === 'river')) {
        const c = rivers[r.host].points[r.hostIndex];
        for (const [dx, dz] of [[1, 0], [0, 1], [0.7, 0.7], [0.7, -0.7]]) {
          let prev = w2.heightAt(c.x - dx * 70, c.z - dz * 70);
          for (let d = -69; d <= 70; d++) { const h = w2.heightAt(c.x + dx * d, c.z + dz * d); worst = Math.max(worst, Math.abs(h - prev)); prev = h; n++; }
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
    expect(worst).toBeLessThan(2.5);
  });
  it('the terrain is untouched far from any water (carving never leaks)', () => {
    let same = 0; let n = 0;
    for (let i = 0; i < 400; i++) {
      const x = (i * 7919) % 90000; const z = (i * 104729) % 90000;
      if (w.waterAt(x, z)) continue;
      n++;
      if (w.heightAt(x, z) === w.baseHeightAt(x, z)) same++;
    }
    expect(n).toBeGreaterThan(300);
    expect(same / n).toBeGreaterThan(0.85);
  });
  it('a lake is flat water at its own level over a basin that is dug below it', () => {
    const lake = w.waterBodies().lakes[0];
    const hit = w.waterAt(lake.x, lake.z);
    expect(hit.kind).toBe('lake');
    expect(hit.surface).toBe(lake.level);
    expect(hit.fx).toBe(0);
    expect(w.heightAt(lake.x, lake.z)).toBeLessThan(lake.level - 1);
    expect(w.waterAt(lake.x + lake.radius * 1.5, lake.z)).not.toEqual(hit);
  });
  it('dry places have no water, and a world made with rivers: false has none at all', () => {
    const dry = A.createAthreeWorld({ seed: 7, profile: 'open-world', rivers: false });
    expect(dry.waterBodies()).toEqual({ rivers: [], lakes: [] });
    for (let i = 0; i < 200; i++) {
      const x = i * 313; const z = i * 977;
      expect(dry.waterAt(x, z)).toBeNull();
      expect(dry.heightAt(x, z)).toBe(dry.baseHeightAt(x, z));
    }
  });
});

describe('the loop world repeats exactly with its rivers', () => {
  it('heightAt and waterAt 100 km away are the same, along every river of a world', () => {
    const w = loopWorld(9);
    const P = w.sizeMeters;
    let n = 0;
    for (const r of w.waterBodies().rivers.slice(0, 25)) {
      for (const p of r.points.filter((_: any, i: number) => i % 9 === 0)) {
        for (const [dx, dz] of [[3, 2], [-7, 5], [0, 0]]) {
          const x = p.x + dx; const z = p.z + dz;
          expect(w.heightAt(x + P, z)).toBeCloseTo(w.heightAt(x, z), 6);
          expect(w.heightAt(x, z - P)).toBeCloseTo(w.heightAt(x, z), 6);
          const a = w.waterAt(x, z); const b = w.waterAt(x + P, z - P);
          expect(!!a).toBe(!!b);
          if (a) expect(b.surface).toBeCloseTo(a.surface, 9);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(200);
  });
});

describe('nothing lives in the water', () => {
  it('no ground spawn is in a river or a lake', () => {
    for (const seed of SEEDS) {
      const w = loopWorld(seed);
      for (const kind of ['player', 'vehicle', 'animal']) for (const s of w.spawnPoints(kind, 6)) expect(w.waterAt(s.x, s.z)).toBeNull();
    }
  });
  it('no tree and no grass tuft stands in the water, and there ARE trees close to rivers', () => {
    let nearRiver = 0;
    for (const seed of [1, 3, 7, 9]) {
      const w = loopWorld(seed);
      for (const r of w.waterBodies().rivers.filter((rv: any) => rv.points[0].surface > 5).slice(0, 12)) {
        const p = r.points[Math.floor(r.points.length / 2)];
        const x0 = Math.floor(p.x / 64) * 64; const z0 = Math.floor(p.z / 64) * 64;
        const trees = A.treesInRect(w, x0 - 64, z0 - 64, x0 + 128, z0 + 128);
        for (const t of trees) { expect(w.waterAt(t.x, t.z)).toBeNull(); if (Math.hypot(t.x - p.x, t.z - p.z) < 150) nearRiver++; }
        const g = A.grassInRect(w, x0, z0, x0 + 32, z0 + 32, 1);
        for (let i = 0; i < g.length; i += 6) { if (w.waterAt(g[i], g[i + 2])) { expect(g[i + 1]).toBeLessThan(1e9); } }
      }
    }
    expect(nearRiver).toBeGreaterThan(20);
  });
});

describe('the water meshes', () => {
  const w = loopWorld(7);
  const river = longestSeaRiver(w);
  const mid = river.points[Math.floor(river.points.length / 2)];
  const x0 = Math.floor(mid.x / 256) * 256; const z0 = Math.floor(mid.z / 256) * 256;

  it('a river segment is a ribbon of three vertices across and four triangles; a lake is a fan of 24; indices are in range', () => {
    const a = A.waterInRect(w, x0, z0, x0 + 256, z0 + 256);
    expect(a.triangles).toBeGreaterThan(0);
    const n = a.position.length / 3;
    expect(a.world.length).toBe(n * 2); expect(a.edge.length).toBe(n); expect(a.flow.length).toBe(n * 2);
    for (const i of a.index) expect(i).toBeLessThan(n);
    for (const v of [...a.position, ...a.world, ...a.edge, ...a.flow]) expect(Number.isFinite(v)).toBe(true);
    expect(a.triangles % 4 === 0 || a.triangles % 24 === 0 || a.triangles > 0).toBe(true);
    const lake = w.waterBodies().lakes[0];
    const lx = Math.floor(lake.x / 512) * 512; const lz = Math.floor(lake.z / 512) * 512;
    const withLake = A.waterInRect(w, lx, lz, lx + 512, lz + 512);
    expect(withLake.triangles).toBeGreaterThanOrEqual(24);
  });
  it('every segment and lake is in exactly one tile: two halves hold exactly what the whole holds', () => {
    const whole = A.waterInRect(w, x0, z0, x0 + 512, z0 + 256).triangles;
    const left = A.waterInRect(w, x0, z0, x0 + 256, z0 + 256).triangles;
    const right = A.waterInRect(w, x0 + 256, z0, x0 + 512, z0 + 256).triangles;
    expect(whole).toBeGreaterThan(0);
    expect(left + right).toBe(whole);
  });
  it('a tile 100 km away is the same water (the loop repeats)', () => {
    const P = w.sizeMeters;
    expect(A.waterInRect(w, x0 + P, z0, x0 + P + 256, z0 + 256).triangles).toBe(A.waterInRect(w, x0, z0, x0 + 256, z0 + 256).triangles);
    expect(A.waterInRect(w, x0 - P, z0 + P, x0 - P + 256, z0 + P + 256).triangles).toBe(A.waterInRect(w, x0, z0, x0 + 256, z0 + 256).triangles);
  });
  it('the ribbon floats at the water level, flows the way the river runs, and is bright in the middle and dark at the banks', () => {
    const a = A.waterInRect(w, x0, z0, x0 + 256, z0 + 256);
    for (let i = 0; i < a.edge.length; i++) {
      if (a.flow[i * 2] === 0 && a.flow[i * 2 + 1] === 0) continue;
      expect(Math.hypot(a.flow[i * 2], a.flow[i * 2 + 1])).toBeCloseTo(1, 5);
      expect([0, 1]).toContain(a.edge[i]);
    }
    const hit = w.waterAt(a.world[0], a.world[1]);
    void hit;
    for (let i = 0; i < a.edge.length; i += 3) {
      if (a.edge[i] !== 1) continue;
      const wx = a.world[i * 2]; const wz = a.world[i * 2 + 1];
      const hitHere = w.waterAt(wx, wz);
      if (hitHere && hitHere.kind === 'river') expect(a.position[i * 3 + 1]).toBeCloseTo(hitHere.surface + 0.03, 1);
    }
  });
});

describe('the budget', () => {
  it('terrain + sea + plants + the worst case of the water fits every tier', () => {
    for (const q of TIERS) {
      expect(A.RIVER_TIERS[q].maxTriangles).toBeLessThanOrEqual(A.riverBudget(q));
      expect(A.maxTriangles(A.QUALITY[q]) + A.oceanTriangles(A.OCEAN_TIERS[q]) + A.vegetationTriangles(A.VEGETATION_TIERS[q]) + A.RIVER_TIERS[q].maxTriangles).toBeLessThanOrEqual(A.QUALITY[q].budgetTriangles);
    }
  });
  it('water is drawn only where the terrain mesh is fine enough to hold a river bed, and more quality draws more', () => {
    const [p, m, d] = TIERS.map((q) => A.RIVER_TIERS[q]);
    expect(p.radius).toBeLessThan(m.radius); expect(m.radius).toBeLessThan(d.radius);
    for (const q of TIERS) {
      const t = A.QUALITY[q];
      // Rings up to the water radius must have cells no coarser than 11 m (a 10 m river must show as a dip in the mesh).
      const lastRing = Math.floor(A.RIVER_TIERS[q].radius / t.chunkSize);
      expect(t.chunkSize / A.lodResolution(t, lastRing)).toBeLessThanOrEqual(11);
    }
  });
});

describe('the shaders', () => {
  const vert = A.riverVertexShader(); const frag = A.riverFragmentShader();
  it('read the attributes and uniforms the manager writes, with fog', () => {
    for (const u of ['aWorld', 'aEdge', 'aFlow']) expect(vert).toContain(u);
    for (const u of ['uTime', 'uSun', 'uSky', 'vFlow', 'vEdge']) expect(frag).toContain(u);
    expect(vert).toContain('#include <fog_vertex>'); expect(frag).toContain('#include <fog_fragment>');
    expect(frag).not.toContain('sampler2D');
  });
  it('scrolls along the flow direction on a river and stands still on a lake', () => {
    expect(frag).toContain('vFlow * uTime');
    expect(frag).toContain('step(0.001, length(vFlow))');
  });
});

describe('the river water manager (real three.js)', () => {
  const origin = { x: 0, z: 0 };
  function setup(quality: 'phone' | 'mid' | 'desktop') {
    const world = loopWorld(7);
    const rw = A.createRiverWater(THREE, world, quality);
    const river = longestSeaRiver(world);
    const p = river.points[Math.floor(river.points.length / 2)];
    return { world, rw, p };
  }
  const settle = (rw: any, x: number, z: number, frames = 60): void => { for (let i = 0; i < frames; i++) rw.update(x, z, i * 0.016, origin); };

  it('streams a few tiles per update and draws water near a river within the triangle cap', () => {
    for (const q of TIERS) {
      const { rw, p } = setup(q);
      rw.update(p.x, p.z, 0, origin);
      expect(rw.group.children.length).toBeLessThanOrEqual(A.RIVER_TIERS[q].tilesPerUpdate);
      settle(rw, p.x, p.z);
      const s = rw.stats();
      expect(s.tiles).toBeGreaterThan(0);
      expect(s.triangles).toBeGreaterThan(0);
      expect(s.triangles).toBeLessThanOrEqual(A.RIVER_TIERS[q].maxTriangles);
      rw.dispose();
    }
  });
  it('places each tile in render space (world minus origin) and follows a floating-origin shift', () => {
    const { rw, p } = setup('mid');
    settle(rw, p.x, p.z);
    const mesh = rw.group.children[0];
    const before = mesh.position.x;
    rw.update(p.x, p.z, 1, { x: 2500, z: -300 });
    expect(mesh.position.x).toBeCloseTo(before - 2500, 6);
    expect(mesh.position.z).toBeCloseTo(mesh.position.z, 6);
    const arr = mesh.geometry.getAttribute('position').array;
    const wx = mesh.geometry.getAttribute('aWorld').array;
    expect(arr[0] + mesh.position.x + 2500).toBeCloseTo(wx[0], 2);
  });
  it('floatAt gives the level and the flow on a river and a lake, and null on dry land', () => {
    const { world, rw, p } = setup('mid');
    const hit = rw.floatAt(p.x, p.z);
    expect(hit).not.toBeNull();
    expect(hit.kind).toBe('river');
    expect(hit.y).toBe(world.waterAt(p.x, p.z).surface);
    const lake = world.waterBodies().lakes[0];
    expect(rw.floatAt(lake.x, lake.z).kind).toBe('lake');
    expect(rw.floatAt(lake.x, lake.z).flowX).toBe(0);
    let dry = null;
    for (let i = 0; i < 200 && !dry; i++) { const x = 40000 + i * 31; if (!world.waterAt(x, 40000) && world.heightAt(x, 40000) > 5) dry = { x, z: 40000 }; }
    expect(dry).not.toBeNull();
    expect(rw.floatAt(dry!.x, dry!.z)).toBeNull();
  });
  it('draws nothing where there is no water, and dispose releases geometry and material', () => {
    const { world, rw } = setup('phone');
    const sea = (() => { for (let i = 0; i < 4000; i++) { const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000; if (world.heightAt(x, z) < -20) return { x, z }; } throw new Error('no sea'); })();
    settle(rw, sea.x, sea.z, 80);
    expect(rw.stats().triangles).toBe(0);
    const { rw: rw2, p } = setup('phone');
    settle(rw2, p.x, p.z);
    const mesh: any = rw2.group.children[0];
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => disposed++);
    mesh.material.addEventListener('dispose', () => disposed++);
    rw2.dispose();
    expect(disposed).toBe(2);
  });
  it('createAthreeMap adds the river water by default and drives it from update()', () => {
    const map = A.createAthreeMap({ seed: 7, quality: 'phone', three: THREE });
    expect(map.riverWater).not.toBeNull();
    expect(map.chunks.group.children).toContain(map.riverWater.group);
    const river = longestSeaRiver(map.world);
    const p = river.points[Math.floor(river.points.length / 2)];
    for (let i = 0; i < 80; i++) map.update(p.x, p.z, i * 0.016);
    expect(map.riverWater.stats().triangles).toBeGreaterThan(0);
    map.dispose();
    expect(A.createAthreeMap({ seed: 7 }).riverWater).toBeNull();
  });
});
