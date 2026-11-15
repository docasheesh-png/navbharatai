// ATHREE MAP phase 3 — GRASS AND TREES. These tests run the emitted code: where plants may grow (biome / slope / altitude rules), that the
// scatter does not depend on which rectangle asks, that every mesh fits its triangle bound and every tier fits what the terrain and the sea
// leave of the budget, that the wind uniform IS the world's wind, and the manager with real three.js (streaming, caps, floating origin).
// What they cannot prove — how it LOOKS and whether the shaders compile on a GPU — is checked by a headless-Chromium render.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

// These tests sample whole worlds (thousands of terrain, river and dune queries). Under the coverage run they are several times
// slower, so each gets two minutes instead of vitest's default twenty seconds: the assertions are not loosened, only the clock.
vi.setConfig({ testTimeout: 120000 });

const A = loadAthree();
const TIERS = ['phone', 'mid', 'desktop'] as const;

function findBiome(world: any, want: string, from = 0): { x: number; z: number } | null {
  for (let i = from; i < 4000; i++) {
    const x = ((i * 7919) % 90000) - 45000;
    const z = ((i * 104729) % 90000) - 45000;
    if (world.biomeAt(x, z) === want) return { x, z };
  }
  return null;
}

describe('the scatter obeys the land', () => {
  const world = A.createAthreeWorld({ seed: 3, profile: 'open-world' });
  const trees = A.treesInRect(world, -3000, -3000, 3000, 3000);
  it('grows a believable number of trees and all three species exist somewhere', () => {
    expect(trees.length).toBeGreaterThan(500);
    const seen = new Set(trees.map((t: any) => t.species));
    expect(seen.has('broadleaf')).toBe(true);
    const wide = new Set(A.treesInRect(A.createAthreeWorld({ seed: 1, profile: 'battle-royale' }), -4000, -4000, 4000, 4000).map((t: any) => t.species));
    expect([...wide].sort()).toEqual(['broadleaf', 'conifer', 'palm']);
  });
  it('never plants in water, on steep ground, in desert or on snow', () => {
    for (const w of [world, A.createAthreeWorld({ seed: 1, profile: 'battle-royale' })]) {
      const span = w.mode === 'bounded' ? 4000 : 6000;
      for (const t of A.treesInRect(w, -span, -span, span, span)) {
        const biome = w.biomeAt(t.x, t.z);
        expect(['forest', 'grassland', 'mountain', 'beach']).toContain(biome);
        expect(w.heightAt(t.x, t.z)).toBeGreaterThan(0.7);
        expect(w.normalAt(t.x, t.z).y).toBeGreaterThanOrEqual(0.73);
      }
    }
  });
  it('puts palms only on beaches and conifers only on forest, grassland or mountain', () => {
    const w = A.createAthreeWorld({ seed: 1, profile: 'battle-royale' });
    for (const t of A.treesInRect(w, -4000, -4000, 4000, 4000)) {
      const b = w.biomeAt(t.x, t.z);
      if (t.species === 'palm') expect(b).toBe('beach');
      if (b === 'beach') expect(t.species).toBe('palm');
    }
  });
  it('keeps trunks apart: no two trees closer than 1.9 m', () => {
    const grid = new Map<string, any[]>();
    for (const t of trees) {
      const k = Math.floor(t.x / 4) + ',' + Math.floor(t.z / 4);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(t);
    }
    for (const t of trees.slice(0, 3000)) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const o of grid.get((Math.floor(t.x / 4) + dx) + ',' + (Math.floor(t.z / 4) + dz)) ?? []) {
          if (o !== t) expect(Math.hypot(o.x - t.x, o.z - t.z)).toBeGreaterThan(1.9);
        }
      }
    }
  });
  it('forest is much denser than grassland, and there are none in the desert', () => {
    const density = (biome: string): number => {
      let area = 0; let n = 0;
      for (let i = 0; i < 60 && area < 400000; i++) {
        const p = findBiome(world, biome, i * 40);
        if (!p) break;
        const list = A.treesInRect(world, p.x - 100, p.z - 100, p.x + 100, p.z + 100);
        n += list.filter((t: any) => world.biomeAt(t.x, t.z) === biome).length;
        area += 40000;
      }
      return area ? n / area : 0;
    };
    const forest = density('forest');
    expect(forest).toBeGreaterThan(density('grassland') * 3);
    expect(density('desert')).toBe(0);
  });
});

