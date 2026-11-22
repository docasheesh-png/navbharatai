// A CITY GROWS BY ITS OWN BLOCKS (admin 2026-11-22: "map/city ko bada karna — building/road ko clone kar kar ke, randomly add kar
// kar ke bada map ban jaye"). 🧬 Class: a city capped at one plan — "bigger" could only mean another separate place. A tile now
// joins a city edge to edge on its own grid: the same block size (the shared edge street is one street), the same ground level.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_WORLD_RULE } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-citygrow-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let CITY: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  CITY = await import(join(DIR, 'src/game/three/city.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};
const small = { blocksX: 3, blocksZ: 3, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };

describe('🏙️ a city that grows tile by tile', () => {
  it('a tile toward the east stands edge to edge, its edge street ON the city\'s edge street, at the same level', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: small },
      { id: 'main-city-2', kind: 'city', joinTo: 'main-city', toward: 'east' },
    ] });
    const [a, b] = world.places;
    const plan = CITY.planCity({ blocksX: 3, blocksZ: 3 });
    expect(b.centre.x - a.centre.x).toBeCloseTo(plan.width - plan.road, 5);                 // the shared street is one street
    expect(b.centre.z).toBeCloseTo(a.centre.z, 5);
    // One level across both tiles and the seam between them.
    const ys = [a.centre.x, (a.centre.x + b.centre.x) / 2, b.centre.x].map((x) => world.heightAt(x, a.centre.z));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
    expect(world.highways.length).toBe(0);                                                    // touching tiles need no highway
    world.dispose();
  }, 120_000);
  it('ten tiles with no direction grow around the city at random, never on top of each other, into one block of streets', () => {
    const regions = [{ id: 'main-city', kind: 'city', city: small }, ...Array.from({ length: 10 }, (_, i) => ({ id: `main-city-${i + 2}`, kind: 'city', joinTo: 'main-city' }))];
    const world = OW.createOpenWorld(context(), { seed: 3, regions });
    const plan = CITY.planCity({ blocksX: 3, blocksZ: 3 });
    const step = plan.width - plan.road;
    const cells = world.places.map((p: any) => `${Math.round((p.centre.x - world.places[0].centre.x) / step)},${Math.round((p.centre.z - world.places[0].centre.z) / step)}`);
    expect(new Set(cells).size).toBe(11);                                                    // no two tiles on one cell
    // Every tile touches the city: some other tile is one step away.
    for (const c of cells) { const [x, z] = c.split(',').map(Number); expect(cells.some((o: string) => o !== c && Math.abs(Number(o.split(',')[0]) - x) + Math.abs(Number(o.split(',')[1]) - z) === 1)).toBe(true); }
    world.dispose();
  }, 120_000);
  it('the rule tells the builder: a bigger city is joined tiles', () => {
    expect(GAME_WORLD_RULE).toMatch(/joinTo/);
    expect(GAME_WORLD_RULE).toMatch(/shehar bada karo/i);
  });
});
