// THE OPEN WORLD HAS PLACES TO FIND AND RELICS TO COLLECT (template round R6, open-world kit part). Runs the REAL emitted
// play/openWorld.ts: relics are laid along the highways (always open ground) or in a ring outside the start place, the
// same map always gets the same relics, walking into a place discovers it once, walking over a relic takes it once,
// progress survives a reload and a broken save starts fresh, the hint points at the nearest place not found yet with the
// right compass word, and the starter wires it in (on by default, explore={false} turns it off) without touching a
// hand-edited file (the kit history only refreshes files the user never changed).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { generateOpenWorld, GAME_OPEN_WORLD_STARTER, OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_KIT_HISTORY } from '../src/server/lib/gameKitHistory';
import { kitRefreshable } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-open-world-explore-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any;
const store = new Map<string, string>();
beforeAll(async () => {
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  const files: Record<string, string> = {};
  for (const [path, f] of recipeFilePool()) if (/^src\/game\//.test(path) && !/\.test\.tsx?$/.test(path)) files[path] = f.content;
  Object.assign(files, generateOpenWorld().files);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 120_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).localStorage; });
beforeEach(() => store.clear());

/** A stand-in OpenWorld: flat ground at height 2, a player you can move, places and highways you choose. */
function fakeWorld(places: any[], highways: any[] = [], spawn = { x: 0, y: 2, z: 0 }) {
  let at = { ...spawn };
  const placed: THREE.Object3D[] = [];
  return {
    places, highways, spawn, map: { world: { seed: 7 } },
    playerWorld: () => ({ ...at }), heightAt: () => 2,
    place: (o: THREE.Object3D, x: number, z: number, lift = 0) => { o.position.set(x, 2 + lift, z); placed.push(o); },
    release: (o: THREE.Object3D) => { placed.splice(placed.indexOf(o), 1); },
    moveTo: (x: number, z: number) => { at = { x, y: 2, z }; },
    placed,
  };
}
const ctxOf = () => ({ scene: new THREE.Scene() }) as any;

describe('🧭 the pure parts', () => {
  it('relics go along the highways when there are any, the same way every time, and in a ring outside the start place when not', () => {
    const road = [[{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }]];
    const a = OW.relicSpots(10, road, { x: 0, z: 0 }, 7), b = OW.relicSpots(10, road, { x: 0, z: 0 }, 7);
    expect(a).toEqual(b); expect(a).toHaveLength(10);
    for (const p of a) expect(Math.min(Math.abs(p.z), Math.abs(p.x - 400))).toBeLessThan(1e-6);   // on the road line
    expect(OW.relicSpots(10, road, { x: 0, z: 0 }, 8)).not.toEqual(a);
    const ring = OW.relicSpots(8, [], { x: 100, z: -50 }, 3, 60);
    for (const p of ring) { const d = Math.hypot(p.x - 100, p.z + 50); expect(d).toBeGreaterThanOrEqual(75); expect(d).toBeLessThanOrEqual(176); }
    expect(OW.relicSpots(0, road, { x: 0, z: 0 }, 1)).toEqual([]);
    expect(OW.relicSpots(1e6, road, { x: 0, z: 0 }, 1)).toHaveLength(200);
    const kept = OW.relicSpots(10, road, { x: 0, z: 0 }, 7, 0, (p: { x: number; z: number }) => p.x >= 80);
    expect(kept).toHaveLength(10); for (const p of kept) expect(p.x).toBeGreaterThanOrEqual(80);
  });
  it('compass words match the corner map (north is -z, east is +x)', () => {
    const o = { x: 0, z: 0 };
    expect(OW.compassWay(o, { x: 0, z: -10 })).toBe('north'); expect(OW.compassWay(o, { x: 10, z: 0 })).toBe('east');
    expect(OW.compassWay(o, { x: 0, z: 10 })).toBe('south'); expect(OW.compassWay(o, { x: -10, z: 0 })).toBe('west');
    expect(OW.compassWay(o, { x: 10, z: -10 })).toBe('north-east'); expect(OW.compassWay(o, { x: -10, z: 10 })).toBe('south-west');
  });
  it('discovery and the next-place hint', () => {
    const places = [{ id: 'a', centre: { x: 0, z: 0 }, radius: 50 }, { id: 'b', centre: { x: 500, z: 0 }, radius: 80 }, { id: 'c', centre: { x: 0, z: -900 }, radius: 10 }];
    expect(OW.newlyFound(places, [], { x: 10, z: 10 })).toEqual(['a']);
    expect(OW.newlyFound(places, ['a'], { x: 10, z: 10 })).toEqual([]);
    expect(OW.newlyFound(places, [], { x: 0, z: -885 })).toEqual(['c']);   // a tiny place still counts within 20 m
    expect(OW.nearestUnfound(places, ['a'], { x: 0, z: 0 })).toEqual({ id: 'b', distance: 500, way: 'east' });
    expect(OW.nearestUnfound(places, ['a', 'b', 'c'], { x: 0, z: 0 })).toBeNull();
  });
  it('a save is read safely', () => {
    expect(OW.readExploreSave({ found: ['a', 'a', 3], relics: [1, 1, -1, 2.5, 4] })).toEqual({ found: ['a'], relics: [1, 4] });
    for (const bad of [null, 'x', 7, { found: 'a' }]) expect(OW.readExploreSave(bad)).toEqual({ found: [], relics: [] });
  });
});

