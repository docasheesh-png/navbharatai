// 🏘️ A COLONY HAS PEOPLE AND TRAFFIC (Q-3762, the second honest limit of #4627: "no people or traffic in colonies — the kit's city people
// and traffic are bound to the three/city grid"). These run the REAL emitted kit: the game kit's citytraffic.ts (createRoadTraffic, the
// same fleet and rules as a city's) and citypeople.ts (createPathPeople, the same crowd) on athree's planned roads and colony footpaths.
// Each claim is measured on every step of a minute of simulated time: vehicles stay on the paved road in the LEFT lane, never in a plot or
// water; people stay on the footpaths, never on a road, in a plot or in water; both live only near the camera and never past their cap;
// and the open-world bridge gives a colony map both, inside the device's actor share.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { mapOptionsFor } from '../src/server/lib/athreeMap/athreeMapKinds';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { STREAM_ACTORS } from '../src/server/lib/GameWorldStreamingGenerator';

const DIR = join(__dirname, `.tmp-colony-life-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let A: any; let T: any; let P: any; let OW: any; let CH: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  A = await import(join(DIR, 'src/game/athree/index.ts'));
  T = await import(join(DIR, 'src/game/three/citytraffic.ts'));
  P = await import(join(DIR, 'src/game/three/citypeople.ts'));
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 180_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const TOWN = { seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: 'grid', density: 'normal' };
let worldCache: any = null;
const town = (): any => (worldCache ??= A.createAthreeWorld(TOWN));
/** The middle point of every planned road (what the open-world bridge hands createRoadTraffic). */
const targetsOf = (roads: any): Array<{ x: number; z: number }> => roads.home().roads.filter((r: any) => r.planned && r.points.length > 2).map((r: any) => r.points[Math.floor(r.points.length / 2)]);

/** The direction the road runs (first point to last) at a hit, to read which side of it a vehicle is on. */
function roadDir(world: any, hit: any): { x: number; z: number } {
  const road = world.roadNetwork().home().roads.find((r: any) => r.id === hit.road);
  const pts = road.points;
  let i = 1;
  while (i < pts.length - 1 && (pts[i].s ?? 0) < hit.along) i++;
  const dx = pts[i].x - pts[i - 1].x, dz = pts[i].z - pts[i - 1].z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

describe('🚗 traffic drives the colony roads', () => {
  it('a minute of traffic: on the paved road, in the LEFT lane, never in a plot or water; never past its count; only near the camera', () => {
    const world = town();
    const roads = world.roadNetwork();
    const traffic = T.createRoadTraffic({ targets: targetsOf(roads), route: (a: any, b: any) => roads.route(a, b), junctions: roads.home().junctions }, { count: 14, tier: 'full', radius: 260, seed: 3 });
    const scene = new THREE.Scene(); scene.add(traffic.root);
    const plots = world.colonies().plots;
    const cam = { x: plots[Math.floor(plots.length / 2)].x, z: plots[Math.floor(plots.length / 2)].z };
    let samples = 0, left = 0, sided = 0, moved = 0, maxLive = 0;
    const startAt = new Map<any, { x: number; z: number }>();
    for (let step = 0; step < 60 * 30; step++) {
      traffic.update(1 / 30, cam, []);
      maxLive = Math.max(maxLive, traffic.cars.length);
      for (const c of traffic.cars) {
        samples++;
        const hit = world.roadAt(c.x, c.z);
        if (!hit && process.env.COLONY_DEBUG) { const js = roads.home().junctions.map((j: any) => [Math.hypot(j.x - c.x, j.z - c.z) - j.radius, j.island, j.radius]).sort((a: any, b: any) => a[0] - b[0])[0]; let best = 1e9; for (const r of roads.home().roads) for (const q of r.points) best = Math.min(best, Math.hypot(q.x - c.x, q.z - c.z) - q.width / 2); console.log('OFF', c.along, c.path.length, 'junction', js, 'road', best, c.kind); }
        expect(hit, `vehicle at ${c.x.toFixed(1)},${c.z.toFixed(1)} is on the paved road`).not.toBeNull();
        expect(world.colonyAt(c.x, c.z), 'never in a plot').toBeNull();
        expect(world.waterAt(c.x, c.z), 'never in water').toBeNull();
        expect(Math.hypot(c.x - cam.x, c.z - cam.z)).toBeLessThanOrEqual(260 * 1.3 + 15);
        if (!startAt.has(c)) startAt.set(c, { x: c.x, z: c.z });
        if (hit.junction === undefined && Math.abs(hit.across) > 0.4) {
          const e = roadDir(world, hit);
          const d = { x: Math.sin(c.heading), z: Math.cos(c.heading) };
          const along = d.x * e.x + d.z * e.z;
          if (Math.abs(along) > 0.7) { sided++; if (Math.sign(hit.across) * Math.sign(along) < 0) left++; }
        }
      }
    }
    for (const [c, s] of startAt) if (Math.hypot(c.x - s.x, c.z - s.z) > 30) moved++;
    expect(samples).toBeGreaterThan(1000);
    expect(maxLive).toBeLessThanOrEqual(14);
    expect(maxLive).toBeGreaterThanOrEqual(6);
    expect(moved, 'the traffic really drives').toBeGreaterThan(4);
    expect(left / sided, `kept left on ${left} of ${sided} samples`).toBeGreaterThan(0.98);
    // Away from the colonies: the vehicles left behind are taken off and new ones start near the new camera.
    const far = { x: cam.x + 700, z: cam.z + 300 };
    for (let step = 0; step < 90; step++) traffic.update(1 / 30, far, []);
    for (const c of traffic.cars) expect(Math.hypot(c.x - far.x, c.z - far.z)).toBeLessThanOrEqual(260 * 1.3 + 15);
    traffic.dispose();
  });

  it('a vehicle stops for the player in its lane, and the player is pushed out of a vehicle', () => {
    const world = town();
    const roads = world.roadNetwork();
    const traffic = T.createRoadTraffic({ targets: targetsOf(roads), route: (a: any, b: any) => roads.route(a, b), junctions: roads.home().junctions }, { count: 1, tier: 'full', seed: 9 });
    const scene = new THREE.Scene(); scene.add(traffic.root);
    const plots = world.colonies().plots;
    const cam = { x: plots[0].x, z: plots[0].z };
    for (let i = 0; i < 30 && !traffic.cars.length; i++) traffic.update(1 / 30, cam, []);
    const car = traffic.cars[0];
    expect(car).toBeTruthy();
    const player = new THREE.Object3D(); scene.add(player);
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    player.position.set(car.x + fx * 9, car.y, car.z + fz * 9);
    for (let i = 0; i < 120; i++) traffic.update(1 / 30, cam, [player]);
    const gap = (player.position.x - car.x) * fx + (player.position.z - car.z) * fz;
    expect(gap, 'it stopped short of the player').toBeGreaterThan(car.length / 2);
    player.position.set(car.x, car.y, car.z);
    expect(traffic.pushOut(player, 0.45)).toBe(true);
    traffic.dispose();
  });
});

describe('🚶 people walk the colony footpaths', () => {
  it('a minute of walking: on the footpaths, never on a road, in a plot or water; never past the count; only near the camera', () => {
    const world = town();
    const paths = world.colonyFootpaths();
    expect(paths.length).toBeGreaterThan(20);
    // Every point of every footpath is off the roads, out of the plots and dry.
    for (const p of paths) for (const q of p.points) {
      expect(world.roadAt(q.x, q.z)).toBeNull();
      expect(world.colonyAt(q.x, q.z)).toBeNull();
      expect(world.waterAt(q.x, q.z)).toBeNull();
    }
    const people = P.createPathPeople({ paths, heightAt: (x: number, z: number) => world.heightAt(x, z) }, { count: 30, tier: 'full', radius: 160, seed: 4 });
    const scene = new THREE.Scene(); scene.add(people.root);
    const plots = world.colonies().plots;
    const cam = { x: plots[Math.floor(plots.length / 3)].x, z: plots[Math.floor(plots.length / 3)].z };
    let maxLive = 0, samples = 0;
    for (let step = 0; step < 60 * 20; step++) {
      people.update(1 / 20, cam, []);
      maxLive = Math.max(maxLive, people.walkers.length);
      for (const w of people.walkers) {
        samples++;
        expect(world.roadAt(w.x, w.z), 'never on a road').toBeNull();
        expect(world.colonyAt(w.x, w.z), 'never in a plot').toBeNull();
        expect(world.waterAt(w.x, w.z), 'never in water').toBeNull();
        expect(Math.abs(w.y - world.heightAt(w.x, w.z))).toBeLessThan(1e-6);
        expect(Math.hypot(w.x - cam.x, w.z - cam.z)).toBeLessThanOrEqual(160 * 1.3 + 3);
      }
    }
    expect(samples).toBeGreaterThan(5000);
    expect(maxLive).toBeLessThanOrEqual(30);
    expect(maxLive).toBeGreaterThanOrEqual(20);
    expect(people.root.children.every((m: any) => !m.isInstancedMesh || m.count === people.walkers.length)).toBe(true);
    people.dispose();
  });

  it('the light tier holds its cap (LIGHT_PEOPLE, LIGHT_TRAFFIC) whatever count is asked', () => {
    const world = town();
    const roads = world.roadNetwork();
    const people = P.createPathPeople({ paths: world.colonyFootpaths(), heightAt: (x: number, z: number) => world.heightAt(x, z) }, { count: 150, tier: 'light' });
    const traffic = T.createRoadTraffic({ targets: targetsOf(roads), route: (a: any, b: any) => roads.route(a, b) }, { count: 60, tier: 'light' });
    const p0 = world.colonies().plots[0];
    for (let i = 0; i < 200; i++) { people.update(1 / 20, p0, []); traffic.update(1 / 20, p0, []); }
    expect(people.walkers.length).toBeLessThanOrEqual(P.LIGHT_PEOPLE);
    expect(traffic.cars.length).toBeLessThanOrEqual(T.LIGHT_TRAFFIC);
    people.dispose(); traffic.dispose();
  });
});

describe('🌍 the open world gives a colony map its people and traffic, inside the device\'s actor share', () => {
  it('createOpenWorld on a colony map has colony traffic and people near the player, never past COLONY_ACTORS', () => {
    const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
    const ctx = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
    const world = OW.createOpenWorld(ctx, { ...TOWN, quality: 'mid' });
    expect(world.colonyLife.traffic).not.toBeNull();
    expect(world.colonyLife.people).not.toBeNull();
    expect(OW.COLONY_ACTORS).toEqual(STREAM_ACTORS);
    const share = OW.COLONY_ACTORS.mid;
    for (let i = 0; i < 240; i++) world.frame(ctx, 1 / 30);
    expect(world.colonyLife.traffic.cars.length).toBeGreaterThan(0);
    expect(world.colonyLife.people.walkers.length).toBeGreaterThan(0);
    expect(world.colonyLife.traffic.cars.length + world.colonyLife.people.walkers.length).toBeLessThanOrEqual(share + Math.floor(share / 2));
    expect(world.colonyLife.people.walkers.length).toBeLessThanOrEqual(share);
    world.dispose();
  });
});
