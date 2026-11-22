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
    // Since the universe change (2026-11-22) every place is PLANNED at once and its city is BUILT when the player comes near.
    expect(world.places.map((p: any) => p.id)).toEqual(['main-city', 'old-town', 'hill-village']);
    expect(world.regions.map((r: any) => r.id)).toEqual(['main-city']);
    expect(world.city).toBe(world.regions[0]);
    for (const p of world.places) {
      const hs: number[] = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) hs.push(world.heightAt(p.centre.x + (i / 2) * p.radius * 0.6, p.centre.z + (j / 2) * p.radius * 0.6));
      expect(Math.max(...hs) - Math.min(...hs), p.id).toBeLessThan(0.01);          // level under every place, built or not
      expect(world.map.world.clearAt(p.centre.x, p.centre.z), p.id).toBe(true);
    }
    // Spread apart: no two places touch, with open country between them.
    for (let x = 0; x < 3; x++) for (let y = x + 1; y < 3; y++) {
      const A = world.places[x], B = world.places[y];
      expect(Math.hypot(A.centre.x - B.centre.x, A.centre.z - B.centre.z)).toBeGreaterThan(A.radius + B.radius + 100);
    }
    // The town was asked for to the EAST of the first place (+x), and is a journey away.
    expect(world.places[1].centre.x - world.places[0].centre.x).toBeGreaterThan(300);
    const near = world.nearestRegion();
    expect(near.region.id).toBe('main-city');
    world.dispose();
  }, 120_000);

  it('a far place is not built until the player comes near it — then it is, and it runs its streets', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: [
      { id: 'a', kind: 'village', city: small },
      { id: 'b', kind: 'village', toward: 'north', distance: 6000, city: small },
    ] });
    for (let i = 0; i < 10; i++) world.frame(c.ctx, 1 / 60);
    expect(world.places.map((p: any) => [p.id, p.built])).toEqual([['a', true], ['b', false]]);
    expect(c.scene.children.filter((o: any) => /^Region /.test(o.name)).map((o: any) => o.name)).toEqual(['Region a']);
    // Walk (teleport) to b: it is built on the next frame, and only then.
    const b = world.places[1];
    const origin = world.map.chunks.origin;
    c.player.reset(b.centre.x - origin.x, world.heightAt(b.centre.x, b.centre.z) + 1, b.centre.z - origin.z);
    world.frame(c.ctx, 1 / 60);
    expect(world.places[1].built).toBe(true);
    expect(world.regions.map((r: any) => r.id)).toEqual(['a', 'b']);
    const town = world.regions[1];
    const before = town.traffic.cars.map((car: any) => car.along);
    for (let i = 0; i < 30; i++) world.frame(c.ctx, 1 / 60);
    expect(town.traffic.cars.map((car: any) => car.along)).not.toEqual(before);    // its streets run while the player is there
    world.dispose();
  }, 120_000);

  it('an id only once, and the old city option is still the first place', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, city: { blocksX: 2, blocksZ: 2, ...small }, regions: [{ id: 'x', kind: 'village', city: small }, { id: 'x', kind: 'town', city: small }] });
    expect(world.places.map((p: any) => p.id)).toEqual(['city', 'x']);
    world.dispose();
    errors.mockRestore();
  }, 120_000);

  it('🌌 a universe: 100 places and lands on one map, planned at once, started fast, only the first city built', () => {
    const c = context();
    const kinds = ['city', 'town', 'village', 'desert', 'jungle', 'mountain', 'snow', 'beach'];
    const regions = Array.from({ length: 110 }, (_, i) => ({ id: `r${i}`, kind: kinds[i % kinds.length], city: small }));
    const t0 = Date.now();
    const world = OW.createOpenWorld(c.ctx, { seed: 5, regions });
    const took = Date.now() - t0;
    expect(world.places.length + world.lands.length).toBe(100);                        // the limit is 100, not 12
    expect(world.regions.length).toBe(1);                                               // one city built; the rest when reached
    expect(took).toBeLessThan(20_000);
    // Spread over the land, never stacked: every pair of places stands apart.
    const all = [...world.places.map((p: any) => ({ ...p.centre, r: p.radius })), ...world.lands.map((l: any) => ({ ...l.centre, r: l.radius }))];
    let overlaps = 0;
    for (let x = 0; x < all.length; x++) for (let y = x + 1; y < all.length; y++) if (Math.hypot(all[x].x - all[y].x, all[x].z - all[y].z) < all[x].r * 0.5 + all[y].r * 0.5) overlaps++;
    expect(overlaps).toBe(0);
    world.dispose();
  }, 180_000);
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
