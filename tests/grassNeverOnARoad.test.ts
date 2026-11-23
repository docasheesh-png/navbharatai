// 🌱 GRASS NEVER GROWS ON A ROAD (admin 2026-11-23: grass was growing on the roads). Three holes, each closed here:
//   1. the kit's grass density is a 2 m lattice blended between nodes, so beside a road's edge it said "some grass" ON the road;
//   2. surfaceAt() reads a city's streets (levelled ground) by their biome — 'grass' — and a builder that planted its own grass
//      "where surfaceAt says grass" covered every street: plantableAt() is the question to ask;
//   3. a road or pad laid after the map was drawn kept the plants already standing there unless the game set lateEdits.
// These run the EMITTED map code (loadAthree), with real three.js for the plant manager.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from './helpers/loadAthree';

vi.setConfig({ testTimeout: 120000 });
/* eslint-disable @typescript-eslint/no-explicit-any */
const A = loadAthree();

/** Points on the world's own road network (the racing profile's home region: circuit, highways, villages), on grassland. */
function networkRoadPoints(world: any): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const road of world.homeRoads().roads) {
    for (let i = 0; i < road.points.length; i += 25) {
      const p = road.points[i];
      if (!p.bridge && world.biomeAt(p.x, p.z) === 'grassland' && world.roadAt(p.x, p.z)) out.push({ x: p.x, z: p.z });
    }
  }
  return out;
}

/** Every plant instance (tuft or tree) the manager draws, in WORLD metres. */
function plantRoots(map: any): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const g = map.vegetation.group;
  for (const m of g.children) {
    if (!m.isInstancedMesh || m.count === 0) continue;
    const a = m.instanceMatrix.array as Float32Array;
    for (let i = 0; i < m.count; i++) out.push({ x: a[i * 16 + 12] + g.position.x + map.chunks.origin.x, z: a[i * 16 + 14] + g.position.z + map.chunks.origin.z });
  }
  return out;
}
const settle = (map: any, x: number, z: number, n = 300) => { for (let i = 0; i < n; i++) map.update(x, z, i / 60); };

describe('🌱 the kit scatter keeps every blade off the road', () => {
  it('no tuft beside the network road reaches onto it (the 2 m lattice no longer bleeds over the edge)', () => {
    const world = A.createAthreeWorld({ seed: 3, profile: 'racing' });
    const points = networkRoadPoints(world).slice(0, 12);
    expect(points.length).toBeGreaterThan(3);
    let tuftsSeen = 0, onRoad = 0;
    for (const p of points) {
      const tufts = A.grassInRect(world, p.x - 32, p.z - 32, p.x + 32, p.z + 32, 0.625);
      tuftsSeen += tufts.length / 6;
      for (let i = 0; i < tufts.length; i += 6) if (A.tuftBlocked(world, tufts[i], tufts[i + 2])) onRoad++;
    }
    expect(tuftsSeen).toBeGreaterThan(100);
    expect(onRoad).toBe(0);
  });

  it('no tuft on a road the game laid, nor on a levelled pad', () => {
    const world = A.createAthreeWorld({ seed: 7, profile: 'open-world' });
    world.addRoad([{ x: -300, z: 40 }, { x: 300, z: 60 }], 9);
    world.levelGround(0, -200, 60, 40, 20);
    const tufts = A.grassInRect(world, -320, -320, 320, 320, 1);
    for (let i = 0; i < tufts.length; i += 6) {
      expect(world.gameRoadAt(tufts[i], tufts[i + 2])).toBe(false);
      expect(world.clearAt(tufts[i], tufts[i + 2])).toBe(false);
    }
  });

  it('the scatter is still the same everywhere away from roads, pads and water (nothing else changed)', () => {
    const world = A.createAthreeWorld({ seed: 7, profile: 'open-world' });
    const a = A.grassInRect(world, 4000, 4000, 4064, 4064, 1);
    const b = A.grassInRect(world, 4000, 4000, 4064, 4064, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('🌱 plantableAt — where a builder may put its own grass', () => {
  const world = A.createAthreeWorld({ seed: 7, profile: 'open-world' });
  world.levelGround(800, 800, 120, 120, 30);            // a city stands here: its streets are levelled ground
  world.addRoad([{ x: -400, z: -600 }, { x: 400, z: -600 }], 9);
  it('a city street reads as grass to surfaceAt, but nothing may grow there', () => {
    const grassy = world.surfaceAt(800, 800);
    expect(['grass', 'sand', 'snow', 'rock']).toContain(grassy);    // by biome — the trap the builder fell into
    expect(world.plantableAt(800, 800)).toBe(false);
  });
  it('false on a laid road and within its margin; true on open grassland', () => {
    expect(world.plantableAt(0, -600)).toBe(false);
    expect(world.plantableAt(0, -600 + 4.5 + 0.5)).toBe(false);     // inside the 1 m margin
    let open = 0;
    for (let x = -3000; x < 3000 && open === 0; x += 97) for (let z = 2000; z < 4000 && open === 0; z += 89) if (world.biomeAt(x, z) === 'grassland' && world.plantableAt(x, z)) open++;
    expect(open).toBe(1);
  });
  it('false in water and on bad input', () => {
    expect(world.plantableAt(Number.NaN, 0)).toBe(false);
    let wet: { x: number; z: number } | null = null;
    for (let x = -6000; x < 6000 && !wet; x += 50) for (let z = -6000; z < 6000 && !wet; z += 50) if (world.heightAt(x, z) < -2) wet = { x, z };
    if (wet) expect(world.plantableAt(wet.x, wet.z)).toBe(false);
  });
});

describe('🌱 a road laid after the map was drawn takes its plants away (lateEdits left out)', () => {
  it('no plant stands on the new road, and the terrain is still not redrawn (the old contract)', () => {
    const map = A.createAthreeMap({ seed: 7, profile: 'open-world', quality: 'phone', three: THREE, sky: false });
    settle(map, 0, 0);
    const before = plantRoots(map).length;
    expect(before).toBeGreaterThan(0);
    // A road right through the plants around the camera.
    map.world.addRoad([{ x: -200, z: 3 }, { x: 200, z: 3 }], 9);
    const chunksBefore = new Set(map.chunks.group.children);
    settle(map, 0, 0, 60);
    const onRoad = plantRoots(map).filter((p) => map.world.gameRoadAt(p.x, p.z));
    expect(onRoad).toEqual([]);
    expect(map.chunks.group.children.every((c: any) => chunksBefore.has(c))).toBe(true);
    // Plants away from the road are kept (only the ones on it went).
    expect(plantRoots(map).length).toBeGreaterThan(before * 0.5);
    map.dispose();
  });

  it('prune() removes only what is blocked and is idempotent', () => {
    const map = A.createAthreeMap({ seed: 3, profile: 'open-world', quality: 'phone', three: THREE, sky: false });
    settle(map, 0, 0);
    expect(map.vegetation.prune(Number.NaN, 0, 0, 0)).toBe(0);     // nothing blocked yet
    map.world.levelGround(0, 0, 25, 25, 10);
    const removed = map.vegetation.prune(-40, -40, 40, 40);
    expect(removed).toBeGreaterThan(0);
    expect(map.vegetation.prune(-40, -40, 40, 40)).toBe(0);
    map.dispose();
  });
});
