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
// third-party code or asset is used. The generator is ON unless AGENTV3_ATHREE_MAP=off (default on since 2026-11-19; see ToolDispatcher).
//
// PURE builder → the caller writes the files.

import { WATER, OCEAN } from './athreeWaterSource';
import { VEGETATION, PLANTS } from './athreeVegetationSource';
import { RIVERS, RIVERWATER } from './athreeRiverSource';
import { DUNES, SKY } from './athreeSkySource';
import { mapOptionsFor, describeMap, type MapChoice } from './athreeMapKinds';
import { ROADS, ROADMESH } from './athreeRoadSource';
import { VEHICLES } from './athreeVehicleSource';
import { BUDGET } from './athreeBudgetSource';

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

/** The map this project chose (its kind and size), spread into every createAthreeWorld call by the index. Empty is the default world. */
export interface MapOptions {
  mode?: AthreeWorldMode;
  sizeMeters?: number;
  style?: { relief?: number; seaShift?: number; aridity?: number; warmth?: number; rivers?: number };
  roads?: boolean;
}

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
  phone: { chunkSize: 256, viewRadius: 4, nearRes: 32, minRes: 8, maxBuildsPerUpdate: 1, budgetTriangles: 160000 },
  mid: { chunkSize: 256, viewRadius: 6, nearRes: 64, minRes: 8, maxBuildsPerUpdate: 2, budgetTriangles: 480000 },
  desktop: { chunkSize: 256, viewRadius: 10, nearRes: 96, minRes: 12, maxBuildsPerUpdate: 3, budgetTriangles: 1400000 },
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
import { riverNetworkFor, type River, type Lake, type WaterHit } from './rivers';
import { createDunes } from './dunes';
import { roadNetworkFor, type RoadNetwork, type RoadHit, type Region } from './roads';

export type Biome = 'ocean' | 'beach' | 'desert' | 'grassland' | 'forest' | 'mountain' | 'snow';
/** A land a game can lay on part of the map (setLand). */
export type LandBiome = 'beach' | 'desert' | 'forest' | 'mountain' | 'snow';
export type SpawnKind = 'player' | 'vehicle' | 'plane' | 'boat' | 'animal';

export interface AthreeWorldOptions {
  seed?: number;
  profile?: AthreeProfile;
  /** Override the profile's mode. */
  mode?: AthreeWorldMode;
  /** Override the profile's size (loop period, or bounded island diameter), in metres. */
  sizeMeters?: number;
  /** Set false for a world without rivers and lakes. Default true. */
  rivers?: boolean;
  /** Set false for a world without roads, a circuit, runways and village plazas. Default true, except on a map too small to hold one. */
  roads?: boolean;
  /** The character of the land. Every field is optional; the neutral style is the original world, exactly. */
  style?: Partial<AthreeStyle>;
}

/** The knobs that make one map a desert, another a jungle, another an archipelago. All neutral at 0 (relief and rivers at 1). */
export interface AthreeStyle {
  /** Height of the mountains and of the hills, as a multiple (0.2 flat plains .. 2 alpine). */
  relief: number;
  /** Added to the land/sea field: positive is more land, negative is more sea (an archipelago). Range -0.6 .. 0.6. */
  seaShift: number;
  /** Subtracted from moisture: positive dries the land (desert, steppe), negative wets it (jungle, wetland). Range -0.4 .. 0.5. */
  aridity: number;
  /** Added to temperature: positive warms (savanna, jungle), negative cools (tundra). Range -0.5 .. 0.4. */
  warmth: number;
  /** How many rivers rise, as a multiple (0 none .. 3 many). */
  rivers: number;
}

export const NEUTRAL_STYLE: AthreeStyle = { relief: 1, seaShift: 0, aridity: 0, warmth: 0, rivers: 1 };
/** The range each style number may take (the terrain is tested inside it; anything else is held to the nearest edge). */
export const STYLE_RANGE: Record<keyof AthreeStyle, [number, number]> = { relief: [0.2, 2], seaShift: [-0.6, 0.6], aridity: [-0.4, 0.5], warmth: [-0.5, 0.4], rivers: [0, 3] };
export const MIN_WORLD_SIZE = 1000;
export const MAX_WORLD_SIZE = 1000000;

/**
 * How much taller (or lower) the ground is on a map stretched by k = reference / size. Lengths stretch by 1 / k and heights by this, so the
 * SLOPE changes by k * heightStretch(k): at most 1.6 times steeper on the smallest map, and gentler on a bigger one. 1 at k = 1, exactly.
 */
export function heightStretch(k: number): number {
  return k === 1 ? 1 : Math.pow(k, k > 1 ? -0.9 : -0.75);
}

/** A finite number held inside [lo, hi]; anything else (undefined, NaN, a string, Infinity) is the fallback. */
function clampTo(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** The size the terrain functions are written for (a loop of 100 km, an island 8 km across). Any other size is this world, stretched. */
export const REFERENCE_SIZE: Record<AthreeWorldMode, number> = { loop: 100000, bounded: 8000 };
/** Below these a map cannot hold a road network (its regions are 12.5 km and its runways 900 m), so roads default to off. */
export const MIN_ROAD_SIZE: Record<AthreeWorldMode, number> = { loop: 20000, bounded: 6000 };

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
  /** The ground height, with the rivers, lakes and roads carved in (what is drawn, driven and floated on). */
  heightAt(x: number, z: number): number;
  /**
   * Level a rectangle of ground for something flat (a city, a base): one height inside, easing back into the land over the
   * margin. Call it BEFORE the first map.update(), so the terrain is drawn level. Returns the pad's height.
   */
  levelGround(x: number, z: number, halfX: number, halfZ: number, margin?: number): number;
  /** True on levelled ground: nothing grows there. */
  clearAt(x: number, z: number): boolean;
  /**
   * Make a round area of the map a different LAND (a desert, a forest, mountains, snow, a beach) — the colour, the plants and,
   * for mountains, the height follow. Call it BEFORE the first map.update(), like levelGround. Water stays water.
   */
  setLand(x: number, z: number, radius: number, land: LandBiome): void;
  /** Every road, plaza, the race circuit and the runways (regions are built on demand). */
  roadNetwork(): RoadNetwork;
  /** The road under a place (on the paved width), or null. */
  roadAt(x: number, z: number): RoadHit | null;
  /** What a vehicle drives on: the bridge deck on a bridge, the ground elsewhere. */
  drivableHeightAt(x: number, z: number): number;
  /** What a wheel runs on at a place: asphalt on a road, water in a river, lake or the sea, else by biome (grass, sand, snow, rock). */
  surfaceAt(x: number, z: number): 'asphalt' | 'grass' | 'sand' | 'snow' | 'rock' | 'water';
  /** The home region: the race circuit (racing profile), the runways (flight and open-world) and the villages around the world origin. */
  homeRoads(): Region;
  /** How much of a desert a place is, 0 (not at all) to 1 (the heart of one). A continuous version of the desert biome. */
  desertnessAt(x: number, z: number): number;
  /** The height the desert dunes add at a place (zero outside deserts, and within 20 m of water). heightAt already includes it. */
  dunesAt(x: number, z: number): number;
  /** The ground height WITHOUT rivers, lakes and dunes. */
  baseHeightAt(x: number, z: number): number;
  /** The water at a place (surface height, flow direction), or null on dry ground. The sea is not included: it is every place below seaLevel. */
  waterAt(x: number, z: number): WaterHit | null;
  /** Every river (paths, widths, water levels) and lake. Builds the network on first use. */
  waterBodies(): { rivers: River[]; lakes: Lake[] };
  normalAt(x: number, z: number): { x: number; y: number; z: number };
  biomeAt(x: number, z: number): Biome;
  windAt(x: number, z: number, t: number): Wind;
  spawnPoints(kind: SpawnKind, count?: number): Spawn[];
}

