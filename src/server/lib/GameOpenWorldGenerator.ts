import { varietySeed } from './projectVariety';

// THE OPEN-WORLD STARTER (failedbr #2485, 2026-11-21 — admin: "is game me to map aya hi nahi, bas ek character aya … jo
// joystick se hawa me move kar raha hai … library ka use kyu nahi ho raha, hona chahiye").
//
// 🔑 ROOT CAUSE. The platform laid down BOTH the big map (generate_athree_map) and the game shell (the player, the camera,
// the joystick) — and nothing joined them. The map streams terrain around a camera and re-bases its render origin; the
// character controller walks on collider meshes; a city is built flat at y = 0. Joining the three (a walkable ground from
// the map's height function, a floating origin for everything the game adds, ground levelled under a city) was left to the
// builder's first turn. A weak builder wrote its own game instead, 70 steps of it, and the user got a character walking on
// the controller's implicit y = 0 with no world under it. 🧬 THE CLASS: two kit layers that only work together, shipped with
// no code between them. The join is kit code now, tested in a real browser, and the starter is playable as it stands:
// a builder that adds nothing still delivers a character in a city on the big map.
/** The shape every game recipe returns (gameRecipeLayers.RecipeOutput), with its instructions. */
interface RecipeOutput { files: Record<string, string>; dependencies?: Array<{ name: string; version: string }>; instructions: string }

import { GAME_PLAYER_BODY, GAME_PLAYER_BODY_PATH, GAME_PLAYER_FILE, GAME_PLAYER_FILE_PATH } from './GamePlayerBodyGenerator';
import { GAME_WORLD_LAYER, WORLD_LAYER_PATH } from './GameWorldLayerGenerator';

