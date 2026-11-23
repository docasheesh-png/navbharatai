// "GHAAS KE MAIDAN SIMPLE GREEN FIELD BAN RAHE HAI" (admin 2026-11-23: "inko bhi improvement karo, real ghaas, bush, tree, patthar
// sab randomly bikhre rahe … jisse nature feel aye!").
//
// A built game's grass field was one flat green: every grassland vertex had the same colour, grass tufts faded out 30 m from a
// phone's camera, an open field (a maidan the game laid) had no tree, and the map had no bush or stone anywhere. Now the ground's
// colour is patchy (lush, dry, bare earth), bushes and stones are scattered in seeded clumps, and an open field holds a few lone
// trees. These tests run the EMITTED kit: the layout is the same for the same seed, nothing lands on a road, a pad, water or the
// spawn, the counts stay inside each device tier's budget, nature: false brings back the plain look, and a kit file a user edited
// is never replaced by the refresh that brings these files to older games.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadAthree } from './helpers/loadAthree';
import { planKitRefresh, recipeFilePool, isKnownKitVersion } from '../src/server/lib/gameRecipeLayers';

vi.setConfig({ testTimeout: 120000 });

const A = loadAthree();
const TIERS = ['phone', 'mid', 'desktop'] as const;
/** plants.ts, vegetation.ts, chunks.ts and world.ts exactly as the kit wrote them before this change. */
const BEFORE: Record<string, string> = JSON.parse(gunzipSync(readFileSync('tests/fixtures/athreeNatureBefore.json.gz')).toString('utf8'));

function findBiome(world: any, want: string, from = 0): { x: number; z: number } | null {
  for (let i = from; i < 4000; i++) {
    const x = ((i * 7919) % 90000) - 45000;
    const z = ((i * 104729) % 90000) - 45000;
    if (world.biomeAt(x, z) === want && world.heightAt(x, z) > 4) return { x, z };
  }
  return null;
}

/** A grassland place with bushes and stones near it. */
function wildPlace(world: any): { x: number; z: number } {
  for (let probe = 0; probe < 60; probe++) {
    const p = findBiome(world, 'grassland', probe * 40);
    if (p && A.propsInRect(world, p.x - 60, p.z - 60, p.x + 60, p.z + 60, 5).length > 20) return p;
  }
  throw new Error('no wild place found');
}

describe('🌿 bushes and stones are scattered by seed, the same every time', () => {
  const world = A.createAthreeWorld({ seed: 5 });
  const p = wildPlace(world);
  const rect = [p.x - 200, p.z - 200, p.x + 200, p.z + 200] as const;
  const all = A.propsInRect(world, ...rect, 5);

  it('there are both, in a believable number', () => {
    expect(all.filter((q: any) => q.kind === 'bush').length).toBeGreaterThan(40);
    expect(all.filter((q: any) => q.kind === 'rock').length).toBeGreaterThan(10);
    expect(all.length).toBeLessThan((400 / 5) ** 2 * 0.5);
  });
  it('the same seed gives exactly the same layout (a second world, a second call)', () => {
    expect(A.propsInRect(A.createAthreeWorld({ seed: 5 }), ...rect, 5)).toEqual(all);
  });
  it('another seed gives another layout', () => {
    const other = A.propsInRect(A.createAthreeWorld({ seed: 6 }), ...rect, 5);
    expect(other).not.toEqual(all);
  });
  it('does not depend on which rectangle asks: four quarters hold exactly the whole', () => {
    const [x0, z0, x1, z1] = rect, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const parts = [
      ...A.propsInRect(world, x0, z0, mx, mz, 5), ...A.propsInRect(world, mx, z0, x1, mz, 5),
      ...A.propsInRect(world, x0, mz, mx, z1, 5), ...A.propsInRect(world, mx, mz, x1, z1, 5),
    ];
    const key = (q: any) => q.x.toFixed(4) + ',' + q.z.toFixed(4);
    expect(parts.map(key).sort()).toEqual(all.map(key).sort());
  });
  it('gathers them in clumps, not an even sprinkle: some 40 m squares hold far more than others', () => {
    const counts = new Map<string, number>();
    for (const q of all) { const k = Math.floor(q.x / 40) + ',' + Math.floor(q.z / 40); counts.set(k, (counts.get(k) ?? 0) + 1); }
    const v = [...counts.values()].sort((a, b) => a - b);
    expect(v[v.length - 1]).toBeGreaterThanOrEqual(Math.max(4, v[Math.floor(v.length / 2)] * 2));
  });
  it('the meshes are procedural and small: a bush 24 triangles, a stone 80, no texture', () => {
    expect(A.buildBushArrays().triangles).toBe(A.BUSH_TRIANGLES);
    expect(A.buildRockArrays().triangles).toBe(A.ROCK_TRIANGLES);
    expect(A.buildRockArrays().sway.every((s: number) => s === 0)).toBe(true);   // a stone never moves in the wind
  });
});

