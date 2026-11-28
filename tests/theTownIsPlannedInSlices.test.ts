// ⏱️ THE TOWN IS PLANNED IN SLICES (Q-3763, the third honest limit of #4627: "colony/road planning runs all at once at the first height
// lookup — ~0.4–0.6 s on the default 2.2 km map, ~2.4 s on a dense 5 km one"). These run the EMITTED athree kit: the plan made a few
// milliseconds at a time (world.planStep) is the plan made at once, to the bit — roads, ponds, every colony plot, every height — on
// separately loaded copies of the kit (no shared cache can make them agree by accident); one slice stays near its budget; the map draws
// nothing that reads the ground until the plan is made, and making the map plans nothing; and a map prepared before the game's first
// frame (prepareOpenWorld) hands its plan to the game's own map, so the game's setup never plans again.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { loadAthree } from './helpers/loadAthree';
import { mapOptionsFor } from '../src/server/lib/athreeMap/athreeMapKinds';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TOWNS: Array<[string, Record<string, unknown>]> = [
  ['2.2 km grid, normal', { seed: 11, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: 'grid', density: 'normal' }],
  ['2.2 km old town, dense', { seed: 12, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: 'organic', density: 'dense' }],
  ['plains village with ponds', { seed: 13, ...mapOptionsFor({ archetype: 'plains', sizeKm: 2.2 }), roadStyle: 'grid', density: 'sparse', water: { ponds: 4 } }],
  ['8 km battle-royale island', { seed: 14, profile: 'battle-royale', density: 'normal' }],
];

/** Everything the town plan decides, as one string: the road graph, the ponds, every plot, and the ground on a grid. */
function fingerprint(w: any): string {
  const graph = w.roadNetwork().graph();
  const heights: number[] = [];
  const half = Math.min(1500, w.sizeMeters / 2);
  for (let x = -half; x <= half; x += half / 12) for (let z = -half; z <= half; z += half / 12) heights.push(w.heightAt(x, z));
  return JSON.stringify({ graph, ponds: w.ponds(), colonies: w.colonies(), heights });
}

describe('⏱️ the town plan in slices is the town plan at once', () => {
  it('same seed, same town, same ground — whether planned in 4 ms slices or by the first heightAt (separate copies of the kit)', () => {
    for (const [name, opts] of TOWNS) {
      const sliced = loadAthree().createAthreeWorld(opts);
      let slices = 0;
      while (!sliced.planStep(4)) slices++;
      expect(sliced.planned(), name).toBe(true);
      const atOnce = loadAthree().createAthreeWorld(opts);
      expect(atOnce.planned(), name).toBe(false);
      const a = fingerprint(sliced), b = fingerprint(atOnce);
      expect(a.length).toBeGreaterThan(1000);
      expect(a === b, `${name}: ${slices} slices`).toBe(true);
    }
  });

  it('one slice stays near its budget: half of them within 6 ms and nine in ten within 10 ms of a 4 ms budget (measured)', () => {
    const A = loadAthree();
    for (const [name, opts] of TOWNS.slice(0, 2).concat([['5 km dense highway town', { seed: 15, ...mapOptionsFor({ archetype: 'island', sizeKm: 5 }), roadStyle: 'highway', density: 'dense' }]])) {
      const w = A.createAthreeWorld(opts);
      const times: number[] = [];
      for (;;) {
        const t = performance.now();
        const done = w.planStep(4);
        times.push(performance.now() - t);
        if (done) break;
      }
      times.sort((p, q) => p - q);
      const at = (f: number): number => times[Math.min(times.length - 1, Math.floor(times.length * f))];
      expect(times.length, name).toBeGreaterThan(20);
      expect(at(0.5), `${name} median slice`).toBeLessThan(6);
      expect(at(0.9), `${name} 90th percentile slice (worst ${times[times.length - 1].toFixed(1)} ms of ${times.length})`).toBeLessThan(10);
    }
  });
});

describe('the map loads without a frozen frame', () => {
  it('making the map plans nothing; update() plans a slice a frame and draws the terrain only once the plan is made', () => {
    const A = loadAthree();
    const opts = TOWNS[0][1];
    const t = performance.now();
    const map = A.createAthreeMap({ ...opts, quality: 'phone', three: THREE, vegetation: false, sky: false });
    const made = performance.now() - t;
    expect(map.world.planned()).toBe(false);
    expect(map.colonyMesh, 'the colony mesh is made without planning the colonies').not.toBeNull();
    expect(made, 'createAthreeMap returns at once').toBeLessThan(250);
    let frames = 0;
    const before = map.chunks.group.children.length;
    while (!map.world.planned()) {
      expect(map.update(0, 0, frames / 60), 'no terrain while planning').toBeNull();
      expect(map.chunks.group.children.length, 'nothing that reads the ground is added while planning').toBe(before);
      frames++;
    }
    expect(frames).toBeGreaterThan(10);
    for (let i = 0; i < 30; i++) map.update(0, 0, i / 60);
    expect(map.chunks.group.children.length).toBeGreaterThan(before);
    // slicedPlanning: false keeps the old contract: the first update plans and draws.
    const old = A.createAthreeMap({ ...TOWNS[1][1], quality: 'phone', three: THREE, vegetation: false, sky: false, slicedPlanning: false });
    old.update(0, 0, 0);
    expect(old.world.planned()).toBe(true);
  });
});

describe('a map prepared before the first frame hands its plan to the game', () => {
  const DIR = join(__dirname, `.tmp-town-slices-${process.pid}`);
  let OW: any; let K: any;
  beforeAll(async () => {
    for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
    OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
    K = await import(join(DIR, 'src/game/athree/index.ts'));
  }, 180_000);
  afterAll(() => rmSync(DIR, { recursive: true, force: true }));

  it('prepareOpenWorld plans the open world\'s own map in slices; the map createOpenWorld then makes is planned in one tiny step', () => {
    const options = { ...TOWNS[1][1], seed: 21 };
    const prep = OW.prepareOpenWorld(options);
    expect(prep.done).toBe(false);
    let steps = 0;
    while (!prep.step(4)) steps++;
    expect(steps).toBeGreaterThan(10);
    // The game's map: the same options (openWorldMapSetup is the one place they are worked out) — nothing left to plan.
    const map = K.createAthreeMap(OW.openWorldMapSetup(options).athreeOptions);
    expect(map.world.planStep(0.25), 'the plan was handed over').toBe(true);
    // A map never prepared still plans for real (the hand-over is a cache of the same plan, not a skipped plan).
    const cold = K.createAthreeMap(OW.openWorldMapSetup({ ...options, seed: 22 }).athreeOptions);
    expect(cold.world.planStep(0.25)).toBe(false);
  });
});
