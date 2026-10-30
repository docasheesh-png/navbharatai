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

export type GameGenre =
  | 'racing' | 'shooter' | 'platformer' | 'puzzle' | 'quiz' | 'card' | 'board' | 'runner'
  | 'arcade' | 'sports' | 'fighting' | 'rpg' | 'strategy' | 'snake' | 'unknown';
export type GameDimension = '2d' | '3d' | 'unspecified';
export type GameControl = 'keyboard' | 'touch' | 'mouse' | 'gamepad';
export type GameFeature =
  | 'score' | 'levels' | 'lives' | 'timer' | 'enemies' | 'powerups' | 'leaderboard'
  | 'multiplayer' | 'sound' | 'restart' | 'pause' | 'health';

export interface GameScopeContract {
  genre: GameGenre;
  dimension: GameDimension;
  /** Controls the request named; [] when it named none (the kit's keyboard+touch default then applies). */
  controls: GameControl[];
  /** Features the request NAMED — the scope the built game is checked against. */
  requiredFeatures: GameFeature[];
  /** Did the request name a win or lose condition (game over, win, finish line…)? */
  winLoseNamed: boolean;
}

export function gameScopeContractEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_SCOPE_CONTRACT ?? '').trim().toLowerCase() !== 'off';
}

const GENRES: ReadonlyArray<[GameGenre, RegExp]> = [
  ['racing', /\b(rac(e|ing)|car game|kart|drift|bike game|motorcycle|car wal[ae] khel|gaadi wal[ae] khel)\b/i],
  ['snake', /\bsnake\b/i],
  ['quiz', /\b(quiz|trivia)\b/i],
  ['card', /\b(card game|solitaire|poker|uno|teen ?patti|rummy)\b/i],
  ['board', /\b(chess|ludo|tic[- ]?tac[- ]?toe|checkers|carrom|board game|snakes? and ladders?)\b/i],
  ['puzzle', /\b(puzzle|sudoku|match[- ]?3|candy|2048|tetris|crossword|memory game)\b/i],
  ['runner', /\b(endless runner|runner|subway surf)/i],
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
  ['powerups', /\b(power[- ]?ups?|boosts?|coins?|collectibles?)\b/i],
  ['leaderboard', /\b(leader ?board|rankings?)\b/i],
  ['multiplayer', /\b(multi-?player|online|pvp|co-?op|2 players?|two players?)\b/i],
  ['sound', /\b(sound|music|audio|sfx)\b/i],
  ['restart', /\b(restart|play again|retry|replay)\b/i],
  ['pause', /\bpause\b/i],
  ['health', /\b(health|hp|health ?bar)\b/i],
];

const CONTROLS: ReadonlyArray<[GameControl, RegExp]> = [
  ['keyboard', /\b(keyboard|arrow keys?|wasd|space ?bar)\b/i],
  ['touch', /\b(touch|swipe|tap|mobile|phone|joystick)\b/i],
  ['mouse', /\b(mouse|click)\b/i],
  ['gamepad', /\b(gamepad|controller)\b/i],
];

/** The request's own words → the contract. PURE; never throws. */
export function buildGameContract(prompt: string | null | undefined): GameScopeContract {
  const text = String(prompt ?? '');
  const genre = GENRES.find(([, re]) => re.test(text))?.[0] ?? 'unknown';
  const dimension: GameDimension = /\b3\s?-?d\b|three\.?js|open world/i.test(text) ? '3d' : /\b2\s?-?d\b/i.test(text) ? '2d' : 'unspecified';
  return {
    genre,
    dimension,
    controls: CONTROLS.filter(([, re]) => re.test(text)).map(([c]) => c),
    requiredFeatures: FEATURES.filter(([, re]) => re.test(text)).map(([f]) => f),
    winLoseNamed: /\b(game over|win|lose|winner|finish line|you died|checkmate)\b/i.test(text),
  };
}

/** The block the builder reads in the kit handoff. '' when the contract adds nothing. PURE. */
export function gameContractBlock(c: GameScopeContract): string {
  if (c.genre === 'unknown' && c.requiredFeatures.length === 0 && c.controls.length === 0 && c.dimension === 'unspecified') return '';
  const lines = [
    '[GAME SCOPE CONTRACT — read from the request, checked after the build]',
    `Genre: ${c.genre}. View: ${c.dimension}.`,
    c.controls.length ? `Controls the user asked for: ${c.controls.join(', ')} (keep touch working on a phone too).` : 'Controls: keyboard AND on-screen touch.',
    c.requiredFeatures.length ? `Features the user named — each must really work in the game: ${c.requiredFeatures.join(', ')}.` : '',
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
};

export interface ScopeMatch { present: GameFeature[]; missing: GameFeature[] }

/** Compare the contract with the game's own files (kit engine files excluded — they are not the game). PURE. */
export function scopeMatch(c: GameScopeContract, files: Record<string, string>): ScopeMatch {
  const code = Object.entries(files || {})
    .filter(([p, v]) => typeof v === 'string' && /\.(t|j)sx?$/.test(p) && !/(^|\/)node_modules\//.test(p) && !/(^|\/)src\/(game\/(core|fx|three)|audio)\//.test(p))
    .map(([, v]) => v).join('\n');
  const present: GameFeature[] = [];
  const missing: GameFeature[] = [];
  for (const f of c.requiredFeatures) (PRESENT[f].test(code) ? present : missing).push(f);
  return { present, missing };
}
