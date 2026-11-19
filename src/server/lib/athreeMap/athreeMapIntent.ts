// WHEN THE ATHREE MAP IS USED (admin order 2026-11-14; docs/game-engine/athree-map-plan.md §3).
//
// Athree is used when ANY ONE of three is true:
//   1. the user NAMES it ("athree map use karo", "a-three", Hindi/Hinglish spellings) AND the game really needs a map;
//   2. a BIG MAP is really needed (racing, open world, battle royale, flight, explore) — Athree is then eligible;
//   3. the LIBRARIAN picks a map at random — Athree included.
//
// The three cannot contradict each other because of the order this evaluates them in (a user-named OTHER map or an explicit
// refusal wins; then 1; then 2/3 together as a random pick among the maps that FIT the request, Athree always in that pool) and because
// the random pick is made ONCE per project and stored: `stored` is read first, so an edit never changes the map under a game.
//
// Named but not needed → the answer says so; there is never a fake map. PURE: no I/O, no clock, no env. Never throws.

import { asksForBattleRoyale, buildGameContract } from '../../AgentV3/gameIntent';
import { ATHREE_MAP, LIBRARY_MAPS, type LibraryMap, type MapProfile } from './athreeMapLibrary';
import { largeWorldIntent } from '../../AgentV3/largeWorldIntent';

export type AthreeVia = 'stored' | 'named' | 'needed' | 'librarian' | 'declined' | 'other-map' | 'named-not-needed' | 'road-library' | 'none';

export interface AthreeIntent {
  /** Use the Athree map for this game. */
  use: boolean;
  via: AthreeVia;
  /** The map to use ('athree' or another library map's id), or null when no map is used. */
  mapId: string | null;
  /** The game shape the request needs, or null when it needs no map. */
  profile: MapProfile | null;
  /** One sentence for the build report, and for the user when Athree was named but cannot be used. */
  reason: string;
}

export interface AthreeIntentInput {
  prompt: string;
  /** The map this project already got (from workspace memory). It wins until the user asks for a different map. */
  stored?: { mapId: string | null } | null;
  /** The maps the library knows; defaults to LIBRARY_MAPS. */
  maps?: readonly LibraryMap[];
  /** What the random pick is seeded from; defaults to the prompt. */
  seedKey?: string;
}

const norm = (s: string): string => String(s ?? '').normalize('NFKC').toLowerCase();

