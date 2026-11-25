// PLACES STAND CLOSE, WITH A ROAD BETWEEN (admin 2026-11-22, failedbr #2499: "maine kaha map me 4 village/city add karo, to
// add huye hi nahi" — then, asked how they should appear: "maps thode pas pas rahe, aur beech me road ho").
//
// 🧬 THE CLASS (Q-3330): a place's distance came from WHEN it was added, not from where there was room. createOpenWorld laid
// the n-th place on a golden-angle spiral about sqrt(n) spacings from the first, so with ~25 regions the four newest cities
// stood 2.6 to 3.2 km out — never built from the start (a city is built within reach + BUILD_AHEAD) and never seen. Now every
// place takes the nearest free spot that keeps PLACE_GAP of open country to its neighbours.
// 🧬 THE ROAD BETWEEN (Q-3331, Q-3332): the drive below goes from the spawn to every place along the highways (which end on
// each city's border since #4459). Two siblings it found: world.addRoad's grade passes moved a road's END off the place's
// levelled square, so the road cut into or lifted the city's ground at the gate (Q-3332: an end on a pad is pinned); and with
// the ends pinned, two places on very different levels joined directly got a climb no car can take (Q-3331: the highway tree
// then joins them through a neighbour on a level between them).
// Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-close-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let CITY: any;
/** The kit's own numbers (they live in the generated module). */
let PLACE_GAP: { min: number; max: number }; let BUILD_AHEAD: number;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  CITY = await import(join(DIR, 'src/game/three/city.ts'));
  ({ PLACE_GAP, BUILD_AHEAD } = OW);
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, player, ctx: { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } } };
};
const small = { traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };
// 25 regions as a grown map holds them: cities, towns, villages and lands, added one by one — the last four are the four
// places #2499 asked for.
const KINDS = ['city', 'town', 'village', 'village', 'town', 'desert', 'village', 'jungle', 'town', 'village', 'city', 'grassland', 'village', 'city', 'town', 'village', 'village', 'town', 'desert', 'village', 'jungle', 'city', 'village', 'town', 'village'];
const REGIONS = KINDS.map((kind, i) => ({ id: `r${i}`, kind, city: small }));

/** Every place and land as a box in WORLD metres (a place: its levelled ground; a land: its radius). */
const boxes = (world: any) => [
  ...world.places.map((p: any) => ({ id: p.id, land: false, cx: p.centre.x, cz: p.centre.z, hx: p.plan.width / 2 + 8, hz: p.plan.depth / 2 + 8, place: p })),
  ...world.lands.map((l: any) => ({ id: l.id, land: true, cx: l.centre.x, cz: l.centre.z, hx: l.radius, hz: l.radius, place: null })),
];
const edgeGap = (a: any, b: any) => Math.max(Math.abs(a.cx - b.cx) - a.hx - b.hx, Math.abs(a.cz - b.cz) - a.hz - b.hz);
/** The place whose STREETS hold a WORLD point (null: none). */
const streetOwner = (world: any, x: number, z: number) => world.places.find((p: any) => CITY.onStreet(p.plan, x - p.centre.x, z - p.centre.z)) ?? null;

/**
 * DRIVE THE ROAD GRAPH from the place the player starts in: every highway joins the places whose streets (or the land) hold
 * its two ends; the tiles of one grown city share their streets. Returns the ids reached, and every fault met on the way.
 */
function drive(world: any): { reached: Set<string>; faults: string[] } {
  const faults: string[] = [];
  const links = new Map<string, Set<string>>();
  const join2 = (a: string, b: string) => { for (const [p, q] of [[a, b], [b, a]]) { if (!links.has(p)) links.set(p, new Set()); links.get(p)!.add(q); } };
  const endOwner = (pt: any): string | null => {
    const p = streetOwner(world, pt.x, pt.z); if (p) return p.id;
    const l = world.lands.find((q: any) => Math.hypot(pt.x - q.centre.x, pt.z - q.centre.z) <= q.radius); return l ? l.id : null;
  };
  world.highways.forEach((line: any[], k: number) => {
    const a = endOwner(line[0]), b = endOwner(line[line.length - 1]);
    if (!a || !b) { faults.push(`highway ${k} ends off every street and land (${a} → ${b})`); return; }
    join2(a, b);
    // Where it meets a city, the city's own ground keeps its level (a road end off the level cuts into it or lifts it).
    for (const end of [line[0], line[line.length - 1]]) {
      const p = streetOwner(world, end.x, end.z); if (!p) continue;
      const dx = p.centre.x - end.x, dz = p.centre.z - end.z, l = Math.hypot(dx, dz) || 1;
      const inside = world.heightAt(end.x + (dx / l) * 3, end.z + (dz / l) * 3), level = world.heightAt(p.centre.x, p.centre.z);
      if (Math.abs(inside - level) > 0.05) faults.push(`highway ${k} moves the ground of ${p.id} by ${(inside - level).toFixed(2)} m`);
    }
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1], q = line[i], len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len > 15) faults.push(`highway ${k} jumps ${len.toFixed(0)} m`);
      if (Math.abs(q.y - p.y) / Math.max(1, len) > 0.1) faults.push(`highway ${k} is too steep at ${i}/${line.length} ${p.y.toFixed(2)}→${q.y.toFixed(2)} over ${len.toFixed(1)}`);
      // Every metre of it: inside a city's square, only ever on its streets (never across a block).
      for (let s = 0; s < len; s += 2) {
        const x = p.x + ((q.x - p.x) * s) / len, z = p.z + ((q.z - p.z) * s) / len;
        for (const pl of world.places) {
          const lx = x - pl.centre.x, lz = z - pl.centre.z;
          if (Math.abs(lx) < pl.plan.width / 2 && Math.abs(lz) < pl.plan.depth / 2 && !CITY.onStreet(pl.plan, lx, lz)) faults.push(`highway ${k} crosses a block of ${pl.id}`);
        }
      }
    }
  });
  const ps = world.places;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const A = ps[i], B = ps[j];
    if (Math.abs(A.centre.x - B.centre.x) < (A.plan.width + B.plan.width) / 2 && Math.abs(A.centre.z - B.centre.z) < (A.plan.depth + B.plan.depth) / 2) join2(A.id, B.id);
  }
  const start = streetOwner(world, world.spawn.x, world.spawn.z)?.id ?? ps[0].id;
  const reached = new Set<string>([start]); const queue = [start];
  while (queue.length) for (const next of links.get(queue.shift()!) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  return { reached, faults: [...new Set(faults)] };
}

