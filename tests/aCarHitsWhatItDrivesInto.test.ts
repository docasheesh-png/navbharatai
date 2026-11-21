// A CAR HITS WHAT IT DRIVES INTO (admin 2026-11-20 engine audit). Measured before the fix with the REAL kit: a car
// drove straight through a parked car at full speed (vehicles were never obstacles, only scenery was), and a car that
// clipped a wall at an angle stopped dead and stayed glued to it. These run the REAL generated three/objects.ts and
// collision.ts, and the shell's wiring of the crash to sparks, sound and a camera jolt.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-car-crash-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let O: any; let K: any;
beforeAll(async () => {
  for (const r of [generateGameRuntime(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  }
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  K = await import(join(DIR, 'src/game/three/collision.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const FLAT = { ground: () => 0 };
function wall(scene: THREE.Scene, z = 15): THREE.Mesh {
  const m = K.markWorldCollider(new THREE.Mesh(new THREE.BoxGeometry(40, 3, 1), new THREE.MeshBasicMaterial()));
  m.position.set(0, 1.5, z); scene.add(m); return m;
}
function drive(scene: THREE.Scene, heading = 0, frames = 240, car = O.createCar({ detail: 'lite' })) {
  car.rotation.y = heading; scene.add(car); scene.updateMatrixWorld(true);
  const state = O.createVehicleState(car, FLAT);
  for (let i = 0; i < frames; i++) O.driveVehicle(car, state, { x: 0, y: -1 }, 1 / 60, FLAT);
  return { car, state };
}

describe('🚗 a car hits what it drives into', () => {
  it('stops at a PARKED CAR instead of driving through it', () => {
    const scene = new THREE.Scene();
    const parked = O.createCar({ detail: 'lite' }); parked.position.set(0, 0, 15); scene.add(parked);
    const { car, state } = drive(scene);
    expect(car.position.z).toBeGreaterThan(8);
    expect(car.position.z).toBeLessThan(15 - 2.5);   // bumper to bumper, never inside it
    expect(state.speed).toBe(0);
  });

  it('every kind of vehicle the kit builds is an obstacle: bus, truck, auto, tractor, bike, bicycle', () => {
    const makers = [() => O.createBus({ detail: 'lite' }), () => O.createTruck({ detail: 'lite' }), () => O.createAutoRickshaw({ detail: 'lite' }),
      () => O.createTractor({ detail: 'lite' }), () => O.createMotorcycle({ detail: 'lite' }).root, () => O.createBicycle({ detail: 'lite' }).root];
    for (const make of makers) {
      const scene = new THREE.Scene();
      const other = make(); other.position.set(0, 0, 20); scene.add(other);
      const { car } = drive(scene);
      expect(car.position.z, other.name || 'vehicle').toBeLessThan(19);
    }
  });

  it('a hand-built model the game drives is an obstacle for other cars too', () => {
    const scene = new THREE.Scene();
    const custom = new THREE.Group();
    custom.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4), new THREE.MeshBasicMaterial()));
    custom.position.set(0, 0, 15); scene.add(custom); scene.updateMatrixWorld(true);
    O.driveVehicle(custom, O.createVehicleState(custom, { ...FLAT, startSpeed: 0 }), { x: 0, y: 0 }, 1 / 60, { ...FLAT, startSpeed: 0 });
    const { car } = drive(scene);
    expect(car.position.z).toBeLessThan(13);
  });

  it('a car can back away from the car it touched, and drives on once the other car is gone', () => {
    const scene = new THREE.Scene();
    const parked = O.createCar({ detail: 'lite' }); parked.position.set(0, 0, 15); scene.add(parked);
    const { car, state } = drive(scene);
    const stop = car.position.z;
    for (let i = 0; i < 40; i++) O.driveVehicle(car, state, { x: 0, y: 1 }, 1 / 60, FLAT);
    expect(car.position.z).toBeLessThan(stop - 0.2);
    scene.remove(parked);
    for (let i = 0; i < 240; i++) O.driveVehicle(car, state, { x: 0, y: -1 }, 1 / 60, FLAT);
    expect(car.position.z).toBeGreaterThan(20);
  });

  it('two cars that end up overlapping never lock together: the one inside can drive out alongside', () => {
    const scene = new THREE.Scene();
    const rival = O.createCar({ detail: 'lite' }); rival.position.set(1.2, 0, 0); scene.add(rival);   // placed INTO the player's car
    const { car } = drive(scene, 0, 60);
    expect(car.position.z).toBeGreaterThan(5);
  });

  it('SLIDES along a wall it hits at an angle, keeping some speed — it does not stick', () => {
    const scene = new THREE.Scene();
    wall(scene);
    const { car, state } = drive(scene, 0.5, 240);
    expect(car.position.z).toBeLessThan(15);
    expect(car.position.x).toBeGreaterThan(12);          // it kept going along the wall
    expect(state.speed).toBeGreaterThan(2);
  });

  it('a head-on hit still stops dead (nothing to slide along)', () => {
    const scene = new THREE.Scene();
    wall(scene);
    const { car, state } = drive(scene, 0, 240);
    expect(Math.abs(car.position.x)).toBeLessThan(0.01);
    expect(state.speed).toBe(0);
  });

  it('a crash is reported once, at the bumper, with the speed lost — not every frame the bumper rests on the wall', () => {
    const scene = new THREE.Scene();
    wall(scene);
    const crashes: Array<{ at: THREE.Vector3; impact: number }> = [];
    const off = O.onVehicleCrash((at: THREE.Vector3, _v: THREE.Object3D, impact: number) => crashes.push({ at: at.clone(), impact }));
    drive(scene, 0, 240);
    off();
    expect(crashes.length).toBe(1);
    expect(crashes[0].impact).toBeGreaterThan(10);
    expect(crashes[0].at.z).toBeGreaterThan(13);
    expect(crashes[0].at.z).toBeLessThan(15);
    // A car that keeps ramming the wall (huge acceleration) is heard at most every 0.3 s, not 60 times a second.
    const rams: unknown[] = [];
    const off3 = O.onVehicleCrash(() => rams.push(1));
    const scene3 = new THREE.Scene(); wall(scene3, 6);
    const ram = O.createCar({ detail: 'lite' }); scene3.add(ram); scene3.updateMatrixWorld(true);
    const RAM = { ...FLAT, accel: 400, maxSpeed: 60 };
    const rs = O.createVehicleState(ram, RAM);
    for (let i = 0; i < 60; i++) O.driveVehicle(ram, rs, { x: 0, y: -1 }, 1 / 60, RAM);
    off3();
    expect(rams.length).toBeGreaterThan(1);
    expect(rams.length).toBeLessThanOrEqual(4);
    // A gentle nudge is not a crash.
    const soft: unknown[] = [];
    const off2 = O.onVehicleCrash(() => soft.push(1));
    const scene2 = new THREE.Scene(); wall(scene2, 4);
    const slow = O.createCar({ detail: 'lite' }); scene2.add(slow); scene2.updateMatrixWorld(true);
    const st = O.createVehicleState(slow, { ...FLAT, startSpeed: 0 });
    for (let i = 0; i < 120; i++) O.driveVehicle(slow, st, { x: 0, y: -0.2 }, 1 / 60, { ...FLAT, startSpeed: 0, accel: 1 });
    off2();
    expect(soft.length).toBe(0);
  });

  it("the shell makes the PLAYER's crash felt: sparks, the crunch, a jolt and a buzz", () => {
    const game = generateGameShell().files['src/game/Game.ts'];
    expect(game).toMatch(/onVehicleCrash\(/);
    expect(game).toMatch(/vehicle === this\.playerVehicle\) events\.emit\('VEHICLE_CRASHED'/);
    expect(generateGameVfxAudio().files['src/game/fx/feedback.ts']).toMatch(/VEHICLE_CRASHED:\s*\{ particle: 'sparks', sound: 'impact', +trauma: 0\.4/);
  });
});
