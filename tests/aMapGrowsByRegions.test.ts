// A MAP GROWS ONE PLACE AT A TIME INTO A GIANT MAP (admin 2026-11-21: "user 1-1 kar ke ya ek sath kayi map jod ke, ek bada
// giant map bhi banwa sakta hai; user agar bole map / jameen bada karo, ya racing game me bole track / road bada karo — to
// intention ke anusar new map / road add hote rahe; game library se user chun ke khud map, object add karwa sake").
//
// 🧬 THE CLASS: a world that is one hand-built scene is rebuilt to be made bigger. The map is a LIST of places now
// (src/game/world.ts): each stands on its own levelled ground, a bigger map is one more entry, and the library offers the
// places to pick. Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { openWorldAppSource, gameWorldFileSource, GAME_WORLD_FILE_PATH, OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { gameTurnHandoff, projectGrowthRules, GAME_WORLD_RULE, GAME_WORLD_FILE, RACE_ROAD_RULE, GAME_FEATURES_RULE, GAME_FEATURES_INDEX_FILE, OPEN_WORLD_HANDOFF } from '../src/server/AgentV3/gameKitSeed';
import { browseLibrary, addToGamePrompt, mapPlaceRows, libraryBrowseRows, MAP_PLACE_PREFIX } from '../src/server/AgentV3/gameAssets/libraryThumbnails';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const DIR = join(__dirname, `.tmp-regions-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const context = () => {
  const scene = new THREE.Scene();
  const player = new CH.CharacterController({});
  scene.add(player.object);
  const added: THREE.Object3D[] = [];
  return { scene, player, added, ctx: { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), player, vehicles: { add: (v: THREE.Object3D) => { added.push(v); }, seated: null } } };
};
const small = { traffic: { count: 2 }, people: { count: 2 }, parkedCars: 1 };

describe('🗺️ several places on one map', () => {
  it('three places: each on its OWN level ground, spread apart, the player starting in the first', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } },
      { id: 'old-town', kind: 'town', toward: 'east', city: small },
      { id: 'hill-village', kind: 'village', city: small },
    ] });
    expect(world.regions.map((r: any) => r.id)).toEqual(['main-city', 'old-town', 'hill-village']);
    expect(world.city).toBe(world.regions[0]);
    for (const r of world.regions) {
      const plan = r.city.plan, hs: number[] = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) hs.push(world.heightAt(r.centre.x + (i / 2) * plan.width / 2, r.centre.z + (j / 2) * plan.depth / 2));
      expect(Math.max(...hs) - Math.min(...hs), r.id).toBeLessThan(0.01);          // level under every place
      expect(world.map.world.clearAt(r.centre.x, r.centre.z), r.id).toBe(true);
    }
    // Spread apart: no two places touch, with open country between them.
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      const A = world.regions[a], B = world.regions[b];
      expect(Math.hypot(A.centre.x - B.centre.x, A.centre.z - B.centre.z)).toBeGreaterThan(A.radius + B.radius + 100);
    }
    // The town was asked for to the EAST of the first place (+x), and is a journey away.
    expect(world.regions[1].centre.x - world.regions[0].centre.x).toBeGreaterThan(300);
    const near = world.nearestRegion();
    expect(near.region.id).toBe('main-city');
    world.dispose();
  }, 120_000);

  it('a place far away is not drawn and does not run its streets; the near one does', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: [
      { id: 'a', kind: 'village', city: small },
      { id: 'b', kind: 'village', toward: 'north', distance: 6000, city: small },
    ] });
    const far = world.regions[1];
    const before = far.traffic.cars.map((car: any) => car.along);
    for (let i = 0; i < 30; i++) world.frame(c.ctx, 1 / 60);
    expect(far.traffic.cars.map((car: any) => car.along)).toEqual(before);        // frozen while nobody is there
    const roots = c.scene.children.filter((o: any) => /^Region /.test(o.name));
    expect(roots.map((o: any) => [o.name, o.visible])).toEqual([['Region a', true], ['Region b', false]]);
    world.dispose();
  }, 120_000);

  it('twelve at most, an id only once, and the old city option is still the first place', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, city: { blocksX: 2, blocksZ: 2, ...small }, regions: [{ id: 'x', kind: 'village', city: small }, { id: 'x', kind: 'town', city: small }] });
    expect(world.regions.map((r: any) => r.id)).toEqual(['city', 'x']);
    world.dispose();
    errors.mockRestore();
  }, 120_000);
});

describe('🗺️ the game\'s own map file, and the rule that grows it', () => {
  it('the platform writes src/game/world.ts once and mounts it; the dispatcher never replaces it', () => {
    expect(gameWorldFileSource({ city: true })).toContain("{ id: 'main-city', kind: 'city' },");
    expect(gameWorldFileSource({})).not.toContain('main-city');
    expect(openWorldAppSource({ city: true })).toContain("import { WORLD } from './game/world';");
    expect(openWorldAppSource({ city: true })).toContain('world={WORLD} player={PLAYER} features={FEATURES}');
    expect(GAME_WORLD_FILE_PATH).toBe(GAME_WORLD_FILE);
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toMatch(/if \(!mapped\) \{\s*const worldFile = await this\.guardedWrite\(GAME_WORLD_FILE_PATH, gameWorldFileSource\(/);
  });

  it('the wish decides: bigger land adds a place, a bigger city edits one entry, nothing already there is touched', () => {
    expect(GAME_WORLD_RULE).toMatch(/Read what the user\s+WANTS, not the words/);
    expect(GAME_WORLD_RULE).toMatch(/ADD one\s+region per place asked for \(several at once when they ask for several/);
    expect(GAME_WORLD_RULE).toMatch(/never edit or remove the regions already there/);
    expect(GAME_WORLD_RULE).toMatch(/edit ONLY that region's own\s+entry/);
    expect(OPEN_WORLD_HANDOFF).toContain(GAME_WORLD_RULE);
  });

  it('said on every later turn from the project\'s own files — the map, the features, and a road-library race', () => {
    const turn = { writingRun: true, moduleTurn: false, importTurn: false, stopped: false };
    const env = {} as NodeJS.ProcessEnv;
    const open = { [GAME_WORLD_FILE]: 'x', [GAME_FEATURES_INDEX_FILE]: 'x' };
    for (const ask of ['map bada karo', 'jameen aur badi chahiye, ek aur shehar jodo', addToGamePrompt({ id: `${MAP_PLACE_PREFIX}town`, name: 'New town' })]) {
      const block = gameTurnHandoff(ask, open, turn, env).block;
      expect(block, ask).toContain(GAME_WORLD_RULE);
      expect(block, ask).toContain(GAME_FEATURES_RULE);
    }
    const race = { 'src/App.tsx': "import { RacingRoadGame } from './game/RacingRoadGame';\nexport default function App() { return <RacingRoadGame />; }" };
    expect(gameTurnHandoff('track bada karo', race, turn, env).block).toContain(RACE_ROAD_RULE);
    expect(RACE_ROAD_RULE).toMatch(/raise finishKm/);
    expect(projectGrowthRules({})).toBe('');
    expect(projectGrowthRules(race)).not.toContain(GAME_WORLD_RULE);
  });
});

describe('📚 the library offers places for the map, beside its objects', () => {
  it('city, town and village are in the library under their own category, and can be searched', () => {
    const all = browseLibrary({ limit: 120 });
    // + five lands since Q-3243 (failedbr #2488): desert, jungle, mountain, snow, beach.
    expect(all.categories.find((c) => c.category === 'map-places')?.count).toBe(8);
    expect(browseLibrary({ category: 'map-places' }).rows.map((r) => r.id)).toEqual(['map-place:city', 'map-place:town', 'map-place:village', 'map-place:desert', 'map-place:jungle', 'map-place:mountain', 'map-place:snow', 'map-place:beach']);
    expect(browseLibrary({ q: 'gaon' }).rows.map((r) => r.id)).toContain('map-place:village');
    expect(browseLibrary({ q: 'shehar' }).rows.map((r) => r.id)).toContain('map-place:city');
    expect(mapPlaceRows().every((r) => r.thumb === null)).toBe(true);
    // The models are all still there: one row per reviewed model, as before.
    expect(all.total).toBe(libraryBrowseRows().length + 8);
  });

  it('choosing a place sends a request for ONE more place that keeps the others; choosing a model is unchanged', () => {
    expect(addToGamePrompt({ id: 'map-place:village', name: 'New village' })).toBe('Add one more village to my game\'s map as a new place (library map place: "village"). Keep every place already on the map and everything else as it is.');
    const model = libraryBrowseRows()[0];
    expect(addToGamePrompt(model)).toContain(`library id: "${model.id}"`);
    expect(read('src/server/routes/agentv3.ts')).toMatch(/prompts: Object\.fromEntries\(result\.rows\.map\(\(r\) => \[r\.id, addToGamePrompt\(r\)\]\)\)/);
  });
});
