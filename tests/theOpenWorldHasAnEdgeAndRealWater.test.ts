// THE OPEN WORLD HAS AN EDGE, AND ITS RIVERS ARE WATER (admin 2026-11-25, open-world problem #2: "map ki koi boundary nahi
// hai … bahut dur ja kar jameen me dhansne lagta hai").
//
// Two roots, both in play/openWorld.ts:
//   1. A loop world repeats every 100 km and had no edge, so the player walked away from every place for ever → a PLAY AREA:
//      a circle around the first place reaching past every place, land, venue and user map (+500 m, never under 1.5 km,
//      inside an island's shore); the player and the car it drives are stopped there and told.
//   2. Only the sea level reached the controller, so in a river or a lake the player walked down the carved bed under the
//      water — the "sinking" → the controller reads the map's own water (waterAt) where it stands and swims there.
// Runs the REAL generated kit with the real three.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-edge-water-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let EV: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const context = () => {
  const scene = new THREE.Scene();
  const player = new CH.CharacterController({});
  scene.add(player.object);
  const vehicles = { add: () => undefined, seated: null as THREE.Object3D | null };
  return { scene, player, vehicles, ctx: { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), player, vehicles } };
};
const small = { traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };
const regions = [
  { id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } },
  { id: 'old-town', kind: 'town', toward: 'east', city: small },
];

describe('🧱 the play area', () => {
  it('a circle around the start that holds every place, with open country to spare', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions });
    const a = world.playArea;
    expect(a).not.toBeNull();
    expect(a.r).toBeGreaterThanOrEqual(OW.PLAY_AREA_MIN);
    for (const p of world.places) expect(Math.hypot(p.centre.x - a.x, p.centre.z - a.z) + p.radius + OW.PLAY_AREA_MARGIN).toBeLessThanOrEqual(a.r + 1e-6);
    world.dispose();
  });
  it('🔴 walking past it stops the player AT the edge, and says so', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions });
    const hints: string[] = [];
    const off = EV.events.on('HINT', (p: any) => { if (p?.id === 'world-edge') hints.push(p.text); });
    const a = world.playArea;
    const origin = world.map.chunks.origin;
    // Put the player 200 m beyond the edge, due north, in RENDER metres.
    c.player.object.position.set(a.x - origin.x, c.player.object.position.y, a.z + a.r + 200 - origin.z);
    world.frame(c.ctx, 1 / 60);
    const at = world.playerWorld();
    expect(Math.hypot(at.x - a.x, at.z - a.z)).toBeLessThanOrEqual(a.r + 1e-6);
    expect(hints).toEqual(['This is the edge of the map — turn back.']);
    off(); world.dispose();
  });
  it('a car being driven is stopped with its driver', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions });
    const car = new THREE.Group(); c.scene.add(car); c.vehicles.seated = car;
    const a = world.playArea, origin = world.map.chunks.origin;
    car.position.set(a.x + a.r + 50 - origin.x, 0, a.z - origin.z);
    c.player.object.position.copy(car.position);
    world.frame(c.ctx, 1 / 60);
    expect(Math.hypot(car.position.x + world.map.chunks.origin.x - a.x, car.position.z + world.map.chunks.origin.z - a.z)).toBeLessThanOrEqual(a.r + 1e-6);
    world.dispose();
  });
  it('boundary: false opens it again; an island keeps it inside the shore', () => {
    const c = context();
    const open = OW.createOpenWorld(c.ctx, { seed: 7, regions, boundary: false });
    expect(open.playArea).toBeNull();
    open.dispose();
    const isl = OW.createOpenWorld(context().ctx, { seed: 7, regions, mode: 'bounded', sizeMeters: 4000 });
    expect(isl.playArea.r).toBeLessThanOrEqual(4000 / 2 - 150);
    isl.dispose();
  });
});

describe('🌊 rivers and lakes are water to the player', () => {
  it('the controller reads the map\'s own water: a lake\'s level over its basin, the sea below sea level, nothing on dry land', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions });
    const water = (c.player as any).water;
    expect(typeof water).toBe('function');
    const origin = world.map.chunks.origin;
    const lake = world.map.world.waterBodies().lakes[0];
    expect(lake).toBeTruthy();
    expect(water(lake.x - origin.x, lake.z - origin.z)).toBe(lake.level);
    expect(world.map.world.heightAt(lake.x, lake.z)).toBeLessThan(lake.level);       // the bed the player used to walk on
    const s = world.spawn;
    expect(world.map.world.waterAt(s.x, s.z)).toBeNull();
    expect(water(s.x - origin.x, s.z - origin.z)).toBeNull();
    world.dispose();
  });
});