describe('🚫 never on a road, a pad, a venue, water, or where the player starts', () => {
  it('a levelled pad (a city, a venue) and a road the game laid stay bare, to the reach of a bush', () => {
    const world = A.createAthreeWorld({ seed: 5 });
    const p = wildPlace(world);
    world.levelGround(p.x, p.z, 40, 30, 20);                                   // a venue pad in the middle of the wild
    world.addRoad([{ x: p.x - 300, z: p.z + 80 }, { x: p.x + 300, z: p.z + 80 }], 9);
    const props = A.propsInRect(world, p.x - 300, p.z - 300, p.x + 300, p.z + 300, 5);
    expect(props.length).toBeGreaterThan(20);
    for (const q of props) {
      expect(world.clearAt(q.x, q.z)).toBe(false);
      expect(world.gameRoadAt(q.x, q.z)).toBe(false);
      expect(Math.abs(q.z - (p.z + 80))).toBeGreaterThan(4.5 + 2);           // half the road, plus the bush's reach
      expect(A.propBlocked(world, q.x, q.z, q.kind)).toBe(false);
      expect(Math.abs(q.x - p.x) <= 42 && Math.abs(q.z - p.z) <= 32).toBe(false);
    }
  });
  it('the road network, rivers, lakes and the sea stay bare', () => {
    const world = A.createAthreeWorld({ seed: 3 });
    const home = world.homeRoads();
    const road = home.roads.find((r: any) => r.points.length > 4)!;
    const at = road.points[Math.floor(road.points.length / 2)];
    let checked = 0;
    for (const q of A.propsInRect(world, at.x - 400, at.z - 400, at.x + 400, at.z + 400, 5)) {
      expect(world.roadAt(q.x, q.z)).toBeFalsy();
      expect(world.waterAt(q.x, q.z)).toBeFalsy();
      expect(world.heightAt(q.x, q.z)).toBeGreaterThanOrEqual(1);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, r = A.PROP_REACH[q.kind];
        expect(world.roadAt(q.x + Math.cos(a) * r, q.z + Math.sin(a) * r)).toBeFalsy();
        expect(world.waterAt(q.x + Math.cos(a) * r, q.z + Math.sin(a) * r)).toBeFalsy();
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    const river = world.waterBodies().rivers[0];
    if (river) {
      const m = river.points[Math.floor(river.points.length / 2)];
      for (const q of A.propsInRect(world, m.x - 200, m.z - 200, m.x + 200, m.z + 200, 5)) expect(world.waterAt(q.x, q.z)).toBeFalsy();
    }
  });
  it('a keep-clear circle holds none, and the manager keeps the player\'s spawn clear by itself', () => {
    const world = A.createAthreeWorld({ seed: 5 });
    const p = wildPlace(world);
    const props = A.propsInRect(world, p.x - 100, p.z - 100, p.x + 100, p.z + 100, 5, [{ x: p.x, z: p.z, r: 30 }]);
    for (const q of props) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThanOrEqual(30);
    const s = world.spawnPoints('player', 1)[0];
    const veg = A.createVegetation(THREE, world, 'desktop');
    for (let i = 0; i < 300; i++) veg.update(s.x, s.z, i * 0.016, { x: 0, z: 0 });
    for (const name of ['plants:bush', 'plants:rock']) {
      const mesh: any = veg.group.children.find((m: any) => m.name === name);
      const arr = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const x = arr[i * 16 + 12] + veg.group.position.x, z = arr[i * 16 + 14] + veg.group.position.z;
        expect(Math.hypot(x - s.x, z - s.z)).toBeGreaterThanOrEqual(8);
      }
    }
    veg.dispose();
  });
  it('a pad laid AFTER the scatter: prune takes every bush and stone off it', () => {
    const world = A.createAthreeWorld({ seed: 5 });
    const p = wildPlace(world);
    const veg = A.createVegetation(THREE, world, 'mid');
    for (let i = 0; i < 300; i++) veg.update(p.x, p.z, i * 0.016, { x: 0, z: 0 });
    const before = veg.stats().bushes + veg.stats().rocks;
    expect(before).toBeGreaterThan(0);
    world.levelGround(p.x, p.z, 50, 50, 10);
    expect(veg.prune(p.x - 70, p.z - 70, p.x + 70, p.z + 70)).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) veg.update(p.x + 30, p.z, 5 + i * 0.016, { x: 0, z: 0 });
    for (const name of ['plants:bush', 'plants:rock']) {
      const mesh: any = veg.group.children.find((m: any) => m.name === name);
      const arr = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) expect(world.clearAt(arr[i * 16 + 12] + veg.group.position.x, arr[i * 16 + 14] + veg.group.position.z)).toBe(false);
    }
    veg.dispose();
  });
});