export const GAME_OPEN_WORLD_BRIDGE = String.raw`// THE BRIDGE BETWEEN THE BIG MAP AND THE GAME — the player, the camera and everything the game adds stand ON the Athree
// world. The map streams terrain around the player and re-bases its render origin far from the start; the character
// controller walks on collider meshes. This module joins the two: a small invisible ground mesh, sampled from the map's own
// height function, follows the player (so feet meet exactly the ground that is drawn), the sea is water to swim in, and an
// origin shift moves the player and every anchored object together. Use createOpenWorld() in setup() and world.frame() in
// update(); place your own things with world.place(object, x, z).
import * as THREE from 'three';
import type { GameContext } from '../Game';
import { markWorldCollider } from '../three/collision';
import { createAthreeMap, type AthreeMap, type AthreeMapOptions } from '../athree';
import type { LandBiome } from '../athree/world';
import { createCity, planCity, type City, type CityOptions, type CityPlan } from '../three/city';
import { createCityTraffic, type CityTraffic, type CityTrafficOptions } from '../three/citytraffic';
import { createCityPeople, type CityPeople, type CityPeopleOptions } from '../three/citypeople';
import { createCar } from '../three/objects';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { softwareRenderer } from '../three/surfaces';
import { geometryTier } from '../three/surfaces';
import { settings } from '../core/settings';
import { localLowestY } from '../three/surfaces';
import { restOriginY } from '../three/groundContact';
import { setWorldMapSource, placeName, type WorldMapPlace } from '../ui/worldMap';

export interface OpenWorldOptions extends Omit<AthreeMapOptions, 'three'> {
  /** Side of the walkable ground patch kept under the player, in metres. Default 96. */
  patchSize?: number;
  /**
   * How many cities stand built at once (a grown city counts once; the first place, where the player starts, always stays).
   * Left out: the device's share — LIVE_CITIES[quality, else deviceTier()], phone 2, mid 5, desktop 8. Walking on to a new place frees the
   * farthest city already out of view (CITY_HIDE metres past its edge, the same distance at which it is no longer drawn); a city still
   * in view is never taken down, and the new place still appears. It is built again when the player comes back. false: every city reached stays built (the old way).
   */
  liveCities?: number | false;
  /**
   * A city on the map, on ground levelled for it near the start: streets, crossings, pavements, shops, apartments, offices,
   * houses and parks, with traffic that obeys the lights and people who cross on the zebras. true for the default city;
   * false (default) for open country only. The player starts on one of its streets.
   */
  city?: boolean | RegionCity;
  /**
   * MORE PLACES ON THE MAP — how the world grows. Each entry is a city, a town or a village standing on its own levelled
   * ground, spread out across the map with open country between them. Add an entry to make the map bigger; never edit
   * the others. The first place (city, or regions[0]) is where the player starts. Up to 1000 (places and lands together):
   * only the cities near the player are built, so a long list is a big universe, not a slow start.
   */
  regions?: WorldRegion[];
  /**
   * HOW FAR THE PLACES SPREAD, in metres (admin 2026-11-22, failedbr #2495: "map ko 40km*40km banao"). The places and lands
   * that do not name a distance are laid across a square this many metres wide around the first place, instead of next to
   * each other — open country between them, joined by highways. Left out: each place stands close to the others (PLACE_GAP).
   * Clamped to 1 km .. 1000 km; a loop world is never smaller than the spread (sizeMeters is raised to it when needed).
   */
  spreadMeters?: number;
}

export type RegionCity = CityOptions & { traffic?: CityTrafficOptions | false; people?: CityPeopleOptions | false; parkedCars?: number };
export type RegionKind = 'city' | 'town' | 'village' | LandKind | 'custom' | 'venue';
/** A SPORTS GROUND OR VENUE on the map: full size, on its own level pad, with its markings (map expansion item 6). */
export type VenueKind = 'cricket-ground' | 'football-field' | 'stadium' | 'race-circuit' | 'arena';
/**
 * The standard size of each venue (metres): the ground itself (width along x, depth along z) and the pad it stands on.
 * Cricket: a 68 m boundary around a 20.12 m pitch. Football: a 105 × 68 m pitch. Stadium: that pitch with stands. Race circuit: a
 * 12 m track, 400 m straights and 100 m bends. Arena: a 60 × 40 m floor with walls.
 */
export const VENUE_SIZES: Record<VenueKind, { width: number; depth: number }> = {
  'cricket-ground': { width: 150, depth: 150 },
  'football-field': { width: 115, depth: 78 },
  stadium: { width: 150, depth: 118 },
  'race-circuit': { width: 624, depth: 224 },
  arena: { width: 70, depth: 50 },
};
export function isVenueKind(v: unknown): v is VenueKind { return typeof v === 'string' && v in VENUE_SIZES; }
/**
 * A LAND, not a settlement: a desert, a jungle, mountains, snow, a beach or an open grass field (a maidan, a meadow) laid on
 * part of the map (no buildings).
 */
export type LandKind = 'desert' | 'jungle' | 'mountain' | 'snow' | 'beach' | 'grassland';
// 'grassland' is named through LandBiome so that this file still compiles beside an older athree/world.ts: its biomeAt already
// answers 'grassland' for the patch, so the ground is grass there either way (the newer world also keeps trees out of it).
const LAND_BIOME: Record<LandKind, LandBiome> = { desert: 'desert', jungle: 'forest', mountain: 'mountain', snow: 'snow', beach: 'beach', grassland: 'grassland' as LandBiome };
export function isLandKind(kind: unknown): kind is LandKind { return typeof kind === 'string' && kind in LAND_BIOME; }
/** How many places and lands one map holds (admin 2026-11-22: "10—100 maps … bahut bada universe"; owner decision 2026-11-23: 1,000). */
export const MAX_REGIONS = 1000;
/** A planned place's city is built when the player comes this many metres from its edge. */
export const BUILD_AHEAD = 1500;
/**
 * The open country kept between two places, edge to edge, in metres (failedbr #2499: "maps thode pas pas rahe, aur beech me
 * road ho"): a village keeps about 150 m, a big city up to 300 m — a short drive on the road between them.
 */
export const PLACE_GAP = { min: 150, max: 300 } as const;
/** How many cities stand built at once, by the map's quality tier (owner decision 2026-11-23: phone 2, mid 5, desktop 8). */
export const LIVE_CITIES = { phone: 2, mid: 5, desktop: 8 } as const;
/** A standing city is freed for a nearer one only when it is this many metres farther from the player — never back and forth. */
export const LIVE_MARGIN = 300;
/** Metres past a city's edge at which it is no longer drawn. A city closer than this is still in view and is never taken down. */
export const CITY_HIDE = 2600;
/**
 * Which share of cities this device gets (the map's own drawing tier is left as it is): a browser with no GPU or a finger
 * for a pointer is a phone; 8+ cores (and 8+ GB where the browser says) is a desktop; anything else, or anything unknown, mid.
 */
export function deviceTier(): keyof typeof LIVE_CITIES {
  try {
    if (softwareRenderer()) return 'phone';
    if (typeof window === 'undefined') return 'mid';
    if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return 'phone';
    const nav = (typeof navigator !== 'undefined' ? navigator : {}) as { hardwareConcurrency?: number; deviceMemory?: number };
    if ((nav.hardwareConcurrency ?? 0) >= 8 && (nav.deviceMemory === undefined || nav.deviceMemory >= 8)) return 'desktop';
  } catch { /* unknown: mid */ }
  return 'mid';
}
export type Compass = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';
export interface WorldRegion {
  /** A short unique name: 'old-town', 'harbour', 'hill-village'. */
  id: string;
  /** The name the map writes on it ("Mumbai", "Rampur"). Left out: made from the id ('old-town' is "Old Town"). */
  name?: string;
  kind: RegionKind;
  /** Which way from the first place. Left out: the places spread around by themselves. */
  toward?: Compass;
  /** How far from the first place, in metres. Left out: the nearest free spot beside the places already there, a short drive away. */
  distance?: number;
  /** Change this place: { blocksX, blocksZ, style, maxFloors, traffic: { count }, people: { count }, parkedCars }. */
  city?: RegionCity;
  /** A land region only: how far it reaches from its centre, in metres (default 450). */
  radius?: number;
  /**
   * GROW A CITY: the id of a city (or of another tile of it) this one joins edge to edge — the same streets carried on, the
   * same ground level, one continuous bigger city. Without toward, it takes a free side of the city at random.
   * A LAND (desert, jungle, mountain, snow, beach) with joinTo lies right against that place or land — no strip of plain
   * country and no highway between them — on the side toward says, else the first free dry side.
   */
  joinTo?: string;
  /**
   * A MAP THE USER GAVE (kind 'custom'): the file name of their model in public/models ("kan" or "public/models/kan.glb") —
   * any .glb/.gltf/.obj they attached lands there. It stands on its own levelled ground, sized to size metres across.
   */
  model?: string;
  /** A user map only: how wide it stands, in metres (default 400). A venue: how long its longer side is (default: its standard size). */
  size?: number;
  /** A venue only (kind 'venue'): which one. */
  venue?: VenueKind;
}

/** A user's own map on the world (a 'custom' region): where it stands, and the model it loads when the player comes near. */
export interface OpenWorldUserMap {
  readonly id: string;
  readonly model: string;
  readonly centre: { x: number; y: number; z: number };
  readonly size: number;
  /** 'waiting' until the player comes near, then 'loaded' — or 'failed' with the reason (a missing or unreadable file). */
  readonly status: 'waiting' | 'loading' | 'loaded' | 'failed';
  readonly reason?: string;
}

/** A land on the map (a desert, a jungle, mountains, snow, a beach) — no buildings, just the land itself. */
export interface OpenWorldLand {
  readonly id: string;
  readonly kind: LandKind;
  /** Its centre in WORLD metres, and how far it reaches. */
  readonly centre: { x: number; z: number };
  readonly radius: number;
  /** A land laid against another place or land (its joinTo): the id it stands against. */
  readonly joinedTo?: string;
}
/** A sports ground or venue on the map, on its own level pad. Its own numbers (toWorld) are in VENUE metres, centred on it. */
export interface OpenWorldVenue {
  readonly id: string;
  readonly venue: VenueKind;
  /** Its centre in WORLD metres, and the height of its level ground. */
  readonly centre: { x: number; y: number; z: number };
  /** The ground's size in metres: width along x, depth along z (the pad it stands on). */
  readonly width: number;
  readonly depth: number;
  /** A venue laid beside a place or land (its joinTo): the id it stands beside. */
  readonly joinedTo?: string;
  /** Drawn yet (it is drawn when the player first comes near). */
  readonly built: boolean;
  /** A VENUE point (0, 0 is its centre, in its standard metres) as a WORLD place on its level ground. */
  toWorld(x: number, z: number): { x: number; y: number; z: number };
}
const COMPASS: Record<Compass, number> = { north: 0, 'north-east': Math.PI / 4, east: Math.PI / 2, 'south-east': (3 * Math.PI) / 4, south: Math.PI, 'south-west': (5 * Math.PI) / 4, west: (3 * Math.PI) / 2, 'north-west': (7 * Math.PI) / 4 };
/**
 * 🧭 A DIRECTION AS A REGION MAY WRITE IT ('north-east', 'northeast', 'North East', 'NE') — or undefined when it is none.
 * failedbr #2499: a direction outside the list made COMPASS[toward] undefined, the place's spot NaN, and its NaN pad made the
 * map's ground NaN everywhere — every city hung in the sky as a flat layer over the sea. Read once, where the list enters.
 */
const COMPASS_ALIASES: Record<string, Compass> = {
  n: 'north', north: 'north', ne: 'north-east', northeast: 'north-east', e: 'east', east: 'east', se: 'south-east', southeast: 'south-east',
  s: 'south', south: 'south', sw: 'south-west', southwest: 'south-west', w: 'west', west: 'west', nw: 'north-west', northwest: 'north-west',
};
export function compassOf(value: unknown): Compass | undefined {
  return typeof value === 'string' ? COMPASS_ALIASES[value.toLowerCase().replace(/[^a-z]/g, '')] : undefined;
}
/** A region as the kit reads it: its direction one of the eight (or left out, and said), its distance a finite number of metres (or left out, and said). */
export function cleanRegion(region: WorldRegion): WorldRegion {
  if (!region || typeof region !== 'object') return region;
  let out = region;
  if (region.toward !== undefined) {
    const way = compassOf(region.toward);
    if (way !== region.toward) {
      const { toward: _bad, ...rest } = out;
      out = way ? { ...rest, toward: way } : rest;
      if (!way) console.error('[world] "' + String(region.id) + '" asks to lie toward "' + String(region.toward) + '", which is not a direction (north, north-east, east, south-east, south, south-west, west, north-west); it was laid without one.');
    }
  }
  if (region.distance !== undefined) {
    const far = Number(region.distance);
    if (!(Number.isFinite(far) && far >= 0)) {
      const { distance: _bad, ...rest } = out;
      out = rest;
      console.error('[world] "' + String(region.id) + '" asks for a distance of "' + String(region.distance) + '", which is not a number of metres; it was laid without one.');
    } else if (far !== region.distance) out = { ...out, distance: far };
  }
  return out;
}
const REGION_PRESETS: Record<'city' | 'town' | 'village', { city: CityOptions; traffic: number; people: number; parkedCars: number }> = {
  city: { city: { blocksX: 4, blocksZ: 4, style: 'mixed' }, traffic: 12, people: 30, parkedCars: 4 },
  town: { city: { blocksX: 3, blocksZ: 3, style: 'town', maxFloors: 4 }, traffic: 6, people: 16, parkedCars: 3 },
  village: { city: { blocksX: 2, blocksZ: 2, style: 'town', maxFloors: 2, parks: 0.3 }, traffic: 2, people: 8, parkedCars: 1 },
};
/** The seed every map had before each game got its own (WORLD.seed: 7). A map with it keeps exactly the places it had. */
export const LEGACY_WORLD_SEED = 7;
/**
 * 🎲 A PLACE'S OWN LOOK, FIXED BY THE MAP (external Game Maker audit, 2026-11-25: six new games must not all stand in the
 * same city). Every place used to get seed 11 + 17n whatever the map, so every game's first city had the same buildings on
 * the same lots. Now the place's seed (its lots, buildings and traffic paint) and, for a city that asks for no style, its
 * style (mixed or downtown) come from the map's own seed (WORLD.seed, written once into the game's src/game/world.ts) and
 * the place's position in the list — the same map always has the same places, so an edit never changes them, and a map on
 * the old seed 7 keeps exactly what it had. PURE.
 */
export function placeLook(worldSeed: unknown, kind: RegionKind, n: number): { seed: number; style?: CityOptions['style'] } {
  const base = 11 + n * 17;
  const s = Math.floor(Number(worldSeed));
  if (!Number.isFinite(s) || s === LEGACY_WORLD_SEED) return { seed: base };
  const mixed = (Math.imul((s ^ (s >>> 16)) >>> 0, 0x45d9f3b) + Math.imul(base, 0x9e3779b1)) >>> 0;
  return { seed: (mixed % 999999937) + 1, ...(kind === 'city' ? { style: (mixed >>> 7) % 2 ? 'downtown' as const : 'mixed' as const } : {}) };
}
/** How far along the parked-car paints a map starts (0 on the old seed 7, so old maps keep their cars). PURE. */
export function parkedPaintShift(worldSeed: unknown, paints: number): number {
  const s = Math.floor(Number(worldSeed));
  if (!Number.isFinite(s) || s === LEGACY_WORLD_SEED || paints < 1) return 0;
  return (Math.imul((s ^ (s >>> 13)) >>> 0, 0x2c1b3c6d) >>> 0) % paints;
}

/** The city standing on the map. Its own numbers (plan, routes, lots) are in CITY metres: use toWorld() to leave it. */
export interface OpenWorldCity {
  readonly id: string;
  readonly kind: RegionKind;
  /** Roughly how far the place reaches from its centre, in metres. */
  readonly radius: number;
  readonly city: City;
  readonly traffic: CityTraffic | null;
  readonly people: CityPeople | null;
  /** The city's centre in WORLD metres, and the height of its ground. */
  readonly centre: { x: number; y: number; z: number };
  /** Parked cars the player can get into (already given to ctx.vehicles). */
  readonly parked: THREE.Object3D[];
  /** A CITY point (plan.lots, city.route …) as a WORLD place. */
  toWorld(x: number, z: number): { x: number; z: number };
}

export interface OpenWorld {
  readonly map: AthreeMap;
  /** The first place (where the player starts), or null in open country. */
  readonly city: OpenWorldCity | null;
  /**
   * The places whose city stands built now (see places for all of them). Only the nearest few stand at once (liveCities):
   * a place the player left out of view is taken off this list and built again when they come back. A city still in view is never taken down.
   */
  readonly regions: OpenWorldCity[];
  /** Every land on the map (desert, jungle, mountain, snow, beach regions), in the order listed. */
  readonly lands: OpenWorldLand[];
  /** The user's own maps on the world ('custom' regions), each loaded when the player comes near it. */
  readonly userMaps: ReadonlyArray<OpenWorldUserMap>;
  /** The sports grounds and venues on the map ('venue' regions), each drawn when the player first comes near it. */
  readonly venues: ReadonlyArray<OpenWorldVenue>;
  /** The highways joining every place and land (centre lines in WORLD metres, with their heights). */
  readonly highways: ReadonlyArray<ReadonlyArray<{ x: number; y: number; z: number }>>;
  /**
   * EVERY place on the map, built or not, in the order listed. regions holds the places whose city has been built so far:
   * the first at once, the others as the player comes near (so a map of a hundred places starts as fast as a map of one).
   */
  readonly places: ReadonlyArray<{ id: string; kind: RegionKind; centre: { x: number; z: number }; radius: number; /** Its streets and blocks, in CITY metres around centre (built or not). */ readonly plan: CityPlan; readonly built: boolean }>;
  /** The place the player is in or nearest to, and how far its centre is. null in a world with no places. */
  nearestRegion(): { region: OpenWorldCity; distance: number } | null;
  /** Where the player starts: WORLD metres. */
  readonly spawn: { x: number; y: number; z: number };
  /** The player's position in WORLD metres (what the map's own functions take). */
  playerWorld(): { x: number; y: number; z: number };
  /** Ground height at a WORLD place — the same height the terrain is drawn at. */
  heightAt(x: number, z: number): number;
  /** Put an object on the ground at a WORLD place (lift = metres above it). It then follows origin shifts by itself. */
  place(object: THREE.Object3D, x: number, z: number, lift?: number): void;
  /** Stop tracking an object placed with place(). */
  release(object: THREE.Object3D): void;
  /** Call once per update(): streams the map, keeps the ground under the player, applies origin shifts. */
  frame(ctx: GameContext, delta: number): void;
  dispose(): void;
}

/** Where a user's map file is served from: a bare name is public/models/<name>.glb; a path is used as given (without public/). */
export function userMapUrl(model: string): string {
  const m = String(model || '').trim().replace(/^\/+/, '');
  const path = m.includes('/') ? m.replace(/^public\//, '') : 'models/' + m + (/\.(glb|gltf)$/i.test(m) ? '' : '.glb');
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
  return base.replace(/\/+$/, '/') + path;
}
/** Load a user's map model (GLB/GLTF). Replaceable in tests. */
export let loadUserMap = (model: string): Promise<THREE.Object3D> => new GLTFLoader().loadAsync(userMapUrl(model)).then((g) => g.scene);
export function setUserMapLoader(loader: (model: string) => Promise<THREE.Object3D>): void { loadUserMap = loader; }

/**
 * The highway network's tree: each new stop joined to its nearest stop already on the network (from the first), in the order
 * they join — [from, to, metres]. The same pairs, in the same order, as trying every joined stop against every other stop each
 * time (ties go to the stop that joined first, then the lower index), but in n² steps instead of n³, so a map of a thousand
 * places lays its roads in a blink.
 */
export function spanningPairs(stops: ReadonlyArray<{ x: number; z: number }>): Array<[number, number, number]> {
  const n = stops.length, out: Array<[number, number, number]> = [];
  if (n < 2) return out;
  const joinedAt = new Array<number>(n).fill(-1), near = new Array<number>(n).fill(Infinity), from = new Array<number>(n).fill(-1);
  joinedAt[0] = 0;
  for (let count = 1, last = 0; count < n; count++) {
    for (let b = 0; b < n; b++) {
      if (joinedAt[b] >= 0) continue;
      const d = Math.hypot(stops[last].x - stops[b].x, stops[last].z - stops[b].z);
      if (d < near[b]) { near[b] = d; from[b] = last; }
    }
    let pick = -1;
    for (let b = 0; b < n; b++) {
      if (joinedAt[b] >= 0 || from[b] < 0) continue;
      if (pick < 0 || near[b] < near[pick] || (near[b] === near[pick] && joinedAt[from[b]] < joinedAt[from[pick]])) pick = b;
    }
    if (pick < 0) break;
    joinedAt[pick] = count; last = pick;
    out.push([from[pick], pick, near[pick]]);
  }
  return out;
}

/** An axis-aligned pad, already including any clearance (the world uses a 12 m shoulder). */
export type VenueBox = { x0: number; x1: number; z0: number; z1: number };

const inVenueBox = (p: { x: number; z: number }, b: VenueBox): boolean => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;

/** Liang–Barsky: whether the segment a→c enters the box. PURE. */
export function segmentCrossesVenue(a: { x: number; z: number }, c: { x: number; z: number }, b: VenueBox): boolean {
  let t0 = 0, t1 = 1;
  const dx = c.x - a.x, dz = c.z - a.z;
  for (const [pp, q] of [[-dx, a.x - b.x0], [dx, b.x1 - a.x], [-dz, a.z - b.z0], [dz, b.z1 - a.z]]) {
    if (pp === 0) { if (q < 0) return false; continue; }
    const t = q / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

/**
 * A highway from one stop to the other, bent around a full side (two corners) of the first venue pad it would cross.
 * A single corner is not enough: the second leg of a long straight road can still clip the pad. Unchanged when it does
 * not cross any pad, when an end already sits in a pad, or when there are no venues. PURE.
 */
export function routeAroundVenues(from: { x: number; z: number }, to: { x: number; z: number }, boxes: ReadonlyArray<VenueBox>): Array<{ x: number; z: number }> {
  const clear = 30;
  for (const b of boxes) {
    if (inVenueBox(from, b) || inVenueBox(to, b) || !segmentCrossesVenue(from, to, b)) continue;
    const sw = { x: b.x0 - clear, z: b.z0 - clear }, se = { x: b.x1 + clear, z: b.z0 - clear };
    const nw = { x: b.x0 - clear, z: b.z1 + clear }, ne = { x: b.x1 + clear, z: b.z1 + clear };
    // Around the south, north, west or east face — never a single corner, so a long second leg cannot clip the pad.
    const sides = [[sw, se], [nw, ne], [sw, nw], [se, ne]];
    let best: Array<{ x: number; z: number }> | null = null, bestLen = Infinity;
    for (const [a, c] of sides) {
      if (segmentCrossesVenue(from, a, b) || segmentCrossesVenue(a, c, b) || segmentCrossesVenue(c, to, b)) continue;
      const len = Math.hypot(a.x - from.x, a.z - from.z) + Math.hypot(c.x - a.x, c.z - a.z) + Math.hypot(to.x - c.x, to.z - c.z);
      if (len < bestLen) { best = [from, a, c, to]; bestLen = len; }
    }
    if (best) return best;
  }
  return [from, to];
}

export function createOpenWorld(ctx: GameContext, options: OpenWorldOptions = {}): OpenWorld {
  const { patchSize = 96, city: cityOption = false, regions: regionList, spreadMeters, liveCities, ...mapOptions } = options;
  // 📏 A SIZE THE USER ASKED FOR (failedbr #2495: "map ko 40km*40km banao"). The places spread across that square; a loop world
  // smaller than it is raised to it (never lowered: a smaller loop would only squeeze the same land). 0 = no spread asked.
  const spread = Number.isFinite(Number(spreadMeters)) && Number(spreadMeters) > 0 ? Math.min(1000000, Math.max(1000, Number(spreadMeters))) : 0;
  const loopSize = Number(mapOptions.sizeMeters) > 0 ? Number(mapOptions.sizeMeters) : 100000;
  // 🏝️ A BOUNDED MAP (a battle royale's island) is NEVER made bigger by a size asked (owner decision 2026-11-23: it stays an
  // 8 km island). Only a looping world is raised; the places of an island stand on its dry land, and that is said.
  const mapMode = (mapOptions as { mode?: unknown }).mode;
  const looping = mapMode === 'loop' || (mapMode !== 'bounded' && (mapOptions as { profile?: unknown }).profile !== 'battle-royale');
  const sized = looping && spread > loopSize ? { sizeMeters: spread } : {};
  // A browser with no GPU gets the map's phone tier (failedbr #2487 — see Game.ts applyQuality); a game may still ask for any tier.
  // 🧱 LATE GROUND EDITS ARE REDRAWN BY DEFAULT here (lateEdits: false opts out). The kit lays every pad, land and road before
  // the first draw, but a game feature that levels ground later used to leave the drawn terrain at the old height while the
  // player walked on the new one — one place on two layers. Nothing is redrawn while nothing changes, so it costs nothing then.
  const lateEdits = options.lateEdits !== false;
  const map = createAthreeMap({ profile: 'open-world', quality: softwareRenderer() ? 'phone' : 'mid', skyOptions: { lights: false }, ...mapOptions, ...sized, lateEdits, three: THREE } as AthreeMapOptions);
  const chunks = map.chunks!;
  ctx.scene.add(chunks.group);
  if (!looping && spread > map.world.sizeMeters) console.error('[world] this map is an island of ' + Math.round(map.world.sizeMeters / 1000) + ' km and is never made bigger; the size asked (' + Math.round(spread / 1000) + ' km) is not used — the places stand on the island\'s dry land.');
  const tier = (mapOptions as { quality?: string }).quality ?? deviceTier();
  const liveBudget = liveCities === false ? Infinity
    : Math.max(1, Math.min(64, Math.floor(Number(liveCities ?? LIVE_CITIES[tier as keyof typeof LIVE_CITIES] ?? LIVE_CITIES.mid) || LIVE_CITIES.mid)));
  (map as { sky?: { applyTo(scene: THREE.Scene): void } | null }).sky?.applyTo(ctx.scene);
  ctx.camera.near = 0.3; ctx.camera.far = 9000; ctx.camera.updateProjectionMatrix();

  // The walkable ground: a grid whose heights are the map's, rebuilt as the player moves on.
  const cells = 32;
  const geometry = new THREE.PlaneGeometry(patchSize, patchSize, cells, cells);
  geometry.rotateX(-Math.PI / 2);
  const ground = markWorldCollider(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false })), 'ground');
  ground.frustumCulled = false;
  ctx.scene.add(ground);
  const centre = { x: Number.NaN, z: Number.NaN };
  const step = patchSize / cells;
  const layGround = (wx: number, wz: number): void => {
    const cx = Math.round(wx / step) * step, cz = Math.round(wz / step) * step;
    if (Math.abs(cx - centre.x) < patchSize * 0.2 && Math.abs(cz - centre.z) < patchSize * 0.2) {
      ground.position.set(centre.x - chunks.origin.x, 0, centre.z - chunks.origin.z);
      return;
    }
    centre.x = cx; centre.z = cz;
    const p = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, map.world.heightAt(cx + p.getX(i), cz + p.getZ(i)));
    p.needsUpdate = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    ground.position.set(cx - chunks.origin.x, 0, cz - chunks.origin.z);
    ground.updateMatrixWorld(true);
  };

  const s = map.world.spawnPoints('player', 1)[0] ?? { x: 0, y: map.world.heightAt(0, 0), z: 0, heading: 0 };
  const spawn = { x: s.x, y: map.world.heightAt(s.x, s.z), z: s.z };

  // THE PLACES ON THE MAP: each one (a city, a town, a village) gets the flattest dry ground in its direction, levelled
  // BEFORE any terrain is drawn, and stands on it. The list grows one entry at a time; the first is where the player starts.
  const wanted: WorldRegion[] = [
    ...(cityOption ? [{ id: 'city', kind: 'city' as const, ...(cityOption === true ? {} : { city: cityOption }) }] : []),
    ...(Array.isArray(regionList) ? regionList : []).map(cleanRegion),
  ];
  const towns: OpenWorldCity[] = [];
  // One root per BUILT PLACE, in step with towns[] and locals[] (index i is the same place in all three). A user's map has its
  // own list: it was pushed here once, and every place built after it then moved, hid and disposed its neighbour's root.
  const roots: THREE.Group[] = [];
  const userRoots: THREE.Object3D[] = [];
  const venueRoots: THREE.Group[] = [];
  let disposed = false;
  const locals: THREE.Object3D[] = [];
  // The ground already given to a place, a land or a user map. Kept in 1 km cells as well as in order, so "is anything here?"
  // looks only at the cells near the spot — the same answer as asking every entry (the cells reach as far as the widest one),
  // in a few steps instead of a thousand.
  // Each entry may also carry its exact box (a city and the tiles that will join it) and the open ground it keeps (gap); left
  // out, its box is the square of r and its gap PLACE_GAP.min. The compact planner (nearestFreeSpot) reads those.
  type TakenSpot = { x: number; z: number; r: number; box?: { x0: number; x1: number; z0: number; z1: number }; gap?: number };
  const taken = (() => {
    const all: TakenSpot[] = [], cells = new Map<string, number[]>(), CELL = 1000;
    let widest = 0;
    return {
      /** Every entry, in order. */
      list(): ReadonlyArray<TakenSpot> { return all; },
      push(t: TakenSpot): void {
        const i = all.push(t) - 1, key = Math.floor(t.x / CELL) + ',' + Math.floor(t.z / CELL);
        (cells.get(key) || cells.set(key, []).get(key)!).push(i);
        widest = Math.max(widest, t.r, t.box ? Math.max(t.x - t.box.x0, t.box.x1 - t.x, t.z - t.box.z0, t.box.z1 - t.z) : 0);
      },
      /** Whether any entry passes the test — the same entries the test would pass over the whole list, in list order. */
      some(x: number, z: number, extra: number, test: (t: TakenSpot) => boolean): boolean {
        const reach = widest + extra;
        if (!(reach >= 0) || !Number.isFinite(reach) || !Number.isFinite(x) || !Number.isFinite(z) || reach > CELL * 40) return all.some(test);
        const cx0 = Math.floor((x - reach) / CELL), cx1 = Math.floor((x + reach) / CELL), cz0 = Math.floor((z - reach) / CELL), cz1 = Math.floor((z + reach) / CELL);
        for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
          const list = cells.get(cx + ',' + cz);
          if (list) for (const i of list) if (test(all[i])) return true;
        }
        return false;
      },
    };
  })();
  const seenIds = new Set<string>();
  const landList: OpenWorldLand[] = [];
  const userMaps: Array<{ id: string; model: string; centre: { x: number; y: number; z: number }; size: number; status: OpenWorldUserMap['status']; reason?: string; root?: THREE.Object3D }> = [];
  const venueList: Array<{ id: string; venue: VenueKind; centre: { x: number; y: number; z: number }; width: number; depth: number; scale: number; joinedTo?: string; root?: THREE.Group }> = [];
  const colours = [0xc8102e, 0x1d4ed8, 0xf59e0b, 0x111827, 0xe5e7eb, 0x15803d];
  const worldSeed = (mapOptions as { seed?: unknown }).seed, paintShift = parkedPaintShift(worldSeed, colours.length);
  // 🌌 A UNIVERSE OF PLACES (admin 2026-11-22: "mujhe chahiye 10—100 maps jod kar bahut bada universe bhi bana sake"). Up to
  // MAX_REGIONS places and lands. Every place is PLANNED up front — its spot on the map and its levelled ground, which are cheap
  // and must exist before the first terrain is drawn — but its CITY (buildings, traffic, people, parked cars) is built only when
  // the player comes within BUILD_AHEAD metres of it, one place per frame, so a hundred places cost what the nearest few cost.
  //
  // 🏘️ PLACES CLOSE TOGETHER (admin 2026-11-22, failedbr #2499: "maine kaha map me 4 village/city add karo, to add huye hi
  // nahi" — then "maps thode pas pas rahe, aur beech me road ho"). The four new places WERE planned — 2.6 to 3.2 km out, on a
  // spiral whose distance grew with the square root of each place's position in the list, so the newest place was always the
  // farthest, out of sight and unbuilt from the start. 🧬 THE CLASS: a place's distance came from WHEN it was added, not from
  // where there was room. Now every place, land, user map and venue takes the NEAREST free spot to the first place that keeps a
  // short stretch of open country (PLACE_GAP: 150 to 300 m, edge to edge, bigger for a bigger place) from everything already
  // there, on dry ground; the map grows outward as a cluster, every place a short drive from its neighbours. A place asked to lie
  // toward a direction is laid that way; a distance that was asked is kept; a size the user asked for (spreadMeters) still
  // spreads the places across it. A place with no dry ground on its ray still waits for the rescue below (never in the sea).
  interface PlannedPlace { region: WorldRegion; preset: (typeof REGION_PRESETS)['city']; cityOptions: CityOptions; centre: { x: number; y: number; z: number }; reach: number; built: number;
    /** Its parked cars, made the first time it is built and kept when it is freed (each stays where the player left it). */
    parked?: THREE.Object3D[];
    /** A grown city: the first tile's id, and this tile's cell on the city's grid. */
    cluster?: { root: string; gx: number; gz: number; stepX: number; stepZ: number } }
  const planned: PlannedPlace[] = [];
  const AXIS: Record<string, [number, number]> = { north: [0, -1], 'north-east': [1, -1], east: [1, 0], 'south-east': [1, 1], south: [0, 1], 'south-west': [-1, 1], west: [-1, 0], 'north-west': [-1, -1] };
  let growSeed = 0x9e3779b9;
  const nextRandom = (): number => { growSeed = (Math.imul(growSeed ^ (growSeed >>> 15), 2246822519) + 0x6d2b79f5) | 0; return ((growSeed >>> 0) % 10000) / 10000; };
  /** A footprint around a centre, in metres: how far it reaches west (x0, negative), east (x1), north (z0, negative), south (z1). */
  interface Footprint { x0: number; x1: number; z0: number; z1: number }
  const square = (r: number): Footprint => ({ x0: -r, x1: r, z0: -r, z1: r });
  const boxAt = (x: number, z: number, f: Footprint): Footprint => ({ x0: x + f.x0, x1: x + f.x1, z0: z + f.z0, z1: z + f.z1 });
  const placeGap = (reach: number): number => Math.min(PLACE_GAP.max, Math.max(PLACE_GAP.min, 100 + reach * 0.8));
  const slab = (o: number, u: number, a0: number, a1: number): [number, number] => {
    if (Math.abs(u) < 1e-9) return o > a0 && o < a1 ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] : [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const s0 = (a0 - o) / u, s1 = (a1 - o) / u;
    return s0 < s1 ? [s0, s1] : [s1, s0];
  };
  /** Whether a place may be laid compact (the nearest free spot): no distance and no map size was asked. */
  const isCompact = (region: WorldRegion): boolean => region.distance === undefined && spread === 0;
  /**
   * THE NEAREST FREE SPOT to the first place for a footprint: along each of 32 directions (only the asked one, with toward), the
   * first distance where it keeps its gap (and every neighbour's own gap) of open ground to everything already given out —
   * worked out exactly, from the stretches of the ray each spot blocks — and, where ground() is given, where the ground is usable
   * (Infinity: water or a road; else a small cost for uneven land). The smallest distance plus cost wins; the same list always
   * gives the same map. null: no usable ground on any ray (a place then waits for the rescue below).
   */
  const nearestFreeSpot = (f: Footprint, gap: number, n: number, toward: Compass | undefined, ground?: (x: number, z: number) => number): { x: number; z: number } | null => {
    const base = planned[0]?.centre ?? spawn;
    // Before the first place is planned (a land or a user's map listed first), the start is kept for it.
    const around: TakenSpot[] = planned.length ? [...taken.list()] : [...taken.list(), { x: spawn.x, z: spawn.z, r: 130, gap: PLACE_GAP.max }];
    const angles = toward !== undefined ? [COMPASS[toward]] : Array.from({ length: 32 }, (_, i) => n * 2.399963 + (i * Math.PI) / 16);
    let best: { x: number; z: number; score: number } | null = null;
    for (const angle of angles) {
      const ux = Math.sin(angle), uz = -Math.cos(angle);
      const blocked: Array<[number, number]> = [];
      for (const t of around) {
        const b = t.box ?? boxAt(t.x, t.z, square(t.r)), g = Math.max(gap, t.gap ?? PLACE_GAP.min);
        const [a0, a1] = slab(base.x, ux, b.x0 - f.x1 - g, b.x1 - f.x0 + g), [b0, b1] = slab(base.z, uz, b.z0 - f.z1 - g, b.z1 - f.z0 + g);
        const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
        if (hi > lo && hi > 0) blocked.push([lo, hi]);
      }
      blocked.sort((p, q) => p[0] - q[0]);
      const freeFrom = (at0: number): number => { let at = at0; for (const [lo, hi] of blocked) if (lo < at && hi > at) at = hi + 1; return at; };
      let s = freeFrom(0);
      for (let tries = 0; tries < 40 && s < 60000 && (!best || s < best.score); tries++) {
        const x = base.x + ux * s, z = base.z + uz * s, cost = ground ? ground(x, z) : 0;
        if (Number.isFinite(cost)) { if (!best || s + cost < best.score) best = { x, z, score: s + cost }; break; }
        s = freeFrom(s + 40);
      }
    }
    return best ? { x: best.x, z: best.z } : null;
  };
  // THE TILES OF EVERY GROWN CITY, worked out from the list before anything is placed: a tile's cell depends only on the tiles
  // before it (and the same seeded draws, in the same order), never on where its city stands. So a place laid close to a city
  // leaves room for the tiles that will join it later in the list, and each tile below takes exactly the cell worked out here.
  const tileCells = new Map<string, { root: string; cell: [number, number] }>();
  {
    const seen = new Set<string>(); let count = 0;
    for (const region of wanted) {
      if (!region || typeof region.id !== 'string' || !region.id || seen.has(region.id) || count >= MAX_REGIONS) continue;
      seen.add(region.id);
      if (region.kind === 'custom' && !String(region.model || '').trim()) continue;
      count++;
      if (region.kind === 'custom' || region.kind === 'venue' || isLandKind(region.kind)) continue;
      const base = typeof region.joinTo === 'string' ? tileCells.get(region.joinTo) : undefined;
      if (!base) { tileCells.set(region.id, { root: region.id, cell: [0, 0] }); continue; }
      const tiles = [...tileCells.values()].filter((t) => t.root === base.root);
      const used = new Set(tiles.map((t) => t.cell.join(',')));
      let cell: [number, number] | null = null;
      if (region.toward !== undefined) {
        const [dx, dz] = AXIS[region.toward]; let [gx, gz] = base.cell;
        do { gx += dx; gz += dz; } while (used.has(gx + ',' + gz));
        cell = [gx, gz];
      } else {
        const free: Array<[number, number]> = [];
        for (const t of tiles) { const [gx, gz] = t.cell; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (gx + dx) + ',' + (gz + dz); if (!used.has(k) && !free.some((q) => q.join(',') === k)) free.push([gx + dx, gz + dz]); } }
        cell = free[Math.floor(nextRandom() * free.length)] ?? null;
      }
      tileCells.set(region.id, cell ? { root: base.root, cell } : { root: region.id, cell: [0, 0] });
    }
  }
  /** A place's footprint with every tile that will join it: the whole grown city, so nothing is laid where it will grow. */
  const clusterFootprint = (id: string, plan: CityPlan): Footprint => {
    const hx = plan.width / 2 + 8, hz = plan.depth / 2 + 8, stepX = plan.width - plan.road, stepZ = plan.depth - plan.road;
    const f: Footprint = { x0: -hx, x1: hx, z0: -hz, z1: hz };
    for (const t of tileCells.values()) {
      if (t.root !== id) continue;
      f.x0 = Math.min(f.x0, t.cell[0] * stepX - hx); f.x1 = Math.max(f.x1, t.cell[0] * stepX + hx);
      f.z0 = Math.min(f.z0, t.cell[1] * stepZ - hz); f.z1 = Math.max(f.z1, t.cell[1] * stepZ + hz);
    }
    return f;
  };
  // With a spread, the k-th of the M places that stand on their own (not a tile of a city) is laid about sqrt(k / (M - 1)) of the
  // way to the edge of the square, on a golden-angle spiral: the places fill the whole area instead of crowding the start.
  const ownPlaces = wanted.filter((r) => r && typeof r.id === 'string' && !(typeof r.joinTo === 'string' && r.joinTo));
  const spreadFar = (region: WorldRegion): number => {
    const k = ownPlaces.indexOf(region);
    return spread > 0 && k > 0 ? (spread / 2) * 0.92 * Math.sqrt(k / Math.max(1, ownPlaces.length - 1)) : 0;
  };
  /**
   * A land or a user map laid the spread way (or nearby, when it could not join) is never moved for this — the same map as
   * before — but where most of its ground is sea or river it is SAID, so the builder can tell the user and ask again.
   */
  const sayIfWet = (what: string, id: string, at: { x: number; z: number }, r: number): void => {
    let wet = 0;
    for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
      const x = at.x + dx * r, z = at.z + dz * r;
      if (!(map.world.heightAt(x, z) >= 2) || map.world.waterAt(x, z)) wet++;
    }
    if (wet >= 3) console.error('[world] the ' + what + ' "' + id + '" lies mostly in the sea or a river (no dry ground there on this map); it is on the map, but ask for it in another direction or nearer.');
  };
  /**
   * Where a land joined to region.joinTo stands: its centre, so that it overlaps the edge of that place (the whole grown city,
   * all its tiles) or land a little. null (said in the console) when the id is unknown or every side asked for is water or taken.
   */
  const joinedLandSpot = (region: WorldRegion, r: number, n: number): { x: number; z: number } | null => {
    const id = region.joinTo as string;
    let shape: { x: number; z: number; hw?: number; hd?: number; radius?: number; skip: Array<{ x: number; z: number }> } | null = null;
    const place = planned.find((q) => q.region.id === id);
    if (place) {
      const rootId = place.cluster?.root ?? place.region.id;
      const tiles = planned.filter((q) => (q.cluster?.root ?? q.region.id) === rootId);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of tiles) { const pl = planCity(q.cityOptions); x0 = Math.min(x0, q.centre.x - pl.width / 2); x1 = Math.max(x1, q.centre.x + pl.width / 2); z0 = Math.min(z0, q.centre.z - pl.depth / 2); z1 = Math.max(z1, q.centre.z + pl.depth / 2); }
      shape = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, skip: tiles.map((q) => q.centre) };
    } else {
      const land = landList.find((l) => l.id === id);
      if (land) shape = { x: land.centre.x, z: land.centre.z, radius: land.radius, skip: [land.centre] };
      else {
        const user = userMaps.find((m) => m.id === id);
        if (user) shape = { x: user.centre.x, z: user.centre.z, hw: user.size / 2, hd: user.size / 2, skip: [user.centre] };
      }
    }
    if (!shape) { console.error('[world] the land "' + region.id + '" joins "' + id + '", which is not on the map (yet); it was laid nearby instead.'); return null; }
    const first = region.toward !== undefined ? COMPASS[region.toward] : n * 2.399963;
    const sides = region.toward !== undefined ? [first] : [0, 1, 2, 3, 4, 5, 6, 7].map((k) => first + (k * Math.PI) / 4);
    for (const angle of sides) {
      const ux = Math.sin(angle), uz = -Math.cos(angle);
      // From the centre to the border along this side: the rectangle's border, or a land's nearest (ragged) edge.
      const border = shape.radius !== undefined ? shape.radius * 0.85 : Math.min(shape.hw! / Math.max(1e-6, Math.abs(ux)), shape.hd! / Math.max(1e-6, Math.abs(uz)));
      const at = { x: shape.x + ux * (border + r * 0.8), z: shape.z + uz * (border + r * 0.8) };
      const isBase = (t: { x: number; z: number }) => shape!.skip.some((c) => c.x === t.x && c.z === t.z);
      if (taken.some(at.x, at.z, r * 0.8, (t) => !isBase(t) && Math.hypot(at.x - t.x, at.z - t.z) < t.r + r * 0.8)) continue;
      let dry = 0;
      for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
        const x = at.x + dx * r, z = at.z + dz * r;
        if (map.world.heightAt(x, z) >= 2 && !map.world.waterAt(x, z)) dry++;
      }
      if (dry >= 4) return at;
    }
    console.error('[world] the land "' + region.id + '" could not lie against "' + id + '" (' + (region.toward ? 'the ' + region.toward + ' side is' : 'every side is') + ' water or another place); it was laid nearby instead.');
    return null;
  };
  /**
   * 🏟️ A SPORTS GROUND OR VENUE (map expansion item 6): a cricket ground, a football field, a stadium, a race circuit or an
   * arena at its standard size (or the size asked), on its own level pad with its markings. With joinTo it stands right beside
   * that place (a whole grown city), land, user map or venue — on the side toward says, else the first free dry side — on the
   * same ground level as a city it joins, with no highway between them; else it is spread like any place. It never stands on
   * another place, in the sea or across a road; where nothing fits it is said in the console and left out.
   */
  const planVenue = (region: WorldRegion, n: number): void => {
    const venue: VenueKind = isVenueKind(region.venue) ? region.venue : 'football-field';
    if (!isVenueKind(region.venue)) console.error('[world] the venue "' + region.id + '" names no known venue (' + Object.keys(VENUE_SIZES).join(', ') + '); it was made a football field.');
    const std = VENUE_SIZES[venue], longest = Math.max(std.width, std.depth);
    const scale = Number(region.size) > 0 ? Math.min(2, Math.max(0.6, Number(region.size) / longest)) : 1;
    const hw = (std.width * scale) / 2, hd = (std.depth * scale) / 2, vr = Math.max(hw, hd);
    /** Dry, off the map's roads, and level enough: the rise across the ground, or Infinity. */
    const groundCost = (cx: number, cz: number): number => {
      let low = Infinity, high = -Infinity;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const x = cx + (i / 2) * hw, z = cz + (j / 2) * hd, h = map.world.heightAt(x, z);
        if (h < 2 || map.world.waterAt(x, z) || map.world.roadAt(x, z)) return Infinity;
        low = Math.min(low, h); high = Math.max(high, h);
      }
      return high - low;
    };
    let at: { x: number; z: number } | null = null, level: number | undefined, joinedTo: string | undefined;
    if (typeof region.joinTo === 'string' && region.joinTo) {
      const id = region.joinTo;
      let shape: { x: number; z: number; hw?: number; hd?: number; radius?: number; y?: number; skip: Array<{ x: number; z: number }> } | null = null;
      const place = planned.find((q) => q.region.id === id);
      if (place) {
        const rootId = place.cluster?.root ?? place.region.id;
        const tiles = planned.filter((q) => (q.cluster?.root ?? q.region.id) === rootId);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const q of tiles) { const pl = planCity(q.cityOptions); x0 = Math.min(x0, q.centre.x - pl.width / 2); x1 = Math.max(x1, q.centre.x + pl.width / 2); z0 = Math.min(z0, q.centre.z - pl.depth / 2); z1 = Math.max(z1, q.centre.z + pl.depth / 2); }
        shape = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, y: place.centre.y, skip: tiles.map((q) => q.centre) };
      } else {
        const land = landList.find((l) => l.id === id), user = userMaps.find((m) => m.id === id), other = venueList.find((v) => v.id === id);
        if (land) shape = { x: land.centre.x, z: land.centre.z, radius: land.radius * 0.85, skip: [land.centre] };
        else if (user) shape = { x: user.centre.x, z: user.centre.z, hw: user.size / 2, hd: user.size / 2, skip: [user.centre] };
        else if (other) shape = { x: other.centre.x, z: other.centre.z, hw: other.width / 2, hd: other.depth / 2, y: other.centre.y, skip: [other.centre] };
      }
      if (!shape) console.error('[world] the venue "' + region.id + '" stands beside "' + id + '", which is not on the map (yet); it was laid on its own instead.');
      else {
        const first = region.toward !== undefined ? COMPASS[region.toward] : 0;
        const sides = region.toward !== undefined ? [first] : [0, 1, 2, 3, 4, 5, 6, 7].map((k) => first + (k * Math.PI) / 4);
        for (const angle of sides) {
          const ux = Math.sin(angle), uz = -Math.cos(angle);
          const border = shape.radius !== undefined ? shape.radius : Math.min(shape.hw! / Math.max(1e-6, Math.abs(ux)), shape.hd! / Math.max(1e-6, Math.abs(uz)));
          const own = Math.min(hw / Math.max(1e-6, Math.abs(ux)), hd / Math.max(1e-6, Math.abs(uz)));
          const c = { x: shape.x + ux * (border + own + 14), z: shape.z + uz * (border + own + 14) };
          const isBase = (t: { x: number; z: number }) => shape!.skip.some((k) => k.x === t.x && k.z === t.z);
          if (taken.some(c.x, c.z, vr + 20, (t) => !isBase(t) && Math.hypot(c.x - t.x, c.z - t.z) < t.r + vr + 20)) continue;
          if (!Number.isFinite(groundCost(c.x, c.z))) continue;
          at = c; level = shape.y; joinedTo = id; break;
        }
        if (!at) console.error('[world] the venue "' + region.id + '" could not stand beside "' + id + '" (' + (region.toward ? 'the ' + region.toward + ' side is' : 'every side is') + ' water, a road or another place); it was laid on its own instead.');
      }
    }
    if (!at && isCompact(region)) {
      // Close to the others, like every place: the nearest free spot on dry, level-enough ground off the map's roads.
      at = nearestFreeSpot({ x0: -hw - 8, x1: hw + 8, z0: -hd - 8, z1: hd + 8 }, PLACE_GAP.min, n, region.toward, (x, z) => groundCost(x, z) * 8);
    }
    if (!at) {
      // Spread like a place: the way it was asked (toward, distance), else around the first place; a little further out, and a
      // little to either side, before giving up.
      const base = planned[0]?.centre ?? spawn;
      const angle = region.toward !== undefined ? COMPASS[region.toward] : (n * 2.399963);
      const spacing = vr * 2 + 400;
      let far = Math.max(region.distance ?? 0, (planned[0]?.reach ?? 0) + vr + 300, spacing * Math.sqrt(Math.max(1, n)));
      let best: { x: number; z: number; cost: number } | null = null;
      for (let attempt = 0; attempt < 14 && !best; attempt++, far += spacing * 0.5) {
        const turn = (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * (region.toward !== undefined ? 0.15 : 0.35);
        const home = { x: base.x + Math.sin(angle + turn) * far, z: base.z - Math.cos(angle + turn) * far };
        for (const ring of [0, 1, 2]) for (let k = 0; k < (ring ? 8 : 1); k++) {
          const a = (k / 8) * Math.PI * 2, r = ring * vr * 0.9;
          const cx = home.x + Math.cos(a) * r, cz = home.z + Math.sin(a) * r;
          if (taken.some(cx, cz, vr + 140, (t) => Math.hypot(cx - t.x, cz - t.z) < t.r + vr + 140)) continue;
          const cost = groundCost(cx, cz);
          if (cost < (best?.cost ?? Infinity)) best = { x: cx, z: cz, cost };
        }
      }
      if (!best) { console.error('[world] no dry, level ground was found for the venue "' + region.id + '"; it was left out.'); return; }
      at = best;
    }
    const y = map.world.levelGround(at.x, at.z, hw + 8, hd + 8, 60, level);
    taken.push({ x: at.x, z: at.z, r: vr, box: boxAt(at.x, at.z, { x0: -hw - 8, x1: hw + 8, z0: -hd - 8, z1: hd + 8 }) });
    venueList.push({ id: region.id, venue, centre: { x: at.x, y, z: at.z }, width: hw * 2, depth: hd * 2, scale, ...(joinedTo ? { joinedTo } : {}) });
  };
  let overCap = 0;
  const waiting: Array<{ region: WorldRegion; preset: PlannedPlace['preset']; cityOptions: CityOptions; hx: number; hz: number; reach: number; angle: number }> = [];
  for (const region of wanted) {
    if (region && planned.length + landList.length + userMaps.length + venueList.length >= MAX_REGIONS) { overCap++; continue; }
    if (!region || typeof region.id !== 'string' || !region.id || seenIds.has(region.id) || planned.length + landList.length + userMaps.length + venueList.length >= MAX_REGIONS) continue;
    seenIds.add(region.id);
    const n = planned.length + landList.length + userMaps.length + venueList.length;
    if (region.kind === 'venue') { planVenue(region, n); continue; }
    // 🗺️ A MAP THE USER GAVE (admin 2026-11-22: "user khud ka map kan.zip ya koi aur format upload kar ke bole yeh bhi north add kar
    // do — to user ka diya map bhi usi game me add ho jaye"). Planned like a land (toward, distance, clear of the others) on its
    // own levelled ground; the model itself is loaded only when the player comes near, and a file that cannot be read is said.
    if (region.kind === 'custom') {
      const model = String(region.model || '').trim();
      if (!model) { console.error('[world] the map "' + region.id + '" names no model file; it was left out.'); continue; }
      const size = Math.min(4000, Math.max(40, Number(region.size) || 400)), r = size / 2;
      const base = planned[0]?.centre ?? spawn;
      const angle = region.toward !== undefined ? COMPASS[region.toward] : (n * 2.399963);
      let far = Math.max(region.distance ?? 0, (planned[0]?.reach ?? 0) + r + 200, (size + 400) * Math.sqrt(n), region.distance === undefined ? spreadFar(region) : 0);
      let at = { x: base.x + Math.sin(angle) * far, z: base.z - Math.cos(angle) * far };
      const near = isCompact(region) ? nearestFreeSpot(square(r), PLACE_GAP.min, n, region.toward) : null;
      if (near) at = near;
      else for (let tries = 0; tries < 8 && taken.some(at.x, at.z, r + 100, (t) => Math.hypot(at.x - t.x, at.z - t.z) < t.r + r + 100); tries++) {
        far += r; at = { x: base.x + Math.sin(angle) * far, z: base.z - Math.cos(angle) * far };
      }
      sayIfWet('map', region.id, at, r);
      const y = map.world.levelGround(at.x, at.z, r, r, 60);
      taken.push({ x: at.x, z: at.z, r });
      userMaps.push({ id: region.id, model, centre: { x: at.x, y, z: at.z }, size, status: 'waiting' });
      continue;
    }
    // A LAND, not a place to build: laid on the map the way it was asked (toward, distance), clear of the places already there.
    if (isLandKind(region.kind)) {
      const r = Math.min(2000, Math.max(150, Number(region.radius) || 450));
      // 🧩 A LAND JOINED TO A PLACE OR A LAND (map expansion, item 3): laid against it, overlapping its edge a little, on the side
      // asked for (else the first free dry side). Where that side is water or another place, it is said in the console and the
      // land is laid the old way (near, spread), never dropped and never on top of something.
      if (typeof region.joinTo === 'string' && region.joinTo) {
        const against = joinedLandSpot(region, r, n);
        if (against) {
          map.world.setLand(against.x, against.z, r, LAND_BIOME[region.kind], { joined: true });
          taken.push({ x: against.x, z: against.z, r });
          landList.push({ id: region.id, kind: region.kind, centre: { x: against.x, z: against.z }, radius: r, joinedTo: region.joinTo });
          continue;
        }
      }
      const base = planned[0]?.centre ?? spawn;
      const angle = region.toward !== undefined ? COMPASS[region.toward] : (n * 2.399963);
      let far = Math.max(region.distance ?? 0, (planned[0]?.reach ?? 0) + r + 300, (r * 2 + 400) * Math.sqrt(n), region.distance === undefined ? spreadFar(region) : 0);
      let at = { x: base.x + Math.sin(angle) * far, z: base.z - Math.cos(angle) * far };
      // As close as its own radius allows (a land may reach the shore: it is not built on).
      const near = isCompact(region) ? nearestFreeSpot(square(r), PLACE_GAP.min, n, region.toward) : null;
      if (near) at = near;
      else for (let tries = 0; tries < 8 && taken.some(at.x, at.z, r + 100, (t) => Math.hypot(at.x - t.x, at.z - t.z) < t.r + r + 100); tries++) {
        far += r; at = { x: base.x + Math.sin(angle) * far, z: base.z - Math.cos(angle) * far };
      }
      sayIfWet('land', region.id, at, r);
      map.world.setLand(at.x, at.z, r, LAND_BIOME[region.kind]);
      taken.push({ x: at.x, z: at.z, r });
      landList.push({ id: region.id, kind: region.kind, centre: at, radius: r });
      continue;
    }
    // 🏙️ A CITY THAT GROWS BY ITS OWN BLOCKS (admin 2026-11-22: "map/city ko bada karna — building/road ko clone kar kar ke,
    // randomly add kar kar ke bada map ban jaye"). A tile that joins a city stands EDGE TO EDGE with it on the city's own grid:
    // the same block size (so the streets carry straight on — the shared edge street is one street), the same ground level, a new
    // set of buildings. Tile by tile, a city becomes as big as asked; with no direction it grows on a free side at random.
    // Its cell was worked out before anything was placed (tileCells), and its room was kept when its city was laid.
    const joinBase = typeof region.joinTo === 'string' ? planned.find((q) => q.region.id === region.joinTo) : undefined;
    const pre = tileCells.get(region.id);
    const rootOfBase = joinBase ? joinBase.cluster?.root ?? joinBase.region.id : '';
    if (joinBase && pre && pre.root !== region.id && pre.root === rootOfBase) {
      const rootId = rootOfBase;
      const root = planned.find((q) => q.region.id === rootId)!;
      const rootPlan = planCity(root.cityOptions);
      const stepX = rootPlan.width - rootPlan.road, stepZ = rootPlan.depth - rootPlan.road;
      const cell: [number, number] | null = pre.cell;
      if (cell) {
        const own = region.city || {};
        const cityOptions: CityOptions = { ...root.cityOptions, ...(own.style ? { style: own.style } : {}), ...(own.maxFloors ? { maxFloors: own.maxFloors } : {}), seed: placeLook(worldSeed, root.region.kind, planned.length).seed };
        const x = root.centre.x + cell[0] * stepX, z = root.centre.z + cell[1] * stepZ;
        map.world.levelGround(x, z, rootPlan.width / 2 + 8, rootPlan.depth / 2 + 8, 60, root.centre.y);
        taken.push({ x, z, r: root.reach, box: boxAt(x, z, { x0: -(rootPlan.width / 2 + 8), x1: rootPlan.width / 2 + 8, z0: -(rootPlan.depth / 2 + 8), z1: rootPlan.depth / 2 + 8 }), gap: placeGap(root.reach) });
        planned.push({ region: { ...region, kind: root.region.kind }, preset: root.preset, cityOptions, centre: { x, y: root.centre.y, z }, reach: root.reach, built: -1, cluster: { root: rootId, gx: cell[0], gz: cell[1], stepX, stepZ } });
        continue;
      }
    }
    const preset = REGION_PRESETS[region.kind] || REGION_PRESETS.city;
    const { traffic: _t, people: _p, parkedCars: _c, ...own } = region.city || {};
    const cityOptions: CityOptions = { ...preset.city, ...placeLook(worldSeed, region.kind, planned.length), ...own };
    const plan = planCity(cityOptions);
    const hx = plan.width / 2 + 8, hz = plan.depth / 2 + 8, reach = Math.max(hx, hz);
    // Where to look: the first place is at the start; the others go the way they were asked, clear of what is there.
    const first = planned.length === 0;
    const angle = region.toward !== undefined ? COMPASS[region.toward] : (n * 2.399963);   // the golden angle: spread, never stacked
    const spacing = reach * 2 + 400;
    let far = Math.max(region.distance ?? 0, first ? 0 : spacing * Math.max(1, Math.sqrt(n)), first || region.distance !== undefined ? 0 : spreadFar(region));
    let best = { x: spawn.x, z: spawn.z, cost: Number.POSITIVE_INFINITY };
    const samples = first ? 3 : 2;                                                                       // 7×7 for the start, 5×5 after
    // Room for the tiles that will join this place (none: just its own ground), and the open country it keeps around it.
    const footprint = pre && pre.root === region.id ? clusterFootprint(region.id, plan) : { x0: -hx, x1: hx, z0: -hz, z1: hz };
    const gap = placeGap(reach);
    if (!first && isCompact(region)) {
      // Close to the others: the nearest free spot on dry ground off the map's roads (uneven ground costs 8 m of distance per
      // metre of rise). None on any ray: it waits for the rescue below, like a place that pointed at the sea.
      const groundCost = (cx: number, cz: number): number => {
        let low = Number.POSITIVE_INFINITY, high = Number.NEGATIVE_INFINITY;
        for (let i = -samples; i <= samples; i++) for (let j = -samples; j <= samples; j++) {
          const x = cx + (i / samples) * hx, z = cz + (j / samples) * hz, h = map.world.heightAt(x, z);
          if (h < 2 || map.world.waterAt(x, z) || map.world.roadAt(x, z)) return Number.POSITIVE_INFINITY;
          low = Math.min(low, h); high = Math.max(high, h);
        }
        return high - low;
      };
      const at = nearestFreeSpot(footprint, gap, n, region.toward, (x, z) => groundCost(x, z) * 8);
      if (at) best = { x: at.x, z: at.z, cost: 0 };
      far = Number.POSITIVE_INFINITY;                                                                    // never the spiral
    }
    // Water or roads where it was asked: look a little further out (and, for a spread place, a little to either side), before
    // leaving a place out (a map of a hundred places must not lose the ones that happened to point at the sea).
    for (let attempt = 0; attempt < (first ? 1 : 10) && !Number.isFinite(best.cost) && Number.isFinite(far); attempt++, far += spacing * 0.5) {
    // A place asked to lie toward a direction keeps it; a spread place may also turn a little to find dry ground.
    const turn = region.toward !== undefined ? 0 : (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 0.35;
    const home = first ? { x: spawn.x, z: spawn.z } : { x: planned[0].centre.x + Math.sin(angle + turn) * far, z: planned[0].centre.z - Math.cos(angle + turn) * far };
    best = { x: home.x, z: home.z, cost: Number.POSITIVE_INFINITY };
    for (const ring of [0, 1, 2, 3, 4]) for (let k = 0; k < (ring ? 8 : 1); k++) {
      const a = (k / 8) * Math.PI * 2, r = ring * reach * 0.9;
      const cx = home.x + Math.cos(a) * r, cz = home.z + Math.sin(a) * r;
      if (taken.some(cx, cz, reach + 140, (t) => Math.hypot(cx - t.x, cz - t.z) < t.r + reach + 140)) continue;   // never on top of another place
      if (taken.some(cx, cz, Math.max(-footprint.x0, footprint.x1, -footprint.z0, footprint.z1) + 140, (t) => { const b = t.box ?? boxAt(t.x, t.z, square(t.r)); return Math.max(cx + footprint.x0 - b.x1, b.x0 - cx - footprint.x1, cz + footprint.z0 - b.z1, b.z0 - cz - footprint.z1) < 140; })) continue;
      let low = Number.POSITIVE_INFINITY, high = Number.NEGATIVE_INFINITY, wet = false;
      for (let i = -samples; i <= samples && !wet; i++) for (let j = -samples; j <= samples; j++) {
        const x = cx + (i / samples) * hx, z = cz + (j / samples) * hz, h = map.world.heightAt(x, z);
        if (h < 2 || map.world.waterAt(x, z) || map.world.roadAt(x, z)) { wet = true; break; }
        low = Math.min(low, h); high = Math.max(high, h);
      }
      const cost = wet ? Number.POSITIVE_INFINITY : (high - low) + r * 0.01;
      if (cost < best.cost) best = { x: cx, z: cz, cost };
      if (!first && cost < 1.5) break;                                                                  // flat enough: stop looking
    }
    }
    // No dry ground in that direction: it waits, and is given the nearest free dry ground once every other place has its own
    // (below) — so the places that did find ground stand exactly where they always stood.
    if (!Number.isFinite(best.cost) && !first) { waiting.push({ region, preset, cityOptions, hx, hz, reach, angle }); continue; }
    const y = map.world.levelGround(best.x, best.z, hx, hz, 60);
    taken.push({ x: best.x, z: best.z, r: reach, box: boxAt(best.x, best.z, footprint), gap });
    planned.push({ region, preset, cityOptions, centre: { x: best.x, y, z: best.z }, reach, built: -1 });
  }
  if (overCap) console.error('[world] the map holds ' + MAX_REGIONS + ' places and lands; ' + overCap + ' more in the list were left out.');
  /** Build one planned place's city now (buildings, traffic, people, parked cars) and put it on the map. */
  const buildPlace = (p: PlannedPlace): OpenWorldCity => {
    const { traffic: trafficOption, people: peopleOption, parkedCars = p.preset.parkedCars } = p.region.city || {};
    // 🏙️ The geometry tier (queue Q-2698), read as each place is built: the device decides, the player's Settings override it
    // (Auto quality off + Graphics low = light), and a place a game gave its own tier keeps it. The light tier stands the same
    // streets, buildings and colliders with fewer draw calls and triangles; a device with a real GPU draws exactly what it did.
    const tier = geometryTier(settings.get());
    const city = createCity({ tier, ...p.cityOptions });
    const plan = city.plan;
    const root = new THREE.Group(); root.name = 'Region ' + p.region.id;
    root.add(city.root);
    const traffic = trafficOption === false ? null : createCityTraffic(city, { count: p.preset.traffic, tier: city.tier, ...(trafficOption || {}) });
    if (traffic) root.add(traffic.root);
    const people = peopleOption === false ? null : createCityPeople(city, { traffic, count: p.preset.people, tier: city.tier, ...(peopleOption || {}) });
    if (people) root.add(people.root);
    const local = new THREE.Object3D(); root.add(local);
    // Built again after it was freed: the same cars, where they were (never a second set handed to ctx.vehicles).
    const parked: THREE.Object3D[] = p.parked ?? [];
    if (p.parked) for (const car of parked) root.add(car);
    else for (let i = 0; i < Math.max(0, Math.min(12, parkedCars)); i++) {
      // Beside the kerb of a north-south street, between two crossings, nose along the street.
      const sx = plan.streetsX[(i * 2 + 1) % plan.streetsX.length];
      const zi = i % Math.max(1, plan.streetsZ.length - 1);
      const z0 = plan.streetsZ[zi], z1 = plan.streetsZ[Math.min(plan.streetsZ.length - 1, zi + 1)];
      const car = createCar({ color: colours[(i + towns.length + paintShift) % colours.length] });
      car.position.set(sx + (plan.road / 2 - 1.3) * (i % 2 ? 1 : -1), city.heightAt(sx, (z0 + z1) / 2), z0 + (z1 - z0) * (0.3 + 0.4 * ((i * 0.37) % 1)));
      car.rotation.y = i % 2 ? Math.PI : 0;
      root.add(car); parked.push(car); ctx.vehicles.add(car);
    }
    p.parked = parked;
    const centre = p.centre;
    const built: OpenWorldCity = { id: p.region.id, kind: p.region.kind, city, traffic, people, parked, centre, radius: p.reach, toWorld: (x, z) => ({ x: centre.x + x, z: centre.z + z }) };
    p.built = towns.length;
    towns.push(built); roots.push(root); locals.push(local);
    root.position.set(centre.x - chunks.origin.x, centre.y, centre.z - chunks.origin.z);
    ctx.scene.add(root); root.updateMatrixWorld(true);
    return built;
  };
  // 🛣️ ROADS THAT NEVER END (admin 2026-11-22: "user kitni bhi gaadiyan chalaye — abhi 30 sec me hi road khatam ho jati hai").
  // Every place and land is joined to the network by a highway: a minimum spanning tree over their centres (each new place to its
  // nearest one), each road running from the edge of one to the edge of the other. The land is cut and filled to it by the map
  // itself (world.addRoad), so a car can drive from any place to every other — across a universe of a hundred places — without
  // the road running out. Laid before the first frame, like the levelled ground.
  // A place's streets fill a rectangle (±width/2, ±depth/2 around its centre; the edge street runs along its border): a road
  // ends ON that border, so it meets the edge street — never short of it in the grass, never inside the blocks on a diagonal.
  const stops: Array<{ x: number; z: number; r: number; hw?: number; hd?: number }> = [...planned.map((p) => { const pl = planCity(p.cityOptions); return { x: p.centre.x, z: p.centre.z, r: p.reach, hw: pl.width / 2, hd: pl.depth / 2 }; }), ...landList.map((l) => ({ x: l.centre.x, z: l.centre.z, r: Math.min(120, l.radius * 0.3) })), ...userMaps.map((m) => ({ x: m.centre.x, z: m.centre.z, r: m.size / 2 })),
    // A venue's road ends on the edge of its pad (never on the field).
    ...venueList.map((v) => ({ x: v.centre.x, z: v.centre.z, r: Math.max(v.width, v.depth) / 2, hw: v.width / 2 + 8, hd: v.depth / 2 + 8 }))];
  const roadGroup = new THREE.Group(); roadGroup.name = 'Highways';
  // Pulled a little towards the camera in the depth test (polygonOffset), so the ribbon never flickers against the carved
  // ground under it when seen from far away.
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const roadLines: Array<Array<{ x: number; y: number; z: number }>> = [];
  // A land joined to a place or land touches it: the two need no highway between them (any tile of a grown city counts).
  const stopIndex = (id: string): number[] => {
    const p = planned.find((q) => q.region.id === id);
    if (p) { const rootId = p.cluster?.root ?? p.region.id; return planned.map((q, i) => ((q.cluster?.root ?? q.region.id) === rootId ? i : -1)).filter((i) => i >= 0); }
    const l = landList.findIndex((q) => q.id === id); if (l >= 0) return [planned.length + l];
    const m = userMaps.findIndex((q) => q.id === id); if (m >= 0) return [planned.length + landList.length + m];
    const v = venueList.findIndex((q) => q.id === id); return v >= 0 ? [planned.length + landList.length + userMaps.length + v] : [];
  };
  const joinedPairs = new Set<string>();
  landList.forEach((l, i) => { if (l.joinedTo) for (const j of stopIndex(l.joinedTo)) { joinedPairs.add((planned.length + i) + ',' + j); joinedPairs.add(j + ',' + (planned.length + i)); } });
  // A venue beside a place stands at its edge: no highway between them either.
  venueList.forEach((v, i) => { const k = planned.length + landList.length + userMaps.length + i; if (v.joinedTo) for (const j of stopIndex(v.joinedTo)) { joinedPairs.add(k + ',' + j); joinedPairs.add(j + ',' + k); } });
  /** The road between two stops, from the edge of one to the edge of the other; null when they touch (no road needed). */
  const roadBetween = (A0: (typeof stops)[number], B0: (typeof stops)[number], dist: number): { from: { x: number; z: number }; to: { x: number; z: number } } | null => {
    const len = dist || 1;
    const ux = (B0.x - A0.x) / len, uz = (B0.z - A0.z) / len;
    if (len < A0.r + B0.r + 20) return null;                                                // touching places need no road
    // How far from a stop's centre, along the road, its edge is: the street rectangle's border for a place, the old ring else.
    const edge = (s: (typeof stops)[number]): number => (s.hw !== undefined && s.hd !== undefined
      ? Math.min(s.hw / Math.max(1e-6, Math.abs(ux)), s.hd / Math.max(1e-6, Math.abs(uz))) : s.r + 6);
    let ea = edge(A0), eb = edge(B0);
    if (ea + eb + 20 > len) { ea = A0.r + 6; eb = B0.r + 6; }                                // too close on a diagonal: the old ends
    return { from: { x: A0.x + ux * ea, z: A0.z + uz * ea }, to: { x: B0.x - ux * eb, z: B0.z - uz * eb } };
  };
  const roads: Array<{ from: { x: number; z: number }; to: { x: number; z: number } }> = [];
  // 🛣️ A ROAD A CAR CAN CLIMB (failedbr #2499). A road's ends stay on the levelled ground of the places it joins, so two places
  // on very different levels joined directly would get a climb steeper than a car can take. When the shortest tree has such a
  // pair, the tree is rebuilt from each stop's nearest neighbours with the steep pairs last: the two places are then joined
  // through a neighbour on a level between them, and a steep road is laid only where nothing else joins them.
  const stopY: Array<number | null> = [...planned.map((p) => p.centre.y), ...landList.map(() => null), ...userMaps.map((m) => m.centre.y), ...venueList.map((v) => v.centre.y)];
  const tooSteep = (a: number, b: number, d: number): boolean => {
    const ya = stopY[a], yb = stopY[b];
    if (ya === null || yb === null || ya === undefined || yb === undefined) return false;
    const road = roadBetween(stops[a], stops[b], d);
    return !!road && Math.abs(ya - yb) > 0.075 * Math.max(1, Math.hypot(road.to.x - road.from.x, road.to.z - road.from.z));
  };
  const highwayTree = (): Array<[number, number, number]> => {
    const tree = spanningPairs(stops);
    if (!tree.some(([a, b, d]) => !joinedPairs.has(a + ',' + b) && tooSteep(a, b, d))) return tree;          // the usual case
    const seen = new Set<string>(), edges: Array<[number, number, number, number]> = [];
    const add = (a: number, b: number, d: number): void => {
      const key = Math.min(a, b) + ',' + Math.max(a, b);
      if (seen.has(key)) return; seen.add(key);
      edges.push([a, b, d, joinedPairs.has(a + ',' + b) ? -1 : tooSteep(a, b, d) ? 1 : 0]);
    };
    for (const [a, b, d] of tree) add(a, b, d);
    stops.forEach((s, a) => {
      const near = stops.map((t, b) => [b, Math.hypot(t.x - s.x, t.z - s.z)] as [number, number]).filter(([b]) => b !== a).sort((p, q) => p[1] - q[1] || p[0] - q[0]).slice(0, 8);
      for (const [b, d] of near) add(a, b, d);
    });
    edges.sort((p, q) => p[3] - q[3] || p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
    const parent = stops.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const out: Array<[number, number, number]> = [];
    for (const [a, b, d] of edges) { const ra = find(a), rb = find(b); if (ra !== rb) { parent[ra] = rb; out.push([a, b, d]); } }
    return out;
  };
  if (stops.length > 1) {
    for (const best of highwayTree()) {
      if (joinedPairs.has(best[0] + ',' + best[1])) continue;                                // a joined land touches it
      const road = roadBetween(stops[best[0]], stops[best[1]], best[2]);
      if (road) roads.push(road);
    }
  }
  // 🧭 EVERY PLACE ASKED FOR GETS GROUND (reviewer of #4472: a list of 1,000 villages planned only 399 — the rest pointed at the
  // sea). A place with no dry ground where it was asked takes the nearest free, dry, level-enough ground around the first
  // place, ring by ring outward, staying as close as it can to the direction it was asked (a 45° cone first, then any side):
  // never on another place, never across a highway already planned (including a road just laid for a place that waited before
  // it), never past the edge of the map (half a looping world, so it never wraps onto the far side). It joins the network by
  // one road to its nearest stop that does not cut through another place. The places that found ground before, their roads
  // and the ground under them are exactly what they were.
  const rescued: PlannedPlace[] = [];
  if (waiting.length && planned[0]) {
    const home = planned[0].centre;
    const limit = map.world.mode === 'bounded' ? map.world.sizeMeters / 2 : Math.min(50000, map.world.sizeMeters * 0.45);
    // The planned roads in 1 km cells (by the box each one spans), so a spot looks only at the roads near it.
    const roadCells = new Map<string, number[]>(), RC = 1000;
    const indexRoad = (r: (typeof roads)[number], i: number): void => {
      for (let cx = Math.floor(Math.min(r.from.x, r.to.x) / RC); cx <= Math.floor(Math.max(r.from.x, r.to.x) / RC); cx++)
        for (let cz = Math.floor(Math.min(r.from.z, r.to.z) / RC); cz <= Math.floor(Math.max(r.from.z, r.to.z) / RC); cz++)
          (roadCells.get(cx + ',' + cz) || roadCells.set(cx + ',' + cz, []).get(cx + ',' + cz)!).push(i);
    };
    roads.forEach(indexRoad);
    const nearRoad = (x: number, z: number, clear: number): boolean => {
      for (let cx = Math.floor((x - clear) / RC); cx <= Math.floor((x + clear) / RC); cx++)
        for (let cz = Math.floor((z - clear) / RC); cz <= Math.floor((z + clear) / RC); cz++) {
          for (const i of roadCells.get(cx + ',' + cz) ?? []) {
            const r = roads[i], dx = r.to.x - r.from.x, dz = r.to.z - r.from.z, l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - r.from.x) * dx + (z - r.from.z) * dz) / l2));
            if (Math.hypot(x - (r.from.x + dx * t), z - (r.from.z + dz * t)) < clear) return true;
          }
        }
      return false;
    };
    const angDiff = (a: number, b: number): number => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
    const CONE = Math.PI / 4;                                                                // 45°: "in the direction it was asked"
    // A ring every rejected spot of which stays rejected for a place of the same size (taken ground only grows; water and
    // roads stay): the next place of that size starts there — only for the any-side fallback, so a later place can still
    // take nearer ground in its own direction.
    const fromRing = new Map<number, number>();
    const roadClear = (reach: number) => reach * 1.5 + 150;                                  // pad and slopes stay off the road
    const segmentHitsAPad = (ax: number, az: number, bx: number, bz: number, ignoreX: number, ignoreZ: number, ignoreR: number): boolean => {
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      return taken.some((ax + bx) / 2, (az + bz) / 2, Math.hypot(dx, dz) / 2 + 400, (t) => {
        if (Math.hypot(t.x - ignoreX, t.z - ignoreZ) < 1 && Math.abs(t.r - ignoreR) < 1) return false;
        if (Math.hypot(t.x - ax, t.z - az) < 1 || Math.hypot(t.x - bx, t.z - bz) < 1) return false;
        const u = Math.max(0, Math.min(1, ((t.x - ax) * dx + (t.z - az) * dz) / l2));
        return Math.hypot(t.x - (ax + dx * u), t.z - (az + dz * u)) < t.r + 150;
      });
    };
    for (const w of waiting) {
      const step = w.reach + 200, key = Math.round(w.reach);
      const look = (maxAng: number, start: number): { x: number; z: number; cost: number; ring: number } | null => {
        let found: { x: number; z: number; cost: number; ring: number } | null = null;
        for (let ring = start; ring * step <= limit && !found; ring++) {
          const r = ring * step, spots = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
          for (let k = 0; k < spots; k++) {
            const a = w.angle + (k / spots) * Math.PI * 2, ad = angDiff(a, w.angle);
            if (ad > maxAng) continue;
            const cx = home.x + Math.sin(a) * r, cz = home.z - Math.cos(a) * r;
            if (taken.some(cx, cz, w.reach + 140, (t) => Math.hypot(cx - t.x, cz - t.z) < t.r + w.reach + 140)) continue;
            if (nearRoad(cx, cz, roadClear(w.reach))) continue;
            let low = Number.POSITIVE_INFINITY, high = Number.NEGATIVE_INFINITY, wet = false;
            for (let i = -2; i <= 2 && !wet; i++) for (let j = -2; j <= 2; j++) {
              const x = cx + (i / 2) * w.hx, z = cz + (j / 2) * w.hz, h = map.world.heightAt(x, z);
              if (h < 2 || map.world.waterAt(x, z) || map.world.roadAt(x, z)) { wet = true; break; }
              low = Math.min(low, h); high = Math.max(high, h);
            }
            if (wet || high - low > 25) continue;                                             // a cliff is not a place to build
            const cost = ad * 1e6 + (high - low);                                             // the asked direction first, then flatter
            if (!found || cost < found.cost) found = { x: cx, z: cz, cost, ring };
          }
        }
        return found;
      };
      let found = look(CONE, 1) || look(Math.PI, fromRing.get(key) ?? 1);
      if (found) fromRing.set(key, found.ring);
      if (!found) { console.error('[world] no dry ground was found for "' + w.region.id + '" anywhere on the map; it was left out.'); continue; }
      const y = map.world.levelGround(found.x, found.z, w.hx, w.hz, 60);
      taken.push({ x: found.x, z: found.z, r: w.reach });
      const p: PlannedPlace = { region: w.region, preset: w.preset, cityOptions: w.cityOptions, centre: { x: found.x, y, z: found.z }, reach: w.reach, built: -1 };
      rescued.push(p);
      // One road to the nearest stop that does not cut through another place (a place that waited before it is already a stop).
      const pl = planCity(p.cityOptions);
      const me = { x: p.centre.x, z: p.centre.z, r: p.reach, hw: pl.width / 2, hd: pl.depth / 2 };
      const candidates = stops.map((s) => ({ s, d: Math.hypot(s.x - me.x, s.z - me.z) })).sort((a, b) => a.d - b.d);
      let chosen: { s: (typeof stops)[number]; d: number } | null = null;
      for (const c of candidates) {
        const road = roadBetween(c.s, me, c.d);
        if (road && segmentHitsAPad(road.from.x, road.from.z, road.to.x, road.to.z, me.x, me.z, me.r)) continue;
        chosen = c; break;
      }
      if (!chosen && candidates[0]) chosen = candidates[0];
      if (chosen) {
        const road = roadBetween(chosen.s, me, chosen.d);
        if (road) { roads.push(road); indexRoad(road, roads.length - 1); }
      }
      stops.push(me);
      planned.push(p);
    }
  }
  if (rescued.length) {
    const ids = rescued.slice(0, 8).map((p) => '"' + p.region.id + '"').join(', ') + (rescued.length > 8 ? ' and ' + (rescued.length - 8) + ' more' : '');
    console.error('[world] ' + rescued.length + ' place(s) had no dry ground where they were asked and stand on the nearest dry ground, as close as they can to the direction they were asked: ' + ids + '.');
  }
  // A highway never runs across a venue's ground: one that would is bent around the nearest corner of its pad.
  const venueBoxes = venueList.map((v) => ({ x0: v.centre.x - v.width / 2 - 12, x1: v.centre.x + v.width / 2 + 12, z0: v.centre.z - v.depth / 2 - 12, z1: v.centre.z + v.depth / 2 + 12 }));
  for (const road of roads) roadLines.push(map.world.addRoad(venueBoxes.length ? routeAroundVenues(road.from, road.to, venueBoxes) : [road.from, road.to], 9));
  /** One asphalt ribbon per road, a little above the carved ground, its faces pointing up. */
  for (const line of roadLines) {
    if (line.length < 2) continue;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 4.5, nz = dx / l * 4.5;
      pos.push(line[i].x + nx, line[i].y + 0.02, line[i].z + nz, line[i].x - nx, line[i].y + 0.02, line[i].z - nz);
      // Wound so every face points UP (+Y): a face pointing down is culled from above, and the road was invisible from the sky.
      if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, asphalt); mesh.receiveShadow = true; mesh.name = 'Highway';
    roadGroup.add(mesh);
  }
  // The first place is where the player starts: built now, and the player stands on one of its streets.
  if (planned[0]) {
    const home = buildPlace(planned[0]);
    spawn.x = home.centre.x + home.city.spawn.x; spawn.z = home.centre.z + home.city.spawn.z; spawn.y = home.centre.y + home.city.spawn.y;
  }
  const town: OpenWorldCity | null = towns[0] || null;
  map.update(spawn.x, spawn.z, 0, spawn.y);
  // The highways are drawn in WORLD metres: their group sits at minus the origin, and moves back with every origin shift.
  roadGroup.position.set(-chunks.origin.x, 0, -chunks.origin.z); ctx.scene.add(roadGroup);
  // The first place was put on the map before map.update() moved the origin: line it up again.
  towns.forEach((t, i) => { roots[i].position.set(t.centre.x - chunks.origin.x, t.centre.y, t.centre.z - chunks.origin.z); roots[i].updateMatrixWorld(true); });
  layGround(spawn.x, spawn.z);
  ctx.player.reset(spawn.x - chunks.origin.x, spawn.y + 0.2, spawn.z - chunks.origin.z);
  ctx.player.setWater(map.world.seaLevel);

  // 🏙️ THE NEAREST CITIES LIVE (map expansion item 4; owner decision: phone 2, mid 5, desktop 8). A city — all the tiles of a
  // grown city together — counts once. When the player nears a place and the budget is full, the standing city farthest from
  // the player is freed (its buildings, traffic, people and parked cars) only if it is already out of view (CITY_HIDE metres
  // past its edge, the same distance at which it is no longer drawn) and LIVE_MARGIN metres farther than the new one — so a
  // city never vanishes while the player can still see it, and walking between two places never builds and frees them back
  // and forth. If every standing city is still in view, the new place is still built (briefly one more than the budget) and
  // the extras are freed once they go out of view. The first place (world.city, where the player starts) and a city whose
  // car the player is driving are never freed. A freed place is built again on the way back.
  const groupOf = (p: PlannedPlace): string => p.cluster?.root ?? p.region.id;
  const homeGroup = planned[0] ? groupOf(planned[0]) : '';
  const standing = (): Map<string, PlannedPlace[]> => {
    const groups = new Map<string, PlannedPlace[]>();
    for (const q of planned) if (q.built >= 0) (groups.get(groupOf(q)) || groups.set(groupOf(q), []).get(groupOf(q))!).push(q);
    return groups;
  };
  const edgeDistance = (q: PlannedPlace, at: { x: number; z: number }): number => Math.hypot(at.x - q.centre.x, at.z - q.centre.z) - q.reach;
  const holdsSeat = (group: PlannedPlace[]): boolean => {
    const seat = ctx.vehicles.seated;
    if (!seat) return false;
    for (const q of group) for (let o: THREE.Object3D | null = seat; o; o = o.parent) if (o === roots[q.built]) return true;
    return false;
  };
  const freePlace = (q: PlannedPlace): void => {
    const i = q.built, t = towns[i];
    t.people?.dispose(); t.traffic?.dispose(); t.city.dispose(); ctx.scene.remove(roots[i]);
    for (const car of q.parked ?? []) roots[i].remove(car);
    towns.splice(i, 1); roots.splice(i, 1); locals.splice(i, 1);
    q.built = -1;
    for (const other of planned) if (other.built > i) other.built--;
  };
  const farthestOutOfView = (groups: Map<string, PlannedPlace[]>, at: { x: number; z: number }): { id: string; d: number } | null => {
    let farthest: { id: string; d: number } | null = null;
    for (const [id, group] of groups) {
      if (id === homeGroup || holdsSeat(group)) continue;
      const d = Math.min(...group.map((q) => edgeDistance(q, at)));
      if (d < CITY_HIDE) continue;                                          // still in view — never pop it out
      if (!farthest || d > farthest.d) farthest = { id, d };
    }
    return farthest;
  };
  const freeGroup = (groups: Map<string, PlannedPlace[]>, id: string): void => {
    for (const q of [...groups.get(id)!].sort((a, b) => b.built - a.built)) freePlace(q);
  };
  const roomFor = (p: PlannedPlace, at: { x: number; z: number }): boolean => {
    if (!Number.isFinite(liveBudget)) return true;
    const groups = standing();
    if (groups.has(groupOf(p)) || groups.size < liveBudget) return true;
    const near = edgeDistance(p, at);
    const farthest = farthestOutOfView(groups, at);
    if (farthest && farthest.d >= near + LIVE_MARGIN) freeGroup(groups, farthest.id);
    return true;                                                            // the place ahead still appears, even if nothing could be freed yet
  };
  /** When more cities stand than the budget, free the farthest that are already out of view. */
  const reapHidden = (at: { x: number; z: number }): void => {
    if (!Number.isFinite(liveBudget)) return;
    while (true) {
      const groups = standing();
      if (groups.size <= liveBudget) return;
      const farthest = farthestOutOfView(groups, at);
      if (!farthest) return;
      freeGroup(groups, farthest.id);
    }
  };
  const anchored = new Map<THREE.Object3D, { x: number; z: number; lowest: number; lift: number }>();
  let time = 0;
  // LATE GROUND EDITS (on unless world: { lateEdits: false }): a pad, land or road laid after this point redraws the map's
  // chunks and plants it touches, the walkable ground under the player is sampled again at once, and everything put down with
  // world.place() inside the changed area stands on the new ground.
  let groundEditsSeen = map.world.editCount ? map.world.editCount() : 0;
  /**
   * The edit count when the terrain was FIRST DRAWN (the map.update() above, before any feature's setup ran): edits after it,
   * without lateEdits, are never redrawn (the playtest says so). It used to be read at the first frame, so an edit a feature
   * made in its setup() — after the chunks were drawn — was neither redrawn nor reported.
   */
  const editsAtFirstFrame = map.world.editCount ? map.world.editCount() : 0;
  const playerWorld = () => {
    const p = ctx.player.object.position;
    return { x: p.x + chunks.origin.x, y: p.y, z: p.z + chunks.origin.z };
  };
  // 🏟️ A VENUE IS DRAWN when the player first comes near it: its field, its markings at their real sizes, and its stands,
  // walls, goals and sight screens solid to walk and drive into. Its surfaces lie a few centimetres over its level pad,
  // pulled towards the camera in the depth test, so they never flicker against the ground. The batsman, the ball, the
  // wickets and the players are the game's, never the world's.
  const venueMat = (color: number, lift: number, basic = false): THREE.Material => (basic
    ? new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -lift, polygonOffsetUnits: -2 * lift })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -lift, polygonOffsetUnits: -2 * lift }));
  const venueMats = {
    grass: venueMat(0x3e8a3a, 1), stripe: venueMat(0x469a40, 2), pitch: venueMat(0xc9b27c, 2), sand: venueMat(0xd6bf8c, 1),
    track: venueMat(0x34363a, 1), line: venueMat(0xf4f4f0, 3, true), solid: new THREE.MeshStandardMaterial({ color: 0xa3a8ae, roughness: 0.85 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.7 }), white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  };
  const buildVenue = (v: (typeof venueList)[number]): void => {
    const root = new THREE.Group();
    root.name = 'Venue ' + v.id;
    const flat = (w: number, d: number, x: number, z: number, y: number, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.name = name; root.add(m); return m;
    };
    const ring = (r: number, width: number, y: number, mat: THREE.Material, name: string, start = 0, length = Math.PI * 2, x = 0) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - width / 2, r + width / 2, Math.max(48, Math.round(r * 1.5)), 1, start, length), mat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, y, 0); m.name = name; root.add(m); return m;
    };
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.name = name; markWorldCollider(m, 'solid'); root.add(m); return m;
    };
    const L = 0.12, Y = 0.05, YL = 0.07;
    const outline = (w: number, d: number, x: number, z: number, name: string) => {
      flat(w + L, L, x, z - d / 2, YL, venueMats.line, name); flat(w + L, L, x, z + d / 2, YL, venueMats.line, name);
      flat(L, d, x - w / 2, z, YL, venueMats.line, name); flat(L, d, x + w / 2, z, YL, venueMats.line, name);
    };
    const football = () => {
      // 105 × 68 m along x, mown in stripes; its lines, circles, boxes and goals at FIFA sizes.
      flat(115, 78, 0, 0, Y, venueMats.grass, 'Field');
      for (let k = 0; k < 10; k += 2) flat(10.5, 68, -52.5 + 5.25 + k * 10.5, 0, Y + 0.005, venueMats.stripe, 'Field stripe');
      outline(105, 68, 0, 0, 'Touch line');
      flat(L, 68, 0, 0, YL, venueMats.line, 'Halfway line');
      ring(9.15, L, YL, venueMats.line, 'Centre circle');
      ring(0.15, 0.3, YL, venueMats.line, 'Centre spot');
      for (const side of [-1, 1]) {
        outline(16.5, 40.32, side * (52.5 - 8.25), 0, 'Penalty area');
        outline(5.5, 18.32, side * (52.5 - 2.75), 0, 'Goal area');
        ring(0.15, 0.3, YL, venueMats.line, 'Penalty spot', 0, Math.PI * 2, side * (52.5 - 11));
        const gx = side * (52.5 + 0.06);
        solid(0.12, 2.44, 0.12, gx, 0, -3.66, venueMats.white, 'Goal post'); solid(0.12, 2.44, 0.12, gx, 0, 3.66, venueMats.white, 'Goal post');
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 7.44), venueMats.white); bar.position.set(gx, 2.44, 0); bar.name = 'Crossbar'; root.add(bar);
      }
    };
    if (v.venue === 'cricket-ground') {
      // A 68 m boundary, the 30-yard circle, a 20.12 × 3.05 m pitch with its creases, and a sight screen behind each end.
      flat(150, 150, 0, 0, Y, venueMats.grass, 'Outfield');
      ring(68, 0.3, YL, venueMats.line, 'Boundary');
      ring(27.43, L, YL, venueMats.line, 'Inner circle');
      flat(3.05, 20.12, 0, 0, Y + 0.01, venueMats.pitch, 'Pitch');
      for (const end of [-1, 1]) {
        flat(2.64, L, 0, end * 10.06, YL, venueMats.line, 'Bowling crease');
        flat(3.66, L, 0, end * (10.06 - 1.22), YL, venueMats.line, 'Popping crease');
        solid(10, 4, 0.5, 0, 0, end * 71.5, venueMats.white, 'Sight screen');
      }
    } else if (v.venue === 'football-field') football();
    else if (v.venue === 'stadium') {
      // The football pitch inside four stands that step up and back, five rows each.
      football();
      const rows = 5;
      for (let k = 0; k < rows; k++) {
        const h = 1.2 * (k + 1);
        for (const side of [-1, 1]) {
          solid(115 + 4 * k * 2, h, 3.4, 0, 0, side * (39 + 1.7 + k * 3.4), k % 2 ? venueMats.seat : venueMats.solid, 'Stand');
          solid(3.4, h, 78, side * (57.5 + 1.7 + k * 3.4), 0, 0, k % 2 ? venueMats.seat : venueMats.solid, 'Stand');
        }
      }
    } else if (v.venue === 'race-circuit') {
      // Two 400 m straights and two bends of 100 m radius, 12 m wide, edged in white, with a start line.
      for (const side of [-1, 1]) {
        flat(400, 12, 0, side * 100, Y, venueMats.track, 'Track');
        flat(400, 0.3, 0, side * 94, YL, venueMats.line, 'Track edge'); flat(400, 0.3, 0, side * 106, YL, venueMats.line, 'Track edge');
        const start = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        ring(100, 12, Y, venueMats.track, 'Track', start, Math.PI, side * 200);
        ring(94, 0.3, YL, venueMats.line, 'Track edge', start, Math.PI, side * 200); ring(106, 0.3, YL, venueMats.line, 'Track edge', start, Math.PI, side * 200);
      }
      flat(1.5, 12, 0, 100, YL, venueMats.line, 'Start line');
    } else {
      // A 60 × 40 m sand floor inside a 1.5 m wall.
      flat(60, 40, 0, 0, Y, venueMats.sand, 'Arena floor');
      for (const side of [-1, 1]) {
        solid(60.8, 1.5, 0.4, 0, 0, side * 20.2, venueMats.solid, 'Arena wall'); solid(0.4, 1.5, 40, side * 30.2, 0, 0, venueMats.solid, 'Arena wall');
      }
    }
    root.scale.set(v.scale, 1, v.scale);
    root.position.set(v.centre.x - chunks.origin.x, v.centre.y, v.centre.z - chunks.origin.z);
    ctx.scene.add(root); venueRoots.push(root); v.root = root;
  };
  // 🗺️ THE MAP KNOWS THE WORLD (admin 2026-11-22: "jaise PUBG/Free Fire me location map … tap kar kar pura map aur location").
  // Every place, land and user map with its name, and every highway, handed to the Hud's corner map and full map in WORLD
  // metres. origin() turns the render positions the shell reads (the player, the vehicle it drives, every marker) into WORLD
  // metres, so the map stays right across origin shifts. A tile of a grown city is drawn but not named (its city is).
  const named = (region: WorldRegion): string => (typeof region.name === 'string' && region.name.trim() ? region.name.trim().slice(0, 40) : placeName(region.id));
  const regionOf = (id: string, kind: RegionKind): WorldRegion => wanted.find((r) => r && r.id === id) ?? { id, kind };
  const mapPlaces: WorldMapPlace[] = [
    ...planned.map((p): WorldMapPlace => ({ id: p.region.id, name: p.cluster && !p.region.name ? '' : named(p.region), kind: p.region.kind, x: p.centre.x, z: p.centre.z, radius: p.reach, shape: 'square' })),
    ...landList.map((l): WorldMapPlace => ({ id: l.id, name: named(regionOf(l.id, l.kind)), kind: l.kind, x: l.centre.x, z: l.centre.z, radius: l.radius, shape: 'circle' })),
    ...userMaps.map((m): WorldMapPlace => ({ id: m.id, name: named(regionOf(m.id, 'custom')), kind: 'custom', x: m.centre.x, z: m.centre.z, radius: m.size / 2, shape: 'square' })),
    ...venueList.map((v): WorldMapPlace => ({ id: v.id, name: named(regionOf(v.id, 'venue')), kind: 'venue', x: v.centre.x, z: v.centre.z, radius: Math.max(v.width, v.depth) / 2, shape: 'square' })),
  ];
  const unregisterMap = setWorldMapSource({ places: () => mapPlaces, roads: () => roadLines, origin: () => ({ x: chunks.origin.x, z: chunks.origin.z }) });
  // 🔎 THE PLAYTEST LOOKS AT WHAT IS DRAWN (admin 2026-11-23: "jo bhi banaye real lage, aise glitch na ho"). NavBharatAI's
  // playtest asks once, read-only, whether the drawn world agrees with the land: the drawn terrain against heightAt, any big
  // flat thing the GAME added (a grass plane, a floor) floating over or sunk under the hills, a road the game drew whose
  // faces point down (from above it is not drawn at all), and the player off the ground. The kit's own places, highways and
  // user maps are not judged here. It only READS the scene, never changes it, and stops after a fixed number of samples
  // or 150 ms, whichever is first: a big world answers with what it had time to measure.
  const geometryReport = () => {
    const t0 = performance.now(), late = () => performance.now() - t0 > 150;
    const o = chunks.origin, h = (x: number, z: number) => map.world.heightAt(x, z), r1 = (v: number) => Math.round(v * 10) / 10;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), box = new THREE.Box3();
    // 1. The drawn terrain: a chunk's grid vertices (never its skirt, which hangs below on purpose) against the land there.
    // A sample that is not a number (the drawn vertex or heightAt) is OFF and is counted on its own: NaN compared false with
    // every threshold, so a map whose ground had gone NaN everywhere was reported as 0 off (failedbr #2499).
    let samples = 0, off = 0, worst = 0, notNumber = 0;
    for (const chunk of chunks.group.children.slice(0, 48)) {
      const pos = ((chunk as THREE.Mesh).geometry as THREE.BufferGeometry | undefined)?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
      const n = pos ? Math.round(Math.sqrt(pos.count + 4) - 2) : 0;
      if (!pos || n < 2 || n * n + 4 * n !== pos.count || late()) continue;
      chunk.updateWorldMatrix(true, false);
      for (let k = 0; k < 9; k++) {
        a.fromBufferAttribute(pos, Math.min(n * n - 1, Math.floor(((k + 0.5) / 9) * n * n))).applyMatrix4(chunk.matrixWorld);
        const d = Math.abs(a.y - h(a.x + o.x, a.z + o.z));
        samples++; if (!(d <= 0.5)) off++;
        if (Number.isFinite(d)) worst = Math.max(worst, d); else notNumber++;
      }
    }
    // 2 and 3. What the GAME added: big flat meshes against the land under them, and road-named meshes' faces.
    const skip = new Set<THREE.Object3D>([chunks.group, ground, roadGroup, ctx.player.object, ...roots, ...venueRoots]);
    const slabs: Array<{ name: string; size: number; above: number; below: number }> = [];
    const roads: Array<{ name: string; down: number; faces: number }> = [];
    const label = (m: THREE.Object3D, g: THREE.BufferGeometry) => String(m.name || g.type || 'mesh').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 40);
    let seen = 0;
    const visit = (obj: THREE.Object3D): void => {
      if (skip.has(obj) || !obj.visible || ++seen > 4000 || late()) return;
      const mesh = obj as THREE.Mesh;
      const geo = mesh.isMesh && !(mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh ? (mesh.geometry as THREE.BufferGeometry | undefined) : undefined;
      const pos = geo?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
      if (geo && pos && pos.count >= 3) {
        mesh.updateWorldMatrix(true, false);
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean) as THREE.Material[];
        const wet = /water|lake|sea|ocean|river|pond|pool|pani|jheel|nadi/i.test(mesh.name) || mats.some((m) => m.transparent && m.opacity < 1);
        if (!geo.boundingBox) geo.computeBoundingBox();
        box.copy(geo.boundingBox!).applyMatrix4(mesh.matrixWorld);
        const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
        if (!wet && size >= 100 && box.max.y - box.min.y < 2 && slabs.length < 8) {
          const y = (box.min.y + box.max.y) / 2;
          let above = -Infinity, below = -Infinity, wrong = 0;
          for (const fx of [0.1, 0.5, 0.9]) for (const fz of [0.1, 0.5, 0.9]) {
            const x = box.min.x + (box.max.x - box.min.x) * fx, z = box.min.z + (box.max.z - box.min.z) * fz;
            const d = y - h(x + o.x, z + o.z);
            if (Math.abs(d) > 3) wrong++;
            above = Math.max(above, d); below = Math.max(below, -d);
          }
          if (wrong >= 2) slabs.push({ name: label(mesh, geo), size: Math.round(size), above: r1(above), below: r1(below) });
        }
        if (/road|highway|street|sadak|asphalt/i.test(mesh.name) && roads.length < 8 && !mats.some((m) => m.side === THREE.DoubleSide)) {
          const index = geo.getIndex(), tris = Math.floor((index ? index.count : pos.count) / 3), stride = Math.max(1, Math.floor(tris / 24));
          const flip = mesh.matrixWorld.determinant() < 0 ? -1 : 1;
          let down = 0, faces = 0;
          for (let t = 0; t < tris && faces < 24; t += stride) {
            const i0 = t * 3;
            a.fromBufferAttribute(pos, index ? index.getX(i0) : i0).applyMatrix4(mesh.matrixWorld);
            b.fromBufferAttribute(pos, index ? index.getX(i0 + 1) : i0 + 1).applyMatrix4(mesh.matrixWorld).sub(a);
            c.fromBufferAttribute(pos, index ? index.getX(i0 + 2) : i0 + 2).applyMatrix4(mesh.matrixWorld).sub(a);
            const nrm = b.clone().cross(c), len = nrm.length();
            if (len === 0 || Math.abs(nrm.y) < 0.7 * len) continue;   // only the faces that lie flat
            faces++; if (nrm.y * flip < 0) down++;
          }
          if (faces >= 4 && down > faces / 2) roads.push({ name: label(mesh, geo), down, faces });
        }
      }
      for (const child of obj.children) visit(child);
    };
    for (const child of ctx.scene.children) visit(child);
    // 4. The player on foot, on dry land: how far its feet are from the ground (null while driving or swimming).
    const at = playerWorld(), land = h(at.x, at.z);
    if (!Number.isFinite(land)) notNumber++;
    const player = ctx.vehicles.seated || land < map.world.seaLevel ? null : r1(at.y - land);
    // 5. Seams: where two joined tiles of one grown city meet, the ground 3 m into each side (they share one level by design).
    let seamSamples = 0, seamWorst = 0;
    const tiles = planned.filter((q) => q.cluster);
    for (let i = 0, pairs = 0; i < planned.length && pairs < 24 && !late(); i++) {
      const p = planned[i], pc = p.cluster ? [p.cluster.gx, p.cluster.gz] : [0, 0], pr = p.cluster?.root ?? p.region.id;
      for (const q of tiles) {
        if (q === p || q.cluster!.root !== pr || pairs >= 24) continue;
        const dx = q.cluster!.gx - pc[0], dz = q.cluster!.gz - pc[1];
        if (Math.abs(dx) + Math.abs(dz) !== 1 || dx < 0 || dz < 0) continue;             // each neighbouring pair once
        pairs++;
        const mx = (p.centre.x + q.centre.x) / 2, mz = (p.centre.z + q.centre.z) / 2;
        for (const t of [-0.3, 0, 0.3]) {
          const w = Math.hypot(q.centre.x - p.centre.x, q.centre.z - p.centre.z) || 1, ux = (q.centre.x - p.centre.x) / w, uz = (q.centre.z - p.centre.z) / w;
          const ex = mx - uz * t * w, ez = mz + ux * t * w;
          seamSamples++; seamWorst = Math.max(seamWorst, Math.abs(h(ex - ux * 3, ez - uz * 3) - h(ex + ux * 3, ez + uz * 3)));
        }
      }
    }
    // 6. Venues: each pad's corners (1 m in) and centre against the level it was laid at.
    const venuesOff = venueList.slice(0, 8).map((v) => {
      let offBy = 0;
      for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) offBy = Math.max(offBy, Math.abs(h(v.centre.x + fx * (v.width / 2 - 1), v.centre.z + fz * (v.depth / 2 - 1)) - v.centre.y));
      return { name: v.id.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 40), off: r1(offBy) };
    });
    // 7. Pending: without lateEdits, an edit after the first frame is never redrawn — the drawn chunks it overlaps whose grid
    // there is still the old ground. (With lateEdits they are being redrawn, a few per frame; nothing is said.)
    let dirty = 0;
    if (!lateEdits && editsAtFirstFrame >= 0 && map.world.editsSince && map.world.editCount && map.world.editCount() > editsAtFirstFrame) {
      const edits = map.world.editsSince(editsAtFirstFrame).slice(0, 64);
      for (const chunk of chunks.group.children.slice(0, 200)) {
        if (late()) break;
        const pos = ((chunk as THREE.Mesh).geometry as THREE.BufferGeometry | undefined)?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
        const n = pos ? Math.round(Math.sqrt(pos.count + 4) - 2) : 0;
        if (!pos || n < 2 || n * n + 4 * n !== pos.count) continue;
        chunk.updateWorldMatrix(true, false);
        let stale = false;
        for (let k = 0; k < n * n && !stale; k += Math.max(1, Math.floor((n * n) / 64))) {
          a.fromBufferAttribute(pos, k).applyMatrix4(chunk.matrixWorld);
          const wx = a.x + o.x, wz = a.z + o.z;
          if (!edits.some((e) => wx >= e.x0 && wx <= e.x1 && wz >= e.z0 && wz <= e.z1)) continue;
          if (Math.abs(a.y - h(wx, wz)) > 0.5) stale = true;
        }
        if (stale) dirty++;
      }
    }
    return { terrain: { samples, off, worst: r1(worst), notNumber }, slabs, roads, player, seams: { samples: seamSamples, worst: r1(seamWorst) }, venues: venuesOff, pending: { dirty }, ms: Math.round(performance.now() - t0) };
  };
  // 🔎 Where the player stands, for the placeholder look (gamePlaceholderProbe.ts): the feet, the land under them and the
  // water over that land (the sea where the land is below sea level, else a river or lake). Read-only.
  const standingReport = () => {
    const at = playerWorld(), land = map.world.heightAt(at.x, at.z), river = map.world.waterAt(at.x, at.z);
    const water = Math.max(land < map.world.seaLevel ? map.world.seaLevel : -Infinity, river ? river.surface : -Infinity);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return { feet: r1(at.y), land: r1(land), water: Number.isFinite(water) ? r1(water) : null, seated: !!ctx.vehicles.seated };
  };
  const probeHook = { geometry: geometryReport, standing: standingReport };
  const probeWindow = typeof window !== 'undefined' ? (window as unknown as { __nbWorld?: typeof probeHook }) : null;
  if (probeWindow) probeWindow.__nbWorld = probeHook;
  return {
    map, spawn, playerWorld, city: town, regions: towns, lands: landList, highways: roadLines,
    userMaps: userMaps.map((m) => ({ get id() { return m.id; }, get model() { return m.model; }, get centre() { return m.centre; }, get size() { return m.size; }, get status() { return m.status; }, get reason() { return m.reason; } })),
    venues: venueList.map((v): OpenWorldVenue => ({
      get id() { return v.id; }, get venue() { return v.venue; }, get centre() { return v.centre; }, get width() { return v.width; }, get depth() { return v.depth; },
      get joinedTo() { return v.joinedTo; }, get built() { return !!v.root; },
      toWorld: (x: number, z: number) => ({ x: v.centre.x + x * v.scale, y: v.centre.y, z: v.centre.z + z * v.scale }),
    })),
    places: planned.map((p) => ({ id: p.region.id, kind: p.region.kind, centre: { x: p.centre.x, z: p.centre.z }, radius: p.reach, get plan() { return planCity(p.cityOptions); }, get built() { return p.built >= 0; } })),
    nearestRegion() {
      const at = playerWorld();
      let found: { region: OpenWorldCity; distance: number } | null = null;
      for (const t of towns) { const d = Math.hypot(at.x - t.centre.x, at.z - t.centre.z); if (!found || d < found.distance) found = { region: t, distance: d }; }
      return found;
    },
    heightAt: (x, z) => map.world.heightAt(x, z),
    place(object, x, z, lift = 0) {
      object.userData.nbBody = true;
      object.position.set(x - chunks.origin.x, 0, z - chunks.origin.z);
      if (!object.parent) ctx.scene.add(object);
      const lowest = object.children.length ? localLowestY(object) : 0;
      object.position.y = restOriginY(map.world.heightAt(x, z), lowest, lift);
      anchored.set(object, { x, z, lowest, lift });
    },
    release(object) { anchored.delete(object); },
    frame(_ctx, delta) {
      time += delta;
      const at = playerWorld();
      const shift = map.update(at.x, at.z, time, at.y);
      if (shift) {
        // The render origin moved: everything that is not the map moves back by the same amount.
        ctx.player.object.position.x -= shift.dx; ctx.player.object.position.z -= shift.dz;
        ctx.camera.position.x -= shift.dx; ctx.camera.position.z -= shift.dz;
        for (const [object] of anchored) { object.position.x -= shift.dx; object.position.z -= shift.dz; }
        for (const root of roots) { root.position.x -= shift.dx; root.position.z -= shift.dz; }
        for (const root of userRoots) { root.position.x -= shift.dx; root.position.z -= shift.dz; }
        for (const root of venueRoots) { root.position.x -= shift.dx; root.position.z -= shift.dz; }
        roadGroup.position.x -= shift.dx; roadGroup.position.z -= shift.dz;
      }
      if (lateEdits && map.world.editCount) {
        const edits = map.world.editCount();
        if (edits !== groundEditsSeen) {
          const changed = map.world.editsSince ? map.world.editsSince(groundEditsSeen) : [];
          groundEditsSeen = edits; centre.x = Number.NaN; centre.z = Number.NaN;
          // What the game put down with place() inside a changed area stands on the new ground, not on the old one.
          for (const [object, a] of anchored) {
            if (changed.some((e) => a.x >= e.x0 && a.x <= e.x1 && a.z >= e.z0 && a.z <= e.z1)) object.position.y = restOriginY(map.world.heightAt(a.x, a.z), a.lowest, a.lift);
          }
        }
      }
      layGround(at.x, at.z);
      // A place still only planned is built when the player comes near it — at most one per frame, so walking towards a
      // cluster of places never stalls a frame on several cities at once.
      if (!Number.isFinite(liveBudget)) {
        for (const p of planned) {
          if (p.built >= 0) continue;
          if (Math.hypot(at.x - p.centre.x, at.z - p.centre.z) < p.reach + BUILD_AHEAD) { buildPlace(p); break; }
        }
      } else {
        // With a budget, the NEAREST place waiting is the one built (never a farther one that would only be freed again).
        let next: PlannedPlace | null = null, nextD = Infinity;
        for (const p of planned) {
          if (p.built >= 0) continue;
          const d = Math.hypot(at.x - p.centre.x, at.z - p.centre.z);
          if (d < p.reach + BUILD_AHEAD && d - p.reach < nextD) { next = p; nextD = d - p.reach; }
        }
        if (next && roomFor(next, at)) buildPlace(next);
      }
      // A user's map is loaded when the player comes near it (once; a failure is said, never retried in a loop).
      for (const m of userMaps) {
        if (m.status !== 'waiting' || Math.hypot(at.x - m.centre.x, at.z - m.centre.z) > m.size / 2 + BUILD_AHEAD) continue;
        m.status = 'loading';
        loadUserMap(m.model).then((object) => {
          if (disposed) return;                                                  // the game ended while it loaded
          // Sized to the ground it was given, standing on it, solid to walk and drive on.
          const box = new THREE.Box3().setFromObject(object), w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
          object.scale.multiplyScalar(m.size / w);
          const fit = new THREE.Box3().setFromObject(object);
          object.position.set(m.centre.x - chunks.origin.x - (fit.min.x + fit.max.x) / 2, m.centre.y - fit.min.y, m.centre.z - chunks.origin.z - (fit.min.z + fit.max.z) / 2);
          object.traverse((o) => { if ((o as THREE.Mesh).isMesh) markWorldCollider(o, 'solid'); });
          object.name = 'User map ' + m.id;
          ctx.scene.add(object); userRoots.push(object); m.root = object; m.status = 'loaded';
        }).catch((error) => { m.status = 'failed'; m.reason = String(error instanceof Error ? error.message : error).slice(0, 200); console.error('[world] the map "' + m.id + '" could not be loaded from ' + userMapUrl(m.model) + ': ' + m.reason); });
      }
      // A venue is drawn when the player first comes near it (one per frame), and hidden while it is far out of view.
      let venueBuilt = false;
      for (const v of venueList) {
        const d = Math.hypot(at.x - v.centre.x, at.z - v.centre.z), r = Math.max(v.width, v.depth) / 2;
        if (!v.root) { if (venueBuilt || d > r + BUILD_AHEAD) continue; buildVenue(v); venueBuilt = true; }
        v.root!.visible = d < r + CITY_HIDE;
      }
      // A place lives only while the player is near it: far ones are not drawn, and only the near ones run their streets.
      const seated = ctx.vehicles.seated;
      towns.forEach((t, i) => {
        const d = Math.hypot(at.x - t.centre.x, at.z - t.centre.z);
        roots[i].visible = d < t.radius + CITY_HIDE;
        if (d > t.radius + 500) return;
        locals[i].position.set(at.x - t.centre.x, at.y - t.centre.y, at.z - t.centre.z);
        t.traffic?.update(delta, seated ? [locals[i], seated] : [locals[i]]);
        t.people?.update(delta, [locals[i]]);
        // ⛔ NOTHING PASSES THROUGH A VEHICLE (admin 2026-11-22: "jab bhi 2 object takrayenge to aar paar nahi jane chahiye"):
        // the player on foot — or the car they drive — is pushed out of any traffic car it ran into, every frame.
        if (seated) t.traffic?.pushOut(seated, 1.2); else t.traffic?.pushOut(ctx.player.object, 0.45);
      });
      reapHidden(at);
    },
    dispose() {
      ctx.scene.remove(ground); geometry.dispose(); (ground.material as THREE.Material).dispose();
      disposed = true;
      towns.forEach((t, i) => { t.people?.dispose(); t.traffic?.dispose(); t.city.dispose(); ctx.scene.remove(roots[i]); });
      for (const root of userRoots) ctx.scene.remove(root);
      userRoots.length = 0;
      for (const root of venueRoots) { ctx.scene.remove(root); root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
      venueRoots.length = 0;
      for (const m of Object.values(venueMats)) m.dispose();
      ctx.scene.remove(roadGroup); roadGroup.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); asphalt.dispose();
      ctx.scene.remove(chunks.group); anchored.clear(); map.dispose();
      unregisterMap();
      if (probeWindow && probeWindow.__nbWorld === probeHook) delete probeWindow.__nbWorld;
    },
  };
}

// ── EXPLORATION — what there is to DO on the big map before the game adds its own rules (template round R6; ideas studied
// from open-source open-world games, our own code). Discover each place by walking into it ("Discovered: Rampur"), collect
// relics laid along the highways (or around the start in open country), and follow a hint to the nearest place not found
// yet. Progress is saved on the device. Every number below is an option; <OpenWorldGame explore={false} /> turns it all off.
export interface ExploreOptions {
  /** Relics laid on the map (along the highways, else in a ring around the start). Default 12; 0 = none. */
  relics?: number;
  /** How close the player must come to take a relic, metres. Default 2.5. */
  reach?: number;
  /** Where progress is kept on the device. Default 'open-world-explore-v1'. */
  saveKey?: string;
  /** Names for places (region id → name); a place without one is named from its id. */
  names?: Record<string, string>;
  /** Seed for where relics go (default: the map's seed, so a map always has the same relics). */
  seed?: number;
}
export interface ExploreSave { found: string[]; relics: number[] }
export interface ExploreStatus {
  found: number; places: number; relics: number; relicsTotal: number;
  /** The nearest place not found yet: its name, metres away and a compass word; null when all are found. */
  next: { name: string; distance: number; way: string } | null;
  /** The last thing that happened ("Discovered: Rampur", "Relic 3 of 12"), for a moment. */
  toast: string;
}
type Flat = { x: number; z: number };

/** A small seeded random source (mulberry32), so a map's relics always stand in the same places. */
export function exploreRandom(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 0x6d2b79f5;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Eight compass words for a heading from a to b (north is -z, east is +x, as on the corner map). */
export function compassWay(from: Flat, to: Flat): string {
  const words = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const angle = Math.atan2(to.x - from.x, -(to.z - from.z));
  return words[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
}
/**
 * Where the relics go: spread along the highways by length, else in a ring 40–140 m around the start (open country, or
 * a single place — then outside its radius). Optional ok (the exploration uses land: height at least 2 and not water)
 * retries a point that fails; without ok the first pick is kept, so a seed still matches. PURE given its inputs.
 */
export function relicSpots(count: number, highways: ReadonlyArray<ReadonlyArray<Flat>>, spawn: Flat, seed: number, keepOut = 0, ok?: (p: Flat) => boolean): Flat[] {
  const n = Math.max(0, Math.min(200, Math.floor(count)));
  if (!n) return [];
  const rand = exploreRandom(seed);
  const segs: Array<[Flat, Flat, number]> = [];
  for (const line of highways) for (let i = 1; i < line.length; i++) { const d = Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z); if (d > 0) segs.push([line[i - 1], line[i], d]); }
  const total = segs.reduce((t, s) => t + s[2], 0);
  const out: Flat[] = [];
  const take = (p: Flat) => !ok || ok(p);
  if (total > 50) {
    for (let k = 0; k < n; k++) {
      let hit: Flat | undefined;
      for (let t = 0; t < 16 && !hit; t++) {
        let at = (t === 0 ? (k + 0.25 + rand() * 0.5) / n : rand()) * total;
        for (const [a, b, d] of segs) { if (at <= d) { const f = at / d; const p = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }; if (take(p)) hit = p; break; } at -= d; }
      }
      if (hit) out.push(hit);
    }
    return out;
  }
  const inner = Math.max(40, keepOut + 15);
  for (let k = 0; k < n; k++) {
    let hit: Flat | undefined;
    for (let t = 0; t < 16 && !hit; t++) {
      const angle = (k / n) * Math.PI * 2 + rand() * 0.4, r = inner + rand() * (100 + t * 20);
      const p = { x: spawn.x + Math.sin(angle) * r, z: spawn.z - Math.cos(angle) * r };
      if (take(p)) hit = p;
    }
    if (hit) out.push(hit);
  }
  return out;
}
/** Read a save safely: anything broken starts fresh. */
export function readExploreSave(raw: unknown): ExploreSave {
  const s = raw as Partial<ExploreSave> | null;
  const found = Array.isArray(s?.found) ? s.found.filter((x): x is string => typeof x === 'string').slice(0, 2000) : [];
  const relics = Array.isArray(s?.relics) ? s.relics.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < 1000) : [];
  return { found: [...new Set(found)], relics: [...new Set(relics)] };
}
/** Places the player stands in now (inside the radius) that were not found before. PURE. */
export function newlyFound(places: ReadonlyArray<{ id: string; centre: Flat; radius: number }>, found: ReadonlyArray<string>, at: Flat): string[] {
  return places.filter((p) => !found.includes(p.id) && Math.hypot(p.centre.x - at.x, p.centre.z - at.z) <= Math.max(20, p.radius)).map((p) => p.id);
}
/** The nearest place not found yet, or null. PURE. */
export function nearestUnfound(places: ReadonlyArray<{ id: string; centre: Flat }>, found: ReadonlyArray<string>, at: Flat): { id: string; distance: number; way: string } | null {
  let best: { id: string; distance: number; way: string } | null = null;
  for (const p of places) {
    if (found.includes(p.id)) continue;
    const d = Math.hypot(p.centre.x - at.x, p.centre.z - at.z);
    if (!best || d < best.distance) best = { id: p.id, distance: Math.round(d), way: compassWay(at, p.centre) };
  }
  return best;
}

export interface Exploration { update(ctx: GameContext, delta: number): void; status(): ExploreStatus; dispose(): void }
/** Discovery, relics and the next-place hint on an OpenWorld. The starter runs it; a game of your own can too. */
export function createExploration(ctx: GameContext, world: OpenWorld, options: ExploreOptions = {}): Exploration {
  const key = options.saveKey ?? 'open-world-explore-v1';
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  let save: ExploreSave;
  try { save = readExploreSave(JSON.parse(storage?.getItem(key) ?? 'null')); } catch { save = readExploreSave(null); }
  const keep = () => { try { storage?.setItem(key, JSON.stringify(save)); } catch { /* storage can be blocked */ } };
  const nameOf = (id: string) => options.names?.[id] ?? placeName(id);
  const first = world.places[0];
  const onLand = (p: Flat) => world.heightAt(p.x, p.z) >= 2 && !world.map?.world?.waterAt?.(p.x, p.z);
  const spots = relicSpots(options.relics ?? 12, world.highways, world.spawn, options.seed ?? world.map.world.seed, first && world.places.length === 1 ? first.radius : 0, onLand);
  const reach = Math.max(0.5, options.reach ?? 2.5);
  // RELIC LOOK: a slowly turning golden gem on a soft glow. Change it here.
  const gem = new THREE.OctahedronGeometry(0.45);
  const gold = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x8a5a00, metalness: 0.5, roughness: 0.3 });
  const meshes = spots.map((p, i) => {
    const m = new THREE.Mesh(gem, gold); m.name = 'Relic ' + (i + 1);
    m.visible = !save.relics.includes(i);
    ctx.scene.add(m); world.place(m, p.x, p.z, 1.1);
    return m;
  });
  let toast = '', toastT = 0, spin = 0;
  const say = (line: string) => { toast = line; toastT = 3; };
  return {
    update(_ctx, delta) {
      const dt = Number.isFinite(delta) && delta > 0 ? Math.min(delta, 0.25) : 0;
      toastT = Math.max(0, toastT - dt); spin += dt;
      const at = world.playerWorld();
      const fresh = newlyFound(world.places, save.found, at);
      if (fresh.length) { save.found.push(...fresh); say('Discovered: ' + nameOf(fresh[0])); keep(); }
      spots.forEach((p, i) => {
        const m = meshes[i];
        if (!m.visible) return;
        m.rotation.y = spin * 1.5 + i;
        if (Math.hypot(p.x - at.x, p.z - at.z) <= reach && Math.abs(world.heightAt(p.x, p.z) - at.y) < 4) {
          m.visible = false; save.relics.push(i); keep();
          say(save.relics.length === spots.length ? 'All ' + spots.length + ' relics found!' : 'Relic ' + save.relics.length + ' of ' + spots.length);
        }
      });
    },
    status() {
      const at = world.playerWorld(), next = nearestUnfound(world.places, save.found, at);
      return { found: save.found.filter((id) => world.places.some((p) => p.id === id)).length, places: world.places.length,
        relics: save.relics.filter((i) => i < spots.length).length, relicsTotal: spots.length,
        next: next ? { name: nameOf(next.id), distance: next.distance, way: next.way } : null, toast: toastT > 0 ? toast : '' };
    },
    dispose() { for (const m of meshes) { world.release(m); ctx.scene.remove(m); } gem.dispose(); gold.dispose(); },
  };
}
`;

