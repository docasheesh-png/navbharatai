// 🏝️ CITIES STAND ON REAL LAND, AND THE SEA NEVER ROLLS OVER THE ROAD (failedbr #2565/#2566, a PUBG-like open world, seed 90551631).
//
// The plan asked for "a 10 km × 10 km terrain map with 3–4 cities of 2–5 km". The project's map (athree config MAP_OPTIONS) became a
// 10–11 km LOOP — the 100 km continent squeezed nine times narrower and 0.137 times as tall — and the console said "no dry ground
// was found for tech-city … riverside-town … anywhere on the map; it was left out" while the builder moved cities by hand. On that
// map only 18 of 3,025 spots had a dry 2.1 km square at all (2 of them level), so no planner could have put four such cities on it.
// The user also saw a pale, moving "water wave" over the road: 70% of the highways ran over the sea at the 1.5 m road floor, under
// wave crests of up to 4.8 m, and the ocean drew its foam over everything below its crest.
//
// What is locked here:
//   1. an open world is never a squeezed continent: a loop smaller than the reference is made at the reference size, and the
//      size asked is the land played on (the reported game's 16 places all stand, at about the distances asked);
//   2. a place's dry ground is measured in its own map's metres (placeDryHeight), in every planner of the kit;
//   3. the tiles of a grown city that has to wait for ground wait with it and stand in their own cells, never as cities of their own;
//   4. a road across the sea stands above the highest crest that water can carry, and the ocean draws no wave higher than its water
//      allows — none over land, low on the shore (config SEA_BREAK_RATIO / SEA_CREST_MAX).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { generateAthreeMap } from '../src/server/lib/athreeMap/AthreeMapGenerator';
import { loadAthree } from './helpers/loadAthree';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROOT = join(__dirname, `.tmp-dryland-${process.pid}`);
const kit = (dir: string, projectMapKm?: number) => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), f.content); }
  // The project's own map, as generate_athree_map writes it for "a 10 km map" (MAP_OPTIONS in src/game/athree/config.ts).
  if (projectMapKm) writeFileSync(join(dir, 'src/game/athree/config.ts'), generateAthreeMap(undefined, { archetype: 'continental', sizeKm: projectMapKm }).files['src/game/athree/config.ts']);
};
let OW: any; let OW11: any; let CH: any;
beforeAll(async () => {
  kit(join(ROOT, 'plain')); kit(join(ROOT, 'small'), 11);
  OW = await import(join(ROOT, 'plain', OPEN_WORLD_BRIDGE_PATH));
  OW11 = await import(join(ROOT, 'small', OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(ROOT, 'plain', 'src/game/play/character.ts'));
}, 180_000);
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};
const make = (lib: any, options: any) => {
  const said = vi.spyOn(console, 'error').mockImplementation(() => {});
  const world = lib.createOpenWorld(context(), options);
  const text = said.mock.calls.flat().join('\n'); said.mockRestore();
  return { world, text };
};

// The reported game's src/game/world.ts (build #2566): four grown cities of 2 × 2 tiles, three of them asked at a distance.
const CAPITAL = { blocksX: 10, blocksZ: 10, block: 90, road: 20, style: 'mixed', maxFloors: 20 };
const TECH = { blocksX: 10, blocksZ: 10, block: 90, road: 20, style: 'downtown', maxFloors: 40, parks: 0.1 };
const VILLAGE = { blocksX: 12, blocksZ: 12, block: 70, road: 16, style: 'town', maxFloors: 3, parks: 0.42 };
const TOWN = { blocksX: 9, blocksZ: 9, block: 90, road: 20, style: 'town', maxFloors: 6, parks: 0.2 };
const ASKED: Record<string, number> = { 'tech-city': 6500, 'hill-village': 7000, 'riverside-town': 5000 };
const grown = (id: string, kind: string, city: any, own: any = {}) => [
  { id, kind, city, ...own },
  { id: id + '-north', kind, joinTo: id, toward: 'north', city },
  { id: id + '-west', kind, joinTo: id, toward: 'west', city },
  { id: id + '-north-west', kind, joinTo: id + '-west', toward: 'north', city },
];
const REPORTED = {
  seed: 90551631, spreadMeters: 11000,
  regions: [
    ...grown('capital-city', 'city', CAPITAL),
    ...grown('tech-city', 'city', TECH, { toward: 'east', distance: ASKED['tech-city'] }),
    ...grown('hill-village', 'village', VILLAGE, { toward: 'south-west', distance: ASKED['hill-village'] }),
    ...grown('riverside-town', 'town', TOWN, { toward: 'north-west', distance: ASKED['riverside-town'] }),
  ],
};

