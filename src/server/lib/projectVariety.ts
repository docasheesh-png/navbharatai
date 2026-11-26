// 🎲 EVERY NEW GAME GETS ITS OWN LOOK, AND KEEPS IT (external Game Maker audit, admin-approved 2026-11-25: "six new games
// should not all get the same hero, the same car and the same city — and 'ek dukaan jodo' must never change the hero or the
// map").
//
// 🔑 THE CLASS: a starting choice the platform makes for a new game (the player's look, the car's paint, the city's
// buildings) was a CONSTANT — `seed: 7`, `color: 0xb42b2b`, `seed: 11 + n * 17` — so every game of a kind looked the same.
// A random pick would fix the sameness and break the other half: an edit re-runs the code, and a random draw would hand an
// existing game a new hero or a new city on "add a shop".
//
// 🧬 THE FIX, ONE RULE FOR EVERY FACET: a choice is DETERMINISTIC in the project's own id (the workspace id) and a facet
// name, drawn from a pool the game's kind can use, and WRITTEN INTO THE PROJECT'S OWN FILES the first time (a race's
// src/game/car.ts is created once, never replaced; the open world's cities are derived by the kit from WORLD.seed in
// src/game/world.ts, which is created once in the same way). After that the file is the answer: an edit reads it, the kit
// derives everything else from what it holds, and nothing is drawn again. Same id ⇒ same choice; different ids ⇒ spread
// across the pool. PURE.
import { createHash } from 'node:crypto';

/** A number in [0, size) fixed by the project id and the facet ('car-paint', 'world', 'player'…). PURE. */
export function varietyIndex(projectId: string, facet: string, size: number): number {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  const digest = createHash('sha256').update(facet + ':' + String(projectId ?? '')).digest();
  return digest.readUInt32BE(0) % n;
}

/**
 * A whole 32-bit seed fixed by the project id and the facet (never 0) — for a choice that is a number, not a pool entry
 * (the open world's WORLD.seed). The same digest as varietyIndex, so the two never disagree about a project. PURE.
 */
export function varietySeed(projectId: string, facet: string): number {
  return createHash('sha256').update(facet + ':' + String(projectId ?? '')).digest().readUInt32BE(0) || 1;
}

/** The pool entry this project gets for this facet. PURE. */
export function pickVariant<T>(projectId: string, facet: string, pool: readonly T[]): T {
  if (!pool.length) throw new Error('pickVariant: empty pool');
  return pool[varietyIndex(projectId, facet, pool.length)];
}

/**
 * Seven paints for a new race's car (src/game/car.ts CAR.color). All read as a car under the kit's lights and stand apart
 * from the road, the rivals' colours do not matter (each rival has its own). The first is the kit's old default red.
 */
export const STARTER_CAR_PAINTS: readonly number[] = [0xb42b2b, 0x1d4ed8, 0xf59e0b, 0x15803d, 0xe5e7eb, 0x7c3aed, 0x0f766e];

/** The paint a new race's car starts with, fixed by the project. PURE. */
export function starterCarPaint(projectId: string): number {
  return pickVariant(projectId, 'car-paint', STARTER_CAR_PAINTS);
}

// 🏘️🏁 THE TOWN AND THE RACE ROAD, TOO (Q-3373, admin-approved 2026-11-26). The action town (createActionTown) and the race
// road (the kit's twelve-map road) are made by calls the BUILDER writes, so the kit cannot know the project id — the seed has
// to live in a file of the game, as WORLD.seed does for the open world. src/game/gameSeed.ts is that file: written by the
// platform from the project's id the first time the kit file that reads a facet is CREATED (a game made before this keeps the
// kit's defaults — giving it a seed on a later turn would move its town or its road), and from then on only ever added to.

export const GAME_SEED_FILE_PATH = 'src/game/gameSeed.ts';
/** The facets the file can hold: town (createActionTown) and road (the race road's land and start map). */
export type GameSeedFacet = 'town' | 'road';
/** The race road's twelve maps (Game3DGenerator RACING_ROAD_MAPS ids): the one a new race starts on. */
export const ROAD_START_MAPS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** The `key: value` lines one facet adds to GAME_SEED, fixed by the project. PURE. */
export function gameSeedLines(projectId: string, facet: GameSeedFacet): string[] {
  if (facet === 'town') return [`  town: ${varietySeed(projectId, 'town')},`];
  return [`  road: ${varietySeed(projectId, 'road')},`, `  roadStart: ${pickVariant(projectId, 'road-start', ROAD_START_MAPS)},`];
}

const GAME_SEED_HEAD = [
  "// THIS GAME'S OWN START, written once by NavBharatAI when the game was made, so it does not open in the same town or on",
  "// the same race road as every other game. The kit reads it by itself: town is the action town's shuffle (createActionTown",
  "// in src/game/three/buildings.ts), road and roadStart are the race road's land and the map it starts on (1-12). Change a",
  "// number for a different town or road; delete a line for the kit's default.",
  'export const GAME_SEED: { town?: number; road?: number; roadStart?: number } = {',
];
const GAME_SEED_LINE = /^ {2}(?:town|road|roadStart): \d+,$/;

/** The whole file for these facets. PURE. */
export function gameSeedFileSource(projectId: string, facets: readonly GameSeedFacet[]): string {
  return [...GAME_SEED_HEAD, ...facets.flatMap((f) => gameSeedLines(projectId, f)), '};', ''].join('\n');
}

/**
 * Is this, byte for byte, a seed file the platform wrote (its own header, only its own `key: number,` lines, in any order the
 * platform added them)? A file anyone edited is not. Lets platformAuthored see it as ours, not the builder's code. PURE.
 */
export function isUneditedGameSeedFile(content: string | null | undefined): boolean {
  const lines = String(content ?? '').split('\n');
  if (lines.length < GAME_SEED_HEAD.length + 2 || lines[lines.length - 1] !== '' || lines[lines.length - 2] !== '};') return false;
  if (GAME_SEED_HEAD.some((l, i) => lines[i] !== l)) return false;
  return lines.slice(GAME_SEED_HEAD.length, -2).every((l) => GAME_SEED_LINE.test(l));
}

/**
 * `existing` with the facets it does not hold yet added (every other byte kept); null when nothing is to be added, or when the
 * file is no longer in a shape the platform can add to safely (then it is the user's, and it is left alone). PURE.
 */
export function withGameSeedFacets(existing: string, projectId: string, facets: readonly GameSeedFacet[]): string | null {
  const text = String(existing);
  const missing = facets.filter((f) => !new RegExp(`^\\s*${f}\\s*:`, 'm').test(text));
  if (!missing.length) return null;
  const head = /export const GAME_SEED\b[^=]*=\s*\{/.exec(text);
  if (!head) return null;
  const close = text.indexOf('\n};', head.index + head[0].length - 1);
  if (close < 0) return null;
  return text.slice(0, close + 1) + missing.flatMap((f) => gameSeedLines(projectId, f)).join('\n') + text.slice(close);
}
