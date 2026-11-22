// "CITY SIZE BADH KYU NAHI RAHA??" (admin 2026-11-22 — failedbr #2494 and #2495 of one GTA-style workspace).
//
// #2494 "4 bade map jod ke ek bada giant world banao": the saved copy read back was missing five kit files, so the kit refresh
// was blocked and play/openWorld.ts stayed at a version with no lands and no joinTo — while the builder's rule described both.
// Type errors for minutes, the growth guard refusing world.ts five times, features (regionExpansion, giantWorld …) that
// pretended to grow the map, and a summary claiming "707 km × 707 km, 12 regions" over a map put back as it began.
// #2495 "un citys aur village ko jod jod ke copy clone kar ke map ko 40km*40km banao … bich me realistic ghas ka maidan":
// separate cities instead of a city grown, 40 km ignored ("All conditions met"), a hand-made green circle for the field.
//
// Each class is locked here (Q-3300 … Q-3305). The kit parts run the REAL generated kit, headless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { planKitRefreshAgainstSandbox, recipeFilePool, type LayerFile } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH, gameWorldFileSource } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_WORLD_RULE, gameWorldRule, worldCapabilities, projectGrowthRules, GAME_WORLD_FILE, GAME_OPEN_WORLD_FILE } from '../src/server/AgentV3/gameKitSeed';
import { cityGrowthAsked, growCity, citiesOnMap, tilesWanted, mapSizeAskedKm, setMapSpread, worldWishAtTurnStart, worldClaimFacts, withPlatformHandoff } from '../src/server/AgentV3/worldTurn';
import { growthVerdict, growthRefusal, featurePretendsToGrowMap, parseRegions } from '../src/server/AgentV3/growthGuard';
import { auditSummaryClaims, worldClaims } from '../src/server/AgentV3/claimAudit';

const CURRENT_OPEN_WORLD = recipeFilePool().get(OPEN_WORLD_BRIDGE_PATH)!.content;
/** The shape of #2494's play/openWorld.ts: places only — no lands, no joinTo, no user maps, no spread, 12 places. */
const OLD_OPEN_WORLD = "export type RegionKind = 'city' | 'town' | 'village';\nexport interface WorldRegion { id: string; kind: RegionKind; toward?: Compass; city?: RegionCity }\nexport const MAX_REGIONS = 12;\n";
const ONE_CITY = gameWorldFileSource({ city: true });
const read = (files: Record<string, string>) => async (p: string): Promise<string> => { if (p in files) return files[p]; throw new Error('ENOENT: not found'); };

