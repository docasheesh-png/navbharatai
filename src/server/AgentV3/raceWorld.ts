// 🏁 "RACE SHEHAR ME KARO" — A RACE MOVES ONTO THE WORLD'S CITY ROADS, ONLY AFTER THE USER'S YES (map expansion item 8, part 3).
//
// Owner decision (2026-11-23): when a racing user asks for cities, the race may move onto the world's road network, but
// only after asking ONCE. The question is the builder's (mapGrowthIntent.ts, the racing route's ASK note, which tells the
// user the exact reply); the yes is carried out HERE, by the platform, at the start of the turn — never by a model's
// rewrite of a race that works. The switch is one line: TRACK.world = true in src/game/track.ts. <RacingRoadGame> then
// loads src/game/play/worldRace.ts by itself (play/raceCustom.ts loadWorldRace); without that file, or on any failure,
// it races on the road library exactly as before.
//
// 🔒 What is written, in this order, and only when ALL of it can be:
//   1. the kit files the world race imports (the open world's layers), by the kit's own rules: an absent file is added only
//      after it was READ as absent; an untouched older kit version is brought up to date; an edited one stops everything;
//   2. src/game/play/worldCourse.ts and src/game/play/worldRace.ts (a different file already at either path stops everything);
//   3. LAST, src/game/track.ts (the switch). A failure before it leaves the race as it was (the new files are not loaded
//      until the switch); a refreshed file is put back.
// Not done (and the builder told to say why): a race on the user's own track model, a hand-edited race starter, a track.ts
// the platform cannot read, the switch off (AGENTV3_RACING_WORLD, OFF by default).
import { planKitLayers, recipeFilePool, staleKitReason, type LayerFile } from '../lib/gameRecipeLayers';
import { WORLD_COURSE, WORLD_COURSE_PATH, WORLD_RACE, WORLD_RACE_PATH } from '../lib/GameWorldCourseGenerator';
import { RACE_CUSTOM_PATH } from '../lib/GameRaceCustomGenerator';
import { racingWorldEnabled, raceWorldYes, trackOnWorld, mapGameTypeOf } from './mapGrowthIntent';

export const TRACK_PATH = 'src/game/track.ts';
export const RACE_STARTER_PATH = 'src/game/RacingRoadGame.tsx';
type Issue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };

export const NEW_TRACK_FILE = `// The race's track (src/game/play/raceCustom.ts TrackChoice). world: true = the race runs on the world's city roads,
// along the highways between the places (src/game/world.ts WORLD.regions, else four towns).
import type { TrackChoice } from './play/raceCustom';

export const TRACK: TrackChoice = { world: true };
`;

export type TrackSwitch = { ok: true; source: string; already: boolean } | { ok: false; reason: 'own-track' | 'unreadable' };