describe('📱 inside the budget at every device tier', () => {
  it('phones get the fewest; every tier still fits the triangle budget the terrain and the sea leave', () => {
    const t = A.VEGETATION_TIERS;
    expect(t.phone.maxBushes).toBeLessThan(t.mid.maxBushes);
    expect(t.mid.maxBushes).toBeLessThan(t.desktop.maxBushes);
    expect(t.phone.maxRocks).toBeLessThan(t.mid.maxRocks);
    expect(t.phone.propRadius).toBeLessThan(t.mid.propRadius);
    for (const q of TIERS) expect(A.vegetationTriangles(t[q])).toBeLessThanOrEqual(A.vegetationBudget(q));
  });
  it('the drawn counts never pass the caps, cost two draw calls, and fade out before their radius', () => {
    for (const q of TIERS) {
      const world = A.createAthreeWorld({ seed: 5 });
      const p = wildPlace(world);
      const veg = A.createVegetation(THREE, world, q);
      for (let i = 0; i < (q === 'desktop' ? 700 : 400); i++) veg.update(p.x, p.z, i * 0.016, { x: 0, z: 0 });
      const s = veg.stats(), t = A.VEGETATION_TIERS[q];
      expect(s.bushes).toBeGreaterThan(0);
      expect(s.bushes).toBeLessThanOrEqual(t.maxBushes);
      expect(s.rocks).toBeLessThanOrEqual(t.maxRocks);
      expect(s.triangles).toBeLessThanOrEqual(A.vegetationTriangles(t));
      const props = veg.group.children.filter((m: any) => m.name === 'plants:bush' || m.name === 'plants:rock');
      expect(props.length).toBe(2);
      expect(props[0].material).toBe(props[1].material);
      expect(props[0].material.uniforms.uFade.value.y).toBeCloseTo(t.propRadius, 6);
      for (const mesh of props) {
        const arr = mesh.instanceMatrix.array;
        for (let i = 0; i < mesh.count; i++) {
          const x = arr[i * 16 + 12] + veg.group.position.x, z = arr[i * 16 + 14] + veg.group.position.z;
          expect(Math.hypot(x - p.x, z - p.z)).toBeLessThanOrEqual(t.propRadius + t.rebuildDistance + 1);
        }
      }
      veg.dispose();
    }
  });
});

describe('🎨 the ground is never one flat green', () => {
  /** Every vertex colour of the chunk under a place of this biome. */
  const chunkColours = (world: any, biome: string): number[][] => {
    const p = findBiome(world, biome)!;
    const geo = A.buildChunkGeometry(THREE, world, Math.floor(p.x / 256), Math.floor(p.z / 256), 256, 32);
    const col = geo.getAttribute('color').array;
    const out: number[][] = [];
    for (let i = 0; i < 33 * 33 * 3; i += 3) out.push([col[i], col[i + 1], col[i + 2]]);
    geo.dispose();
    return out;
  };
  // The one colour per land the ground had before (chunks.ts BIOME_COLOR).
  const PLAIN = [[0.76, 0.7, 0.52], [0.84, 0.78, 0.58], [0.8, 0.66, 0.4], [0.36, 0.5, 0.2], [0.17, 0.34, 0.14], [0.46, 0.43, 0.4], [0.93, 0.95, 0.97]];
  const isPlain = (c: number[]) => PLAIN.some((q) => q.every((v, k) => Math.abs(v - c[k]) < 1e-6));
  it('a grassland chunk has patches (lush, dry, bare earth): its greens spread widely; nature: false keeps the old single colour per land', () => {
    const varied = chunkColours(A.createAthreeWorld({ seed: 5 }), 'grassland');
    const greens = varied.map((c) => c[1]);
    expect(Math.max(...greens) - Math.min(...greens)).toBeGreaterThan(0.06);
    expect(varied.filter(isPlain).length).toBeLessThan(varied.length * 0.05);
    const plain = chunkColours(A.createAthreeWorld({ seed: 5, nature: false }), 'grassland');
    expect(plain.every(isPlain)).toBe(true);
  });
  it('two neighbouring chunks, at two levels of detail, agree on the colour along their shared edge', () => {
    const world = A.createAthreeWorld({ seed: 5 });
    const p = findBiome(world, 'grassland')!;
    const cx = Math.floor(p.x / 256), cz = Math.floor(p.z / 256);
    const a = A.buildChunkGeometry(THREE, world, cx, cz, 256, 32);
    const b = A.buildChunkGeometry(THREE, world, cx + 1, cz, 256, 16);
    const ca = a.getAttribute('color').array, cb = b.getAttribute('color').array;
    // a's +x edge is gx = 32 (index 32 * 33 + gz); b's -x edge is gx = 0 (index gz). b has half the resolution.
    for (let k = 0; k <= 16; k++) {
      const ia = (32 * 33 + k * 2) * 3, ib = k * 3;
      for (let c = 0; c < 3; c++) expect(ca[ia + c]).toBeCloseTo(cb[ib + c], 6);
    }
    a.dispose(); b.dispose();
  });
});

