// ⚖️ THE FIGHT IS HARD, NEVER UNFAIR (Kadam 4, 2026-11-26). Every hostile in reach used to attack every 1.2 s for 10 health,
// with no cap and from the moment it spawned: six enemies took 50 health a second and the hero died in two seconds — the
// "hero jaldi marta hai" class the reference game fixed with a cap on attackers at once and a grace after landing.
// ENTITY_BALANCE now holds the numbers in one place. Runs the REAL generated kit (Entities, Health) with real three.js.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';

const DIR = join(__dirname, `.tmp-fair-fight-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let E: any; let C: any;
beforeAll(async () => {
  (globalThis as any).window = { addEventListener: () => {} };
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
  C = await import(join(DIR, 'src/game/systems/combat.ts'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

const host = () => { const scene = new THREE.Scene(); const player = { object: new THREE.Object3D() }; scene.add(player.object); return { scene, player, onStep: () => () => {} }; };
/** Six enemies around the hero, close enough to hit, for `seconds` of play at 30 steps a second. Returns the hero's health. */
function surrounded(seconds: number, opts: Record<string, unknown> = {}): { left: number; attackers: Set<string> } {
  const playerHealth = new C.Health({ max: 100 });
  const attackers = new Set<string>();
  const crowd = new E.Entities(host(), { playerHealth, onAttack: (e: { id: string }) => attackers.add(e.id), ...opts });
  for (let i = 0; i < 6; i++) crowd.spawn({ x: Math.cos(i) * 1.2, z: Math.sin(i) * 1.2, kind: 'enemy' });
  for (let t = 0; t < seconds * 30; t++) { crowd.update(1 / 30); playerHealth.tick(1 / 30); }
  return { left: playerHealth.current, attackers };
}

describe('⚖️ six enemies around the hero', () => {
  it('the balance numbers live in one place', () => {
    expect(E.ENTITY_BALANCE).toEqual({ maxAttackers: 3, attackGraceSeconds: 2, attackWindowSeconds: 1.5 });
  });
  it('nobody hits in the first two seconds — the player sees them before they land a blow', () => {
    expect(surrounded(1.9).left).toBe(100);
  });
  it('🔴 the hero is still alive after four seconds (before: dead in two), and at most three ever attack at once', () => {
    const r = surrounded(4);
    expect(r.left).toBeGreaterThan(0);
    expect(r.attackers.size).toBeLessThanOrEqual(3);
  });
  it('a game can make it harder on purpose', () => {
    expect(surrounded(4, { maxAttackers: 6, attackGraceSeconds: 0 }).left).toBeLessThan(surrounded(4).left);
  });
});