const ISLAND_BASE = 0.45;
const ISLAND_SWING = 0.3;

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
  const mode: AthreeWorldMode = options.mode === 'loop' || options.mode === 'bounded' ? options.mode : defaults.mode;
  // NOTHING A GAME PASSES CAN BREAK THE WORLD: a size is a finite number of metres from 1 km to 1000 km, and every style number is held inside
  // the range the terrain was made and tested for (a relief of 50 would be a wall, a NaN would be a hole). At the defaults these are no-ops.
  const sizeMeters = clampTo(options.sizeMeters, MIN_WORLD_SIZE, MAX_WORLD_SIZE, defaults.sizeMeters);
  const seed = (options.seed ?? 1) | 0;
  // ANY SIZE (admin 2026-11-15, "1 km se 1000 km"): the terrain, the rivers and the dunes are written for ONE size (REFERENCE_SIZE) and the
  // world is that world stretched: a place at (x, z) metres is the reference world at (x * k, z * k). Heights stretch less than lengths
  // (a map 10 times wider is 5.6 times taller, not 10; a map 100 times narrower is 63 times lower, which makes its slopes only 1.6 times steeper, so a small map is walkable instead of a wall), and water widths stretch with the plan, so a river
  // on a continent is wide. At the reference size k = 1 and vs = 1, and every number below is exactly what it always was.
  const given: Partial<AthreeStyle> = options.style ?? {};
  const style: AthreeStyle = {
    relief: clampTo(given.relief, STYLE_RANGE.relief[0], STYLE_RANGE.relief[1], NEUTRAL_STYLE.relief),
    seaShift: clampTo(given.seaShift, STYLE_RANGE.seaShift[0], STYLE_RANGE.seaShift[1], NEUTRAL_STYLE.seaShift),
    aridity: clampTo(given.aridity, STYLE_RANGE.aridity[0], STYLE_RANGE.aridity[1], NEUTRAL_STYLE.aridity),
    warmth: clampTo(given.warmth, STYLE_RANGE.warmth[0], STYLE_RANGE.warmth[1], NEUTRAL_STYLE.warmth),
    rivers: clampTo(given.rivers, STYLE_RANGE.rivers[0], STYLE_RANGE.rivers[1], NEUTRAL_STYLE.rivers),
  };
  const refSize = REFERENCE_SIZE[mode];
  const k = refSize / sizeMeters;
  const vs = heightStretch(k);
  const stretched = k !== 1;
  const period = mode === 'loop' ? refSize : 0;
  const radius = refSize / 2;
  const gameRadius = sizeMeters / 2;
  // A bounded island is an arena to play on, so its hills are low and snow never settles; a loop world has real mountains.
  const peak = mode === 'bounded' ? 150 : 1100;
  const mountainLine = mode === 'bounded' ? 150 : 300;
  // Biomes change over a few kilometres on a loop world, and over a few hundred metres on an 8 km arena.
  const biomeScale = mode === 'bounded' ? 6 : 1;
  const snowLine = mode === 'bounded' ? 400 : 650;

  /** The reference world's ground, in the reference world's own metres. */
  function baseInner(x: number, z: number): number {
    const c = fieldNoise(x, z, seed + 1, 5, 14000, period);
    let e = Math.max(-1.2, Math.min(1.2, (c - 0.5) * 3.4 + style.seaShift));
    if (mode === 'bounded') {
      // An island: land inside, a smooth shore, open sea outside the circle.
      const r = Math.hypot(x, z) / radius;
      const m = smoothstep(1, 0.55, r);
      // The island's core must ALWAYS be land: the noise swing (at most 1.2 either way) times ISLAND_SWING stays under ISLAND_BASE, so
      // no seed can drown its own centre (seeds 4, 8, 11 and 14 used to be open sea with the old 0.5 swing over a 0.35 base).
      e = (e * ISLAND_SWING + ISLAND_BASE) * m - (1 - m) * 0.9;
    }
    if (e < 0) return e * 110;
    const ridge = 1 - Math.abs(2 * fieldNoise(x, z, seed + 2, 5, 5000, period) - 1);
    const mountain = ridge * ridge * smoothstep(0.25, 0.7, e) * peak * style.relief;
    const detail = (fieldNoise(x, z, seed + 3, 4, 260, period) - 0.5) * 14 * style.relief * Math.min(1, e * 4);
    return e * 55 * (style.relief >= 1 ? 1 : 0.4 + 0.6 * style.relief) + mountain + detail;
  }

  /** The ground (without rivers, lakes and dunes) at a place in the game's metres. */
  function baseHeight(x: number, z: number): number {
    return stretched ? baseInner(x * k, z * k) * vs : baseInner(x, z);
  }

  const withRivers = options.rivers !== false;
  let network: ReturnType<typeof riverNetworkFor> | null = null;
  const net = (): ReturnType<typeof riverNetworkFor> => {
    if (!network) {
      network = riverNetworkFor(seed + '|' + mode + '|' + refSize + '|' + style.relief + '|' + style.seaShift + '|' + style.rivers, { seed, period, radius: mode === 'bounded' ? radius : 0, baseHeight: baseInner, minSource: mode === 'bounded' ? 12 : 20, density: style.rivers });
    }
    return network;
  };
  // The rivers are traced in the reference world; this is that network in the game's metres.
  const rivers = {
    carve: (x: number, z: number, h: number): number => (stretched ? net().carve(x * k, z * k, h / vs) * vs : net().carve(x, z, h)),
    waterAt: (x: number, z: number): WaterHit | null => {
      const w = net().waterAt(stretched ? x * k : x, stretched ? z * k : z);
      return w && stretched ? { ...w, surface: w.surface * vs, width: w.width / k } : w;
    },
    edgeDistance: (x: number, z: number): number => (stretched ? net().edgeDistance(x * k, z * k) / k : net().edgeDistance(x, z)),
    bodies: (): { rivers: River[]; lakes: Lake[] } => {
      const n = net();
      if (!stretched) return { rivers: n.rivers, lakes: n.lakes };
      if (!scaledBodies) {
        scaledBodies = {
          rivers: n.rivers.map((r) => ({ ...r, points: r.points.map((p) => ({ x: p.x / k, z: p.z / k, surface: p.surface * vs, width: p.width / k })) })),
          lakes: n.lakes.map((l) => ({ ...l, x: l.x / k, z: l.z / k, radius: l.radius / k, level: l.level * vs })),
        };
      }
      return scaledBodies;
    },
  };
  let scaledBodies: { rivers: River[]; lakes: Lake[] } | null = null;

  // Dunes sit on top of the carved ground, and fade out where a river or lake has cut the ground, so a bed is never buried in sand.
  const duneField = createDunes({ seed, period, biomeScale, mountainLine });
  const dunes = {
    desertness: (x: number, z: number, h: number): number => (stretched ? duneField.desertness(x * k, z * k, h / vs) : duneField.desertness(x, z, h)),
    heightAt: (x: number, z: number, h: number): number => (stretched ? duneField.heightAt(x * k, z * k, h / vs) * vs : duneField.heightAt(x, z, h)),
  };

  function desertnessAt(x: number, z: number): number {
    return dunes.desertness(x, z, baseHeight(x, z));
  }

  function dunesAt(x: number, z: number): number {
    const d = dunes.heightAt(x, z, baseHeight(x, z));
    if (d <= 0) return 0;
    // Dunes stop 20 m before any water edge (a mask on the DISTANCE, so a bed is never buried and the ground has no step).
    return withRivers ? d * smoothstep(0, 20, rivers.edgeDistance(x, z)) : d;
  }

  // Cache only immutable procedural samples, never the public mutable river/lake result.
  // One exact world-local coordinate: fixed memory, no rounding or cross-world state.
  let lastHeightX = NaN;
  let lastHeightZ = NaN;
  let lastBase = 0;
  let lastDune = 0;
  function sampleTerrain(x: number, z: number): void {
    if (Object.is(x, lastHeightX) && Object.is(z, lastHeightZ) && Number.isFinite(x) && Number.isFinite(z)) return;
    lastBase = baseHeight(x, z);
    lastDune = dunes.heightAt(x, z, lastBase);
    lastHeightX = x;
    lastHeightZ = z;
  }

  /** Ground with rivers, lakes and dunes before roads carve it. */
  function terrainNoRoads(x: number, z: number): number {
    sampleTerrain(x, z);
    const b = lastBase;
    const d = lastDune;
    const c = withRivers ? rivers.carve(x, z, b) : b;
    if (d <= 0) return c;
    return c + (withRivers ? d * smoothstep(0, 20, rivers.edgeDistance(x, z)) : d);
  }

  const withRoads = options.roads ?? sizeMeters >= MIN_ROAD_SIZE[mode];
  const noRoads: RoadNetwork = {
    regionAt: () => ({ roads: [], sites: [], circuit: null }),
    carve: (_x, _z, h) => h,
    roadAt: () => null,
    drivableHeightAt: (_x, _z, h) => h,
    home: () => ({ roads: [], sites: [], circuit: null }),
    regionsNear: () => [],
  };
  let roadNet: RoadNetwork | null = null;
  const roadsOf = (): RoadNetwork => {
    if (!withRoads) return noRoads;
    if (!roadNet) {
      roadNet = roadNetworkFor(seed + '|' + mode + '|' + sizeMeters + '|' + profile + '|' + (withRivers ? 'r' : 'n') + '|' + style.relief + '|' + style.seaShift + '|' + style.rivers, {
        seed, period: mode === 'loop' ? sizeMeters : 0, radius: mode === 'bounded' ? gameRadius : 0, profile,
        terrain: terrainNoRoads,
        water: (x, z) => { const w = waterAt(x, z); return w ? { surface: w.surface, kind: w.kind } : null; },
      });
    }
    return roadNet;
  };

  // LEVELLED GROUND: a game that puts something flat on the map (a city, a base, an arena) asks for a level pad BEFORE the
  // first frame. Inside the pad the ground is one height; over the margin it eases back into the land, so there is no
  // cliff and no floating slab. Everything that reads heightAt (the drawn terrain, the colliders, plants, vehicles) agrees.
  const pads: Array<{ x: number; z: number; hx: number; hz: number; y: number; margin: number }> = [];
  function naturalHeightAt(x: number, z: number): number {
    const t = terrainNoRoads(x, z);
    return withRoads ? roadsOf().carve(x, z, t) : t;
  }
  // LAND PATCHES (admin 2026-11-21, failedbr #2488: "ek village, ek desert, ek jungle aur ek mountain" became three TOWNS named
  // so). A round area of the map is given another land: biomeAt answers it inside (with a ragged edge, so it is not a circle),
  // and mountains rise out of the ground there. Laid before the first frame, so the terrain, the plants and the colliders agree.
  const lands: Array<{ x: number; z: number; r: number; land: LandBiome }> = [];
  function landAt(x: number, z: number): { land: LandBiome; w: number } | null {
    for (const l of lands) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d >= l.r * 1.25) continue;
      const edge = l.r * (0.85 + 0.3 * fieldNoise(x, z, seed + 31, 2, Math.max(60, l.r / 2), 0));
      if (d <= edge) return { land: l.land, w: 1 - smoothstep(edge * 0.55, edge, d) };
    }
    return null;
  }
  function setLand(x: number, z: number, radius: number, land: LandBiome): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(radius > 0)) return;
    lands.push({ x, z, r: Math.min(4000, Math.max(60, radius)), land });
  }
  function heightAt(x: number, z: number): number {
    let t = naturalHeightAt(x, z);
    if (lands.length) {
      const l = landAt(x, z);
      // Mountains rise from the land (higher towards the middle, ridged by noise), never out of the water.
      if (l && l.land === 'mountain' && t > 2) t += l.w * (mountainLine * 1.6 * vs) * (0.65 + 0.35 * fieldNoise(x, z, seed + 37, 3, 220, 0));
    }
    for (const p of pads) {
      const d = Math.max(Math.abs(x - p.x) - p.hx, Math.abs(z - p.z) - p.hz);
      if (d >= p.margin) continue;
      const w = d <= 0 ? 1 : 1 - smoothstep(0, p.margin, d);
      t += (p.y - t) * w;
    }
    return t;
  }
  function levelGround(x: number, z: number, halfX: number, halfZ: number, margin = 40): number {
    let sum = 0, n = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { sum += naturalHeightAt(x + (i / 2) * halfX, z + (j / 2) * halfZ); n++; }
    const y = Math.max(1.5, sum / n);
    pads.push({ x, z, hx: Math.max(1, halfX), hz: Math.max(1, halfZ), y, margin: Math.max(1, margin) });
    return y;
  }
  function clearAt(x: number, z: number): boolean {
    for (const p of pads) if (Math.abs(x - p.x) <= p.hx + 2 && Math.abs(z - p.z) <= p.hz + 2) return true;
    return false;
  }

  function surfaceAt(x: number, z: number): 'asphalt' | 'grass' | 'sand' | 'snow' | 'rock' | 'water' {
    if (waterAt(x, z) || heightAt(x, z) < 0) return 'water';
    if (withRoads && roadsOf().roadAt(x, z)) return 'asphalt';
    switch (biomeAt(x, z)) {
      case 'ocean': return 'water';
      case 'beach': case 'desert': return 'sand';
      case 'snow': return 'snow';
      case 'mountain': return 'rock';
      default: return 'grass';
    }
  }

  function drivableHeightAt(x: number, z: number): number {
    return roadsOf().drivableHeightAt(x, z, heightAt(x, z));
  }

  function waterAt(x: number, z: number): WaterHit | null {
    return withRivers ? rivers.waterAt(x, z) : null;
  }

  function waterBodies(): { rivers: River[]; lakes: Lake[] } {
    return withRivers ? rivers.bodies() : { rivers: [], lakes: [] };
  }

  function normalAt(x: number, z: number): { x: number; y: number; z: number } {
    const e = 2;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    const len = Math.hypot(dx, 2 * e, dz);
    return { x: -dx / len, y: (2 * e) / len, z: -dz / len };
  }

  function biomeAt(x: number, z: number): Biome {
    const h = heightAt(x, z) / vs;
    if (h < -1) return 'ocean';
    if (lands.length && h >= 0) {
      const l = landAt(x, z);
      if (l && l.w > 0.15) return l.land === 'mountain' && h > snowLine ? 'snow' : l.land;
    }
    if (h < 3) return 'beach';
    const ix = stretched ? x * k : x; const iz = stretched ? z * k : z;
    const moisture = fieldNoise(ix, iz, seed + 4, 4, 9000 / biomeScale, period) - style.aridity;
    const temp = fieldNoise(ix, iz, seed + 5, 3, 16000 / biomeScale, period) - h / 2000 + style.warmth;
    if (h > snowLine || (temp < 0.22 && h > snowLine * 0.6)) return 'snow';
    // A COLD map (tundra) is white at sea level too: snow needs no mountain when the whole land is frozen. A neutral or warm map never gets here.
    if (style.warmth < 0 && temp < 0.2) return 'snow';
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

  /** A 600 m strip, 60 m wide, flat along AND across (a plane neither climbs nor rolls), dry, and above 4 m everywhere. */
  function stripAt(x: number, z: number): boolean {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 12; i++) {
      for (const dz of [-30, 0, 30]) {
        const hh = heightAt(x + i * 50, z + dz);
        if (waterAt(x + i * 50, z + dz)) return false;
        lo = Math.min(lo, hh);
        hi = Math.max(hi, hh);
      }
    }
    return lo > minLand && hi - lo < 4;
  }

  // "On land" means above the beach and below the peaks, in the game's metres: on a map stretched flat (vs < 1) the beach is lower, on a
  // map stretched tall (vs > 1) the peaks are higher. At the reference size these are exactly the 4 m and 140 m they always were.
  // How far from the origin a spawn may be sought on a loop map: 20 km at the reference size, in proportion on a bigger one (on a continent
  // 1000 km across the origin can be sea, and the nearest land is a long way off), and never beyond the map itself.
  const searchReach = Math.min(sizeMeters * 0.45, 20000 * Math.max(1, sizeMeters / 100000));
  const minLand = 4 * Math.min(1, vs);
  const maxLand = 140 * Math.max(1, vs);

  function spawnPoints(kind: SpawnKind, count = 1): Spawn[] {
    const rng = mulberry32(seed ^ kindSalt(kind));
    const searchR = mode === 'bounded' ? gameRadius * 0.9 : searchReach;
    const out: Spawn[] = [];
    if (withRoads && (kind === 'vehicle' || kind === 'plane')) {
      const home = roadsOf().home();
      if (kind === 'vehicle' && home.circuit) {
        // A racing game starts on the grid behind the start line, two abreast, facing the way the circuit runs.
        const road = home.roads[home.circuit.road];
        const n = road.points.length;
        for (let k = 0; k < count && k < 24; k++) {
          const i = (n - 3 - 3 * Math.floor(k / 2) + n * 4) % n;
          const a = road.points[i]; const b = road.points[(i + 1) % n];
          const heading = Math.atan2(b.z - a.z, b.x - a.x);
          const side = (k % 2 === 0 ? -1 : 1) * 3.2;
          const x = a.x - Math.sin(heading) * side; const z = a.z + Math.cos(heading) * side;
          out.push({ x, y: heightAt(x, z), z, heading });
        }
      }
      if (kind === 'plane') {
        // A runway is a strip of the ground cut flat for exactly this: planes start at its west end, facing east.
        for (const road of home.roads) {
          if (road.kind !== 'runway' || out.length >= count) continue;
          const a = road.points[4];
          out.push({ x: a.x, y: heightAt(a.x, a.z), z: a.z, heading: 0, strip: 800 });
        }
      }
      if (out.length >= count) return out;
    }
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
      if (y < minLand || y > maxLand) continue;
      if (waterAt(x, z)) continue; // never spawn in a river or a lake
      if (kind === 'plane') {
        if (stripAt(x, z)) out.push({ x, y, z, heading: 0, strip: 600 });
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
    if (kind === 'plane' && out.length < count) {
      // The random search can miss a strip that exists, and a strip is rare on an island: look at every 100 m before giving up.
      const R = mode === 'bounded' ? gameRadius * 0.9 : Math.min(searchReach, 20000);
      for (let gx = -R; gx <= R && out.length < count; gx += 100) {
        for (let gz = -R; gz <= R && out.length < count; gz += 100) {
          if (out.some((p) => Math.hypot(p.x - gx, p.z - gz) < 150)) continue;
          const gy = heightAt(gx, gz);
          if (gy < minLand || gy > maxLand || !stripAt(gx, gz)) continue;
          out.push({ x: gx, y: gy, z: gz, heading: 0, strip: 600 });
        }
      }
    }
    return out;
  }

  return { seed, profile, mode, sizeMeters, seaLevel: 0, heightAt, surfaceAt, roadNetwork: roadsOf, roadAt: (x, z) => roadsOf().roadAt(x, z), drivableHeightAt, levelGround, clearAt, setLand, homeRoads: () => roadsOf().home(), dunesAt, desertnessAt, baseHeightAt: baseHeight, waterAt, waterBodies, normalAt, biomeAt, windAt, spawnPoints };
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

/**
 * What a game can choose, by the word a user would say. Each is drawn by its own file(s) and none needs another. The core always comes: terrain
 * (noise, config, world, collider, chunks), the rivers, dunes and roads DATA (so height, water, roads, surfaces and spawns work), and the index.
 */
export const ATHREE_OPTIONAL_MODULES: Record<string, { files: string[]; what: string }> = {
  sea: { files: ['water', 'ocean'], what: 'a real wave ocean with shore foam (without it the sea is one flat plane)' },
  plants: { files: ['vegetation', 'plants'], what: 'grass and trees that sway in the wind' },
  rivers: { files: ['riverwater'], what: 'rivers and lakes drawn with flowing water' },
  sky: { files: ['sky'], what: 'sun, moon, stars, clouds, day and night, weather, rain, fog and the scene lights' },
  roads: { files: ['roadmesh'], what: 'roads, the race circuit, runways, plazas and bridges drawn' },
  vehicles: { files: ['vehicles'], what: 'a sports car and a sports bike with their own driving physics' },
};

/** The modules every build gets. */
export const ATHREE_CORE_MODULES: readonly string[] = ['noise', 'config', 'world', 'collider', 'chunks', 'rivers', 'dunes', 'roads', 'index'];

/** Every file this recipe can write. */
export const ATHREE_MAP_MODULES: readonly string[] = ['noise', 'config', 'world', 'collider', 'chunks', 'water', 'ocean', 'vegetation', 'plants', 'rivers', 'riverwater', 'dunes', 'sky', 'roads', 'roadmesh', 'vehicles', 'budget', 'index'];

const SOURCES: Record<string, string> = {
  noise: NOISE, config: CONFIG, world: WORLD, collider: COLLIDER, chunks: CHUNKS, water: WATER, ocean: OCEAN, vegetation: VEGETATION, plants: PLANTS,
  rivers: RIVERS, riverwater: RIVERWATER, dunes: DUNES, sky: SKY, roads: ROADS, roadmesh: ROADMESH, vehicles: VEHICLES, budget: BUDGET,
};

/** The optional modules named in a request: unknown names are reported back, never ignored silently. Undefined means all of them. */
export function chooseAthreeModules(include?: readonly string[]): { chosen: string[]; unknown: string[] } {
  const all = Object.keys(ATHREE_OPTIONAL_MODULES);
  if (include === undefined) return { chosen: all, unknown: [] };
  const wanted = new Set(include.map((m) => String(m).toLowerCase().trim()));
  return { chosen: all.filter((m) => wanted.has(m)), unknown: Array.from(wanted).filter((m) => !all.includes(m) && m !== 'all' && m !== '') };
}

/** The index of a build: the facade, written for exactly the modules chosen (a module that is not there has no member, no import and no option). */
export function athreeIndexSource(chosen: readonly string[], excludedModules: readonly string[] = []): string {
  const has = (m: string): boolean => chosen.includes(m);
  const everything = Object.keys(ATHREE_OPTIONAL_MODULES).every(has);
  const L: string[] = [];
  const add = (...lines: string[]): void => { L.push(...lines); };
  add(
    '// Athree map — the one API a game uses.',
    '// Technique: a thin facade over world + chunks + colliders and the modules the game chose, so racing, battle royale, flight and open-world code all talk to the same object.',
    '',
    "import { createAthreeWorld, type AthreeWorld, type AthreeWorldOptions } from './world';",
    "import { createChunkManager, type ChunkManager } from './chunks';",
    "import { heightfieldFor, type HeightfieldData } from './collider';",
    "import { MAP_OPTIONS, type AthreeQuality } from './config';",
  );
  if (has('sea')) add("import { createOcean, type Ocean } from './ocean';");
  if (has('plants')) add("import { createVegetation, type Vegetation } from './plants';");
  if (has('rivers')) add("import { createRiverWater, type RiverWater } from './riverwater';");
  if (has('sky')) add("import { createSky, type Sky, type SkyOptions } from './sky';");
  if (has('roads')) add("import { createRoadMesh, type RoadMesh } from './roadmesh';");
  add(
    '',
    "export * from './world';",
    "export * from './config';",
    "export * from './noise';",
    "export { heightfieldFor, type HeightfieldData } from './collider';",
    "export { buildChunkGeometry, createChunkManager, type ChunkManager } from './chunks';",
    "export * from './rivers';",
    "export * from './dunes';",
    "export * from './roads';",
  );
  if (has('sea')) add("export * from './water';", "export { createOcean, oceanVertexShader, oceanFragmentShader, type Ocean } from './ocean';");
  if (has('plants')) add("export * from './vegetation';", "export { createVegetation, plantVertexShader, plantFragmentShader, type Vegetation, type VegetationStats } from './plants';");
  if (has('rivers')) add("export { createRiverWater, riverVertexShader, riverFragmentShader, waterInRect, RIVER_TIERS, type RiverWater, type WaterArrays } from './riverwater';");
  if (has('sky')) add("export * from './sky';");
  if (has('roads')) add("export { createRoadMesh, roadsInRect, ROAD_TIERS, ROAD_KIND, roadVertexShader, roadFragmentShader, type RoadMesh, type RoadArrays } from './roadmesh';");
  if (has('vehicles')) add("export * from './vehicles';");
  if (everything) add("export * from './budget';");
  add('', 'export interface AthreeMap {', '  readonly world: AthreeWorld;', '  /** Terrain streaming; present when three.js was given. */', '  readonly chunks: ChunkManager | null;');
  if (has('sea')) add('  /** The sea: waves, shore foam, and what a boat floats on. Present when three.js was given. */', '  readonly ocean: Ocean | null;');
  if (has('plants')) add('  /** Grass and trees: wind-bent, streamed in tiles. Present when three.js was given (and vegetation was not switched off). */', '  readonly vegetation: Vegetation | null;');
  if (has('rivers')) add('  /** Rivers and lakes on screen, and what a boat on them floats on. Present when three.js was given. */', '  readonly riverWater: RiverWater | null;');
  if (has('sky')) add('  /** The sky: sun and moon, clouds, day and night, weather, rain, fog, lights. Present when three.js was given (and the sky was not switched off). */', '  readonly sky: Sky | null;');
  if (has('roads')) add('  /** Roads, the race circuit, runways, village plazas and bridges on screen. Present when three.js was given (and roads were not switched off). */', '  readonly roadMesh: RoadMesh | null;');
  add(
    '  /** Call every frame with the camera in WORLD metres and the time in seconds: streams terrain and moves what the game chose. Returns the origin shift when it re-based. */',
    '  update(cameraX: number, cameraZ: number, time: number, cameraY?: number): { dx: number; dz: number } | null;',
    '  /** Heightfield data for a physics collider over [x0, x0 + size] x [z0, z0 + size]. */',
    '  colliderFor(x0: number, z0: number, size: number, cells: number): HeightfieldData;',
    '  dispose(): void;',
    '}',
    '',
    'export interface AthreeMapOptions extends AthreeWorldOptions {',
    '  quality?: AthreeQuality;',
  );
  if (has('plants')) add('  /** Set false to leave grass and trees out (a flat racing circuit that wants every triangle for the road). Default true. */', '  vegetation?: boolean;');
  if (has('sky')) add('  /** Set false to leave the sky out (you bring your own sky and lights). Default true. */', '  sky?: boolean;', '  /** Time of day, weather, day length and lights for the sky. */', '  skyOptions?: SkyOptions;');
  add(
    "  // import * as THREE from 'three' — omit it to use the world (height, biome, wind, spawn) without drawing.",
    '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
    '  three?: any;',
    '}',
    '',
    'export function createAthreeMap(options: AthreeMapOptions = {}): AthreeMap {',
    excludedModules.some(m => m === 'roads' || m === 'rivers')
      ? '  const world = createAthreeWorld({ ...MAP_OPTIONS, ...options' + (excludedModules.includes('roads') ? ', roads: false' : '') + (excludedModules.includes('rivers') ? ', rivers: false' : '') + ' });'
      : '  const world = createAthreeWorld({ ...MAP_OPTIONS, ...options });',
    "  const quality = options.quality ?? 'mid';",
    // Ordinary sea-module omission retains the legacy flat plane; an explicit sea exclusion suppresses it.
    `  const chunks = options.three ? createChunkManager(options.three, world, quality, 3000, ${has('sea') || excludedModules.includes('sea') ? 'false' : 'true'}) : null;`,
  );
  if (has('sea')) add('  const ocean = options.three ? createOcean(options.three, world, quality) : null;', '  if (chunks && ocean) chunks.group.add(ocean.mesh);');
  if (has('plants')) add('  const vegetation = options.three && options.vegetation !== false ? createVegetation(options.three, world, quality) : null;', '  if (chunks && vegetation) chunks.group.add(vegetation.group);');
  if (has('rivers')) add('  const riverWater = options.three ? createRiverWater(options.three, world, quality) : null;', '  if (chunks && riverWater) chunks.group.add(riverWater.group);');
  if (has('sky')) add('  const sky = options.three && options.sky !== false ? createSky(options.three, world, quality, options.skyOptions) : null;', '  if (chunks && sky) chunks.group.add(sky.group);');
  if (has('roads')) add('  const roadMesh = options.three && options.roads !== false ? createRoadMesh(options.three, world, quality) : null;', '  if (chunks && roadMesh) chunks.group.add(roadMesh.group);');
  const lit = ['sea', 'plants', 'rivers', 'roads'].some(has); // modules that take their light from the sky
  if (has('sky') && lit) add('  const hex = (c: [number, number, number]): number => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);');
  add('  return {', '    world,', '    chunks,');
  if (has('sea')) add('    ocean,');
  if (has('plants')) add('    vegetation,');
  if (has('rivers')) add('    riverWater,');
  if (has('sky')) add('    sky,');
  if (has('roads')) add('    roadMesh,');
  add('    update: (cameraX, cameraZ, time, cameraY = 0) => {', '      const shift = chunks ? chunks.update(cameraX, cameraZ) : null;');
  if (has('sky')) {
    add('      if (sky && chunks) {', '        sky.update(cameraX, cameraZ, time, chunks.origin, cameraY);');
    if (lit) add('        // One sun for everything the game chose: they take their light from the sky.', '        const r = sky.reading();');
    if (has('plants')) add('        vegetation?.setLight(r.sun, hex(r.colors.sun), hex(r.colors.ambient));');
    if (has('sea')) add('        ocean?.setLight(r.sun, hex(r.colors.horizon));');
    if (has('rivers')) add('        riverWater?.setLight(r.sun, hex(r.colors.horizon));');
    if (has('roads')) add('        roadMesh?.setLight(r.sun, hex(r.colors.sun), hex(r.colors.ambient));');
    add('      }');
  } else add('      void cameraY;');
  if (!['sea', 'plants', 'rivers', 'sky'].some(has)) add('      void time;');
  if (has('sea')) add('      if (ocean && chunks) ocean.update(cameraX, cameraZ, time, chunks.origin);');
  if (has('plants')) add('      if (vegetation && chunks) vegetation.update(cameraX, cameraZ, time, chunks.origin);');
  if (has('rivers')) add('      if (riverWater && chunks) riverWater.update(cameraX, cameraZ, time, chunks.origin);');
  if (has('roads')) add('      if (roadMesh && chunks) roadMesh.update(cameraX, cameraZ, chunks.origin);');
  const disposers = ['chunks?.dispose();'];
  if (has('sea')) disposers.push('ocean?.dispose();');
  if (has('plants')) disposers.push('vegetation?.dispose();');
  if (has('rivers')) disposers.push('riverWater?.dispose();');
  if (has('sky')) disposers.push('sky?.dispose();');
  if (has('roads')) disposers.push('roadMesh?.dispose();');
  add('      return shift;', '    },', '    colliderFor: (x0, z0, size, cells) => heightfieldFor(world, x0, z0, size, cells),', `    dispose: () => { ${disposers.join(' ')} },`, '  };', '}', '');
  return L.join('\n');
}

/** Every file of a build for the modules chosen. */
export function mapOptionsSource(choice?: MapChoice | null): string {
  const o = choice ? mapOptionsFor(choice) : null;
  const body = o ? JSON.stringify({ mode: o.mode, sizeMeters: o.sizeMeters, style: o.style }, null, 2) : '{}';
  return '\n/** ' + (choice ? describeMap(choice).replace(/\*\//g, '') : 'The default world (a 100 km loop).') + ' */\nexport const MAP_OPTIONS: MapOptions = ' + body + ';\n';
}

export function athreeFiles(chosen: readonly string[], excludedModules: readonly string[] = [], choice?: MapChoice | null): Record<string, string> {
  const files: Record<string, string> = {};
  const names = new Set<string>(ATHREE_CORE_MODULES.filter((m) => m !== 'index'));
  for (const m of chosen) for (const f of ATHREE_OPTIONAL_MODULES[m].files) names.add(f);
  if (Object.keys(ATHREE_OPTIONAL_MODULES).every((m) => chosen.includes(m))) names.add('budget');
  for (const name of ATHREE_MAP_MODULES) if (names.has(name)) files[`${DIR}/${name}.ts`] = SOURCES[name];
  files[`${DIR}/config.ts`] = SOURCES.config + mapOptionsSource(choice);
  files[`${DIR}/index.ts`] = athreeIndexSource(chosen, excludedModules);
  return files;
}

const RULE_CORE = 'Rules: positions you give THREE are WORLD metres minus `map.chunks.origin` (the floating origin re-bases past 3 km; update() returns the shift when it does — move your own objects by it). The terrain is OFF in the build unless the Athree map is switched on. The world is always there: terrain, biomes, wind, spawns, heightfield colliders, desert dunes (heightAt includes them; map.world.dunesAt and desertnessAt say where; about a third of a desert is a flat hardpan; dunes stop 20 m before water), rivers and lakes as DATA (map.world.waterBodies() lists every river path with its width and water level and every lake; map.world.waterAt(x, z) tells whether a place is in a river or a lake; the terrain is carved so the bed is real; rivers always end in the sea, a lake or another river; the water level only goes down along a river; nothing grows or spawns in the water; pass rivers: false for a world without them), roads as DATA (map.world.homeRoads() gives the villages, highways and, for the racing profile, the closed banked race circuit with checkpoints, and runways; spawnPoints with kind vehicle grids the cars behind the circuit start line and with kind plane starts planes on a runway; highways never climb more than 7 percent, cross every river on a bridge deck 3.5 m above the water and never enter a lake or the sea; the ground is cut and filled to the road, so heightAt IS the road surface; a bridge deck is NOT in heightAt: use map.world.drivableHeightAt; roads are made region by region (12.5 km) as you travel, with no junctions; pass roads: false for a world without them) and map.world.surfaceAt (what a wheel runs on).';
const RULE_BY_MODULE: Record<string, string> = {
  sea: 'SEA: a real wave ocean (Gerstner waves shaded and displaced on the GPU, shore foam, depth colour) and map.ocean.floatAt for boats. Do not add your own water plane: the ocean is already in map.chunks.group.',
  plants: 'PLANTS: grass and trees (map.vegetation: broadleaf, conifer and palm trees with leaves that flutter, grass that sways with the shared wind, placed by biome and slope, streamed in tiles, three levels of budget per quality tier). Trees are visual only: they have no collider yet, so a car drives through them (treesInRect(world, x0, z0, x1, z1) gives the trunk positions if you need to keep clear of them); pass vegetation: false to leave plants out; call map.vegetation.setLight(sunDirection, sunColor, ambientColor) to match your scene light. Do not scatter your own grass or trees over the map.',
  rivers: 'RIVERS: map.riverWater draws the rivers and lakes with a flowing-water shader and gives boats floatAt; they are visible out to a few hundred metres to about a kilometre depending on the quality tier (beyond that the terrain mesh is too coarse to hold a river bed). Do not draw your own rivers or lakes.',
  sky: 'SKY: map.sky gives the sun and moon by time of day, stars, clouds carried by the shared wind, day and night, weather clear/cloudy/rain/storm/fog easing from one to the next, rain streaks, lightning, fog, and its own sun and sky lights; map.sky.applyTo(scene) puts the fog and background on your scene; pass skyOptions {hours, weather, dayLength, auto, lights}; sky: false if you bring your own. The sky takes over the scene lights: do not add your own sun or hemisphere light unless you pass skyOptions {lights: false}. Do not draw your own sky.',
  roads: 'ROADS DRAWN: map.roadMesh draws asphalt with lane markings, kerbs, a start line, runway markings, plazas, bridge decks, rails and piers. Do not draw your own roads.',
  vehicles: 'VEHICLES: createVehicle(THREE, map.world, {kind: car or bike, color, quality}) gives a lofted sports car or bike with four or two wheels that spin and steer, brake lights, headlights (setLights) and its own driving physics: engine that fades with speed, braking limited by the surface, steering that narrows with speed, a grip limit, a handbrake slide, pitch and roll from the ground, flight off a crest, water that stops it; you call vehicle.update(dt, {throttle -1..1, steer -1..1, brake 0..1, handbrake}, map.chunks.origin) every frame and read vehicle.state (speed, slip, position). Vehicles do not collide with trees or other vehicles yet.',
};
const NOT_BUILT = 'NOT built yet — do not draw them by hand: buildings, animals, birds and people, sand ripple textures and heat haze. A plane to fly comes from the game kit (createAircraft / flyAircraft in three/flight.ts).';

function exampleSource(chosen: readonly string[]): string {
  const has = (m: string): boolean => chosen.includes(m);
  const L: string[] = [];
  L.push("import * as THREE from 'three';");
  L.push(`import { createAthreeMap${has('vehicles') ? ', createVehicle' : ''} } from './game/athree';`);
  L.push('', 'const scene = new THREE.Scene();', 'const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 6000);');
  L.push(`const map = createAthreeMap({ seed: 7, profile: 'racing', quality: 'mid', three: THREE });`, 'scene.add(map.chunks!.group);');
  L.push("const spawn = map.world.spawnPoints('vehicle')[0]; // a flat, dry, safe place (on the circuit grid in a racing world)");
  if (has('vehicles')) L.push("const car = createVehicle(THREE, map.world, { kind: 'car', color: 0xc8102e, quality: 'mid' }); // or kind: 'bike'; starts at the spawn point", 'scene.add(car.group);');
  L.push('let time = 0;', '', 'export function frame(dt: number): void {', '  time += dt;');
  L.push('  const shift = map.update(spawn.x, spawn.z, time); // every frame: streams terrain and moves what you chose; builds a few chunks per call');
  L.push("  // When `shift` is not null the render origin moved: subtract it from your own objects' positions.");
  L.push('  const y = map.world.heightAt(spawn.x, spawn.z); // the same height the terrain is drawn at');
  L.push('  const wind = map.world.windAt(spawn.x, spawn.z, time); // one wind field for the sea state, the grass, the leaves and the clouds');
  const voids = ['shift', 'wind', 'hf'];
  if (has('sea')) { L.push('  const boat = map.ocean!.floatAt(spawn.x, spawn.z, time); // the sea surface a boat floats on: y and a unit normal'); voids.push('boat'); }
  if (has('plants')) { L.push('  const plants = map.vegetation!.stats(); // trees, tufts, triangles and draw calls drawn right now'); voids.push('plants'); }
  if (has('rivers')) { L.push('  const river = map.riverWater!.floatAt(spawn.x, spawn.z); // null on dry land; on a river or lake: the water level and flow direction'); voids.push('river'); }
  if (has('sky')) {
    L.push("  map.sky!.setTimeOfDay(17.5); map.sky!.setWeather('rain'); // sun, moon, stars, clouds, fog, rain and the scene lights, all driven by the sky");
    L.push('  const sound = map.sky!.ambience(spawn.x, spawn.z); // levels 0 to 1 (wind, rain, thunder, night, waves, birds) for YOUR audio'); voids.push('sound');
  }
  L.push('  const road = map.world.roadAt(spawn.x, spawn.z); // null off the road; on it: which road, how far along, the surface height, whether on a bridge');
  L.push('  const driveY = map.world.drivableHeightAt(spawn.x, spawn.z); // what a vehicle drives on: the bridge deck on a bridge, the ground elsewhere');
  voids.push('road', 'driveY');
  if (has('vehicles')) L.push('  car.update(dt, { throttle: 1, steer: 0, brake: 0, handbrake: false }, map.chunks!.origin); // YOUR input: a sports car with its own driving physics');
  L.push('  const hf = map.colliderFor(0, 0, 256, 64); // heights for a physics heightfield collider');
  L.push('  camera.position.set(spawn.x - map.chunks!.origin.x, y + 6, spawn.z - map.chunks!.origin.z);');
  L.push(`  ${voids.map((v) => 'void ' + v + ';').join(' ')}`, '}');
  return L.join('\n');
}

export function generateAthreeMap(include?: string[], choiceOrExclusions?: MapChoice | null | readonly string[], exclusions: readonly string[] = []): AthreeMapResult {
  const excludedModules: readonly string[] = Array.isArray(choiceOrExclusions) ? choiceOrExclusions : exclusions;
  const choice = Array.isArray(choiceOrExclusions) ? null : choiceOrExclusions as MapChoice | null | undefined;
  const { chosen: requested, unknown } = chooseAthreeModules(include);
  const chosen = requested.filter(m => !excludedModules.includes(m));
  const files = athreeFiles(chosen, excludedModules, choice);
  const left = Object.keys(ATHREE_OPTIONAL_MODULES).filter((m) => !chosen.includes(m));
  const what = chosen.map((m) => ATHREE_OPTIONAL_MODULES[m].what);
  return {
    files,
    dependencies: [{ name: 'three', version: '0.180.0' }],
    instructions:
      (choice ? `THE MAP CHOSEN FOR THIS GAME: ${describeMap(choice)}. Recorded in MAP_OPTIONS; retain it unless explicitly changing the map.\n` : '') +
      `Added the Athree map (${Object.keys(files).length} files under ${DIR}). It is the world to stand on: seeded terrain that streams in around the camera, a 100 km seamless loop or a bounded island, shared height/biome/wind/spawn functions, desert dunes, rivers, roads and heightfield data for physics` + (what.length ? `, and the modules you chose: ${what.join('; ')}` : '') + '.\n' +
      (left.length ? `Modules NOT in this build (ask for them, and add them, if the game needs them): ${left.map((m) => m + ' (' + ATHREE_OPTIONAL_MODULES[m].what + ')').join('; ')}.\n` : '') +
      (unknown.length ? `Unknown module names ignored: ${unknown.join(', ')}. The names are: ${Object.keys(ATHREE_OPTIONAL_MODULES).join(', ')}.\n` : '') +
      '```ts\n' + exampleSource(chosen) + '\n```\n' +
      (excludedModules.includes('sea') ? 'Sea visuals, including the fallback water plane, are disabled. Terrain still retains sea-level biome data; this is not a certified dry-land-only world. ' : '') +
      (excludedModules.some(m => m === 'roads' || m === 'rivers') ? 'Explicit request exclusions: ' + excludedModules.filter(m => m === 'roads' || m === 'rivers').join(', ') + ' are disabled in world data as well as rendering; do not re-enable them. ' : '') + RULE_CORE + ' ' + chosen.map((m) => RULE_BY_MODULE[m]).join(' ') + (chosen.includes('sky') ? '' : ' No sky is in this build, so bring your own lights (a DirectionalLight for the sun and a HemisphereLight) and your own background colour.') + ' ' + NOT_BUILT,
  };
}
