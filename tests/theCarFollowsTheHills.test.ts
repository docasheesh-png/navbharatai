// THE CAR FOLLOWS THE HILLS (admin 2026-11-02, build be6aae96: "car aage chal kar jameen me dhasne lagti
// hai … sabhi racing game me yahi hota hai"). createTerrain() displaced its vertices into hills, but the
// height lived only in the mesh, and driveVehicle() moved x/z and never y — so every car drove at the y it
// was born at and sank into the first hill. These tests drive the GENERATED kit with real three.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-car-hills-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let W: any; let O: any; let S: any;
beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }) }) };
  (globalThis as any).window = { innerWidth: 800, innerHeight: 600 };
  for (const r of [generateGameRuntime(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  W = await import(join(DIR, 'src/game/three/world.ts'));
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  S = await import(join(DIR, 'src/game/three/surfaces.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; delete (globalThis as any).window; });

const raycastY = (mesh: THREE.Mesh, x: number, z: number) => {
  mesh.updateMatrixWorld(true);
  const hit = new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0];
  return hit ? hit.point.y : NaN;
};

describe('a driven car stays ON the terrain', () => {
  it('heightAt is the DRAWN surface (matches a raycast against the mesh)', () => {
    const t = W.createTerrain({ size: 200, amplitude: 10 });
    for (const [x, z] of [[0, 0], [13.3, -27.1], [-61.7, 44.2], [88, 88]]) {
      expect(t.userData.heightAt(x, z)).toBeCloseTo(raycastY(t, x, z), 3);
    }
  });

  it('THE BUG: driving 600 frames over hills, y tracks the ground and never goes below it', () => {
    const t = W.createTerrain({ size: 400, amplitude: 12, seed: 3 });
    const car = O.createCar();
    car.position.set(0, 0.03, 0);          // born at road height, as every game did
    let st = O.createVehicleState(car);
    let climbed = 0, minGap = Infinity, maxGap = -Infinity;
    for (let i = 0; i < 600; i++) {
      st = O.driveVehicle(car, st, { x: i % 200 < 100 ? 0.3 : -0.3, y: -1 }, 1 / 60);
      const g = t.userData.heightAt(car.position.x, car.position.z);
      minGap = Math.min(minGap, car.position.y - g);
      maxGap = Math.max(maxGap, car.position.y - g);
      climbed = Math.max(climbed, Math.abs(g));
    }
    expect(climbed).toBeGreaterThan(1);    // the path really crossed hills
    expect(minGap).toBeGreaterThanOrEqual(0.03 - 1e-6);   // never inside the ground
    expect(maxGap).toBeLessThan(0.6);      // and never flying off it
  });

  it('pitches nose-UP climbing and nose-DOWN descending a slope', () => {
    const slope = (x: number, z: number) => z * 0.2;   // rising toward +Z
    const car = O.createCar();
    let st = O.createVehicleState(car, { ground: slope });       // faces +Z: uphill
    for (let i = 0; i < 60; i++) st = O.driveVehicle(car, st, { x: 0, y: -1 }, 1 / 60, { ground: slope });
    expect(car.rotation.x).toBeLessThan(-0.15);
    expect(car.position.y).toBeCloseTo(slope(0, car.position.z) + 0.03, 1);
    const down = O.createCar(); down.rotation.y = Math.PI;
    let s2 = O.createVehicleState(down, { ground: slope });
    for (let i = 0; i < 60; i++) s2 = O.driveVehicle(down, s2, { x: 0, y: -1 }, 1 / 60, { ground: slope });
    expect(down.rotation.x).toBeGreaterThan(0.15);
  });

  it('rolls toward the low side on a side slope', () => {
    const side = (x: number) => x * 0.2;   // +X (driver's left when facing +Z) is higher
    const car = O.createCar();
    O.createVehicleState(car, { ground: side });
    expect(car.rotation.z).toBeGreaterThan(0.15);
  });

  it('ground:false leaves y alone (a boat or a hand-placed track)', () => {
    W.createTerrain({ size: 100, amplitude: 10 });
    const car = O.createCar(); car.position.y = 50;
    let st = O.createVehicleState(car, { ground: false });
    for (let i = 0; i < 30; i++) st = O.driveVehicle(car, st, { x: 0, y: -1 }, 1 / 60, { ground: false });
    expect(car.position.y).toBe(50);
    S.setGround(null);
  });
});

describe('NOTHING sinks: groundScene keeps every dynamic object on the terrain', () => {
  it('a prop, an NPC and a train placed at y = 0 on hills are lifted onto the surface; a bird is not', () => {
    S.clearWater();
    const t = W.createTerrain({ size: 300, amplitude: 12, seed: 5 });
    const scene = new THREE.Scene(); scene.add(t);
    const things = [[40, 10], [-70, 55], [12, -90]].map(([x, z]) => { const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); o.position.set(x, -5, z); scene.add(o); return o; });
    const bird = new THREE.Object3D(); bird.position.set(0, -20, 0); bird.userData.ground = false; scene.add(bird);
    const light = new THREE.PointLight(); light.position.set(0, -50, 0); scene.add(light);
    // A walker moving across hills, grounded every step like the shell does.
    for (let i = 0; i < 300; i++) { things[1].position.x += 0.3; S.groundScene(scene);
      for (const o of things) expect(o.position.y).toBeGreaterThanOrEqual(t.userData.heightAt(o.position.x, o.position.z) - 1e-6); }
    expect(bird.position.y).toBe(-20);
    expect(light.position.y).toBe(-50);
    expect(t.position.y).toBe(0);
  });

  it('only a DECLARED water region lets an object go below the ground', () => {
    S.clearWater();
    W.createTerrain({ size: 200, amplitude: 10, seed: 2 });
    const scene = new THREE.Scene();
    const boat = new THREE.Object3D(); boat.position.set(50, -3, 0); scene.add(boat);
    const rock = new THREE.Object3D(); rock.position.set(-50, -3, 0); scene.add(rock);
    S.addWater((x: number) => x > 40);
    S.groundScene(scene);
    expect(boat.position.y).toBe(-3);
    expect(rock.position.y).toBeGreaterThan(-3);
    S.clearWater(); S.setGround(null);
  });

  it('the game shell grounds the scene after every update (a generated game cannot skip it)', async () => {
    const { generateGameShell } = await import('../src/server/lib/GameShellGenerator');
    const game = Object.entries(generateGameShell().files).find(([p]) => p.endsWith('src/game/Game.ts'))![1] as string;
    expect(game).toMatch(/groundScene\(this\.scene\)/);
  });
});
