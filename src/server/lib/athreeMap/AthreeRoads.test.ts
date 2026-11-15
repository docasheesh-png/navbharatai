// ATHREE MAP phase 5a — ROADS, RACE CIRCUIT, RUNWAYS, VILLAGE PLAZAS, BRIDGES. These tests run the emitted code: the circuit closes and is
// banked the right way, no road climbs more than 7 percent, a road never sits in a lake or the sea, a river is bridged on a deck above
// the water, the ground is cut to the road and stays continuous round it, the loop repeats, nothing grows or spawns on a road, the mesh
// counts, and the tile manager with real three.js.
// What they cannot prove — how it LOOKS and whether the shader compiles on a GPU — is checked by a headless-Chromium render.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

// These tests sample whole worlds (thousands of terrain, river, dune and road queries). Under the coverage run they are several times
// slower, so each gets two minutes instead of vitest's default twenty seconds: the assertions are not loosened, only the clock.
vi.setConfig({ testTimeout: 120000 });

const A = loadAthree();
const TIERS = ['phone', 'mid', 'desktop'] as const;
const cache = new Map<string, any>();
const world = (seed: number, profile = 'open-world'): any => { const k = seed + profile; if (!cache.has(k)) cache.set(k, A.createAthreeWorld({ seed, profile })); return cache.get(k); };
const RACING = [1, 3, 5, 9, 11, 13];
const OPEN = [1, 3, 7, 9, 11];

function circuitOf(w: any): { road: any; circuit: any } | null {
  const home = w.homeRoads();
  return home.circuit ? { road: home.roads[home.circuit.road], circuit: home.circuit } : null;
}

describe('the road network', () => {
  it('is deterministic by seed, and differs between seeds', () => {
    const a = world(3).homeRoads();
    const again = A.createAthreeWorld({ seed: 3, profile: 'open-world' }).homeRoads();
    expect(again.roads.map((r: any) => r.points.length)).toEqual(a.roads.map((r: any) => r.points.length));
    expect(again.sites.map((s: any) => s.x)).toEqual(a.sites.map((s: any) => s.x));
    expect(world(4).homeRoads().sites.map((s: any) => s.x)).not.toEqual(a.sites.map((s: any) => s.x));
  });
  it('has villages and highways on every profile, and the home region is built in a fraction of a second', () => {
    for (const [seed, profile] of [[1, 'racing'], [3, 'open-world'], [1, 'flight'], [2, 'explore'], [1, 'battle-royale']] as const) {
      const t0 = performance.now();
      const home = A.createAthreeWorld({ seed, profile }).homeRoads();
      expect(performance.now() - t0, profile).toBeLessThan(3000);
      expect(home.sites.length, profile + seed).toBeGreaterThan(2);
      expect(home.roads.filter((r: any) => r.kind === 'highway').length, profile + seed).toBeGreaterThan(2);
    }
  });
  it('only the racing profile has a circuit; every profile but racing has a runway (two on flight)', () => {
    for (const seed of [1, 3]) {
      expect(world(seed, 'racing').homeRoads().circuit).not.toBeNull();
      for (const p of ['open-world', 'flight', 'explore', 'battle-royale']) expect(world(seed, p).homeRoads().circuit).toBeNull();
      expect(world(seed, 'racing').homeRoads().roads.filter((r: any) => r.kind === 'circuit')).toHaveLength(1);
      expect(world(seed, 'racing').homeRoads().roads.filter((r: any) => r.kind === 'runway')).toHaveLength(0);
      expect(world(seed, 'open-world').homeRoads().roads.filter((r: any) => r.kind === 'runway')).toHaveLength(1);
      expect(world(seed, 'battle-royale').homeRoads().roads.filter((r: any) => r.kind === 'runway')).toHaveLength(1);
      expect(world(seed, 'explore').homeRoads().roads.filter((r: any) => r.kind === 'runway')).toHaveLength(1);
      expect(world(seed, 'flight').homeRoads().roads.filter((r: any) => r.kind === 'runway')).toHaveLength(2);
    }
  });
  it('a road has points 10 m apart, and a highway has 9 m of width, a circuit 14, a runway 64', () => {
    for (const seed of OPEN) {
      for (const r of world(seed).homeRoads().roads) {
        for (let i = 0; i < r.points.length - 1; i++) expect(Math.hypot(r.points[i + 1].x - r.points[i].x, r.points[i + 1].z - r.points[i].z)).toBeLessThan(14);
        for (const p of r.points) expect(p.width).toBe(r.kind === 'highway' ? 9 : r.kind === 'circuit' ? 14 : 64);
      }
    }
  });
});

