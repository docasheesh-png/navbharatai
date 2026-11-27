// Where the MAP PLAN meets the emitted Athree files (mapPlan.ts decides; this writes the decision down and says what was applied).
//
// Kept apart from AthreeMapGenerator.ts on purpose: it only ADDS to the generator's output, never edits the generator, so the map
// planner and the world's own layers (boundary, water, roads — wave 1's other parts) can land in any order.
//
//   • config.ts gets the plan as data (MAP_PLAN) and the shared world options merged into MAP_OPTIONS, which the index already spreads
//     into createAthreeWorld. A world that does not read an option yet ignores it: passing it is harmless.
//   • mapChecks.ts (the robot checks) is added, so the game can measure its own map.
//   • The note says, layer by layer, what the emitted world REALLY applies — read from its source, never assumed.
//
// PURE: no I/O, no clock, no env. Never throws on well-formed generator output.

import { athreeFiles } from './AthreeMapGenerator';
import { MAP_CHECKS } from './athreeMapCheckSource';
import { appliedMapLayers, describeMapPlan, mapPlanWorldOptions, planMap, roadFloorFromWorldSource, type MapLayer, type MapPlan, type MapPlanInput } from './mapPlan';
import type { MapChoice } from './athreeMapKinds';

const DIR = 'src/game/athree';
export const MAP_CHECKS_PATH = `${DIR}/mapChecks.ts`;

let floorCache: { loop: number; bounded: number } | null | undefined;
/** The emitted world's own MIN_ROAD_SIZE (read once from the world source it emits). */
export function athreeRoadFloor(): { loop: number; bounded: number } | null {
  if (floorCache === undefined) floorCache = roadFloorFromWorldSource(athreeFiles([])[`${DIR}/world.ts`] ?? '');
  return floorCache;
}

/** Plan the map for a request, with the world's real road floor. */
export function planAthreeMap(prompt: string, builder?: MapPlanInput['builder']): MapPlan {
  return planMap({ prompt, builder, roadFloorMeters: athreeRoadFloor() });
}

export interface AppliedMapPlan {
  files: Record<string, string>;
  applied: Record<MapLayer, boolean>;
  note: string;
}

/**
 * Write the plan into a generated Athree file set (a copy; the input is not changed). `finalChoice` is the choice the world was really
 * generated with (a composition's widthKm can override the plan's side); a difference is said in the note.
 */
export function applyMapPlanToFiles(files: Readonly<Record<string, string>>, plan: MapPlan, finalChoice?: MapChoice | null): AppliedMapPlan {
  const out: Record<string, string> = { ...files };
  const config = out[`${DIR}/config.ts`];
  const effective: MapPlan = finalChoice && plan.choice && finalChoice.sizeKm !== plan.choice.sizeKm
    ? { ...plan, choice: finalChoice, sideKm: finalChoice.sizeKm, areaKm2: Math.round(finalChoice.sizeKm * finalChoice.sizeKm * 100) / 100, notes: [...plan.notes, `The world composition fixed the map at ${finalChoice.sizeKm} km across, so that size was used.`] }
    : plan;
  if (typeof config === 'string' && /export const MAP_OPTIONS\b/.test(config)) {
    const data = {
      areaKm2: effective.areaKm2, sideKm: effective.sideKm, archetype: effective.archetype, boundary: effective.boundary, water: effective.water,
      roadStyle: effective.roadStyle, density: effective.density, region: effective.region, gameType: effective.gameType,
      timeOfDay: effective.timeOfDay, hours: effective.hours,
    };
    out[`${DIR}/config.ts`] = config
      + '\n/** THE MAP PLAN (what the user asked for, read by NavBharatAI\'s map planner). Keep it when editing the game; change it only when the user changes the map. */\n'
      + 'export const MAP_PLAN = ' + JSON.stringify(data, null, 2) + ' as const;\n'
      + '/** The plan\'s layer wishes go to createAthreeWorld with the rest of MAP_OPTIONS; a world that does not read one yet ignores it. */\n'
      + 'Object.assign(MAP_OPTIONS, ' + JSON.stringify(mapPlanWorldOptions(effective)) + ');\n';
  }
  if (!(MAP_CHECKS_PATH in out)) out[MAP_CHECKS_PATH] = MAP_CHECKS;
  // Every emitted world module except the plan's own data and the checks: a layer may be read by any of them.
  const worldSource = Object.entries(out).filter(([p]) => p.startsWith(DIR + '/') && p !== `${DIR}/config.ts` && p !== MAP_CHECKS_PATH).map(([, src]) => src).join('\n');
  const applied = appliedMapLayers(worldSource, effective);
  const note = describeMapPlan(effective, applied)
    + '\nROBOT CHECKS: import { publishMapChecks } from \'./game/athree/mapChecks\' and call publishMapChecks(map.world, { lots, placed }) once, after createAthreeMap and after the game has placed its houses and props. It measures: spawns on dry land, no lot in water or on a road, the road graph in one piece, nothing under the ground, the boundary closed. Every failure is printed to the console and left on window.__nbMapChecks for the playtest; show failures honestly, never hide them.';
  return { files: out, applied, note };
}