describe('Q-3330 — places stand close together, a short drive apart', () => {
  it('25 regions: every place within 1.7 km of the start (was up to 3.2 km), every land within 2 km (was 6.4 km)', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: REGIONS });
    expect(world.places.length + world.lands.length).toBe(25);
    const o = world.places[0].centre;
    const far = (p: any) => Math.hypot(p.centre.x - o.x, p.centre.z - o.z);
    for (const p of world.places) expect(far(p), p.id).toBeLessThan(1700);
    for (const l of world.lands) expect(far(l), l.id).toBeLessThan(2000);
    // #2499's four newest places: each one is BUILT as the player looks around the start (within reach + BUILD_AHEAD).
    for (const p of world.places.slice(-4)) expect(far(p), p.id).toBeLessThan(p.radius + BUILD_AHEAD);
    // The player starts in the first place.
    expect(streetOwner(world, world.spawn.x, world.spawn.z)?.id).toBe('r0');
    world.dispose();
  }, 120_000);

  it('never overlapping: every pair keeps at least PLACE_GAP.min of open country, edge to edge — and each has a neighbour close by', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: REGIONS });
    const all = boxes(world);
    for (let i = 0; i < all.length; i++) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let j = 0; j < all.length; j++) {
        if (i === j) continue;
        const g = edgeGap(all[i], all[j]);
        expect(g, `${all[i].id} – ${all[j].id}`).toBeGreaterThanOrEqual(PLACE_GAP.min - 0.01);
        nearest = Math.min(nearest, g);
      }
      // Compact: the nearest neighbour is a short drive away, not a journey (the gap a free spot takes, plus a little for water).
      expect(nearest, all[i].id).toBeLessThanOrEqual(PLACE_GAP.max + 120);
    }
    world.dispose();
  }, 120_000);

  it('the same list always gives the same map', () => {
    const a = OW.createOpenWorld(context().ctx, { seed: 7, regions: REGIONS });
    const where = (w: any) => [...w.places, ...w.lands].map((p: any) => [p.id, Math.round(p.centre.x), Math.round(p.centre.z)]);
    const first = where(a); a.dispose();
    const b = OW.createOpenWorld(context().ctx, { seed: 7, regions: REGIONS });
    expect(where(b)).toEqual(first); b.dispose();
  }, 120_000);

  it('a direction, a distance and a size that were asked are still kept', () => {
    const world = OW.createOpenWorld(context().ctx, { seed: 7, regions: [
      { id: 'home', kind: 'city', city: small },
      { id: 'east-town', kind: 'town', toward: 'east', city: small },
      { id: 'far-village', kind: 'village', toward: 'north', distance: 6000, city: small },
    ] });
    const [home, east, far] = world.places;
    expect(east.centre.x - home.centre.x).toBeGreaterThan(Math.abs(east.centre.z - home.centre.z) * 3);   // east, on the axis
    expect(east.centre.x - home.centre.x).toBeLessThan(home.radius + east.radius + PLACE_GAP.max + 50);   // and close
    expect(Math.hypot(far.centre.x - home.centre.x, far.centre.z - home.centre.z)).toBeGreaterThanOrEqual(6000 - 1);
    world.dispose();
    const spread = OW.createOpenWorld(context().ctx, { seed: 7, spreadMeters: 20000, regions: REGIONS.slice(0, 8) });
    const o = spread.places[0].centre;
    const reach = Math.max(...[...spread.places, ...spread.lands].map((p: any) => Math.hypot(p.centre.x - o.x, p.centre.z - o.z)));
    expect(reach).toBeGreaterThan(5000);                                                                 // spread across the asked square
    spread.dispose();
  }, 120_000);

  it('a land or a user\'s map listed before any place leaves the start for the first place (the player never starts in a desert)', () => {
    const world = OW.createOpenWorld(context().ctx, { seed: 7, regions: [
      { id: 'sand', kind: 'desert' },
      { id: 'mine', kind: 'custom', model: 'kan' },
      { id: 'home', kind: 'city', city: small },
      { id: 'v', kind: 'village', city: small },
    ] });
    const all = [...boxes(world), ...world.userMaps.map((m: any) => ({ id: m.id, cx: m.centre.x, cz: m.centre.z, hx: m.size / 2, hz: m.size / 2 }))];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(edgeGap(all[i], all[j]), `${all[i].id} – ${all[j].id}`).toBeGreaterThan(100);
    expect(streetOwner(world, world.spawn.x, world.spawn.z)?.id).toBe('home');
    world.dispose();
  }, 120_000);

  it('a grown city keeps room for the tiles that join it later in the list: no place is laid where it will grow', () => {
    const world = OW.createOpenWorld(context().ctx, { seed: 7, regions: [
      { id: 'main', kind: 'city', city: small },
      { id: 'v1', kind: 'village', city: small },
      { id: 'v2', kind: 'village', city: small },
      { id: 'hill', kind: 'town', city: small },
      { id: 'v3', kind: 'village', city: small },
      { id: 'main-2', kind: 'city', joinTo: 'main', city: small },
      { id: 'main-3', kind: 'city', joinTo: 'main-2', toward: 'east', city: small },
      { id: 'hill-2', kind: 'town', joinTo: 'hill', city: small },
      { id: 'v4', kind: 'village', city: small },
    ] });
    expect(world.places.map((p: any) => p.id)).toEqual(['main', 'v1', 'v2', 'hill', 'v3', 'main-2', 'main-3', 'hill-2', 'v4']);
    const all = boxes(world);
    const cluster = (id: string) => (/^main/.test(id) ? 'main' : /^hill/.test(id) ? 'hill' : id);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (cluster(all[i].id) === cluster(all[j].id)) continue;
      expect(edgeGap(all[i], all[j]), `${all[i].id} – ${all[j].id}`).toBeGreaterThanOrEqual(PLACE_GAP.min - 0.01);
    }
    const { reached, faults } = drive(world);
    expect(faults).toEqual([]);
    expect([...reached].sort()).toEqual(world.places.map((p: any) => p.id).sort());
    world.dispose();
  }, 120_000);
});

