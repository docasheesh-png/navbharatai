// A THOUSAND PLACES, THE NEAREST FEW LIVE (map expansion plan, item 4; owner decision: up to 1,000 places, live cities at once —
// phone 2, mid 5, desktop 8). Planning a map of a thousand places took seconds: the highway tree tried every joined stop against
// every other stop at each step (n³), and every candidate spot was checked against every place already on the map. Both now
// look only where they need to, with exactly the same answers, so the same list gives the same map.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as THREE from 'three';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH, OPEN_WORLD_MAX_REGIONS } from '../src/server/lib/GameOpenWorldGenerator';
import { MAX_PLACES, OLD_MAX_PLACES, appendPlace, placesTheMapHolds, placeNotAddedHandoff } from '../src/server/AgentV3/worldGrow';
import { OPEN_WORLD_FILE, addLibraryPlaceAtTurnStart } from '../src/server/AgentV3/growthTurn';
import { GAME_WORLD_RULE } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-thousand-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** The old way, kept here as the reference: every joined stop against every other stop, each time. */
function everyPairEachTime(stops: Array<{ x: number; z: number }>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  if (stops.length < 2) return out;
  const joined = new Set<number>([0]);
  while (joined.size < stops.length) {
    let best: [number, number, number] | null = null;
    for (const a of joined) for (let b = 0; b < stops.length; b++) {
      if (joined.has(b)) continue;
      const d = Math.hypot(stops[a].x - stops[b].x, stops[a].z - stops[b].z);
      if (!best || d < best[2]) best = [a, b, d];
    }
    if (!best) break;
    joined.add(best[1]); out.push(best);
  }
  return out;
}

describe('🛣️ the highway tree of a thousand places', () => {
  it('the same pairs in the same order as the old way — scattered places', () => {
    let s = 12345; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
    for (const n of [0, 1, 2, 3, 17, 300]) {
      const stops = Array.from({ length: n }, () => ({ x: (rnd() - 0.5) * 40000, z: (rnd() - 0.5) * 40000 }));
      expect(OW.spanningPairs(stops)).toEqual(everyPairEachTime(stops));
    }
  });
  it('the same pairs where distances tie (a grown city\'s tiles on a grid, the same spot twice)', () => {
    const grid = [] as Array<{ x: number; z: number }>;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) grid.push({ x: (i - 6) * 380, z: (j - 6) * 380 });
    expect(OW.spanningPairs(grid)).toEqual(everyPairEachTime(grid));
    const ring = Array.from({ length: 16 }, (_, k) => ({ x: Math.round(Math.sin(k * Math.PI / 8) * 1000), z: Math.round(Math.cos(k * Math.PI / 8) * 1000) }));
    const twice = [{ x: 0, z: 0 }, ...ring, { x: 0, z: 0 }, ...ring.slice(0, 5)];
    expect(OW.spanningPairs(twice)).toEqual(everyPairEachTime(twice));
  });
  it('the bridge lays its highways from that tree', () => {
    const bridge = recipeFilePool().get(OPEN_WORLD_BRIDGE_PATH)!.content;
    // Since failedbr #2499 (Q-3351) the tree comes through highwayTree(): spanningPairs(stops) itself, unless a pair in it is
    // too steep for a car — then rebuilt with the steep pairs last.
    expect(bridge).toMatch(/const tree = spanningPairs\(stops\);\n\s+if \(!tree\.some\(\(\[a, b, d\]\) => !joinedPairs\.has\(a \+ ',' \+ b\) && tooSteep\(a, b, d\)\)\) return tree;/);
    expect(bridge).toMatch(/for \(const best of highwayTree\(\)\)/);
    expect(bridge).not.toMatch(/for \(const a of joined\) for \(let b = 0; b < stops\.length; b\+\+\)/);
  });
});

