/**
 * 👾 ENEMIES THAT WERE ASKED FOR ARE WHERE THE HERO IS — AND THE PLAYTEST PROVES IT (admin 2026-11-26, report #2519).
 *
 * Reported: "jab user kahta hai yeh enemy bana, aur hero par enemy attack kare, to builder pura kam kar deta hai … par real
 * game me enemies show hi nahi hote". Report #2519 ("Knight Boxer enemy show nahi ho rahe hai") said the enemies were
 * there and attacking; the game showed none, and the playtest never played it (a 1000-house city at 3 fps) — and even a
 * played run had no check for enemies at all: the played evidence covered score, level, sound, restart and a vehicle.
 *
 * The class has two halves, both locked here with the REAL emitted kit code and the REAL page hook:
 *   1. WHERE: Entities.spawnAround puts characters in a ring around the player, on the ground (not around a map point).
 *   2. PROOF: Entities publishes a read-only window.__nbEntities; the playtest's page hook measures, with the game's own
 *      camera, how many hostiles are alive, the nearest one's distance and how many are in view; MISSING_ENEMIES is said
 *      to the builder when enemies were asked for and none can be met — or when the game makes them outside Entities.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';
import { PLACEHOLDER_PAGE_HOOK, pagePlaceholderFindings, missingEnemiesFinding, ENEMY_NEAR_M } from '../src/server/AgentV3/gamePlaceholderProbe';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-enemies-${process.pid}`);
let E: any;
/** The page's window: the kit publishes to it, the playtest's hook reads from it. */
const win: any = { addEventListener: () => {} };
beforeAll(async () => {
  (globalThis as any).window = win;
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

function host(px = 120, pz = -80) {
  const scene = new THREE.Scene();
  const player = { object: new THREE.Object3D() };
  player.object.position.set(px, 0, pz);
  scene.add(player.object);
  return { scene, player, onStep: () => () => {} };
}

/** The real playtest page hook, run against this window, seeing what a renderer would draw. */
function pageHook(scene: THREE.Scene, camera: THREE.Camera) {
  const hub = new EventTarget();
  win.__THREE_DEVTOOLS__ = hub;
  new Function('window', 'location', `return (${PLACEHOLDER_PAGE_HOOK})`)(win, { href: 'http://localhost/' })();
  const renderer = { render(_s: unknown, _c: unknown) { /* drawn */ } };
  hub.dispatchEvent(Object.assign(new Event('observe'), { detail: renderer }));
  camera.updateMatrixWorld(true);
  (camera as THREE.PerspectiveCamera).matrixWorldInverse.copy(camera.matrixWorld).invert();
  renderer.render(scene, camera);
  return () => win.__nbPlaceholders().characters;
}

describe('WHERE — enemies go in around the hero, on the ground', () => {
  it('spawnAround puts every one between near and far of the PLAYER (wherever the player is), in the scene, hostile', () => {
    const h = host(); const crowd = new E.Entities(h);
    const out = crowd.spawnAround(6, { kind: 'enemy' }, { near: 8, far: 20 });
    expect(out).toHaveLength(6);
    for (const e of out) {
      const d = Math.hypot(e.object.position.x - 120, e.object.position.z + 80);
      expect(d).toBeGreaterThanOrEqual(7.99); expect(d).toBeLessThanOrEqual(20.01);
      expect(e.hostile).toBe(true);
      let inScene = false; for (let o: THREE.Object3D | null = e.object; o; o = o.parent) if (o === h.scene) inScene = true;
      expect(inScene).toBe(true);
    }
    // Spread round the player, not in a clump on one side.
    const angles = out.map((e: any) => Math.atan2(e.object.position.z + 80, e.object.position.x - 120));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI);
    crowd.dispose();
  });
});

describe('PROOF — the playtest can see whether an asked-for enemy is there', () => {
  it('Entities publishes every live character and the player read-only, and takes the hook away when disposed', () => {
    const h = host(); const crowd = new E.Entities(h);
    crowd.spawn({ x: 125, z: -80, kind: 'enemy' }); crowd.spawn({ x: 110, z: -70, kind: 'villager' });
    const read = win.__nbEntities();
    expect(read.spawned).toBeGreaterThanOrEqual(2);
    expect(read.player).toEqual([120, 0, -80]);
    expect(read.list.filter((r: any[]) => r[1] === 1 && r[2] === 1)).toHaveLength(1); // one hostile, alive
    crowd.dispose();
    expect(win.__nbEntities).toBeUndefined();
  });

  it('the real page hook counts the hostile in the game camera\'s frame, and not one behind it', () => {
    const h = host(0, 0); const crowd = new E.Entities(h);
    crowd.spawn({ x: 0, z: -10, kind: 'enemy' }); // in front of a camera looking down -Z
    crowd.spawn({ x: 0, z: 30, kind: 'enemy' });  // behind it
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500); cam.position.set(0, 1.6, 2); cam.lookAt(0, 1.2, -10);
    const read = pageHook(h.scene, cam)();
    expect(read).toMatchObject({ hostiles: 2, inView: 1 });
    expect(read.nearestM).toBeCloseTo(10, 0);
    crowd.dispose();
  });

  it('enemies far from the hero (the report: a city\'s enemies round a fixed centre) are measured as far and out of view', () => {
    const h = host(0, 0); const crowd = new E.Entities(h);
    crowd.spawn({ x: 400, z: 400, kind: 'enemy' });
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500); cam.position.set(0, 1.6, 2); cam.lookAt(0, 1.2, -10);
    const read = pageHook(h.scene, cam)();
    expect(read.inView).toBe(0);
    expect(read.nearestM).toBeGreaterThan(ENEMY_NEAR_M);
    expect(missingEnemiesFinding(null, { characters: read })?.evidence).toMatch(/nearest stands 566 m from the player and none was in view/);
    crowd.dispose();
  });
});