describe('💎 createExploration', () => {
  const places = [{ id: 'main-city', centre: { x: 0, z: 0 }, radius: 60 }, { id: 'old-town', centre: { x: 600, z: 0 }, radius: 50 }];
  const road = [[{ x: 0, z: 0 }, { x: 600, z: 0 }]];
  it('discovers each place once, takes each relic once, and says so', () => {
    const w = fakeWorld(places, road), ctx = ctxOf();
    const ex = OW.createExploration(ctx, w, { relics: 4, names: { 'old-town': 'Rampur' } });
    expect(w.placed).toHaveLength(4); expect(ctx.scene.children.filter((c: any) => /^Relic /.test(c.name))).toHaveLength(4);
    ex.update(ctx, 0.1);
    let s = ex.status();
    expect(s.found).toBe(1); expect(s.places).toBe(2); expect(s.toast).toBe('Discovered: Main City');
    expect(s.next).toEqual({ name: 'Rampur', distance: 600, way: 'east' });
    const relic = w.placed[1];
    w.moveTo(relic.position.x + 1, relic.position.z); ex.update(ctx, 0.1);
    s = ex.status(); expect(s.relics).toBe(1); expect(s.toast).toBe('Relic 1 of 4'); expect(relic.visible).toBe(false);
    ex.update(ctx, 0.1); expect(ex.status().relics).toBe(1);
    w.moveTo(600, 0); ex.update(ctx, 0.1);
    s = ex.status(); expect(s.found).toBe(2); expect(s.next).toBeNull(); expect(s.toast).toBe('Discovered: Rampur');
    for (let i = 0; i < 40; i++) ex.update(ctx, 0.1);
    expect(ex.status().toast).toBe('');
    ex.dispose(); expect(w.placed).toHaveLength(0);
  });
  it('a relic high above or deep below the player is not taken', () => {
    const w = fakeWorld(places, road), ctx = ctxOf();
    const ex = OW.createExploration(ctx, w, { relics: 2 });
    const relic = w.placed[0];
    w.moveTo(relic.position.x, relic.position.z);
    (w as any).playerWorld = () => ({ x: relic.position.x, y: 30, z: relic.position.z });
    ex.update(ctx, 0.1); expect(ex.status().relics).toBe(0);
    ex.dispose();
  });
  it('progress survives a reload: found places stay found and taken relics stay gone', () => {
    const w = fakeWorld(places, road), ctx = ctxOf();
    const ex = OW.createExploration(ctx, w, { relics: 3 });
    w.moveTo(w.placed[2].position.x, w.placed[2].position.z); ex.update(ctx, 0.1); ex.dispose();
    const w2 = fakeWorld(places, road), ctx2 = ctxOf();
    const again = OW.createExploration(ctx2, w2, { relics: 3 });
    expect(again.status().relics).toBe(1); expect(w2.placed[2].visible).toBe(false); expect(w2.placed[0].visible).toBe(true);
    store.set('open-world-explore-v1', '{broken');
    const fresh = OW.createExploration(ctxOf(), fakeWorld(places, road), { relics: 3 });
    expect(fresh.status().relics).toBe(0);
  });
  it('relics: 0 keeps discovery without relics; open country has relics and no places', () => {
    const w = fakeWorld(places, road), ex = OW.createExploration(ctxOf(), w, { relics: 0 });
    expect(w.placed).toHaveLength(0); expect(ex.status().relicsTotal).toBe(0);
    const open = fakeWorld([], []), ex2 = OW.createExploration(ctxOf(), open, {});
    expect(open.placed).toHaveLength(12); expect(ex2.status()).toMatchObject({ places: 0, relicsTotal: 12, next: null });
  });
});

