// ATHREE MAP — phase 1 (the world core) and phase 2a (the ocean) (admin-approved plan: docs/game-engine/athree-map-plan.md).
//
// One big, seeded, streaming world that every game can stand on: racing, open world, battle royale, flight, exploring. This phase is the
// FOUNDATION the later phases (water, grass and trees, desert and sky, roads and racing, aircraft and life) are built on:
//   • a deterministic height / biome / wind / spawn API, identical for the renderer and for the physics colliders;
//   • an exactly seamless LOOP world (100 km period) or a bounded island (battle-royale arena), from the same code;
//   • chunk streaming with levels of detail, crack-hiding skirts and a floating origin, so float precision never breaks 50 km out;
//   • heightfield data for a Rapier collider, node-for-node equal to what is drawn;
//   • three quality tiers with a computed triangle budget.
//
// 🔑 100% OURS. Every line below is written here. The TECHNIQUES are public ideas (value noise with a quintic fade, fractal sums,
// ridged noise, a Gerstner-free sea plane placeholder until phase 2); each emitted file names its technique in its header, and no
// third-party code or asset is used. The generator is OFF unless AGENTV3_ATHREE_MAP is on (see ToolDispatcher).
//
// PURE builder → the caller writes the files.

import { WATER, OCEAN } from './athreeWaterSource';

export interface AthreeMapResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const DIR = 'src/game/athree';

const NOISE = `// Athree map — seeded noise.
// Technique: lattice value noise with a quintic fade, summed over octaves (fractal Brownian motion); made TILEABLE by wrapping the
// lattice coordinates. Own implementation; no third-party code.

export function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrap(i: number, period: number): number {
  return period > 0 ? ((i % period) + period) % period : i;
}

/** Smooth noise in [0, 1). A period > 0 (in lattice cells) makes it repeat exactly. */
export function valueNoise2(x: number, z: number, seed: number, period = 0): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);
  const xa = wrap(x0, period);
  const xb = wrap(x0 + 1, period);
  const za = wrap(z0, period);
  const zb = wrap(z0 + 1, period);
  const a = hash2(xa, za, seed);
  const b = hash2(xb, za, seed);
  const c = hash2(xa, zb, seed);
  const d = hash2(xb, zb, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/**
 * Fractal noise in [0, 1). \`cellMeters\` is the first octave's cell; \`periodMeters\` > 0 makes the field tile exactly every
 * periodMeters (the cell is nudged so the period is a whole number of cells, and every octave doubles both).
 */
export function fieldNoise(x: number, z: number, seed: number, octaves: number, cellMeters: number, periodMeters = 0): number {
  const cells = periodMeters > 0 ? Math.max(1, Math.round(periodMeters / cellMeters)) : 0;
  const cell = periodMeters > 0 ? periodMeters / cells : cellMeters;
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2((x / cell) * freq, (z / cell) * freq, seed + o * 1013, cells > 0 ? cells * freq : 0);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** A small seeded random generator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
`;

