// ATHREE MAP — phase 3: GRASS AND TREES (the emitted source of src/game/athree/vegetation.ts and plants.ts).
//
// 100% ours. Techniques (public ideas, own code): a jittered grid with a per-cell hash gives a scatter that does not depend on which
// rectangle asks (so two chunks, or a chunk and its neighbour, agree on every plant); biome / slope / altitude rules decide where each
// species may stand; trees are built from tubes (trunk and branches) plus leaf CARDS whose shape is cut out by a procedural mask in the
// fragment shader (no texture is shipped); wind is a vertex-shader bend plus a per-leaf flutter, driven by the SAME wind field the sea
// reads (world.windAt), so one gust bends the grass, shakes the leaves and raises the waves together.
//
// vegetation.ts is PURE (no three.js): scatter + the plant meshes as plain arrays, so every rule is unit-testable.
// plants.ts needs three.js: shaders, instancing, tiles that stream in a few per frame, levels of detail, floating origin.
//
// PURE source strings; the generator writes them. Rule for editing: no backticks and no dollar-brace inside the strings below.

export const VEGETATION = `// Athree map — where plants grow, and what a plant is made of (pure: no three.js).
// Technique: jittered-grid scatter with a per-cell hash (rectangle-independent), biome/slope/altitude rules, tube + leaf-card plant meshes.
// Own implementation.

import { fieldNoise, mulberry32 } from './noise';
import { QUALITY, OCEAN_TIERS, maxTriangles, oceanTriangles, type AthreeQuality } from './config';
import type { AthreeWorld } from './world';

export type Species = 'broadleaf' | 'conifer' | 'palm';
export const SPECIES: readonly Species[] = ['broadleaf', 'conifer', 'palm'];
/** Meshes per species: the same species is built twice with different random branching, so a forest is not one tree copied. */
export const VARIANTS: Record<Species, number> = { broadleaf: 2, conifer: 2, palm: 1 };

/** A tuft is three crossed cards: six triangles. */
export const TUFT_TRIANGLES = 6;
/** The most triangles one tree may have, per level of detail (asserted by a test against the real meshes). */
export const TREE_TRIANGLES_MAX = { lod0: 900, lod1: 40 };

export const TREE_TILE = 64;
export const GRASS_TILE = 32;
const TREE_CELL = 12.5;
const LATTICE = 2;

export interface VegetationTier {
  /** Trees are drawn out to this distance (metres); the nearest maxTrees win when there are more. */
  treeRadius: number;
  lod0Radius: number;
  maxTrees: number;
  /** Of maxTrees, at most this many use the full-detail mesh. */
  maxLod0: number;
  /** Grass: jittered-grid spacing in metres, the radius it is drawn to, and the cap. */
  grassCell: number;
  grassRadius: number;
  maxTufts: number;
  /** Scatter tiles built per update() call, so streaming never freezes a frame. */
  tilesPerUpdate: number;
  /** The instance buffers are rebuilt when the camera moved this far (metres). */
  rebuildDistance: number;
}

export const VEGETATION_TIERS: Record<AthreeQuality, VegetationTier> = {
  phone: { treeRadius: 300, lod0Radius: 45, maxTrees: 450, maxLod0: 8, grassCell: 1.25, grassRadius: 30, maxTufts: 3000, tilesPerUpdate: 3, rebuildDistance: 15 },
  mid: { treeRadius: 500, lod0Radius: 70, maxTrees: 1000, maxLod0: 24, grassCell: 1, grassRadius: 45, maxTufts: 8000, tilesPerUpdate: 5, rebuildDistance: 20 },
  desktop: { treeRadius: 800, lod0Radius: 110, maxTrees: 3600, maxLod0: 80, grassCell: 0.625, grassRadius: 70, maxTufts: 40000, tilesPerUpdate: 8, rebuildDistance: 25 },
};

/** The most triangles the vegetation can draw at a tier: every tuft, every full-detail tree, every other tree at the cheap level. */
export function vegetationTriangles(tier: VegetationTier): number {
  return tier.maxTufts * TUFT_TRIANGLES + tier.maxLod0 * TREE_TRIANGLES_MAX.lod0 + (tier.maxTrees - tier.maxLod0) * TREE_TRIANGLES_MAX.lod1;
}

/** What is left of the tier's triangle budget once the terrain and the sea have taken their worst case. */
export function vegetationBudget(quality: AthreeQuality): number {
  return QUALITY[quality].budgetTriangles - maxTriangles(QUALITY[quality]) - oceanTriangles(OCEAN_TIERS[quality]);
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix32(ix: number, iz: number, seed: number, salt: number): number {
  return (Math.imul(ix | 0, 73856093) ^ Math.imul(iz | 0, 19349663) ^ Math.imul(seed | 0, 83492791) ^ Math.imul(salt | 0, 668265263)) | 0;
}

/** A loop world repeats every sizeMeters, so the scatter must too: cell indices wrap when the period is a whole number of cells. */
function wrapIndex(world: AthreeWorld, cell: number, i: number): number {
  if (world.mode !== 'loop') return i;
  const n = world.sizeMeters / cell;
  if (Math.abs(n - Math.round(n)) > 1e-9) return i;
  return ((i % n) + n) % n;
}

function periodOf(world: AthreeWorld): number {
  return world.mode === 'loop' ? world.sizeMeters : 0;
}

export interface TreeSpec {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  species: Species;
  variant: number;
  /** 0..1 colour variation. */
  tint: number;
}

/**
 * Every tree whose trunk stands inside [x0, x1) x [z0, z1). One candidate per 12.5 m cell, jittered inside the cell's middle 70 percent
 * so two trunks never touch. The candidate's random numbers come from its CELL, never from the rectangle, so any two rectangles agree.
 * Rules: forest is dense with clearings and patches of conifer; grassland keeps scattered copses; mountains hold conifers that thin
 * out with altitude; beaches hold palms; desert, sea, snow and steep ground hold none (the desert phase adds its own plants).
 */
export function treesInRect(world: AthreeWorld, x0: number, z0: number, x1: number, z1: number, cell: number = TREE_CELL): TreeSpec[] {
  const out: TreeSpec[] = [];
  const period = periodOf(world);
  const seed = world.seed;
  for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {
    for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) {
      const rng = mulberry32(mix32(wrapIndex(world, cell, ix), wrapIndex(world, cell, iz), seed, 101));
      const px = (ix + 0.15 + 0.7 * rng()) * cell;
      const pz = (iz + 0.15 + 0.7 * rng()) * cell;
      const roll = rng();
      const rot = rng() * Math.PI * 2;
      const sizeR = rng();
      const tint = rng();
      const pick = rng();
      if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
      const h = world.heightAt(px, pz);
      if (h < 0.8) continue;
      const biome = world.biomeAt(px, pz);
      const grove = fieldNoise(px, pz, seed + 11, 3, 140, period);
      const conif = fieldNoise(px, pz, seed + 12, 2, 420, period);
      let p = 0;
      let species: Species = 'broadleaf';
      let minUp = 0.8;
      if (biome === 'forest') {
        p = 0.85 * smoothstep(0.3, 0.45, grove);
        species = conif > 0.52 ? 'conifer' : 'broadleaf';
      } else if (biome === 'grassland') {
        p = 0.04 + 0.5 * smoothstep(0.6, 0.78, grove);
        species = conif > 0.62 ? 'conifer' : 'broadleaf';
      } else if (biome === 'mountain') {
        p = 0.4 * smoothstep(0.35, 0.5, grove) * Math.min(1, Math.max(0, 1.2 - (h - 150) / 450));
        species = 'conifer';
        minUp = 0.74;
      } else if (biome === 'beach' && h >= 1) {
        p = 0.12 * smoothstep(0.3, 0.5, grove);
        species = 'palm';
        minUp = 0.92;
      }
      if (roll >= p) continue;
      if (world.normalAt(px, pz).y < minUp) continue;
      const scale = species === 'palm' ? 0.85 + 0.3 * sizeR : 0.8 + 0.58 * sizeR;
      out.push({ x: px, y: h - 0.15, z: pz, rot, scale, species, variant: Math.floor(pick * VARIANTS[species]), tint });
    }
  }
  return out;
}

/** Grass quality at one lattice node: ground height, how thick the grass is there (0..1), and its colour (0 dark, 0.6 lush, 1 dry). */
function grassNode(world: AthreeWorld, x: number, z: number, period: number): { h: number; d: number; t: number } {
  const h = world.heightAt(x, z);
  const biome = world.biomeAt(x, z);
  let base = 0;
  let tint = 0.5;
  if (biome === 'grassland') { base = 1; tint = 0.62; }
  else if (biome === 'forest') { base = 0.55; tint = 0.28; }
  else if (biome === 'mountain') { base = 0.35 * Math.min(1, Math.max(0, 1 - (h - 150) / 500)); tint = 0.4; }
  else if (biome === 'beach' && h > 1.5) { base = 0.08; tint = 0.85; }
  if (base <= 0) return { h, d: 0, t: tint };
  const ny = world.normalAt(x, z).y;
  const patch = fieldNoise(x, z, world.seed + 13, 2, 9, period);
  const dry = fieldNoise(x, z, world.seed + 14, 2, 40, period);
  const d = base * smoothstep(0.62, 0.86, ny) * (0.55 + 0.45 * smoothstep(0.25, 0.65, patch));
  return { h, d, t: Math.min(1, Math.max(0, tint + (dry - 0.5) * 0.5)) };
}

/**
 * Grass tufts inside [x0, x1) x [z0, z1), packed six floats each: x, y, z, rotation, scale, tint. Ground height and thickness come from a
 * 2 m lattice of world-aligned nodes (each node a pure function of its place) blended bilinearly, so a tile costs a few hundred terrain
 * samples instead of one per tuft, and two tiles agree exactly along their shared edge.
 */
export function grassInRect(world: AthreeWorld, x0: number, z0: number, x1: number, z1: number, cell: number): Float32Array {
  const period = periodOf(world);
  const i0 = Math.floor(x0 / LATTICE) - 1;
  const j0 = Math.floor(z0 / LATTICE) - 1;
  const nx = Math.floor(x1 / LATTICE) + 2 - i0 + 1;
  const nz = Math.floor(z1 / LATTICE) + 2 - j0 + 1;
  const H = new Float32Array(nx * nz);
  const D = new Float32Array(nx * nz);
  const T = new Float32Array(nx * nz);
  let anyGrass = false;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const n = grassNode(world, (i0 + i) * LATTICE, (j0 + j) * LATTICE, period);
      const k = j * nx + i;
      H[k] = n.h; D[k] = n.d; T[k] = n.t;
      if (n.d > 0) anyGrass = true;
    }
  }
  if (!anyGrass) return new Float32Array(0);
  const out: number[] = [];
  for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {
    for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) {
      const rng = mulberry32(mix32(wrapIndex(world, cell, ix), wrapIndex(world, cell, iz), world.seed, 202));
      const px = (ix + rng()) * cell;
      const pz = (iz + rng()) * cell;
      const roll = rng();
      const rot = rng() * Math.PI * 2;
      const sizeR = rng();
      const tintJitter = rng();
      if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
      const fx = px / LATTICE - i0;
      const fz = pz / LATTICE - j0;
      const ia = Math.floor(fx);
      const ja = Math.floor(fz);
      const tx = fx - ia;
      const tz = fz - ja;
      const k00 = ja * nx + ia;
      const lerp2 = (A: Float32Array): number => (A[k00] * (1 - tx) + A[k00 + 1] * tx) * (1 - tz) + (A[k00 + nx] * (1 - tx) + A[k00 + nx + 1] * tx) * tz;
      const d = lerp2(D);
      if (roll >= d) continue;
      out.push(px, lerp2(H), pz, rot, 0.9 + 0.6 * sizeR, Math.min(1, Math.max(0, lerp2(T) + (tintJitter - 0.5) * 0.12)));
    }
  }
  return Float32Array.from(out);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The plant meshes, as plain arrays.

/** What a vertex is, for the shader: how it is shaded, masked and moved. */
export const KIND = { bark: 0, broad: 1, needle: 2, frond: 3, grass: 4 } as const;

export interface PlantArrays {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  uv: Float32Array;
  /** 0 = rooted, 1 = free end: how far the wind may move this vertex. */
  sway: Float32Array;
  /** A random number per card, so neighbouring leaves do not flutter in step. */
  phase: Float32Array;
  kind: Float32Array;
  index: Uint16Array;
  triangles: number;
}

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  sway: number[] = [];
  phase: number[] = [];
  kind: number[] = [];
  idx: number[] = [];
  vert(p: V3, n: V3, c: V3, u: number, v: number, sway: number, phase: number, kind: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, v);
    this.sway.push(sway);
    this.phase.push(phase);
    this.kind.push(kind);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  finish(): PlantArrays {
    return {
      position: Float32Array.from(this.pos),
      normal: Float32Array.from(this.nor),
      color: Float32Array.from(this.col),
      uv: Float32Array.from(this.uv),
      sway: Float32Array.from(this.sway),
      phase: Float32Array.from(this.phase),
      kind: Float32Array.from(this.kind),
      index: Uint16Array.from(this.idx),
      triangles: this.idx.length / 3,
    };
  }
}

/** An open tube from p0 to p1: two triangles per side. */
function tube(b: Builder, p0: V3, p1: V3, r0: number, r1: number, sides: number, color: V3, s0: number, s1: number): void {
  const axis = norm(sub(p1, p0));
  const ref: V3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(axis, ref));
  const w = cross(axis, u);
  const base = b.pos.length / 3;
  for (let ring = 0; ring < 2; ring++) {
    const p = ring ? p1 : p0;
    const r = ring ? r1 : r0;
    const sw = ring ? s1 : s0;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      const n: V3 = [u[0] * cx + w[0] * cy, u[1] * cx + w[1] * cy, u[2] * cx + w[2] * cy];
      b.vert(add(p, mul(n, r)), n, color, i / sides, ring, sw, 0, KIND.bark);
    }
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i;
    const bb = base + ((i + 1) % sides);
    b.tri(a, bb, base + sides + i);
    b.tri(bb, base + sides + ((i + 1) % sides), base + sides + i);
  }
}

/** A ribbon along a polyline: one quad (two triangles) per segment; uv.x across, uv.y along. */
function ribbon(b: Builder, pts: V3[], widths: number[], side: V3, shade: V3, kind: number, color: V3, sway0: number, sway1: number, phase: number): void {
  const base = b.pos.length / 3;
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const half = mul(side, widths[i] / 2);
    const sw = sway0 + (sway1 - sway0) * t;
    b.vert(sub(pts[i], half), shade, color, 0, t, sw, phase, kind);
    b.vert(add(pts[i], half), shade, color, 1, t, sw, phase, kind);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 2;
    b.tri(a, a + 1, a + 2);
    b.tri(a + 1, a + 3, a + 2);
  }
}

function pickColor(palette: V3[], rng: () => number, shade: number): V3 {
  const c = palette[Math.floor(rng() * palette.length) % palette.length];
  return [c[0] * shade, c[1] * shade, c[2] * shade];
}

/** A card of leaves at a place, facing a random way biased outward from the crown. */
function leafCard(b: Builder, centre: V3, crown: V3, size: number, kind: number, palette: V3[], rng: () => number, swayBase: number): void {
  const out = norm(sub(centre, crown));
  const n = norm([out[0] * 0.55 + (rng() - 0.5), out[1] * 0.55 + (rng() - 0.5) * 0.8 + 0.25, out[2] * 0.55 + (rng() - 0.5)]);
  const ref: V3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(n, ref));
  const v = cross(n, u);
  const a = rng() * Math.PI * 2;
  const ur = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
  const dist = Math.hypot(centre[0] - crown[0], centre[1] - crown[1], centre[2] - crown[2]);
  const shade = 0.62 + 0.38 * Math.min(1, dist / 3);
  const color = pickColor(palette, rng, shade);
  const from = sub(centre, mul(cross(n, ur), size / 2));
  ribbon(b, [from, add(from, mul(cross(n, ur), size))], [size, size], ur, out, kind, color, swayBase, swayBase + 0.3, rng());
}

const BROAD_LEAVES: V3[] = [[0.17, 0.4, 0.11], [0.24, 0.47, 0.13], [0.13, 0.33, 0.1], [0.3, 0.5, 0.14]];
const CONIFER_LEAVES: V3[] = [[0.06, 0.22, 0.12], [0.08, 0.27, 0.14], [0.05, 0.19, 0.1]];
const PALM_LEAVES: V3[] = [[0.2, 0.46, 0.12], [0.26, 0.52, 0.14]];
const BARK: V3 = [0.3, 0.21, 0.14];

function broadleaf(b: Builder, lod: 0 | 1, rng: () => number): void {
  const segs = lod === 0 ? 4 : 2;
  const sides = lod === 0 ? 7 : 4;
  const H = 3.8;
  const ax = (rng() - 0.5) * 0.35;
  const az = (rng() - 0.5) * 0.35;
  const path: V3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push([ax * t * t * H * 0.4, t * H, az * t * t * H * 0.4]);
  }
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    tube(b, path[i], path[i + 1], 0.3 - 0.14 * t0, 0.3 - 0.14 * t1, sides, BARK, 0.3 * t0 * t0, 0.3 * t1 * t1);
  }
  const top = path[segs];
  const crown: V3 = [top[0], 5.6, top[2]];
  if (lod === 1) {
    for (let i = 0; i < 11; i++) {
      const ang = i * 2.399963;
      const el = (i / 10) * 1.9 - 0.7;
      const p: V3 = [crown[0] + Math.cos(ang) * Math.cos(el) * 2.5, crown[1] + Math.sin(el) * 2.2, crown[2] + Math.sin(ang) * Math.cos(el) * 2.5];
      leafCard(b, p, crown, 3 + rng() * 0.8, KIND.broad, BROAD_LEAVES, rng, 0.6);
    }
    return;
  }
  for (let k = 0; k < 6; k++) {
    const azm = (k / 6) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const el = 0.6 + rng() * 0.5;
    const sy = 2.3 + rng() * 1.5;
    const f = (sy / H) * (sy / H);
    const start: V3 = [top[0] * f, sy, top[2] * f];
    const dir = norm([Math.sin(el) * Math.cos(azm), Math.cos(el), Math.sin(el) * Math.sin(azm)]);
    const len = 2.4 + rng() * 0.9;
    const mid = add(start, mul(dir, len * 0.5));
    const end = add(start, mul(norm(add(dir, [0, 0.15, 0])), len));
    tube(b, start, mid, 0.14, 0.09, 5, BARK, 0.35, 0.5);
    tube(b, mid, end, 0.09, 0.05, 5, BARK, 0.5, 0.65);
    const tips: V3[] = [end];
    for (let t = 0; t < 2; t++) {
      const d2 = norm(add(dir, [(rng() - 0.5) * 1.6, (rng() - 0.3) * 0.8, (rng() - 0.5) * 1.6]));
      const e2 = add(mid, mul(d2, 1.3));
      tube(b, mid, e2, 0.05, 0.025, 4, BARK, 0.5, 0.7);
      tips.push(e2);
    }
    for (const tip of tips) {
      for (let c = 0; c < 5; c++) {
        const p = add(tip, [(rng() - 0.5) * 1.6, (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.6]);
        leafCard(b, p, crown, 1.5 + rng() * 0.6, KIND.broad, BROAD_LEAVES, rng, 0.65);
      }
    }
  }
  for (let i = 0; i < 30; i++) {
    const ang = rng() * Math.PI * 2;
    const el = rng() * 1.8 - 0.5;
    const r = 2.2 + rng() * 1.2;
    const p: V3 = [crown[0] + Math.cos(ang) * Math.cos(el) * r, crown[1] + Math.sin(el) * r * 0.85, crown[2] + Math.sin(ang) * Math.cos(el) * r];
    leafCard(b, p, crown, 1.6 + rng() * 0.6, KIND.broad, BROAD_LEAVES, rng, 0.7);
  }
}

function conifer(b: Builder, lod: 0 | 1, rng: () => number): void {
  const H = 11;
  const segs = lod === 0 ? 5 : 1;
  const sides = lod === 0 ? 6 : 4;
  const bark: V3 = [0.26, 0.18, 0.12];
  const swayAt = (y: number): number => 0.45 * (y / H) * (y / H);
  for (let i = 0; i < segs; i++) {
    const y0 = (i / segs) * H;
    const y1 = ((i + 1) / segs) * H;
    tube(b, [0, y0, 0], [0, y1, 0], 0.34 - 0.3 * (y0 / H), 0.34 - 0.3 * (y1 / H), sides, bark, swayAt(y0), swayAt(y1));
  }
  const whorls = lod === 0 ? 12 : 7;
  for (let w = 0; w < whorls; w++) {
    const y = lod === 0 ? 1.6 + (w / 11) * 8.8 : 1.8 + (w / 6) * 8.2;
    const len = 0.5 + 3.4 * (1 - y / H) + (lod === 1 ? 0.4 : 0);
    if (lod === 1) {
      for (let k = 0; k < 2; k++) {
        const azm = w * 1.9 + k * Math.PI;
        const dir = norm([Math.cos(azm), -0.28, Math.sin(azm)]);
        const side = norm(cross(dir, [0, 1, 0]));
        ribbon(b, [[0, y, 0], add([0, y, 0], mul(dir, len * 1.25))], [len * 1.7, 0.3], side, norm([dir[0], 0.7, dir[2]]), KIND.needle, pickColor(CONIFER_LEAVES, rng, 1), swayAt(y), swayAt(y) + 0.4, rng());
      }
      continue;
    }
    for (let k = 0; k < 5; k++) {
      const azm = (k / 5) * Math.PI * 2 + w * 0.9 + (rng() - 0.5) * 0.4;
      const dir = norm([Math.cos(azm), -0.28, Math.sin(azm)]);
      const from: V3 = [0, y, 0];
      const end = add(from, mul(dir, len * 0.72));
      tube(b, from, end, 0.06 * (1 - y / H) + 0.02, 0.015, 3, bark, swayAt(y), swayAt(y) + 0.3);
      const side = norm(cross(dir, [0, 1, 0]));
      const lean = norm(add(mul(side, 0.55), [0, 0.83, 0]));
      const shade = norm([dir[0], 0.7, dir[2]]);
      const start = add(from, mul(dir, 0.25));
      const tip = add(from, mul(dir, len * 0.98));
      ribbon(b, [start, tip], [len * 0.9, 0.15], side, shade, KIND.needle, pickColor(CONIFER_LEAVES, rng, 1), swayAt(y) + 0.1, swayAt(y) + 0.55, rng());
      ribbon(b, [start, tip], [len * 0.8, 0.12], lean, shade, KIND.needle, pickColor(CONIFER_LEAVES, rng, 0.9), swayAt(y) + 0.1, swayAt(y) + 0.55, rng());
    }
  }
  const topColor = pickColor(CONIFER_LEAVES, rng, 1);
  const leader = lod === 0 ? 2 : 1;
  for (let k = 0; k < leader; k++) {
    const a = (k / 2) * Math.PI;
    ribbon(b, [[0, H - 1.7, 0], [0, H + 0.4, 0]], [1, 0.1], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], KIND.needle, topColor, 0.35, 0.6, rng());
  }
}

function palm(b: Builder, lod: 0 | 1, rng: () => number): void {
  const H = 9;
  const segs = lod === 0 ? 6 : 2;
  const sides = lod === 0 ? 6 : 4;
  const bendAz = rng() * Math.PI * 2;
  const bx = Math.cos(bendAz) * 1.8;
  const bz = Math.sin(bendAz) * 1.8;
  const trunk: V3 = [0.42, 0.34, 0.24];
  const path: V3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push([bx * t * t, t * H, bz * t * t]);
  }
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    tube(b, path[i], path[i + 1], 0.24 - 0.11 * t0, 0.24 - 0.11 * t1, sides, trunk, 0.5 * t0 * t0, 0.5 * t1 * t1);
  }
  const top = path[segs];
  const fronds = lod === 0 ? 11 : 8;
  for (let f = 0; f < fronds; f++) {
    const azm = (f / fronds) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    let dir = norm([Math.cos(azm) * 0.8, 0.55 + rng() * 0.2, Math.sin(azm) * 0.8]);
    const len = 3.4 + rng() * 0.8;
    const side = norm(cross(dir, [0, 1, 0]));
    const color = pickColor(PALM_LEAVES, rng, 1);
    const shade = norm([dir[0] * 0.5, 1, dir[2] * 0.5]);
    if (lod === 1) {
      ribbon(b, [top, add(top, mul(norm([dir[0], dir[1] - 0.25, dir[2]]), len))], [1.1, 0.5], side, shade, KIND.frond, color, 0.55, 1, rng());
      continue;
    }
    const pts: V3[] = [top];
    for (let s = 1; s <= 4; s++) {
      dir = norm([dir[0], dir[1] - 0.22, dir[2]]);
      pts.push(add(pts[s - 1], mul(dir, len / 4)));
    }
    ribbon(b, pts, [0.25, 0.85, 1, 0.7, 0.12], side, shade, KIND.frond, color, 0.55, 1, rng());
  }
}

/** A tree mesh: one species, one variant, one level of detail (0 full, 1 cheap). Unit scale: about 9 to 11 metres tall. */
export function buildTreeArrays(species: Species, lod: 0 | 1, variant = 0): PlantArrays {
  const rng = mulberry32(SPECIES.indexOf(species) * 977 + lod * 13 + variant * 7919 + 31);
  const b = new Builder();
  if (species === 'broadleaf') broadleaf(b, lod, rng);
  else if (species === 'conifer') conifer(b, lod, rng);
  else palm(b, lod, rng);
  return b.finish();
}

/** A grass tuft: three crossed cards (the fragment shader cuts blades out of each card). Roughly 0.5 m wide and 0.45 m tall. */
export function buildTuftArrays(): PlantArrays {
  const b = new Builder();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    ribbon(b, [[0, 0, 0], [0, 0.45, 0]], [0.5, 0.5], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], KIND.grass, [1, 1, 1], 0, 1, i / 3);
  }
  return b.finish();
}
`;

