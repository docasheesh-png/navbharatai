// 🏟️ "MAP BADA KARO" IN A CRICKET OR FOOTBALL GAME — A WORLD AROUND THE GROUND, ONLY ON THE USER'S REQUEST (map expansion
// plan, item 7).
//
// Owner decision (2026-11-23): a sports game gets a world around its ground only when the user asks for one — never on a
// guess. mapGrowthIntent.ts reads the request (the same explicit world wishes as an open world: one more place, a bigger
// map, places joined, N×, a universe, a copy, roads between places); this module does the platform's part at the start of
// that turn: it adds src/game/play/worldVenue.ts (GameWorldVenueGenerator.ts) and the open-world layers it imports, by the
// kit's own rules — an absent file only after it was READ as absent, an untouched older kit file brought up to date, and
// NOTHING when an edited file or a different file at that path is in the way. It changes none of the game's own code: the
// builder is told exactly how to stand the match on the venue (the match's things go into ONE group; rules, ball and
// players unchanged; on any failure the game keeps its own ground).
//
// Only a 3D game on the kit (src/game/Game.ts): a 2D board-pack match has no 3D world to stand in, and is told so.
// Behind AGENTV3_SPORTS_WORLD — OFF by default. PURE apart from the small ports the route passes in; never throws.
import { planKitLayers, recipeFilePool, staleKitReason, type LayerFile } from '../lib/gameRecipeLayers';
import { WORLD_VENUE, WORLD_VENUE_PATH } from '../lib/GameWorldVenueGenerator';
import { mapGrowthIntent, sportsWorldEnabled, type MapGrowthKind } from './mapGrowthIntent';

type Issue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };
export type MatchSport = 'cricket' | 'football';

/** The requests that ask for a WORLD (not the ground itself, not the game itself) — the route's explicit world wishes. */
export const WORLD_WISHES: ReadonlySet<MapGrowthKind> = new Set<MapGrowthKind>(['add-place', 'grow-map', 'join-one', 'join-to', 'multiply', 'universe', 'duplicate', 'highways']);

