/**
 * 🧱 A BULLET STOPS AT A WALL (master audit 2026-11-25, Part L — one physics contract).
 *
 * The audit of every movement and collision path in the kit: the character, vehicles, camera, doors and the cannon-es
 * physics all read ONE world-collider registry (markWorldCollider → worldColliders) and ONE ground height (setGround). The
 * projectile was the one path outside it — ProjectileSystem.update tested targets only — so a bullet went through walls
 * and killed the enemy hiding behind one. Now update(dt, targets, world) stops it at the first wall; play/aim.ts
 * worldBlocker(scene) is that world, from the same registry. Run on the real kit files.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { GAME_AIM, GAME_AIM_PATH } from '../src/server/lib/GameAimGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-wall-${process.pid}`);
let P: any; let A: any; let COL: any; let EV: any;
beforeAll(async () => {
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameSystems(['projectile']).files, [GAME_AIM_PATH]: GAME_AIM };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  P = await import(join(DIR, 'src/game/systems/projectile.ts'));
  A = await import(join(DIR, GAME_AIM_PATH));
  COL = await import(join(DIR, 'src/game/three/collision.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function range(wallZ: number | null, targetZ: number) {
  const scene = new THREE.Scene();
  if (wallZ !== null) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.3)); wall.position.set(0, 1.5, wallZ);
    COL.markWorldCollider(wall, 'solid'); scene.add(wall);
  }
  scene.updateMatrixWorld(true);
  const target = { position: { x: 0, y: 1.4, z: targetZ }, radius: 0.5, ref: 'enemy' };
  return { scene, target };
}
function fire(scene: THREE.Scene, target: any, withWorld: boolean) {
  const ps = new P.ProjectileSystem(8);
  ps.fire({ position: { x: 0, y: 1.4, z: 0 }, direction: { x: 0, y: 0, z: 1 }, speed: 60, silent: true });
  const world = withWorld ? A.worldBlocker(scene) : undefined;
  const hits: any[] = []; const walls: any[] = [];
  const off = EV.events.on('PROJECTILE_HIT_WORLD', (p: any) => walls.push(p.position));
  for (let i = 0; i < 120; i++) hits.push(...ps.update(1 / 60, [target], world));
  off();
  return { hits, walls, active: ps.activeCount };
}

describe('🔴 the wall stops the bullet', () => {
  it('an enemy behind a wall is NOT hit; the bullet stops at the wall and says where', () => {
    const { scene, target } = range(10, 20);
    const r = fire(scene, target, true);
    expect(r.hits).toHaveLength(0);
    expect(r.walls).toHaveLength(1);
    expect(r.walls[0].z).toBeGreaterThan(9.7); expect(r.walls[0].z).toBeLessThan(10.2);
    expect(r.active).toBe(0);
  });
  it('🔁 reversion: without the world (the old call) the same bullet goes through the wall and hits — the reported bug', () => {
    const { scene, target } = range(10, 20);
    expect(fire(scene, target, false).hits).toHaveLength(1);
  });
  it('an enemy IN FRONT of the wall is hit, as before', () => {
    const { scene, target } = range(20, 10);
    const r = fire(scene, target, true);
    expect(r.hits).toHaveLength(1); expect(r.walls).toHaveLength(0);
  });
  it('no wall: the shot hits; an empty scene costs nothing and changes nothing', () => {
    const { scene, target } = range(null, 15);
    expect(fire(scene, target, true).hits).toHaveLength(1);
  });
  it('the systems instructions pass the world in both examples', () => {
    const text = generateGameSystems().instructions;
    expect(text).toContain('bullets.update(dt, targets, walls)');
    expect(text).toContain('npcs.targets(), worldBlocker(ctx.scene)');
  });
});
