// 🗺️ THE MAP PLAN AS DATA — written into a game's config.ts, read back from it, saved to the user's map library and reused
// (admin 2026-11-27, wave 2 part 2).
//
// mapPlanWiring.ts writes the plan into src/game/athree/config.ts as `export const MAP_PLAN = {…} as const;` and merges the plan's world
// options into MAP_OPTIONS. Three features need the SAME plan back, and must never each grow their own reader:
//   • changing one layer by chat (mapLayerEdit.ts) — read the game's current plan, change one field, write it back;
//   • the map preview — the seed and the world profile the game uses;
//   • the map library — save a plan, and reuse it in a new game.
// This module is that one reader and writer, and the one checker: a plan from a file the user may have edited, or from the library,
// is accepted only when every kind is one the planner knows (`checkedMapPlanData`). Anything else is "not readable", said plainly.
//
// PURE: no I/O. Never throws.

import { ARCHETYPES, clampSizeKm, mapOptionsFor, type Archetype, type MapChoice } from './athreeMapKinds';
import { REGIONS, type BoundaryKind, type Density, type MapGameType, type MapPlan, type RegionFlavour, type RoadStyle, type TimeOfDay } from './mapPlan';
import type { MapProfile } from './athreeMapLibrary';
import { ALL_PROFILES } from './athreeMapLibrary';
import { parseSavedMapPlan, type SavedMapPlan } from '../../../lib/mapPreview';

export type { SavedMapPlan };

export const BOUNDARY_KINDS: readonly BoundaryKind[] = ['sea', 'mountains', 'canyon', 'forest-river', 'dunes', 'wall'];
export const ROAD_STYLES: readonly RoadStyle[] = ['grid', 'highway', 'organic', 'hill', 'straight'];
export const DENSITIES: readonly Density[] = ['sparse', 'normal', 'dense'];
export const MAP_GAME_TYPES: readonly MapGameType[] = ['on-foot', 'shooter', 'rpg', 'driving', 'racing', 'flight', 'boating', 'battle-royale', 'explore', 'unknown'];
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['dawn', 'day', 'evening', 'night'];
/** The seed every Athree world uses when none is given (createAthreeWorld: `options.seed ?? 1`). */
export const WORLD_DEFAULT_SEED = 1;

/** A checked plan: every kind is one the planner and the world know. */
export interface MapPlanData extends SavedMapPlan {
  archetype: Archetype;
  boundary: BoundaryKind;
  roadStyle: RoadStyle;
  density: Density;
  region: RegionFlavour | null;
  gameType: MapGameType;
  timeOfDay: TimeOfDay | null;
  profile: MapProfile;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A plan from anywhere (a config file, the library, a request body) → a checked plan, or null. */
export function checkedMapPlanData(raw: unknown): MapPlanData | null {
  const p = parseSavedMapPlan(raw);
  if (!p) return null;
  if (!(p.archetype in ARCHETYPES) || !BOUNDARY_KINDS.includes(p.boundary as BoundaryKind) || !ROAD_STYLES.includes(p.roadStyle as RoadStyle)
    || !DENSITIES.includes(p.density as Density) || !MAP_GAME_TYPES.includes(p.gameType as MapGameType) || !ALL_PROFILES.includes(p.profile as MapProfile)) return null;
  if (p.region !== null && !(p.region in REGIONS)) return null;
  if (p.timeOfDay !== null && !TIMES_OF_DAY.includes(p.timeOfDay as TimeOfDay)) return null;
  if (p.hours !== null && (p.hours < 0 || p.hours > 24)) return null;
  const sideKm = round2(clampSizeKm(p.sideKm));
  return { ...p, sideKm, areaKm2: round2(Math.min(p.areaKm2, sideKm * sideKm * 1.0001)), seed: p.seed | 0 } as MapPlanData;
}

/** The plan as data, with the seed and the profile the game's world is built with. */
export function mapPlanData(plan: MapPlan, seed: number, profile: MapProfile): MapPlanData {
  return {
    areaKm2: plan.areaKm2, sideKm: plan.sideKm, archetype: plan.archetype, boundary: plan.boundary, water: { ...plan.water },
    roadStyle: plan.roadStyle, density: plan.density, region: plan.region, gameType: plan.gameType,
    timeOfDay: plan.timeOfDay, hours: plan.hours, seed: seed | 0, profile,
  };
}

/** The MapPlan a saved or edited plan stands for: every field is the user's (it was planned, then kept or changed on their words). */
export function mapPlanFromData(d: MapPlanData, note?: string): MapPlan {
  const choice: MapChoice = { archetype: d.archetype, sizeKm: d.sideKm };
  return {
    areaKm2: d.areaKm2, sideKm: d.sideKm, areaSource: 'user', archetype: d.archetype, archetypeSource: 'user', boundary: d.boundary, boundarySource: 'user',
    water: { ...d.water }, waterRefused: false,
    roadStyle: d.roadStyle, roadStyleSource: 'user', density: d.density, region: d.region, gameType: d.gameType, timeOfDay: d.timeOfDay, hours: d.hours,
    choice, notes: note ? [note] : [],
  };
}

const PLAN_RE = /export const MAP_PLAN = (\{[\s\S]*?\n\}) as const;/;
const ASSIGN_SEED_RE = /\nObject\.assign\(MAP_OPTIONS, \{ seed: (-?\d+) \}\);\n/;

/**
 * The plan a game's config.ts holds, or null (no plan, or one the user edited into a shape the planner does not know). A plan written
 * before the seed was recorded has the world's default seed and the open-world profile — exactly what that game's world used.
 */
export function readMapPlanFromConfig(config: string | null | undefined): MapPlanData | null {
  const text = String(config ?? '');
  const m = PLAN_RE.exec(text);
  if (!m) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(m[1]) as Record<string, unknown>; } catch { return null; }
  const s = ASSIGN_SEED_RE.exec(text);
  return checkedMapPlanData({
    ...raw,
    seed: typeof raw.seed === 'number' ? raw.seed : s ? Number(s[1]) : WORLD_DEFAULT_SEED,
    profile: typeof raw.profile === 'string' ? raw.profile : 'open-world',
  });
}