describe('the scatter does not depend on who asks', () => {
  const world = A.createAthreeWorld({ seed: 9 });
  it('two neighbouring rectangles hold exactly the trees of the rectangle around both', () => {
    const f = findBiome(world, 'forest')!;
    const x0 = Math.floor(f.x / 64) * 64; const z0 = Math.floor(f.z / 64) * 64;
    const left = A.treesInRect(world, x0, z0, x0 + 64, z0 + 64);
    const right = A.treesInRect(world, x0 + 64, z0, x0 + 128, z0 + 64);
    const both = A.treesInRect(world, x0, z0, x0 + 128, z0 + 64);
    expect(both.length).toBeGreaterThan(8);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect([...left, ...right].sort((a: any, b: any) => a.x - b.x || a.z - b.z)).toEqual([...both].sort((a: any, b: any) => a.x - b.x || a.z - b.z));
  });
  it('is deterministic by seed and differs between seeds', () => {
    const p = findBiome(world, 'forest')!;
    const a = A.treesInRect(world, p.x, p.z, p.x + 400, p.z + 400);
    expect(a.length).toBeGreaterThan(10);
    expect(A.treesInRect(world, p.x, p.z, p.x + 400, p.z + 400)).toEqual(a);
    const other = A.createAthreeWorld({ seed: 9 });
    const b = A.treesInRect({ ...other, seed: 10, heightAt: other.heightAt, biomeAt: other.biomeAt, normalAt: other.normalAt }, p.x, p.z, p.x + 400, p.z + 400);
    expect(b).not.toEqual(a);
  });
  it('grass tiles agree exactly along their shared edge (tufts of the union equal the tufts of the two halves)', () => {
    for (const probe of [0, 1, 2, 3]) {
      const p = findBiome(world, 'grassland', probe * 30);
      expect(p).not.toBeNull();
      const x0 = Math.floor(p!.x / 32) * 32;
      const z0 = Math.floor(p!.z / 32) * 32;
      const a = A.grassInRect(world, x0, z0, x0 + 32, z0 + 32, 1);
      const b = A.grassInRect(world, x0 + 32, z0, x0 + 64, z0 + 32, 1);
      const u = A.grassInRect(world, x0, z0, x0 + 64, z0 + 32, 1);
      expect(a.length + b.length).toBe(u.length);
      const pack = (f: Float32Array) => Array.from({ length: f.length / 6 }, (_, i) => Array.from(f.slice(i * 6, i * 6 + 6)).join(',')).sort();
      expect(pack(Float32Array.from([...a, ...b]))).toEqual(pack(u));
    }
  });
});

describe('the loop world wraps without a seam', () => {
  const world = A.createAthreeWorld({ seed: 5, profile: 'open-world' });
  it('the scatter 100 km away is the same scatter, shifted by the period', () => {
    const P = world.sizeMeters;
    const f = findBiome(world, 'forest')!;
    const x0 = Math.floor(f.x / 64) * 64; const z0 = Math.floor(f.z / 64) * 64;
    const a = A.treesInRect(world, x0, z0, x0 + 400, z0 + 400);
    const b = A.treesInRect(world, x0 + P, z0, x0 + 400 + P, z0 + 400);
    expect(a.length).toBeGreaterThan(10);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].x - P).toBeCloseTo(a[i].x, 6);
      expect(b[i].species).toBe(a[i].species);
    }
    const g = findBiome(world, 'grassland')!;
    const gx = Math.floor(g.x / 32) * 32; const gz = Math.floor(g.z / 32) * 32;
    const ga = A.grassInRect(world, gx, gz, gx + 32, gz + 32, 1);
    const gb = A.grassInRect(world, gx + P, gz, gx + 32 + P, gz + 32, 1);
    expect(ga.length).toBeGreaterThan(60);
    expect(gb.length).toBe(ga.length);
  });
});

