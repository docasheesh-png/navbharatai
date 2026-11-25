/**
 * 🎯 A BULLET GOES WHERE THE CROSSHAIR IS (master audit 2026-11-25, Part A: "bullets sometimes always travel north … aiming at
 * an enemy does not guarantee the bullet travels toward that target").
 *
 * Root cause (confirmed in code): the kit's ProjectileSystem is correct, but it is handed a direction and the kit never said
 * where that comes from. Its own instruction read `gun.update(…, muzzleWorldPos, aimDir, …)` — two placeholders every game
 * filled by hand (a constant is "always north"); one build guessed a ctx.crosshairTarget that does not exist. Now ctx.aim()
 * (play/aim.ts) is the one source. Every test FIRES through the real ProjectileSystem and checks the bullet actually hit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { GAME_AIM, GAME_AIM_PATH } from '../src/server/lib/GameAimGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-aim-${process.pid}`);
let A: any; let P: any;
beforeAll(async () => {
  const files: Record<string, string> = { ...generateGameRuntime(['events']).files, ...generateGameSystems(['projectile']).files, [GAME_AIM_PATH]: GAME_AIM };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  A = await import(join(DIR, GAME_AIM_PATH));
  P = await import(join(DIR, 'src/game/systems/projectile.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A world: the player (a 1.8 m body holding a gun in its right hand) and one target sphere. */
function world(targetAt: THREE.Vector3) {
  const scene = new THREE.Scene();
  const player = new THREE.Group(); scene.add(player);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3)); body.position.y = 0.9; player.add(body);
  const hand = new THREE.Group(); hand.position.set(-0.3, 1.3, 0.3); player.add(hand);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.5)); gun.position.z = 0.25; hand.add(gun);
  const target = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12)); target.position.copy(targetAt); scene.add(target);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000); scene.add(camera);
  return { scene, player, hand, target, camera };
}
/** Point the camera from `eye` at `at`. */
function look(camera: THREE.PerspectiveCamera, eye: THREE.Vector3, at: THREE.Vector3) { camera.position.copy(eye); camera.lookAt(at); camera.updateMatrixWorld(true); }
/** Fire one bullet along the aim and step the REAL projectile system: did it hit the target? */
function fires(w: ReturnType<typeof world>, aim: any): boolean {
  const ps = new P.ProjectileSystem(8);
  ps.fire({ position: { x: aim.muzzle.x, y: aim.muzzle.y, z: aim.muzzle.z }, direction: { x: aim.shot.x, y: aim.shot.y, z: aim.shot.z }, speed: 60, silent: true });
  const t = w.target.position;
  for (let i = 0; i < 240; i++) {
    const hits = ps.update(1 / 60, [{ id: 'target', position: { x: t.x, y: t.y, z: t.z }, radius: 0.5 }]);
    if (hits.length) return true;
  }
  return false;
}