/** track.ts with TRACK.world = true, every other byte kept. A track with its own model stays as it is. PURE. */
export function setTrackWorld(track: string | null | undefined): TrackSwitch {
  if (typeof track !== 'string') return { ok: true, source: NEW_TRACK_FILE, already: false };
  if (/\bmodel\s*:\s*['"`]/.test(track)) return { ok: false, reason: 'own-track' };
  if (trackOnWorld(track)) return { ok: true, source: track, already: true };
  const off = track.match(/\bworld\s*:\s*false\b/g);
  if (off) return off.length === 1 ? { ok: true, source: track.replace(/\bworld\s*:\s*false\b/, 'world: true'), already: false } : { ok: false, reason: 'unreadable' };
  if (/\bworld\s*:/.test(track)) return { ok: false, reason: 'unreadable' };
  const heads = [...track.matchAll(/export\s+const\s+TRACK\b[^=;]*=\s*\{/g)];
  if (heads.length !== 1) return { ok: false, reason: 'unreadable' };
  const at = heads[0].index! + heads[0][0].length;
  const rest = track.slice(at);
  const nl = /^[ \t]*\r?\n([ \t]*)/.exec(rest);
  const insert = nl ? `\n${nl[1] || '  '}world: true,` : /^\s*\}/.test(rest) ? ' world: true ' : ' world: true,';
  return { ok: true, source: track.slice(0, at) + insert + rest, already: false };
}

export interface RaceWorldInput {
  /** src/game/track.ts as it is NOW (null: the game has none). */
  track: string | null;
  /** Every path the project has (the listing at turn start). */
  has: ReadonlySet<string>;
  /** Live content of the paths read: a string, or null when READ as absent. A path not in the map was not read. */
  live: ReadonlyMap<string, string | null>;
}
export type RaceWorldPlan =
  | { ok: true; already: true }
  | { ok: true; already: false; writes: Array<[string, string]>; added: string[]; refreshed: string[] }
  | { ok: false; reason: 'own-track' | 'unreadable' | 'edited-race' | 'own-file' | 'edited-kit'; detail: string }
  | { ok: false; reason: 'unread'; unread: string[] };

/** Everything the switch needs, or why it cannot be made. PURE. */
export function planRaceWorld(input: RaceWorldInput, pool: ReadonlyMap<string, LayerFile> = recipeFilePool()): RaceWorldPlan {
  const sw = setTrackWorld(input.track);
  if (!sw.ok) return { ok: false, reason: sw.reason, detail: sw.reason === 'own-track' ? 'this race runs on the user\'s own track model (TRACK.model)' : `${TRACK_PATH} is not in a shape the platform can change safely` };
  if (sw.already) return { ok: true, already: true };
  const unread: string[] = [];
  // The starter and raceCustom must be the kit's current ones (they hold the world branch): an older untouched copy is refreshed.
  const own: Record<string, string> = { [WORLD_COURSE_PATH]: WORLD_COURSE, [WORLD_RACE_PATH]: WORLD_RACE };
  const refresh: Record<string, string> = {};
  for (const path of [RACE_STARTER_PATH, RACE_CUSTOM_PATH]) {
    const kit = pool.get(path)?.content;
    if (!kit) return { ok: false, reason: 'edited-race', detail: `the kit has no ${path}` };
    if (!input.live.has(path)) { unread.push(path); continue; }
    const cur = input.live.get(path);
    if (typeof cur !== 'string') return { ok: false, reason: 'edited-race', detail: `this game has no ${path}` };
    if (cur === kit) continue;
    if (staleKitReason(path, cur, kit) !== null) return { ok: false, reason: 'edited-race', detail: `${path} was changed by hand (it is not a version the kit wrote), and the world race needs the kit's current one` };
    refresh[path] = kit;
  }
  const writes: Array<[string, string]> = [];
  const added: string[] = [];
  for (const [path, content] of Object.entries(own)) {
    if (!input.live.has(path)) { unread.push(path); continue; }
    const cur = input.live.get(path);
    if (cur === content) continue;
    if (typeof cur === 'string') return { ok: false, reason: 'own-file', detail: `${path} already exists with other content` };
    added.push(path);
  }
  const plan = planKitLayers({ ...own, ...refresh }, input.has, new Map([...input.live].filter(([p, c]) => input.has.has(p) || c !== null)), pool, staleKitReason);
  if (plan.kept.length) return { ok: false, reason: 'edited-kit', detail: plan.kept.map((k) => `${k.path} (changed by hand) does not export ${k.missing.join(', ')}`).join('; ') };
  // A kit file is added only once it was READ as absent: a stale listing must never let it overwrite somebody's file.
  for (const p of plan.add.keys()) if (!input.live.has(p) || input.live.get(p) !== null) unread.push(p);
  unread.push(...plan.unread);
  if (unread.length) return { ok: false, reason: 'unread', unread: [...new Set(unread)] };
  for (const [p, f] of plan.add) { writes.push([p, f.content]); added.push(p); }
  for (const [p, f] of plan.refresh) { writes.push([p, f.content]); refresh[p] = f.content; }
  for (const [p, c] of Object.entries(refresh)) if (!writes.some(([w]) => w === p)) writes.push([p, c]);
  for (const [p, c] of Object.entries(own)) if (added.includes(p)) writes.push([p, c]);
  writes.push([TRACK_PATH, sw.source]);                                       // the switch: always last
  return { ok: true, already: false, writes, added: [...new Set(added)], refreshed: Object.keys(refresh) };
}

/** What the builder is told. PURE. */
export function raceWorldHandoff(result: { done: true; added: string[]; refreshed: string[] } | { done: false; already: true } | { done: false; already?: false; reason: string }): string {
  if (result.done) {
    return `✅ ALREADY DONE BY THE PLATFORM: the user said yes, so this race now runs on the world's city roads — TRACK.world = true in ${TRACK_PATH}`
      + `${result.added.length ? `; added ${result.added.join(', ')}` : ''}${result.refreshed.length ? `; brought up to date ${result.refreshed.join(', ')}` : ''}.`
      + ' The race goes along the highways between the places (src/game/world.ts WORLD.regions, or four towns while the game has no world.ts).'
      + ' Do NOT edit these files, do not write a world or a race of your own, and change nothing else. Reply in one or two sentences, in the user\'s language: the race now runs through the towns on city roads, and more cities can be added by asking.';
  }
  if (result.already) return 'This race ALREADY runs on the world\'s city roads (TRACK.world = true). Change nothing, and say so in one sentence, in the user\'s language.';
  return `The user asked to move the race onto city roads, but the platform did NOT do it: ${result.reason}. Change NOTHING about the race and write no world or race file by hand; tell the user plainly why, in their language, in one or two sentences.`;
}

/**
 * The user's yes, carried out at the start of the turn on a road-library race. '' when it is not this turn's (the switch
 * off, not a race, not a yes, an import or module turn). Never throws.
 */
export async function raceWorldAtTurnStart(io: {
  skip?: boolean;
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  record: (issue: Issue) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  try {
    if (io.skip || !io.filesAtTurnStart || !racingWorldEnabled(io.env ?? process.env)) return '';
    if (mapGameTypeOf(io.filesAtTurnStart) !== 'racing-library' || !raceWorldYes(io.prompt)) return '';
    const has = new Set(Object.keys(io.filesAtTurnStart));
    const live = new Map<string, string | null>();
    const readOrNull = (p: string): Promise<string | null> => io.read(p).then((c) => (typeof c === 'string' ? c : null), () => null);
    const track = await readOrNull(TRACK_PATH);
    const refuse = (reason: string): string => {
      io.record({ phase: 'build', severity: 'info', code: 'RACE_ON_WORLD_NOT_DONE', autoResolved: true, message: `The user said yes to city roads; the platform changed nothing (${reason}).` });
      return raceWorldHandoff({ done: false, reason });
    };
    if (has.has(TRACK_PATH) && track === null) return refuse(`${TRACK_PATH} could not be read`);
    let plan: RaceWorldPlan = planRaceWorld({ track, has, live });
    for (let round = 0; round < 4 && !plan.ok && plan.reason === 'unread'; round++) {
      for (const p of plan.unread) live.set(p, await readOrNull(p));
      plan = planRaceWorld({ track, has, live });
    }
    if (!plan.ok) return refuse(plan.reason === 'unread' ? `the files ${plan.unread.join(', ')} could not be read` : plan.detail);
    if (plan.already) return raceWorldHandoff({ done: false, already: true });
    const written: Array<[string, string | null]> = [];
    try {
      for (const [p, c] of plan.writes) { const before = live.has(p) ? live.get(p)! : (p === TRACK_PATH ? track : null); await io.write(p, c); written.push([p, before]); }
    } catch {
      // Put back what was refreshed; an added file is left (nothing loads it until the switch, which was not made).
      for (const [p, before] of written.reverse()) if (typeof before === 'string') await io.write(p, before).catch(() => undefined);
      return refuse('a file could not be written, so the race was left on the road library');
    }
    io.record({ phase: 'build', severity: 'info', code: 'RACE_ON_WORLD', autoResolved: true,
      message: `The platform moved the race onto the world's city roads after the user's yes (TRACK.world = true; ${plan.added.length} file(s) added, ${plan.refreshed.length} brought up to date) — no model call made this change.` });
    return raceWorldHandoff({ done: true, added: plan.added, refreshed: plan.refreshed });
  } catch { return ''; }
}
