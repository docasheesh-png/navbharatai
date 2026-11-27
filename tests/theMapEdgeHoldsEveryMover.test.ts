/**
 * 🧱🌊 Admin 2026-11-27: "frame → natural boundary nobody can cross → water … → ground sheet nobody can fall through". Runs the
 * REAL open world (play/openWorld.ts) on the REAL Athree map with a natural edge: the player, the car it drives and every bounded
 * character are held inside the ring, a car is held out of water too deep to ford (never on the sea bed), and a body found
 * under the ground is put back on the surface. Each claim is a measurement after world.frame(), the call every game makes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-map-edge-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let AT: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  AT = await import(join(DIR, 'src/game/athree/index.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null as THREE.Object3D | null } };
};
const open = (c: any, boundary: string) => OW.createOpenWorld(c, { seed: 4, vegetation: false, mode: 'bounded', sizeMeters: 4000, naturalEdge: boundary });
const worldOf = (o: THREE.Object3D, origin: { x: number; z: number }) => ({ x: o.position.x + origin.x, z: o.position.z + origin.z });

describe('🧱 the natural edge holds the player, its car and every bounded character', () => {
  it('the guard is the emitted one (athree/movers.ts) and the map has the edge asked for', () => {
    expect(typeof AT.createMoverGuard).toBe('function');
    const c = context();
    const world = open(c, 'mountains');
    expect(world.map.world.boundary.kind).toBe('mountains');
    world.dispose();
  }, 120_000);

  for (const kind of ['mountains', 'canyon', 'forest-river', 'dunes', 'wall', 'sea']) {
    it(`${kind}: a walker, a car and a bot pushed past the edge are inside after the next frame`, () => {
      const c = context();
      const world = open(c, kind);
      world.frame(c, 1 / 60);
      const o = world.map.chunks.origin;
      const edge = world.map.world.boundary;
      // The walker, far outside.
      c.player.object.position.set(5000 - o.x, 40, 300 - o.z);
      world.frame(c, 1 / 60);
      let p = worldOf(c.player.object, world.map.chunks.origin);
      expect(edge.inside(p.x, p.z), kind + ' walker').toBe(true);
      // A bounded bot (an Entities enemy) far outside on the other side.
      const bot = new THREE.Group(); bot.name = 'enemy'; bot.userData.bounded = true; c.scene.add(bot);
      bot.position.set(-6000 - world.map.chunks.origin.x, 20, -200 - world.map.chunks.origin.z);
      world.frame(c, 1 / 60);
      p = worldOf(bot, world.map.chunks.origin);
      expect(edge.inside(p.x, p.z), kind + ' bot').toBe(true);
      // The car the player drives.
      const car = new THREE.Group(); car.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 2.6))); c.scene.add(car);
      c.vehicles.seated = car;
      car.position.set(200 - world.map.chunks.origin.x, 30, 7000 - world.map.chunks.origin.z);
      world.frame(c, 1 / 60);
      p = worldOf(car, world.map.chunks.origin);
      expect(edge.inside(p.x, p.z), kind + ' car').toBe(true);
      world.dispose();
    }, 120_000);
  }
});

describe('🌊 water and the ground sheet', () => {
  it('a car driven into deep water is held where it can still ford — never on the sea bed', () => {
    const c = context();
    // The play-area wall (boundary: false here) would otherwise stop the car before the water: the guard alone is measured.
    const world = OW.createOpenWorld(c, { seed: 4, vegetation: false, mode: 'bounded', sizeMeters: 4000, naturalEdge: 'sea', boundary: false });
    world.frame(c, 1 / 60);
    const w = world.map.world;
    // Along a ray: the outermost shore, then a car driven out from the beach a few metres a frame.
    const a = 0.9;
    let r = w.boundary.limitAt(a);
    while (w.heightAt(Math.cos(a) * r, Math.sin(a) * r) < 0) r -= 5;
    const car = new THREE.Group(); car.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 2.6))); c.scene.add(car);
    c.vehicles.seated = car;
    let held = 0;
    for (let d = r - 40; d < r + 400; d += 4) {
      const o = world.map.chunks.origin;
      const now = worldOf(car, o), at = Math.max(d, Math.hypot(now.x, now.z) + 4);
      car.position.set(Math.cos(a) * at - o.x, w.drivableHeightAt(Math.cos(a) * at, Math.sin(a) * at), Math.sin(a) * at - o.z);
      const before = car.position.clone();
      world.frame(c, 1 / 60);
      if (car.position.distanceTo(before) > 0.5) held++;
      const p = worldOf(car, world.map.chunks.origin);
      expect(AT.waterDepthAt(w, p.x, p.z).depth).toBeLessThanOrEqual(AT.FORD_DEPTH + 1e-6);
    }
    expect(held).toBeGreaterThan(10);
    world.dispose();
  }, 120_000);

  it('a bounded character found under the ground is put back on the surface (the safety net)', () => {
    const c = context();
    const world = open(c, 'mountains');
    world.frame(c, 1 / 60);
    const w = world.map.world;
    const bot = new THREE.Group(); bot.name = 'villager'; bot.userData.bounded = true; c.scene.add(bot);
    const o = world.map.chunks.origin;
    const s = w.spawnPoints('player', 1)[0];
    bot.position.set(s.x - o.x, w.heightAt(s.x, s.z), s.z - o.z);
    world.frame(c, 1 / 60);
    const o2 = world.map.chunks.origin;
    bot.position.set(s.x + 20 - o2.x, w.heightAt(s.x + 20, s.z) - 10, s.z - o2.z);
    world.frame(c, 1 / 60);
    const p = worldOf(bot, world.map.chunks.origin);
    expect(p.x).toBeCloseTo(s.x, 6); expect(p.z).toBeCloseTo(s.z, 6);
    expect(bot.position.y).toBeGreaterThanOrEqual(w.heightAt(s.x, s.z) - 1e-6);
    world.dispose();
  }, 120_000);
});
