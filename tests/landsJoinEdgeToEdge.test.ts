// LANDS JOIN EDGE TO EDGE (map expansion plan, item 3). A desert, jungle, mountain, snow or beach was always laid apart from
// everything — about a kilometre out, joined by a highway — even when the user asked for it beside a city or another land
// ("shehar ke bagal me registan", "a desert next to the city", "4 map jod ke ek world"). A land with joinTo now lies against that
// place (the whole grown city) or land, overlapping its edge a little: no strip of plain country, no highway between. A joined
// mountain eases down to its own edge even where the land beside it is drawn, so two lands never meet at a cliff. A land without
// joinTo, and the height of a map with no joined mountain, are exactly what they were.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_WORLD_RULE } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-landsjoin-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let AW: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  AW = await import(join(DIR, 'src/game/athree/world.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};
const small = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };

describe('🧩 the world: joined lands', () => {
  it('a map with no joined mountain has exactly the old heights (a joined desert far away changes nothing near the old lands)', () => {
    const a = AW.createAthreeWorld({ seed: 7, profile: 'open-world' }); const b = AW.createAthreeWorld({ seed: 7, profile: 'open-world' });
    for (const w of [a, b]) { w.setLand(1000, 0, 450, 'mountain'); w.setLand(-1500, 800, 600, 'desert'); }
    b.setLand(20000, 20000, 400, 'desert', { joined: true });
    for (let i = 0; i < 3000; i++) { const x = ((i * 7919) % 6000) - 3000, z = ((i * 104729) % 6000) - 3000; expect(Object.is(a.heightAt(x, z), b.heightAt(x, z))).toBe(true); expect(a.biomeAt(x, z)).toBe(b.biomeAt(x, z)); }
  });
  it('a joined mountain far away leaves the old mountain\'s heights bit for bit (the other branch, same arithmetic)', () => {
    const a = AW.createAthreeWorld({ seed: 7, profile: 'open-world' }); const b = AW.createAthreeWorld({ seed: 7, profile: 'open-world' });
    for (const w of [a, b]) w.setLand(1000, 0, 450, 'mountain');
    b.setLand(20000, 20000, 400, 'mountain', { joined: true });
    for (let i = 0; i < 3000; i++) { const x = ((i * 7919) % 4000) - 1000, z = ((i * 104729) % 4000) - 2000; expect(Object.is(a.heightAt(x, z), b.heightAt(x, z))).toBe(true); }
  });
  it('a joined mountain beside an earlier desert rises from the meeting line — no cliff; the same layout unjoined has one', () => {
    const steepest = (joined: boolean) => {
      const w = AW.createAthreeWorld({ seed: 3, profile: 'open-world', roads: false, rivers: false });
      w.setLand(0, 0, 450, 'desert');
      w.setLand(0.85 * 450 + 0.8 * 450, 0, 450, 'mountain', { joined });
      let worst = 0, prev = w.heightAt(-200, 0);
      for (let x = -199; x <= 1400; x++) { const h = w.heightAt(x, 0); worst = Math.max(worst, Math.abs(h - prev)); prev = h; }
      return worst;
    };
    expect(steepest(false)).toBeGreaterThan(40);            // first match: the desert wins up to its edge, then the mountain at full height
    expect(steepest(true)).toBeLessThan(12);                // joined: the mountain eases to its own edge under the desert
  });
});

