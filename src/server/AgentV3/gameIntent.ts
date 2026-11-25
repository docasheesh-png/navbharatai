// GAME ENGINE ULTRA — PHASE 1: THE GAME'S SCOPE CONTRACT (GDD-lite), read from the request. PURE.
//
// 🔴 THE GAP (Phase 0 audit, 2026-10-30). The route knows a request is a game (`analyzeRequirementGaps` →
// 'game') and lays the kit down (gameKitSeed.ts), and after the build it PLAYS the game (gamePlaytest.ts).
// Nothing between those two steps writes down WHAT game was asked for — the genre, 2D or 3D, the controls,
// and the features the user named (score, levels, lives, a timer, enemies…). So the builder reads them out
// of a long prompt, and nothing afterwards can say "you asked for levels and the game has none".
//
// 🧬 WHAT THIS DOES. Turns the user's own words into a small typed contract — no model call, no guess
// beyond the words: a feature is REQUIRED only when the request names it. The contract is (1) handed to the
// builder in the kit handoff, and (2) compared after the build with what the code shows (`scopeMatch`), and
// that comparison is recorded as EVIDENCE (GAME_SCOPE_GAP / GAME_SCOPE_OK), never a gate, never a charge.
//
// Kill switch: AGENTV3_GAME_SCOPE_CONTRACT=off restores the pre-contract behaviour exactly.

import { withoutDeclinedSentences } from '../lib/RequirementGapAnalyzer';
import { withoutNonObjectSenses } from '../lib/heroObjectSpec';
import { largeWorldIntent } from './largeWorldIntent';
import { findGameTitles, mentionsBattleRoyale, ROYALE_GENRE_PHRASE, unrecognisedGameReference, type GameTitleKind } from '../lib/wellKnownGameTitles';
import { withoutComments } from '../lib/codeOnly';
import { reachableGameFiles } from './gameCodeReach';
import { gameCombatFrom, gameCombatLines, gameRulesFrom, gameRulesBlock, type GameCombatData, type GameRule } from './gameRules';
export type GameGenre =
  | 'racing' | 'shooter' | 'platformer' | 'puzzle' | 'quiz' | 'card' | 'board' | 'runner'
  | 'arcade' | 'sports' | 'fighting' | 'rpg' | 'strategy' | 'snake' | 'simulator' | 'unknown';
export type GameDimension = '2d' | '3d' | 'unspecified';
export type GameControl = 'keyboard' | 'touch' | 'mouse' | 'gamepad';
export type GameFeature =
  | 'score' | 'levels' | 'lives' | 'timer' | 'enemies' | 'powerups' | 'leaderboard'
  | 'multiplayer' | 'sound' | 'restart' | 'pause' | 'health' | 'throttle' | 'braking' | 'crashDamage' | 'police'
  // Master audit Part J (2026-11-25): features users name that used to be acknowledged and then written as text or props.
  | 'swimming' | 'enterableHouses' | 'destructible' | 'traffic' | 'npcs';
/** The vehicle the player drives or flies, when the request names one. */
export type GameVehicle = 'train' | 'car' | 'bus' | 'truck' | 'motorcycle' | 'bicycle' | 'aircraft' | 'boat' | 'tractor' | 'rickshaw';
/** Explicit runner requirements are not collapsed into a generic 'powerups' bucket. */
export type RunnerMechanic = 'auto-run' | 'lane-change' | 'jump' | 'slide' | 'obstacles'
  | 'currency-counters' | 'character-shop' | 'currency-unlocks' | 'high-score' | 'collision-game-over';
export type GameCollectible = 'coins' | 'diamonds';
export type GameCamera = 'third-person' | 'first-person' | 'top-down' | 'unspecified';

export interface GameScopeContract {
  genre: GameGenre;
  dimension: GameDimension;
  /** Controls the request named; [] when it named none (the kit's keyboard+touch default then applies). */
  controls: GameControl[];
  /** Features the request NAMED — the scope the built game is checked against. */
  requiredFeatures: GameFeature[];
  /** Did the request name a win or lose condition (game over, win, finish line…)? */
  winLoseNamed: boolean;
  /**
   * 🔴 WHAT WAS LOST BEFORE (autopsy 61279465, 2026-11-04). "Create a 3D train simulator with a realistic
   * train, railway tracks, trees, buildings and mountains … free external 3D assets … mobile controls"
   * became {genre: unknown, requiredFeatures: []} — the train, the track, the scenery, the camera and the
   * assets were nowhere in the contract, so nothing after planning could hold the build to them. These four
   * fields carry them. Optional so a contract recorded before them still reads.
   */
  /** The vehicle the player controls, or null. */
  vehicle?: GameVehicle | null;
  /** The camera the request named; for a driven vehicle with none named, the chase view ('third-person'). */
  camera?: GameCamera;
  /** The world the request named, in the reviewed catalogue's words (train, railway track, tree, building, mountain…). */
  subjects?: string[];
  /** Did the request ask for real 3D models/assets rather than primitive placeholders? */
  externalAssets?: boolean;
  /** The cause → effect rules the user stated (gameRules.ts): "killing an enemy raises the score". Absent when none. */
  rules?: GameRule[];
  /** Combat rules the user stated ("5 goli me mare", "bleeding"), as data for the kit's Health. Absent when none. */
  combat?: GameCombatData;
  /** The well-known game the user named as the reference ("PUBG", "BGMI", "GTA 5"); absent when none. */
  reference?: string;
  /**
   * A name the user held up as the model for the game ("zorbix jaisa game") that is none of our titles, read only when the
   * request names no genre and no vehicle either. The builder is told not to guess what it is and to ask (failedbr #2497:
   * an unread title must never silently become a 2D game). Absent when none.
   */
  unrecognisedReference?: string;
  /** BR1954: named actions/economy survive the contract, including on existing-game edits. */
  runnerMechanics?: RunnerMechanic[];
  collectibles?: GameCollectible[];
  minimumUnlockableCharacters?: number;

}

