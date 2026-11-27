/**
 * ✏️ "NADI KI JAGAH JHEEL KARO" — ONE LAYER OF A GAME'S MAP, CHANGED BY THE PLATFORM AT THE START OF THE TURN (admin 2026-11-27,
 * wave 2 part 2).
 *
 * On a game that already has an Athree map with a plan (MAP_PLAN in src/game/athree/config.ts), a follow-up message that names one
 * layer — the map size, the edge, the water, the roads, the colonies — changes ONLY that layer of the plan (mapLayerEdit.ts): the
 * same seed, every other field kept. The platform rewrites config.ts itself (a mechanical, unambiguous change is never left to a
 * model's reading of a rule — the worldTurn.ts class), re-runs the robot checks and the top-down preview on the game's own files,
 * shows the user the new picture with exactly which layer changed, and tells the builder it is done.
 *
 * A message that names one of the user's SAVED maps ("Make an open world game on my saved map "Ganga Nagar".") puts that map's plan
 * and seed on this game instead — the whole plan, said as such.
 *
 * Nothing is changed on a guess: a message that does not ask to change a layer changes nothing; a change the world cannot build yet
 * (a density before the colonies layer exists, river counts the world makes itself, a road style on a map over 25 km, an edge on a
 * looping map) is said honestly — recorded or refused, never claimed. Never throws.
 */
import { readMapPlanFromConfig, rewriteMapPlanInConfig, mapPlanFromData, type MapPlanData } from '../../lib/athreeMap/mapPlanData';
import { mapLayerEditsIn, changeVerdict, LAYER_NAME, type LayerChange } from '../../lib/athreeMap/mapLayerEdit';
import { appliedMapLayers } from '../../lib/athreeMap/mapPlan';
import { MAP_CHECKS_PATH } from '../../lib/athreeMap/mapPlanWiring';
import { describeRobotRun, runRobotChecksInWorker } from '../../lib/athreeMap/mapRobotRun';
import { gameWorldSeed, mapPreviewCardFor } from '../../lib/athreeMap/mapPreviewCard';
import { savedMapNamed } from '../../lib/athreeMap/savedMapRequest';
import type { MapPreviewCard } from '../../../lib/mapPreview';

export const ATHREE_CONFIG = 'src/game/athree/config.ts';
const ATHREE_DIR = 'src/game/athree/';
const WORLD_FILE = 'src/game/world.ts';

interface Issue { phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }

/** One sentence per change, with its honest verdict. PURE. */
export function describeLayerChanges(changes: readonly LayerChange[], applied: ReturnType<typeof appliedMapLayers>, d: MapPlanData): { sentence: string; recorded: string[] } {
  const parts: string[] = [];
  const recorded: string[] = [];
  for (const c of changes) {
    const v = changeVerdict(c, applied, d);
    parts.push(`${LAYER_NAME[c.layer]}: ${c.from} → ${c.to}`);
    if (!v.built) recorded.push(`${LAYER_NAME[c.layer]} is recorded in the plan but not built into this world yet (${v.why})`);
    else if (v.why) recorded.push(`${LAYER_NAME[c.layer]}: ${v.why}`);
  }
  return { sentence: `Changed only ${parts.join('; ')}. Everything else on the map, and its seed, stayed the same.`, recorded };
}