function expectEveryCityOnDryLand(world: any, text: string) {
  const W = world.map.world;
  expect(text).not.toMatch(/left out/);
  expect(world.places.map((p: any) => p.id).sort()).toEqual(REPORTED.regions.map((r) => r.id).sort());
  const dryAbove = OW.placeDryHeight(W);
  for (const p of world.places) {
    for (const [i, j] of [[0, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      const x = p.centre.x + i * p.radius, z = p.centre.z + j * p.radius;
      expect(W.heightAt(x, z), p.id + ' stands on dry land').toBeGreaterThanOrEqual(dryAbove);
      expect(W.waterAt(x, z), p.id + ' is not in a river').toBeFalsy();
    }
  }
  // Each grown city stands in one piece: every tile within one tile step of the city it joins, on the same ground level.
  const at = (id: string) => world.places.find((p: any) => p.id === id);
  for (const root of ['capital-city', 'tech-city', 'hill-village', 'riverside-town']) {
    const r = at(root);
    for (const t of ['-north', '-west', '-north-west']) {
      const q = at(root + t);
      expect(Math.hypot(q.centre.x - r.centre.x, q.centre.z - r.centre.z), root + t + ' is a tile of ' + root).toBeLessThan(r.radius * 2 * 1.5);
      expect(W.heightAt(q.centre.x, q.centre.z)).toBeCloseTo(W.heightAt(r.centre.x, r.centre.z), 1);
    }
  }
  // At about the distance asked (the size asked is the land played on).
  const home = at('capital-city').centre;
  for (const [id, d] of Object.entries(ASKED)) expect(Math.abs(Math.hypot(at(id).centre.x - home.x, at(id).centre.z - home.z) - d), id).toBeLessThan(1500);
}

describe('🗺️ an open world is never a squeezed continent', () => {
  it('the reported game on its project map of 11 km: a 100 km continent, every one of its 16 places on dry land, in one piece', () => {
    const { world, text } = make(OW11, REPORTED);
    expect(world.map.world.mode).toBe('loop');
    expect(world.map.world.sizeMeters).toBe(OW11.LOOP_REFERENCE);
    expect(world.map.world.heightScale).toBe(1);
    expectEveryCityOnDryLand(world, text);
    world.dispose();
  }, 180_000);
  it('a builder\'s own sizeMeters of 11 km is read the same way; a loop bigger than the reference is never made smaller', () => {
    const a = make(OW, { ...REPORTED, sizeMeters: 11000 });
    expect(a.world.map.world.sizeMeters).toBe(OW.LOOP_REFERENCE);
    expectEveryCityOnDryLand(a.world, a.text);
    a.world.dispose();
    const big = make(OW, { seed: 3, sizeMeters: 300000, regions: [{ id: 'a', kind: 'city', city: { blocksX: 2, blocksZ: 2 } }] });
    expect(big.world.map.world.sizeMeters).toBe(300000);
    big.world.dispose();
  }, 180_000);
  it('an island stays the island it was (owner decision 2026-11-23): bounded maps are never resized', () => {
    const isl = make(OW, { seed: 5, profile: 'battle-royale', regions: [{ id: 'a', kind: 'city', city: { blocksX: 2, blocksZ: 2 } }] });
    expect(isl.world.map.world.mode).toBe('bounded');
    expect(isl.world.map.world.sizeMeters).toBe(8000);
    isl.world.dispose();
  }, 60_000);
});

describe('🏝️ a place\'s dry ground is measured in its own map\'s metres', () => {
  it('placeDryHeight: 2 m on the reference map and taller ones, shrinking with a flatter map, never under the 0.6 m dry margin', () => {
    expect(OW.placeDryHeight({ seaLevel: 0, heightScale: 1 })).toBe(2);
    expect(OW.placeDryHeight({ seaLevel: 0, heightScale: 3 })).toBe(2);
    expect(OW.placeDryHeight({ seaLevel: 0 })).toBe(2);                         // an older athree world: the 2 m it always was
    expect(OW.placeDryHeight({ seaLevel: 0, heightScale: 0.5 })).toBe(1);
    expect(OW.placeDryHeight({ seaLevel: 0, heightScale: 0.137 })).toBe(0.6);   // seed 90551631 squeezed to 11 km
    expect(OW.placeDryHeight({ seaLevel: 1, heightScale: Number.NaN })).toBe(3);
  });
  it('census: no planner in the kit asks for an absolute 2 m any more — every one asks dryGround / placeDryHeight', () => {
    const src = readFileSync(join(__dirname, '../src/server/lib/GameOpenWorldGenerator.ts'), 'utf8');
    expect(src).not.toMatch(/\bh < 2 \|\|/);
    expect(src).not.toMatch(/heightAt\([^)]*\)\s*>=\s*2\b/);
    expect((src.match(/!dryGround\(x, z, h\)/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(src).toMatch(/const onLand = \(p: Flat\) => world\.heightAt\(p\.x, p\.z\) >= dryAbove/);
  });
});

describe('🏙️ a grown city that waits for ground waits as one city', () => {
  it('its tiles stand in their own cells beside it once it has ground — never as cities of their own', () => {
    // On the 8 km island of seed 5, west of the first place is sea: the town waits, and its two tiles wait with it.
    const small = { blocksX: 3, blocksZ: 3 };
    const { world, text } = make(OW, { seed: 5, profile: 'battle-royale', regions: [
      { id: 'home', kind: 'city', city: small },
      { id: 'far', kind: 'town', toward: 'west', distance: 2500, city: small },
      { id: 'far-2', kind: 'town', joinTo: 'far', toward: 'east', city: small },
      { id: 'far-3', kind: 'town', joinTo: 'far', toward: 'south', city: small },
    ] });
    expect(text).toMatch(/3 place\(s\) had no dry ground where they were asked[^\n]*"far", "far-2", "far-3"/);
    const at = (id: string) => world.places.find((p: any) => p.id === id);
    const far = at('far'), east = at('far-2'), south = at('far-3');
    const step = east.centre.x - far.centre.x;
    expect(step).toBeGreaterThan(100);
    expect(east.centre.z).toBe(far.centre.z);
    expect(south.centre.x).toBe(far.centre.x);
    expect(south.centre.z - far.centre.z).toBeCloseTo(step, 6);
    for (const q of [east, south]) expect(world.map.world.heightAt(q.centre.x, q.centre.z)).toBeCloseTo(world.map.world.heightAt(far.centre.x, far.centre.z), 1);
    world.dispose();
  }, 60_000);
});

describe('🌊 the sea never rolls over the road', () => {
  const A = loadAthree();
  it('SEA_CREST_MAX holds every wave of the table at its strongest wind', () => {
    for (const seed of [1, 5, 90551631]) {
      const waves = A.createWaveField(seed, 0.3);
      expect(A.crestReach(waves) * waves.ampScale(1e9)).toBeLessThanOrEqual(A.SEA_CREST_MAX);
    }
  });
  it('the ocean draws no crest higher than its water allows: none over land, low on the shore, the full sea out in the open', () => {
    const waves = A.createWaveField(3, 0);
    const reach = A.crestReach(waves, 42);
    expect(A.shoreCalm(0, 1, reach)).toBe(0);
    expect(A.shoreCalm(-3, 1, reach)).toBe(0);
    expect(A.shoreCalm(1000, 1.2, reach)).toBe(1);
    for (const depth of [0.5, 1, 2, 4, 8]) for (const amp of [0.35, 0.8, 1.2]) expect(A.shoreCalm(depth, amp, reach) * amp * reach).toBeLessThanOrEqual(A.SEA_BREAK_RATIO * depth + 1e-9);
    const shader = A.oceanVertexShader(waves, 42);
    expect(shader).toMatch(/uniform sampler2D uDepth;/);
    expect(shader).toMatch(/float amp = uAmp \* clamp\(0\.39 \* depth \//);
    expect(shader).toMatch(/gerstnerDisplace\(p0, uTime, amp,/);
  });
  it('a boat floats on the same bounded sea: flat at sea level over land, the full wave in deep water', () => {
    const world = A.createAthreeWorld({ seed: 1 });
    const o = A.createOcean(THREE, world, 'mid');
    let land: { x: number; z: number } | null = null, deep: { x: number; z: number } | null = null;
    for (let i = 0; i < 4000 && (!land || !deep); i++) {
      const x = ((i * 977) % 60000) - 30000, z = ((i * 619) % 60000) - 30000, h = world.heightAt(x, z);
      if (!land && h > 3) land = { x, z };
      if (!deep && h < -40) deep = { x, z };
    }
    for (const t of [0, 3.5, 9]) {
      expect(o.floatAt(land!.x, land!.z, t).y).toBe(world.seaLevel);
      const s = o.waves.surfaceAt(deep!.x, deep!.z, t, world.windAt(deep!.x, deep!.z, t).speed);
      expect(o.floatAt(deep!.x, deep!.z, t)).toEqual({ y: world.seaLevel + s.y, nx: s.nx, ny: s.ny, nz: s.nz });
    }
    o.dispose();
  });
  it('a road across the sea stands above the highest crest its water can carry, and climbs to it at a grade a car can take', () => {
    // Seed 90551631 squeezed to 11 km (the reported map): land, a sea channel at least 5 m deep, land again, on one line.
    const world = A.createAthreeWorld({ seed: 90551631, sizeMeters: 11000, roads: false });
    let road: { from: { x: number; z: number }; to: { x: number; z: number } } | null = null;
    for (let z = -5000; z <= 5000 && !road; z += 250) {
      let landX: number | null = null, seaFrom: number | null = null, deepest = 0;
      for (let x = -5400; x <= 5400; x += 40) {
        const h = world.heightAt(x, z);
        if (h > 2) {
          if (landX !== null && seaFrom !== null && deepest > 5 && x - seaFrom > 400) { road = { from: { x: landX, z }, to: { x, z } }; break; }
          landX = x; seaFrom = null; deepest = 0;
        } else if (h < 0 && landX !== null) { if (seaFrom === null) seaFrom = x; deepest = Math.max(deepest, -h); }
      }
    }
    expect(road).not.toBeNull();
    const ground = (x: number, z: number) => world.baseHeightAt(x, z);
    const pts = world.addRoad([road!.from, road!.to], 9);
    let overSea = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], g = ground(p.x, p.z);
      if (g < world.seaLevel) { overSea++; expect(p.y, 'above the crest at ' + Math.round(p.x)).toBeGreaterThanOrEqual(world.seaLevel + Math.min(A.SEA_CREST_MAX, A.SEA_BREAK_RATIO * (world.seaLevel - g))); }
      if (i > 0) expect(Math.abs(p.y - pts[i - 1].y)).toBeLessThanOrEqual(0.8 + 1e-9);
    }
    expect(overSea).toBeGreaterThan(30);
  });
  it('the reported game\'s highways: wherever one crosses the sea it stands above that sea\'s highest crest', () => {
    const { world } = make(OW11, REPORTED);
    const W = world.map.world;
    // The sea the ocean sees beside the road (45 m out on both sides: past the asphalt and its shoulder), as it is drawn now —
    // a pad's eased edge that filled the sea beside a road end is land, and carries no wave.
    let checked = 0;
    for (const line of world.highways) for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], p = line[i];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
      const depth = Math.max(0, ...[-45, 45].map((o) => W.seaLevel - W.heightAt(p.x + nx * o, p.z + nz * o)));
      if (depth > 0) { checked++; expect(p.y, 'highway point over the sea').toBeGreaterThanOrEqual(W.seaLevel + Math.min(A.SEA_CREST_MAX, A.SEA_BREAK_RATIO * depth)); }
    }
    expect(checked).toBeGreaterThan(0);
    world.dispose();
  }, 180_000);
});
