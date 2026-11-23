// A VENUE STANDS ON THE WORLD (map expansion plan, item 6). A cricket ground, a football field, a stadium, a race circuit or an
// arena asked for on an open-world map was a feature the builder drew by hand, at any size, often on a slope or in the sea. A
// 'venue' region is now a place of the map: its standard size (or the size asked), on its own level, dry pad, marked out,
// joined by road — beside a place when joinTo says so (no highway between, never on the place), and drawn when the player comes
// near. Maps without a venue are exactly what they were.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_WORLD_RULE } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-venue-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let WM: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  WM = await import(join(DIR, 'src/game/ui/worldMap.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};
const small = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };
const city = { id: 'main-city', kind: 'city', city: small };
const corners = (v: any) => [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([a, b]) => ({ x: v.centre.x + (a * v.width) / 2, z: v.centre.z + (b * v.depth) / 2 }));
const walkTo = (world: any, c: any, x: number, z: number) => {
  const o = world.playerWorld(); c.player.object.position.x += x - o.x; c.player.object.position.z += z - o.z;
  for (let i = 0; i < 4; i++) world.frame(c, 1 / 60);
};

describe('🏟️ the open world: a venue region', () => {
  it('each venue has its standard size; size sets the longer side', () => {
    expect(OW.VENUE_SIZES['football-field']).toEqual({ width: 115, depth: 78 });
    expect(OW.VENUE_SIZES['cricket-ground']).toEqual({ width: 150, depth: 150 });
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [city, { id: 'ground', kind: 'venue', venue: 'football-field' }, { id: 'big', kind: 'venue', venue: 'arena', size: 105 }] });
    const [f, a] = world.venues;
    expect([f.venue, f.width, f.depth]).toEqual(['football-field', 115, 78]);
    expect(a.width).toBeCloseTo(105, 5); expect(a.depth).toBeCloseTo(75, 5);
    world.dispose();
  }, 120_000);

  it('stands on dry, level ground: the land at its corners is its pad height, above the sea, off every road', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [city, { id: 'stadium', kind: 'venue', venue: 'stadium', toward: 'south' }, { id: 'track', kind: 'venue', venue: 'race-circuit' }] });
    expect(world.venues.length).toBe(2);
    for (const v of world.venues) {
      expect(v.centre.y).toBeGreaterThan(world.map.world.seaLevel);
      for (const p of corners(v)) { expect(Math.abs(world.heightAt(p.x, p.z) - v.centre.y)).toBeLessThan(0.05); expect(world.map.world.waterAt(p.x, p.z)).toBeFalsy(); }
    }
    world.dispose();
  }, 120_000);

  it('"stadium next to the city" (east): beside the city\'s border, never on it, same ground level, no highway between', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [city, { id: 'stadium', kind: 'venue', venue: 'stadium', joinTo: 'main-city', toward: 'east' }] });
    const c0 = world.places[0], v = world.venues[0], half = world.regions[0].city.plan.width / 2;
    expect(v.joinedTo).toBe('main-city');
    expect(v.centre.x - v.width / 2).toBeGreaterThan(c0.centre.x + half);           // never on the city
    expect(v.centre.x - v.width / 2 - (c0.centre.x + half)).toBeLessThan(40);       // right beside it
    expect(Math.abs(v.centre.z - c0.centre.z)).toBeLessThan(1);
    expect(v.centre.y).toBeCloseTo(world.regions[0].centre.y, 5);
    expect(world.highways.length).toBe(0);
    world.dispose();
  }, 120_000);

  it('without joinTo it is spread like a place, joined by one highway that ends at its pad', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [city, { id: 'ground', kind: 'venue', venue: 'cricket-ground', toward: 'east' }] });
    const v = world.venues[0];
    expect(v.joinedTo).toBeUndefined();
    expect(world.highways.length).toBe(1);
    const end = world.highways[0][world.highways[0].length - 1];
    const near = [world.highways[0][0], end].map((p: any) => Math.max(Math.abs(p.x - v.centre.x) - v.width / 2, Math.abs(p.z - v.centre.z) - v.depth / 2));
    expect(Math.min(...near)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.min(...near)).toBeLessThan(20);
    world.dispose();
  }, 120_000);

  it('no highway runs across a venue\'s ground (a mixed world of villages, stadiums and circuits, some joined)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const seed of [3, 8]) {
      const regions: any[] = [city];
      for (let i = 0; i < 8; i++) regions.push({ id: 't' + i, kind: 'village', city: small });
      for (let i = 0; i < 6; i++) regions.push({ id: 'v' + i, kind: 'venue', venue: i % 2 ? 'race-circuit' : 'stadium', ...(i % 3 === 0 ? { joinTo: 't' + i } : {}) });
      const world = OW.createOpenWorld(context(), { seed, regions });
      expect(world.venues.length).toBe(6);
      for (const line of world.highways) for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        for (const v of world.venues) for (let k = 0; k <= 40; k++) {
          const x = a.x + ((b.x - a.x) * k) / 40, z = a.z + ((b.z - a.z) * k) / 40;
          expect(Math.abs(x - v.centre.x) < v.width / 2 - 1 && Math.abs(z - v.centre.z) < v.depth / 2 - 1).toBe(false);
        }
      }
      // and no two venues, or a venue and a place, share ground
      for (const v of world.venues) {
        for (const o of world.venues) if (o !== v) expect(Math.abs(o.centre.x - v.centre.x) >= (o.width + v.width) / 2 || Math.abs(o.centre.z - v.centre.z) >= (o.depth + v.depth) / 2).toBe(true);
        for (const p of world.places) if (p.id !== v.joinedTo) expect(Math.hypot(p.centre.x - v.centre.x, p.centre.z - v.centre.z)).toBeGreaterThan(Math.max(v.width, v.depth) / 2);
      }
      world.dispose();
    }
    err.mockRestore();
  }, 300_000);

  it('joined toward the sea: said in the console, laid on its own instead (never in the water)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [city, { id: 'ghost', kind: 'venue', venue: 'arena', joinTo: 'nowhere' }] });
    expect(err.mock.calls.some((c) => /venue "ghost".*not on the map/.test(String(c[0])))).toBe(true);
    expect(world.venues.length).toBe(1);
    expect(world.venues[0].joinedTo).toBeUndefined();
    err.mockRestore();
    world.dispose();
  }, 120_000);

  it('is drawn when the player comes near (markings at real sizes, goals solid), moves with the origin, and leaves with the world', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, regions: [city, { id: 'ground', kind: 'venue', venue: 'football-field', toward: 'north', distance: 3000 }] });
    const v = world.venues[0];
    world.frame(c, 1 / 60);
    expect(v.built).toBe(false);
    walkTo(world, c, v.centre.x, v.centre.z + 30);
    expect(v.built).toBe(true);
    const root = c.scene.getObjectByName('Venue ground')!;
    expect(root).toBeTruthy();
    const names = new Set<string>(); root.traverse((o: any) => names.add(o.name));
    for (const n of ['Touch line', 'Halfway line', 'Centre circle', 'Penalty area', 'Goal area', 'Goal post']) expect(names.has(n)).toBe(true);
    const post = root.getObjectByName('Goal post') as any;
    expect(post.userData && JSON.stringify(post.userData)).toMatch(/solid/);
    // where it is drawn is where it is on the map, across an origin shift
    const at = () => { root.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(root.matrixWorld); };
    const p = world.playerWorld(), local = at();
    expect(local.x - c.player.object.position.x).toBeCloseTo(v.centre.x - p.x, 3);
    walkTo(world, c, v.centre.x + 6000, v.centre.z);
    const p2 = world.playerWorld(), local2 = at();
    expect(local2.x - c.player.object.position.x).toBeCloseTo(v.centre.x - p2.x, 3);
    expect(local2.z - c.player.object.position.z).toBeCloseTo(v.centre.z - p2.z, 3);
    expect(root.visible).toBe(false);                                                  // far out of view
    // toWorld: a venue point on its level ground
    expect(v.toWorld(52.5, 0)).toEqual({ x: v.centre.x + 52.5, y: v.centre.y, z: v.centre.z });
    world.dispose();
    expect(c.scene.getObjectByName('Venue ground')).toBeUndefined();
  }, 120_000);

  it('the map shows it, the cap counts it, and a map with no venue has no venues', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [city, { id: 'ground', kind: 'venue', venue: 'cricket-ground', name: 'Eden' }] });
    const places = WM.worldMapSource().places();
    expect(places.some((p: any) => p.id === 'ground' && p.kind === 'venue' && p.name === 'Eden')).toBe(true);
    world.dispose();
    const plain = OW.createOpenWorld(context(), { seed: 7, regions: [city] });
    expect(plain.venues).toEqual([]);
    plain.dispose();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const many = Array.from({ length: OW.MAX_REGIONS }, (_, i) => ({ id: 'v' + i, kind: 'venue', venue: 'arena' }));
    const full = OW.createOpenWorld(context(), { seed: 7, regions: [city, ...many] });
    expect(full.places.length + full.venues.length).toBeLessThanOrEqual(OW.MAX_REGIONS);
    err.mockRestore();
    full.dispose();
  }, 300_000);
});

describe('🏟️ the world rule: a venue on the map, not the game itself', () => {
  it('Hindi, Hinglish and English asks for a ground on the map are a venue region', () => {
    for (const s of ['cricket ground jodo', 'football ka maidan banao', 'शहर में स्टेडियम बनाओ', 'stadium next to the city', 'race track / circuit add karo', "kind: 'venue'", "'race-circuit'", 'joinTo?']) expect(GAME_WORLD_RULE).toContain(s);
  });
  it('asking for the game itself is not a venue (opposite class)', () => {
    expect(GAME_WORLD_RULE).toMatch(/Not a venue: "cricket game banao", "football khelna hai"/);
  });
});