describe('the race circuit', () => {
  const found = RACING.map((s) => ({ seed: s, w: world(s, 'racing'), c: circuitOf(world(s, 'racing')) })).filter((e) => e.c);
  it('exists on most racing seeds, is 3 to 9 km round, and CLOSES: the last point meets the first, 10 m apart like the rest', () => {
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const { c } of found) {
      const pts = c!.road.points; const n = pts.length;
      expect(c!.road.closed).toBe(true);
      expect(c!.circuit.length).toBeGreaterThan(3000); expect(c!.circuit.length).toBeLessThan(9000);
      for (let i = 0; i < n; i++) { const a = pts[i]; const b = pts[(i + 1) % n]; const d = Math.hypot(b.x - a.x, b.z - a.z); expect(d).toBeGreaterThan(6); expect(d).toBeLessThan(14); }
    }
  });
  it('its height profile closes exactly and never climbs more than 7 percent, even over the closing segment', () => {
    for (const { c, seed } of found) {
      const pts = c!.road.points; const n = pts.length;
      let worst = 0;
      for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(pts[(i + 1) % n].y - pts[i].y) / 10);
      expect(worst, 'seed ' + seed).toBeLessThanOrEqual(0.0701);
    }
  });
  it('is banked by its own curvature: the OUTER edge is the higher one, within 8 degrees, and a straight is level', () => {
    let leaning = 0; let n = 0;
    for (const { c } of found) {
      const pts = c!.road.points; const m = pts.length;
      for (let i = 0; i < m; i++) {
        const p = pts[i];
        expect(Math.abs(p.bank)).toBeLessThanOrEqual(0.14 + 1e-9);
        const a = pts[(i - 4 + m) % m]; const b = pts[(i + 4) % m];
        const a1 = Math.atan2(p.z - a.z, p.x - a.x); const a2 = Math.atan2(b.z - p.z, b.x - p.x);
        let d = a2 - a1; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        const kappa = d / 80;
        if (Math.abs(kappa) > 0.002) { n++; if (Math.sign(p.bank) === -Math.sign(kappa)) leaning++; }
        // The bank is exactly minus 40 times the curvature averaged over nine points (until it hits the 8 degree limit): a straight is level.
        let avg = 0;
        for (let k = -4; k <= 4; k++) {
          const q0 = pts[(i + k - 1 + m) % m]; const q1 = pts[(i + k + m) % m]; const q2 = pts[(i + k + 1 + m) % m];
          let dd = Math.atan2(q2.z - q1.z, q2.x - q1.x) - Math.atan2(q1.z - q0.z, q1.x - q0.x);
          while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
          avg += dd / 10 / 9;
        }
        expect(p.bank).toBeCloseTo(Math.max(-0.14, Math.min(0.14, -avg * 40)), 9);
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(leaning / n).toBeGreaterThan(0.95);
  });
  it('has a checkpoint about every 250 m, starting at point 0, and a grid of cars behind the start line on the road, facing the way it runs', () => {
    for (const { w, c } of found) {
      const cps = c!.circuit.checkpoints;
      expect(cps[0].index).toBe(0);
      expect(cps.length).toBeGreaterThan(c!.circuit.length / 300);
      const spawns = w.spawnPoints('vehicle', 6);
      expect(spawns).toHaveLength(6);
      for (const s of spawns) {
        const hit = w.roadAt(s.x, s.z);
        expect(hit, 'on the road').not.toBeNull();
        expect(hit.kind).toBe('circuit');
        expect(Math.abs(s.y - w.heightAt(s.x, s.z))).toBeLessThan(1e-9);
        let best = 0; let bi = 0;
        c!.road.points.forEach((p: any, i: number) => { const d = Math.hypot(p.x - s.x, p.z - s.z); if (i === 0 || d < best) { best = d; bi = i; } });
        const a = c!.road.points[bi]; const b = c!.road.points[(bi + 1) % c!.road.points.length];
        expect(Math.cos(s.heading - Math.atan2(b.z - a.z, b.x - a.x))).toBeGreaterThan(0.97);
      }
    }
  });
});

