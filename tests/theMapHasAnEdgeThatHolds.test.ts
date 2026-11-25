/**
 * 🧱 THE MAP HAS AN EDGE THAT HOLDS (master audit 2026-11-25, Part F — characters and vehicles leave the map).
 *
 * Root cause, confirmed: the kit had only a fall recovery (60 m below the last safe ground) and no horizontal boundary, so
 * a player walked off the terrain and FELL first, and a car — which has no recovery — drove into empty space. These tests
 * run the REAL play/boundary.ts and the REAL walking capsule (play/character.ts) against the real walls.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { GAME_BOUNDARY, GAME_BOUNDARY_PATH } from '../src/server/lib/GameBoundaryGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-boundary-${process.pid}`);
let B: any; let CH: any; let COL: any;
beforeAll(async () => {
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, [GAME_BOUNDARY_PATH]: GAME_BOUNDARY };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  B = await import(join(DIR, GAME_BOUNDARY_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  COL = await import(join(DIR, 'src/game/three/collision.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const AREA = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
/** A scene with real ground (a marked collider) and the boundary. */
function scene() {
  const s = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 200)); ground.position.y = -0.5;
  COL.markWorldCollider(ground, 'ground'); s.add(ground);
  const boundary = new B.WorldBoundary(s);
  return { s, boundary };
}

describe('🔴 a walking player is stopped by the real wall, in every direction', () => {
  for (const [name, dir] of [['east', [1, 0]], ['west', [-1, 0]], ['north', [0, -1]], ['south', [0, 1]], ['diagonal', [0.7, 0.7]]] as const) {
    it(`${name}: walks 30 s at the edge and is still on the map`, () => {
      const { s, boundary } = scene();
      expect(boundary.set(AREA)).toBe(true);
      const player = new CH.CharacterController(); s.add(player.object); player.reset(0, 0.05, 0);
      for (let i = 0; i < 30 * 60; i++) player.update(1 / 60, { moveX: dir[0], moveZ: dir[1], sprint: true, jumpPressed: false, jumpHeld: false });
      const p = player.object.position;
      expect(B.insideBounds(AREA, p.x, p.z)).toBe(true);
      expect(p.y).toBeGreaterThan(-1); // it never fell off the end
    });
  }
  it('🔁 reversion: with no bounds the same walk leaves the map (the reported bug)', () => {
    const { s } = scene();
    const player = new CH.CharacterController(); s.add(player.object); player.reset(0, 0.05, 0);
    for (let i = 0; i < 30 * 60; i++) player.update(1 / 60, { moveX: 1, moveZ: 0, sprint: true, jumpPressed: false, jumpHeld: false });
    expect(B.insideBounds(AREA, player.object.position.x, player.object.position.z)).toBe(false);
  });
});

describe('the safety net: anything pushed past the edge is put back', () => {
  it('a car driven past the edge is brought back inside, and says WORLD_EDGE', () => {
    const { boundary } = scene();
    boundary.set(AREA);
    const car = new THREE.Group(); car.name = 'car'; car.position.set(35, 0, -50);
    expect(boundary.keep(car, 1.2)).toBe(true);
    expect(car.position.x).toBeCloseTo(18.8); expect(car.position.z).toBeCloseTo(-18.8);
    expect(boundary.keep(car, 1.2)).toBe(false); // inside now: nothing to do
  });
  it('clampToBounds, insideBounds and validBounds are exact', () => {
    const p = { x: -100, z: 5 };
    expect(B.clampToBounds(AREA, p, 0.5)).toBe(true); expect(p).toEqual({ x: -19.5, z: 5 });
    expect(B.insideBounds(AREA, 19.9, 0, 0.5)).toBe(false);
    expect(B.validBounds({ minX: 0, maxX: 0, minZ: 0, maxZ: 1 })).toBe(false);
    expect(B.validBounds({ minX: NaN, maxX: 1, minZ: 0, maxZ: 1 })).toBe(false);
  });
});

describe('walls: real colliders, visible or not, and refused bounds are said', () => {
  it('visible walls are seen; invisible walls still collide and are skipped by the aim', () => {
    const a = scene(); a.boundary.set(AREA);
    expect(a.boundary.wallMeshes).toHaveLength(4);
    expect(a.boundary.wallMeshes.every((w: any) => w.visible)).toBe(true);
    expect(COL.worldColliders(a.s).filter((m: any) => a.boundary.wallMeshes.includes(m))).toHaveLength(4);
    const b = scene(); b.boundary.set(AREA, { walls: 'invisible' });
    expect(b.boundary.wallMeshes.every((w: any) => !w.visible && w.userData.noAim)).toBe(true);
    expect(COL.worldColliders(b.s).filter((m: any) => b.boundary.wallMeshes.includes(m))).toHaveLength(4);
  });
  it('bad bounds are refused, not half-applied', () => {
    const { boundary } = scene();
    expect(boundary.set({ minX: 10, maxX: -10, minZ: 0, maxZ: 5 })).toBe(false);
    expect(boundary.bounds).toBeNull();
    expect(boundary.wallMeshes).toHaveLength(0);
  });
  it('clearing the bounds removes the walls', () => {
    const { s, boundary } = scene(); boundary.set(AREA);
    boundary.set(null);
    expect(s.children.some((o) => o.name === 'World boundary')).toBe(false);
  });
});

describe('wired into the shell', () => {
  it('Game.ts takes bounds, gives ctx.world, keeps the player, the driven car and every bounded object inside each step', () => {
    const shell = generateGameShell();
    const game = shell.files['src/game/Game.ts'];
    expect(shell.files[GAME_BOUNDARY_PATH]).toBeTruthy();
    expect(game).toContain('bounds?: WorldBounds & BoundaryOptions;');
    expect(game).toMatch(/world: \{ readonly bounds: WorldBounds \| null; setBounds:/);
    const ground = game.indexOf('groundScene(this.scene);\n      this.keepInsideMap();');
    expect(ground).toBeGreaterThan(0);
    expect(game).toContain('if (o.userData.bounded && o !== v) this.boundary.keep(o, 0.4);');
    expect(game).toContain('seat.state = { ...seat.state, speed: 0 }');
    expect(game).toContain('this.boundary.dispose();');
    expect(shell.instructions).toContain('THE MAP HAS AN EDGE');
  });
});
