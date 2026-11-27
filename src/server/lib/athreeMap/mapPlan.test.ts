// THE MAP PLANNER (admin 2026-11-27, wave 1 part 1): real prompts in, a nine-field MapPlan out. Each expectation is a decision the admin
// made or approved — the default area by game type, "5 km" is a side and "5 sq km" an area, the user's size always wins, the boundary
// follows the land unless the user names one — and the plan never claims a layer the world does not build.
import { describe, it, expect } from 'vitest';
import { planMap, areaKm2In, boundaryIn, waterIn, roadStyleIn, densityIn, timeOfDayIn, regionIn, mapGameTypeIn, appliedMapLayers, describeMapPlan, circuitRunwayFloorFromWorldSource, mapPlanWorldOptions, DEFAULT_AREA_KM2 } from './mapPlan';
import { athreeCircuitRunwayFloor, planAthreeMap, applyMapPlanToFiles, MAP_CHECKS_PATH } from './mapPlanWiring';
import { loadEmittedAthree } from './mapRobotRun';
import { generateAthreeMap } from './AthreeMapGenerator';
import { mapChoiceFor } from './athreeMapKinds';

// The world's real floor (CIRCUIT_RUNWAY_MIN_SIZE): a race circuit or a runway fits from 5 km across on a loop map, 2 km on an island.
const FLOOR = { loop: 5000, bounded: 2000 };
const plan = (prompt: string, builder?: Parameters<typeof planMap>[0]['builder']) => planMap({ prompt, builder, circuitRunwayFloorMeters: FLOOR });

describe('area: a side or an area, said honestly', () => {
  it('"5 km ka map" is a 5 x 5 km frame (25 km²), and the note says it was read as a side', () => {
    const p = plan('5 km ka map');
    expect(p.areaKm2).toBe(25); expect(p.sideKm).toBe(5); expect(p.areaSource).toBe('user');
    expect(p.notes.join(' ')).toMatch(/read as the side/);
  });
  it('"5 km²", "5 sq km", "5 square km", "5 varg km", "5 वर्ग किमी" are an AREA of 5 km²', () => {
    for (const t of ['5 km² ka map', '5 sq km', '5 sq. km world', '5 square km', '5 varg km ka shooter', '5 वर्ग किमी का नक्शा', '5 km2 map', '5 km^2']) {
      const a = areaKm2In(t);
      expect(a, t).toEqual({ areaKm2: 5, said: 'area' });
      const p = plan(t);
      expect(p.areaKm2, t).toBe(5); expect(p.sideKm, t).toBe(2.24);
    }
  });
  it('a rectangle keeps its area in a square frame', () => {
    expect(areaKm2In('10 x 4 km city')).toEqual({ areaKm2: 40, said: 'rectangle' });
    expect(plan('10 by 10 km ka map').sideKm).toBe(10);
  });
  it('size words still work and are sides', () => {
    expect(areaKm2In('chhota map')).toEqual({ areaKm2: 25, said: 'word' });
    expect(areaKm2In('ek racing game')).toBeNull();
  });
  it('"map bahut chhota hai, bada karo" is a complaint: the size word describes the OLD map, so the new one is large, never 1 km', () => {
    const p = plan('mere 3D game ka map bahut chhota hai, bada karo');
    expect(p.sideKm).toBe(100); expect(p.notes.join(' ')).toMatch(/too small/);
    expect(plan('ek chhota map banao').sideKm).toBe(5); // a small map asked for on purpose stays small
  });
  it('the 1 to 1000 km limit is held and said', () => {
    const p = plan('0.2 sq km arena shooter');
    expect(p.sideKm).toBe(1); expect(p.notes.join(' ')).toMatch(/held to 1 km/);
  });
});