const CONFIG = `// Athree map — profiles and quality tiers.
// Technique: a single table of numbers, so a budget can be computed instead of hoped for.

export type AthreeProfile = 'open-world' | 'racing' | 'battle-royale' | 'flight' | 'explore';
export type AthreeWorldMode = 'loop' | 'bounded';
export type AthreeQuality = 'phone' | 'mid' | 'desktop';

export interface ProfileDefaults {
  mode: AthreeWorldMode;
  /** Loop: the period in metres. Bounded: the island's diameter in metres. */
  sizeMeters: number;
}

export const PROFILE_DEFAULTS: Record<AthreeProfile, ProfileDefaults> = {
  'open-world': { mode: 'loop', sizeMeters: 100000 },
  racing: { mode: 'loop', sizeMeters: 100000 },
  'battle-royale': { mode: 'bounded', sizeMeters: 8000 },
  flight: { mode: 'loop', sizeMeters: 100000 },
  explore: { mode: 'loop', sizeMeters: 100000 },
};

export interface QualityTier {
  chunkSize: number;
  /** Chunks drawn in each direction from the camera's chunk. */
  viewRadius: number;
  /** Grid cells per chunk side at the camera's own chunk; halves every second ring out. */
  nearRes: number;
  minRes: number;
  /** Chunks built per update() call, so streaming never freezes a frame. */
  maxBuildsPerUpdate: number;
  /** The most triangles the terrain may ever draw at this tier (asserted by a test against maxTriangles). */
  budgetTriangles: number;
}

export const QUALITY: Record<AthreeQuality, QualityTier> = {
  phone: { chunkSize: 256, viewRadius: 4, nearRes: 32, minRes: 8, maxBuildsPerUpdate: 1, budgetTriangles: 120000 },
  mid: { chunkSize: 256, viewRadius: 6, nearRes: 64, minRes: 8, maxBuildsPerUpdate: 2, budgetTriangles: 400000 },
  desktop: { chunkSize: 256, viewRadius: 10, nearRes: 96, minRes: 12, maxBuildsPerUpdate: 3, budgetTriangles: 1200000 },
};

export interface OceanTier {
  /** Side of the square wave mesh that follows the camera, in metres. */
  extent: number;
  /** Cells per side of that mesh. */
  grid: number;
  /** Waves shorter than this are shaded but not displaced (the mesh cannot show them). */
  minWavelength: number;
  /** The shore-depth texture: resolution, the metres it covers, and rows baked per frame. */
  depthRes: number;
  depthSize: number;
  depthRowsPerUpdate: number;
}

export const OCEAN_TIERS: Record<AthreeQuality, OceanTier> = {
  phone: { extent: 1200, grid: 96, minWavelength: 70, depthRes: 48, depthSize: 1536, depthRowsPerUpdate: 2 },
  mid: { extent: 1800, grid: 160, minWavelength: 42, depthRes: 64, depthSize: 2048, depthRowsPerUpdate: 3 },
  desktop: { extent: 2400, grid: 256, minWavelength: 26, depthRes: 96, depthSize: 3072, depthRowsPerUpdate: 4 },
};

/** Triangles of the ocean mesh at a tier. */
export function oceanTriangles(tier: OceanTier): number {
  return tier.grid * tier.grid * 2;
}

/** Grid resolution of a chunk \`ring\` chunks away (Chebyshev distance) from the camera's chunk. */
export function lodResolution(tier: QualityTier, ring: number): number {
  return Math.max(tier.minRes, tier.nearRes >> Math.floor(ring / 2));
}

/** Triangles of one chunk grid: two per cell, plus the four skirts (two per skirt segment). */
export function chunkTriangles(res: number): number {
  return 2 * res * res + 4 * res * 2;
}

/** The most triangles the terrain can draw at a tier: every chunk in the view square at its ring's resolution. */
export function maxTriangles(tier: QualityTier): number {
  let total = 0;
  for (let ring = 0; ring <= tier.viewRadius; ring++) {
    const chunks = ring === 0 ? 1 : 8 * ring;
    total += chunks * chunkTriangles(lodResolution(tier, ring));
  }
  return total;
}
`;