export const PLANTS = `// Athree map — plants on screen: wind shaders, instancing, streaming tiles, levels of detail.
// Technique: GPU instancing; a vertex-shader bend driven by the shared wind field plus per-leaf flutter; leaf shapes cut by a procedural
// mask (no textures); scatter tiles built a few per frame and cached. Own implementation.

import { type AthreeQuality } from './config';
import {
  SPECIES, VARIANTS, VEGETATION_TIERS, TREE_TILE, GRASS_TILE, TUFT_TRIANGLES,
  buildTreeArrays, buildTuftArrays, treesInRect, grassInRect,
  type PlantArrays, type TreeSpec,
} from './vegetation';
import type { AthreeWorld } from './world';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export interface VegetationStats {
  trees: number;
  treesLod0: number;
  tufts: number;
  /** Triangles drawn right now by the vegetation. */
  triangles: number;
  drawCalls: number;
  tilesLoaded: number;
}

export interface Vegetation {
  readonly group: ThreeLike;
  /** Call every frame. The camera and origin are in WORLD metres; time in seconds. */
  update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }): void;
  stats(): VegetationStats;
  /** Match the scene's light: sun direction (towards the sun), sun colour, ambient colour. */
  setLight(sun: { x: number; y: number; z: number }, sunColor?: number, ambientColor?: number): void;
  dispose(): void;
}

const SHARED_GLSL = [
  'varying vec3 vNormal; varying vec3 vColor; varying vec2 vUv; varying float vKind; varying float vTint; varying float vSeed;',
];

export function plantVertexShader(): string {
  return [
    'uniform float uTime; uniform vec2 uWind; uniform vec2 uAnchor; uniform vec2 uCamWorld; uniform vec2 uFade; uniform float uBend;',
    'attribute float aSway; attribute float aPhase; attribute float aKind; attribute float aTint;',
    ...SHARED_GLSL,
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vec3 lp = position;',
    '  vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
    '  vec2 wb = uAnchor + base.xz;',
    '  lp.y *= 1.0 - smoothstep(uFade.x, uFade.y, distance(wb, uCamWorld));',
    '  vec4 wp = modelMatrix * instanceMatrix * vec4(lp, 1.0);',
    '  float speed = length(uWind);',
    '  float s = clamp(speed / 12.0, 0.08, 1.0);',
    '  vec2 dir = speed > 0.001 ? uWind / speed : vec2(1.0, 0.0);',
    '  float gust = 0.5 + 0.5 * sin(uTime * 1.1 - dot(wb, dir) * 0.045 + 0.7 * sin(uTime * 0.37 + wb.y * 0.02));',
    '  wp.xz += dir * aSway * uBend * (0.12 + 0.88 * s) * (0.55 + 0.45 * gust);',
    '  float flutter = (aKind > 0.5 && aKind < 3.5) ? (aKind < 1.5 ? 1.0 : (aKind < 2.5 ? 0.35 : 0.7)) : 0.0;',
    '  float f = uTime * (4.5 + 3.0 * aPhase) + aPhase * 6.2831 + wb.x * 0.6;',
    '  wp.xyz += flutter * (0.03 + 0.1 * s) * vec3(sin(f), 0.6 * cos(f * 1.3), cos(f * 0.8)) * aSway;',
    '  vNormal = normalize(mat3(instanceMatrix) * normal);',
    '  vColor = color; vUv = uv; vKind = aKind; vTint = aTint; vSeed = aPhase;',
    '  vec4 mvPosition = viewMatrix * wp;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}',
  ].join('\\n');
}

export function plantFragmentShader(): string {
  return [
    'uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uAmbient;',
    ...SHARED_GLSL,
    '#include <fog_pars_fragment>',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'void main() {',
    '  float k = vKind;',
    '  vec2 c = vUv * 2.0 - 1.0;',
    '  if (k > 0.5 && k < 1.5) {',
    '    float d = length(c);',
    '    float n = vnoise(vUv * 6.0 + vSeed * 17.0);',
    '    if (d + (n - 0.5) * 0.8 > 0.95) discard;',
    '    if (d > 0.3 && vnoise(vUv * 15.0 + vSeed * 5.0) < 0.27) discard;',
    '  } else if (k > 1.5 && k < 2.5) {',
    '    float w = (1.0 - vUv.y * 0.8) * 0.95;',
    '    if (abs(c.x) > w) discard;',
    '    if (fract(vUv.y * 11.0 + abs(c.x) * 5.0) > 0.74) discard;',
    '  } else if (k > 2.5 && k < 3.5) {',
    '    if (abs(c.x) > 1.0 - 0.15 * vUv.y) discard;',
    '    if (abs(c.x) > 0.1 && fract(vUv.y * 18.0 - abs(c.x) * 6.0) > 0.76) discard;',
    '  } else if (k > 3.5) {',
    '    float id = floor(vUv.x * 7.0);',
    '    float hgt = 0.5 + 0.5 * hash(vec2(id, vSeed * 13.0));',
    '    float fx = fract(vUv.x * 7.0) * 2.0 - 1.0;',
    '    if (vUv.y > hgt || abs(fx) > (1.0 - vUv.y / hgt) * 0.8) discard;',
    '  }',
    '  vec3 n = normalize(vNormal);',
    '  float lit = clamp(dot(n, uSun) * 0.6 + 0.4, 0.0, 1.0);',
    '  vec3 base = vColor;',
    '  if (k > 3.5) {',
    '    vec3 dark = vec3(0.16, 0.32, 0.09); vec3 lush = vec3(0.36, 0.58, 0.16); vec3 dry = vec3(0.66, 0.6, 0.28);',
    '    base = mix(mix(dark, lush, smoothstep(0.0, 0.55, vTint)), dry, smoothstep(0.62, 1.0, vTint));',
    '    base *= mix(0.6, 1.08, smoothstep(0.0, 0.8, vUv.y));',
    '  } else if (k > 0.5) {',
    '    base = mix(base, base * vec3(1.35, 1.15, 0.5), vTint * 0.55);',
    '  } else {',
    '    base *= 0.85 + 0.3 * vTint;',
    '  }',
    '  gl_FragColor = vec4(base * (uAmbient + uSunColor * lit), 1.0);',
    '  #include <fog_fragment>',
    '}',
  ].join('\\n');
}

function geometryFrom(THREE: ThreeLike, a: PlantArrays, instanceCap: number): ThreeLike {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setAttribute('aSway', new THREE.BufferAttribute(a.sway, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(a.phase, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(a.kind, 1));
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(instanceCap), 1));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  return g;
}

interface Slot {
  mesh: ThreeLike;
  tris: number;
  count: number;
}

export function createVegetation(THREE: ThreeLike, world: AthreeWorld, quality: AthreeQuality = 'mid'): Vegetation {
  const tier = VEGETATION_TIERS[quality];
  const group = new THREE.Group();

  const shared = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0, 0) },
    uAnchor: { value: new THREE.Vector2(0, 0) },
    uCamWorld: { value: new THREE.Vector2(0, 0) },
    uSun: { value: new THREE.Vector3(-0.5, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(0.95, 0.92, 0.82) },
    uAmbient: { value: new THREE.Color(0.42, 0.46, 0.5) },
  };
  const makeMaterial = (bend: number, fadeStart: number, fadeEnd: number): ThreeLike => {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uBend: { value: bend }, uFade: { value: new THREE.Vector2(fadeStart, fadeEnd) } }]);
    Object.assign(uniforms, shared);
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: plantVertexShader(),
      fragmentShader: plantFragmentShader(),
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: true,
    });
  };
  const treeMaterial = makeMaterial(0.55, 1e8, 2e8);
  const grassMaterial = makeMaterial(0.38, tier.grassRadius * 0.55, tier.grassRadius * 0.95);

  const slots = new Map<string, Slot>();
  const geometries: ThreeLike[] = [];
  const addSlot = (key: string, arrays: PlantArrays, material: ThreeLike, cap: number): void => {
    const geometry = geometryFrom(THREE, arrays, cap);
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    slots.set(key, { mesh, tris: arrays.triangles, count: 0 });
  };
  for (const species of SPECIES) {
    for (let v = 0; v < VARIANTS[species]; v++) {
      addSlot(species + v + ':0', buildTreeArrays(species, 0, v), treeMaterial, tier.maxLod0);
      addSlot(species + v + ':1', buildTreeArrays(species, 1, v), treeMaterial, tier.maxTrees);
    }
  }
  addSlot('grass', buildTuftArrays(), grassMaterial, tier.maxTufts);

  const treeTiles = new Map<string, TreeSpec[]>();
  const grassTiles = new Map<string, Float32Array>();
  const anchor = { x: 0, z: 0 };
  let rebuiltAt = { x: Infinity, z: Infinity };
  let dirty = true;
  let sinceRebuild = 0;
  let scanTile = { x: Infinity, z: Infinity };
  let pending: Array<{ grass: boolean; i: number; j: number; d: number }> = [];

  const tileKey = (i: number, j: number): string => i + ',' + j;

  function scan(cx: number, cz: number): void {
    pending = [];
    const want = (size: number, radius: number, grass: boolean, loaded: Map<string, unknown>): void => {
      const reach = radius + size * 0.71;
      const i0 = Math.floor((cx - reach) / size);
      const i1 = Math.floor((cx + reach) / size);
      const j0 = Math.floor((cz - reach) / size);
      const j1 = Math.floor((cz + reach) / size);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot((i + 0.5) * size - cx, (j + 0.5) * size - cz);
          if (d <= reach && !loaded.has(tileKey(i, j))) pending.push({ grass, i, j, d });
        }
      }
      for (const key of Array.from(loaded.keys())) {
        const [ki, kj] = key.split(',').map(Number);
        if (Math.hypot((ki + 0.5) * size - cx, (kj + 0.5) * size - cz) > reach * 1.25) { loaded.delete(key); dirty = true; }
      }
    };
    want(TREE_TILE, tier.treeRadius, false, treeTiles);
    want(GRASS_TILE, tier.grassRadius, true, grassTiles);
    pending.sort((a, b) => a.d - b.d);
  }

  function buildTiles(): void {
    let built = 0;
    while (pending.length > 0 && built < tier.tilesPerUpdate) {
      const p = pending.shift()!;
      if (p.grass) {
        grassTiles.set(tileKey(p.i, p.j), grassInRect(world, p.i * GRASS_TILE, p.j * GRASS_TILE, (p.i + 1) * GRASS_TILE, (p.j + 1) * GRASS_TILE, tier.grassCell));
      } else {
        treeTiles.set(tileKey(p.i, p.j), treesInRect(world, p.i * TREE_TILE, p.j * TREE_TILE, (p.i + 1) * TREE_TILE, (p.j + 1) * TREE_TILE));
      }
      built++;
    }
    if (built > 0) dirty = true;
  }

  function rebuild(cx: number, cz: number): void {
    anchor.x = Math.round(cx);
    anchor.z = Math.round(cz);
    rebuiltAt = { x: cx, z: cz };
    dirty = false;
    sinceRebuild = 0;
    for (const s of slots.values()) s.count = 0;

    const near: Array<{ t: TreeSpec; d2: number }> = [];
    const r2 = tier.treeRadius * tier.treeRadius;
    for (const tile of treeTiles.values()) {
      for (const t of tile) {
        const d2 = (t.x - cx) * (t.x - cx) + (t.z - cz) * (t.z - cz);
        if (d2 <= r2) near.push({ t, d2 });
      }
    }
    near.sort((a, b) => a.d2 - b.d2);
    const lod0r2 = tier.lod0Radius * tier.lod0Radius;
    let lod0 = 0;
    for (let n = 0; n < near.length && n < tier.maxTrees; n++) {
      const { t, d2 } = near[n];
      const full = lod0 < tier.maxLod0 && d2 <= lod0r2;
      if (full) lod0++;
      const slot = slots.get(t.species + t.variant + (full ? ':0' : ':1'))!;
      writeInstance(slot, t.x, t.y, t.z, t.rot, t.scale, t.scale, t.tint);
    }

    const grass = slots.get('grass')!;
    const gr2 = tier.grassRadius * tier.grassRadius;
    const tufts: Array<{ i: number; d2: number; tile: Float32Array }> = [];
    for (const tile of grassTiles.values()) {
      for (let i = 0; i < tile.length; i += 6) {
        const d2 = (tile[i] - cx) * (tile[i] - cx) + (tile[i + 2] - cz) * (tile[i + 2] - cz);
        if (d2 <= gr2) tufts.push({ i, d2, tile });
      }
    }
    if (tufts.length > tier.maxTufts) tufts.sort((a, b) => a.d2 - b.d2);
    for (let n = 0; n < tufts.length && n < tier.maxTufts; n++) {
      const { i, tile } = tufts[n];
      writeInstance(grass, tile[i], tile[i + 1] - 0.03, tile[i + 2], tile[i + 3], tile[i + 4], tile[i + 4], tile[i + 5]);
    }
    for (const s of slots.values()) {
      s.mesh.count = s.count;
      s.mesh.instanceMatrix.needsUpdate = true;
      s.mesh.geometry.getAttribute('aTint').needsUpdate = true;
    }
    shared.uAnchor.value.set(anchor.x, anchor.z);
  }

  // Instance matrix for a plant: rotation about Y, uniform scale (height scale sy, width scale sx), translation relative to the anchor.
  function writeInstance(slot: Slot, x: number, y: number, z: number, rot: number, sy: number, sx: number, tint: number): void {
    const m = slot.mesh.instanceMatrix.array as Float32Array;
    const o = slot.count * 16;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    m[o] = sx * c; m[o + 1] = 0; m[o + 2] = -sx * s; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = sx * s; m[o + 9] = 0; m[o + 10] = sx * c; m[o + 11] = 0;
    m[o + 12] = x - anchor.x; m[o + 13] = y; m[o + 14] = z - anchor.z; m[o + 15] = 1;
    (slot.mesh.geometry.getAttribute('aTint').array as Float32Array)[slot.count] = tint;
    slot.count++;
  }

  function update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }): void {
    shared.uTime.value = time;
    const wind = world.windAt(cameraX, cameraZ, time);
    shared.uWind.value.set(wind.x, wind.z);
    shared.uCamWorld.value.set(cameraX, cameraZ);
    group.position.set(anchor.x - origin.x, 0, anchor.z - origin.z);
    const ti = Math.floor(cameraX / GRASS_TILE);
    const tj = Math.floor(cameraZ / GRASS_TILE);
    if (ti !== scanTile.x || tj !== scanTile.z || pending.length > 0) {
      if (ti !== scanTile.x || tj !== scanTile.z) { scanTile = { x: ti, z: tj }; scan(cameraX, cameraZ); }
      buildTiles();
    }
    sinceRebuild++;
    const moved = Math.hypot(cameraX - rebuiltAt.x, cameraZ - rebuiltAt.z) > tier.rebuildDistance;
    if (moved || (dirty && (pending.length === 0 || sinceRebuild >= 4))) {
      rebuild(cameraX, cameraZ);
      group.position.set(anchor.x - origin.x, 0, anchor.z - origin.z);
    }
  }

  function stats(): VegetationStats {
    let trees = 0;
    let treesLod0 = 0;
    let tufts = 0;
    let triangles = 0;
    let drawCalls = 0;
    for (const [key, s] of slots) {
      if (s.count > 0) drawCalls++;
      if (key === 'grass') { tufts = s.count; triangles += s.count * TUFT_TRIANGLES; continue; }
      trees += s.count;
      if (key.endsWith(':0')) treesLod0 += s.count;
      triangles += s.count * s.tris;
    }
    return { trees, treesLod0, tufts, triangles, drawCalls, tilesLoaded: treeTiles.size + grassTiles.size };
  }

  function setLight(sun: { x: number; y: number; z: number }, sunColor?: number, ambientColor?: number): void {
    shared.uSun.value.set(sun.x, sun.y, sun.z).normalize();
    if (sunColor !== undefined) shared.uSunColor.value.set(sunColor);
    if (ambientColor !== undefined) shared.uAmbient.value.set(ambientColor);
  }

  function dispose(): void {
    for (const s of slots.values()) { group.remove(s.mesh); s.mesh.dispose?.(); }
    for (const g of geometries) g.dispose();
    treeMaterial.dispose();
    grassMaterial.dispose();
    slots.clear();
    treeTiles.clear();
    grassTiles.clear();
  }

  return { group, update, stats, setLight, dispose };
}

`;