describe('Q-3331 — a road between: every place is driven to from the start, street to street', () => {
  it('25 regions: the road graph reaches every place and land from the spawn; every road starts and ends on streets or in its land, never on a block', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: REGIONS });
    const { reached, faults } = drive(world);
    expect(faults).toEqual([]);
    expect([...reached].sort()).toEqual([...world.places, ...world.lands].map((p: any) => p.id).sort());
    // The drawn highway is the road the map was carved to, from the city's own ground at each end.
    for (const line of world.highways) for (const pt of [line[0], line[1], line[line.length - 2], line[line.length - 1]]) {
      expect(Math.abs(world.heightAt(pt.x, pt.z) - pt.y)).toBeLessThan(0.5);
    }
    world.dispose();
  }, 120_000);

  it('a 100-place universe is one network too, street to street, with no road across a block', () => {
    const kinds = ['city', 'town', 'village', 'desert', 'jungle', 'mountain'];
    const world = OW.createOpenWorld(context().ctx, { seed: 5, regions: Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, kind: kinds[i % kinds.length], city: small })) });
    const { reached, faults } = drive(world);
    expect(faults).toEqual([]);
    expect(reached.size).toBe(world.places.length + world.lands.length);
    world.dispose();
  }, 180_000);

  it('the full map is handed every place and every road, and a place already built is never built twice', async () => {
    const MAP = await import(join(DIR, 'src/game/ui/worldMap.ts'));
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: REGIONS.slice(0, 12) });
    const data = MAP.readWorldMap();
    expect(data.places.map((p: any) => p.id).sort()).toEqual([...world.places, ...world.lands].map((p: any) => p.id).sort());
    expect(data.roads.length).toBe(world.highways.length);
    // Walk to every place in turn (and back to the start): each is built once.
    const origin = () => world.map.chunks.origin;
    for (const p of [...world.places, world.places[0]]) {
      c.player.reset(p.centre.x - origin().x, world.heightAt(p.centre.x, p.centre.z) + 1, p.centre.z - origin().z);
      for (let i = 0; i < 3; i++) world.frame(c.ctx, 1 / 60);
    }
    const ids = world.regions.map((r: any) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(c.scene.children.filter((o: any) => /^Region /.test(o.name)).length).toBe(ids.length);
    world.dispose();
  }, 180_000);
});