describe('the default area by game type (admin-approved) — and the user\'s size always wins', () => {
  it('the table is the approved one', () => {
    expect(DEFAULT_AREA_KM2).toMatchObject({ 'on-foot': 5, shooter: 5, rpg: 5, driving: 25, racing: 25, flight: 100 });
  });
  it('on foot / shooter: 5 km², no road floor', () => {
    for (const t of ['ek 3D shooter game banao', 'open world game jisme paidal ghoom sakun', 'fantasy rpg game with quests']) {
      const p = plan(t);
      expect(p.areaSource, t).toBe('game-default'); expect(p.areaKm2, t).toBe(5); expect(p.notes.join(' '), t).not.toMatch(/raised/);
    }
  });
  // Roads exist at every size since #4626, so the floor is only the real minimum for a race circuit or a runway: the admin's 25 km² race
  // and 100 km² flight defaults already hold one, and are NOT raised (they used to be raised to 400 km², the old "no roads below 20 km").
  it('"car racing game": 25 km², not raised — a race circuit fits on a 5 km map', () => {
    const p = plan('car racing game');
    expect(p.gameType).toBe('racing'); expect(p.sideKm).toBe(5); expect(p.areaKm2).toBe(25);
    expect(p.notes.join(' ')).toMatch(/default for a racing game is 25 km²/);
    expect(p.notes.join(' ')).not.toMatch(/raised/);
  });
  it('"plane game": flight, 100 km², not raised — a runway fits', () => {
    const p = plan('plane game');
    expect(p.gameType).toBe('flight'); expect(p.notes.join(' ')).toMatch(/100 km²/); expect(p.areaKm2).toBe(100); expect(p.notes.join(' ')).not.toMatch(/raised/);
  });
  it('a floor above the default raises a racing or flight game to it and says why (a circuit, a runway); driving needs no floor', () => {
    const big = { loop: 12000, bounded: 12000 };
    const r = planMap({ prompt: 'car racing game', circuitRunwayFloorMeters: big });
    expect(r.sideKm).toBe(12); expect(r.notes.join(' ')).toMatch(/needs a race circuit, which this world fits only on a map at least 12 km across/);
    const f = planMap({ prompt: 'plane game', circuitRunwayFloorMeters: { loop: 15000, bounded: 15000 } });
    expect(f.sideKm).toBe(15); expect(f.notes.join(' ')).toMatch(/needs a runway/);
    const d = planMap({ prompt: 'GTA 5 jaisa game', circuitRunwayFloorMeters: big });
    expect(d.gameType).toBe('driving'); expect(d.areaKm2).toBe(25); expect(d.notes.join(' ')).not.toMatch(/raised/);
  });
  it('with no floor known, the 25 km² default stands and the plan says a circuit may be missing', () => {
    const p = planMap({ prompt: 'car racing game' });
    expect(p.sideKm).toBe(5); expect(p.notes.join(' ')).toMatch(/race circuit could not be read/);
  });
  it('a battle royale keeps its 8 km island', () => {
    const p = plan('battle royale game banao');
    expect(p.choice).toEqual({ archetype: 'island', sizeKm: 8 }); expect(p.boundary).toBe('sea');
  });
  it('the user\'s size beats every default, even when it is too small for roads', () => {
    const p = plan('2 km ka car racing game');
    expect(p.sideKm).toBe(2); expect(p.areaSource).toBe('user'); expect(p.notes.join(' ')).not.toMatch(/raised/);
    expect(plan('500 sq km shooter').areaKm2).toBe(500);
  });
  it('the user\'s stated size beats the builder\'s size_km, and the note says so', () => {
    const p = plan('5 km ka registan racing game', { sizeKm: 100 });
    expect(p.sideKm).toBe(5); expect(p.notes.join(' ')).toMatch(/the user's own size wins/);
  });
  it('the builder\'s size and kind win field by field over defaults; the words fill the rest', () => {
    expect(plan('registan racing game', { sizeKm: 12 }).choice).toEqual({ archetype: 'desert', sizeKm: 12 });
    expect(plan('registan racing game', { archetype: 'tundra' }).choice?.archetype).toBe('tundra');
  });
  it('a request with no game, no size and no land plans the default world (no choice), exactly as before', () => {
    expect(plan('a calculator app').choice).toBeNull();
    expect(mapChoiceFor('a calculator app')).toBeNull();
  });
});

describe('boundary, water, roads, density, region, time of day', () => {
  it('"pahaadon se ghira gaon": mountains all round, a sparse village', () => {
    const p = plan('pahaadon se ghira gaon');
    expect(p.boundary).toBe('mountains'); expect(p.boundarySource).toBe('user'); expect(p.density).toBe('sparse');
  });
  it('explicit boundaries in several words', () => {
    expect(boundaryIn('surrounded by sea')).toBe('sea');
    expect(boundaryIn('a walled city')).toBe('wall');
    expect(boundaryIn('map ke chaaron taraf khaai ho')).toBe('canyon');
    expect(boundaryIn('टीलों से घिरा रेगिस्तान')).toBe('dunes');
    expect(boundaryIn('jungle aur nadi se ghira')).toBe('forest-river');
    expect(boundaryIn('a big mountain map')).toBeNull(); // a mountain map is land, not an edge
  });
  it('the edge follows the land when none is named (island → sea, desert → dunes, alpine → mountains)', () => {
    expect(plan('island survival game').boundary).toBe('sea');
    expect(plan('registan shooter').boundary).toBe('dunes');
    expect(plan('himalayan mountains explore game').boundary).toBe('mountains');
  });
  it('"Rajasthan jaisa registan map with a lake": desert land, Rajasthan flavour, dunes edge, one lake', () => {
    const p = plan('Rajasthan jaisa registan map with a lake');
    expect(p.archetype).toBe('desert'); expect(p.region).toBe('rajasthan-desert'); expect(p.boundary).toBe('dunes');
    expect(p.water).toEqual({ sea: false, rivers: 0, lakes: 1, ponds: 0, canals: 0 });
  });
  it('water kinds and counts in English, Hinglish and Devanagari', () => {
    const w = (t: string) => waterIn(t, 'continental', null);
    expect(w('do nadiyan aur ek talab').water).toMatchObject({ rivers: 2, ponds: 1 });
    expect(w('3 lakes and a canal near the sea').water).toMatchObject({ lakes: 3, canals: 1, sea: true });
    expect(w('गांव में तालाब और नदी').water).toMatchObject({ ponds: 1, rivers: 1 });
    expect(w('jheel wala pokhar').water).toMatchObject({ lakes: 1, ponds: 1 });
    expect(w('map without river').water.rivers).toBe(0);
    expect(w('bina paani ka map')).toMatchObject({ refused: true });
  });
  it('a region fills the land and water it is known for, but never overrides what the user said', () => {
    expect(regionIn('Kerala backwaters')).toBe('kerala-backwaters');
    const k = plan('Kerala backwaters explore game');
    expect(k.archetype).toBe('wetland'); expect(k.water).toMatchObject({ canals: 1, lakes: 1, sea: true });
    expect(plan('Mumbai coast driving game').density).toBe('dense');
    expect(plan('Himalaya mein jungle game').archetype).toBe('jungle'); // the user's own land word wins over the region
  });
  it('road styles: the five, and grid (smart city + highways) by default', () => {
    expect(roadStyleIn('curvy hill roads')).toBe('hill');
    expect(roadStyleIn('ghumavdar sadak')).toBe('hill');
    expect(roadStyleIn('random tedhi-medhi galiyan')).toBe('organic');
    expect(roadStyleIn('seedhi sadak')).toBe('straight');
    expect(roadStyleIn('a highway game')).toBe('highway');
    expect(roadStyleIn('smart city grid')).toBe('grid');
    expect(plan('car game').roadStyle).toBe('grid'); expect(plan('car game').roadStyleSource).toBe('default');
  });
  it('density and time of day', () => {
    expect(densityIn('crowded city streets')).toBe('dense');
    expect(densityIn('ek chhota gaon')).toBe('sparse');
    expect(densityIn('a city')).toBeNull();
    expect(timeOfDayIn('raat ka shooter')).toEqual({ time: 'night', hours: 22 });
    expect(timeOfDayIn('sunset drive')).toEqual({ time: 'evening', hours: 18 });
    expect(timeOfDayIn('a car game')).toBeNull();
  });
  it('game types', () => {
    expect(mapGameTypeIn('car racing game')).toBe('racing');
    expect(mapGameTypeIn('plane game')).toBe('flight');
    expect(mapGameTypeIn('GTA 5 jaisa game')).toBe('driving');
    expect(mapGameTypeIn('bgmi jaisa game')).toBe('battle-royale');
    expect(mapGameTypeIn('boat game in Kerala')).toBe('boating');
    expect(mapGameTypeIn('3D zombie shooter')).toBe('shooter');
    expect(mapGameTypeIn('a todo app')).toBe('unknown');
  });
  it('rubbish never throws', () => {
    for (const t of ['', '   ', '!!!', 'x'.repeat(20000), '\u0000', '-5 sq km', '0 km²', 'NaN varg km', '5 x 0 km']) expect(() => plan(t), t).not.toThrow();
  });
});

describe('honesty: what the world applies is read from its source, never assumed', () => {
  const p = plan('5 km ka registan shooter, pahaadon se ghira, do talab');
  it('today\'s world builds the road style (#4626), the edge and the ponds (#4624), and the density and colonies (wave 2), and is reported as applying them', () => {
    const world = generateAthreeMap().files['src/game/athree/world.ts'];
    const a = appliedMapLayers(world, p);
    // Since #4626 (road styles), #4624 (natural edges, ponds) and the colonies the world reads roadStyle, boundary, water.ponds and density,
    // and lays the colony plots from the density (planColonies).
    expect(a).toMatchObject({ frame: true, land: true, roadStyle: true, boundary: true, water: true, density: true, colonies: true });
    const note = describeMapPlan(p, a);
    expect(note).toMatch(/roadStyle: .* — APPLIED/);
    expect(note).toMatch(/boundary: a ring of mountains \(asked for\) — APPLIED/);
    expect(note).toMatch(/density: normal — APPLIED/);
    expect(note).toMatch(/colonies: .* — APPLIED/);
    expect(note).not.toMatch(/do not claim/);
  });
  it('the colonies layer is APPLIED only when the world reads the density AND lays plots from it (reading the option alone is not enough)', () => {
    expect(appliedMapLayers('const { density } = options;', p)).toMatchObject({ density: true, colonies: false });
    expect(appliedMapLayers('const c = planColonies({ seed });', p)).toMatchObject({ density: false, colonies: false });
    expect(appliedMapLayers('const d = options.density; const c = planColonies({ seed, density: d });', p)).toMatchObject({ density: true, colonies: true });
    const note = describeMapPlan(p, appliedMapLayers('const { density } = options;', p));
    expect(note).toMatch(/colonies: .* — recorded, not built into this world yet/);
    expect(note).toMatch(/colonies are planned but not yet built into the world; do not claim them/);
  });
  it('the water layer is APPLIED only when the world reads its ponds (the #4624 shape: options.water ?? {} … .ponds); counts it does not use are said', () => {
    const p2 = plan('do nadiyan aur ek talab wala explore game');
    expect(appliedMapLayers('const w = options.water ?? {};', p2).water).toBe(false);
    const a = appliedMapLayers('const waterOpt = options.water ?? {}; placePonds(waterOpt.ponds);', p2);
    expect(a.water).toBe(true);
    expect(describeMapPlan(p2, a)).toMatch(/water: .* — APPLIED \(the ponds; the world makes its own rivers and lakes/);
  });
  it('a world that reads an option is reported as applying it (the day the boundary layer lands)', () => {
    const a = appliedMapLayers('const b = options.boundary ?? "sea"; const { roadStyle, density } = options;', p);
    expect(a).toMatchObject({ boundary: true, roadStyle: true, density: true, water: false });
    expect(describeMapPlan(p, a)).toMatch(/boundary: .* — APPLIED/);
  });
  it('the circuit/runway floor is read from the emitted world (CIRCUIT_RUNWAY_MIN_SIZE), never from MIN_ROAD_SIZE', () => {
    const world = generateAthreeMap().files['src/game/athree/world.ts'];
    expect(athreeCircuitRunwayFloor()).toEqual(circuitRunwayFloorFromWorldSource(world));
    expect(athreeCircuitRunwayFloor()).toEqual({ loop: 5000, bounded: 2000 });
    expect(circuitRunwayFloorFromWorldSource('export const MIN_ROAD_SIZE: Record<AthreeWorldMode, number> = { loop: 20000, bounded: 6000 };')).toBeNull();
    expect(circuitRunwayFloorFromWorldSource('nothing here')).toBeNull();
  });
  it('END TO END: the planned road style reaches the world — MAP_OPTIONS from the plan is what createAthreeMap lays roads with', () => {
    const p = planAthreeMap('athree map par 3 km ka explore game, curvy hill roads');
    expect(p.roadStyle).toBe('hill');
    const out = applyMapPlanToFiles(generateAthreeMap(undefined, p.choice).files, p, p.choice);
    expect(out.applied.roadStyle).toBe(true);
    expect(out.note).toMatch(/roadStyle: .* — APPLIED/);
    const A = loadEmittedAthree(out.files) as any;
    const map = A.createAthreeMap({ seed: 5 });
    expect(map.world.roadNetwork().style()).toBe('hill');
    expect(map.world.homeRoads().roads.some((r: any) => r.planned)).toBe(true);
  });
});

describe('the plan is written into the project', () => {
  it('config.ts carries MAP_PLAN and merges the shared option names into MAP_OPTIONS; mapChecks.ts is added', () => {
    const p = planAthreeMap('5 km ka registan shooter with a lake');
    const gen = generateAthreeMap(undefined, p.choice);
    const out = applyMapPlanToFiles(gen.files, p, p.choice);
    const config = out.files['src/game/athree/config.ts'];
    expect(config).toMatch(/export const MAP_OPTIONS: MapOptions = \{/); // the generator's own line is untouched
    expect(config).toMatch(/export const MAP_PLAN = \{/);
    expect(config).toContain('Object.assign(MAP_OPTIONS, ' + JSON.stringify(mapPlanWorldOptions(p)) + ');');
    expect(Object.keys(mapPlanWorldOptions(p)).sort()).toEqual(['areaKm2', 'boundary', 'density', 'roadStyle', 'water']);
    expect(out.files[MAP_CHECKS_PATH]).toMatch(/export function runMapChecks/);
    expect(gen.files['src/game/athree/config.ts']).not.toMatch(/MAP_PLAN/); // the input is not changed
  });
  it('a composition that fixes another width is said in the note', () => {
    const p = planAthreeMap('car racing game');
    const gen = generateAthreeMap(undefined, { archetype: 'continental', sizeKm: 10 });
    expect(applyMapPlanToFiles(gen.files, p, { archetype: 'continental', sizeKm: 10 }).note).toMatch(/composition fixed the map at 10 km/);
  });
});