// The player's body now ships with the shell (every game on the kit swaps its character in src/game/player.ts); the open
// world still lists it so its recipe stays complete on its own.
export { GAME_PLAYER_BODY, GAME_PLAYER_BODY_PATH };

export const GAME_OPEN_WORLD_STARTER = String.raw`// THE OPEN-WORLD STARTER — a character on NavBharatAI's big map, playable as it stands: the kit's own animated person,
// the follow camera, the joystick and keys, terrain that streams as you walk, roads, plants, rivers, the sea and the sky.
// THIS FILE IS A STARTING POINT. A later request may change any of it: the character, the rules, a level, the controls,
// the graphics, the sounds, the language, the UI, or the whole genre. Edit this file when its props do not reach the ask.
// Make the first version through its props: setup() adds things (cars, enemies, pickups, missions) and update() runs rules.
// EXPLORING comes built in (explore prop): discover places by walking into them, collect relics along the roads, and a hint
// to the nearest place not found yet — saved on the device. explore={false} turns it off; explore={{ relics: 30 }} tunes it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GameCanvas } from './GameCanvas';
import type { GameContext, GameOptions, MinimapOptions } from './Game';
import { createExploration, createOpenWorld, type Exploration, type ExploreOptions, type ExploreStatus, type OpenWorld, type OpenWorldOptions } from './play/openWorld';
import { createFeatureHost, type FeatureHost, type GameFeature } from './play/features';
import type { PlayerChoice } from './play/playerBody';

export interface OpenWorldGameProps {
  title?: string;
  subtitle?: string;
  /** The map: seed, profile, size, quality, style — see play/openWorld.ts and athree/. */
  world?: OpenWorldOptions;
  /**
   * THE GAME, as a list of features (play/features.ts): each adds one thing, each is guarded, and adding one more never
   * touches the others. Keep the list in src/game/features/index.ts.
   */
  features?: ReadonlyArray<GameFeature<OpenWorld>>;
  /**
   * WHO THE PLAYER IS: the kit person's look (colours, height, build), a character model from the game library, or the
   * user's own model file. Keep it in src/game/player.ts — changing the character is changing that one file. The shell
   * applies it (and reads that file by itself when this is left out).
   */
  player?: PlayerChoice;
  /** Add your game to the world. Runs once, after the player is standing on the map. */
  setup?: (ctx: GameContext, world: OpenWorld) => void;
  /** Your rules, at a fixed 60 Hz, after the world has streamed for this step. */
  update?: (ctx: GameContext, world: OpenWorld, delta: number) => void;
  /**
   * THE MAP, the user's to shape (like PUBG / Free Fire): a round map in a corner with the roads and the names of places, and a
   * tap on it (or M) opens the whole world with pan, zoom and a waypoint. { corner: 'right' } moves it, { size: 200 } makes it
   * bigger (80–240), { names: false } hides the names, { range: 400 } shows more around the player, { fullMap: false } keeps it
   * small only; false turns the map off. The player can also hide the corner map in Settings → Minimap.
   */
  map?: MinimapOptions | boolean;
  /**
   * EXPLORING: places to discover, relics to collect (12 along the roads) and a hint to the nearest place not found yet.
   * On by default; false turns it off; { relics: 0 } keeps discovery without relics; { names: { 'old-town': 'Rampur' } }.
   */
  explore?: ExploreOptions | boolean;
  /** Any other shell option (camera, touch buttons, language, music …). */
  options?: Omit<GameOptions, 'container' | 'setup' | 'update'>;
}

export function OpenWorldGame({ title = 'Open World', subtitle, world: worldOptions, features, player, map = true, explore = true, setup, update, options }: OpenWorldGameProps) {
  const world = useRef<OpenWorld | null>(null);
  const exploring = useRef<Exploration | null>(null);
  const [found, setFound] = useState<ExploreStatus | null>(null);
  const host = useRef<FeatureHost<OpenWorld> | null>(null);
  const listed = useRef(features); listed.current = features;
  const hooks = useRef({ setup, update }); hooks.current = { setup, update };
  const gameOptions = useMemo<Omit<GameOptions, 'container'>>(() => ({
    camera: 'third-person', gameId: 'open-world', minimap: map,
    startScreen: { title, ...(subtitle ? { subtitle } : {}) },
    ...(player ? { player } : {}),
    ...options,
    setup(ctx) {
      world.current = createOpenWorld(ctx, worldOptions);
      exploring.current?.dispose(); exploring.current = null;
      if (explore !== false) {
        const names: Record<string, string> = {};
        for (const r of worldOptions?.regions ?? []) if (r.name) names[r.id] = r.name;
        exploring.current = createExploration(ctx, world.current, { names, ...(explore === true ? {} : explore) });
      }
      hooks.current.setup?.(ctx, world.current);
      host.current = createFeatureHost<OpenWorld>(listed.current || []);
      host.current.setup(ctx, world.current);
    },
    update(ctx, delta) {
      if (!world.current) return;
      world.current.frame(ctx, delta);
      exploring.current?.update(ctx, delta);
      hooks.current.update?.(ctx, world.current, delta);
      host.current?.update(ctx, world.current, delta);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useEffect(() => {
    const id = setInterval(() => { if (exploring.current) setFound(exploring.current.status()); }, 250);
    return () => { clearInterval(id); exploring.current?.dispose(); exploring.current = null; };
  }, []);
  const chip = { background: '#0f172acc', color: 'white', borderRadius: 8, padding: '4px 10px', fontSize: 13 } as const;
  return <>
    <GameCanvas options={gameOptions} />
    {/* THE EXPLORING BAR — places found, relics, the next place and the last discovery. Move or restyle it here. */}
    {found && <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }}>
      {found.places > 0 && <span style={chip}>📍 {found.found}/{found.places} places</span>}
      {found.relicsTotal > 0 && <span style={chip}>💎 {found.relics}/{found.relicsTotal}</span>}
      {found.next && <span style={chip}>Next: {found.next.name} · {found.next.distance} m {found.next.way}</span>}
      {found.toast && <span style={{ ...chip, background: '#15803dee', fontWeight: 600 }}>{found.toast}</span>}
    </div>}
  </>;
}

export default OpenWorldGame;
`;