export function gameScopeContractEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_SCOPE_CONTRACT ?? '').trim().toLowerCase() !== 'off';
}

const GENRES: ReadonlyArray<[GameGenre, RegExp]> = [
  // A SIMULATOR is read first only when the request SAYS simulator/simulation or names a train or a plane —
  // "racing simulator" still says racing below, because a race is the stronger signal of what the game is.
  ['racing', /\b(rac(e|ing)|kart|drift)\b/i],
  ['simulator', /\b(simulat(or|ion)|sim game|train (game|driver|driving)|(train|railway|rail|locomotive|metro) (simulator|game)|flight sim|flying game|bus driving|truck driving|driving school|parking game)\b|\btrain\b.*\b(rail(way)?s?|tracks?|locomotive|station|coach(es)?)\b|\b(rail(way)?s?|tracks?|locomotive|station)\b.*\btrains?\b/i],
  ['racing', /\b(rac(e|ing)|car game|kart|drift|bike game|motorcycle|car wal[ae] khel|gaadi wal[ae] khel)\b/i],
  ['snake', /\bsnake\b/i],
  ['quiz', /\b(quiz|trivia)\b/i],
  ['card', /\b(card game|solitaire|poker|uno|teen ?patti|rummy)\b/i],
  // Business / vyapaar (the property-trading board game) — game-gap audit 2026-11-20: it read as genre 'unknown'.
  ['board', /\b(chess|ludo|tic[- ]?tac[- ]?toe|checkers|carrom|board game|snakes? and ladders?|business\s+game|vyapaa?r(?:\s+game)?|monopoly|property[- ]trading\s+game)\b|व्यापार\s*(?:का\s*)?(?:खेल|गेम)/i],
  ['puzzle', /\b(puzzle|sudoku|match[- ]?3|candy|2048|tetris|crossword|memory game)\b/i],
  ['runner', /\b(endless\s+runn(?:er|ing)|runner|subway surf)|(?:एंडलेस|अंतहीन)\s*(?:रनर|रनिंग|दौड़)/i],
  ['platformer', /\b(platformer|mario|jump(ing)? game)\b/i],
  ['shooter', /\b(shoot(er|ing)|fps|gun|space invaders?|bullet)\b/i],
  ['fighting', /\b(fight(ing)?|god of war|combat|brawler|boxing)\b/i],
  ['sports', /\b(cricket|football|soccer|basketball|tennis|badminton|golf)\b/i],
  ['rpg', /\b(rpg|role[- ]?playing|open world|adventure)\b/i],
  ['strategy', /\b(strategy|tower defen[cs]e|rts)\b/i],
  ['arcade', /\b(arcade|flappy|pong|breakout|pac-?man)\b/i],
];

/**
 * 🔴 A NAMED GAME IS A SPECIFICATION (autopsy aba63ead, failedbr #2475, 2026-11-19).
 *
 * "mujhe pubg/bgmi jaisa game chahiye. jahan ham character ko joystick se move kare!" became
 * {genre: unknown, dimension: unspecified, camera: unspecified}. The scope reader on the same request said
 * "clone of PUBG" and the map reader said 'battle-royale', but the contract the BUILDER reads named nothing,
 * so a Weak builder kept the project's old 2D city map as the game, put a "photo" in front of the user
 * ("apne pata nahi kya photo bana diya hai") and never mounted a 3D world. When a user names a well-known
 * game as the reference, its genre, its view and its camera are what they asked for — written down here
 * (the build is still an ORIGINAL game in that genre, never a copy of the named one).
 *
 * ONE reader for "a royale-style game": this module's `asksForBattleRoyale`. The map profile
 * (athreeMapIntent) and the royale starter's guard (ToolDispatcher) used private copies that had already
 * drifted apart (one knew Fortnite, the other Battlefield) — both read this one now.
 */
/**
 * Does the request ask for a royale-style game (by genre or by a named royale title, in ANY spelling — "bubg", "pabji",
 * "bgmii", "frie fire": failedbr #2497)? The shared tolerant matcher in lib/wellKnownGameTitles decides. PURE.
 */
export function asksForBattleRoyale(text: string | null | undefined): boolean {
  return mentionsBattleRoyale(text);
}

/**
 * An action, shooter or open-world game (PUBG, Free Fire, BGMI, GTA, in any language) is a world of
 * enterable houses. A flat 2D game is not. PURE.
 */
export function asksForEnterableHouses(text: string | null | undefined): boolean {
  const raw = withoutDeclinedSentences(String(text ?? ''));
  if (/\b(?:2d|two[\s-]?d)\b/i.test(raw) || names2DWorld(raw)) return false;
  if (asksForBattleRoyale(raw)) return true;
  if (/\b(?:gta|grand theft|gta[\s-]?v|gta[\s-]?5)\b|जीटीए/i.test(raw)) return true;
  if (/\b(?:open[\s-]?world|free[\s-]?roam)\b|ओपन\s*वर्ल्ड/i.test(raw)) return true;
  const contract = buildGameContract(raw);
  if (contract.dimension === '2d') return false;
  if (contract.genre === 'shooter' && (contract.dimension === '3d' || contract.camera === 'third-person' || contract.camera === 'first-person')) return true;
  if (/\baction\b/i.test(raw) && /\b(?:3d|third[\s-]?person|open)\b/i.test(raw)) return true;
  if (/एक्शन/.test(raw) && /(?:3\s*d|तीन|ओपन)/i.test(raw)) return true;
  return false;
}

interface NamedGameReference { name: string; genre: GameGenre; dimension: GameDimension; camera: GameCamera }

/** Title kinds → what naming one asks for. The request's own explicit words still win.
 * GTA is deliberately absent: its titles already take the 3D open-world kit through their own reader (#4151). Minecraft and
 * the 'other' kind name no genre the contract can promise. */
const ROYALE_SPEC: Omit<NamedGameReference, 'name'> = { genre: 'shooter', dimension: '3d', camera: 'third-person' };
const NAMED_KINDS: Partial<Record<GameTitleKind, Omit<NamedGameReference, 'name'>>> = {
  royale: ROYALE_SPEC,
  fps: { genre: 'shooter', dimension: '3d', camera: 'first-person' },
  runner: { genre: 'runner', dimension: '3d', camera: 'third-person' },
};