describe('MISSING_ENEMIES — said to the builder only when enemies were asked for and none can be met', () => {
  const page = (characters: any) => ({ meshes: 50, characters });
  it('no hostile alive, a failed spawn, all far away, or enemies made outside Entities each name the cause and the fix', () => {
    expect(missingEnemiesFinding(null, page({ spawned: 0, failed: 0, hostiles: 0 }))?.evidence).toMatch(/no hostile character was alive in the game \(none was spawned\)/);
    expect(missingEnemiesFinding(null, page({ spawned: 0, failed: 3, hostiles: 0 }))?.evidence).toMatch(/3 spawns failed and were rolled back/);
    expect(missingEnemiesFinding(null, page({ spawned: 4, failed: 0, hostiles: 4, nearestM: 300, inView: 0 }))?.fix).toMatch(/spawnAround/);
    const outside = missingEnemiesFinding(null, page(null))!;
    expect(outside.evidence).toMatch(/does not create them with the kit's Entities/);
    expect(outside.fix).toMatch(/new Entities\(ctx/);
  });
  it('a hostile near the hero, or one in view, passes; a page never read says nothing', () => {
    expect(missingEnemiesFinding(null, page({ spawned: 3, hostiles: 3, nearestM: 12, inView: 0 }))).toBeNull();
    expect(missingEnemiesFinding(null, page({ spawned: 3, hostiles: 3, nearestM: 200, inView: 1 }))).toBeNull();
    expect(missingEnemiesFinding(null, null)).toBeNull();
  });
  it('it is looked for ONLY when the request asked for enemies, and it comes first in the list', () => {
    const none = page({ spawned: 0, failed: 0, hostiles: 0 });
    expect(pagePlaceholderFindings(null, none, null).some((f) => f.kind === 'MISSING_ENEMIES')).toBe(false);
    expect(pagePlaceholderFindings(null, { ...none, meshes: 1 }, null, { enemies: true })[0].kind).toBe('MISSING_ENEMIES');
    expect(readFileSync('src/server/AgentV3/buildPhases/gamePlaytestPhase.ts', 'utf8')).toMatch(/\{ enemies: !!p\.contract\?\.requiredFeatures\.includes\('enemies'\) \}/);
  });
  it('the builder is told to put enemies where the hero is', () => {
    expect(readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8')).toMatch(/ENEMIES GO WHERE THE HERO IS: npcs\.spawnAround/);
  });
});