describe('Q-3300 — the kit refresh is planned against the sandbox, not a saved copy that misses files', () => {
  // A small kit: a.ts gained a name and an import of c.ts; b.ts imports a.ts; d.ts is a kit file in the same folder.
  const OLD_A = 'export const x = 1;\n', NEW_A = "import { z } from './c';\nexport const x = 1;\nexport const y = z;\n";
  const OLD_B = "import { x } from './a';\nexport const b = x;\n", NEW_B = "import { x, y } from './a';\nexport const b = x + y;\n";
  const C = 'export const z = 2;\n', OLD_D = 'export const d = 1;\n', NEW_D = 'export const d = 2;\n';
  const pool = new Map<string, LayerFile>([['k/a.ts', { recipe: 'r', content: NEW_A }], ['k/b.ts', { recipe: 'r', content: NEW_B }], ['k/c.ts', { recipe: 'r', content: C }], ['k/d.ts', { recipe: 'r', content: NEW_D }]]);
  const known = new Set([OLD_A, OLD_B, OLD_D]);
  const reasonOf = (_p: string, cur: string) => (known.has(cur) ? null : 'edited' as const);

  it('#2494: the read-back misses a kit file the sandbox HAS — the refresh still runs (it was blocked whole)', async () => {
    const saved = { 'k/a.ts': OLD_A, 'k/b.ts': OLD_B };                       // c.ts missing from the saved copy
    const sandbox = { ...saved, 'k/c.ts': C };                              // …but present in the sandbox, current
    const r = await planKitRefreshAgainstSandbox(saved, read(sandbox), pool, reasonOf);
    expect(r.blocked).toBeNull();
    expect(r.write).toEqual({ 'k/a.ts': NEW_A, 'k/b.ts': NEW_B });          // c.ts is already current: never rewritten
    expect(r.reconciled).toContain('k/c.ts');
  });
  it('an OLDER kit file the read-back missed is found in the sandbox and brought up to date too', async () => {
    const saved = { 'k/a.ts': OLD_A, 'k/b.ts': OLD_B, 'k/c.ts': C };
    const r = await planKitRefreshAgainstSandbox(saved, read({ ...saved, 'k/d.ts': OLD_D }), pool, reasonOf);
    expect(r.write['k/d.ts']).toBe(NEW_D);
  });
  it('a file somebody edited in the sandbox since it was saved is judged as the sandbox holds it — and never overwritten', async () => {
    const saved = { 'k/a.ts': OLD_A, 'k/b.ts': OLD_B, 'k/c.ts': C };
    const r = await planKitRefreshAgainstSandbox(saved, read({ ...saved, 'k/a.ts': 'export const x = 1; // mine\n' }), pool, reasonOf);
    expect(r.write['k/a.ts']).toBeUndefined();
    expect(r.blocked).toMatch(/b\.ts would need y from k\/a\.ts, which was edited/);
  });
  it('a target that cannot be read is never written over', async () => {
    const saved = { 'k/a.ts': OLD_A, 'k/b.ts': OLD_B, 'k/c.ts': C };
    const r = await planKitRefreshAgainstSandbox(saved, async () => { throw new Error('sandbox down'); }, pool, reasonOf);
    expect(r.write).toEqual({});
    expect(r.blocked).toMatch(/could not be read/);
  });
  it('the route calls it (one timed step) and reports what it judged from the sandbox', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("finalSteps.step('kit refresh read', () => planKitRefreshAgainstSandbox(projectFilesAtTurnStart!");
    expect(route).toContain('Judged as the sandbox holds them (the saved copy differed)');
  });
});