const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: vi.fn(), seated: null as THREE.Object3D | null } };
};
const tiny = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 1 };
/** Home, then n villages spread around it. */
const villages = (n: number) => [{ id: 'home', kind: 'city', city: tiny }, ...Array.from({ length: n }, (_, i) => ({ id: 'v' + i, kind: 'village', city: tiny }))];
/** Stand the player at a WORLD spot and run a few frames (a place is built one per frame). */
const standAt = (world: any, c: any, x: number, z: number, frames = 3) => {
  for (let f = 0; f < frames; f++) {
    c.player.object.position.set(x - world.map.chunks.origin.x, world.heightAt(x, z) + 1, z - world.map.chunks.origin.z);
    world.frame(c, 0.016);
  }
};
/** The cities standing now, a grown city counted once (its tiles share the first tile's id prefix in these fixtures). */
const standing = (world: any) => new Set(world.regions.map((r: any) => r.id.replace(/-tile\d+$/, ''))).size;

describe('🏙️ only the nearest cities stand (phone 2, mid 5, desktop 8)', () => {
  it('the budgets are the owner\'s', () => {
    expect(OW.LIVE_CITIES).toEqual({ phone: 2, mid: 5, desktop: 8 });
  });
  it('the device\'s share: a finger is a phone, 8 cores and 8 GB a desktop, the rest (or unknown) mid', () => {
    const as = (coarse: boolean, cores?: number, memory?: number) => {
      vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }) });
      vi.stubGlobal('navigator', { hardwareConcurrency: cores, deviceMemory: memory });
      try { return OW.deviceTier(); } finally { vi.unstubAllGlobals(); }
    };
    expect(as(true, 8, 8)).toBe('phone');
    expect(as(false, 8, 8)).toBe('desktop');
    expect(as(false, 12, undefined)).toBe('desktop');
    expect(as(false, 8, 4)).toBe('mid');
    expect(as(false, 4, 8)).toBe('mid');
    expect(as(false, undefined, undefined)).toBe('mid');
  });
  const edgeOf = (q: any, at: { x: number; z: number }) => Math.hypot(at.x - q.centre.x, at.z - q.centre.z) - q.radius;
  for (const [quality, budget] of [['phone', 2], ['mid', 5], ['desktop', 8]] as const) {
    it(quality + ': visiting twelve places, a city in view is never taken down; home and the place the player is in always stand', () => {
      const c = context();
      const world = OW.createOpenWorld(c, { seed: 7, quality, regions: villages(12) });
      const hide = OW.CITY_HIDE;
      let wasBuilt = new Set(world.places.filter((q: any) => q.built).map((q: any) => q.id));
      for (const p of world.places.slice(1)) {
        const at = p.centre;
        standAt(world, c, at.x, at.z);
        expect(world.places.find((q: any) => q.id === p.id).built).toBe(true);   // the place the player is in stands
        expect(world.places[0].built).toBe(true);
        expect(world.regions[0].id).toBe('home');
        expect(world.city.id).toBe('home');
        const now = new Set(world.places.filter((q: any) => q.built).map((q: any) => q.id));
        for (const id of wasBuilt) {
          if (now.has(id)) continue;
          const q = world.places.find((r: any) => r.id === id);
          expect(edgeOf(q, at)).toBeGreaterThanOrEqual(hide);                  // never vanishes while still in view
        }
        const hiddenExtras = world.places.filter((q: any) => q.built && q.id !== 'home' && edgeOf(q, at) >= hide).length;
        if (standing(world) > budget) expect(hiddenExtras).toBe(0);            // over the budget only while extras are still in view
        wasBuilt = now;
      }
      world.dispose();
    }, 180_000);
  }
  it('a city still in view is never taken down; once out of view and the budget is full, it is freed', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions: [
      { id: 'home', kind: 'city', city: tiny },
      { id: 'near', kind: 'village', city: tiny, toward: 'east', distance: 1200 },
      { id: 'mid', kind: 'village', city: tiny, toward: 'east', distance: 2400 },
      { id: 'far', kind: 'village', city: tiny, toward: 'east', distance: 9000 },
    ] });
    expect(world.places.map((p: any) => p.id)).toEqual(['home', 'near', 'mid', 'far']);
    const hide = OW.CITY_HIDE;
    const byId = (id: string) => world.places.find((p: any) => p.id === id);
    const home = byId('home'), near = byId('near'), mid = byId('mid'), far = byId('far');
    expect(Math.hypot(far.centre.x - home.centre.x, far.centre.z - home.centre.z)).toBeGreaterThan(hide + far.radius + home.radius);
    standAt(world, c, near.centre.x, near.centre.z);
    standAt(world, c, mid.centre.x, mid.centre.z);
    // From mid, home and near are still in view on this layout — building mid must not take them down.
    if (edgeOf(home, mid.centre) < hide) expect(home.built).toBe(true);
    if (edgeOf(near, mid.centre) < hide) expect(near.built).toBe(true);
    expect(mid.built).toBe(true);
    standAt(world, c, far.centre.x, far.centre.z);
    expect(far.built).toBe(true);
    expect(home.built).toBe(true);                                             // home is never freed
    expect(edgeOf(near, far.centre)).toBeGreaterThanOrEqual(hide);
    expect(edgeOf(mid, far.centre)).toBeGreaterThanOrEqual(hide);
    expect(near.built).toBe(false);
    expect(mid.built).toBe(false);
    expect(standing(world)).toBe(2);
    world.dispose();
  }, 180_000);
  it('liveCities: false keeps the old way — every city reached stays built', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', liveCities: false, regions: villages(6) });
    for (const p of world.places.slice(1)) standAt(world, c, p.centre.x, p.centre.z);
    expect(world.places.every((q: any) => q.built)).toBe(true);
    expect(world.regions.length).toBe(7);
    world.dispose();
  }, 180_000);
  it('a freed place is built again on the way back, with the SAME parked cars (handed to ctx.vehicles once)', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions: [
      { id: 'home', kind: 'city', city: tiny },
      { id: 'a', kind: 'village', city: tiny, toward: 'east', distance: 5000 },
      { id: 'b', kind: 'village', city: tiny, toward: 'west', distance: 5000 },
      { id: 'd', kind: 'village', city: tiny, toward: 'north', distance: 8000 },
    ] });
    expect(world.places.map((p: any) => p.id)).toEqual(['home', 'a', 'b', 'd']);
    const [, a, b, d] = world.places;
    expect(edgeOf(a, d.centre)).toBeGreaterThanOrEqual(OW.CITY_HIDE);
    standAt(world, c, a.centre.x, a.centre.z);
    const carsOfA = [...world.regions.find((r: any) => r.id === a.id).parked];
    standAt(world, c, b.centre.x, b.centre.z); standAt(world, c, d.centre.x, d.centre.z);
    expect(world.places[1].built).toBe(false);
    expect(carsOfA.every((car: THREE.Object3D) => !car.parent || car.parent.parent === null)).toBe(true);   // out of the scene
    standAt(world, c, a.centre.x, a.centre.z);
    const again = world.regions.find((r: any) => r.id === a.id);
    expect(again.parked).toEqual(carsOfA);
    expect(carsOfA.every((car: THREE.Object3D) => { let o: THREE.Object3D | null = car; while (o && o !== c.scene) o = o.parent; return o === c.scene; })).toBe(true);
    const handed = c.vehicles.add.mock.calls.map((call: unknown[]) => call[0]);
    expect(new Set(handed).size).toBe(handed.length);
    world.dispose();
  }, 180_000);
  it('a city whose car the player is driving is never freed, and the place ahead still appears', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions: [
      { id: 'home', kind: 'city', city: tiny },
      { id: 'a', kind: 'village', city: tiny, toward: 'east', distance: 5000 },
      { id: 'b', kind: 'village', city: tiny, toward: 'west', distance: 5000 },
      { id: 'd', kind: 'village', city: tiny, toward: 'north', distance: 8000 },
    ] });
    expect(world.places.map((p: any) => p.id)).toEqual(['home', 'a', 'b', 'd']);
    const [, a, b, d] = world.places;
    expect(edgeOf(a, d.centre)).toBeGreaterThanOrEqual(OW.CITY_HIDE);
    standAt(world, c, a.centre.x, a.centre.z);
    c.vehicles.seated = world.regions.find((r: any) => r.id === a.id).parked[0];
    standAt(world, c, b.centre.x, b.centre.z); standAt(world, c, d.centre.x, d.centre.z);
    expect(world.places[1].built).toBe(true);                                  // seated — never freed, even out of view
    expect(world.places[3].built).toBe(true);                                  // the place ahead still appears
    c.vehicles.seated = null;
    standAt(world, c, d.centre.x, d.centre.z);
    expect(world.places[3].built).toBe(true);
    expect(world.places[1].built).toBe(false);                                 // now out of view and the budget is full
    world.dispose();
  }, 180_000);
  it('standing between two places never builds and frees them back and forth', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions: villages(2) });
    const [, a, b] = world.places;
    const mid = { x: (a.centre.x + b.centre.x) / 2, z: (a.centre.z + b.centre.z) / 2 };
    const ever = new Set<string>();
    for (let f = 0; f < 60; f++) {
      const t = f % 2 ? 0.02 : -0.02;   // a tiny sway across the middle
      standAt(world, c, mid.x + (b.centre.x - a.centre.x) * t, mid.z + (b.centre.z - a.centre.z) * t, 1);
      for (const p of world.places) if (p.built) ever.add(p.id);
      for (const id of ever) expect(world.places.find((p: any) => p.id === id).built).toBe(true);  // once built, never taken down again
    }
    world.dispose();
  }, 180_000);
  it('a grown city counts once: all its tiles stand together within a phone\'s two', () => {
    const c = context();
    const regions = [{ id: 'home', kind: 'city', city: tiny }, { id: 'metro', kind: 'city', city: tiny }, ...[1, 2, 3].map((i) => ({ id: 'metro-tile' + i, kind: 'city', joinTo: 'metro' }))];
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions });
    const metro = world.places.filter((p: any) => p.id.startsWith('metro'));
    for (let k = 0; k < 4; k++) standAt(world, c, metro[k].centre.x, metro[k].centre.z, 2);
    expect(metro.every((p: any) => p.built)).toBe(true);
    expect(standing(world)).toBe(2);
    world.dispose();
  }, 180_000);
});