const WORLD = `// Athree map — the world: height, normal, biome, wind and spawn points.
// Technique: continental fractal noise shapes land and sea; ridged noise (1 - |2n - 1|, squared) raises mountains where the land is high;
// a smooth island mask closes a bounded world into an island; a slowly drifting noise field is the shared wind. Own implementation.

import { fieldNoise, mulberry32 } from './noise';
import { PROFILE_DEFAULTS, type AthreeProfile, type AthreeWorldMode } from './config';

export type Biome = 'ocean' | 'beach' | 'desert' | 'grassland' | 'forest' | 'mountain' | 'snow';
export type SpawnKind = 'player' | 'vehicle' | 'plane' | 'boat' | 'animal';

export interface AthreeWorldOptions {
  seed?: number;
  profile?: AthreeProfile;
  /** Override the profile's mode. */
  mode?: AthreeWorldMode;
  /** Override the profile's size (loop period, or bounded island diameter), in metres. */
  sizeMeters?: number;
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Planes only: the length of the flat strip found, in metres. */
  strip?: number;
}

export interface Wind {
  x: number;
  z: number;
  speed: number;
}

export interface AthreeWorld {
  readonly seed: number;
  readonly profile: AthreeProfile;
  readonly mode: AthreeWorldMode;
  readonly sizeMeters: number;
  readonly seaLevel: number;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): { x: number; y: number; z: number };
  biomeAt(x: number, z: number): Biome;
  windAt(x: number, z: number, t: number): Wind;
  spawnPoints(kind: SpawnKind, count?: number): Spawn[];
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function kindSalt(kind: SpawnKind): number {
  let h = 17;
  for (let i = 0; i < kind.length; i++) h = (Math.imul(h, 31) + kind.charCodeAt(i)) | 0;
  return h;
}

export function createAthreeWorld(options: AthreeWorldOptions = {}): AthreeWorld {
  const profile: AthreeProfile = options.profile ?? 'open-world';
  const defaults = PROFILE_DEFAULTS[profile];
  const mode: AthreeWorldMode = options.mode ?? defaults.mode;
  const sizeMeters = options.sizeMeters ?? defaults.sizeMeters;
  const seed = (options.seed ?? 1) | 0;
  const period = mode === 'loop' ? sizeMeters : 0;
  const radius = sizeMeters / 2;
  // A bounded island is an arena to play on, so its hills are low and snow never settles; a loop world has real mountains.
  const peak = mode === 'bounded' ? 150 : 1100;
  const mountainLine = mode === 'bounded' ? 150 : 300;
  // Biomes change over a few kilometres on a loop world, and over a few hundred metres on an 8 km arena.
  const biomeScale = mode === 'bounded' ? 6 : 1;
  const snowLine = mode === 'bounded' ? 400 : 650;

  function heightAt(x: number, z: number): number {
    const c = fieldNoise(x, z, seed + 1, 5, 14000, period);
    let e = Math.max(-1.2, Math.min(1.2, (c - 0.5) * 3.4));
    if (mode === 'bounded') {
      // An island: land inside, a smooth shore, open sea outside the circle.
      const r = Math.hypot(x, z) / radius;
      const m = smoothstep(1, 0.55, r);
      e = (e * 0.5 + 0.35) * m - (1 - m) * 0.9;
    }
    if (e < 0) return e * 110;
    const ridge = 1 - Math.abs(2 * fieldNoise(x, z, seed + 2, 5, 5000, period) - 1);
    const mountain = ridge * ridge * smoothstep(0.25, 0.7, e) * peak;
    const detail = (fieldNoise(x, z, seed + 3, 4, 260, period) - 0.5) * 14 * Math.min(1, e * 4);
    return e * 55 + mountain + detail;
  }

  function normalAt(x: number, z: number): { x: number; y: number; z: number } {
    const e = 2;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    const len = Math.hypot(dx, 2 * e, dz);
    return { x: -dx / len, y: (2 * e) / len, z: -dz / len };
  }

  function biomeAt(x: number, z: number): Biome {
    const h = heightAt(x, z);
    if (h < -1) return 'ocean';
    if (h < 3) return 'beach';
    const moisture = fieldNoise(x, z, seed + 4, 4, 9000 / biomeScale, period);
    const temp = fieldNoise(x, z, seed + 5, 3, 16000 / biomeScale, period) - h / 2000;
    if (h > snowLine || (temp < 0.22 && h > snowLine * 0.6)) return 'snow';
    if (h > mountainLine) return 'mountain';
    if (moisture < 0.4 && temp > 0.45) return 'desert';
    if (moisture > 0.55) return 'forest';
    return 'grassland';
  }

  function windAt(x: number, z: number, t: number): Wind {
    const a = fieldNoise(x / 6000 + t * 0.02, z / 6000 + t * 0.013, seed + 6, 2, 1, 0) * Math.PI * 4;
    const s = 2 + 7 * fieldNoise(x / 4000 - t * 0.017, z / 4000 + t * 0.011, seed + 7, 2, 1, 0);
    const gust = 1 + 0.35 * Math.sin(t * 1.7 + x * 0.01 + z * 0.007);
    const speed = s * gust;
    return { x: Math.cos(a) * speed, z: Math.sin(a) * speed, speed };
  }

  function spawnPoints(kind: SpawnKind, count = 1): Spawn[] {
    const rng = mulberry32(seed ^ kindSalt(kind));
    const searchR = mode === 'bounded' ? radius * 0.9 : 20000;
    const out: Spawn[] = [];
    for (let attempt = 0; attempt < 8000 && out.length < count; attempt++) {
      const ang = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * searchR;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 150)) continue;
      const y = heightAt(x, z);
      const heading = rng() * Math.PI * 2;
      if (kind === 'boat') {
        if (y < -6 && heightAt(x + 30, z) < -4 && heightAt(x - 30, z) < -4) out.push({ x, y: 0, z, heading });
        continue;
      }
      if (y < 4 || y > 140) continue;
      if (kind === 'plane') {
        let lo = Infinity;
        let hi = -Infinity;
        // The strip is 600 m long and 60 m wide: flat along AND across, so a plane neither climbs nor rolls.
        for (let i = 0; i <= 12; i++) {
          for (const dz of [-30, 0, 30]) {
            const hh = heightAt(x + i * 50, z + dz);
            lo = Math.min(lo, hh);
            hi = Math.max(hi, hh);
          }
        }
        if (lo > 4 && hi - lo < 4) out.push({ x, y, z, heading: 0, strip: 600 });
        continue;
      }
      // Ground spawns: the 12 m ring around the point must be within 2 m of it (which also bounds the slope under 10 degrees).
      let flat = true;
      for (let i = 0; i < 8 && flat; i++) {
        const px = x + Math.cos((i / 8) * Math.PI * 2) * 12;
        const pz = z + Math.sin((i / 8) * Math.PI * 2) * 12;
        if (Math.abs(heightAt(px, pz) - y) > 2) flat = false;
      }
      if (!flat) continue;
      if (kind === 'animal') {
        const b = biomeAt(x, z);
        if (b !== 'grassland' && b !== 'forest') continue;
      }
      out.push({ x, y, z, heading });
    }
    return out;
  }

  return { seed, profile, mode, sizeMeters, seaLevel: 0, heightAt, normalAt, biomeAt, windAt, spawnPoints };
}
`;