describe('🔌 nature: false is the plain look, and it is the only switch needed', () => {
  it('no bush or stone is scattered or drawn, and the vegetation has no mesh for them', () => {
    const world = A.createAthreeWorld({ seed: 5, nature: false });
    expect(world.nature).toBe(false);
    expect(A.createAthreeWorld({ seed: 5 }).nature).toBe(true);
    const p = findBiome(world, 'grassland')!;
    expect(A.propsInRect(world, p.x - 300, p.z - 300, p.x + 300, p.z + 300, 5)).toEqual([]);
    const veg = A.createVegetation(THREE, world, 'mid');
    expect(veg.group.children.some((m: any) => m.name === 'plants:bush' || m.name === 'plants:rock')).toBe(false);
    for (let i = 0; i < 100; i++) veg.update(p.x, p.z, i * 0.016, { x: 0, z: 0 });
    expect(veg.stats().bushes + veg.stats().rocks).toBe(0);
    veg.dispose();
  });
  it('createAthreeMap passes it through, and leaves the trees and grass of the land exactly as they were', () => {
    const map = A.createAthreeMap({ seed: 5, quality: 'phone', three: THREE, nature: false });
    expect(map.world.nature).toBe(false);
    const on = A.createAthreeWorld({ seed: 5 }), off = A.createAthreeWorld({ seed: 5, nature: false });
    const p = findBiome(on, 'forest')!;
    expect(A.treesInRect(off, p.x - 200, p.z - 200, p.x + 200, p.z + 200)).toEqual(A.treesInRect(on, p.x - 200, p.z - 200, p.x + 200, p.z + 200));
    map.dispose();
  });
  it('an open field: a few lone trees with nature on, none with it off', () => {
    const on = A.createAthreeWorld({ seed: 5 }), off = A.createAthreeWorld({ seed: 5, nature: false });
    const p = findBiome(on, 'grassland')!;
    for (const w of [on, off]) w.setLand(p.x, p.z, 900, 'grassland');
    const field = (w: any) => A.treesInRect(w, p.x - 600, p.z - 600, p.x + 600, p.z + 600).filter((t: any) => w.openFieldAt(t.x, t.z));
    const trees = field(on);
    expect(trees.length).toBeGreaterThan(0);
    expect(trees.length).toBeLessThan((1200 / 12.5) ** 2 * 0.06);              // lone trees and small groups, never a forest
    expect(field(off)).toEqual([]);
    const props = A.propsInRect(on, p.x - 300, p.z - 300, p.x + 300, p.z + 300, 5);
    expect(props.some((q: any) => q.kind === 'bush')).toBe(true);
    expect(props.some((q: any) => q.kind === 'rock')).toBe(true);
  });
});