export async function mapLayerEditAtTurnStart(io: {
  skip?: boolean;
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  record: (issue: Issue) => void;
  /** The map card for the chat (the `map_preview` event). */
  showMap: (card: MapPreviewCard) => void;
  /** This verified account's saved maps (the map library); absent for a visitor. */
  savedMaps?: () => Promise<Array<{ name: string; plan: MapPlanData }>>;
}): Promise<string> {
  try {
    const start = io.filesAtTurnStart;
    if (io.skip || !start || typeof start[ATHREE_CONFIG] !== 'string') return '';
    const read = (p: string): Promise<string | null> => io.read(p).then((c) => (typeof c === 'string' ? c : null), () => start[p] ?? null);
    const config = await read(ATHREE_CONFIG);
    const current = readMapPlanFromConfig(config);
    if (!config || !current) return '';
    const worldTs = await read(WORLD_FILE);

    // A saved map named on a game that already has a map: its whole plan and seed replace this one.
    let saved: { name: string; plan: MapPlanData } | null = null;
    if (io.savedMaps) { try { saved = savedMapNamed(io.prompt, await io.savedMaps()); } catch { saved = null; } }
    let next: MapPlanData; let frameChanged: boolean; let changedText: string; let recorded: string[] = [];
    let changes: LayerChange[] = [];
    if (saved) {
      next = { ...saved.plan, profile: current.profile };
      frameChanged = true;
      changedText = `This game now stands on your saved map "${saved.name}": its size, land, edge, water, roads and seed.`;
    } else {
      const verdict = mapLayerEditsIn(io.prompt, current, { openWorld: typeof worldTs === 'string' });
      if (verdict.kind === 'none') return '';
      if (verdict.kind === 'refused') {
        io.record({ phase: 'build', severity: 'info', code: 'MAP_LAYER_NOT_CHANGED', autoResolved: true, message: `A map layer change was asked (${verdict.layer}) and not made: ${verdict.reason}` });
        return `MAP LAYER — NOT CHANGED: the user asked to change ${LAYER_NAME[verdict.layer]} of the map, and the platform did not, because: ${verdict.reason} Do NOT change src/game/athree/config.ts or the world code to fake it. Tell the user this plainly, in their language.`;
      }
      next = verdict.data; frameChanged = verdict.frameChanged; changes = verdict.changes;
      changedText = '';
    }
    const rewritten = rewriteMapPlanInConfig(config, next, frameChanged);
    if (rewritten === null) {
      io.record({ phase: 'build', severity: 'warning', code: 'MAP_LAYER_NOT_CHANGED', autoResolved: false, message: 'A map layer change was asked, but src/game/athree/config.ts is not in the shape the platform wrote (edited by hand), so nothing was changed.' });
      return 'MAP LAYER — NOT CHANGED: the user asked to change the map, but this game\'s src/game/athree/config.ts has been edited into a shape the platform cannot rewrite safely, so nothing was changed. Tell the user plainly; do not edit the map plan by hand to fake the change.';
    }
    await io.write(ATHREE_CONFIG, rewritten);

    // The game's own Athree files, with the new config: what the world applies, the checks and the picture all read these.
    const files: Record<string, string> = {};
    for (const p of Object.keys(start)) {
      if (!p.startsWith(ATHREE_DIR) || !p.endsWith('.ts')) continue;
      const c = p === ATHREE_CONFIG ? rewritten : await read(p);
      if (typeof c === 'string') files[p] = c;
    }
    const worldSource = Object.entries(files).filter(([p]) => p !== ATHREE_CONFIG && p !== MAP_CHECKS_PATH).map(([, s]) => s).join('\n');
    const applied = appliedMapLayers(worldSource, mapPlanFromData(next));
    if (!saved) { const said = describeLayerChanges(changes, applied, next); changedText = said.sentence; recorded = said.recorded; }
    const seed = gameWorldSeed(worldTs, next.seed);
    const [robots, map] = await Promise.all([
      MAP_CHECKS_PATH in files ? runRobotChecksInWorker(files, next.profile, { seeds: [seed] }).then(describeRobotRun) : Promise.resolve('ROBOT CHECKS: this game has no map checks file, so none were run.'),
      mapPreviewCardFor(files, next, seed, { title: saved ? `Your saved map "${saved.name}", from above` : 'Your map, from above (changed)', changed: [changedText, ...recorded].join(' ') }),
    ]);
    io.showMap(map.card);
    io.record({ phase: 'build', severity: 'info', code: 'MAP_LAYER_CHANGED', autoResolved: true, message: `${changedText}${recorded.length ? ' ' + recorded.join('; ') + '.' : ''} The platform rewrote src/game/athree/config.ts; no model call made this change.` });
    return [
      'MAP LAYER — ALREADY DONE BY THE PLATFORM: ' + changedText,
      ...(recorded.length ? ['Say honestly: ' + recorded.join('; ') + '.'] : []),
      'src/game/athree/config.ts (MAP_PLAN and MAP_OPTIONS) is already rewritten. Do NOT edit it, and do not change the world code for this. The user was shown the new map from above.',
      robots,
      map.note,
      'Tell the user, in their language, exactly which layer changed (and anything only recorded). If the request asked for nothing else, there is nothing more to build.',
    ].join('\n');
  } catch { return ''; }
}