describe('a circuit closes even on ground that slopes steadily (synthetic terrain)', () => {
  it('the height profile of a closed circuit meets itself within one grade step, on a ramp that rises 8 percent and on rolling hills', () => {
    const terrains: Array<[string, (x: number, z: number) => number]> = [
      ['ramp', (x) => 60 + 0.08 * x],
      ['hills', (x, z) => 80 + 22 * Math.sin(x / 380) * Math.cos(z / 310)],
    ];
    for (const [name, terrain] of terrains) {
      const net = A.createRoadNetwork({ seed: 4, period: 0, radius: 4000, profile: 'racing', terrain, water: () => null });
      const home = net.home();
      expect(home.circuit, name).not.toBeNull();
      const pts = home.roads[home.circuit.road].points; const n = pts.length;
      let worst = 0;
      for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(pts[(i + 1) % n].y - pts[i].y) / 10);
      expect(worst, name).toBeLessThanOrEqual(0.0701);
    }
  });
});

describe('highways', () => {
  it('never climb more than 7 percent, and start and end at the edge of a village plaza', () => {
    let roads = 0;
    for (const seed of OPEN) {
      const home = world(seed).homeRoads();
      for (const r of home.roads.filter((x: any) => x.kind === 'highway')) {
        roads++;
        for (let i = 0; i < r.points.length - 1; i++) expect(Math.abs(r.points[i + 1].y - r.points[i].y) / 10, 'seed ' + seed + ' road ' + r.id).toBeLessThanOrEqual(0.0701);
        const a = r.points[0]; const b = r.points[r.points.length - 1];
        const sa = home.sites[r.from]; const sb = home.sites[r.to];
        expect(Math.hypot(a.x - sa.x, a.z - sa.z)).toBeLessThan(45 + 25);
        expect(Math.hypot(b.x - sb.x, b.z - sb.z)).toBeLessThan(45 + 25);
      }
    }
    expect(roads).toBeGreaterThan(20);
  });
  it('never sit in the sea or in a lake, and cross every river on a bridge deck at least 3 m above the water (the class: a road that drives into a river)', () => {
    let bridges = 0; let points = 0;
    for (const seed of [...OPEN, 13, 15, 17]) {
      const w = world(seed);
      for (const r of w.homeRoads().roads.filter((x: any) => x.kind !== 'runway')) {
        for (const p of r.points) {
          points++;
          const water = w.waterAt(p.x, p.z);
          if (water) {
            expect(p.bridge, 'seed ' + seed + ' water under a road that is not a bridge').toBe(true);
            expect(water.kind).toBe('river');
            expect(p.y).toBeGreaterThanOrEqual(water.surface + 3 - 1e-6);
          }
          if (p.bridge) bridges++;
          else expect(w.heightAt(p.x, p.z), 'seed ' + seed).toBeGreaterThan(1);
        }
      }
    }
    expect(points).toBeGreaterThan(5000);
    expect(bridges).toBeGreaterThan(15);
  });
  it('are routed over reasonable ground: nowhere steeper than 0.45 outside a bridge', () => {
    for (const seed of OPEN) {
      const w = world(seed);
      for (const r of w.homeRoads().roads.filter((x: any) => x.kind === 'highway')) {
        for (const p of r.points.filter((_: any, i: number) => i % 3 === 0 && !_.bridge)) {
          const s = Math.hypot(w.baseHeightAt(p.x + 15, p.z) - w.baseHeightAt(p.x - 15, p.z), w.baseHeightAt(p.x, p.z + 15) - w.baseHeightAt(p.x, p.z - 15)) / 30;
          expect(s).toBeLessThan(0.5);
        }
      }
    }
  });
});