// "athree" / "a-three" / "a three"; "a3" only next to map/world (otherwise it is a paper size). Hindi spellings too.
const NAMED = /\bathree\b|\ba[\s._-]three\b|\ba[\s._-]?3\s+(?:map|world|duniya|nakshe|nakshā)\b|\b(?:map|world)\s+a[\s._-]?3\b|(?:अथ्री|एथ्री|आथ्री|अथरी|एथरी)/;
const DECLINED = /\b(?:no|not|don'?t|dont|without|nahi|nahin|mat|naa)\s+(?:(?:use|using|add|the|a|an|to|generate|want|need|install|select)\s+){0,5}(?:athree|a[\s._-]three)\b|\b(?:athree|a[\s._-]three)\s+(?:(?:map|world|ko|ka|is|use)\s+){0,4}(?:(?:nahi|nahin|mat)\b|(?:not|no)\b(?=\s*(?:needed\b|wanted\b|required\b|$|[,.;!?])))|(?:अथ्री|एथ्री|आथ्री|अथरी|एथरी)\s+(?:(?:मैप|नक्शा|नक्शे)\s+)?(?:नहीं|नही|मत)/;
const CHANGE_MAP = /\b(?:change|switch|different|another|new|badlo|badal|naya|doosra|dusra)\b[^.!?\n]{0,16}\bmap\b|\bmap\b[^.!?\n]{0,16}\b(?:change|badlo|badal|different)\b/;

// "A royale-style game" has ONE reader: gameIntent.asksForBattleRoyale (autopsy aba63ead — this module and the
// royale starter's guard kept private copies that had drifted apart).
const FLIGHT = /फ्लाइट|हवाई\s*जहाज|विमान|प्लेन|flight|\bplane\b|aeroplane|aircraft|\bjet\b|helicopter|\bfly(?:ing)?\b|\bpilot\b/;
const RACING = /रेसिंग|रेस\s*गेम|गाड़ी|गाडी|\brac(?:e|ing|er)\b|drift|gadi|gaadi|rally|sport\s*car|supercar|bike\s+race|car\s+game|driving/;
const OPEN_WORLD = /ओपन\s*वर्ल्ड|खुली\s*दुनिया|open[\s-]?world|\bgta\b|sandbox|\bworld\b.*\b(?:explore|big|huge|large)\b|\b(?:big|huge|large|massive|infinite)\s+(?:map|world)\b|survival|\bexplor(?:e|ing|ation)\b|\bisland\b|\bterrain\b/;

/** The game shape a request needs a map for, or null when it needs none (a calculator, a form, a 2D puzzle). */
export function mapProfileFor(prompt: string): MapProfile | null {
  const t = norm(prompt);
  const c = buildGameContract(prompt);
  if (c.dimension === '2d') return null;
  if (asksForBattleRoyale(t)) return 'battle-royale';
  if (FLIGHT.test(t) || c.vehicle === 'aircraft') return 'flight';
  if (c.genre === 'racing' || RACING.test(t) || (c.vehicle && ['car', 'motorcycle', 'truck', 'bus', 'tractor'].includes(c.vehicle) && /\bgame\b|\bsim/.test(t))) return 'racing';
  if (OPEN_WORLD.test(t)) return /\bexplor|\bwalk|survival|adventure/.test(t) ? 'explore' : 'open-world';
  // 🗺️ The WISH, not the word (admin 2026-11-19: "sirf word par nahi, intension par trigger ho"). "Bada map banao",
  // "kahin bhi ghoom sakun", "map bahut chhota hai" mean a big world as surely as "open world" does. Only for a
  // GAME: a big font or a long list is not a world. An endless runner is a lane, not a world.
  const wish = largeWorldIntent(prompt);
  if (wish.wants && isGameRequest(t, c) && !(c.genre === 'runner' && wish.wish === 'never-ending')) {
    return wish.wish === 'free-roam' || /\bexplor|\bwalk|survival|adventure|ghoom|घूम/.test(t) ? 'explore' : 'open-world';
  }
  return null;
}

const GAME_WORD = /\bgames?\b|\bkhel\b|गेम|खेल/;

/** The request is for a game (a named genre, a driven vehicle, or the word itself). */
function isGameRequest(t: string, c: ReturnType<typeof buildGameContract>): boolean {
  return c.genre !== 'unknown' || Boolean(c.vehicle) || GAME_WORD.test(t);
}

/**
 * A race on a ROAD gets the endless road library (endlessRaceCourse.ts, owner 2026-11-18: "racing game me hamesa
 * library se road map") — twelve 10–100 km maps that join seamlessly and never end. The Athree WORLD is for a race
 * where the player leaves the road: free roam, an open world, a named Athree. Without this split, turning the map
 * on (2026-11-19) would have put a second road system under every race.
 */
export function raceWantsOpenWorld(prompt: string): boolean {
  const t = norm(prompt);
  if (OPEN_WORLD_RACE.test(t)) return true;
  const wish = largeWorldIntent(prompt);
  // "Bada MAP / badi DUNIYA" asks for land around the race; "lambi sadak" asks for road, which the library gives.
  return wish.wish === 'free-roam' || (wish.wish === 'big-space' && WORLD_NOUN.test(wish.evidence));
}
const WORLD_NOUN = /\b(?:maps?|worlds?|land|terrain|island|duniya|dunia|zameen|zamin|naksh\w*|ilaa?ka|area|region|continent)\b|मैप|दुनिया|नक्श|ज़मीन|जमीन|इलाक/;
const OPEN_WORLD_RACE = /ओपन\s*वर्ल्ड|खुली\s*दुनिया|open[\s-]?world|\bgta\b|sandbox|free[\s-]?roam|off[\s-]?road|\bterrain\b|\bisland\b/;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The librarian's pick: deterministic for a seed (so a project keeps it), random across seeds, only among maps that fit. */
export function pickLibraryMap(pool: readonly LibraryMap[], seedKey: string): LibraryMap | null {
  if (pool.length === 0) return null;
  return pool[hashString(seedKey) % pool.length];
}

export function athreeMapIntent(input: AthreeIntentInput): AthreeIntent {
  const prompt = String(input.prompt ?? '');
  const t = norm(prompt);
  const maps = input.maps ?? LIBRARY_MAPS;
  const profile = mapProfileFor(prompt);
  const none = (via: AthreeVia, reason: string, mapId: string | null = null): AthreeIntent => ({ use: false, via, mapId, profile, reason });

  // The project already has a map: it keeps it, unless the user asks for a different one.
  if (input.stored && input.stored.mapId && !CHANGE_MAP.test(t)) {
    const use = input.stored.mapId === ATHREE_MAP.id;
    return { use, via: 'stored', mapId: input.stored.mapId, profile, reason: `This project already uses the ${input.stored.mapId} map; edits keep it.` };
  }

  // A different map named by the user wins over everything else.
  for (const m of maps) {
    if (m.id === ATHREE_MAP.id) continue;
    if ([m.name, ...m.aliases].some((a) => a && t.includes(norm(a)))) {
      return none('other-map', `The request names the ${m.name}, so that map is used.`, m.id);
    }
  }
  const named = NAMED.test(t) || NAMED.test(prompt);
  if (DECLINED.test(t) && named) return none('declined', 'The request says not to use the Athree map.');

  if (named) {
    if (profile) return { use: true, via: 'named', mapId: ATHREE_MAP.id, profile, reason: `The request names the Athree map and a ${profile} game needs a map.` };
    return none('named-not-needed', 'The Athree map is a large world for games (racing, open world, battle royale, flight, exploring). This app has no world to put it on, so no map is added.');
  }

  if (profile === 'racing' && !raceWantsOpenWorld(prompt)) {
    return none('road-library', 'A race on a road gets NavBharatAI\'s endless road library (twelve seamless 10–100 km maps); the Athree world is for a race that leaves the road (free roam, open world) or names Athree.');
  }

  if (profile) {
    const pool = maps.filter((m) => m.profiles.includes(profile));
    const pick = pickLibraryMap(pool, input.seedKey ?? prompt);
    if (!pick) return none('none', 'No library map fits this game.');
    return {
      use: pick.id === ATHREE_MAP.id,
      via: pool.length > 1 ? 'librarian' : 'needed',
      mapId: pick.id,
      profile,
      reason: pool.length > 1 ? `A ${profile} game needs a map; the librarian picked ${pick.name} from ${pool.length} that fit.` : `A ${profile} game needs a map; ${pick.name} is the one the library has.`,
    };
  }
  return none('none', 'This app does not need a map.');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// WHICH MODULES of the Athree map a request needs (admin 2026-11-15: "user jo bole woh module user ki need ke anusar run time par bane").
//
// The map is built from modules that need nothing from each other, so a game takes only what its user asked for. The words are the ones a
// user actually types, English and Hinglish (input parsing, like the Athree name detector, is exempt from the English-only UI rule).
// A request that names none of them ("a big open world") gets everything: the safe default is the whole map, never a bare one.
// PURE: no I/O, no clock, no env. Never throws.

export { athreeModulesFor, enforceAthreeModuleExclusions, type AthreeModules } from './athreeModuleSelection';
