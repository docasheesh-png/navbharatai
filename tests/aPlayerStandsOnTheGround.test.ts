// THE PLAYER STANDS ON THE GROUND (found 2026-10-05 by PLAYING the shell — gamePlaytest.ts).
//
// The first real playtest of a game built on NavBharatAI's own shell scored 57/100 with Controls 0: the
// screen showed only sky. The player was falling — y −3 after 0.3 s, −46 after 2 s — and the camera
// followed it under the world. The cause, in the character controller:
//   1. standing applied the motor's "ground snap" velocity (vy = −2) and nothing ever put the feet back on
//      the surface, so a player standing still sank 3 cm a frame, lost the ground ray within five frames,
//      and fell for ever. EVERY game built on the shell with ground colliders lost its player;
//   2. the ground probe reached a fixed 0.15 m below the feet, so a fall faster than ~9 m/s crossed the
//      floor between two probes (tunnelling);
//   3. raycasts read world matrices three.js only refreshes when it renders — and the world is built
//      before the first render — so a moved collider was hit-tested where it was not drawn. The camera
//      rig's collision raycasts had the same class.
// And the player had no body at all: the controller is an empty Object3D, so a third-person hero was
// invisible. These tests drive the GENERATED modules with real three.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-game-meta-ground-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let E: any; let W: any; let CAM: any;

beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }) }) };
  (globalThis as any).window = { innerWidth: 800, innerHeight: 600 };
  for (const r of [generateGameRuntime(), generateGameController(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  C = await import(join(DIR, 'src/game/play/character.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  W = await import(join(DIR, 'src/game/three/world.ts'));
  CAM = await import(join(DIR, 'src/game/three/camera.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; delete (globalThis as any).window; });

const still = { moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, jumpHeld: false };
const run = (pc: any, seconds: number, input = still) => { for (let i = 0; i < Math.round(seconds * 60); i++) pc.update(1 / 60, input, 0); };

describe('the character controller keeps its feet on the ground', () => {
  it('THE BUG: a player standing still on flat ground for five seconds is still standing on it', () => {
    const pc = new C.CharacterController();
    pc.setColliders([W.createTerrain({ size: 80, flat: true })]);
    run(pc, 5);
    expect(pc.object.position.y).toBeCloseTo(0, 3);
    expect(pc.isGrounded).toBe(true);
  });

  it('a long fall lands ON the ground, never through it', () => {
    const pc = new C.CharacterController();
    pc.setColliders([W.createTerrain({ size: 80, flat: true })]);
    pc.reset(0, 40, 0);
    run(pc, 6);
    expect(pc.object.position.y).toBeCloseTo(0, 3);
    expect(pc.isGrounded).toBe(true);
  });

  it('walking and jumping keep it on the ground between hops', () => {
    const pc = new C.CharacterController();
    pc.setColliders([W.createTerrain({ size: 200, flat: true })]);
    run(pc, 2, { ...still, moveZ: -1 });
    expect(Math.abs(pc.object.position.z)).toBeGreaterThan(3);
    expect(pc.object.position.y).toBeCloseTo(0, 3);
    pc.update(1 / 60, { ...still, jumpPressed: true, jumpHeld: true }, 0);
    run(pc, 0.2, { ...still, jumpHeld: true });
    expect(pc.object.position.y).toBeGreaterThan(0.3);
    run(pc, 3);
    expect(pc.object.position.y).toBeCloseTo(0, 3);
  });

  it('a collider that was MOVED (and never rendered) is stood on where it is, not where it was built', () => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 20), new THREE.MeshBasicMaterial());
    floor.position.y = 4;                      // top face at y = 4.5
    const pc = new C.CharacterController();
    pc.setColliders([floor]);
    pc.reset(0, 8, 0);
    run(pc, 3);
    expect(pc.object.position.y).toBeCloseTo(4.5, 2);
  });

  it('falling out of the world puts the player back where it last stood, and says so', () => {
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), new THREE.MeshBasicMaterial());
    ledge.position.set(0, -0.5, 0);            // top at y = 0, ends at |x|,|z| = 2
    const pc = new C.CharacterController();
    pc.setColliders([ledge]);
    run(pc, 0.5);
    const fell: any[] = [];
    const off = E.events.on('PLAYER_FELL', (p: any) => fell.push(p));
    run(pc, 1.5, { ...still, moveX: 1 });       // walk off the edge
    run(pc, 6);
    off();
    expect(fell.length).toBeGreaterThanOrEqual(1);
    expect(pc.object.position.y).toBeGreaterThan(-61);
    expect(Math.abs(pc.object.position.x)).toBeLessThanOrEqual(2.5);
  });
});

describe('the camera collides with the world as it is drawn', () => {
  it('setCollidables refreshes world matrices, like the character does', () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    wall.position.set(0, 0, 50);
    const rig = new CAM.CameraRig({ kind: 'third-person' });
    rig.setCollidables([wall]);
    expect(wall.matrixWorld.elements[14]).toBe(50);
  });
});

describe('the player has a body', () => {
  const game = generateGameShell().files['src/game/Game.ts'];
  it('third-person gets a humanoid that faces where it walks; first-person gets none; a game can bring its own', () => {
    expect(game).toContain("import { createHumanoid, type Humanoid } from './three/humanoid';");
    expect(game).toMatch(/options\.playerBody !== false && !firstPerson/);
    expect(game).toContain('this.player.object.add(options.playerBody)');
    expect(game).toContain('Math.atan2(v.x, v.z)');
    expect(game).toContain('this.hero.update(delta, speed, this.player.isGrounded)');
    expect(game).toContain('this.hero?.dispose()');
  });
});