const COLLIDER = `// Athree map — heightfield data for a physics collider.
// Technique: sample the SAME height function the renderer draws, on a regular grid, so a vehicle drives on exactly what is on screen.

import type { AthreeWorld } from './world';

export interface HeightfieldData {
  /** Cells along each side (the grid has cells + 1 nodes per side). */
  cells: number;
  /** Heights of the (cells + 1) x (cells + 1) nodes, column-major: heights[col * (cells + 1) + row], col along x, row along z. */
  heights: Float32Array;
  /** Edge length in metres; node (col,row) sits at (x0 + col * size / cells, z0 + row * size / cells). */
  size: number;
  x0: number;
  z0: number;
}

export function heightfieldFor(world: AthreeWorld, x0: number, z0: number, size: number, cells: number): HeightfieldData {
  const n = cells + 1;
  const heights = new Float32Array(n * n);
  for (let col = 0; col < n; col++) {
    for (let row = 0; row < n; row++) {
      heights[col * n + row] = world.heightAt(x0 + (col * size) / cells, z0 + (row * size) / cells);
    }
  }
  return { cells, heights, size, x0, z0 };
}
`;

const CHUNKS = `// Athree map — chunk streaming, levels of detail, skirts and a floating origin.
// Technique: the terrain is cut into square chunks around the camera; a chunk's grid resolution falls with its ring distance; each chunk has
// a downward skirt so neighbouring resolutions never show cracks; when the camera drifts far from the render origin the origin is re-based
// (floating origin), so 32-bit float vertex precision never degrades far from the start. Own implementation.

import { QUALITY, lodResolution, type AthreeQuality } from './config';
import type { AthreeWorld, Biome } from './world';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

const SKIRT_DEPTH = 24;

const BIOME_COLOR: Record<Biome, [number, number, number]> = {
  ocean: [0.76, 0.7, 0.52],
  beach: [0.84, 0.78, 0.58],
  desert: [0.8, 0.66, 0.4],
  grassland: [0.36, 0.5, 0.2],
  forest: [0.17, 0.34, 0.14],
  mountain: [0.46, 0.43, 0.4],
  snow: [0.93, 0.95, 0.97],
};

/** One chunk's geometry in WORLD-ALIGNED local coordinates: x, z run 0..size from the chunk's corner; y is the true height. */
export function buildChunkGeometry(THREE: ThreeLike, world: AthreeWorld, cx: number, cz: number, size: number, res: number) {
  const x0 = cx * size;
  const z0 = cz * size;
  const n = res + 1;
  const total = n * n + 4 * n;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const put = (i: number, lx: number, lz: number, drop: number): void => {
    const wx = x0 + lx;
    const wz = z0 + lz;
    const y = world.heightAt(wx, wz);
    const nm = world.normalAt(wx, wz);
    const c = BIOME_COLOR[world.biomeAt(wx, wz)];
    pos[i * 3] = lx;
    pos[i * 3 + 1] = y - drop;
    pos[i * 3 + 2] = lz;
    nor[i * 3] = nm.x;
    nor[i * 3 + 1] = nm.y;
    nor[i * 3 + 2] = nm.z;
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  };
  for (let gx = 0; gx < n; gx++) for (let gz = 0; gz < n; gz++) put(gx * n + gz, (gx * size) / res, (gz * size) / res, 0);
  // Skirts: a lowered copy of each border node, in the order -z edge, +z edge, -x edge, +x edge.
  let s = n * n;
  const skirt: number[][] = [[], [], [], []];
  for (let k = 0; k < n; k++) { put(s, (k * size) / res, 0, SKIRT_DEPTH); skirt[0].push(s++); }
  for (let k = 0; k < n; k++) { put(s, (k * size) / res, size, SKIRT_DEPTH); skirt[1].push(s++); }
  for (let k = 0; k < n; k++) { put(s, 0, (k * size) / res, SKIRT_DEPTH); skirt[2].push(s++); }
  for (let k = 0; k < n; k++) { put(s, size, (k * size) / res, SKIRT_DEPTH); skirt[3].push(s++); }
  const idx: number[] = [];
  for (let gx = 0; gx < res; gx++) {
    for (let gz = 0; gz < res; gz++) {
      const a = gx * n + gz;
      const b = (gx + 1) * n + gz;
      const c = gx * n + gz + 1;
      const d = (gx + 1) * n + gz + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const edge = (border: number[], skirtRow: number[], flip: boolean): void => {
    for (let k = 0; k < res; k++) {
      const a = border[k];
      const b = border[k + 1];
      const c = skirtRow[k];
      const d = skirtRow[k + 1];
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  };
  const borderMinZ: number[] = [];
  const borderMaxZ: number[] = [];
  const borderMinX: number[] = [];
  const borderMaxX: number[] = [];
  for (let k = 0; k < n; k++) {
    borderMinZ.push(k * n);
    borderMaxZ.push(k * n + res);
    borderMinX.push(k);
    borderMaxX.push(res * n + k);
  }
  edge(borderMinZ, skirt[0], true);
  edge(borderMaxZ, skirt[1], false);
  edge(borderMinX, skirt[2], false);
  edge(borderMaxX, skirt[3], true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

export interface ChunkManager {
  /** Add this to the scene. Its position is the negative of the render origin. */
  readonly group: ThreeLike;
  /** The render origin in world metres: render position = world position - origin. */
  readonly origin: { x: number; z: number };
  /** Stream chunks around the camera (world metres). Returns the origin shift when it was re-based, else null. */
  update(cameraX: number, cameraZ: number): { dx: number; dz: number } | null;
  loadedCount(): number;
  dispose(): void;
}

/** withSea draws the flat placeholder sea; the ocean (water.ts / ocean.ts) replaces it, so createAthreeMap turns it off. */
export function createChunkManager(THREE: ThreeLike, world: AthreeWorld, quality: AthreeQuality = 'mid', rebaseDistance = 3000, withSea = true): ChunkManager {
  const tier = QUALITY[quality];
  const size = tier.chunkSize;
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  // Until the water phase, the sea is one flat plane that follows the camera.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(size * (tier.viewRadius * 2 + 2), size * (tier.viewRadius * 2 + 2)),
    new THREE.MeshStandardMaterial({ color: 0x1d5f8a, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88 }),
  );
  sea.rotation.x = -Math.PI / 2;
  if (withSea) group.add(sea);
  const origin = { x: 0, z: 0 };
  const loaded = new Map<string, { mesh: ThreeLike; ring: number }>();
  let lastCx = Infinity;
  let lastCz = Infinity;

  const place = (mesh: ThreeLike, cx: number, cz: number): void => {
    mesh.position.set(cx * size - origin.x, 0, cz * size - origin.z);
  };

  function update(cameraX: number, cameraZ: number): { dx: number; dz: number } | null {
    const ccx = Math.floor(cameraX / size);
    const ccz = Math.floor(cameraZ / size);
    let shift: { dx: number; dz: number } | null = null;
    if (Math.hypot(cameraX - origin.x, cameraZ - origin.z) > rebaseDistance) {
      const nx = ccx * size;
      const nz = ccz * size;
      shift = { dx: nx - origin.x, dz: nz - origin.z };
      origin.x = nx;
      origin.z = nz;
      for (const [key, entry] of loaded) {
        const [kx, kz] = key.split(',').map(Number);
        place(entry.mesh, kx, kz);
      }
    }
    sea.position.set(cameraX - origin.x, world.seaLevel, cameraZ - origin.z);
    if (ccx === lastCx && ccz === lastCz && loaded.size > 0 && !shift) return shift;
    lastCx = ccx;
    lastCz = ccz;
    // Drop what is out of range.
    for (const [key, entry] of loaded) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - ccx), Math.abs(kz - ccz)) > tier.viewRadius) {
        group.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        loaded.delete(key);
      }
    }
    // Build what is missing, nearest first, a few per call.
    const wanted: Array<{ cx: number; cz: number; ring: number }> = [];
    for (let dx = -tier.viewRadius; dx <= tier.viewRadius; dx++) {
      for (let dz = -tier.viewRadius; dz <= tier.viewRadius; dz++) {
        wanted.push({ cx: ccx + dx, cz: ccz + dz, ring: Math.max(Math.abs(dx), Math.abs(dz)) });
      }
    }
    wanted.sort((a, b) => a.ring - b.ring);
    let built = 0;
    for (const w of wanted) {
      const key = w.cx + ',' + w.cz;
      const have = loaded.get(key);
      if (have && have.ring === w.ring) continue;
      if (built >= tier.maxBuildsPerUpdate) { lastCx = Infinity; break; } // finish on the next call
      if (have) { group.remove(have.mesh); have.mesh.geometry.dispose(); }
      const mesh = new THREE.Mesh(buildChunkGeometry(THREE, world, w.cx, w.cz, size, lodResolution(tier, w.ring)), material);
      place(mesh, w.cx, w.cz);
      group.add(mesh);
      loaded.set(key, { mesh, ring: w.ring });
      built++;
    }
    return shift;
  }

  function dispose(): void {
    for (const entry of loaded.values()) { group.remove(entry.mesh); entry.mesh.geometry.dispose(); }
    loaded.clear();
    material.dispose();
    sea.geometry.dispose();
    sea.material.dispose();
  }

  return { group, origin, update, loadedCount: () => loaded.size, dispose };
}
`;

