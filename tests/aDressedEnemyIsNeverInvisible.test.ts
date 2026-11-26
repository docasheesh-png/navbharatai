// A DRESSED ENEMY IS NEVER INVISIBLE (failedbr #2518/#2519, 2026-11-25: "Knight Boxer enemy show nahi ho rahe" — the game hid
// its bots' bodies first and loaded the knight model after, so every bot stood invisible while it loaded, and for good when
// the load failed). Entities.dress(entity, modelOrPromise) keeps the kit body until the model has arrived; then the model
// takes its place — sized to the character, turning and falling with it. A load that fails leaves the kit body.
// Runs the REAL generated kit (Entities, the kit person, Health) with the real three.js.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';

const DIR = join(__dirname, `.tmp-dressed-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let E: any;
beforeAll(async () => {
  (globalThis as any).window = { addEventListener: () => {} };
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

const host = () => { const scene = new THREE.Scene(); const player = { object: new THREE.Object3D() }; player.object.position.set(30, 0, 0); scene.add(player.object); return { scene, player, onStep: () => () => {} }; };
const visibleMeshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverseVisible((m) => { if ((m as THREE.Mesh).isMesh) out.push(m as THREE.Mesh); }); return out; };
const knight = () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(1, 3.6, 0.6)); m.position.y = 1.8; m.name = 'knight mesh'; g.add(m); return g; };

describe('👕 dress(): the body stays until the model is there', () => {
  it('🔴 while the knight loads, the kit body is SEEN; once it arrives, the knight stands in its place at the character\'s height', async () => {
    const crowd = new E.Entities(host());
    const bot = crowd.spawn({ x: 0, z: 0, kind: 'enemy', height: 1.8 });
    let arrive!: (m: THREE.Object3D) => void;
    const dressed = crowd.dress(bot, new Promise<THREE.Object3D>((r) => { arrive = r; }));
    expect(visibleMeshes(bot.object).length).toBeGreaterThan(0);          // loading: still visible (the #2518 bot was not)
    expect(visibleMeshes(bot.object).some((m) => m.name === 'knight mesh')).toBe(false);
    arrive(knight());
    expect(await dressed).toBe(true);
    const seen = visibleMeshes(bot.object);
    expect(seen.map((m) => m.name)).toEqual(['knight mesh']);              // the kit person stepped aside
    bot.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(seen[0]);
    expect(box.max.y - box.min.y).toBeCloseTo(1.8, 2);                     // sized to the character, feet on its ground
    expect(box.min.y - bot.object.position.y).toBeCloseTo(0, 2);
  });
  it('a load that fails, or a model with nothing to see, leaves the kit body', async () => {
    const crowd = new E.Entities(host());
    const a = crowd.spawn({ x: 0, z: 0, kind: 'enemy' });
    expect(await crowd.dress(a, Promise.reject(new Error('404')))).toBe(false);
    expect(visibleMeshes(a.object).length).toBeGreaterThan(0);
    const b = crowd.spawn({ x: 3, z: 0, kind: 'enemy' });
    expect(await crowd.dress(b, new THREE.Group())).toBe(false);
    expect(visibleMeshes(b.object).length).toBeGreaterThan(0);
  });
  it('the knight turns with the body and lies down when it dies', async () => {
    const crowd = new E.Entities(host());
    const bot = crowd.spawn({ x: 0, z: 0, kind: 'enemy', health: 10 });
    const k = knight();
    await crowd.dress(bot, k);
    expect(k.parent).toBe(bot.model);                                      // turns with the body (the model faces where it walks)
    crowd.damage(bot, 50);
    crowd.update(0.05);
    expect(k.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });
});