describe('Q-3301 — the map rule says only what THIS project\'s own kit can do', () => {
  it('the current kit: every capability, and the rule is exactly GAME_WORLD_RULE', () => {
    expect(worldCapabilities(CURRENT_OPEN_WORLD)).toEqual({ lands: ['desert', 'jungle', 'mountain', 'snow', 'beach', 'grassland'], joinTo: true, custom: true, spread: true, maxRegions: 100 });
    expect(gameWorldRule(CURRENT_OPEN_WORLD)).toBe(GAME_WORLD_RULE);
    expect(gameWorldRule(undefined)).toBe(GAME_WORLD_RULE);
  });
  it('#2494\'s older play/openWorld.ts: no lands, no joinTo, no spread — the rule does not advertise them and says so plainly', () => {
    const rule = gameWorldRule(OLD_OPEN_WORLD);
    expect(rule).not.toMatch(/kind: 'desert'/);
    expect(rule).not.toMatch(/joinTo: '/);
    expect(rule).not.toMatch(/spreadMeters =/);
    expect(rule).toMatch(/Up to 12 regions/);
    expect(rule).toMatch(/THIS GAME'S MAP FILE \(src\/game\/play\/openWorld\.ts\) is an older or edited copy and CANNOT: grow a city by joined tiles/);
    expect(rule).toMatch(/a desert land \(kind 'desert'\)/);
  });
  it('every later turn reads the project\'s own file', () => {
    expect(projectGrowthRules({ [GAME_WORLD_FILE]: ONE_CITY, [GAME_OPEN_WORLD_FILE]: OLD_OPEN_WORLD })).toContain(gameWorldRule(OLD_OPEN_WORLD));
    expect(projectGrowthRules({ [GAME_WORLD_FILE]: ONE_CITY, [GAME_OPEN_WORLD_FILE]: CURRENT_OPEN_WORLD })).toContain(GAME_WORLD_RULE);
  });
});

describe('Q-3302 — "shehar bada karo" grows ONE city with joined tiles, done by the platform', () => {
  it('reads the wish, and tells a bigger city from more cities', () => {
    for (const ask of ['city ka size badhao', 'shehar bada karo', 'yeh shehar aur bada karo', 'city ko copy clone kar ke jodo', 'city ko duplicate kar ke merge karo', 'expand the city', 'make the city bigger', 'city 4 guna badi karo'])
      expect(cityGrowthAsked(ask), ask).toBe('grow');
    for (const ask of ['map bada karo', 'city me traffic badhao', 'ek aur city jodo', 'make a city', 'police jodo'])
      expect(cityGrowthAsked(ask), ask).not.toBe('grow');
    // #2495 itself asks for separate cities AND a clone-join: not clear, so nothing is grown on a guess.
    expect(cityGrowthAsked('isme ek city aur village aur jodo, un citys aur village ko jod jod ke copy clone kar kar ke map ko 40km*40km banao! sirf ek city nahi 4 city ho aur 2 village hon')).toBe('mixed');
  });
  it('how many tiles: 3 by default (a 2 × 2 city), 8 for "bahut bada", N − 1 for "N guna"', () => {
    expect(tilesWanted('shehar bada karo')).toBe(3);
    expect(tilesWanted('shehar bahut bada karo')).toBe(8);
    expect(tilesWanted('city 4 guna badi karo')).toBe(3);
    expect(tilesWanted('city 25x bada karo')).toBe(24);
  });
  it('one city on the map: tiles join it, every entry already there kept byte for byte', () => {
    const g = growCity(ONE_CITY, 'shehar bahut bada karo east me', CURRENT_OPEN_WORLD);
    if (!g.ok) throw new Error(g.reason);
    expect(g.added).toEqual(['main-city-2', 'main-city-3', 'main-city-4', 'main-city-5', 'main-city-6', 'main-city-7', 'main-city-8', 'main-city-9']);
    expect(g.source).toContain("{ id: 'main-city-2', kind: 'city', joinTo: 'main-city', toward: 'east' },");
    expect(g.source).toContain("{ id: 'main-city', kind: 'city' },");
    expect(citiesOnMap(g.source)).toEqual([{ id: 'main-city', name: null, tiles: 9 }]);
    // Growing again continues the numbering, and still one city.
    const again = growCity(g.source, 'city ka size badhao', CURRENT_OPEN_WORLD);
    expect(again.ok && again.added[0]).toBe('main-city-10');
  });
  it('several cities and none named: nothing changes and the builder asks; one named: that one grows', () => {
    const map = ONE_CITY.replace("    { id: 'main-city', kind: 'city' },", "    { id: 'main-city', kind: 'city' },\n    { id: 'harbour-city', kind: 'city', name: 'Rampur' },");
    expect(growCity(map, 'shehar bada karo', CURRENT_OPEN_WORLD)).toMatchObject({ ok: false, reason: 'which-city' });
    expect(growCity(map, 'Rampur shehar bada karo', CURRENT_OPEN_WORLD)).toMatchObject({ ok: true, city: 'harbour-city' });
    expect(growCity(map, 'harbour city ka size badhao', CURRENT_OPEN_WORLD)).toMatchObject({ ok: true, city: 'harbour-city' });
  });
  it('an older kit that cannot join tiles: nothing faked', () => {
    expect(growCity(ONE_CITY, 'shehar bada karo', OLD_OPEN_WORLD)).toMatchObject({ ok: false, reason: 'no-joinTo' });
  });
  it('the turn: written once, the builder told it is done; the route carries one call', async () => {
    const files: Record<string, string> = { [GAME_WORLD_FILE]: ONE_CITY, [GAME_OPEN_WORLD_FILE]: CURRENT_OPEN_WORLD };
    const writes: Array<[string, string]> = []; const issues: string[] = [];
    const handoff = await worldWishAtTurnStart({ prompt: 'shehar bada karo', filesAtTurnStart: files, read: read(files), write: async (p, c) => { writes.push([p, c]); }, record: (i) => issues.push(i.code) });
    expect(writes.length).toBe(1);
    expect(parseRegions(writes[0][1])!.length).toBe(4);
    expect(handoff).toMatch(/ALREADY DONE BY THE PLATFORM: the city "main-city" was made bigger — 3 tile/);
    expect(issues).toEqual(['CITY_GROWN']);
    expect(await worldWishAtTurnStart({ skip: true, prompt: 'shehar bada karo', filesAtTurnStart: files, read: read(files), write: async () => {}, record: () => {} })).toBe('');
    expect(withPlatformHandoff('', 'p')).toBe('p');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('buildPrompt = withPlatformHandoff(await worldWishAtTurnStart({ skip: isImportTurn || !!projectModuleRef, prompt, filesAtTurnStart: projectFilesAtTurnStart');
  });
  it('the rule: a bigger city is joined tiles; a copy that is not joined grows nothing; unclear → ask', () => {
    expect(GAME_WORLD_RULE).toMatch(/city ka size badhao", "shehar ko copy \/ clone \/ duplicate kar\s+ke jodo"/);
    expect(GAME_WORLD_RULE).toMatch(/A copy that is NOT joined is a separate city far away and\s+makes no city bigger/);
    expect(GAME_WORLD_RULE).toMatch(/ask \(one short question\) and change nothing/);
  });
});

describe('Q-3303 — a map size the user names is set, or declined with the reason', () => {
  it('reads the size, never a speed or a race track', () => {
    expect(mapSizeAskedKm('map ko 40km*40km banao')).toBe(40);
    expect(mapSizeAskedKm('map 40 x 60 km ka banao')).toBe(60);
    expect(mapSizeAskedKm('50 km ka map chahiye')).toBe(50);
    expect(mapSizeAskedKm('car ki speed 100 km/h karo')).toBeNull();
    expect(mapSizeAskedKm('race track 20 km ka karo')).toBeNull();
    expect(mapSizeAskedKm('shehar bada karo')).toBeNull();
  });
  it('sets WORLD.spreadMeters (insert, then replace); declines above 1000 km or on an older kit', () => {
    const set = setMapSpread(ONE_CITY, 40, CURRENT_OPEN_WORLD);
    expect(set.ok && set.source).toContain('export const WORLD: OpenWorldOptions = {\n  spreadMeters: 40000,');
    const again = set.ok ? setMapSpread(set.source, 60, CURRENT_OPEN_WORLD) : null;
    expect(again?.ok && again.source.match(/spreadMeters:/g)!.length).toBe(1);
    expect(again?.ok && again.source).toContain('spreadMeters: 60000');
    expect(setMapSpread(ONE_CITY, 5000, CURRENT_OPEN_WORLD)).toMatchObject({ ok: false, reason: 'too-big' });
    expect(setMapSpread(ONE_CITY, 40, OLD_OPEN_WORLD)).toMatchObject({ ok: false, reason: 'no-spread' });
  });
  it('#2495\'s request: the size is set even though the city part is unclear (which is asked)', async () => {
    const files: Record<string, string> = { [GAME_WORLD_FILE]: ONE_CITY, [GAME_OPEN_WORLD_FILE]: CURRENT_OPEN_WORLD };
    let written = '';
    const handoff = await worldWishAtTurnStart({ prompt: 'isme ek city aur village aur jodo, un citys aur village ko jod jod ke copy clone kar kar ke map ko 40km*40km banao! sirf ek city nahi 4 city ho aur 2 village hon', filesAtTurnStart: files, read: read(files), write: async (_p, c) => { written = c; }, record: () => {} });
    expect(written).toContain('spreadMeters: 40000');
    expect(handoff).toMatch(/The platform did NOT make a city bigger/);
    expect(handoff).toMatch(/WORLD\.spreadMeters = 40000/);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-citygrows-${process.pid}`);
let OW: any; let CH: any; let CITY: any; let VEG: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  CITY = await import(join(DIR, 'src/game/three/city.ts'));
  VEG = await import(join(DIR, 'src/game/athree/vegetation.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};
const small = { blocksX: 3, blocksZ: 3, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };

describe('🏙️ the real kit, headless', () => {
  it('Q-3302: the platform\'s 24 tiles make ONE continuous city of 25 blocks — every tile touches another, none overlap, one level', () => {
    const g = growCity(ONE_CITY.replace("{ id: 'main-city', kind: 'city' }", "{ id: 'main-city', kind: 'city', city: { blocksX: 3, blocksZ: 3, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 } }"), 'city 25 guna bada karo', CURRENT_OPEN_WORLD);
    if (!g.ok) throw new Error(g.reason);
    const regions = parseRegions(g.source)!.map((r) => { const id = /id: '([^']+)'/.exec(r.text)![1]; return id === 'main-city' ? { id, kind: 'city', city: small } : { id, kind: 'city', joinTo: 'main-city' }; });
    expect(regions.length).toBe(25);
    const world = OW.createOpenWorld(context(), { seed: 5, regions });
    const plan = CITY.planCity({ blocksX: 3, blocksZ: 3 });
    const step = plan.width - plan.road, o = world.places[0].centre;
    const cells = world.places.map((p: any) => [Math.round((p.centre.x - o.x) / step), Math.round((p.centre.z - o.z) / step)]);
    expect(world.places.length).toBe(25);
    expect(new Set(cells.map((c: number[]) => c.join(','))).size).toBe(25);
    for (const [x, z] of cells) expect(cells.some(([a, b]: number[]) => Math.abs(a - x) + Math.abs(b - z) === 1)).toBe(true);
    const level = world.heightAt(o.x, o.z);
    for (const p of world.places) expect(Math.abs(world.heightAt(p.centre.x, p.centre.z) - level)).toBeLessThan(0.01);
    expect(world.highways.length).toBe(0);                                                   // one city: no highway inside it
    world.dispose();
  }, 180_000);
  it('Q-3303: spreadMeters 40000 lays the places across 40 km — not crowded at the start, not beyond the square', () => {
    const regions = [{ id: 'main-city', kind: 'city', city: small }, ...['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, kind: 'village', city: { traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 } }))];
    const near = OW.createOpenWorld(context(), { seed: 7, regions });
    const far = OW.createOpenWorld(context(), { seed: 7, regions, spreadMeters: 40000 });
    const reach = (w: any) => Math.max(...w.places.slice(1).map((p: any) => Math.hypot(p.centre.x - w.places[0].centre.x, p.centre.z - w.places[0].centre.z)));
    expect(reach(near)).toBeLessThan(10000);
    expect(reach(far)).toBeGreaterThan(12000);
    expect(reach(far)).toBeLessThan(26000);
    expect(far.map.world.sizeMeters).toBe(100000);                                         // a 100 km loop already holds 40 km
    near.dispose(); far.dispose();
    const huge = OW.createOpenWorld(context(), { seed: 7, regions: regions.slice(0, 1), spreadMeters: 300000 });
    expect(huge.map.world.sizeMeters).toBe(300000);                                         // raised, never lowered
    huge.dispose();
  }, 180_000);
  it('Q-3306: a grassland land is really an open grass field — grass biome, no tree in it, the map colours it', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'maidan', kind: 'grassland', toward: 'east', radius: 600 }] });
    expect(world.lands.map((l: any) => l.kind)).toEqual(['grassland']);
    const c = world.lands[0].centre, w = world.map.world;
    if (w.heightAt(c.x, c.z) >= 3) expect(w.biomeAt(c.x, c.z)).toBe('grassland');
    expect(w.openFieldAt(c.x, c.z)).toBe(true);
    expect(VEG.treesInRect(w, c.x - 150, c.z - 150, c.x + 150, c.z + 150)).toEqual([]);
    world.dispose();
    expect(readFileSync('src/server/lib/GameShellGenerator.ts', 'utf8')).toMatch(/grassland: '#[0-9a-f]{6}'/);
    expect(GAME_WORLD_RULE).toMatch(/"Ghas ka maidan", "khula maidan", "field", "meadow", "grassland" → \{ kind: 'grassland' \} — never a feature that draws a green circle/);
  }, 180_000);
});

describe('Q-3304 — a feature cannot grow the map, so a feature that claims to is refused at the write', () => {
  const v = (path: string, content = 'export default defineFeature({ id: "x", setup() {} });') => growthVerdict({ path, before: undefined, after: content, request: 'map ko giant banao' });
  it('#2494\'s workaround features are refused, with the one path that really grows the map', () => {
    for (const id of ['regionExpansion', 'giantWorld', 'giantRealisticWorld', 'worldExpansion', 'mapSize']) {
      const r = v(`src/game/features/${id}.ts`);
      expect(r.allow, id).toBe(false);
      expect(growthRefusal(`src/game/features/${id}.ts`, r.reason!)).toMatch(/joinTo/);
    }
    expect(featurePretendsToGrowMap('src/game/features/x.ts', "defineFeature({ id: 'x', about: ['bigger map', 'more regions'] })")).toBe(true);
  });
  it('real features pass: streaming props, a better look, police, traffic', () => {
    for (const id of ['worldStreamer', 'worldEnhancement', 'police', 'moreTraffic', 'regionLabels']) expect(v(`src/game/features/${id}.ts`).allow, id).toBe(true);
  });
  it('a refused world.ts edit is told the correct path', () => {
    expect(growthRefusal(GAME_WORLD_FILE, 'the map lost a place the request did not ask to remove')).toMatch(/a bigger city is tiles that join it/);
  });
});

describe('Q-3305 — a summary may not claim a map size or a place count the turn did not produce', () => {
  const s2494 = "## Summary\n- **50x bada kiya**: Original 100km × 100km map ko 707km × 707km tak bada diya (~50x area increase)\n- **Total 12 regions** add kiye hain:";
  it('#2494: the map file was put back as it began — the size and the 12 regions are corrected', () => {
    const before = ONE_CITY;
    const facts = worldClaimFacts(before, before, 'map ko realstic aur bada banao, 4 bade map jod ke ek bada giant word banao!!')!;
    const kinds = worldClaims(s2494, facts).map((c) => c.kind);
    expect(kinds).toEqual(['world-size-claimed', 'region-count-claimed']);
    const all = auditSummaryClaims(s2494, { consoleCaptured: true, screenshotTaken: true, previewVerified: true, world: facts });
    expect(all.find((c) => c.kind === 'world-size-claimed')?.claimed).toBe('that the map was made 707 km × 707 km');
  });
  it('#2495: "All conditions met" over a 40 km map never set is corrected; set by the platform, it stands', () => {
    const ask = 'map ko 40km*40km banao';
    const summary = '## ✅ Summary\nAll conditions met.';
    expect(worldClaims(summary, worldClaimFacts(ONE_CITY, ONE_CITY, ask)!).map((c) => c.kind)).toEqual(['world-size-ignored']);
    const set = setMapSpread(ONE_CITY, 40, CURRENT_OPEN_WORLD);
    expect(worldClaims('✅ Map ab 40 km × 40 km me phaila hai.', worldClaimFacts(ONE_CITY, set.ok ? set.source : '', ask)!)).toEqual([]);
  });
  it('an honest summary is left alone: places really added, or a size it says was not set', () => {
    const grown = growCity(ONE_CITY, 'shehar bada karo', CURRENT_OPEN_WORLD);
    expect(worldClaims('✅ 3 naye tiles add kiye, city ab badi hai', worldClaimFacts(ONE_CITY, grown.ok ? grown.source : '', 'shehar bada karo')!)).toEqual([]);
    expect(worldClaims('✅ Baaki sab ho gaya. 5000 km ka map nahi ho sakta (sabse bada 1000 km).', worldClaimFacts(ONE_CITY, ONE_CITY, '5000 km ka map banao')!)).toEqual([]);
  });
  it('the route hands the audit the map at the start and the end of the turn', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('world: worldClaimFacts(projectFilesAtTurnStart?.[WORLD_PATH], writtenFiles.get(WORLD_PATH) ?? projectFilesAtTurnStart?.[WORLD_PATH], prompt) ?? undefined,');
  });
});
