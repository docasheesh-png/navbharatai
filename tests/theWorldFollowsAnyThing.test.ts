// THE WORLD LAYER FOLLOWS ANY THING (map expansion plan, item 5). The big map — terrain, places, lands, highways, the floating
// origin — was welded to the player on foot (ctx.player): a racing or sports game could not stand on it, because its car or
// its camera is what moves. createWorldLayer (src/game/play/worldLayer.ts) is the same world following whatever the game
// says. The open-world bridge itself is not changed, so every open-world game stays exactly what it was; with nothing to
// follow, the layer IS the open world, frame for frame.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH, generateOpenWorld, GAME_OPEN_WORLD_BRIDGE } from '../src/server/lib/GameOpenWorldGenerator';
import { WORLD_LAYER_PATH, GAME_WORLD_LAYER } from '../src/server/lib/GameWorldLayerGenerator';

const DIR = join(__dirname, `.tmp-worldlayer-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let WL: any; let CH: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  WL = await import(join(DIR, WORLD_LAYER_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500); scene.add(camera);
  return { scene, player, camera, vehicles: { add: () => {}, seated: null } } as any;
};
const tiny = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 1 };
const regions = [{ id: 'home', kind: 'city', city: tiny }, { id: 'east-town', kind: 'town', toward: 'east', city: tiny }, { id: 'sands', kind: 'desert', toward: 'north' }];
/** A thing's WORLD place: its render place plus the origin. */
const worldOf = (world: any, o: THREE.Object3D) => ({ x: o.position.x + world.map.chunks.origin.x, z: o.position.z + world.map.chunks.origin.z });
/** Drive a thing in a straight line, a frame at a time, in WORLD metres (a game moving its car). */
const drive = (world: any, c: any, o: THREE.Object3D, to: { x: number; z: number }, steps: number) => {
  const from = worldOf(world, o);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps, z = from.z + ((to.z - from.z) * i) / steps;
    o.position.x = x - world.map.chunks.origin.x; o.position.z = z - world.map.chunks.origin.z; o.position.y = world.heightAt(x, z) + 0.5;
    world.frame(c, 0.016);
  }
};

describe('🌍 the world layer ships beside the open world, which is unchanged', () => {
  it('the open-world recipe writes the layer too; the bridge and the starter are the same text, and neither reads the layer', () => {
    const files = generateOpenWorld().files;
    expect(files[WORLD_LAYER_PATH]).toBe(GAME_WORLD_LAYER);
    expect(files[OPEN_WORLD_BRIDGE_PATH]).toBe(GAME_OPEN_WORLD_BRIDGE);
    for (const [path, text] of Object.entries(files)) if (path !== WORLD_LAYER_PATH) expect(text).not.toMatch(/worldLayer/);
    expect(GAME_WORLD_LAYER).toMatch(/import \{ createOpenWorld, type OpenWorld, type OpenWorldOptions \} from '\.\/openWorld';/);
  });
});

describe('🌍 nothing to follow: the layer IS the open world', () => {
  it('the same places, start and player, and frame for frame the same origin and player across a long walk', () => {
    const a = context(), b = context();
    const plain = OW.createOpenWorld(a, { seed: 7, quality: 'phone', regions });
    const layer = WL.createWorldLayer(b, { seed: 7, quality: 'phone', regions });
    expect(layer.places).toEqual(plain.places);
    expect(layer.lands).toEqual(plain.lands);
    expect(layer.highways).toEqual(plain.highways);
    expect(layer.spawn).toEqual(plain.spawn);
    expect(layer.target).toBe(b.player.object);
    expect(b.player.object.position.toArray()).toEqual(a.player.object.position.toArray());
    const to = { x: plain.spawn.x + 7000, z: plain.spawn.z - 2000 };
    drive(plain, a, a.player.object, to, 40); drive(layer, b, b.player.object, to, 40);
    expect(layer.map.chunks.origin).toEqual(plain.map.chunks.origin);
    expect(b.player.object.position.toArray()).toEqual(a.player.object.position.toArray());
    expect(b.camera.position.toArray()).toEqual(a.camera.position.toArray());
    expect(layer.regions.map((r: any) => r.id)).toEqual(plain.regions.map((r: any) => r.id));
    plain.dispose(); layer.dispose();
  }, 180_000);
});

describe('🚗 following a car', () => {
  it('starts the car on the first place\'s street; the land streams around it; origin shifts move the car, camera, player and carried things together', () => {
    const c = context();
    const car = new THREE.Group(); c.scene.add(car);
    const sign = new THREE.Object3D(); c.scene.add(sign);
    const layer = WL.createWorldLayer(c, { seed: 7, quality: 'phone', regions, follow: car, carry: [sign] });
    expect(layer.target).toBe(car);
    const start = worldOf(layer, car);
    expect(start.x).toBeCloseTo(layer.spawn.x, 6); expect(start.z).toBeCloseTo(layer.spawn.z, 6);
    sign.position.set(start.x + 30 - layer.map.chunks.origin.x, 0, start.z - layer.map.chunks.origin.z);
    const playerAt = worldOf(layer, c.player.object), signAt = worldOf(layer, sign);
    c.camera.position.set(car.position.x, 10, car.position.z + 12);
    const camAt = worldOf(layer, c.camera);
    const to = { x: start.x + 9000, z: start.z + 1500 };
    drive(layer, c, car, to, 60);
    expect(layer.map.chunks.origin.x).not.toBe(0);                                         // the origin moved on
    const end = worldOf(layer, car);
    expect(end.x).toBeCloseTo(to.x, 3); expect(end.z).toBeCloseTo(to.z, 3);
    expect(Math.hypot(car.position.x, car.position.z)).toBeLessThan(4000);                 // drawn near the origin, never far out
    expect(layer.playerWorld().x).toBeCloseTo(to.x, 3);                                    // the world streams around the car
    const p = worldOf(layer, c.player.object), s = worldOf(layer, sign);
    expect(p.x).toBeCloseTo(playerAt.x, 6); expect(p.z).toBeCloseTo(playerAt.z, 6);        // the player on foot stayed where it was
    expect(s.x).toBeCloseTo(signAt.x, 6); expect(s.z).toBeCloseTo(signAt.z, 6);            // so did a carried thing
    const cam = worldOf(layer, c.camera);                                                   // the camera (left still by this test)
    expect(cam.x).toBeCloseTo(camAt.x, 6); expect(cam.z).toBeCloseTo(camAt.z, 6);            // moved back once per shift, never twice
    layer.dispose();
  }, 180_000);
  it('a place is built when the CAR comes near it, not the player', () => {
    const c = context();
    const car = new THREE.Group(); c.scene.add(car);
    const layer = WL.createWorldLayer(c, { seed: 7, quality: 'phone', regions, follow: car });
    const town = layer.places.find((p: any) => p.id === 'east-town');
    expect(town.built).toBe(false);
    drive(layer, c, car, town.centre, 30);
    for (let f = 0; f < 3; f++) layer.frame(c, 0.016);
    expect(town.built).toBe(true);
    layer.dispose();
  }, 180_000);
  it('placeAtSpawn: false keeps the car where the game put it (its WORLD place)', () => {
    const c = context();
    const car = new THREE.Group(); car.position.set(1234, 5, -567); c.scene.add(car);
    const layer = WL.createWorldLayer(c, { seed: 7, quality: 'phone', regions, follow: car, placeAtSpawn: false });
    const at = worldOf(layer, car);
    expect(at.x).toBeCloseTo(1234, 6); expect(at.z).toBeCloseTo(-567, 6);
    layer.dispose();
  }, 180_000);
  it('follow() switches from the car back to the player; a follow function is asked each frame', () => {
    const c = context();
    const car = new THREE.Group(); c.scene.add(car);
    let inCar = true;
    const layer = WL.createWorldLayer(c, { seed: 7, quality: 'phone', regions, follow: () => (inCar ? car : null) });
    expect(layer.target).toBe(car);
    inCar = false; layer.frame(c, 0.016);
    expect(layer.target).toBe(c.player.object);
    layer.follow(car);
    expect(layer.target).toBe(car);
    layer.dispose();
  }, 180_000);
});

describe('🎥 following the camera', () => {
  it('the camera is moved once per origin shift (never twice), and keeps the world\'s far plane', () => {
    const c = context();
    const layer = WL.createWorldLayer(c, { seed: 7, quality: 'phone', regions, follow: c.camera });
    expect(c.camera.far).toBe(9000); expect(c.camera.near).toBe(0.3);
    const start = worldOf(layer, c.camera);
    const to = { x: start.x - 8000, z: start.z + 3000 };
    drive(layer, c, c.camera, to, 50);
    const end = worldOf(layer, c.camera);
    expect(layer.map.chunks.origin.x).not.toBe(0);
    expect(end.x).toBeCloseTo(to.x, 3); expect(end.z).toBeCloseTo(to.z, 3);
    layer.dispose();
  }, 180_000);
});
