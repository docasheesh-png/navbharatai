// ATHREE MAP — the triangle budget across the modules (the emitted source of src/game/athree/budget.ts).
//
// Each module knows only its own worst case (its tier table). What is LEFT for a module once the others have taken theirs is arithmetic across
// modules, so it lives here, in the one file that is written only when ALL of them are: that is what lets a game take any subset of the
// modules without the others tagging along. PURE source string; no backticks, no dollar-brace.

export const BUDGET = `// Athree map — what is left of a quality tier's triangle budget for each module, once the others have taken their worst case.
// Technique: plain subtraction of each module's own worst case (its tier table), kept in one place.
// Written only when every optional module is present: a game that chose a subset adds up its own modules from their tier tables.

import { QUALITY, OCEAN_TIERS, maxTriangles, oceanTriangles, type AthreeQuality } from './config';
import { VEGETATION_TIERS, vegetationTriangles } from './vegetation';
import { RIVER_TIERS } from './riverwater';
import { SKY_TIERS, domeTriangles } from './sky';
import { ROAD_TIERS } from './roadmesh';
import { VEHICLE_TRIANGLES_MAX } from './vehicles';

const terrainAndSea = (q: AthreeQuality): number => QUALITY[q].budgetTriangles - maxTriangles(QUALITY[q]) - oceanTriangles(OCEAN_TIERS[q]);

/** What is left for the rivers once terrain, sea and plants have taken their worst case. */
export function riverBudget(q: AthreeQuality): number {
  return terrainAndSea(q) - vegetationTriangles(VEGETATION_TIERS[q]);
}

/** What is left for the sky dome once terrain, sea, plants and water have taken their worst case. */
export function skyBudget(q: AthreeQuality): number {
  return riverBudget(q) - RIVER_TIERS[q].maxTriangles;
}

/** What is left for the roads once terrain, sea, plants, water and sky have taken their worst case. */
export function roadBudget(q: AthreeQuality): number {
  return skyBudget(q) - domeTriangles(SKY_TIERS[q]);
}

/** How many vehicles of the largest size fit in what is left after everything else, roads included. */
export function vehicleBudget(q: AthreeQuality): number {
  return Math.floor((roadBudget(q) - ROAD_TIERS[q].maxTriangles) / VEHICLE_TRIANGLES_MAX[q]);
}
`;
