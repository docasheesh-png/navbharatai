// A THOUSAND PLACES, THE NEAREST FEW LIVE (map expansion plan, item 4; owner decision: up to 1,000 places, live cities at once —
// phone 2, mid 5, desktop 8). Planning a map of a thousand places took seconds: the highway tree tried every joined stop against
// every other stop at each step (n³), and every candidate spot was checked against every place already on the map. Both now
// look only where they need to, with exactly the same answers, so the same list gives the same map.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as THREE from 'three';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

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
    expect(bridge).toMatch(/for \(const best of spanningPairs\(stops\)\)/);
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
  for (const [quality, budget] of [['phone', 2], ['mid', 5], ['desktop', 8]] as const) {
    it(quality + ': visiting twelve places, never more than ' + budget + ' stand; home always stands', () => {
      const c = context();
      const world = OW.createOpenWorld(c, { seed: 7, quality, regions: villages(12) });
      let most = 0;
      for (const p of world.places.slice(1)) {
        standAt(world, c, p.centre.x, p.centre.z);
        most = Math.max(most, standing(world));
        expect(world.places.find((q: any) => q.id === p.id).built).toBe(true);   // the place the player is in stands
        expect(world.regions[0].id).toBe('home');
        expect(world.city.id).toBe('home');
      }
      expect(most).toBe(budget);
      expect(world.places.filter((q: any) => q.built).length).toBe(budget);
      world.dispose();
    }, 180_000);
  }
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
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions: villages(4) });
    const [, a, b, d] = world.places;
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
  it('a city whose car the player is driving is never freed', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions: villages(4) });
    const [, a, b, d] = world.places;
    standAt(world, c, a.centre.x, a.centre.z);
    c.vehicles.seated = world.regions.find((r: any) => r.id === a.id).parked[0];
    standAt(world, c, b.centre.x, b.centre.z); standAt(world, c, d.centre.x, d.centre.z);
    expect(world.places[1].built).toBe(true);
    expect(world.places[2].built || world.places[3].built).toBe(false);   // nothing could be freed for them
    c.vehicles.seated = null;
    standAt(world, c, d.centre.x, d.centre.z);
    expect(world.places[3].built).toBe(true);
    expect(world.places[1].built).toBe(false);
    world.dispose();
  }, 180_000);
  it('standing between two places never builds and frees them back and forth', () => {
    const c = context();
    const world = OW.createOpenWorld(c, { seed: 7, quality: 'phone', regions: villages(2) });
    const [, a, b] = world.places;
    const mid = { x: (a.centre.x + b.centre.x) / 2, z: (a.centre.z + b.centre.z) / 2 };
    let changes = 0, last = world.regions.map((r: any) => r.id).join();
    for (let f = 0; f < 60; f++) {
      const t = f % 2 ? 0.02 : -0.02;   // a tiny sway across the middle
      standAt(world, c, mid.x + (b.centre.x - a.centre.x) * t, mid.z + (b.centre.z - a.centre.z) * t, 1);
      const now = world.regions.map((r: any) => r.id).join();
      if (now !== last) { changes++; last = now; }
    }
    expect(changes).toBeLessThanOrEqual(1);
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