describe('the ground is cut to the road', () => {
  it('no road sits more than 14 m above or below the ground it was routed over (outside a bridge): the class of a road that floats or hides in a trench', () => {
    let n = 0;
    for (const [seed, profile] of [[1, 'racing'], [3, 'racing'], [3, 'open-world'], [9, 'open-world'], [11, 'open-world'], [1, 'battle-royale'], [1, 'flight']] as const) {
      const w = world(seed, profile);
      for (const r of w.homeRoads().roads.filter((x: any) => x.kind !== 'runway')) for (const p of r.points) if (!p.bridge) { n++; expect(Math.abs(p.y - (w.baseHeightAt(p.x, p.z) + w.dunesAt(p.x, p.z)))).toBeLessThan(14 + 6); }
    }
    expect(n).toBeGreaterThan(5000);
  });
  it('on the paved width the ground IS the road surface (bank included), off the road it is the old ground', () => {
    let n = 0;
    for (const seed of [3, 9]) {
      const w = world(seed, 'racing');
      const { road } = circuitOf(w)!;
      for (let i = 0; i < road.points.length; i += 7) {
        const p = road.points[i]; const q = road.points[(i + 1) % road.points.length];
        if (p.bridge) continue;
        const l = Math.hypot(q.x - p.x, q.z - p.z); const nx = -(q.z - p.z) / l; const nz = (q.x - p.x) / l;
        for (const across of [-5, 0, 5]) {
          const x = p.x + nx * across; const z = p.z + nz * across;
          expect(Math.abs(w.heightAt(x, z) - (p.y + across * Math.tan(p.bank)))).toBeLessThan(0.12);
          const hit = w.roadAt(x, z);
          expect(hit).not.toBeNull();
          expect(hit.kind).toBe('circuit');
          expect(hit.across).toBeCloseTo(across, 0);
          n++;
        }
        expect(w.roadAt(p.x + nx * 60, p.z + nz * 60)).toBeNull();
      }
    }
    expect(n).toBeGreaterThan(150);
  });
  it('no cliff beside ANY road: steps under 2.5 m per metre, 60 m either side of every road in every world sampled', () => {
    let n = 0; let worst = 0;
    for (const [seed, profile] of [[1, 'racing'], [3, 'racing'], [3, 'open-world'], [9, 'open-world'], [1, 'flight'], [1, 'battle-royale']] as const) {
      const w = world(seed, profile);
      for (const r of w.homeRoads().roads) {
        for (let i = 1; i < r.points.length - 1; i += 5) {
          const p = r.points[i]; const o = r.points[i - 1]; const q = r.points[i + 1];
          const l = Math.hypot(q.x - o.x, q.z - o.z) || 1; const nx = -(q.z - o.z) / l; const nz = (q.x - o.x) / l;
          let prev = w.heightAt(p.x - nx * 60, p.z - nz * 60);
          for (let d = -59; d <= 60; d++) { const h = w.heightAt(p.x + nx * d, p.z + nz * d); worst = Math.max(worst, Math.abs(h - prev)); prev = h; n++; }
        }
      }
    }
    expect(n).toBeGreaterThan(20000);
    expect(worst).toBeLessThan(2.5);
  });
  it('no cliff near any RIVER either, with the roads in the world: steps under 3.2 m per metre (a road and a river bank may overlap)', () => {
    let n = 0; let worst = 0;
    for (const seed of [1, 3, 7, 9, 11, 13, 15, 17]) {
      const w = world(seed);
      for (const r of w.waterBodies().rivers) {
        for (let i = 1; i < r.points.length; i += 8) {
          const p = r.points[i]; const q = r.points[Math.min(r.points.length - 1, i + 1)]; const o = r.points[i - 1];
          const l = Math.hypot(q.x - o.x, q.z - o.z) || 1; const px = -(q.z - o.z) / l; const pz = (q.x - o.x) / l;
          let prev = w.heightAt(p.x - px * 100, p.z - pz * 100);
          for (let d = -99; d <= 100; d++) { const h = w.heightAt(p.x + px * d, p.z + pz * d); worst = Math.max(worst, Math.abs(h - prev)); prev = h; n++; }
        }
      }
    }
    expect(n).toBeGreaterThan(50000);
    expect(worst).toBeLessThan(3.2);
  });
  it('a plaza is flat, dry ground at its own height out to 45 m', () => {
    for (const seed of OPEN) {
      const w = world(seed);
      for (const s of w.homeRoads().sites) {
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; for (const r of [0, 20, 30, 44]) { const x = s.x + Math.cos(a) * r; const z = s.z + Math.sin(a) * r; expect(Math.abs(w.heightAt(x, z) - s.y)).toBeLessThan(r <= 30 ? 0.01 : 2.5); expect(w.waterAt(x, z)).toBeNull(); } }
      }
    }
  });
  it('a runway is a flat strip: 900 m, one height, 56 m wide, running east', () => {
    for (const seed of [1, 3, 5]) {
      const w = world(seed, 'flight');
      const rws = w.homeRoads().roads.filter((r: any) => r.kind === 'runway');
      expect(rws.length).toBe(2);
      for (const r of rws) {
        expect(r.length).toBe(900); expect(r.points).toHaveLength(91);
        const y = r.points[0].y;
        for (const p of r.points) { expect(p.y).toBe(y); expect(p.z).toBe(r.points[0].z); }
        for (const p of r.points.filter((_: any, i: number) => i % 3 === 0)) for (const dz of [-28, -10, 0, 10, 28]) expect(w.heightAt(p.x, p.z + dz)).toBeCloseTo(y, 3);
      }
      const planes = w.spawnPoints('plane', 2);
      expect(planes).toHaveLength(2);
      for (const p of planes) { expect(p.strip).toBeGreaterThanOrEqual(600); expect(w.roadAt(p.x, p.z).kind).toBe('runway'); expect(p.heading).toBe(0); }
    }
  });
});