describe('🌍 on the real map', () => {
  it('relics stand on the real highways of a map with places, at the ground height', () => {
    const scene = new THREE.Scene(), player = new CH.CharacterController({}); scene.add(player.object);
    const ctx: any = { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), player, vehicles: { add() {}, seated: null } };
    const world = OW.createOpenWorld(ctx, { seed: 7, regions: [{ id: 'main-city', kind: 'village' }, { id: 'old-town', kind: 'village', toward: 'east' }] });
    expect(world.highways.length).toBeGreaterThan(0);
    const ex = OW.createExploration(ctx, world, { relics: 6 });
    const relics = scene.children.filter((c) => /^Relic /.test(c.name));
    expect(relics).toHaveLength(6);
    const spots = OW.relicSpots(6, world.highways, world.spawn, world.map.world.seed);
    const origin = world.map.chunks?.origin ?? { x: 0, z: 0 };
    spots.forEach((p: any, i: number) => {
      expect(relics[i].position.x).toBeCloseTo(p.x - (origin.x ?? 0), 3);
      expect(relics[i].position.y).toBeGreaterThan(world.heightAt(p.x, p.z) - (origin.y ?? 0) + 0.5);
    });
    relics.forEach((m: any, i: number) => {
      const p = spots[i];
      expect(world.heightAt(p.x, p.z)).toBeGreaterThanOrEqual(2);
      expect(world.map.world.waterAt(p.x, p.z)).toBeNull();
    });
    ex.update(ctx, 1 / 60);
    expect(ex.status().places).toBe(2);
    ex.dispose(); world.dispose();
  }, 60_000);
  it('open-country relics sit on land, even for a seed whose first ring pick had a dip', () => {
    const scene = new THREE.Scene(), player = new CH.CharacterController({}); scene.add(player.object);
    const ctx: any = { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), player, vehicles: { add() {}, seated: null } };
    const world = OW.createOpenWorld(ctx, { seed: 2026 });
    const ex = OW.createExploration(ctx, world, { relics: 12 });
    const relics = scene.children.filter((c) => /^Relic /.test(c.name));
    expect(relics).toHaveLength(12);
    for (const m of relics) {
      const x = m.position.x + (world.map.chunks?.origin.x ?? 0), z = m.position.z + (world.map.chunks?.origin.z ?? 0);
      expect(world.heightAt(x, z)).toBeGreaterThanOrEqual(2);
      expect(world.map.world.waterAt(x, z)).toBeNull();
    }
    ex.dispose(); world.dispose();
  }, 60_000);
});

describe('🎮 the starter', () => {
  it('runs exploring by default, can turn it off, names places from world.ts, and shows the bar', () => {
    expect(GAME_OPEN_WORLD_STARTER).toContain("explore = true");
    expect(GAME_OPEN_WORLD_STARTER).toContain('if (explore !== false)');
    expect(GAME_OPEN_WORLD_STARTER).toContain('if (r.name) names[r.id] = r.name');
    expect(GAME_OPEN_WORLD_STARTER).toContain('exploring.current?.update(ctx, delta)');
    expect(GAME_OPEN_WORLD_STARTER).toContain('exploring.current?.dispose()');
    expect(GAME_OPEN_WORLD_STARTER).toMatch(/places<\/span>/);
  });
  it('the kit history knows the new versions, so only unedited old projects are refreshed', () => {
    expect((GAME_KIT_HISTORY as any)['src/game/OpenWorldGame.tsx'].length).toBeGreaterThan(1);
    expect((GAME_KIT_HISTORY as any)['src/game/play/openWorld.ts'].length).toBeGreaterThan(1);
    // A hand-edited starter or bridge is never replaced by this version.
    const files = generateOpenWorld().files;
    for (const path of ['src/game/OpenWorldGame.tsx', OPEN_WORLD_BRIDGE_PATH]) {
      const edited = files[path].replace('export', '// my change\nexport');
      expect(kitRefreshable(path, edited, files[path])).toBe(false);
    }
  });
});
