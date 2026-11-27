// 🤖 THE ROBOT CHECKS — the map checks itself before anyone plays it (admin 2026-11-27, wave 1 part 1).
//
// The admin's order for a map is a frame → a boundary nobody crosses → water → a ground nobody falls through → roads → colonies of
// houses between the roads. Each layer has a way to go wrong that a screenshot does not show: a hero spawned in a lake, a house on a
// road, a road network in two pieces, a prop under the ground, a gap in the boundary that lets a car drive off the world. These checks
// measure each of those on the REAL world (the seed the game chose, at runtime) and report every failure — they never fix or hide one.
//
// This is the ONE implementation: it is emitted into the game as src/game/athree/mapChecks.ts, and the tests run the emitted code
// against real worlds (tests/helpers/loadAthree.ts), so every claim is a measurement. Pure: no three.js, no DOM except the optional
// window hook that lets the playtest read the result. Own implementation.

export const MAP_CHECKS = `// Athree map — robot checks: spawn on dry land, nothing in water or on a road, a connected road graph, nothing under the ground,
// a closed boundary. Each check says whether it applies to this world and, when it fails, exactly where.
// Technique: point sampling against the world's own height, water and road functions; union-find over the road graph; a sampled
// ring at the frame's edge. Own implementation.

import type { AthreeWorld } from './world';

export type MapCheckId = 'spawn-dry' | 'lots-clear' | 'roads-connected' | 'above-ground' | 'boundary-closed';

export interface MapCheckResult {
  id: MapCheckId;
  /** False when the check does not apply to this world (no roads yet, no lots placed, a loop world with no edge). */
  applicable: boolean;
  /** True when it passed, or when it does not apply. */
  ok: boolean;
  /** One plain sentence: what was measured, and where it failed. */
  detail: string;
}

export interface MapChecksReport {
  ok: boolean;
  failed: MapCheckId[];
  results: MapCheckResult[];
}

/** A plot for a house (the colonies layer, or the game's own). */
export interface MapLot { x: number; z: number; radius?: number; name?: string }
/** Something the game stood on the ground (a house, a prop, a character). */
export interface MapPlaced { x: number; y: number; z: number; name?: string }

export interface MapCheckOptions {
  /** How many player and vehicle spawns to test (default 8 each). */
  spawns?: number;
  lots?: ReadonlyArray<MapLot>;
  placed?: ReadonlyArray<MapPlaced>;
  /** Points on the boundary ring (default 96). */
  ringSamples?: number;
  /** A place nobody can pass (the boundary layer's own answer). Without it, only the sea counts as closed. */
  blockedAt?: (x: number, z: number) => boolean;
  /** How far under the ground a placed thing may sink before it counts as below (default 0.05 m). */
  tolerance?: number;
}

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();
const at = (x: number, z: number): string => '(' + fmt(x) + ', ' + fmt(z) + ')';

function wet(world: AthreeWorld, x: number, z: number): boolean {
  return world.waterAt(x, z) !== null || world.heightAt(x, z) < world.seaLevel;
}

function onRoad(world: AthreeWorld, x: number, z: number): boolean {
  return world.roadAt(x, z) !== null || world.gameRoadAt(x, z);
}

/** 1. Every spawn the game would use stands on dry land (not a river, a lake or the sea). */
export function checkSpawnDry(world: AthreeWorld, count = 8): MapCheckResult {
  const bad: string[] = [];
  let tested = 0;
  for (const kind of ['player', 'vehicle'] as const) {
    for (const s of world.spawnPoints(kind, count)) {
      tested++;
      if (wet(world, s.x, s.z)) bad.push(kind + ' at ' + at(s.x, s.z));
    }
  }
  if (tested === 0) return { id: 'spawn-dry', applicable: true, ok: false, detail: 'The world gave no spawn point at all, so nobody can be placed.' };
  return bad.length
    ? { id: 'spawn-dry', applicable: true, ok: false, detail: bad.length + ' of ' + tested + ' spawns are in water: ' + bad.slice(0, 4).join('; ') + '.' }
    : { id: 'spawn-dry', applicable: true, ok: true, detail: 'All ' + tested + ' player and vehicle spawns are on dry land.' };
}

/** 2. No lot (a house's plot) is in water, under the sea or on a road — its centre and four points on its edge are tested. */
export function checkLotsClear(world: AthreeWorld, lots: ReadonlyArray<MapLot> = []): MapCheckResult {
  if (lots.length === 0) return { id: 'lots-clear', applicable: false, ok: true, detail: 'No house lots were placed on this map yet.' };
  const bad: string[] = [];
  for (const lot of lots) {
    const r = Math.max(0, Number(lot.radius) || 0);
    const pts: Array<[number, number]> = [[lot.x, lot.z], [lot.x + r, lot.z], [lot.x - r, lot.z], [lot.x, lot.z + r], [lot.x, lot.z - r]];
    const name = lot.name || 'lot';
    if (pts.some(([x, z]) => wet(world, x, z))) bad.push(name + ' at ' + at(lot.x, lot.z) + ' is in water');
    else if (pts.some(([x, z]) => onRoad(world, x, z))) bad.push(name + ' at ' + at(lot.x, lot.z) + ' is on a road');
  }
  return bad.length
    ? { id: 'lots-clear', applicable: true, ok: false, detail: bad.length + ' of ' + lots.length + ' lots are not clear: ' + bad.slice(0, 4).join('; ') + '.' }
    : { id: 'lots-clear', applicable: true, ok: true, detail: 'All ' + lots.length + ' lots are on dry land and off the roads.' };
}

/** 3. The home region's highways join every village they serve into ONE network (union-find over the villages). */
export function checkRoadsConnected(world: AthreeWorld): MapCheckResult {
  const region = world.homeRoads();
  const highways = region.roads.filter((r) => r.kind === 'highway' && r.from >= 0 && r.to >= 0);
  if (highways.length === 0) return { id: 'roads-connected', applicable: false, ok: true, detail: 'This map has no village highways to join (too small for roads, or roads are off).' };
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(a, r);
    return r;
  };
  for (const r of highways) {
    if (!parent.has(r.from)) parent.set(r.from, r.from);
    if (!parent.has(r.to)) parent.set(r.to, r.to);
    parent.set(find(r.from), find(r.to));
  }
  const groups = new Set([...parent.keys()].map(find));
  return groups.size > 1
    ? { id: 'roads-connected', applicable: true, ok: false, detail: 'The roads are in ' + groups.size + ' separate pieces: ' + parent.size + ' villages, ' + highways.length + ' highways, and not every village can be driven to from every other.' }
    : { id: 'roads-connected', applicable: true, ok: true, detail: 'All ' + parent.size + ' villages are joined by ' + highways.length + ' highways into one network.' };
}

/** 4. Nothing stands below the ground: every spawn, and everything the game placed, is at or above heightAt. */
export function checkAboveGround(world: AthreeWorld, placed: ReadonlyArray<MapPlaced> = [], count = 8, tolerance = 0.05): MapCheckResult {
  const bad: string[] = [];
  const things: MapPlaced[] = [...placed];
  for (const kind of ['player', 'vehicle'] as const) for (const s of world.spawnPoints(kind, count)) things.push({ x: s.x, y: s.y, z: s.z, name: kind + ' spawn' });
  for (const p of things) {
    const ground = world.drivableHeightAt(p.x, p.z);
    if (!Number.isFinite(p.y) || !Number.isFinite(ground)) bad.push((p.name || 'something') + ' at ' + at(p.x, p.z) + ' has no real height');
    else if (p.y < ground - tolerance) bad.push((p.name || 'something') + ' at ' + at(p.x, p.z) + ' is ' + fmt(ground - p.y) + ' m under the ground');
  }
  return bad.length
    ? { id: 'above-ground', applicable: true, ok: false, detail: bad.length + ' of ' + things.length + ' are below the ground: ' + bad.slice(0, 4).join('; ') + '.' }
    : { id: 'above-ground', applicable: true, ok: true, detail: 'All ' + things.length + ' spawns and placed things are on or above the ground.' };
}

/**
 * 5. The boundary is closed: every point on a ring at the frame's edge is a place nobody can pass — the sea, or whatever the boundary
 * layer says is blocked. A loop world has no edge (it wraps), so the check does not apply to it.
 */
export function checkBoundaryClosed(world: AthreeWorld, samples = 96, blockedAt?: (x: number, z: number) => boolean): MapCheckResult {
  if (world.mode === 'loop') return { id: 'boundary-closed', applicable: false, ok: true, detail: 'A loop world wraps at its edges; there is no boundary to close.' };
  const radius = world.sizeMeters / 2;
  const n = Math.max(8, Math.floor(samples));
  const open: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const closed = world.heightAt(x, z) < world.seaLevel || (blockedAt ? blockedAt(x, z) : false);
    if (!closed) open.push(at(x, z));
  }
  return open.length
    ? { id: 'boundary-closed', applicable: true, ok: false, detail: open.length + ' of ' + n + ' points on the edge ring are open land a player could cross: ' + open.slice(0, 4).join('; ') + '.' }
    : { id: 'boundary-closed', applicable: true, ok: true, detail: 'All ' + n + ' points on the edge ring are closed.' };
}

/** Every robot check, in the admin's order. Never throws: a check that crashes is reported as failed, with its error. */
export function runMapChecks(world: AthreeWorld, options: MapCheckOptions = {}): MapChecksReport {
  const count = Math.max(1, Math.floor(options.spawns ?? 8));
  const runs: Array<[MapCheckId, () => MapCheckResult]> = [
    ['boundary-closed', () => checkBoundaryClosed(world, options.ringSamples, options.blockedAt)],
    ['spawn-dry', () => checkSpawnDry(world, count)],
    ['above-ground', () => checkAboveGround(world, options.placed, count, options.tolerance)],
    ['roads-connected', () => checkRoadsConnected(world)],
    ['lots-clear', () => checkLotsClear(world, options.lots)],
  ];
  const results = runs.map(([id, run]) => {
    try { return run(); } catch (error) { return { id, applicable: true, ok: false, detail: 'The check could not run: ' + (error instanceof Error ? error.message : String(error)) }; }
  });
  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  return { ok: failed.length === 0, failed, results };
}

/**
 * Run the checks once and leave the result where the playtest can read it (window.__nbMapChecks), and print every failure to the
 * console. Call it after createAthreeMap and after the game has placed its lots and props.
 */
export function publishMapChecks(world: AthreeWorld, options: MapCheckOptions = {}): MapChecksReport {
  const report = runMapChecks(world, options);
  const g = globalThis as unknown as { __nbMapChecks?: () => MapChecksReport };
  g.__nbMapChecks = () => report;
  for (const r of report.results) if (!r.ok) console.warn('[map check] ' + r.id + ': ' + r.detail);
  return report;
}
`;
