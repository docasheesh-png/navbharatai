// THE SHELL NEVER LIFTS THE WORLD ITSELF (failedbr #2559–#2561, 2026-11-27: "characters jameen me ghus rahe hai … road ke
// upar ek ajeeb si parat … gaadiyan hawa me").
//
// Reproduced in a real browser on the seeded PUBG game: the game shell's per-frame clamp (groundScene, every fixed step)
// lifts every top-level scene object whose ORIGIN is under the ground. Since the open world gave the kit its ground
// (setGround, 2026-11-26), that clamp also reached the WORLD'S OWN CONTAINERS: the map's chunk group (terrain, sea, plants,
// roads) sits at render (0, 0, 0) and was lifted to the land's height there — 1.3 m on one project, 41.7 m on another,
// ratcheting up with every origin shift — so the hero, the people, the streets and the cars stood under a green sheet, and
// the highways floated in the sky. Node tests never ran the shell's step, so they never saw it.
//
// The class: "a container that IS ground, or holds things grounded one by one, has no opt-out mark, so the clamp treats its
// origin as a standing point". Locked by running the REAL shell clamp after the real open world's frames on a map whose land
// is high at the origin: nothing the world itself put in the scene moves, and the kit's own geometry report says 0 off.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-shell-lift-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let SURF: any;
const g = globalThis as any;
const hadWindow = 'window' in g;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  if (!hadWindow) g.window = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  SURF = await import(join(DIR, 'src/game/three/surfaces.ts'));
}, 120_000);
afterAll(() => { if (!hadWindow) delete g.window; rmSync(DIR, { recursive: true, force: true }); });

/** The seeded PUBG world (gameKitRecipeInput for "ek pubg jaisa game banao … 3-4 city/village"), 10 km across. */
const PUBG_REGIONS = [{ id: 'main-city', kind: 'city' }, { id: 'city-2', kind: 'city' }, { id: 'city-3', kind: 'city' }, { id: 'city-4', kind: 'city' }, { id: 'main-village', kind: 'village' }];

function world(seed: number) {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const ctx: any = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 2000), vehicles: { add: () => {}, seated: null } };
  const w = OW.createOpenWorld(ctx, { seed, regions: PUBG_REGIONS, spreadMeters: 10000, city: true, vegetation: false });
  return { scene, ctx, w };
}

describe('🌍 the shell\'s ground clamp never moves the world itself', () => {
  it('🔴 on a map whose land is HIGH at the render origin: after frames + the shell step, every world container stays where the world put it', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Seeds whose land under the render origin is well above zero (the browser repro measured 1.3 m to 135 m of lift).
    let checked = 0;
    for (const seed of [7, 11, 23]) {
      const { scene, ctx, w } = world(seed);
      for (let i = 0; i < 30; i++) w.frame(ctx, 1 / 60);
      const o = w.map.chunks.origin;
      const landAtOrigin = w.map.world.heightAt(o.x, o.z);
      const before = new Map(scene.children.map((c) => [c, c.position.y]));
      // The real per-frame step the game shell runs (GameShellGenerator: groundScene(this.scene) in fixedUpdate), several times.
      for (let i = 0; i < 5; i++) { SURF.groundScene(scene); w.frame(ctx, 1 / 60); }
      for (const c of scene.children) {
        if (c === ctx.player.object || c.userData.nbBody === true) continue;   // bodies are the clamp's job
        expect(c.position.y, `"${c.name || c.type}" was moved by the shell's ground clamp (seed ${seed}, land at the origin ${landAtOrigin.toFixed(1)} m)`).toBeCloseTo(before.get(c) ?? c.position.y, 6);
      }
      expect(w.map.chunks.group.position.y, `the terrain group (seed ${seed})`).toBe(0);
      const geo = w.geometry ? w.geometry() : (g.window.__nbWorld?.geometry?.() ?? null);
      if (geo?.terrain) expect(geo.terrain.off, `drawn terrain vs heightAt (seed ${seed})`).toBe(0);
      if (Math.abs(landAtOrigin) > 0.5) checked++;
      w.dispose?.();
    }
    expect(checked, 'at least one seed must have high land at the origin, or this test proves nothing').toBeGreaterThan(0);
    err.mockRestore();
  }, 240_000);

  it('a thing the GAME adds with no mark is still grounded (the guarantee the clamp exists for is kept)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scene, ctx, w } = world(7);
    for (let i = 0; i < 10; i++) w.frame(ctx, 1 / 60);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); crate.position.set(ctx.player.object.position.x + 3, -50, ctx.player.object.position.z);
    scene.add(crate);
    SURF.groundScene(scene);
    const o = w.map.chunks.origin;
    expect(crate.position.y).toBeGreaterThanOrEqual(w.map.world.heightAt(crate.position.x + o.x, crate.position.z + o.z) - 1e-3);
    w.dispose?.();
    err.mockRestore();
  }, 120_000);
});

describe('📣 the playtest tells the truth about a moved world', () => {
  it('a moved world container is named as a KIT fault, and the builder is not sent to move levelGround', async () => {
    const { geometryFindings } = await import('../src/server/AgentV3/gameGeometryProbe');
    // The ws-repro-1 shape from the browser repro: every terrain sample 41.7 m off, because the terrain group itself was lifted.
    const lines = geometryFindings({ terrain: { samples: 387, off: 387, worst: 41.7 }, moved: { worst: 41.7, name: 'the terrain' } });
    expect(lines[0]).toMatch(/^The world's own part "the terrain" was drawn 41\.7 m away from where the world put it/);
    expect(lines[0]).toMatch(/fault in the game kit, not in this game's code/);
    expect(lines.join('\n')).not.toMatch(/the ground was changed after it was drawn/);
    // A real late edit (nothing moved) still gets the late-edit advice.
    expect(geometryFindings({ terrain: { samples: 40, off: 6, worst: 3.2 }, moved: { worst: 0, name: '' } })[0]).toMatch(/the ground was changed after it was drawn/);
  });
  it('🔒 the kit\'s geometry report measures the world\'s own containers', () => {
    const src = recipeFilePool().get(OPEN_WORLD_BRIDGE_PATH)?.content ?? '';
    expect(src).toMatch(/movedBy\(chunks\.group, 0, 'the terrain'\); movedBy\(roadGroup, 0, 'the highways'\); movedBy\(edgeGroup, 0, 'the map edge'\);/);
    expect(src).toMatch(/moved: \{ worst: r1\(moved\), name: movedName \}/);
  });
});
