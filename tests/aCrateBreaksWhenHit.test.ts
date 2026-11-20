// BREAKABLE OBJECTS (admin 2026-11-20 game-gap audit: crates and walls took hits and nothing happened, or were hidden and
// kept blocking while invisible). These run the REAL generated three/breakable.ts and the REAL weapon (systems/weapon.ts +
// projectile.ts): a crate in the weapon's target list breaks, leaves the scene, and its debris settles and is disposed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-breakable-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let B: any; let P: any;
beforeAll(async () => {
  for (const r of [generateGameRuntime(), generateGame3D(['breakable']), generateGameSystems(['projectile'])]) {
    for (const [p, c] of Object.entries(r.files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  }
  B = await import(join(DIR, 'src/game/three/breakable.ts'));
  P = await import(join(DIR, 'src/game/systems/projectile.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
beforeEach(() => B.clearBreakables());

function crate(scene: THREE.Scene, x = 0, color = 0xaa7744): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color }));
  m.position.set(x, 0.5, 0);
  scene.add(m);
  return m;
}
const settle = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) B.updateBreakables(1 / 60); };
const debris = (scene: THREE.Scene, not: THREE.Object3D[] = []) => scene.children.filter((c) => !not.includes(c));

describe('💥 breakable objects', () => {
  it('ships in the 3D kit, and the shell steps and clears it by itself', () => {
    expect(Object.keys(generateGame3D().files)).toContain('src/game/three/breakable.ts');
    const game = generateGameShell().files['src/game/Game.ts'];
    expect(game).toMatch(/updateBreakables\(delta\)/);
    expect(game).toMatch(/clearBreakables\(\)/);
  });

  it('a crate takes hits; at zero it LEAVES the scene and debris takes its place', () => {
    const scene = new THREE.Scene();
    const c = crate(scene);
    let broke = 0;
    B.makeBreakable(c, { health: 30, pieces: 8, onBreak: () => { broke += 1; } });
    expect(B.damageBreakable(c, 10)).toEqual({ broken: false, health: 20 / 30 });
    expect(c.parent).toBe(scene);
    expect(B.damageBreakable(c, 25).broken).toBe(true);
    expect(c.parent).toBeNull();                 // no invisible wall left behind
    expect(broke).toBe(1);
    expect(B.debrisCount()).toBe(8);
    expect(debris(scene).length).toBe(8);
    // Debris has the crate's colour, unless told otherwise.
    expect(((debris(scene)[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xaa7744);
    // Further damage does nothing; it does not break twice.
    expect(B.damageBreakable(c, 50).broken).toBe(true);
    expect(broke).toBe(1);
    expect(B.isBreakable(c)).toBe(false);
    expect(B.isBroken(c)).toBe(true);
  });

  it('debris flies, falls, never sinks below where the crate stood, then shrinks away and is disposed', () => {
    const scene = new THREE.Scene();
    const c = crate(scene);
    B.makeBreakable(c, { pieces: 10, debrisSeconds: 1 });
    B.breakNow(c, { x: -5, y: 0.5, z: 0 });      // hit from the left: debris goes right
    const pieces = debris(scene) as THREE.Mesh[];
    let disposed = 0;
    for (const p of pieces) p.geometry.addEventListener('dispose', () => { disposed += 1; });
    settle(0.3);
    expect(pieces.reduce((s, p) => s + p.position.x, 0) / pieces.length).toBeGreaterThan(0.3);
    settle(0.6);
    for (const p of pieces) expect(p.position.y).toBeGreaterThanOrEqual(0 - 1e-6);
    settle(1.5);
    expect(B.debrisCount()).toBe(0);
    expect(scene.children.length).toBe(0);
    expect(disposed).toBe(10);
  });

  it('the player\'s real weapon breaks it: the crate is a target, the hit is handed back', () => {
    const scene = new THREE.Scene();
    const c = crate(scene, 6);
    B.makeBreakable(c, { health: 25 });
    const gun = new P.ProjectileSystem();
    const enemy = { id: 'enemy-1', position: { x: 0, y: 0.5, z: 20 }, radius: 0.5 };
    gun.fire({ position: { x: 0, y: 0.5, z: 0 }, direction: { x: 1, y: 0, z: 0 }, speed: 60, damage: 30 });
    let broken = 0;
    for (let i = 0; i < 30; i++) broken += B.hitBreakables(gun.update(1 / 60, [enemy, ...B.breakableTargets()]), { x: 0, y: 0.5, z: 0 });
    expect(broken).toBe(1);
    expect(c.parent).toBeNull();
    expect(B.breakableTargets()).toEqual([]);   // a broken crate is no longer a target
    // A stale hit on the broken crate (a second shot already in the air) counts for nothing.
    const stale = { target: { id: 'breakable:x', position: { x: 6, y: 0.5, z: 0 }, radius: 0.5, object: c }, damage: 30 };
    expect(B.hitBreakables([stale])).toBe(0);
  });

  it('hits on enemies are left alone, and bad damage changes nothing', () => {
    const scene = new THREE.Scene();
    const c = crate(scene);
    B.makeBreakable(c, { health: 10 });
    expect(B.hitBreakables([{ target: { id: 'enemy-1', position: { x: 0, y: 0, z: 0 }, radius: 1 }, damage: 99 }])).toBe(0);
    expect(B.damageBreakable(c, -5).health).toBe(1);
    expect(B.damageBreakable(c, Number.NaN).health).toBe(1);
    expect(c.parent).toBe(scene);
  });

  it('a crate the game took out of the scene itself is not a target (nothing to shoot at)', () => {
    const scene = new THREE.Scene();
    const c = crate(scene);
    B.makeBreakable(c);
    expect(B.breakableTargets().length).toBe(1);
    scene.remove(c);
    expect(B.breakableTargets()).toEqual([]);
  });

  it('clearBreakables (a new round, a reload) removes every piece and forgets every crate', () => {
    const scene = new THREE.Scene();
    const a = crate(scene, 0); const b = crate(scene, 3);
    B.makeBreakable(a); B.makeBreakable(b);
    B.breakNow(a);
    expect(B.debrisCount()).toBeGreaterThan(0);
    B.clearBreakables();
    expect(B.debrisCount()).toBe(0);
    expect(scene.children).toEqual([b]);
    expect(B.breakableTargets()).toEqual([]);
  });
});