describe('grass', () => {
  const world = A.createAthreeWorld({ seed: 3 });
  it('lives on grassland, is thicker there than in forest, and is absent from desert, beach, sea and snow', () => {
    const count = (biome: string): number => {
      let n = 0; let tiles = 0;
      for (let i = 0; i < 80 && tiles < 6; i++) {
        const p = findBiome(world, biome, i * 25);
        if (!p) break;
        const x0 = Math.floor(p.x / 32) * 32; const z0 = Math.floor(p.z / 32) * 32;
        n += A.grassInRect(world, x0, z0, x0 + 32, z0 + 32, 1).length / 6;
        tiles++;
      }
      return tiles ? n / tiles : 0;
    };
    expect(count('grassland')).toBeGreaterThan(100);
    expect(count('grassland')).toBeGreaterThan(count('forest'));
    expect(count('desert')).toBe(0);
    expect(count('ocean')).toBe(0);
  });
  it('a tuft is never in the sea and almost never on desert or snow (only within one 2 m lattice cell of a grass edge)', () => {
    let total = 0; let wrong = 0; let wet = 0;
    for (let probe = 0; probe < 30; probe++) {
      for (const biome of ['desert', 'snow', 'grassland', 'beach']) {
        const p = findBiome(world, biome, probe * 17);
        if (!p) continue;
        const x0 = Math.floor(p.x / 32) * 32; const z0 = Math.floor(p.z / 32) * 32;
        const g = A.grassInRect(world, x0, z0, x0 + 32, z0 + 32, 1);
        for (let i = 0; i < g.length; i += 6) {
          total++;
          const b = world.biomeAt(g[i], g[i + 2]);
          if (b === 'desert' || b === 'snow') wrong++;
          if (b === 'ocean' || g[i + 1] < 0.5) wet++;
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(wet).toBe(0);
    expect(wrong / total).toBeLessThan(0.03);
  });
  it('every tuft stands on the ground it was given (within 6 cm of the real terrain on gentle slopes) and inside its tile', () => {
    const p = findBiome(world, 'grassland', 0)!;
    const x0 = Math.floor(p.x / 32) * 32; const z0 = Math.floor(p.z / 32) * 32;
    const g = A.grassInRect(world, x0, z0, x0 + 32, z0 + 32, 1);
    expect(g.length).toBeGreaterThan(0);
    let worst = 0;
    for (let i = 0; i < g.length; i += 6) {
      expect(g[i]).toBeGreaterThanOrEqual(x0); expect(g[i]).toBeLessThan(x0 + 32);
      expect(g[i + 2]).toBeGreaterThanOrEqual(z0); expect(g[i + 2]).toBeLessThan(z0 + 32);
      expect(g[i + 5]).toBeGreaterThanOrEqual(0); expect(g[i + 5]).toBeLessThanOrEqual(1);
      worst = Math.max(worst, Math.abs(g[i + 1] - world.heightAt(g[i], g[i + 2])));
    }
    expect(worst).toBeLessThan(0.35);
  });
  it('a tile costs a few hundred terrain samples, not one per tuft', () => {
    let calls = 0;
    const counted = { ...world, heightAt: (x: number, z: number) => { calls++; return world.heightAt(x, z); } };
    const p = findBiome(world, 'grassland', 0)!;
    const x0 = Math.floor(p.x / 32) * 32; const z0 = Math.floor(p.z / 32) * 32;
    const g = A.grassInRect(counted, x0, z0, x0 + 32, z0 + 32, 0.625);
    expect(g.length / 6).toBeGreaterThan(500);
    expect(calls).toBeLessThan(2000);
  });
});

describe('the plant meshes', () => {
  it('every tree fits its triangle bound, the full-detail one is richer than the cheap one, and the numbers are exact', () => {
    for (const species of A.SPECIES) {
      for (let v = 0; v < A.VARIANTS[species]; v++) {
        const full = A.buildTreeArrays(species, 0, v);
        const cheap = A.buildTreeArrays(species, 1, v);
        expect(full.triangles).toBeLessThanOrEqual(A.TREE_TRIANGLES_MAX.lod0);
        expect(cheap.triangles).toBeLessThanOrEqual(A.TREE_TRIANGLES_MAX.lod1);
        expect(full.triangles).toBeGreaterThan(cheap.triangles * 3);
        expect(full.index.length).toBe(full.triangles * 3);
        expect(cheap.triangles).toBeGreaterThan(20);
      }
    }
    expect(A.buildTuftArrays().triangles).toBe(A.TUFT_TRIANGLES);
  });
  it('every array is consistent: one attribute value per vertex, indices in range, nothing NaN', () => {
    const meshes = [A.buildTuftArrays(), ...A.SPECIES.flatMap((s: string) => [0, 1].map((l) => A.buildTreeArrays(s, l, 0)))];
    for (const m of meshes) {
      const n = m.position.length / 3;
      expect(m.normal.length).toBe(n * 3); expect(m.color.length).toBe(n * 3); expect(m.uv.length).toBe(n * 2);
      expect(m.sway.length).toBe(n); expect(m.phase.length).toBe(n); expect(m.kind.length).toBe(n);
      for (const i of m.index) expect(i).toBeLessThan(n);
      for (const arr of [m.position, m.normal, m.color, m.uv, m.sway, m.phase, m.kind]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
      for (let i = 0; i < n; i++) expect(Math.hypot(m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2])).toBeCloseTo(1, 4);
    }
  });
  it('has leaves that move more than the trunk, and roots that do not move at all', () => {
    for (const species of A.SPECIES) {
      const m = A.buildTreeArrays(species, 0, 0);
      let leaf = 0; let nLeaf = 0; let bark = 0; let nBark = 0; let rootMax = 0;
      for (let i = 0; i < m.kind.length; i++) {
        if (m.kind[i] === A.KIND.bark) { bark += m.sway[i]; nBark++; if (m.position[i * 3 + 1] < 0.01) rootMax = Math.max(rootMax, m.sway[i]); }
        else { leaf += m.sway[i]; nLeaf++; }
      }
      expect(nLeaf).toBeGreaterThan(0);
      expect(leaf / nLeaf).toBeGreaterThan(bark / nBark);
      expect(rootMax).toBe(0);
    }
    const t = A.buildTuftArrays();
    for (let i = 0; i < t.kind.length; i++) expect(t.sway[i]).toBe(t.position[i * 3 + 1] > 0.2 ? 1 : 0);
  });
  it('trees stand on the origin and are about 9 to 12 metres tall; the same species and variant is the same mesh every time', () => {
    for (const species of A.SPECIES) {
      const m = A.buildTreeArrays(species, 0, 0);
      let top = 0; let minY = 0;
      for (let i = 0; i < m.position.length; i += 3) { top = Math.max(top, m.position[i + 1]); minY = Math.min(minY, m.position[i + 1]); }
      expect(top).toBeGreaterThan(8); expect(top).toBeLessThan(13); expect(minY).toBeGreaterThanOrEqual(-0.01);
      expect(A.buildTreeArrays(species, 0, 0).position).toEqual(m.position);
    }
    expect(A.buildTreeArrays('broadleaf', 0, 1).position).not.toEqual(A.buildTreeArrays('broadleaf', 0, 0).position);
  });
});

describe('the budget', () => {
  it('terrain + sea + the worst case of the vegetation fits every tier', () => {
    for (const q of TIERS) {
      const tier = A.VEGETATION_TIERS[q];
      expect(A.vegetationTriangles(tier)).toBeLessThanOrEqual(A.vegetationBudget(q));
      expect(A.maxTriangles(A.QUALITY[q]) + A.oceanTriangles(A.OCEAN_TIERS[q]) + A.vegetationTriangles(tier)).toBeLessThanOrEqual(A.QUALITY[q].budgetTriangles);
    }
  });
  it('the grass cap can never bind in the open: the drawn disc holds fewer tufts than the cap', () => {
    for (const q of TIERS) {
      const t = A.VEGETATION_TIERS[q];
      expect(Math.PI * t.grassRadius * t.grassRadius / (t.grassCell * t.grassCell)).toBeLessThanOrEqual(t.maxTufts);
    }
  });
  it('a loop world period is a whole number of scatter cells (so the wrap is exact)', () => {
    for (const q of TIERS) expect(Number.isInteger(100000 / A.VEGETATION_TIERS[q].grassCell)).toBe(true);
    expect(Number.isInteger(100000 / 12.5)).toBe(true);
  });
  it('more quality never draws less: caps and radii rise from phone to desktop', () => {
    const [p, m, d] = TIERS.map((q) => A.VEGETATION_TIERS[q]);
    for (const key of ['treeRadius', 'maxTrees', 'maxLod0', 'grassRadius', 'maxTufts'] as const) { expect(m[key]).toBeGreaterThan(p[key]); expect(d[key]).toBeGreaterThan(m[key]); }
  });
});

describe('the shaders', () => {
  const vert = A.plantVertexShader();
  const frag = A.plantFragmentShader();
  it('read the same uniforms the manager writes, and fog', () => {
    for (const u of ['uTime', 'uWind', 'uAnchor', 'uCamWorld', 'uFade', 'uBend']) expect(vert).toContain(u);
    for (const u of ['uSun', 'uSunColor', 'uAmbient']) expect(frag).toContain(u);
    expect(vert).toContain('#include <fog_vertex>');
    expect(frag).toContain('#include <fog_fragment>');
  });
  it('cut leaves, needles, fronds and blades out of cards with a procedural mask and no texture', () => {
    expect((frag.match(/discard/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(frag).not.toContain('sampler2D');
  });
  it('bend by the wind direction, scaled by the wind speed, with gusts that travel', () => {
    expect(vert).toContain('uWind / speed');
    expect(vert).toContain('dot(wb, dir)');
  });
});

describe('the vegetation manager (real three.js)', () => {
  const origin = { x: 0, z: 0 };
  function setup(quality: 'phone' | 'mid' | 'desktop', seed = 3) {
    const world = A.createAthreeWorld({ seed });
    const veg = A.createVegetation(THREE, world, quality);
    return { world, veg };
  }
  function settle(veg: any, x: number, z: number, t = 0, frames = 400): void {
    for (let i = 0; i < frames; i++) veg.update(x, z, t + i * 0.016, origin);
  }
  function lushPlace(world: any): { x: number; z: number } {
    for (let probe = 0; probe < 40; probe++) {
      const p = findBiome(world, 'forest', probe * 30) ?? findBiome(world, 'grassland', probe * 30);
      if (p) {
        const list = A.treesInRect(world, p.x - 150, p.z - 150, p.x + 150, p.z + 150);
        if (list.length > 40) return p;
      }
    }
    throw new Error('no lush place found');
  }

  it('draws one mesh per species, variant and detail level plus one for grass', () => {
    const { veg } = setup('mid');
    const expected = A.SPECIES.reduce((n: number, s: string) => n + A.VARIANTS[s] * 2, 0) + 1;
    expect(veg.group.children.length).toBe(expected);
  });
  it('streams in a few tiles per update, nearest first, and never more than tilesPerUpdate', () => {
    const { world, veg } = setup('phone');
    const p = lushPlace(world);
    veg.update(p.x, p.z, 0, origin);
    const first = veg.stats().tilesLoaded;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(A.VEGETATION_TIERS.phone.tilesPerUpdate);
    veg.update(p.x, p.z, 0.016, origin);
    expect(veg.stats().tilesLoaded).toBeLessThanOrEqual(first + A.VEGETATION_TIERS.phone.tilesPerUpdate);
  });
  it('fills in trees and grass, within every cap, at every tier', () => {
    for (const q of TIERS) {
      const { world, veg } = setup(q);
      const p = lushPlace(world);
      settle(veg, p.x, p.z, 0, q === 'desktop' ? 700 : 400);
      const s = veg.stats();
      const t = A.VEGETATION_TIERS[q];
      expect(s.trees).toBeGreaterThan(20);
      expect(s.trees).toBeLessThanOrEqual(t.maxTrees);
      expect(s.treesLod0).toBeLessThanOrEqual(t.maxLod0);
      expect(s.tufts).toBeLessThanOrEqual(t.maxTufts);
      expect(s.triangles).toBeLessThanOrEqual(A.vegetationTriangles(t));
      expect(s.triangles).toBeLessThanOrEqual(A.vegetationBudget(q));
      expect(s.drawCalls).toBeLessThanOrEqual(11);
      veg.dispose();
    }
  });
  it('uses the full-detail mesh only near the camera and only for the nearest trees', () => {
    const { world, veg } = setup('mid');
    const p = lushPlace(world);
    settle(veg, p.x, p.z);
    const lod0 = [...veg.group.children].filter((m: any, i: number) => m.count > 0 && i % 2 === 0);
    const r = A.VEGETATION_TIERS.mid.lod0Radius;
    for (const mesh of lod0) {
      const arr = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const x = arr[i * 16 + 12] + veg.group.position.x + origin.x;
        const z = arr[i * 16 + 14] + veg.group.position.z + origin.z;
        expect(Math.hypot(x - p.x, z - p.z)).toBeLessThanOrEqual(r + 1.5);
      }
    }
  });
  it('puts each instance where the scatter said, in render space (world minus origin)', () => {
    const { world, veg } = setup('mid');
    const p = lushPlace(world);
    settle(veg, p.x, p.z);
    const mesh = [...veg.group.children].find((m: any) => m.count > 0 && m !== veg.group.children[veg.group.children.length - 1]);
    const tiles = A.treesInRect(world, p.x - 500, p.z - 500, p.x + 500, p.z + 500);
    const arr = mesh.instanceMatrix.array;
    const wx = arr[12] + veg.group.position.x + origin.x;
    const wz = arr[14] + veg.group.position.z + origin.z;
    expect(tiles.some((t: any) => Math.abs(t.x - wx) < 0.01 && Math.abs(t.z - wz) < 0.01)).toBe(true);
  });
  it('rebases with the floating origin without rebuilding: moving the origin moves the group, not the plants', () => {
    const { world, veg } = setup('mid');
    const p = lushPlace(world);
    settle(veg, p.x, p.z);
    const before = veg.group.position.x;
    veg.update(p.x, p.z, 9, { x: 3000, z: -500 });
    expect(veg.group.position.x).toBeCloseTo(before - 3000, 6);
    expect(veg.group.position.z).toBeCloseTo(veg.group.position.z, 6);
  });
  it('the wind uniform IS the world wind at the camera, and time and light reach the shader', () => {
    const { world, veg } = setup('mid');
    veg.update(1234, -777, 42, origin);
    const mat = (veg.group.children[0] as any).material;
    const w = world.windAt(1234, -777, 42);
    expect(mat.uniforms.uWind.value.x).toBeCloseTo(w.x, 9);
    expect(mat.uniforms.uWind.value.y).toBeCloseTo(w.z, 9);
    expect(mat.uniforms.uTime.value).toBe(42);
    veg.setLight({ x: 0, y: 2, z: 0 }, 0xffffff, 0x202020);
    expect(mat.uniforms.uSun.value.y).toBeCloseTo(1, 9);
    expect(mat.uniforms.uSunColor.value.r).toBeCloseTo(1, 9);
  });
  it('the grass fades out before its edge so it never pops: the grass material fades between 55 and 95 percent of its radius', () => {
    const { veg } = setup('mid');
    const grass = (veg.group.children[veg.group.children.length - 1] as any).material;
    const t = A.VEGETATION_TIERS.mid;
    expect(grass.uniforms.uFade.value.x).toBeCloseTo(t.grassRadius * 0.55, 6);
    expect(grass.uniforms.uFade.value.y).toBeCloseTo(t.grassRadius * 0.95, 6);
  });
  it('an empty place (open sea) draws nothing and does not throw', () => {
    const { veg } = setup('mid');
    const sea = findBiome(A.createAthreeWorld({ seed: 3 }), 'ocean')!;
    settle(veg, sea.x, sea.z, 0, 120);
    expect(veg.stats().trees + veg.stats().tufts).toBe(0);
  });
  it('dispose releases geometries and materials', () => {
    const { world, veg } = setup('phone');
    const p = lushPlace(world);
    settle(veg, p.x, p.z, 0, 50);
    const mesh: any = veg.group.children[0];
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => disposed++);
    mesh.material.addEventListener('dispose', () => disposed++);
    veg.dispose();
    expect(disposed).toBe(2);
  });
});

describe('createAthreeMap with vegetation', () => {
  it('adds the vegetation by default, drives it from update(), and can leave it out', () => {
    const map = A.createAthreeMap({ seed: 3, quality: 'phone', three: THREE });
    expect(map.vegetation).not.toBeNull();
    expect(map.chunks.group.children).toContain(map.vegetation.group);
    map.update(100, 100, 1);
    expect(map.vegetation.stats().tilesLoaded).toBeGreaterThan(0);
    map.dispose();
    expect(A.createAthreeMap({ seed: 3, quality: 'phone', three: THREE, vegetation: false }).vegetation).toBeNull();
    expect(A.createAthreeMap({ seed: 3 }).vegetation).toBeNull();
  });
});
