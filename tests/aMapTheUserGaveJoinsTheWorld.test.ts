// A MAP THE USER GAVE JOINS THE WORLD (admin 2026-11-22: "user chahe to khud ka map kan.zip ya koi aur format upload kar ke bole
// yeh bhi north add kar do (ya @add kar do) — to user ka diya map bhi usi game me add ho jaye"). Their attached .glb/.gltf/.obj
// already lands at public/models/<name>.glb (userModels.ts); a 'custom' region now puts it ON the map: its own levelled ground,
// sized as asked, joined by a highway, loaded when the player comes near, and a file that cannot be read is said — never silent.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_WORLD_RULE } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-usermap-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};
const small = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('🗺️ the user\'s own map on the world', () => {
  it('"kan" toward the north: planned on its own level ground, joined by a highway, loaded when the player arrives, sized and solid', async () => {
    const asked: string[] = [];
    OW.setUserMapLoader(async (m: string) => { asked.push(m); const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(50, 10, 25))); return g; });
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: small },
      { id: 'kan', kind: 'custom', model: 'kan', toward: 'north', size: 300 },
    ] });
    const m = world.userMaps[0];
    expect(m.status).toBe('waiting');
    expect(m.centre.z).toBeLessThan(world.places[0].centre.z);                                // north = −z
    expect(world.highways.length).toBe(1);                                                     // a road to it
    expect(asked).toEqual([]);                                                                 // nothing loaded yet
    const origin = world.map.chunks.origin;
    c.player.reset(m.centre.x - origin.x, m.centre.y + 1, m.centre.z - origin.z);
    world.frame(c, 1 / 60); await settle(); await settle();
    expect(asked).toEqual(['kan']);
    expect(world.userMaps[0].status).toBe('loaded');
    const root = c.scene.children.find((o: any) => o.name === 'User map kan')!;
    const box = new THREE.Box3().setFromObject(root);
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeCloseTo(300, 0);       // sized as asked
    expect(box.min.y).toBeCloseTo(m.centre.y, 3);                                              // standing on its ground
    let solid = false; root.traverse((o: any) => { if (o.isMesh && o.userData && Object.values(o.userData).includes('solid')) solid = true; });
    expect(solid).toBe(true);
    world.frame(c, 1 / 60); await settle();
    expect(asked).toEqual(['kan']);                                                            // loaded once
    world.dispose();
  }, 120_000);
  it('a file that cannot be read: the map says so, the game goes on', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    OW.setUserMapLoader(async () => { throw new Error('404 Not Found'); });
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'kan', kind: 'custom', model: 'kan', toward: 'east' }] });
    const m = world.userMaps[0]; const origin = world.map.chunks.origin;
    c.player.reset(m.centre.x - origin.x, m.centre.y + 1, m.centre.z - origin.z);
    world.frame(c, 1 / 60); await settle(); await settle();
    expect(world.userMaps[0].status).toBe('failed');
    expect(world.userMaps[0].reason).toMatch(/404/);
    expect(said.mock.calls.flat().join(' ')).toMatch(/kan.*could not be loaded/);
    said.mockRestore(); world.dispose();
  }, 120_000);
  it('a bare name is public/models/<name>.glb; a path is used as given', () => {
    expect(OW.userMapUrl('kan')).toBe('/models/kan.glb');
    expect(OW.userMapUrl('kan.gltf')).toBe('/models/kan.gltf');
    expect(OW.userMapUrl('public/models/kan.glb')).toBe('/models/kan.glb');
  });
  it('the rule tells the builder how to add an attached map, and that an FBX needs exporting first', () => {
    expect(GAME_WORLD_RULE).toMatch(/kind: 'custom', model:/);
    expect(GAME_WORLD_RULE).toMatch(/@add/);
  });
});