const INDEX = `// Athree map — the one API a game uses.
// Technique: a thin facade over world + chunks + colliders, so racing, battle royale, flight and open-world code all talk to the same object.

import { createAthreeWorld, type AthreeWorld, type AthreeWorldOptions } from './world';
import { createChunkManager, type ChunkManager } from './chunks';
import { heightfieldFor, type HeightfieldData } from './collider';
import { createOcean, type Ocean } from './ocean';
import { type AthreeQuality } from './config';

export * from './world';
export * from './config';
export * from './noise';
export { heightfieldFor, type HeightfieldData } from './collider';
export { buildChunkGeometry, createChunkManager, type ChunkManager } from './chunks';
export * from './water';
export { createOcean, oceanVertexShader, oceanFragmentShader, type Ocean } from './ocean';

export interface AthreeMap {
  readonly world: AthreeWorld;
  /** Terrain streaming; present when three.js was given. */
  readonly chunks: ChunkManager | null;
  /** The sea: waves, shore foam, and what a boat floats on. Present when three.js was given. */
  readonly ocean: Ocean | null;
  /** Call every frame with the camera in WORLD metres and the time in seconds: streams terrain, moves the sea. Returns the origin shift when it re-based. */
  update(cameraX: number, cameraZ: number, time: number): { dx: number; dz: number } | null;
  /** Heightfield data for a physics collider over [x0, x0 + size] x [z0, z0 + size]. */
  colliderFor(x0: number, z0: number, size: number, cells: number): HeightfieldData;
  dispose(): void;
}

export interface AthreeMapOptions extends AthreeWorldOptions {
  quality?: AthreeQuality;
  // import * as THREE from 'three' — omit it to use the world (height, biome, wind, spawn) without drawing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  three?: any;
}

export function createAthreeMap(options: AthreeMapOptions = {}): AthreeMap {
  const world = createAthreeWorld(options);
  const chunks = options.three ? createChunkManager(options.three, world, options.quality ?? 'mid', 3000, false) : null;
  const ocean = options.three ? createOcean(options.three, world, options.quality ?? 'mid') : null;
  if (chunks && ocean) chunks.group.add(ocean.mesh);
  return {
    world,
    chunks,
    ocean,
    update: (cameraX, cameraZ, time) => {
      const shift = chunks ? chunks.update(cameraX, cameraZ) : null;
      if (ocean && chunks) ocean.update(cameraX, cameraZ, time, chunks.origin);
      return shift;
    },
    colliderFor: (x0, z0, size, cells) => heightfieldFor(world, x0, z0, size, cells),
    dispose: () => { chunks?.dispose(); ocean?.dispose(); },
  };
}
`;