describe('🌌 up to 1,000 places — and an older map file is never handed more than it reads', () => {
  it('the kit, the platform and the rule agree on 1,000', () => {
    expect(OPEN_WORLD_MAX_REGIONS).toBe(1000); expect(MAX_PLACES).toBe(1000);
    expect(recipeFilePool().get(OPEN_WORLD_BRIDGE_PATH)!.content).toContain('export const MAX_REGIONS = 1000;');
    expect(GAME_WORLD_RULE).toMatch(/Up to 1000 regions \(places and lands together; an older src\/game\/play\/openWorld\.ts reads only its own MAX_REGIONS, 100\)/);
    expect(OPEN_WORLD_FILE).toBe(OPEN_WORLD_BRIDGE_PATH);
  });
  it('the game\'s own map file says how many it reads; unreadable or older = 100', () => {
    expect(placesTheMapHolds(recipeFilePool().get(OPEN_WORLD_BRIDGE_PATH)!.content)).toBe(1000);
    expect(placesTheMapHolds('export const MAX_REGIONS = 100;')).toBe(100);
    expect(placesTheMapHolds('export const MAX_REGIONS = 5000;')).toBe(1000);
    expect(placesTheMapHolds(null)).toBe(OLD_MAX_PLACES);
    expect(placesTheMapHolds('// no number here')).toBe(100);
  });
  const worldWith = (n: number) => `export const WORLD = {\n  regions: [\n${Array.from({ length: n }, (_, i) => `    { id: 'p${i}', kind: 'village' },`).join('\n')}\n  ],\n};\n`;
  it('the library adds a 101st place only where the map file reads 1,000; an older one is told it is full (100 places)', async () => {
    const run = async (bridge: string | null) => {
      const files: Record<string, string> = { 'src/game/world.ts': worldWith(100), ...(bridge === null ? {} : { [OPEN_WORLD_FILE]: bridge }) };
      const issues: Array<{ code: string }> = [];
      const said = await addLibraryPlaceAtTurnStart({
        prompt: 'Add this to my game (library map place: "village")', filesAtTurnStart: { ...files },
        read: async (p) => { if (!(p in files)) throw new Error('missing'); return files[p]; },
        write: async (p, c) => { files[p] = c; }, record: (i) => issues.push(i),
      });
      return { said, issues: issues.map((i) => i.code), count: (files['src/game/world.ts'].match(/kind: 'village'/g) || []).length };
    };
    const fresh = await run('export const MAX_REGIONS = 1000;');
    expect(fresh.count).toBe(101); expect(fresh.issues).toEqual(['MAP_PLACE_ADDED']);
    const older = await run('export const MAX_REGIONS = 100;');
    expect(older.count).toBe(100); expect(older.issues).toEqual(['MAP_PLACE_NOT_ADDED']); expect(older.said).toContain('already has 100 places');
    const none = await run(null);
    expect(none.count).toBe(100);
    expect(appendPlace(worldWith(999), 'city')).toMatchObject({ ok: true, count: 1000 });
    expect(appendPlace(worldWith(1000), 'city')).toEqual({ ok: false, reason: 'full' });
    expect(placeNotAddedHandoff('city', 100)).toContain('100 places');
  });
  it('a list longer than 1,000 is cut at 1,000 — and said in the console, never silently', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = context();
    // Lands are never left out for want of dry ground, so the list really reaches the cap.
    const regions = [{ id: 'home', kind: 'village', city: tiny }, ...Array.from({ length: 1002 }, (_, i) => ({ id: 'l' + i, kind: (['desert', 'jungle', 'snow'] as const)[i % 3], radius: 150 }))];
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions });
    expect(said.mock.calls.flat().join(' ')).toMatch(/the map holds 1000 places and lands; 3 more in the list were left out/);
    expect(world.places.length + world.lands.length).toBe(1000);
    expect(world.lands.at(-1).id).toBe('l998');
    said.mockRestore(); world.dispose();
  }, 180_000);
});

describe('🌊 a land or a user map laid the spread way never falls into the sea silently', () => {
  it('in the sea: said in the console, still on the map, not moved; on dry ground: nothing said', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, profile: 'battle-royale', quality: 'phone', regions: [
      { id: 'home', kind: 'village', city: tiny },
      { id: 'wet-sands', kind: 'desert', toward: 'north', distance: 7000 },
      { id: 'wet-map', kind: 'custom', model: 'kan', toward: 'west', distance: 7000 },
      { id: 'dry-woods', kind: 'jungle', toward: 'east', distance: 900, radius: 200 },
    ] });
    const text = said.mock.calls.flat().join(' ');
    expect(text).toMatch(/the land "wet-sands" lies mostly in the sea or a river/);
    expect(text).toMatch(/the map "wet-map" lies mostly in the sea or a river/);
    expect(text).not.toMatch(/"dry-woods"/);
    expect(world.lands.map((l: any) => l.id)).toEqual(['wet-sands', 'dry-woods']);
    expect(world.userMaps.map((m: any) => m.id)).toEqual(['wet-map']);
    said.mockRestore(); world.dispose();
  }, 180_000);
});
