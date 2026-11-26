/**
 * 🚗 Admin 2026-11-26 list #7/#8/#11: "cities ke beech car zameen me dhas jati hai … car hawa me". The big map never told
 * the kit where its ground was, so getGround() was null on the open world: settleOnGround (every driven car) and groundScene
 * (the shell's per-frame "nothing sinks") returned at once, and a car kept whatever height it had while the hills between
 * the places rose and fell under it. Runs the REAL open world on the REAL Athree map.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-car-ground-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let SU: any; let OB: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  SU = await import(join(DIR, 'src/game/three/surfaces.ts'));
  OB = await import(join(DIR, 'src/game/three/objects.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};

describe('🚗 a car follows the open world\'s ground, between the places too', () => {
  it('the kit\'s ground IS the map\'s height (render metres through the floating origin), and is cleared on dispose', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, vegetation: false });
    world.frame(c, 1 / 60);
    const g = SU.getGround();
    expect(g).toBeTruthy();
    const o = world.map.chunks.origin;
    for (const [wx, wz] of [[0, 0], [400, -250], [-900, 700], [1500, 1500]]) {
      expect(g(wx - o.x, wz - o.z)).toBeCloseTo(world.map.world.heightAt(wx, wz), 6);
    }
    world.dispose();
    expect(SU.getGround()).toBeNull();
  }, 120_000);

  it('a car on a hillside away from every place is put on the ground, not left sunk or floating', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, vegetation: false });
    world.frame(c, 1 / 60);
    const o = world.map.chunks.origin;
    // A slope: two points 6 m apart whose heights differ.
    let spot: { x: number; z: number } | null = null;
    for (let k = 0; k < 400 && !spot; k++) {
      const x = 300 + k * 13, z = -200 + k * 7;
      if (Math.abs(world.map.world.heightAt(x + 3, z) - world.map.world.heightAt(x - 3, z)) > 0.6) spot = { x, z };
    }
    expect(spot).not.toBeNull();
    const car = new THREE.Group(); car.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 2.6)));
    c.scene.add(car);
    const want = world.map.world.heightAt(spot!.x, spot!.z);
    for (const startY of [want - 3, want + 4]) {                     // sunk 3 m, then floating 4 m
      car.position.set(spot!.x - o.x, startY, spot!.z - o.z);
      for (let i = 0; i < 90; i++) OB.settleOnGround(car, 0, 1 / 60);
      expect(Math.abs(car.position.y - want)).toBeLessThan(0.6);
    }
    world.dispose();
  }, 120_000);
});
