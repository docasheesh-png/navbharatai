/**
 * ⛰️ NOTHING SINKS OR FLOATS ON REAL GROUND (master audit 2026-11-25, Part E — "characters sink, cars float, slopes and
 * stairs behave wrong").
 *
 * The audit asked for wheel/contact geometry, slope following, stairs, indoor floors. The kit already has them —
 * play/character.ts (capsule, step offset, slope limit, last-safe recovery) and three/objects.ts settleOnGround (four wheel
 * contacts, pitch and roll from them, sprung only downward). This file is the RUNTIME PROOF the audit required, on the real
 * kit files: a character up a hill, up a staircase, onto a raised floor; a car over a hill and along a side slope with every
 * wheel on the ground. A failure here is a real defect, not a missing feature.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-ground-${process.pid}`);
let CH: any; let COL: any; let OBJ: any; let SURF: any;
beforeAll(async () => {
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  COL = await import(join(DIR, 'src/game/three/collision.ts'));
  OBJ = await import(join(DIR, 'src/game/three/objects.ts'));
  SURF = await import(join(DIR, 'src/game/three/surfaces.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A hill as a real mesh (marked ground) AND as the ground function the kit samples. */
const hill = (x: number, z: number) => 4 * Math.exp(-((x * x) + (z - 20) * (z - 20)) / 120);
function hillScene() {
  const s = new THREE.Scene();
  const geo = new THREE.PlaneGeometry(120, 120, 120, 120); geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, hill(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo); COL.markWorldCollider(mesh, 'ground'); s.add(mesh);
  SURF.setGround(hill);
  return s;
}
const walk = (p: any, seconds: number, dir: [number, number]) => { for (let i = 0; i < seconds * 60; i++) p.update(1 / 60, { moveX: dir[0], moveZ: dir[1], sprint: false, jumpPressed: false, jumpHeld: false }); };

describe('a character on real ground', () => {
  it('walks over a hill: the feet follow the surface the whole way — never under it, never floating', () => {
    const s = hillScene();
    const p = new CH.CharacterController(); s.add(p.object); p.reset(0, hill(0, 0) + 0.05, 0);
    let worstSink = 0; let worstFloat = 0;
    for (let i = 0; i < 12 * 60; i++) {
      p.update(1 / 60, { moveX: 0, moveZ: 1, sprint: false, jumpPressed: false, jumpHeld: false });
      const g = hill(p.object.position.x, p.object.position.z);
      const d = p.object.position.y - g;
      if (p.isGrounded) { worstSink = Math.min(worstSink, d); worstFloat = Math.max(worstFloat, d); }
    }
    expect(p.object.position.z).toBeGreaterThan(25);         // it really crossed the hill
    expect(worstSink).toBeGreaterThan(-0.12);                 // feet never inside the ground
    expect(worstFloat).toBeLessThan(0.2);                     // and never hovering while "grounded"
    SURF.setGround(null);
  });
  it('climbs a staircase of 0.25 m steps, crosses the seam to the landing, and stands on it', () => {
    const s = new THREE.Scene();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40)); floor.position.y = -0.5; COL.markWorldCollider(floor, 'ground'); s.add(floor);
    for (let i = 0; i < 8; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25 * (i + 1), 0.5));
      step.position.set(0, (0.25 * (i + 1)) / 2, 3 + i * 0.5); COL.markWorldCollider(step, 'solid'); s.add(step);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 4)); top.position.set(0, 1, 9); COL.markWorldCollider(top, 'solid'); s.add(top);
    const p = new CH.CharacterController(); s.add(p.object); p.reset(0, 0.02, 0);
    // 🦶 The top step and the landing have a 0.25 m seam — narrower than the 0.4 m foot. With support read from ONE centre ray
    // the character hung over it for ever: not grounded, unable to fall, unable to climb (the defect this file found).
    walk(p, 1.6, [0, 1]);
    expect(p.isGrounded).toBe(true);
    expect(p.object.position.z).toBeGreaterThan(8);
    expect(p.object.position.y).toBeGreaterThan(1.9);       // on top of the 2 m landing
    expect(p.object.position.y).toBeLessThan(2.2);
  });
  it('a 1 m wall is NOT a step — it blocks', () => {
    const s = new THREE.Scene();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40)); floor.position.y = -0.5; COL.markWorldCollider(floor, 'ground'); s.add(floor);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 0.5)); wall.position.set(0, 0.5, 3); COL.markWorldCollider(wall, 'solid'); s.add(wall);
    const p = new CH.CharacterController(); s.add(p.object); p.reset(0, 0.02, 0);
    walk(p, 4, [0, 1]);
    expect(p.object.position.z).toBeLessThan(3);
    expect(p.object.position.y).toBeLessThan(0.2);
  });
});

describe('a car on real ground — four wheel contacts, not the centre height', () => {
  function onHill(heading: number, x: number, z: number) {
    hillScene();
    const car = OBJ.createCar(); car.position.set(x, 0, z); car.rotation.y = heading;
    const state = OBJ.createVehicleState(car, { startSpeed: 0 });
    return { car, state };
  }
  /** Ground under each wheel vs the car's underside there. */
  function wheelGaps(car: THREE.Object3D) {
    car.updateMatrixWorld(true);
    const L = 1.3, W = 0.8;
    return [[L, W], [L, -W], [-L, W], [-L, -W]].map(([f, l]) => {
      const p = new THREE.Vector3(l, 0, f).applyMatrix4(car.matrixWorld);
      return p.y - hill(p.x, p.z);
    });
  }
  it('driving up and over a hill: every wheel stays on the surface, the body pitches with it', () => {
    const { car, state } = onHill(0, 0, 2);
    let s = state; let worst = 0; let pitched = 0;
    for (let i = 0; i < 6 * 60; i++) {
      s = OBJ.driveVehicle(car, s, { x: 0, y: -0.6 }, 1 / 60);
      for (const g of wheelGaps(car)) worst = Math.max(worst, Math.abs(g));
      pitched = Math.max(pitched, Math.abs(car.rotation.x));
    }
    expect(car.position.z).toBeGreaterThan(25);
    expect(worst).toBeLessThan(0.35);
    expect(pitched).toBeGreaterThan(0.05); // it really tilted with the slope
    SURF.setGround(null);
  });
  it('across a side slope it rolls, so the uphill wheels are not floating', () => {
    const { car, state } = onHill(Math.PI / 2, -10, 14);
    let s = state;
    for (let i = 0; i < 60; i++) s = OBJ.driveVehicle(car, s, { x: 0, y: 0 }, 1 / 60);
    expect(Math.abs(car.rotation.z)).toBeGreaterThan(0.03);
    for (const g of wheelGaps(car)) expect(Math.abs(g)).toBeLessThan(0.35);
    SURF.setGround(null);
  });
});