const FILES: Record<string, string> = {
  [`${DIR}/noise.ts`]: NOISE,
  [`${DIR}/config.ts`]: CONFIG,
  [`${DIR}/world.ts`]: WORLD,
  [`${DIR}/collider.ts`]: COLLIDER,
  [`${DIR}/chunks.ts`]: CHUNKS,
  [`${DIR}/water.ts`]: WATER,
  [`${DIR}/ocean.ts`]: OCEAN,
  [`${DIR}/index.ts`]: INDEX,
};

/** Every module this recipe can write. */
export const ATHREE_MAP_MODULES: readonly string[] = ['noise', 'config', 'world', 'collider', 'chunks', 'water', 'ocean', 'index'];

export function generateAthreeMap(_include?: string[]): AthreeMapResult {
  return {
    files: { ...FILES },
    dependencies: [{ name: 'three', version: '0.180.0' }],
    instructions:
      `Added the Athree map (${Object.keys(FILES).length} files under ${DIR}). It is the world to stand on: seeded terrain that streams in around the camera, a 100 km seamless loop or a bounded island, a real wave ocean, shared height/biome/wind/spawn functions, and heightfield data for physics.\n` +
      '```ts\n' +
      "import * as THREE from 'three';\n" +
      "import { createAthreeMap } from './game/athree';\n" +
      '\n' +
      'const scene = new THREE.Scene();\n' +
      'const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 6000);\n' +
      "const map = createAthreeMap({ seed: 7, profile: 'racing', quality: 'mid', three: THREE });\n" +
      'scene.add(map.chunks!.group);\n' +
      "const spawn = map.world.spawnPoints('vehicle')[0]; // a flat, dry, safe place\n" +
      'let time = 0;\n' +
      '\n' +
      'export function frame(dt: number): void {\n' +
      '  time += dt;\n' +
      '  const shift = map.update(spawn.x, spawn.z, time); // every frame: streams terrain, moves the sea; builds a few chunks per call\n' +
      '  // When `shift` is not null the render origin moved: subtract it from your own objects\' positions.\n' +
      '  const y = map.world.heightAt(spawn.x, spawn.z); // the same height the terrain is drawn at\n' +
      '  const wind = map.world.windAt(spawn.x, spawn.z, time); // one wind field: it already sets the sea state; grass, trees and clouds will read it too\n' +
      "  const boat = map.ocean!.floatAt(spawn.x, spawn.z, time); // the sea surface a boat floats on: y and a unit normal\n" +
      '  const hf = map.colliderFor(0, 0, 256, 64); // heights for a physics heightfield collider\n' +
      '  camera.position.set(spawn.x - map.chunks!.origin.x, y + 6, spawn.z - map.chunks!.origin.z);\n' +
      '  void shift; void wind; void hf; void boat;\n' +
      '}\n' +
      '```\n' +
      'Rules: positions you give THREE are WORLD metres minus `map.chunks.origin` (the floating origin re-bases past 3 km; update() returns the shift when it does — move your own objects by it). The terrain is OFF in the build unless the Athree map is switched on. Phases built so far: the world (terrain, biomes, wind, spawns, colliders) and the OCEAN (Gerstner waves shaded and displaced on the GPU, shore foam, depth colour, and map.ocean.floatAt for boats). NOT built yet — do not draw them by hand: rivers and lakes, grass, trees, desert dunes, sky and weather, roads and vehicles, aircraft, animals and people. Do not add your own water plane: the ocean is already in map.chunks.group.',
  };
}
