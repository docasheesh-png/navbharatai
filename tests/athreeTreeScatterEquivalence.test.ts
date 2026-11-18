/** Exact-output oracle frozen before the river-query optimization. Existing vegetation tests stay unchanged. */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { generateAthreeMap } from '../src/server/lib/athreeMap/AthreeMapGenerator';

// Baseline treesInRect from main 576f140 plus upstream ec304f4 road exclusion; not reconstructed from optimized code.
const ORIGINAL_TREES = "export function treesInRect(world: AthreeWorld, x0: number, z0: number, x1: number, z1: number, cell: number = TREE_CELL): TreeSpec[] {\n  const out: TreeSpec[] = [];\n  const period = periodOf(world);\n  const seed = world.seed;\n  for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {\n    for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) {\n      const rng = mulberry32(mix32(wrapIndex(world, cell, ix), wrapIndex(world, cell, iz), seed, 101));\n      const px = (ix + 0.15 + 0.7 * rng()) * cell;\n      const pz = (iz + 0.15 + 0.7 * rng()) * cell;\n      const roll = rng();\n      const rot = rng() * Math.PI * 2;\n      const sizeR = rng();\n      const tint = rng();\n      const pick = rng();\n      if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;\n      const h = world.heightAt(px, pz);\n      if (h < 0.8) continue;\n      if (world.waterAt(px, pz) || world.roadAt(px, pz)) continue;\n      const biome = world.biomeAt(px, pz);\n      const grove = fieldNoise(px, pz, seed + 11, 3, 140, period);\n      const conif = fieldNoise(px, pz, seed + 12, 2, 420, period);\n      let p = 0;\n      let species: Species = 'broadleaf';\n      let minUp = 0.8;\n      if (biome === 'forest') {\n        p = 0.85 * smoothstep(0.3, 0.45, grove);\n        species = conif > 0.52 ? 'conifer' : 'broadleaf';\n      } else if (biome === 'grassland') {\n        p = 0.04 + 0.5 * smoothstep(0.6, 0.78, grove);\n        species = conif > 0.62 ? 'conifer' : 'broadleaf';\n      } else if (biome === 'mountain') {\n        p = 0.4 * smoothstep(0.35, 0.5, grove) * Math.min(1, Math.max(0, 1.2 - (h - 150) / 450));\n        species = 'conifer';\n        minUp = 0.74;\n      } else if (biome === 'beach' && h >= 1) {\n        p = 0.12 * smoothstep(0.3, 0.5, grove);\n        species = 'palm';\n        minUp = 0.92;\n      }\n      if (roll >= p) continue;\n      if (world.normalAt(px, pz).y < minUp) continue;\n      const scale = species === 'palm' ? 0.85 + 0.3 * sizeR : 0.8 + 0.58 * sizeR;\n      out.push({ x: px, y: h - 0.15, z: pz, rot, scale, species, variant: Math.floor(pick * VARIANTS[species]), tint });\n    }\n  }\n  return out;\n}\n\n";

function load(reference: boolean): Record<string, any> {
  const files = generateAthreeMap().files;
  if (reference) {
    const path = 'src/game/athree/vegetation.ts';
    const source = files[path];
    const start = source.indexOf('export function treesInRect');
    const end = source.indexOf('/** Grass quality', start);
    if (start < 0 || end < start) throw new Error('Missing emitted tree function');
    files[path] = source.slice(0, start) + ORIGINAL_TREES + source.slice(end);
  }
  const cache = new Map<string, any>();
  function module(name: string): any {
    if (cache.has(name)) return cache.get(name);
    const source = files['src/game/athree/' + name + '.ts'];
    if (!source) throw new Error('Missing emitted module ' + name);
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const out = {}; cache.set(name, out);
    new Function('exports', 'require', js)(out, (id: string) => {
      if (!id.startsWith('./')) throw new Error('Unexpected import ' + id);
      return module(id.slice(2));
    });
    return out;
  }
  return module('index');
}
const current = load(false);
const original = load(true);

describe('tree-query optimization preserves complete admitted trees', () => {
  it.each([['open-world', 1], ['open-world', 3], ['battle-royale', 1], ['battle-royale', 8]])('matches original real terrain %s seed %i', (profile, seed) => {
    const world = current.createAthreeWorld({ profile, seed });
    // Includes negative coordinates, non-cell-aligned chunk edges and a disjoint interior patch.
    for (const rect of [[-450, -450, 450, 450], [1500.1, 1200.3, 2100.2, 1800.7]]) {
      const expected = original.treesInRect(world, ...rect);
      expect(current.treesInRect(world, ...rect)).toEqual(expected);
    }
  });
  it('matches every species/biome, water and slope boundary with complete tree attributes', () => {
    let total = 0;
    for (const biome of ['forest', 'grassland', 'mountain', 'beach', 'desert', 'snow', 'sea']) {
      for (const up of [0.73, 0.74, 0.8, 0.92, 1]) {
        const world = { seed: 11, mode: 'loop', sizeMeters: 100000,
          heightAt: (x: number) => x < -20 ? 0.79 : biome === 'mountain' ? 220 : 1,
          roadAt: (x: number, z: number) => x < -60 && z > 0 ? { kind: 'road' } : null, biomeAt: () => biome, normalAt: () => ({ x: 0, y: up, z: 0 }),
          waterAt: (x: number, z: number) => x >= -5 && x <= 40 && z < 10 ? { kind: 'river', surface: 2 } : null };
        const expected = original.treesInRect(world, -180, -180, 180, 180);
        expect(current.treesInRect(world, -180, -180, 180, 180)).toEqual(expected);
        total += expected.length;
      }
    }
    expect(total).toBeGreaterThan(100);
  });
  it('reduces expensive height/water queries without changing one tree or bypassing water exclusion', () => {
    const calls = { height: 0, water: 0 };
    const world = { seed: 3, mode: 'bounded', sizeMeters: 8000,
      roadAt: (x: number) => x < -300 ? { kind: 'road' } : null, heightAt: () => { calls.height++; return 4; }, biomeAt: () => 'grassland', normalAt: () => ({ x: 0, y: 1, z: 0 }),
      waterAt: (x: number) => { calls.water++; return x > 0 ? { kind: 'lake', surface: 5 } : null; } };
    const expected = original.treesInRect(world, -600, -600, 600, 600);
    const before = { ...calls }; calls.height = 0; calls.water = 0;
    const actual = current.treesInRect(world, -600, -600, 600, 600);
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(0);
    expect(actual.every((t: any) => t.x <= 0)).toBe(true);
    expect(calls.height).toBeLessThan(before.height * 0.9);
    expect(calls.water).toBeLessThan(before.water * 0.6);
  });
});