/**
 * The well-known game the request names as its reference, with what that asks for, or null. The title is read by the ONE
 * tolerant matcher (failedbr #2497: "bubg" is PUBG), and the reference is its proper name ("PUBG"), never the typo. A royale
 * named by genre words alone ("battle royale", "FF max jaisa") is a royale reference too. PURE.
 */
export function namedGameReference(text: string | null | undefined): NamedGameReference | null {
  const t = String(text ?? '').normalize('NFKC');
  const titles = findGameTitles(t);
  // A royale wins over the other kinds, as it always has ("a battle royale like Call of Duty" is a royale).
  const royale = titles.find((m) => m.kind === 'royale');
  if (royale) return { name: royale.name, ...ROYALE_SPEC };
  const phrase = ROYALE_GENRE_PHRASE.exec(t);
  if (phrase) return { name: phrase[0].trim(), ...ROYALE_SPEC };
  for (const m of titles) {
    const spec = NAMED_KINDS[m.kind];
    if (spec) return { name: m.name, ...spec };
  }
  return null;
}

/** 2D games that MOVE a body on screen — the platform draws these flat, with the 2D kit (gameKitSeed). */
export const MOVING_2D_GENRES: ReadonlySet<string> = new Set(['platformer', 'runner', 'shooter', 'arcade', 'fighting']);

const NAMES_2D_WORLD = /\b(?:2d|two[\s-]?d)\s+(?:world|map|open[\s-]?world)\b|\btop[\s-]?down\s+(?:world|map|rpg|game|adventure)\b|\btile[\s-]?map\b|\b(?:rpg|zelda[\s-]?like|pokemon[\s-]?like)\s+(?:world|map)\b/i;
/** Does the request name the 2D world itself — a 2D map, a top-down world, a tile map? PURE. */
export function names2DWorld(text: string | null | undefined): boolean {
  return NAMES_2D_WORLD.test(String(text ?? ''));
}

/**
 * 🗺️ A BIG MAP IS DRAWN IN 3D UNLESS 2D WAS ASKED (failedbr #2497, 2026-11-22 — "ek bahut bada map par bubg jaisa game
 * banao!!", admin: "ye pubg ki jagah kya bana diya").
 *
 * 🔑 THE DISAGREEMENT. Readers answered "what does a big-map game with no stated view get?" differently: the map profile
 * (athreeMapIntent.mapProfileFor) read the wish as an open world — the 3D Athree map — while the kit seed, finding no 3D
 * word, laid the 2D kit and the 2D world (world2dIntent) under it, and this contract said "unspecified". Every positive case
 * the 2D world was built for says 2D or top-down in so many words ("2D game banao jiska map bahut bada ho", "top-down RPG
 * with a huge world"), so an unstated view was never its intended input.
 *
 * THE RULE (explicit, ONE place — the contract's view, the kit seed and the 2D world all read it): a game whose request asks
 * for a BIG WORLD (largeWorldIntent: a big space, free roam or a distance) is drawn in 3D on the platform's big map — UNLESS
 * the request says a top-down view or a 2D world, or names a genre this platform draws flat (platformer, runner, arcade,
 * fighting, shooting, snake). The caller has already checked the words "2D" / "3D". A complaint about an existing world's
 * size ("map chhota hai") and a road that never ends are left out: they describe a game already built, or a lane. PURE.
 */
export function bigWorldWantsThreeD(text: string, genre: GameGenre, camera: GameCamera): boolean {
  const wish = largeWorldIntent(text);
  if (!wish.wants || (wish.wish !== 'big-space' && wish.wish !== 'free-roam' && wish.wish !== 'distance')) return false;
  if (camera === 'top-down' || names2DWorld(text)) return false;
  return !MOVING_2D_GENRES.has(genre) && genre !== 'snake';
}

const FEATURES: ReadonlyArray<[GameFeature, RegExp]> = [
  ['score', /\b(score|points?|high ?score)\b/i],
  // "Worlds" are levels only when COUNTED ("5 worlds", "world 2"). "Open world", "big world", "game world" name the setting,
  // never levels (failedbr #2487: a GTA open-world request was given the required feature "levels" and checked for it).
  ['levels', /\b(levels?|stages?)\b|\b\d+\s+worlds\b|\bworlds?\s+\d+\b/i],
  ['lives', /\blives\b|\b\d+\s*li(fe|ves)\b/i],
  ['timer', /\b(timer|countdown|time limit|stopwatch)\b/i],
  ['enemies', /\b(enem(y|ies)|monsters?|zombies?|aliens?|bosse?s?)\b/i],
  ['powerups', /\b(power[- ]?ups?|boosts?)\b/i],
  ['leaderboard', /\b(leader ?board|rankings?)\b/i],
  ['multiplayer', /\b(multi-?player|online|pvp|co-?op|2 players?|two players?)\b/i],
  ['sound', /\b(sound|music|audio|sfx)\b/i],
  ['restart', /\b(restart|play again|retry|replay)\b/i],
  ['pause', /\bpause\b/i],
  ['health', /\b(health|hp|health ?bar)\b/i],
  ['throttle', /\b(accelerat(e|ion|or)|throttle|speed control|gas pedal)\b/i],
  ['braking', /\bbrak(e|es|ing)\b/i],
  // Question 9 (admin 2026-11-24): "car me dent padna chahiye", "realistic accident".
  ['crashDamage', /\b(dents?|dented|crumpl\w*|(car|vehicle) damage|realistic (crash|accident)\w*|(crash|accident)\w* (realistic|real lagni|real lage))\b|dent pad/i],
  // Master audit Part I (2026-11-25): "when any crime happens, police should arrive" — police, an ambulance, a fire brigade,
  // a wanted level. Hindi/Hinglish forms too ("pulis aa jaye", "पुलिस").
  ['swimming', /\b(swim(s|ming)?|dive|diving|underwater)\b|\btair(na|ta|te|ke|ega|engi)\b|तैर/i],
  ['enterableHouses', /\b(enter(able)?|walk[- ]?in(to)?|go(es)? inside|get inside|inside the)\s+(a\s+|the\s+)?(houses?|homes?|buildings?|shops?)\b|\b(enterable|walk-?in|walkable)\s+(houses?|homes?|buildings?)\b|\b(ghar|makan|dukan)\s+(ke\s+)?andar\b|घर के अंदर/i],
  ['destructible', /\b(destructibles?|breakables?|destroyable)\b|\b(break|smash|destroy)\w*\s+(the\s+)?(doors?|walls?|crates?|boxes|glass|windows?|barrels?)\b|\b(darwaza|deewar|diwar)\s+tod/i],
  // ASKED FOR ("with traffic", "add traffic", "traffic chahiye"), never the bare word: the platform's own city answer line
  // ("streets, buildings and traffic", gameKitSeed CITY_LINE) describes what the kit gives and is not a request.
  ['traffic', /\b(with|add|have|has|needs?|want|wants)\s+(some\s+|real\s+|moving\s+|heavy\s+)?traffic\b|\btraffic\s+(system|lights?|jams?|ho|chahiye|chale|chalni|chalna)\b|\b(cars?|vehicles?|buses)\s+(that\s+)?(drive|run|move|follow)s?\s+(on\s+|along\s+)?(the\s+)?roads?\b|\bsadak\s+par\s+gaadi/i],
  ['npcs', /\b(npcs?|villagers?|civilians?|pedestrians?|townsfolk|bystanders?)\b|\bpeople\s+(walking|on the streets?)\b|\blog\s+ghoom/i],
  ['police', /\b(police|cops?|wanted level|wanted stars?|ambulance|fire ?brigade|fire ?truck|pulis)\b|पुलिस|एम्बुलेंस/i],
];

