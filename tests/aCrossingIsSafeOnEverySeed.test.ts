// A CROSSING IS SAFE ON EVERY SEED, NOT ONE (Q-3547, found 2026-11-26 while making city people look human).
//
// cityPeopleWalkSafely proved "no car near a crossing walker" on ONE pinned seed. One extra random number per person changed
// the crowd, and the same two minutes counted 71 near misses. The real case (seed 9): a 10 m bus pulled out of a junction and
// stopped with its body across the next zebra; the person waiting had judged it by its CENTRE ("far"), and walked through it.
// Now the wait counts the whole body, and a crossing person never steps into a vehicle's body. Locked over several seeds.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-safe-seeds-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let T: any; let P: any;
beforeAll(async () => {
  (globalThis as any).window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  T = await import(join(DIR, 'src/game/three/citytraffic.ts'));
  P = await import(join(DIR, 'src/game/three/citypeople.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** Two minutes; counts frames where a crossing person stands inside a vehicle's body, and the crossings made. */
function run(seed: number) {
  const city = C.createCity({ blocksX: 3, blocksZ: 3, seed: 2 });
  const traffic = T.createCityTraffic(city, { count: 20, seed: 4 });
  const people = P.createCityPeople(city, { count: 40, traffic, seed, crossChance: 0.6 });
  const p = new THREE.Vector3();
  let inside = 0, crossings = 0;
  const was = people.walkers.map(() => false);
  for (let f = 0; f < 120 * 30; f++) {
    people.update(1 / 30); traffic.update(1 / 30, people.bodies);
    people.walkers.forEach((w: any, k: number) => {
      if (w.state === 'cross' && !was[k]) crossings++;
      was[k] = w.state === 'cross';
      if (w.state !== 'cross') return;
      for (const car of traffic.cars) {
        car.object.getWorldPosition(p);
        const h = car.object.rotation.y, fx = Math.sin(h), fz = Math.cos(h);
        const along = (w.x - p.x) * fx + (w.z - p.z) * fz, side = (w.x - p.x) * fz - (w.z - p.z) * fx;
        if (Math.abs(along) < car.length / 2 && Math.abs(side) < 1) inside++;
      }
    });
  }
  people.dispose(); city.dispose();
  return { inside, crossings };
}

describe('🚸 nobody walks through a vehicle on a zebra — on any seed', () => {
  for (const seed of [1, 3, 5, 6, 9]) {
    it(`seed ${seed}: no frame inside a vehicle's body, and people still cross`, () => {
      const r = run(seed);
      expect(r.inside).toBe(0);
      expect(r.crossings).toBeGreaterThan(8);
    }, 120_000);
  }
});