describe('🌾 an open field (a maidan) draws all four: real grass tufts, trees, bushes and stones', () => {
  it('at every tier, standing in the field, the manager draws grass tufts, trees, bushes and stones together', () => {
    for (const q of TIERS) {
      const world = A.createAthreeWorld({ seed: 5 });
      const p = wildPlace(world);
      world.setLand(p.x + 120, p.z, 700, 'grassland');
      expect(world.openFieldAt(p.x + 120, p.z)).toBe(true);
      const veg = A.createVegetation(THREE, world, q);
      for (let i = 0; i < (q === 'desktop' ? 700 : 400); i++) veg.update(p.x + 120, p.z, i * 0.016, { x: 0, z: 0 });
      const s = veg.stats();
      expect(s.tufts, q).toBeGreaterThan(200);
      expect(s.trees, q).toBeGreaterThan(0);
      expect(s.bushes, q).toBeGreaterThan(0);
      expect(s.rocks, q).toBeGreaterThan(0);
      veg.dispose();
    }
  });
  it('the field itself (not only the land around it) holds lone trees, bushes and stones, scattered not in rows', () => {
    const world = A.createAthreeWorld({ seed: 5 });
    const p = wildPlace(world);
    world.setLand(p.x, p.z, 900, 'grassland');
    const inField = (list: any[]) => list.filter((t: any) => world.openFieldAt(t.x, t.z));
    const trees = inField(A.treesInRect(world, p.x - 700, p.z - 700, p.x + 700, p.z + 700));
    const props = inField(A.propsInRect(world, p.x - 300, p.z - 300, p.x + 300, p.z + 300, 5));
    expect(trees.length).toBeGreaterThan(3);
    expect(props.filter((q: any) => q.kind === 'bush').length).toBeGreaterThan(10);
    expect(props.filter((q: any) => q.kind === 'rock').length).toBeGreaterThan(3);
    // Jittered: positions inside their 5 m cells are spread, not on a grid line.
    const offsets = new Set(props.map((q: any) => Math.round(((q.x % 5) + 5) % 5)));
    expect(offsets.size).toBeGreaterThanOrEqual(4);
    const tufts = A.grassInRect(world, p.x - 16, p.z - 16, p.x + 16, p.z + 16, 1);
    expect(tufts.length / 6).toBeGreaterThan(300);                                // thick real grass in the field
  });
});

describe('🔒 an edited kit file is never replaced by the refresh that brings nature to an older game', () => {
  const pool = recipeFilePool();
  const kitNow = (p: string) => pool.get(p)!.content;
  const PLANTS = 'src/game/athree/plants.ts', VEGETATION = 'src/game/athree/vegetation.ts', CHUNKS = 'src/game/athree/chunks.ts', WORLD = 'src/game/athree/world.ts';
  const athreeNow = (): Record<string, string> => Object.fromEntries([...pool].filter(([p]) => p.startsWith('src/game/athree/')).map(([p, l]) => [p, l.content]));

  it('the files a game holds from before are recognised as untouched kit, and the new ones are recorded', () => {
    for (const p of [PLANTS, VEGETATION, CHUNKS, WORLD]) {
      expect(BEFORE[p]).not.toBe(kitNow(p));
      expect(isKnownKitVersion(p, BEFORE[p]), p).toBe(true);
      expect(isKnownKitVersion(p, kitNow(p)), p).toBe(true);
    }
  });
  it('an untouched older game gets all four files brought up to date', () => {
    const files = { ...athreeNow(), [PLANTS]: BEFORE[PLANTS], [VEGETATION]: BEFORE[VEGETATION], [CHUNKS]: BEFORE[CHUNKS], [WORLD]: BEFORE[WORLD] };
    const plan = planKitRefresh(files, pool);
    expect(plan.blocked).toBeNull();
    for (const p of [PLANTS, VEGETATION, CHUNKS, WORLD]) expect(plan.write[p], p).toBe(kitNow(p));
  });
  it('a user who edited plants.ts keeps every byte of it; the untouched files beside it still come up to date', () => {
    const mine = BEFORE[PLANTS] + '\n// my own bushes\n';
    const files = { ...athreeNow(), [PLANTS]: mine, [VEGETATION]: BEFORE[VEGETATION], [CHUNKS]: BEFORE[CHUNKS], [WORLD]: BEFORE[WORLD] };
    const plan = planKitRefresh(files, pool);
    expect(plan.write[PLANTS]).toBeUndefined();
    expect(files[PLANTS]).toBe(mine);
    // The old plants.ts imports only names the new vegetation.ts still exports, so nothing blocks the rest.
    expect(plan.blocked).toBeNull();
    for (const p of [VEGETATION, CHUNKS, WORLD]) expect(plan.write[p], p).toBe(kitNow(p));
  });
  it('a user who edited vegetation.ts keeps it, and plants.ts (which would need the new bush and stone names) is not forced on it', () => {
    const mine = BEFORE[VEGETATION].replace('export const GRASS_TILE = 32;', 'export const GRASS_TILE = 40; // mine');
    expect(mine).not.toBe(BEFORE[VEGETATION]);
    const files = { ...athreeNow(), [PLANTS]: BEFORE[PLANTS], [VEGETATION]: mine };
    const plan = planKitRefresh(files, pool);
    expect(plan.write[VEGETATION]).toBeUndefined();
    expect(plan.write[PLANTS]).toBeUndefined();
    expect(plan.blocked ?? '').toMatch(/vegetation\.ts, which was edited/);
  });
});