describe('🧩 the open world: a land with joinTo lies against it', () => {
  it('"a desert next to the city" (east): it overlaps the city\'s east border, no highway between them', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'sands', kind: 'desert', joinTo: 'main-city', toward: 'east' }] });
    const city = world.places[0], land = world.lands[0];
    const half = world.regions[0].city.plan.width / 2;
    expect(land.joinedTo).toBe('main-city');
    expect(land.centre.x).toBeGreaterThan(city.centre.x);
    expect(Math.abs(land.centre.z - city.centre.z)).toBeLessThan(1);
    expect(land.centre.x - 0.85 * land.radius).toBeLessThanOrEqual(city.centre.x + half);      // its nearest edge reaches the border
    expect(land.centre.x - land.radius).toBeGreaterThan(city.centre.x - half);                 // and never swallows the city
    expect(world.highways.length).toBe(0);
    expect(world.map.world.biomeAt(city.centre.x + half + 0.1 * land.radius, city.centre.z)).toBe('desert');
    world.dispose();
  }, 120_000);
  it('the same desert WITHOUT joinTo is spread as before: far out and joined by a highway (unchanged)', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'sands', kind: 'desert', toward: 'east' }] });
    const city = world.places[0], land = world.lands[0];
    expect(land.joinedTo).toBeUndefined();
    expect(land.centre.x - land.radius - (city.centre.x + world.regions[0].city.plan.width / 2)).toBeGreaterThan(150);
    expect(world.highways.length).toBe(1);
    world.dispose();
  }, 120_000);
  it('a land joined to a land: jungle north of the desert overlaps it; one highway (city → desert), not two', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'sands', kind: 'desert', toward: 'east' }, { id: 'woods', kind: 'jungle', joinTo: 'sands', toward: 'north' }] });
    const [d, j] = world.lands;
    expect(j.centre.z).toBeLessThan(d.centre.z);
    expect(Math.hypot(j.centre.x - d.centre.x, j.centre.z - d.centre.z)).toBeLessThan(0.85 * (d.radius + j.radius));
    expect(world.highways.length).toBe(1);
    world.dispose();
  }, 120_000);
  it('joined to a grown city: the land lies beyond the whole city (all its tiles), not on a tile', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'main-city-2', kind: 'city', joinTo: 'main-city', toward: 'east' }, { id: 'sands', kind: 'desert', joinTo: 'main-city', toward: 'east' }] });
    const tile = world.places.find((p: any) => p.id === 'main-city-2');
    const half = world.regions[0].city.plan.width / 2;
    const land = world.lands[0];
    expect(land.centre.x - land.radius).toBeGreaterThan(tile.centre.x - half);
    expect(land.centre.x - 0.85 * land.radius).toBeLessThanOrEqual(tile.centre.x + half + 1);
    expect(world.highways.length).toBe(0);
    world.dispose();
  }, 120_000);
  it('a side that is sea: said in the console, and the land is laid nearby the old way — never dropped', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = context();
    // A royale island (the city stands south of the middle): a mountain far north stands at the shore; a desert joined north of it would be in the sea.
    const world = OW.createOpenWorld(c, { seed: 7, profile: 'battle-royale', regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'peak', kind: 'mountain', toward: 'north', distance: 5000 }, { id: 'sands', kind: 'desert', joinTo: 'peak', toward: 'north' }] });
    expect(world.lands.map((l: any) => l.id)).toEqual(['peak', 'sands']);
    expect(world.lands[1].joinedTo).toBeUndefined();
    expect(said.mock.calls.flat().join(' ')).toMatch(/"sands" could not lie against "peak" \(the north side is water or another place\)/);
    said.mockRestore(); world.dispose();
  }, 120_000);
  it('an id that is not on the map: said, and laid the old way', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: small }, { id: 'sands', kind: 'desert', joinTo: 'nowhere' }] });
    expect(world.lands.length).toBe(1);
    expect(said.mock.calls.flat().join(' ')).toMatch(/"sands" joins "nowhere", which is not on the map/);
    said.mockRestore(); world.dispose();
  }, 120_000);
});

describe('🧩 the rule tells the builder when a land is joined', () => {
  it('Hindi, Hinglish and English "next to" → joinTo; a plain "ek desert map jodo" stays a spread land', () => {
    expect(GAME_WORLD_RULE).toMatch(/shehar ke bagal me registan/);
    expect(GAME_WORLD_RULE).toMatch(/शहर के पास रेगिस्तान/);
    expect(GAME_WORLD_RULE).toMatch(/a desert next to the city/);
    expect(GAME_WORLD_RULE).toMatch(/add joinTo: '<that region id>'/);
    expect(GAME_WORLD_RULE).toMatch(/without joinTo a land is spread out as before/);
    expect(GAME_WORLD_RULE).toMatch(/"ek\s+desert map jodo" ADD one spread place or land/);
  });
});