/**
 * A feature the raw request names only inside a refusal ("no multiplayer", "no braking").
 * The contract already drops those words before it decides what is required; this lists them
 * so a later reader can refuse to build them. PURE.
 */
export function declinedGameFeatures(prompt: string | null | undefined): GameFeature[] {
  const raw = String(prompt ?? '');
  const kept = withoutDeclinedSentences(raw);
  return FEATURES.filter(([, re]) => re.test(raw) && !re.test(kept)).map(([f]) => f);
}

const VEHICLES: ReadonlyArray<[GameVehicle, RegExp]> = [
  ['train', /\b(locomotives?|railway engine|metro|rail ?car)\b|\btrains?\s+(simulator|simulation|game|driv\w*|ride|station|tracks?|journey|coach(es)?)\b|\b(a|the|3d|3-d|realistic|passenger|express|goods|freight|bullet|steam|electric|diesel|toy|indian)\s+trains?\b(?!\s+(your|my|his|her|their|to)\b)/i],
  ['aircraft', /\b(aircraft|aeroplanes?|airplanes?|planes?|jet|helicopter|flight)\b/i],
  ['bus', /\bbus(es)?\b/i],
  ['truck', /\b(trucks?|lorry|lorries)\b/i],
  ['tractor', /\btractors?\b/i],
  ['rickshaw', /\b(auto ?rickshaw|rickshaw|tuk ?tuk)\b/i],
  ['motorcycle', /\b(motor ?(cycle|bike)s?|bike game|scooter)\b/i],
  ['bicycle', /\b(bicycles?|cycling)\b/i],
  ['boat', /\b(boats?|ships?|sailing)\b/i],
  // BR1977: Hinglish spellings of gaadi (gadi, gadiyan) are the same vehicle.
  ['car', /\b(cars?|gaadiyaan|gaadiyan|gadiyaan|gadiyan|gadiya|gaadi|gadi|taxi|jeep|drive|driving)\b/i],
];

/** Named world subjects → the catalogue's own words (assetPlan aliases). Order is the order they are listed. */
const SUBJECTS: ReadonlyArray<[string, RegExp]> = [
  ['train', /\b(locomotives?|railway engine|metro|rail ?car)\b|\btrains?\s+(simulator|simulation|game|driv\w*|ride|station|tracks?|journey|coach(es)?)\b|\b(a|the|3d|3-d|realistic|passenger|express|goods|freight|bullet|steam|electric|diesel|toy|indian)\s+trains?\b(?!\s+(your|my|his|her|their|to)\b)/i],
  ['railway track', /\b(rail(way)?s?|tracks?|rail ?line)\b/i],
  ['station', /\b(railway )?stations?\b/i],
  ['road', /\b(roads?|highway|street)\b/i],
  ['tree', /\b(trees?|forest|jungle)\b/i],
  ['building', /\b(buildings?|city|skyscrapers?|town)\b/i],
  ['house', /\b(house|houses|village|huts?)\b/i],
  ['mountain', /\b(mountains?|hills?|valley)\b/i],
  ['river', /\b(rivers?|lake|water|bridge)\b/i],
  ['rock', /\b(rocks?|boulders?)\b/i],
];

const CONTROLS: ReadonlyArray<[GameControl, RegExp]> = [
  ['keyboard', /\b(keyboard|arrow keys?|wasd|space ?bar)\b/i],
  ['touch', /\b(touch|swipe|tap|mobile|phone|joystick)\b/i],
  ['mouse', /\b(mouse|click)\b/i],
  ['gamepad', /\b(gamepad|controller)\b/i],
];

/** Precision-first, local clauses: a declined mechanic is never promoted to a requirement.
 * Keep the shared reader, then recognize Devanagari declines without ASCII word boundaries.
 */
function runnerRequestText(text: string): string {
  return withoutDeclinedSentences(text).split(/[.!?।\n;,]+/u).filter((clause) =>
    !/(?:नहीं|नही|मत)\s*(?:चाहिए|चाहिये|चाहते|चाहता|होना|करना|करो|बनाओ|जोड़ो)|(?:हटाओ|हटाना|निकालो)/u.test(clause)
      && !/^\s*(?:please\s+)?(?:remove|delete|drop|disable|hide)\b/i.test(clause)
  ).join(' ');
}

