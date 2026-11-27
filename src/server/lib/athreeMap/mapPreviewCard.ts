// The map card a build step shows the user (a new map, a changed layer), and the build-note line that says what it showed.
// ONE builder for both callers — the generate_athree_map recipe (ToolDispatcher) and the chat layer edit (mapLayerEdit.ts) — so the
// picture is always computed the same way: the files the game really has, the seed the game really uses, in a worker with a budget.
// A preview that cannot be computed becomes a card that says "Map preview unavailable" and why — never a placeholder picture.

import { previewMapInWorker, type MapPreviewRun } from './mapPreviewRun';
import { mapSideLabel, type MapPreviewCard } from '../../../lib/mapPreview';
import type { MapPlanData } from './mapPlanData';

/**
 * The seed the GAME builds its world with. An open-world game keeps it in src/game/world.ts (WORLD.seed), and passes it to
 * createAthreeMap, so it wins; otherwise the map's own MAP_OPTIONS seed (the plan's). PURE.
 */
export function gameWorldSeed(worldTs: string | null | undefined, planSeed: number): number {
  const m = /export const WORLD\b[^=]*=\s*\{[\s\S]*?\bseed:\s*(-?\d+)\s*,/.exec(String(worldTs ?? ''));
  const s = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(s) ? s | 0 : planSeed | 0;
}

export interface MapCardResult { card: MapPreviewCard; note: string; run: MapPreviewRun }

/** The card and the note line for a run (PURE — the tests build cards from in-thread runs with it). */
export function mapCardFor(run: MapPreviewRun, data: MapPlanData, seed: number, opts: { title: string; changed?: string }): MapCardResult {
  if (!run.ok) {
    const card: MapPreviewCard = { preview: null, unavailable: `Map preview unavailable: ${run.error}.`, title: opts.title, ...(opts.changed ? { changed: opts.changed } : {}), plan: { ...data, seed } };
    return { card, run, note: `MAP PREVIEW: could not be drawn (${run.error}). The user was told "Map preview unavailable"; do not describe a picture of the map.` };
  }
  const p = run.preview;
  const what = [`${p.counts.roadCells ? 'roads' : 'no roads'}`, `${p.counts.ponds} pond${p.counts.ponds === 1 ? '' : 's'}`, ...(p.counts.plots ? [`${p.counts.plots} building plots`] : []), p.boundary === 'none' ? 'a looping edge' : `a ${p.boundary} edge`];
  const card: MapPreviewCard = { preview: p, title: opts.title, ...(opts.changed ? { changed: opts.changed } : {}), plan: { ...data, seed } };
  return { card, run, note: `MAP PREVIEW: a top-down picture of this map (${mapSideLabel(p.sideMeters)}, seed ${seed}: ${what.join(', ')}) was shown to the user, computed from the world code just written. The towns and buildings the game adds at runtime are not in it.` };
}

/** Compute the picture in a worker and build the card. Never rejects. */
export async function mapPreviewCardFor(files: Readonly<Record<string, string>>, data: MapPlanData, seed: number, opts: { title: string; changed?: string; budgetMs?: number }): Promise<MapCardResult> {
  const run = await previewMapInWorker(files, { seed, profile: data.profile, budgetMs: opts.budgetMs });
  return mapCardFor(run, data, seed, opts);
}