/** The world options a plan sets in MAP_OPTIONS (mapPlan.mapPlanWorldOptions, from data). */
export function worldOptionsOf(d: MapPlanData): { areaKm2: number; boundary: BoundaryKind; water: MapPlanData['water']; roadStyle: RoadStyle; density: Density } {
  return { areaKm2: d.areaKm2, boundary: d.boundary, water: { ...d.water }, roadStyle: d.roadStyle, density: d.density };
}

/** The block mapPlanWiring appends to config.ts. One writer, so a plan written at build time and one rewritten by an edit are the same text. */
export function mapPlanBlock(d: MapPlanData): string {
  const data = {
    areaKm2: d.areaKm2, sideKm: d.sideKm, archetype: d.archetype, boundary: d.boundary, water: d.water, roadStyle: d.roadStyle, density: d.density,
    region: d.region, gameType: d.gameType, timeOfDay: d.timeOfDay, hours: d.hours, seed: d.seed, profile: d.profile,
  };
  return '\n/** THE MAP PLAN (what the user asked for, read by NavBharatAI\'s map planner). Keep it when editing the game; change it only when the user changes the map. */\n'
    + 'export const MAP_PLAN = ' + JSON.stringify(data, null, 2) + ' as const;\n'
    + '/** The plan\'s layer wishes go to createAthreeWorld with the rest of MAP_OPTIONS; a world that does not read one yet ignores it. */\n'
    + 'Object.assign(MAP_OPTIONS, ' + JSON.stringify(worldOptionsOf(d)) + ');\n'
    + '/** The map\'s seed — the one its preview and its build-time checks used. Keep it, and pass no other seed to createAthreeMap: the picture the user saw is then the map they play. */\n'
    + `Object.assign(MAP_OPTIONS, { seed: ${d.seed | 0} });\n`;
}

/**
 * Rewrite the plan in a config.ts that already carries one: the MAP_PLAN block is replaced, and when the frame changed MAP_OPTIONS'
 * own body (mode, size, style) is written for the new size. Everything else in the file is kept byte for byte. null when the file
 * is not in the shape the platform wrote (the user edited the plan by hand): then nothing is changed on a guess.
 */
export function rewriteMapPlanInConfig(config: string, d: MapPlanData, frameChanged: boolean): string | null {
  const text = String(config ?? '');
  const start = text.indexOf('\n/** THE MAP PLAN (what the user asked for');
  if (start < 0 || !PLAN_RE.test(text)) return null;
  // The block runs from its comment to the last Object.assign the platform wrote after it.
  const tail = text.slice(start);
  const assigns = [...tail.matchAll(/\nObject\.assign\(MAP_OPTIONS, [^\n]*\);\n/g)];
  if (assigns.length === 0) return null;
  const last = assigns[assigns.length - 1];
  const end = start + (last.index ?? 0) + last[0].length;
  let head = text.slice(0, start);
  if (frameChanged) {
    const body = /(export const MAP_OPTIONS: MapOptions = )(\{[\s\S]*?\n\}|\{\});\n/.exec(head);
    if (!body) return null;
    const o = mapOptionsFor({ archetype: d.archetype, sizeKm: d.sideKm });
    head = head.slice(0, body.index) + body[1] + JSON.stringify({ mode: o.mode, sizeMeters: o.sizeMeters, style: o.style }, null, 2) + ';\n' + head.slice(body.index + body[0].length);
  }
  return head + mapPlanBlock(d) + text.slice(end);
}
