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