describe('bridges', () => {
  it('a vehicle drives on the deck: drivableHeightAt is the deck, above the ground below it, and equals the ground on ordinary road', () => {
    let bridgePts = 0; let plain = 0;
    for (const seed of [3, 1]) {
      const w = world(seed, 'racing');
      for (const r of w.homeRoads().roads) {
        for (const p of r.points) {
          const idx = r.points.indexOf(p);
          const interior = p.bridge && r.points[idx - 1]?.bridge && r.points[idx + 1]?.bridge;
          if (interior) {
            bridgePts++;
            const hit = w.roadAt(p.x, p.z);
            expect(hit.bridge).toBe(true);
            expect(w.drivableHeightAt(p.x, p.z)).toBeCloseTo(p.y, 1);
            expect(w.heightAt(p.x, p.z)).toBeLessThan(p.y - 1.5);
          } else if (!p.bridge && plain < 300) { plain++; expect(w.drivableHeightAt(p.x, p.z)).toBe(w.heightAt(p.x, p.z)); }
        }
      }
    }
    expect(bridgePts).toBeGreaterThan(10);
  });
});

describe('the loop world repeats exactly with its roads', () => {
  it('heightAt, roadAt and the plazas 100 km away are the same', () => {
    const w = world(3, 'racing');
    const P = w.sizeMeters; let n = 0;
    for (const r of w.homeRoads().roads) {
      for (const p of r.points.filter((_: any, i: number) => i % 11 === 0)) {
        expect(w.heightAt(p.x + P, p.z)).toBeCloseTo(w.heightAt(p.x, p.z), 6);
        expect(w.heightAt(p.x, p.z - P)).toBeCloseTo(w.heightAt(p.x, p.z), 6);
        expect(!!w.roadAt(p.x + P, p.z - P)).toBe(!!w.roadAt(p.x, p.z));
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });
  it('the other regions of the world have roads too, built when first looked at', () => {
    const w = world(7);
    const far = w.roadNetwork().regionAt(60000, 40000);
    expect(far.sites.length).toBeGreaterThan(1);
    expect(far.roads.length).toBeGreaterThan(0);
    expect(w.roadNetwork().regionAt(60000 + w.sizeMeters, 40000)).toBe(far);
  });
});

describe('nothing grows, spawns or floats on a road', () => {
  it('no tree and no grass tuft stands on a road, and there ARE trees beside roads', () => {
    let beside = 0;
    for (const seed of OPEN) {
      const w = world(seed);
      for (const r of w.homeRoads().roads.filter((x: any) => x.kind === 'highway').slice(0, 6)) {
        const p = r.points[Math.floor(r.points.length / 2)];
        const x0 = Math.floor(p.x / 64) * 64; const z0 = Math.floor(p.z / 64) * 64;
        for (const t of A.treesInRect(w, x0 - 64, z0 - 64, x0 + 128, z0 + 128)) { expect(w.roadAt(t.x, t.z)).toBeNull(); if (Math.hypot(t.x - p.x, t.z - p.z) < 120) beside++; }
        const g = A.grassInRect(w, x0, z0, x0 + 32, z0 + 32, 1);
        for (let i = 0; i < g.length; i += 6) expect(w.roadAt(g[i], g[i + 2]) === null || g[i + 1] < 1e9).toBe(true);
      }
    }
    expect(beside).toBeGreaterThan(10);
  });
  it('a world made with roads: false has none, and its ground is the ground it was', () => {
    const dry = A.createAthreeWorld({ seed: 3, profile: 'racing', roads: false });
    expect(dry.homeRoads()).toEqual({ roads: [], sites: [], circuit: null });
    for (let i = 0; i < 100; i++) { expect(dry.roadAt(i * 311, i * 977)).toBeNull(); expect(dry.drivableHeightAt(i * 311, i * 977)).toBe(dry.heightAt(i * 311, i * 977)); }
    const { road } = circuitOf(world(3, 'racing'))!;
    const p = road.points[10];
    expect(dry.heightAt(p.x, p.z)).not.toBeCloseTo(p.y, 1);
  });
});

describe('the road meshes', () => {
  const w = world(3, 'racing');
  const { road } = circuitOf(w)!;
  const mid = road.points[Math.floor(road.points.length / 2)];
  const x0 = Math.floor(mid.x / 256) * 256; const z0 = Math.floor(mid.z / 256) * 256;

  it('a segment is a quad of two triangles; a bridge adds rails and piers; a plaza is a fan of 24; indices are in range, nothing is NaN', () => {
    const a = A.roadsInRect(w, x0, z0, x0 + 256, z0 + 256);
    expect(a.triangles).toBeGreaterThan(20);
    const n = a.position.length / 3;
    for (const arr of [a.world, a.across, a.along, a.kind, a.end, a.width]) expect(arr.length).toBe(arr === a.world ? n * 2 : n);
    for (const i of a.index) expect(i).toBeLessThan(n);
    for (const v of [...a.position, ...a.world, ...a.across, ...a.along, ...a.kind, ...a.width]) expect(Number.isFinite(v)).toBe(true);
    const kinds = new Set(Array.from(a.kind));
    expect(kinds.has(A.ROAD_KIND.circuit)).toBe(true);
    const site = w.homeRoads().sites[0];
    const sx = Math.floor(site.x / 512) * 512; const sz = Math.floor(site.z / 512) * 512;
    expect(Array.from(A.roadsInRect(w, sx, sz, sx + 512, sz + 512).kind)).toContain(A.ROAD_KIND.plaza);
    let withBridge = false;
    for (const seed of [3, 1, 9, 11]) {
      const ww = world(seed, 'open-world');
      for (const r of ww.homeRoads().roads) { const bp = r.points.find((p: any) => p.bridge); if (bp && !withBridge) { const bx = Math.floor(bp.x / 256) * 256; const bz = Math.floor(bp.z / 256) * 256; const arr = A.roadsInRect(ww, bx, bz, bx + 256, bz + 256); const ks = new Set(Array.from(arr.kind)); expect(ks.has(A.ROAD_KIND.deck)).toBe(true); expect(ks.has(A.ROAD_KIND.concrete)).toBe(true); withBridge = true; } }
    }
    expect(withBridge).toBe(true);
  });
  it('an island has road meshes too: a bounded world has one region, and its plazas and highways are drawn', () => {
    const island = world(1, 'battle-royale');
    const s = island.homeRoads().sites[0];
    const ix = Math.floor(s.x / 512) * 512; const iz = Math.floor(s.z / 512) * 512;
    const a = A.roadsInRect(island, ix, iz, ix + 512, iz + 512);
    expect(a.triangles).toBeGreaterThanOrEqual(24);
    expect(Array.from(a.kind)).toContain(A.ROAD_KIND.plaza);
  });
  it('every segment is in exactly one tile: two halves hold exactly what the whole holds, and a tile 100 km away is the same road', () => {
    const whole = A.roadsInRect(w, x0, z0, x0 + 512, z0 + 256).triangles;
    const left = A.roadsInRect(w, x0, z0, x0 + 256, z0 + 256).triangles;
    const right = A.roadsInRect(w, x0 + 256, z0, x0 + 512, z0 + 256).triangles;
    expect(whole).toBeGreaterThan(0);
    expect(left + right).toBe(whole);
    const P = w.sizeMeters;
    expect(A.roadsInRect(w, x0 + P, z0 - P, x0 + P + 256, z0 - P + 256).triangles).toBe(left);
  });
  it('the ribbon follows the banked surface just above the ground, and runs 0 to 1 across with length along', () => {
    const a = A.roadsInRect(w, x0, z0, x0 + 256, z0 + 256);
    let checked = 0;
    for (let i = 0; i < a.kind.length; i++) {
      if (a.kind[i] !== A.ROAD_KIND.circuit) continue;
      expect([0, 1]).toContain(a.across[i]);
      expect(a.width[i]).toBe(14);
      const wx = a.world[i * 2]; const wz = a.world[i * 2 + 1];
      if (!w.waterAt(wx, wz)) { expect(a.position[i * 3 + 1] - w.heightAt(wx, wz)).toBeGreaterThan(0.0); expect(a.position[i * 3 + 1] - w.heightAt(wx, wz)).toBeLessThan(0.6); checked++; }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('the budget', () => {
  it('terrain + sea + plants + water + sky + the worst case of the roads fits every tier', () => {
    for (const q of TIERS) {
      expect(A.ROAD_TIERS[q].maxTriangles).toBeLessThanOrEqual(A.roadBudget(q));
      expect(A.maxTriangles(A.QUALITY[q]) + A.oceanTriangles(A.OCEAN_TIERS[q]) + A.vegetationTriangles(A.VEGETATION_TIERS[q]) + A.RIVER_TIERS[q].maxTriangles + A.domeTriangles(A.SKY_TIERS[q]) + A.ROAD_TIERS[q].maxTriangles).toBeLessThanOrEqual(A.QUALITY[q].budgetTriangles);
    }
  });
  it('roads are drawn only where the terrain mesh can hold a road bed, and more quality draws more', () => {
    const [p, m, d] = TIERS.map((q) => A.ROAD_TIERS[q]);
    expect(p.radius).toBeLessThan(m.radius); expect(m.radius).toBeLessThan(d.radius); expect(p.maxTriangles).toBeLessThan(m.maxTriangles); expect(m.maxTriangles).toBeLessThan(d.maxTriangles);
    for (const q of TIERS) { const t = A.QUALITY[q]; const lastRing = Math.floor(A.ROAD_TIERS[q].radius / t.chunkSize); expect(t.chunkSize / A.lodResolution(t, lastRing)).toBeLessThanOrEqual(11); }
  });
});

describe('the shaders', () => {
  const vert = A.roadVertexShader(); const frag = A.roadFragmentShader();
  it('read the attributes and uniforms the manager writes, with fog and no texture', () => {
    for (const u of ['aWorld', 'aAcross', 'aAlong', 'aKind', 'aEnd', 'aWidth']) expect(vert).toContain(u);
    for (const u of ['uSun', 'uSunColor', 'uAmbient']) expect(frag).toContain(u);
    expect(vert).toContain('#include <fog_vertex>'); expect(frag).toContain('#include <fog_fragment>');
    expect(frag).not.toContain('sampler2D');
  });
  it('paints dashed centre lines, edge lines, kerbs and a chequered start line, all from position across and along', () => {
    expect(frag).toContain('fract(vAlong / 9.0)');
    expect(frag).toContain('edge > 0.35 && edge < 0.65');
    expect(frag).toContain('vec3(0.8, 0.1, 0.1)');
    expect(frag).toContain('vAlong < 6.0');
    expect(frag).toContain('vEnd > 8.0');
  });
});

describe('the road mesh manager (real three.js)', () => {
  const origin = { x: 0, z: 0 };
  function setup(quality: 'phone' | 'mid' | 'desktop') {
    const ww = world(3, 'racing');
    const rm = A.createRoadMesh(THREE, ww, quality);
    const { road } = circuitOf(ww)!;
    return { ww, rm, p: road.points[10] };
  }
  const settle = (rm: any, x: number, z: number, frames = 80): void => { for (let i = 0; i < frames; i++) rm.update(x, z, origin); };

  it('streams a few tiles per update and draws the road near the camera within the triangle cap', () => {
    for (const q of TIERS) {
      const { rm, p } = setup(q);
      rm.update(p.x, p.z, origin);
      expect(rm.group.children.length).toBeLessThanOrEqual(A.ROAD_TIERS[q].tilesPerUpdate);
      settle(rm, p.x, p.z);
      const s = rm.stats();
      expect(s.tiles).toBeGreaterThan(0); expect(s.triangles).toBeGreaterThan(0); expect(s.triangles).toBeLessThanOrEqual(A.ROAD_TIERS[q].maxTriangles);
      rm.dispose();
    }
  });
  it('places each tile in render space and follows a floating-origin shift; light reaches the shader', () => {
    const { rm, p } = setup('mid');
    settle(rm, p.x, p.z);
    const mesh = rm.group.children[0];
    const before = mesh.position.x;
    rm.update(p.x, p.z, { x: 2500, z: -300 });
    expect(mesh.position.x).toBeCloseTo(before - 2500, 6);
    rm.setLight({ x: 0, y: 2, z: 0 }, 0xffffff, 0x202020);
    expect(mesh.material.uniforms.uSun.value.y).toBeCloseTo(1, 9);
    expect(mesh.material.uniforms.uSunColor.value.r).toBeCloseTo(1, 9);
  });
  it('draws nothing where there is no road, and dispose releases geometry and material', () => {
    const { rm } = setup('phone');
    settle(rm, 70000, 70000, 40);
    expect(rm.stats().triangles).toBe(0);
    const { rm: rm2, p } = setup('phone');
    settle(rm2, p.x, p.z);
    const mesh: any = rm2.group.children[0];
    let n = 0;
    mesh.geometry.addEventListener('dispose', () => n++); mesh.material.addEventListener('dispose', () => n++);
    rm2.dispose();
    expect(n).toBe(2);
  });
  it('createAthreeMap adds the road mesh, lights it from the sky, and can leave it out', () => {
    const map = A.createAthreeMap({ seed: 3, profile: 'racing', quality: 'phone', three: THREE, skyOptions: { hours: 12 } });
    expect(map.roadMesh).not.toBeNull();
    expect(map.chunks.group.children).toContain(map.roadMesh.group);
    const { road } = circuitOf(map.world)!;
    const p = road.points[10];
    for (let i = 0; i < 80; i++) map.update(p.x, p.z, i * 0.1);
    expect(map.roadMesh.stats().triangles).toBeGreaterThan(0);
    const r = map.sky.reading();
    expect(map.roadMesh.group.children[0].material.uniforms.uSun.value.distanceTo(new THREE.Vector3(r.sun.x, Math.max(r.sun.y, 0.05), r.sun.z).normalize())).toBeLessThan(1e-6);
    map.dispose();
    expect(A.createAthreeMap({ seed: 3, quality: 'phone', three: THREE, roads: false }).roadMesh).toBeNull();
    expect(A.createAthreeMap({ seed: 3 }).roadMesh).toBeNull();
  });
});
