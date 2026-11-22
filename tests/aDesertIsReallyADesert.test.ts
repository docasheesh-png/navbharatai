// A DESERT IS REALLY A DESERT (failedbr #2488, Q-3243: "ek village, ek desert, ek jungle aur ek mountain" became three TOWNS
// named Desert / Jungle / Mountain). 🧬 Class: a name standing in for a thing the engine could not make. The map can now lay a
// land on part of itself — the biome, the colour, the plants and (for mountains) the height follow. Runs the REAL generated kit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { appendPlace, mapPlaceAsked } from '../src/server/AgentV3/worldGrow';
import { mapPlaceRows, addToGamePrompt } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { GAME_WORLD_RULE } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-lands-${process.pid}`);
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
const small = { traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };

describe('🏜️ lands on the map', () => {
  it('the #2488 request: a village plus a desert, a jungle and mountains — each land really is that land', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } },
      { id: 'village-1', kind: 'village', city: small },
      { id: 'east-desert', kind: 'desert', toward: 'east' },
      { id: 'south-jungle', kind: 'jungle', toward: 'south' },
      { id: 'west-mountains', kind: 'mountain', toward: 'west' },
    ] });
    expect(world.regions.map((r: any) => r.id)).toEqual(['main-city', 'village-1']);           // places have buildings
    expect(world.lands.map((l: any) => l.kind)).toEqual(['desert', 'jungle', 'mountain']);     // lands do not
    const at = (id: string) => world.lands.find((l: any) => l.id === id)!.centre;
    const d = at('east-desert'), j = at('south-jungle'), m = at('west-mountains');
    if (world.map.world.heightAt(d.x, d.z) >= 0) expect(world.map.world.biomeAt(d.x, d.z)).toBe('desert');
    if (world.map.world.heightAt(j.x, j.z) >= 0) expect(world.map.world.biomeAt(j.x, j.z)).toBe('forest');
    expect(['mountain', 'snow']).toContain(world.map.world.biomeAt(m.x, m.z));
    // The mountain land rises above the ground around it.
    const ring = [0, 1, 2, 3].map((k) => world.map.world.heightAt(m.x + Math.cos(k) * 900, m.z + Math.sin(k) * 900));
    expect(world.map.world.heightAt(m.x, m.z)).toBeGreaterThan(Math.max(...ring));
    // The lands lie toward where they were asked (east = +x, west = −x, south = +z from the first place).
    const c = world.regions[0].centre;
    expect(d.x).toBeGreaterThan(c.x); expect(m.x).toBeLessThan(c.x); expect(j.z).toBeGreaterThan(c.z);
    // The first place keeps its level ground.
    expect(world.map.world.clearAt(c.x, c.z)).toBe(true);
  });
  it('places and lands share the 12-region limit', () => {
    const regions = Array.from({ length: 14 }, (_, i) => ({ id: `d${i}`, kind: 'desert' }));
    const world = OW.createOpenWorld(context(), { seed: 3, regions });
    expect(world.regions.length + world.lands.length).toBe(12);
  });
});

describe('🧭 the builder and the library know the lands', () => {
  it('the map rule names the land kinds and forbids a renamed town', () => {
    expect(GAME_WORLD_RULE).toMatch(/lands: desert, jungle, mountain, snow, beach/);
    expect(GAME_WORLD_RULE).toMatch(/NEVER add a\s+town and name it "Desert"/);
  });
  it('the library offers each land, and picking one adds exactly one land entry', () => {
    const lands = mapPlaceRows().filter((r) => /desert|jungle|mountain|snow|beach/.test(r.id));
    expect(lands.map((r) => r.id.split(':')[1])).toEqual(['desert', 'jungle', 'mountain', 'snow', 'beach']);
    const ask = addToGamePrompt(lands[0]);
    expect(mapPlaceAsked(ask)).toBe('desert');
    const src = "export const WORLD = {\n  regions: [\n    { id: 'main-city', kind: 'city' },\n  ],\n};\n";
    const out = appendPlace(src, 'desert');
    expect(out.ok && out.source).toContain("{ id: 'desert-1', kind: 'desert' }");
  });
});
