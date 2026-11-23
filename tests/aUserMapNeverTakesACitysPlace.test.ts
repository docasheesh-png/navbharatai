// A USER'S MAP NEVER TAKES A CITY'S PLACE (maps autopsy 2026-11-23, D1). The open world kept one list of roots for the places it
// built AND the user maps it loaded, while every place was read back by its index in that list. Once a user's map had loaded,
// each city built after it moved, hid and disposed its neighbour's root: the user's map vanished when the player walked away
// from that city, the city itself never hid, and ending the game left the city in the scene. A user map now has its own list.
// D2: the recipe's own instructions said "up to 12" places while the rule and the code hold 100.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_OPEN_WORLD_BRIDGE, OPEN_WORLD_BRIDGE_PATH, OPEN_WORLD_MAX_REGIONS, generateOpenWorld } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-userroots-${process.pid}`);
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
const named = (c: any, name: string) => c.scene.children.find((o: any) => o.name === name);
const goTo = (c: any, world: any, x: number, z: number) => {
  const o = world.map.chunks.origin;
  c.player.reset(x - o.x, world.heightAt(x, z) + 1, z - o.z);
  world.frame(c, 1 / 60);
};

describe('🗺️ a user map and the cities built after it keep their own roots', () => {
  it('user map loads, then a city is built: the city hides when far, the user map stays, both follow an origin shift, dispose removes both', async () => {
    OW.setUserMapLoader(async () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(40, 8, 40))); return g; });
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [
      { id: 'home', kind: 'city', city: small },
      { id: 'kan', kind: 'custom', model: 'kan', toward: 'north', distance: 7000, size: 200 },
      { id: 'far-town', kind: 'town', toward: 'south', city: small },
    ] });
    const m = world.userMaps[0];
    goTo(c, world, m.centre.x, m.centre.z); await settle(); await settle();
    expect(world.userMaps[0].status).toBe('loaded');
    const userRoot = named(c, 'User map kan');
    expect(userRoot).toBeTruthy();
    const town = world.places.find((p: any) => p.id === 'far-town');
    expect(town.built).toBe(false);                                     // the order that broke: the user map first, then the city

    goTo(c, world, town.centre.x, town.centre.z);
    expect(town.built).toBe(true);
    const townRoot = named(c, 'Region far-town');
    expect(townRoot).toBeTruthy();
    expect(townRoot.visible).toBe(true);

    // Far from everything (and far enough that the render origin shifts): the town hides; the user's map is never hidden by it.
    const userWorldX = userRoot.position.x + world.map.chunks.origin.x;
    const userWorldZ = userRoot.position.z + world.map.chunks.origin.z;
    goTo(c, world, town.centre.x + 9000, town.centre.z + 4000);
    goTo(c, world, town.centre.x + 9000, town.centre.z + 4000);
    expect(townRoot.visible).toBe(false);
    expect(userRoot.visible).toBe(true);
    expect(userRoot.position.x + world.map.chunks.origin.x).toBeCloseTo(userWorldX, 6);
    expect(userRoot.position.z + world.map.chunks.origin.z).toBeCloseTo(userWorldZ, 6);

    world.dispose();
    expect(named(c, 'Region far-town')).toBeUndefined();
    expect(named(c, 'Region home')).toBeUndefined();
    expect(named(c, 'User map kan')).toBeUndefined();
  }, 180_000);

  it('a user map that finishes loading after the game ended is never added to the scene', async () => {
    let finish: (g: THREE.Group) => void = () => {};
    OW.setUserMapLoader(() => new Promise<THREE.Group>((r) => { finish = r; }));
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'home', kind: 'city', city: small }, { id: 'kan', kind: 'custom', model: 'kan', toward: 'east', size: 200 }] });
    const m = world.userMaps[0];
    goTo(c, world, m.centre.x, m.centre.z);
    expect(world.userMaps[0].status).toBe('loading');
    world.dispose();
    finish(new THREE.Group()); await settle(); await settle();
    expect(named(c, 'User map kan')).toBeUndefined();
  }, 120_000);

  it('a world with no user map: cities hide and dispose exactly as before', async () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'home', kind: 'city', city: small }] });
    const home = named(c, 'Region home');
    expect(home.visible).toBe(true);
    goTo(c, world, world.places[0].centre.x + 9000, world.places[0].centre.z + 9000);
    expect(home.visible).toBe(false);
    world.dispose();
    expect(named(c, 'Region home')).toBeUndefined();
  }, 120_000);
});

describe('D2: the recipe says the same cap as the code', () => {
  it('instructions name MAX_REGIONS, never the old "up to 12"', () => {
    const text = generateOpenWorld().instructions;
    expect(GAME_OPEN_WORLD_BRIDGE).toContain('export const MAX_REGIONS = ' + OPEN_WORLD_MAX_REGIONS + ';');
    expect(text).not.toMatch(/up to 12\b/);
    expect(text).toContain('up to ' + OPEN_WORLD_MAX_REGIONS + ', places and lands together');
  });
});
