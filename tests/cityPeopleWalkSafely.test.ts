// PEOPLE WALK THE CITY SAFELY (admin 2026-11-21 plan: "people walking in the city"). Runs the REAL generated
// three/citypeople.ts with REAL city traffic on a REAL city grid, and checks every frame of two minutes: nobody on the
// road except on a zebra, nobody on a zebra unless the cars on that street have red, no car near anyone crossing — and
// people really do cross, keep moving, stop for the player, and the whole crowd is two meshes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D, GAME_3D_MODULES } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-city-people-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let T: any; let P: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame3D(['citypeople', 'citytraffic']).files)) {
    mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c);
  }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  T = await import(join(DIR, 'src/game/three/citytraffic.ts'));
  P = await import(join(DIR, 'src/game/three/citypeople.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function setup(opts: { cars?: number; people?: number; traffic?: boolean } = {}) {
  const city = C.createCity({ blocksX: 3, blocksZ: 3, seed: 2 });
  const traffic = opts.traffic === false ? null : T.createCityTraffic(city, { count: opts.cars ?? 20, seed: 4 });
  const people = P.createCityPeople(city, { count: opts.people ?? 40, traffic, seed: 6, crossChance: 0.6 });
  return { city, plan: city.plan, traffic, people };
}

describe('🚶 people in the city', () => {
  it('ships in the 3D kit, brings the city with it, and draws the whole crowd in two meshes', () => {
    expect(GAME_3D_MODULES).toContain('citypeople');
    expect(Object.keys(generateGame3D(['citypeople']).files)).toEqual(expect.arrayContaining(['src/game/three/citypeople.ts', 'src/game/three/city.ts', 'src/game/three/collision.ts']));
    const { people } = setup({ people: 100 });
    let meshes = 0;
    people.root.traverse((o: any) => { if (o.isMesh) meshes++; });
    expect(meshes).toBe(2);
  });

  it('the pavement loop: corners in order, and a point maps back to its place on the loop', () => {
    const { plan } = setup();
    const L = P.pavementLoop(plan, 1, 1);
    expect(P.pointOnLoop(plan, 1, 1, 0)).toEqual({ x: L.x0, z: L.z0 });
    expect(P.pointOnLoop(plan, 1, 1, L.w)).toEqual({ x: L.x1, z: L.z0 });
    expect(P.pointOnLoop(plan, 1, 1, L.w + L.h)).toEqual({ x: L.x1, z: L.z1 });
    for (const s of [3, L.w + 5, L.w + L.h + 7, 2 * L.w + L.h + 2]) {
      const p = P.pointOnLoop(plan, 1, 1, s);
      expect(P.loopPosition(plan, 1, 1, p.x, p.z)).toBeCloseTo(s, 6);
      expect(C.onStreet(plan, p.x, p.z)).toBe(false);   // the loop is on the pavement
    }
    // A corner on the city's edge has no block beyond it to cross to.
    expect(P.crossingsAt(plan, 0, 0, -1, -1)).toEqual([]);
    expect(P.crossingsAt(plan, 1, 1, 1, 1).length).toBe(2);
  });

  it('two minutes with traffic: never on the road except a zebra, never on a zebra unless the cars have red, no car near a crossing walker; people do cross and keep moving', () => {
    const { plan, traffic, people } = setup();
    const travelled = people.walkers.map(() => 0);
    let offZebra = 0, onGreen = 0, carNear = 0, crossings = 0;
    const zebraFrom = plan.road / 2 + C.CITY_ZEBRA.gap - 0.3, zebraTo = plan.road / 2 + C.CITY_ZEBRA.gap + C.CITY_ZEBRA.depth + 0.3;
    const p = new THREE.Vector3();
    const wasCrossing = people.walkers.map(() => false);
    for (let f = 0; f < 120 * 30; f++) {
      const prev = people.walkers.map((w: any) => [w.x, w.z]);
      people.update(1 / 30);
      traffic.update(1 / 30, people.bodies);
      people.walkers.forEach((w: any, k: number) => {
        travelled[k] += Math.hypot(w.x - prev[k][0], w.z - prev[k][1]);
        if (w.state === 'cross' && !wasCrossing[k]) crossings++;
        wasCrossing[k] = w.state === 'cross';
        if (!C.onStreet(plan, w.x, w.z)) return;
        // On the road: it must be crossing, on the zebra band of its crossing's arm, with the cars' light red.
        const c = w.crossing;
        if (w.state !== 'cross' || !c) { offZebra++; return; }
        const nx = plan.streetsX[c.node[0]], nz = plan.streetsZ[c.node[1]];
        const along = c.axis === 'z' ? Math.abs(w.z - nz) : Math.abs(w.x - nx);
        if (along < zebraFrom || along > zebraTo) offZebra++;
        if (traffic.lightAt(c.node[0], c.node[1], c.axis) !== 'red') onGreen++;
        for (const car of traffic.cars) { car.object.getWorldPosition(p); if (Math.hypot(p.x - w.x, p.z - w.z) < 2) carNear++; }
      });
    }
    expect({ offZebra, onGreen, carNear }).toEqual({ offZebra: 0, onGreen: 0, carNear: 0 });
    expect(crossings).toBeGreaterThan(10);
    expect(Math.min(...travelled)).toBeGreaterThan(30);
  });

  it('a person stops for the player in their way, and walks on when the player steps aside', () => {
    const { people, plan } = setup({ people: 1, traffic: false });
    const w = people.walkers[0];
    w.crossChance = 0;
    const ahead = P.pointOnLoop(plan, w.block[0], w.block[1], w.s + w.dir * 0.8);
    const player = new THREE.Object3D(); player.position.set(ahead.x, 0, ahead.z);
    const before = [w.x, w.z];
    for (let f = 0; f < 60; f++) people.update(1 / 30, [player]);
    expect(Math.hypot(w.x - before[0], w.z - before[1])).toBeLessThan(0.5);
    player.position.set(1e4, 0, 1e4);
    for (let f = 0; f < 60; f++) people.update(1 / 30, [player]);
    expect(Math.hypot(w.x - before[0], w.z - before[1])).toBeGreaterThan(1);
  });

  it('without traffic people still only cross on the zebras; dispose takes them away', () => {
    const { plan, people } = setup({ traffic: false });
    let offZebra = 0;
    for (let f = 0; f < 60 * 30; f++) {
      people.update(1 / 30);
      for (const w of people.walkers) if (C.onStreet(plan, w.x, w.z) && w.state !== 'cross') offZebra++;
    }
    expect(offZebra).toBe(0);
    const scene = new THREE.Scene(); scene.add(people.root);
    people.dispose();
    expect(people.root.parent).toBeNull();
  });
});