describe('🔴 the crosshair decides where the bullet goes — every compass direction, really fired', () => {
  for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    it(`${deg}° : a first-person camera looking at the target fires into it`, () => {
      const r = (deg * Math.PI) / 180;
      const at = new THREE.Vector3(Math.sin(r) * 20, 1.6, Math.cos(r) * 20);
      const w = world(at);
      w.player.rotation.y = r; w.player.updateMatrixWorld(true);
      look(w.camera, new THREE.Vector3(0, 1.6, 0), at);
      const a = A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player });
      expect(a.hit).toBe(w.target);
      expect(fires(w, a)).toBe(true);
    });
  }
  it('up and down: a target above and one below are hit', () => {
    for (const at of [new THREE.Vector3(0, 12, 15), new THREE.Vector3(0, -6, 12)]) {
      const w = world(at);
      look(w.camera, new THREE.Vector3(0, 1.6, 0), at);
      const a = A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player });
      expect(fires(w, a)).toBe(true);
    }
  });
  it('third-person: the camera behind and above the player, the gun at the hand — the bullet still reaches the crosshair point', () => {
    const at = new THREE.Vector3(6, 1.5, 25);
    const w = world(at);
    look(w.camera, new THREE.Vector3(0.6, 3, -4), at);
    const a = A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player });
    expect(a.hit).toBe(w.target);              // never the player's own body, though the ray passes it
    expect(a.muzzle.distanceTo(w.camera.position)).toBeGreaterThan(1);
    expect(fires(w, a)).toBe(true);
  });
  it('a moving, turned player: aiming follows the camera, not the way the body faces', () => {
    const at = new THREE.Vector3(-18, 1.6, -5);
    const w = world(at);
    w.player.position.set(3, 0, 2); w.player.rotation.y = Math.PI * 0.8; w.player.updateMatrixWorld(true);
    look(w.camera, new THREE.Vector3(3, 1.6, 2), at);
    expect(fires(w, A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player }))).toBe(true);
  });
  it('🔒 reversion: a constant "north" direction misses a target the crosshair is on (the bug this replaces)', () => {
    const at = new THREE.Vector3(20, 1.6, 0);   // due east
    const w = world(at);
    look(w.camera, new THREE.Vector3(0, 1.6, 0), at);
    const good = A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player });
    expect(fires(w, good)).toBe(true);
    expect(fires(w, { ...good, shot: new THREE.Vector3(0, 0, 1) })).toBe(false);
  });
});

describe('the rules of the aim', () => {
  it('particles, invisible things and userData.noAim are never the aim point; open sky gives a far point', () => {
    const at = new THREE.Vector3(0, 1.6, 20);
    const w = world(at);
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.2)); ghost.position.set(0, 1.6, 8); ghost.visible = false; w.scene.add(ghost);
    const marker = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.2)); marker.position.set(0, 1.6, 10); marker.userData.noAim = true; w.scene.add(marker);
    const sparks = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.6, 6)]));
    w.scene.add(sparks);
    look(w.camera, new THREE.Vector3(0, 1.6, 0), at);
    expect(A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player }).hit).toBe(w.target);
    w.target.visible = false;
    const sky = A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player, range: 100 });
    expect(sky.hit).toBeNull();
    expect(sky.point.distanceTo(w.camera.position)).toBeCloseTo(100, 3);
  });
  it('the muzzle is the tip of what the hand holds, and the shot starts just past it (never inside the gun)', () => {
    const w = world(new THREE.Vector3(0, 1.3, 30));
    look(w.camera, new THREE.Vector3(-0.3, 1.3, 0), new THREE.Vector3(-0.3, 1.3, 30));
    const a = A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player });
    expect(a.muzzle.z).toBeGreaterThan(0.3 + 0.5 - 0.01);   // the hand at z 0.3, the gun 0.5 long forward
    expect(a.shot.length()).toBeCloseTo(1, 6);
  });
  it('top-down: no crosshair — the shot is the way the player faces, level', () => {
    const w = world(new THREE.Vector3(10, 1.3, 0));
    const a = A.aimFrom(w.camera, w.scene, { own: [w.player], holder: w.hand, body: w.player, topDownFacing: Math.PI / 2 });
    expect(a.shot.x).toBeCloseTo(1, 3);
    expect(Math.abs(a.shot.y)).toBeLessThan(0.05);
  });
  it('a point behind the muzzle falls back to the camera direction', () => {
    expect(A.shotFrom(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, 1)).z).toBeCloseTo(1, 6);
  });
});

describe('🔒 wired: every game on the shell aims this way, and the builder is told', () => {
  it('Game.ts gives ctx.aim, ships aim.ts, and the systems instruction no longer leaves the direction to a placeholder', () => {
    const shell = generateGameShell(['game']);
    expect(shell.files['src/game/Game.ts']).toContain('aim: (o = {}) => {');
    expect(shell.files[GAME_AIM_PATH]).toBeDefined();
    expect(shell.instructions).toMatch(/EVERY GUN AIMS WITH ctx\.aim\(\)/);
    const sys = generateGameSystems().instructions;
    expect(sys).toContain('const a = ctx.aim(); gun.update(dt,');
    expect(sys).not.toContain('muzzleWorldPos, aimDir');
  });
});