/** The bridge's own MAX_REGIONS (places and lands on one map), for the recipe's words — a test keeps the two equal. */
export const OPEN_WORLD_MAX_REGIONS = 1000;
export const OPEN_WORLD_BRIDGE_PATH = 'src/game/play/openWorld.ts';
export const OPEN_WORLD_STARTER_PATH = 'src/game/OpenWorldGame.tsx';

/** The App that mounts the starter — written by the platform only where no game is mounted yet. */
export function openWorldAppSource(options: { city?: boolean; title?: string } = {}): string {
  const title = String(options.title ?? 'Open World').replace(/[^\p{L}\p{N} .,!?'-]/gu, '').trim().slice(0, 60) || 'Open World';
  return [
    "import { OpenWorldGame } from './game/OpenWorldGame';",
    "import { FEATURES } from './game/features';",
    "import { WORLD } from './game/world';",
    "import { PLAYER } from './game/player';",
    '',
    '// The player is already standing on NavBharatAI\'s big map' + (options.city ? ', on a street of its city' : '') + '. Make it your game through the',
    '// FEATURES list in src/game/features/index.ts: one small file per thing the game has (coins, enemies, missions, rules).',
    '// The MAP grows the same way: its places (city, town, village) are the regions list in src/game/world.ts.',
    '// The world, the player and the camera are the kit\'s.',
    'export default function App() {',
    `  return <OpenWorldGame title=${JSON.stringify(title)} world={WORLD} player={PLAYER} features={FEATURES} />;`,
    '}',
    '',
  ].join('\n');
}

export const GAME_FEATURES_INDEX_PATH = 'src/game/features/index.ts';
/** The game's own list of features — the user's file (never a kit file): created once, then only ever added to. */
export const GAME_FEATURES_INDEX = [
  '// THIS GAME, AS A LIST. Each feature is one file in this folder that adds one thing to the game.',
  '// To ADD something: create src/game/features/<name>.ts with defineFeature({ id, setup, update }) and add it to the list below.',
  '// To CHANGE one thing: edit only that feature\'s file. To REMOVE it: take it out of the list. Nothing else needs to change.',
  "import type { GameFeature } from '../play/features';",
  "import type { OpenWorld } from '../play/openWorld';",
  '',
  'export const FEATURES: GameFeature<OpenWorld>[] = [',
  '];',
  '',
].join('\n');

export { GAME_PLAYER_FILE, GAME_PLAYER_FILE_PATH };

export const GAME_WORLD_FILE_PATH = 'src/game/world.ts';
/** The game's own map — the user's file (never a kit file): created once, then only ever added to. */
const SEEDABLE_REGION_KINDS = new Set(['city', 'town', 'village', 'desert', 'jungle', 'mountain', 'snow', 'beach']);
/**
 * The regions the first build lays down, from the places the user named (AgentV3/worldSetting.ts). Anything that is not a
 * plain { id, kind } of a known place or land is dropped, so a malformed input can never write a broken world.ts. PURE.
 */
export function seedRegions(regions: unknown): Array<{ id: string; kind: string }> {
  if (!Array.isArray(regions)) return [];
  const out: Array<{ id: string; kind: string }> = [];
  const ids = new Set<string>();
  for (const r of regions) {
    const id = String((r as { id?: unknown })?.id ?? ''), kind = String((r as { kind?: unknown })?.kind ?? '');
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(id) || !SEEDABLE_REGION_KINDS.has(kind) || ids.has(id)) continue;
    ids.add(id); out.push({ id, kind });
  }
  return out.slice(0, 60);
}

export function gameWorldFileSource(options: { city?: boolean; regions?: unknown; workspaceId?: string } = {}): string {
  const named = seedRegions(options.regions);
  const seed = options.workspaceId
    ? varietySeed(options.workspaceId, 'world')
    : 7;
  return [
    '// THIS GAME\'S MAP. The land is NavBharatAI\'s big Athree map; the places on it are the regions list below.',
    '// To make the map BIGGER: add one more region (a city, a town or a village; say which way with toward, or leave it out).',
    "// To make ONE CITY bigger: add tiles that join it ({ id: '<its id>-2', kind: 'city', joinTo: '<its id>' }).",
    '// A land is a region too: kind desert, jungle, mountain, snow, beach or grassland (an open grass field).',
    '// To lay the places across a size the user asked for: spreadMeters (for example 40000 for 40 km x 40 km).',
    '// To change ONE place: edit only its entry (city: { blocksX, blocksZ, style, traffic: { count }, people: { count }, parkedCars }).',
    '// The first region is where the player starts. Nothing else needs to change.',
    "import type { OpenWorldOptions } from './play/openWorld';",
    '',
    'export const WORLD: OpenWorldOptions = {',
    '  seed: ' + seed + ',',
    '  regions: [',
    // The places the user named, in their order (worldSetting.ts); without any, the city the request implied, or open country.
    ...(named.length
      ? named.map((r) => `    { id: '${r.id}', kind: '${r.kind}' },`)
      : options.city ? ["    { id: 'main-city', kind: 'city' },"] : []),
    '  ],',
    '};',
    '',
  ].join('\n');
}

export function generateOpenWorld(): RecipeOutput {
  return {
    files: { [OPEN_WORLD_BRIDGE_PATH]: GAME_OPEN_WORLD_BRIDGE, [OPEN_WORLD_STARTER_PATH]: GAME_OPEN_WORLD_STARTER, [GAME_PLAYER_BODY_PATH]: GAME_PLAYER_BODY, [WORLD_LAYER_PATH]: GAME_WORLD_LAYER },
    dependencies: [],
    instructions: [
      'Added the open-world starter: src/game/OpenWorldGame.tsx and src/game/play/openWorld.ts. It JOINS the Athree map and the game shell —',
      'the kit\'s animated player walks on the map\'s own ground (never y = 0), the follow camera, joystick and keys work, the terrain streams',
      'as the player moves, and the floating origin is handled. Render it and the game is playable:',
      '```tsx',
      "import { OpenWorldGame } from './game/OpenWorldGame';",
      'export default function App() {',
      '  return <OpenWorldGame title="My World" world={{ city: true }}',
      '    setup={(ctx, world) => { /* add YOUR game: world.place(object, x, z) puts a thing on the ground at a WORLD place */ }}',
      '    update={(ctx, world, dt) => { /* YOUR rules, 60 Hz. world.playerWorld() is where the player is, in WORLD metres */ }} />;',
      '}',
      '```',
      'GROW THE GAME BY FEATURES (src/game/play/features.ts): every thing the game has is ONE file, src/game/features/<name>.ts —',
      "  export default defineFeature<OpenWorld>({ id: 'coins', setup(ctx, world, api) { /* add objects; return a value to share */ }, update(ctx, world, dt, api) { /* rules */ } });",
      'and one line in the FEATURES list in src/game/features/index.ts, passed as <OpenWorldGame features={FEATURES} />. A feature that needs',
      'another names it in needs: [\'coins\'] and reads what it shared with api.get(\'coins\'). Each feature is guarded: one that throws is switched',
      'off and named in the console, and the rest of the game keeps running. To add the next thing, add the next file — never rewrite the others.',
      'GROW THE MAP BY REGIONS: world={{ regions: [{ id: \'main-city\', kind: \'city\' }, { id: \'old-town\', kind: \'town\', toward: \'east\' }, { id: \'hill-village\', kind: \'village\' }] }}',
      'stands each place on its own levelled ground, spread across the map with open country and roads between them (up to ' + OPEN_WORLD_MAX_REGIONS + ', places and lands together;',
      'a far place\'s city is built only when the player comes near). Keep the list in src/game/world.ts; a bigger map is ONE more entry.',
      'A bigger CITY is tiles that join it: { id: \'main-city-2\', kind: \'city\', joinTo: \'main-city\' }. A land is a region',
      'of kind desert, jungle, mountain, snow, beach or grassland (an open grass field: thick grass, bushes, stones, a few lone trees). spreadMeters: 40000 lays the places',
      'across 40 km x 40 km. world.regions lists them and world.nearestRegion() says where the player is.',
      'world={{ city: true }} levels ground near the start and stands a city on it (streets, crossings, pavements, shops, apartments, offices,',
      'parks), with traffic that obeys the lights, people who cross on the zebras, and parked cars the player gets into with Use (E). world.city',
      'gives the city, its traffic, its people, the parked cars and toWorld(x, z) for its lots and routes. Pass city options',
      '({ blocksX, blocksZ, style, traffic: { count }, people: { count }, parkedCars }) to change it, or leave city out for open country.',
      'THE MAP IS ALREADY THERE (like PUBG / Free Fire): a round map in the top-left corner shows the highways and the places near the',
      'player with their names, and a tap on it (or M) opens the WHOLE world full screen — every place and land named, the roads, the player',
      'and its heading; drag to pan, pinch or scroll to zoom, tap to drop a waypoint that the corner map then shows with its distance. Never',
      'draw your own minimap or map screen. Do what the user says through the map prop of <OpenWorldGame>: "map right corner me" →',
      'map={{ corner: \'right\' }}; "bada minimap" → map={{ size: 200 }} (80–240 px); "naam mat dikhao" → map={{ names: false }}; "aur door tak',
      'dikhao" → map={{ range: 400 }} (metres); "full map nahi chahiye" → map={{ fullMap: false }}; "map band karo" → map={false}. A place\'s',
      'name on the map is its region name in src/game/world.ts ({ id: \'old-town\', kind: \'town\', name: \'Rampur\' }), else made from its id.',
      'RULES: never write your own world, ground plane, player, character controller, camera or game loop beside it; never set a position to',
      'y = 0 — use world.heightAt(x, z) or world.place(); positions you read from Three objects are RENDER metres (world metres minus',
      'world.map.chunks.origin) — use world.playerWorld() and world.place() and you never need to convert.',
    ].join('\n'),
  };
}