const FOOTBALL_CODE = /\b(?:footballLayout|createFootballMatch|kickBall|keeperMove)\s*\(/;
const CRICKET_CODE = /\b(?:cricketLayout|deliveryPath|shotFromTiming)\s*\(|\bbowl\s*\(\s*match\b/;

/**
 * Which match THIS game plays, read from the game's OWN code (never from a kit file: every board-pack project carries
 * board/cricket.ts and board/football.ts whatever it plays). null: neither, or both. PURE.
 */
export function matchSportOf(files: Readonly<Record<string, string>> | null | undefined, pool: ReadonlyMap<string, LayerFile> = recipeFilePool()): MatchSport | null {
  let football = false, cricket = false;
  for (const [path, content] of Object.entries(files ?? {})) {
    if (!/^src\/.*\.(?:tsx?|jsx?)$/.test(path) || typeof content !== 'string') continue;
    if (pool.get(path)?.content === content || path === WORLD_VENUE_PATH || /^src\/game\/board\//.test(path)) continue;   // the kit's own files say nothing
    if (FOOTBALL_CODE.test(content)) football = true;
    if (CRICKET_CODE.test(content)) cricket = true;
  }
  return football === cricket ? null : football ? 'football' : 'cricket';
}

/** A 3D game on the kit (it has the runtime's Game.ts and draws with three). PURE. */
export function isKit3D(files: Readonly<Record<string, string>>): boolean {
  return typeof files['src/game/Game.ts'] === 'string' && Object.keys(files).some((p) => /^src\/game\/three\//.test(p));
}

export const VENUE_OF: Record<MatchSport, 'cricket-ground' | 'football-field'> = { cricket: 'cricket-ground', football: 'football-field' };

export type SportsWorldPlan =
  | { ok: true; writes: Array<[string, string]>; added: string[]; refreshed: string[]; already: boolean }
  | { ok: false; reason: 'own-file' | 'edited-kit'; detail: string }
  | { ok: false; reason: 'unread'; unread: string[] };

/** The files to write, or why not. `live`: content READ now (null = read as absent; missing = not read yet). PURE. */
export function planSportsWorld(has: ReadonlySet<string>, live: ReadonlyMap<string, string | null>, pool: ReadonlyMap<string, LayerFile> = recipeFilePool()): SportsWorldPlan {
  if (!live.has(WORLD_VENUE_PATH)) return { ok: false, reason: 'unread', unread: [WORLD_VENUE_PATH] };
  const cur = live.get(WORLD_VENUE_PATH);
  if (typeof cur === 'string' && cur !== WORLD_VENUE) return { ok: false, reason: 'own-file', detail: `${WORLD_VENUE_PATH} already exists with other content` };
  const plan = planKitLayers({ [WORLD_VENUE_PATH]: WORLD_VENUE }, has, new Map([...live].filter(([p, c]) => has.has(p) || c !== null)), pool, staleKitReason);
  if (plan.kept.length) return { ok: false, reason: 'edited-kit', detail: plan.kept.map((k) => `${k.path} (changed by hand) does not export ${k.missing.join(', ')}`).join('; ') };
  const unread = [...plan.unread];
  // A kit file is added only once it was READ as absent: a stale listing must never let it overwrite somebody's file.
  for (const p of plan.add.keys()) if (!live.has(p) || live.get(p) !== null) unread.push(p);
  if (unread.length) return { ok: false, reason: 'unread', unread: [...new Set(unread)] };
  const writes: Array<[string, string]> = [];
  for (const [p, f] of plan.add) writes.push([p, f.content]);
  for (const [p, f] of plan.refresh) writes.push([p, f.content]);
  const already = cur === WORLD_VENUE;
  if (!already) writes.push([WORLD_VENUE_PATH, WORLD_VENUE]);
  return { ok: true, writes, added: [...plan.add.keys(), ...(already ? [] : [WORLD_VENUE_PATH])], refreshed: [...plan.refresh.keys()], already };
}

/** The game already stands its match on the venue (its own code calls startVenueWorld). PURE. */
export function matchOnWorld(files: Readonly<Record<string, string>>): boolean {
  return Object.entries(files).some(([p, c]) => p !== WORLD_VENUE_PATH && typeof c === 'string' && /\bstartVenueWorld\s*\(/.test(c));
}

const HOME_REGIONS = (venue: string): string => `{ id: 'home-town', kind: 'town' }, { id: 'home-ground', kind: 'venue', venue: '${venue}', joinTo: 'home-town' }`;

/** What the builder is told. PURE. */
export function sportsWorldHandoff(r:
  | { done: true; sport: MatchSport; added: string[]; refreshed: string[] }
  | { done: false; sport: MatchSport; onWorld: true }
  | { done: false; sport: MatchSport; onWorld?: false; reason: string }): string {
  const venue = VENUE_OF[r.sport];
  if (r.done) {
    return `✅ ALREADY DONE BY THE PLATFORM: the user ASKED for a world around this ${r.sport} ground, so the platform added`
      + ` ${r.added.length ? r.added.join(', ') : WORLD_VENUE_PATH}${r.refreshed.length ? ` (and brought up to date ${r.refreshed.join(', ')})` : ''}.`
      + ` Do NOT edit those files. YOUR CHANGE, and only this: stand the match on the world's ${venue}.`
      + ` (1) In the game's setup: import { startVenueWorld } from the game's src/game/play/worldVenue.ts, and inside try/catch`
      + ` call const venueWorld = startVenueWorld(ctx, { venue: '${venue}' }); on a throw keep the game exactly as it is now (its own ground).`
      + ` (2) When it works: add every match thing (players, ball, ${r.sport === 'cricket' ? 'stumps, ' : ''}markers, the camera rig) to venueWorld.root instead of the scene, at the SAME positions it uses now`
      + ` (0,0 = the centre), and give the layout heading: venueWorld.heading (${r.sport === 'football' ? 'footballLayout({ heading: venueWorld.heading })' : 'cricketLayout({ heading: venueWorld.heading })'}).`
      + ` (3) Remove ONLY the game's own ground plane and its ${r.sport === 'football' ? 'pitch markings and goal frames' : 'outfield, pitch strip and crease markings'} — the venue draws them on its level pad; keep everything else.`
      + ' (4) Call venueWorld.frame(ctx, dt) in update and venueWorld.dispose() when the game ends.'
      + ' The rules, the ball\'s physics, the players, the controls and the score stay EXACTLY as they are. Then reply in one or two sentences, in the user\'s language: the ground now stands in a town on a world, and more places can be added by asking.';
  }
  if (r.onWorld) {
    return `This ${r.sport} match ALREADY stands on the world. A place is ONE more region in WORLD.regions of src/game/world.ts (the match reads it by itself);`
      + ` if that file does not exist yet, create it as: export const WORLD = { regions: [${HOME_REGIONS(venue)}, <the new region>] }; — those two are the town and the ground there now.`
      + ' Change nothing in the match or in src/game/play/.';
  }
  return `The user asked for a world around this ${r.sport} ground, but the platform did NOT add it: ${r.reason}. Change NOTHING about the match or the ground, build no map by hand, and tell the user plainly why, in their language, in one or two sentences (the match itself is unchanged).`;
}

/**
 * The user's world wish in a cricket or football game, carried out at the start of the turn (the kit files only). '' when it
 * is not this turn's (the switch off, not a sports game on our kit, not a world wish, an import or module turn). Never throws.
 */
export async function sportsWorldAtTurnStart(io: {
  skip?: boolean;
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  record: (issue: Issue) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  try {
    const files = io.filesAtTurnStart;
    if (io.skip || !files || !sportsWorldEnabled(io.env ?? process.env) || String(io.prompt ?? '').length > 600) return '';
    if (typeof files['src/game/world.ts'] === 'string' && !matchOnWorld(files)) return '';   // an open world that plays a match: its own map
    const sport = matchSportOf(files);
    if (!sport || !WORLD_WISHES.has(mapGrowthIntent(io.prompt).kind)) return '';
    const refuse = (reason: string): string => {
      io.record({ phase: 'build', severity: 'info', code: 'SPORTS_WORLD_NOT_DONE', autoResolved: true, message: `A world around the ${sport} ground was asked for; the platform changed nothing (${reason}).` });
      return sportsWorldHandoff({ done: false, sport, reason });
    };
    if (matchOnWorld(files)) return sportsWorldHandoff({ done: false, sport, onWorld: true });
    if (!isKit3D(files)) return refuse('this is a 2D game; a world around the ground needs the 3D game');
    const has = new Set(Object.keys(files));
    const live = new Map<string, string | null>();
    const readOrNull = (p: string): Promise<string | null> => io.read(p).then((c) => (typeof c === 'string' ? c : null), () => null);
    let plan: SportsWorldPlan = planSportsWorld(has, live);
    for (let round = 0; round < 5 && !plan.ok && plan.reason === 'unread'; round++) {
      for (const p of plan.unread) live.set(p, await readOrNull(p));
      plan = planSportsWorld(has, live);
    }
    if (!plan.ok) return refuse(plan.reason === 'unread' ? `the files ${plan.unread.join(', ')} could not be read` : plan.detail);
    const written: Array<[string, string | null]> = [];
    try {
      for (const [p, c] of plan.writes) { const before = live.get(p) ?? null; await io.write(p, c); written.push([p, before]); }
    } catch {
      // Put back what was refreshed; an added file is left (nothing imports it until the builder's change, which is not asked for).
      for (const [p, before] of written.reverse()) if (typeof before === 'string') await io.write(p, before).catch(() => undefined);
      return refuse('a file could not be written');
    }
    io.record({ phase: 'build', severity: 'info', code: 'SPORTS_WORLD_ADDED', autoResolved: true,
      message: `The platform added the world around the ${sport} ground on the user's request (${plan.added.length} file(s) added, ${plan.refreshed.length} brought up to date); the builder stands the match on it — no model call made the kit change.` });
    return sportsWorldHandoff({ done: true, sport, added: plan.added, refreshed: plan.refreshed });
  } catch { return ''; }
}
