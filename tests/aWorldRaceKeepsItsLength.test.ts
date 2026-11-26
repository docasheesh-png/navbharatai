// 🏁 A WORLD RACE STAYS AS LONG AS IT WAS (admin decision 2026-11-26, after #4537: "keep races as long as before — the world race
// lays its course through more places / loops the highway graph until it reaches the race's intended length, never a stretched
// or fake distance").
//
// 🔑 THE CLASS: the race's length was whatever one chain of the world's highways happened to measure. When #4537 stood places
// close together (PLACE_GAP), a game's own compact world.ts gave a route of 0.8–1.4 km where the old spread gave 1.9–6.2 km
// (measured on the real kit before and after #4537, 2026-11-26: four places 1.9–3.4 km → 0.8–1.4 km, six places 5.4–6.2 km →
// 1.6–2.2 km), and the race finished at that short route's end. Now a route shorter than WORLD_RACE_MIN_METRES (or than the
// finishKm asked) becomes laps of the TOUR — every highway driven out and back from the start — so every metre counted is a
// metre of the world's own roads. Runs the REAL generated kit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { WORLD_COURSE, WORLD_COURSE_PATH, WORLD_RACE, WORLD_RACE_PATH } from '../src/server/lib/GameWorldCourseGenerator';

const DIR = join(__dirname, `.tmp-racelength-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let WR: any; let C: any; let CH: any; let OBJ: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  writeFileSync(join(DIR, WORLD_COURSE_PATH), WORLD_COURSE); writeFileSync(join(DIR, WORLD_RACE_PATH), WORLD_RACE);
  WR = await import(join(DIR, WORLD_RACE_PATH)); C = await import(join(DIR, WORLD_COURSE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts')); OBJ = await import(join(DIR, 'src/game/three/objects.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const q = { traffic: { count: 0 }, people: { count: 0 }, parkedCars: 0 };
// A game's own compact world.ts, the way the builder grows it: places added with no distance (they stand close since #4537).
const COMPACT: Record<string, any[]> = {
  fourMixed: [{ id: 'main-city', kind: 'city', city: q }, { id: 't', kind: 'town', city: q }, { id: 'v1', kind: 'village', city: q }, { id: 'v2', kind: 'village', city: q }],
  fourTownsToward: [{ id: 'a', kind: 'town', city: q }, { id: 'b', kind: 'town', toward: 'east', city: q }, { id: 'c', kind: 'town', toward: 'north', city: q }, { id: 'd', kind: 'town', toward: 'north-east', city: q }],
  sixMixed: [{ id: 'main-city', kind: 'city', city: q }, { id: 't1', kind: 'town', city: q }, { id: 't2', kind: 'town', city: q }, { id: 'v1', kind: 'village', city: q }, { id: 'v2', kind: 'village', city: q }, { id: 'v3', kind: 'village', city: q }],
};
// The old spread's routes on these same worlds (seeds 7 and 12345), measured on the kit before #4537: 1896 m to 6221 m.
const OLD_RANGE = { min: 1896, max: 6221 };
const make = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const ctx: any = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
  const car = OBJ.createCar({ detail: 'lite' }); scene.add(car);
  return { ctx, car };
};
/** How far a point is from the nearest highway segment (world metres). */
const offRoad = (p: { x: number; z: number }, highways: ReadonlyArray<ReadonlyArray<{ x: number; z: number }>>) => {
  let best = Infinity;
  for (const h of highways) for (let i = 1; i < h.length; i++) {
    const a = h[i - 1], b = h[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
};

describe('🏁 a race on a compact world is as long as the old spread gave it, on the world\'s own roads', () => {
  for (const [name, regions] of Object.entries(COMPACT)) for (const seed of [7, 12345]) {
    it(`${name} (seed ${seed}): at least ${2000} m, within the old range, every metre on a highway or inside a place`, () => {
      const { ctx, car } = make();
      const r = WR.startWorldRace(ctx, { car, regions, opponents: 0, seed });
      try {
        expect(r.course.length).toBeGreaterThanOrEqual(WR.WORLD_RACE_MIN_METRES);
        expect(r.course.length).toBeGreaterThanOrEqual(OLD_RANGE.min);
        expect(r.course.length).toBeLessThanOrEqual(OLD_RANGE.max);
        expect(r.course.finish ?? r.course.length).toBeCloseTo(r.course.length, 3);
        const hubs = [...r.world.places, ...r.world.lands];
        const line = r.course.line;
        for (let i = 0; i < line.length; i += 5) {
          const p = line[i];
          const inPlace = hubs.some((h: any) => Math.hypot(p.x - h.centre.x, p.z - h.centre.z) <= h.radius + 60);
          if (!inPlace) expect(offRoad(p, r.world.highways), `point ${i} of ${line.length} is ${Math.round(offRoad(p, r.world.highways))} m off every highway`).toBeLessThan(2);
        }
      } finally { r.dispose(); }
    }, 180_000);
  }

  it('the race\'s own default towns (distances named) keep exactly the route they had: one lap, no loop', () => {
    const { ctx, car } = make();
    const r = WR.startWorldRace(ctx, { car, opponents: 0, seed: 7 });
    try { expect(r.course.laps).toBe(1); expect(r.course.length).toBeGreaterThanOrEqual(2000); } finally { r.dispose(); }
  }, 180_000);

  it('a finishKm longer than the route is reached in laps of the roads (not cut at the route\'s end)', () => {
    const { ctx, car } = make();
    const r = WR.startWorldRace(ctx, { car, regions: COMPACT.fourMixed, opponents: 0, seed: 7, finishKm: 5 });
    try { expect(r.course.finish).toBe(5000); expect(r.course.length).toBeGreaterThanOrEqual(5000); expect(r.course.laps).toBeGreaterThan(1); } finally { r.dispose(); }
  }, 180_000);

  it('driving the looped course (out to every place and back, the car facing along the road): the distance never runs backwards and the race finishes', () => {
    const { ctx, car } = make();
    const r = WR.startWorldRace(ctx, { car, regions: COMPACT.fourTownsToward, opponents: 0, seed: 7 });
    try {
      expect(r.course.laps).toBeGreaterThan(1);
      for (let i = 0; i < 4 * 60; i++) r.update(ctx, 1 / 60);                                     // past the countdown
      let last = 0, standing: any = null;
      for (let d = 0; d <= r.course.length; d += 10) {
        const p = r.course.poseAt(Math.min(d, r.course.length));
        car.position.set(p.x, p.y, p.z); car.rotation.y = p.heading;
        const s = r.update(ctx, 1 / 60); standing = s.standing;
        expect(s.distance).toBeGreaterThanOrEqual(last - 0.5); last = s.distance;
      }
      const end = r.course.poseAt(r.course.length);
      car.position.set(end.x, end.y, end.z); car.rotation.y = end.heading;
      standing = r.update(ctx, 1 / 60).standing;
      expect(standing.phase).toBe('finished');
    } finally { r.dispose(); }
  }, 180_000);

  it('a world with too little highway says so honestly (not "it needs two places" when it has two)', () => {
    const { ctx, car } = make();
    const two = [{ id: 'main-city', kind: 'city', city: q }, { id: 'town', kind: 'town', city: q }];
    expect(() => WR.startWorldRace(ctx, { car, regions: two, seed: 7 })).toThrow(/m of highway between its places, too little to race on/);
  }, 180_000);
});

describe('🛣️ the tour itself (pure course geometry)', () => {
  const straight = (x0: number, z0: number, x1: number, z1: number, n = 5) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n }));
  // A hub at the origin with three highways out to three places (a tree, as the world's highways are).
  const hubs = [{ x: 0, z: 0, r: 20 }, { x: 300, z: 0, r: 20 }, { x: 0, z: 400, r: 20 }, { x: -200, z: 0, r: 20 }];
  const legs = [straight(20, 0, 280, 0), straight(0, 20, 0, 380), straight(-20, 0, -180, 0)];

  it('drives every highway out and back and ends where it began, with no straight link over open land', () => {
    const t = C.tourLegs(legs, { x: 0, z: 0 }, hubs);
    expect(t.gaps).toEqual([]);
    expect(C.pathLength(t.points)).toBeGreaterThanOrEqual(2 * (260 + 360 + 160));
    expect(Math.hypot(t.points[0].x - t.points[t.points.length - 1].x, t.points[0].z - t.points[t.points.length - 1].z)).toBeLessThan(60);
  });

  it('a short route becomes whole laps up to minLength; a long enough one is left exactly as it was', () => {
    const c = C.createWorldCourse({ legs, hubs, start: { x: 0, z: 0 }, minLength: 4000 });
    expect(c.laps).toBeGreaterThan(1);
    expect(c.length).toBeGreaterThanOrEqual(4000);
    const plain = C.createWorldCourse({ legs, hubs, start: { x: 0, z: 0 } });
    expect(plain.laps).toBe(1);
    expect(C.createWorldCourse({ legs, hubs, start: { x: 0, z: 0 }, minLength: 100 }).length).toBeCloseTo(plain.length, 6);
    expect(C.createWorldCourse({ legs, hubs, minLength: 1e9 }).length).toBeLessThanOrEqual(C.MAX_COURSE_METRES + 3000);
  });

  it('a chain that had to jump between roads in a straight line over open land is replaced by the tour (every metre on a road)', () => {
    const longHubs = [{ x: 0, z: 0, r: 20 }, { x: 640, z: 0, r: 20 }, { x: 0, z: 640, r: 20 }, { x: -640, z: 0, r: 20 }];
    const spokes = [straight(20, 0, 620, 0), straight(0, 20, 0, 620), straight(-20, 0, -620, 0)];
    expect(C.chainLegs(spokes, { x: 0, z: 0 }).gaps.length).toBeGreaterThan(0);       // the old chain: far end → back to the hub
    const c = C.createWorldCourse({ legs: spokes, hubs: longHubs, start: { x: 0, z: 0 } });
    expect(c.gaps).toEqual([]);
    expect(c.laps).toBe(1);
    // Two roads that never meet stay a chain with its link said in gaps (the tour could not reach the second one).
    expect(C.createWorldCourse({ legs: [straight(0, 0, 1000, 0), straight(1600, 0, 2600, 0)] }).gaps).toEqual([600]);
  });

  it('at the end of a road the car turns round: driving back (no heading known) the distance keeps growing', () => {
    const c = C.createWorldCourse({ legs: [straight(0, 0, 200, 0)], hubs: [{ x: -30, z: 0, r: 20 }, { x: 230, z: 0, r: 20 }], start: { x: 0, z: 0 }, minLength: 400 });
    let last = 0;
    for (let d = 0; d <= c.length; d += 0.5) {
      const p = c.poseAt(Math.min(d, c.length));
      const s = c.update({ position: { x: p.x, z: p.z } });
      expect(s.distance).toBeGreaterThanOrEqual(last - 0.6); last = s.distance;
    }
    expect(last).toBeGreaterThan(c.length - 2);
  });
});
