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
export type GameGenre =
  | 'racing' | 'shooter' | 'platformer' | 'puzzle' | 'quiz' | 'card' | 'board' | 'runner'
  | 'arcade' | 'sports' | 'fighting' | 'rpg' | 'strategy' | 'snake' | 'simulator' | 'unknown';
export type GameDimension = '2d' | '3d' | 'unspecified';
export type GameControl = 'keyboard' | 'touch' | 'mouse' | 'gamepad';
export type GameFeature =
  | 'score' | 'levels' | 'lives' | 'timer' | 'enemies' | 'powerups' | 'leaderboard'
  | 'multiplayer' | 'sound' | 'restart' | 'pause' | 'health' | 'throttle' | 'braking';
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
  ['board', /\b(chess|ludo|tic[- ]?tac[- ]?toe|checkers|carrom|board game|snakes? and ladders?)\b/i],
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

const FEATURES: ReadonlyArray<[GameFeature, RegExp]> = [
  ['score', /\b(score|points?|high ?score)\b/i],
  ['levels', /\b(levels?|stages?|worlds?)\b/i],
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
];

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
  const genre = GENRES.find(([, re]) => re.test(text))?.[0] ?? 'unknown';
  const dimension: GameDimension = /\b3\s?-?d\b|three\.?js|open world/i.test(text) ? '3d' : /\b2\s?-?d\b/i.test(text) ? '2d' : 'unspecified';
  const requiredFeatures = FEATURES.filter(([, re]) => re.test(text)).map(([f]) => f);
  const vehicle = VEHICLES.find(([, re]) => re.test(text))?.[0] ?? null;
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
      : /\b(third[- ]person|chase cam(era)?|behind the)\b/i.test(text) || vehicle ? 'third-person' : 'unspecified';
  return {
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
  if (c.genre === 'unknown' && c.requiredFeatures.length === 0 && c.controls.length === 0 && c.dimension === 'unspecified' && !c.vehicle && !(c.subjects ?? []).length) return '';
  const lines = [
    '[GAME SCOPE CONTRACT — read from the request, checked after the build]',
    `Genre: ${c.genre}. View: ${c.dimension}.`,
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
    c.winLoseNamed ? 'The request names a win/lose condition — the game must reach it and show it.' : 'Give the game a clear goal and a game-over / win screen with a way to play again.',
  ];
  return lines.filter(Boolean).join('\n');
}

/** What the built code shows for each feature. Conservative: a feature counts as present on a code signal. */
const PRESENT: Readonly<Record<GameFeature, RegExp>> = {
  score: /\bscore\b/i,
  levels: /\blevel\b/i,
  lives: /\blives\b/i,
  timer: /\b(timer|countdown|timeLeft|remaining)\b/i,
  enemies: /\b(enem(y|ies)|monster|zombie|alien|boss)\b/i,
  powerups: /\b(power-?up|boost|coin|collectible|pickup)\b/i,
  leaderboard: /\b(leader-?board|ranking)\b/i,
  multiplayer: /\b(multiplayer|player2|playerTwo|socket|websocket|peer)\b/i,
  sound: /\b(audio|sound|playTone|synth|AudioContext)\b/i,
  restart: /\b(play again|restart|try again|retry|replay)\b/i,
  pause: /\bpause/i,
  health: /\b(health|hp)\b/i,
  throttle: /\b(throttle|accelerat\w*|setSpeed|driveVehicle)\b|\bspeed\s*[+-]?=/i,
  braking: /\b(brak\w*|decelerat\w*|driveVehicle)\b/i,
};

export interface ScopeMatch {
  present: GameFeature[];
  missing: GameFeature[];
  /** Code tokens cannot prove movement, separate balances, affordable unlocks or character count. */
  unverified?: string[];
}

/** Compare the contract with the game's own files (kit engine files excluded — they are not the game). PURE. */
export function scopeMatch(c: GameScopeContract, files: Record<string, string>): ScopeMatch {
  const code = Object.entries(files || {})
    .filter(([p, v]) => typeof v === 'string' && /\.(t|j)sx?$/.test(p) && !/(^|\/)node_modules\//.test(p) && !/(^|\/)src\/(game\/(core|fx|three)|audio)\//.test(p))
    .map(([, v]) => v).join('\n');
  const present: GameFeature[] = [];
  const missing: GameFeature[] = [];
  for (const f of c.requiredFeatures) (PRESENT[f].test(code) ? present : missing).push(f);
  const unverified = [
    ...(c.runnerMechanics ?? []),
    ...(c.collectibles ?? []),
    ...(c.minimumUnlockableCharacters ? [`${c.minimumUnlockableCharacters} unlockable characters`] : []),
  ];
  return { present, missing, ...(unverified.length ? { unverified } : {}) };
}