const RUNNER_MECHANICS: ReadonlyArray<[RunnerMechanic, RegExp]> = [
  ['auto-run', /\b(?:auto[- ]?run|continuous(?:ly)?\s+(?:forward|run)|endless\s+runn(?:er|ing))\b|लगातार[^.!?\n]{0,55}(?:दौड़|दौड़)/i],
  ['lane-change', /\b(?:lane[- ]?(?:chang\w*|switch\w*)|switch\s+lanes?|change\s+lanes?)\b|\bswipe\s+left\b[^.!?\n]{0,65}\bright\b|रास्ता\s*बदल/i],
  ['jump', /\bjump(?:ing)?\b|(?:कूद|जंप)/i],
  ['slide', /\bslid(?:e|ing)\b|स्लाइड/i],
  ['obstacles', /\bobstacles?\b|बाधा(?:एं|एँ|ओं)?/i],
  ['currency-counters', /\b(?:coin|diamond|currency)s?\s*(?:counter|count|balance)s?\b|काउंटर|अलग[^.!?\n]{0,20}गिनती/i],
  ['character-shop', /\bcharacter\s+shop\b|कैरेक्टर\s*(?:शॉप|दुकान)/i],
  ['currency-unlocks', /\b(?:coin|diamond)s?\b[^.!?\n]{0,60}(?:\bspend\w*\b|खर्च)[^.!?\n]{0,80}\bunlock\w*\b|\b(?:spend|use)\b[^.!?\n]{0,30}\b(?:coin|diamond)s?\b[^.!?\n]{0,80}\bunlock\w*\b|(?:सिक्के|हीरे)[^.!?\n]{0,60}खर्च[^.!?\n]{0,80}अनलॉक/i],
  ['high-score', /\bhigh\s*score\b|हाई\s*स्कोर|सर्वाधिक\s*स्कोर/i],
  ['collision-game-over', /\b(?:collision|collid\w*|crash)\b[^.!?\n]{0,100}\bgame\s*over\b|टक्कर[^.!?\n]{0,80}\bgame\s*over\b/i],
];

function runnerRequirements(prompt: string): Pick<GameScopeContract, 'runnerMechanics' | 'collectibles' | 'minimumUnlockableCharacters'> {
  const text = runnerRequestText(prompt);
  const collectibles: GameCollectible[] = [];
  if (/\bcoins?\b|सिक्के|सिक्कों/i.test(text)) collectibles.push('coins');
  if (/\bdiamonds?\b|हीरे|हीरों/i.test(text)) collectibles.push('diamonds');
  const runnerMechanics = RUNNER_MECHANICS.filter(([name, re]) => re.test(text)
    && (name !== 'currency-counters' || collectibles.length > 0)).map(([name]) => name);
  const digits = text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - '०'.charCodeAt(0)));
  const min = /(?:at\s+least|minimum|कम\s*से\s*कम)\s*(\d+)\s*(?:(?:different|अलग[- ]अलग)\s*)?(?:unlockable\s+|अनलॉक\s*करने\s*योग्य\s*)(?:characters?|कैरेक्टर)/i.exec(digits);
  const minimumUnlockableCharacters = min ? Number(min[1]) : undefined;
  return {
    ...(runnerMechanics.length ? { runnerMechanics } : {}),
    ...(collectibles.length ? { collectibles } : {}),
    ...(minimumUnlockableCharacters && Number.isSafeInteger(minimumUnlockableCharacters) ? { minimumUnlockableCharacters } : {}),
  };
}

