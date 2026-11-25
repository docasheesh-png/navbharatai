/**
 * 🏠 A WALK-IN HOUSE IS REALLY WALKED INTO (master audit 2026-11-25, Part K — "a decorative exterior shell is not a walkable
 * house … a model must not be reported as walkable until runtime traversal tests pass").
 *
 * The kit's houses (three/buildings.ts createEnterableHouse, and enterableShellFor around a solid library model) are proved
 * here by TRAVERSAL with the real walking capsule (play/character.ts) and the real door code — never by reading the mesh list.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-house-${process.pid}`);
let CH: any; let COL: any; let B: any;
beforeAll(async () => {
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  COL = await import(join(DIR, 'src/game/three/collision.ts'));
  B = await import(join(DIR, 'src/game/three/buildings.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function world(house: THREE.Object3D) {
  const s = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 80)); ground.position.y = -0.5; COL.markWorldCollider(ground, 'ground'); s.add(ground);
  s.add(house);
  const p = new CH.CharacterController(); s.add(p.object);
  const actor = () => ({ feet: p.object.position, radius: 0.4, height: 1.8 });
  const step = (seconds: number, x: number, z: number) => {
    for (let i = 0; i < seconds * 60; i++) { B.updateHouseDoors(s, 1 / 60, [actor()]); p.update(1 / 60, { moveX: x, moveZ: z, sprint: false, jumpPressed: false, jumpHeld: false }); }
  };
  return { s, p, actor, step };
}

describe('🔴 a one-storey house: shut door blocks, Use opens it, the player walks in and stands on the floor', () => {
  it('closed: walking at the door does not get in', () => {
    const house = B.createEnterableHouse({ width: 8, depth: 6 });
    const w = world(house); w.p.reset(0, 0.02, 6);
    w.step(3, 0, -1);
    expect(w.p.object.position.z).toBeGreaterThan(3); // still outside the front wall (z = 3)
  });
  it('open: in through the door, onto the floor, and the walls hold inside', () => {
    const house = B.createEnterableHouse({ width: 8, depth: 6 });
    const w = world(house); w.p.reset(0, 0.02, 4.2);
    expect(B.interactHouseDoor(w.s, w.actor())).toBe(true);
    w.step(1, 0, 0);            // the door swings
    w.step(1.2, 0, -1);         // walk in
    const p = w.p.object.position;
    expect(p.z).toBeLessThan(2); // inside
    expect(p.y).toBeGreaterThan(0.1); expect(p.y).toBeLessThan(0.3); // on the 0.15 m floor, not in it
    expect(w.p.isGrounded).toBe(true);
    w.step(4, 1, 0);            // walk at the side wall
    expect(w.p.object.position.x).toBeLessThan(4);  // the wall (x = 4) holds
    w.step(4, 0, -1);           // and the back wall
    expect(w.p.object.position.z).toBeGreaterThan(-3);
  });
});

describe('a two-storey house: the stairs really reach the upper floor', () => {
  it('in through the door and up the stairs to y ≥ 3', () => {
    const house = B.createEnterableHouse({ width: 10, depth: 10, storeys: 2 });
    const w = world(house); w.p.reset(0, 0.02, 6.2);
    B.interactHouseDoor(w.s, w.actor()); w.step(1, 0, 0);
    w.step(1.5, 0, -1);
    expect(w.p.object.position.z).toBeLessThan(4);
    // Find the stairs from the house's own geometry: the 'ground' boxes above the floor and below the upper storey.
    const steps: THREE.Mesh[] = [];
    house.updateMatrixWorld(true);
    house.traverse((o: any) => { if (o.isMesh && o.userData.navbharatWorldCollider === 'ground') steps.push(o); });
    const treads = steps.map((m) => new THREE.Box3().setFromObject(m)).filter((b) => b.max.y > 0.4 && b.max.y < 3);
    expect(treads.length).toBeGreaterThan(3);
    const lowest = treads.reduce((a, b) => (b.max.y < a.max.y ? b : a));
    const highest = treads.reduce((a, b) => (b.max.y > a.max.y ? b : a));
    const sx = (lowest.min.x + lowest.max.x) / 2;
    // Walk to the foot of the stairs, then up them.
    const foot = new THREE.Vector3(sx, 0, lowest.max.z + 0.8);
    for (let i = 0; i < 300 && w.p.object.position.distanceTo(new THREE.Vector3(foot.x, w.p.object.position.y, foot.z)) > 0.3; i++) {
      const d = foot.clone().sub(w.p.object.position); d.y = 0; d.normalize();
      B.updateHouseDoors(w.s, 1 / 60, [w.actor()]); w.p.update(1 / 60, { moveX: d.x, moveZ: d.z, sprint: false, jumpPressed: false, jumpHeld: false });
    }
    const dir = Math.sign(((highest.min.z + highest.max.z) / 2) - ((lowest.min.z + lowest.max.z) / 2)) || -1;
    w.step(6, 0, dir);
    expect(w.p.object.position.y).toBeGreaterThanOrEqual(2.9);
  });
});

describe('a solid library model wrapped by enterableShellFor is entered the same way', () => {
  it('the solid model stops colliding, the shell has a door, and the player gets inside', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 7)); model.position.set(20, 2, 0);
    const scene0 = new THREE.Group(); scene0.add(model);
    const shell = B.enterableShellFor(model);
    const holder = new THREE.Group(); holder.add(scene0); holder.add(shell);
    const w = world(holder);
    const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    const front = centre.z + 3.5;
    w.p.reset(centre.x, 0.02, front + 1.2);
    expect(B.interactHouseDoor(w.s, w.actor())).toBe(true);
    w.step(1, 0, 0);
    w.step(1.5, 0, -1);
    expect(w.p.object.position.z).toBeLessThan(front - 1); // inside the footprint the solid model used to fill
  });
});
