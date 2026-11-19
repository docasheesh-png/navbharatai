// The maps the library knows (category `maps`). Athree is the first and, today, the only one — so the librarian's random pick is a
// pool of one until another map exists; the pick logic (athreeMapIntent.ts) is already written for a pool of many.
//
// 100% ours: every line of the map is NavBharatAI's own code (docs/game-engine/athree-map-plan.md); no third-party asset.

export type MapProfile = 'open-world' | 'racing' | 'battle-royale' | 'flight' | 'explore';

export interface LibraryMap {
  id: string;
  name: string;
  /** The game shapes this map fits; the librarian only picks among maps whose profiles include the request's. */
  profiles: readonly MapProfile[];
  /** Other spellings a user may type for this map's name. */
  aliases: readonly string[];
  license: { spdx: string; evidenceUrl: string; attribution: string };
  /** The recipe tool that writes the map into a game. */
  recipe: string;
  /** Present only when the map is switched on for the build (AGENTV3_ATHREE_MAP, default on). */
  summary: string;
}

export const ALL_PROFILES: readonly MapProfile[] = ['open-world', 'racing', 'battle-royale', 'flight', 'explore'];

export const ATHREE_MAP: LibraryMap = {
  id: 'athree',
  name: 'Athree map',
  profiles: ALL_PROFILES,
  aliases: ['athree', 'a-three', 'a three', 'a3 map', 'athree map'],
  license: { spdx: 'LicenseRef-NavBharatAI-own', evidenceUrl: 'docs/game-engine/athree-map-plan.md', attribution: 'NavBharatAI — own work, admin-authorized' },
  recipe: 'generate_athree_map',
  summary: 'Seeded streaming world: 100 km seamless loop or an 8 km island; terrain, sea level, biomes, shared wind, safe spawn points, physics heightfield data.',
};

export const LIBRARY_MAPS: readonly LibraryMap[] = [ATHREE_MAP];

/**
 * Is the Athree map switched on? Default ON since 2026-11-19 (admin, verbatim: *"AGENTV3_ATHREE_MAP ko default "on" karo.
 * mujhe cloud run me kuch nahi dalna"*). Before that it was default OFF, so no user ever got the big world that phases 1–5b
 * had built — the main reason games came out with a few hundred metres of ground. Kill switch: AGENTV3_ATHREE_MAP=off
 * (also 0 / false / no). OFF means the map is neither offered by the library nor written by the recipe: a map that cannot be
 * used is not listed (real features only). Any other value, or no value, is ON.
 */
export function athreeMapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['off', '0', 'false', 'no'].includes(String(env.AGENTV3_ATHREE_MAP ?? '').trim().toLowerCase());
}