/** The request's own words → the contract. PURE; never throws. */
export function buildGameContract(prompt: string | null | undefined): GameScopeContract {
  // What the user DECLINED is not what they named (autopsy 958aa1ec: "no login, multiplayer, purchases" made
  // multiplayer a required feature). The same reader the domain and the complexity signals use.
  const text = withoutDeclinedSentences(String(prompt ?? ''));
  const reference = namedGameReference(text);
  const genre = GENRES.find(([, re]) => re.test(text))?.[0] ?? reference?.genre ?? 'unknown';
  const requiredFeatures = FEATURES.filter(([, re]) => re.test(text)).map(([f]) => f);
  // The vehicle is read with the hero contract's own non-object senses removed (one reader of "is this word the object"),
  // so a "ground plane" is never an aircraft here while the hero contract says otherwise (failedbr #2478).
  const objectText = withoutNonObjectSenses(text);
  const vehicle = VEHICLES.find(([, re]) => re.test(objectText))?.[0] ?? null;
  // A vehicle the player DRIVES is driven: it speeds up and it stops. A train, bus or car simulator that
  // cannot brake is not the game that was asked for, whether or not the request spelt the word out.
  // Only for a SIMULATOR: an endless lane-change racer drives itself and never brakes, and the contract's own rule
  // is that a feature is required only when named (theDeclinedListStaysDeclined) — a simulator is where driving IS the game.
  if (vehicle && genre === 'simulator') {
    // A plane or a boat is throttled, not braked.
    const implied = vehicle === 'aircraft' || vehicle === 'boat' ? (['throttle'] as const) : (['throttle', 'braking'] as const);
    for (const f of implied) if (!requiredFeatures.includes(f)) requiredFeatures.push(f);
  }
  const camera: GameCamera = /\b(first[- ]person|cockpit|cab view|fps)\b/i.test(text) ? 'first-person'
    : /\b(top[- ]down|bird'?s[- ]eye|overhead)\b/i.test(text) ? 'top-down'
      : /\b(third[- ]person|chase cam(era)?|behind the)\b/i.test(text) || vehicle ? 'third-person' : reference?.camera ?? 'unspecified';
  // The view: the request's own words, then a named title's, then the big-world rule (failedbr #2497), else unspecified.
  const dimension: GameDimension = /\b3\s?-?d\b|three\.?js|open world/i.test(text) ? '3d' : /\b2\s?-?d\b/i.test(text) ? '2d'
    : reference?.dimension ?? (bigWorldWantsThreeD(text, genre, camera) ? '3d' : 'unspecified');
  const unrecognisedReference = !reference && genre === 'unknown' && !vehicle ? unrecognisedGameReference(text) : null;
  const rules = gameRulesFrom(text);
  const combat = gameCombatFrom(text);
  return {
    ...(rules.length ? { rules } : {}),
    ...(Object.keys(combat).length ? { combat } : {}),
    ...(reference ? { reference: reference.name } : {}),
    ...(unrecognisedReference ? { unrecognisedReference } : {}),
    genre,
    dimension,
    controls: CONTROLS.filter(([, re]) => re.test(text)).map(([c]) => c),
    requiredFeatures,
    winLoseNamed: /\b(game over|win|lose|winner|finish line|you died|checkmate)\b/i.test(text),
    vehicle,
    camera,
    subjects: SUBJECTS.filter(([, re]) => re.test(text)).map(([n]) => n),
    ...(genre === 'runner' ? runnerRequirements(String(prompt ?? '')) : {}),
    externalAssets: !/\b(procedural (geometry )?only|no (external|downloaded|3d) (image\/)?(models?|assets?))\b/i.test(text) && /\b(external|free|real|realistic|cc0|downloaded?|glb|gltf)\b[^.]{0,40}\b(3d )?(assets?|models?)\b|\bnot (primitive|placeholder)|\bno (primitive|placeholder)s?\b/i.test(text),
  };
}

/** The block the builder reads in the kit handoff. '' when the contract adds nothing. PURE. */
export function gameContractBlock(c: GameScopeContract): string {
  if (c.genre === 'unknown' && c.requiredFeatures.length === 0 && c.controls.length === 0 && c.dimension === 'unspecified' && !c.vehicle && !(c.subjects ?? []).length && !c.reference && !c.unrecognisedReference && !(c.rules ?? []).length) return '';
  const lines = [
    '[GAME SCOPE CONTRACT — read from the request, checked after the build]',
    `Genre: ${c.genre}. View: ${c.dimension}.`,
    c.reference ? `The user named "${c.reference}" as the reference: build an ORIGINAL ${c.dimension === '3d' ? '3D ' : ''}${c.genre} game in that style (never its name, characters, art or maps). The PLAYABLE game itself — ${c.dimension === '3d' ? 'a 3D world drawn on a canvas, ' : ''}a character or vehicle the player controls${c.camera && c.camera !== 'unspecified' ? `, a ${c.camera} camera` : ''} — must be the first screen or one press away. A map, a menu, a list or a picture standing in for the game is not the game; if the project already holds such a screen, replace it.` : '',
    c.unrecognisedReference ? `The user wants a game like "${c.unrecognisedReference}", and NavBharatAI does not recognise that name as a game it knows. Do NOT guess what it is and do NOT invent its genre or rules on your own idea: build only what the request makes clear (the kit already laid down follows the request's own words), then ask ONE short question in the user's language that names the choices (for example: "${c.unrecognisedReference} kaisa game hai — shooting, racing ya puzzle? 3D ya 2D?").` : '',
    c.vehicle ? `The player drives: a ${c.vehicle} — it must speed up, slow down and stop under the player's control, on keys AND touch.` : '',
    c.camera === 'third-person' && c.vehicle ? `Camera: a chase view from OUTSIDE the ${c.vehicle} — CameraRig({ kind: 'chase' }) and rig.follow(${c.vehicle === 'train' ? 'train' : 'vehicle'}, dt) every frame. The rig sizes itself to the model, so never hand it a fixed offset and never place the camera yourself.`
      : c.camera && c.camera !== 'unspecified' ? `Camera: ${c.camera}.` : '',
    (c.subjects ?? []).length ? `The world the user named — every one must be in the scene: ${(c.subjects ?? []).join(', ')}.` : '',
    c.externalAssets ? 'The user asked for real 3D models, not primitive placeholders — use the models already in src/game/three/assetModels.ts where they exist.' : '',
    c.controls.length ? `Controls the user asked for: ${c.controls.join(', ')} (keep touch working on a phone too).` : 'Controls: keyboard AND on-screen touch.',
    c.requiredFeatures.length ? `Features the user named — each must really work in the game: ${c.requiredFeatures.join(', ')}.` : '',
    c.runnerMechanics?.length ? `Runner mechanics explicitly requested — implement every one, not just labels: ${c.runnerMechanics.join(', ')}.` : '',
    c.collectibles?.length ? `Named collectibles: ${c.collectibles.join(', ')}. They are distinct currencies/collectibles, not permission to invent power-ups or real-money purchases.` : '',
    c.minimumUnlockableCharacters ? `At least ${c.minimumUnlockableCharacters} distinct unlockable characters, with actual unlock conditions and selection behavior; never just a labelled roster.` : '',
    c.runnerMechanics?.includes('currency-unlocks') ? 'Currency unlocks must really spend the named in-game balance, reject unaffordable purchases and allow selecting an unlocked character; not a shop mockup.' : '',
    gameRulesBlock(c.rules ?? []),
    'Any OTHER rule the user states (scoring, levels, game over, hits to kill, bleeding) is made real with run_recipe({ name: "compose_rule", input: { rule } }) — the kit then runs it as data; a rule it refuses is written as code.',
    c.combat && gameCombatLines(c.combat).length ? ['Combat rules the user named — the kit applies them as data, the game must use its Health:', ...gameCombatLines(c.combat)].join('\n') : '',
    c.requiredFeatures.includes('swimming') ? 'Swimming must REALLY work: give the water to the player (ctx.player.setWater(height or (x, z) => height), or addWater from src/game/three/surfaces) — the controller swims, dives (C / Ctrl) and runs out of breath. Never a blue plane the player walks across.' : '',
    c.requiredFeatures.includes('enterableHouses') ? 'Houses must be ENTERABLE: createEnterableHouse from src/game/three/buildings (a door that opens with Use, a hollow inside with floor, walls and ceiling that collide, the roof fading while inside); a library house is wrapped with enterableShellFor. A closed shell is not a house the player can enter.' : '',
    c.requiredFeatures.includes('destructible') ? 'Things that break must REALLY break: makeBreakable(object) from src/game/three/breakable, then hitBreakables / damageBreakable from a shot, punch or crash — debris flies and settles. Never a mesh that only disappears or a message that says it broke.' : '',
    c.requiredFeatures.includes('traffic') ? 'Traffic must REALLY drive the roads: createCityTraffic(city) from src/game/three/citytraffic (cars follow the lanes and stop at the lights), or createTraffic from src/game/three/objects for one road. Parked cars are not traffic.' : '',
    c.requiredFeatures.includes('npcs') ? 'People must REALLY be there and move: new Entities(ctx) from src/game/systems/entities (spawned, verified, walking, kept apart) or createCityPeople(city) for a city crowd. Never a count in the HUD with nobody on screen.' : '',
    c.requiredFeatures.includes('police') ? 'Police (or an ambulance, a fire brigade) must REALLY come: new Wanted(ctx, npcs, new Dispatch(ctx, npcs)) from src/game/systems/dispatch.ts — a crime raises the wanted level and a real car with sirens brings officers who pursue and arrest. Never a line of text saying they came.' : '',
    c.requiredFeatures.includes('crashDamage') ? 'Crashes must DENT the car: call enableVehicleDents() once from src/game/three/dents (the kit pushes the body in where it hit, deeper for a harder crash, and says VEHICLE_DAMAGED { vehicle, damage }); repairVehicle(car) restores it.' : '',
    c.winLoseNamed ? 'The request names a win/lose condition — the game must reach it and show it.' : 'Give the game a clear goal and a game-over / win screen with a way to play again.',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * What the built code NAMES for each feature — the code SIGNAL. It decides "missing" (no sign at all) and nothing more:
 * since the external Game Maker audit (2026-11-25) a signal alone is "not verified", never "present" (see KIT_CALL and
 * scopeMatch; a played action is the other proof, gamePlaytest.ts `gameFeatureEvidence`).
 */
const PRESENT: Readonly<Record<GameFeature, RegExp>> = {
  // Plurals count: `levels`, `enemies`, `coins` are the same feature (the code is also read with camelCase split,
  // so `currentLevel` and `nextLevel()` reach `level` — see scopeMatch).
  score: /\bscores?\b/i,
  levels: /\blevels?\b/i,
  lives: /\blives\b/i,
  timer: /\b(timers?|countdown|timeLeft|remaining)\b/i,
  enemies: /\b(enem(y|ies)|monsters?|zombies?|aliens?|boss(es)?)\b/i,
  powerups: /\b(power-?ups?|boosts?|coins?|collectibles?|pickups?)\b/i,
  leaderboard: /\b(leader-?boards?|rankings?)\b/i,
  multiplayer: /\b(multiplayer|player2|playerTwo|socket|websocket|peer)\b/i,
  sound: /\b(audio|sound|playTone|synth|AudioContext)\b/i,
  restart: /\b(play again|restart|try again|retry|replay)\b/i,
  pause: /\bpause/i,
  health: /\b(health|hp)\b/i,
  throttle: /\b(throttle|accelerat\w*|setSpeed|driveVehicle)\b|\bspeed\s*[+-]?=/i,
  braking: /\b(brak\w*|decelerat\w*|driveVehicle)\b/i,
  crashDamage: /\b(enableVehicleDents|dentVehicle)\b/,
  // Only the REAL system counts (systems/dispatch.ts): a line of text saying "police arrived" is not police (audit Part I).
  // Part J: in a game that has the kit, a word is not even a signal — only the kit system's name is (a hand-written game has
  // no kit APIs, so for it the plain word is the signal: WORD_WITHOUT_KIT — and a signal is only ever "not verified").
  swimming: /\b(setWater|addWater|stepSwim|createRiverWater)\b/,
  enterableHouses: /\b(createEnterableHouse|enterableShellFor)\b/,
  destructible: /\b(makeBreakable|hitBreakables|damageBreakable|breakNow)\b/,
  traffic: /\b(createCityTraffic|createTraffic)\b/,
  npcs: /\bnew\s+Entities\s*\(|\bcreateCityPeople\b|\bcreateHumanoid\b/,
  police: /\bnew\s+(Wanted|Dispatch)\s*\(|\.call\(\s*['"](police|ambulance|fire|security|military)['"]/,
};

/** Any file of the kit's 3D or systems layer: a kit call is a call into it only when it is on disk. */
const KIT_LAYER = /(^|\/)src\/game\/(three|systems)\/[^/]+\.tsx?$/;
/** A file only the 3D kit writes: with it, a Part-J feature counts only when the kit system is called. */
const KIT_MARKER = /(^|\/)src\/game\/three\/surfaces\.ts$/;
/**
 * Without the kit (a 2D game, a hand-written one) there is no kit API to call, so reporting these "missing" would be the
 * checker lying. There the word is the SIGNAL — and since the external Game Maker audit (2026-11-25) a word only ever makes
 * a feature "not verified", never present: "traffic", "swimming" or "door" in the source is not traffic, swimming or a
 * house the player can enter. Only a played action whose state change was observed proves it (gameFeatureEvidence).
 */
const WORD_WITHOUT_KIT: Partial<Record<GameFeature, RegExp>> = {
  swimming: /\b(swim\w*|water)\b/i,
  enterableHouses: /\b(door|interior|inside)\w*/i,
  destructible: /\b(destroy\w*|break\w*|destructible\w*)\b/i,
  traffic: /\b(traffic|cars?)\b/i,
  npcs: /\b(npcs?|villagers?|civilians?|pedestrians?|people)\b/i,
};

/** The same code signal `scopeMatch` uses, for one feature. Kit engine files are not the game. PURE. */
export function codeMentionsFeature(feature: GameFeature, files: Record<string, string>): boolean {
  const code = Object.entries(files || {})
    .filter(([p, v]) => typeof v === 'string' && /\.(t|j)sx?$/.test(p) && !/(^|\/)node_modules\//.test(p) && !/(^|\/)src\/(game\/(core|fx|three)|audio)\//.test(p))
    .map(([, v]) => v).join('\n');
  return PRESENT[feature].test(code);
}

export interface ScopeMatch {
  /**
   * Proven by EXECUTABLE evidence only (external Game Maker audit, 2026-11-25): the kit system that does it is CALLED in a
   * file the running game reaches from its entry. A word in the source is never this. A played action whose state change
   * was observed also proves a feature — that half is the playtest's (`gameFeatureEvidence`, gamePlaytest.ts).
   */
  present: GameFeature[];
  /** No sign of it in the game's code at all. Unchanged by the audit: the done signal and the repair read this. */
  missing: GameFeature[];
  /**
   * 🔴 The code NAMES it (a word, a variable, an uncalled import, a kit call in a file nothing loads) and nothing proves it
   * runs. Before the audit these were counted present: a hand-written game that said "traffic" or "swim" passed. Reported
   * as "not verified", never as present, and never as missing either (a name is not proof it is absent). Absent when none.
   */
  notVerified?: GameFeature[];
  /** For each present feature, the evidence that proved it (`kit call createCityTraffic( in src/game/World.ts`). */
  evidence?: Partial<Record<GameFeature, string>>;
  /** Code tokens cannot prove movement, separate balances, affordable unlocks or character count. */
  unverified?: string[];
}

/**
 * The kit calls that DO a feature — call syntax, so an import list or a type never counts. Only in a project that has the
 * kit (KIT_MARKER) and only in a file the game reaches (gameCodeReach.ts). A hand-written game has no kit to call, so no
 * feature of it is proven by its source; the playtest's played actions are its only proof.
 */
const KIT_CALL: Partial<Record<GameFeature, RegExp>> = {
  throttle: /\bdriveVehicle\s*\(/,
  braking: /\bdriveVehicle\s*\(/,
  crashDamage: /\b(enableVehicleDents|dentVehicle)\s*\(/,
  swimming: /\b(setWater|addWater|stepSwim|createRiverWater)\s*\(/,
  enterableHouses: /\b(createEnterableHouse|enterableShellFor)\s*\(/,
  destructible: /\b(makeBreakable|hitBreakables|damageBreakable|breakNow)\s*\(/,
  traffic: /\b(createCityTraffic|createTraffic)\s*\(/,
  npcs: /\bnew\s+Entities\s*\(|\b(createCityPeople|createHumanoid)\s*\(/,
  police: /\bnew\s+(Wanted|Dispatch)\s*\(|\.call\(\s*['"](police|ambulance|fire|security|military)['"]/,
};

/** A file of the game itself: code, not a package, not the kit's own engine files. PURE. */
function isOwnGameCode(path: string, v: unknown): v is string {
  return typeof v === 'string' && /\.(t|j)sx?$/.test(path) && !/(^|\/)node_modules\//.test(path)
    && !/(^|\/)src\/(game\/(core|fx|three)|audio)\//.test(path);
}

/** Compare the contract with the game's own files (kit engine files excluded — they are not the game). PURE. */
export function scopeMatch(c: GameScopeContract, files: Record<string, string>): ScopeMatch {
  // A comment is not a feature (`// TODO: levels` used to satisfy "levels"); see codeOnly.ts.
  const own: Array<[string, string]> = [];
  for (const [p, v] of Object.entries(files || {})) if (isOwnGameCode(p, v)) own.push([p, withoutComments(v)]);
  const written = own.map(([, v]) => v).join('\n');
  // Read twice: as written (`playTone`, `driveVehicle`), and with camelCase split, so `currentLevel`, `spawnEnemy`
  // and `addScore` reach their word. A real feature named the way code is written used to be reported missing.
  const code = `${written}\n${written.replace(/([a-z0-9])([A-Z])/g, '$1 $2')}`;
  const present: GameFeature[] = [];
  const missing: GameFeature[] = [];
  const notVerified: GameFeature[] = [];
  const evidence: Partial<Record<GameFeature, string>> = {};
  const hasKit = Object.keys(files || {}).some((p) => KIT_MARKER.test(p));
  // A kit call is a call into the kit only when the kit is on disk (the 3D layer or the systems layer — police and people
  // live in src/game/systems). null: no kit, or no entry found so what runs is not known — then no kit call is proven.
  const kitOnDisk = Object.keys(files || {}).some((p) => KIT_LAYER.test(p));
  const reach = kitOnDisk ? reachableGameFiles(files || {}) : null;
  for (const f of c.requiredFeatures) {
    // The code SIGNAL decides missing exactly as it always did (the done signal, the repair and the gate read it).
    const test = !hasKit && WORD_WITHOUT_KIT[f] ? WORD_WITHOUT_KIT[f]! : PRESENT[f];
    if (!test.test(code)) { missing.push(f); continue; }
    // Present only on executable evidence: the kit call, in a file the running game reaches.
    const call = reach ? KIT_CALL[f] : undefined;
    const site = call ? own.find(([p, v]) => reach!.has(p) && call.test(v)) : undefined;
    if (call && site) {
      present.push(f);
      evidence[f] = `kit call ${(call.exec(site[1])?.[0] ?? '').replace(/\s+/g, ' ').trim()} in ${site[0]}`;
    } else notVerified.push(f);
  }
  const unverified = [
    ...(c.runnerMechanics ?? []),
    ...(c.collectibles ?? []),
    ...(c.minimumUnlockableCharacters ? [`${c.minimumUnlockableCharacters} unlockable characters`] : []),
    // A rule is a fact about PLAY, which no code scan can prove (plan item: runtime rule assertions).
    ...(c.rules ?? []).map((r) => `rule: ${r.said}`),
  ];
  return { present, missing, ...(notVerified.length ? { notVerified } : {}), ...(present.length ? { evidence } : {}), ...(unverified.length ? { unverified } : {}) };
}
