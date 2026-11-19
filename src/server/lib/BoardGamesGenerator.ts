// THE INDIA GAMES PACK — tested rules engines for the board and card games India plays (admin 2026-11-19 game-gap
// audit: "ludo, carrom, chess, saanp-seedhi, cricket, teen patti nahi hain").
//
// A Ludo the model writes from memory gets the rules subtly wrong — a capture on a safe star, a token that overshoots
// home, a six that does not give another turn, a turn that never ends when no token can move. Those are exactly the
// things a family notices in the first game. This pack is the rules, written once and tested; the builder draws the
// board and wires the taps.
//
// WHAT IT WRITES (src/game/board/, plain TypeScript, no dependency, PURE — no DOM):
//   dice.ts   — a seeded random source (replays and tests are repeatable) and a fair die.
//   ludo.ts   — Ludo for 2–4 players: leave the yard on a six, sixes roll again (three in a row forfeit), safe squares,
//               captures send a token home and earn a roll, an exact roll to finish, finishing order, a pass when no
//               token can move, and a computer player. Board geometry for drawing.
//   snakes.ts — Snakes & Ladders: the classic board, exact roll to finish (or bounce back), a six rolls again, and the
//               boustrophedon square → grid position for drawing.
//   index.ts  — one import.
//
// PURE — no I/O.

export interface BoardGamesResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

export const BOARD_DIR = 'src/game/board';

const DICE = String.raw`/**
 * A SEEDED RANDOM SOURCE AND A FAIR DIE. The same seed gives the same game — a replay, a daily puzzle, a test.
 *   const rng = createRng(Date.now()); const roll = rollDie(rng);   // 1..6, each equally likely
 */
export type Rng = () => number;

/** mulberry32: fast, well distributed, 32-bit state. Returns [0, 1). */
export function createRng(seed: number): Rng {
  let a = (Math.floor(Number.isFinite(seed) ? seed : 0) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fair die with 'sides' faces (default 6). */
export function rollDie(rng: Rng, sides = 6): number {
  const n = Math.max(2, Math.floor(sides));
  return 1 + Math.min(n - 1, Math.floor(rng() * n));
}

/** Fisher–Yates: every order equally likely. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
`;

const LUDO = String.raw`/**
 * LUDO — the rules a family expects, so the first game is not the one where somebody says "that's not how it works".
 *
 *   let game = createLudo({ players: ['red', 'yellow'] });          // 2, 3 or 4 colours
 *   const roll = rollDie(rng);
 *   const moves = legalMoves(game, roll);                            // token indices that may move ([] → pass)
 *   const r = moves.length ? move(game, moves[0], roll) : pass(game, roll);
 *   game = r.state;  r.captured / r.finished / r.extraTurn / r.won   // what to animate and announce
 *
 * Progress of a token, counted from its own start square: -1 in the yard, 0..50 on the shared track, 51..55 in its home
 * column, 56 home (finished). A six (or any of rules.leaveOn) brings a token out onto its start square.
 * Rules (each can be changed): a six rolls again, three sixes in a row lose the turn; landing on an opponent on a
 * square that is not safe sends it back to the yard and earns another roll; start squares and star squares are safe;
 * home needs the exact number; getting a token home earns another roll.
 */
export type LudoColour = 'red' | 'green' | 'yellow' | 'blue';
export const LUDO_COLOURS: readonly LudoColour[] = ['red', 'green', 'yellow', 'blue'];
/** Where each colour enters the shared 52-square track. */
export const START_SQUARE: Readonly<Record<LudoColour, number>> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const TRACK = 52;
export const HOME = 56;
export const LAST_TRACK = 50;
/** Star squares: safe for everybody. */
export const STAR_SQUARES: readonly number[] = [8, 21, 34, 47];

export interface LudoRules {
  leaveOn: number[];
  sixRollsAgain: boolean;
  /** Sixes in a row that lose the turn (0 = never). */
  maxSixes: number;
  captureRollsAgain: boolean;
  homeRollsAgain: boolean;
  safeSquares: number[];
}
export const DEFAULT_LUDO_RULES: Readonly<LudoRules> = {
  leaveOn: [6], sixRollsAgain: true, maxSixes: 3, captureRollsAgain: true, homeRollsAgain: true,
  safeSquares: [...Object.values(START_SQUARE), ...STAR_SQUARES],
};

export interface LudoPlayer { colour: LudoColour; tokens: number[]; finished: boolean }
export interface LudoState {
  players: LudoPlayer[];
  /** Index into players of whose turn it is. */
  turn: number;
  sixesInARow: number;
  /** Colours in the order they got all four tokens home. */
  ranking: LudoColour[];
  over: boolean;
  rules: LudoRules;
}

export interface MoveResult {
  state: LudoState;
  /** Tokens sent back to the yard by this move. */
  captured: Array<{ colour: LudoColour; token: number }>;
  /** This token reached home. */
  finished: boolean;
  /** The same player rolls again. */
  extraTurn: boolean;
  /** The turn was lost to too many sixes. */
  forfeited: boolean;
  /** This player has just got every token home. */
  won: boolean;
  /** The squares the token passed through, for animation (progress values). */
  path: number[];
}

export function createLudo(o: { players?: LudoColour[]; rules?: Partial<LudoRules> } = {}): LudoState {
  const wanted = (o.players ?? ['red', 'green', 'yellow', 'blue']).filter((c, i, a) => LUDO_COLOURS.includes(c) && a.indexOf(c) === i);
  if (wanted.length < 2) throw new Error('Ludo needs 2 to 4 different colours');
  return {
    players: wanted.slice(0, 4).map((colour) => ({ colour, tokens: [-1, -1, -1, -1], finished: false })),
    turn: 0, sixesInARow: 0, ranking: [], over: false,
    rules: { ...DEFAULT_LUDO_RULES, ...(o.rules ?? {}) },
  };
}

/** The square on the shared track (0..51) a token stands on, or null in the yard, the home column or home. */
export function trackSquare(colour: LudoColour, progress: number): number | null {
  if (progress < 0 || progress > LAST_TRACK) return null;
  return (START_SQUARE[colour] + progress) % TRACK;
}

const clone = (s: LudoState): LudoState => ({ ...s, players: s.players.map((p) => ({ ...p, tokens: p.tokens.slice() })), ranking: s.ranking.slice(), rules: s.rules });

/** Where a token would land with this roll, or null when it cannot move. */
export function target(state: LudoState, token: number, roll: number): number | null {
  const p = state.players[state.turn];
  const at = p?.tokens[token];
  if (at === undefined || state.over || !Number.isInteger(roll) || roll < 1) return null;
  if (at === HOME) return null;
  if (at < 0) return state.rules.leaveOn.includes(roll) ? 0 : null;
  const to = at + roll;
  return to > HOME ? null : to;   // home needs the exact number
}

/** The tokens of the current player that may move with this roll. */
export function legalMoves(state: LudoState, roll: number): number[] {
  if (state.over) return [];
  if (state.rules.maxSixes > 0 && roll === 6 && state.sixesInARow + 1 >= state.rules.maxSixes) return [];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) if (target(state, i, roll) !== null) out.push(i);
  return out;
}

function advanceTurn(s: LudoState): void {
  if (s.over) return;
  for (let k = 1; k <= s.players.length; k++) {
    const next = (s.turn + k) % s.players.length;
    if (!s.players[next].finished) { s.turn = next; s.sixesInARow = 0; return; }
  }
}

function finishIfDone(s: LudoState, p: LudoPlayer): boolean {
  if (p.finished || !p.tokens.every((t) => t === HOME)) return false;
  p.finished = true;
  s.ranking.push(p.colour);
  const left = s.players.filter((x) => !x.finished);
  if (left.length <= 1) { s.over = true; for (const x of left) { x.finished = true; s.ranking.push(x.colour); } }
  return true;
}

/** Move one token by the roll. Throws on an illegal move — check legalMoves first. */
export function move(state: LudoState, token: number, roll: number): MoveResult {
  if (!legalMoves(state, roll).includes(token)) throw new Error('illegal Ludo move: token ' + token + ' with ' + roll);
  const s = clone(state);
  const p = s.players[s.turn];
  const from = p.tokens[token];
  const to = target(state, token, roll)!;
  const path: number[] = [];
  if (from < 0) path.push(0); else for (let v = from + 1; v <= to; v++) path.push(v);
  p.tokens[token] = to;
  const captured: MoveResult['captured'] = [];
  const square = trackSquare(p.colour, to);
  if (square !== null && !s.rules.safeSquares.includes(square)) {
    for (const other of s.players) {
      if (other.colour === p.colour) continue;
      other.tokens.forEach((t, i) => { if (trackSquare(other.colour, t) === square) { other.tokens[i] = -1; captured.push({ colour: other.colour, token: i }); } });
    }
  }
  const finished = to === HOME;
  const won = finishIfDone(s, p);
  const six = roll === 6;
  const extraTurn = !s.over && !won && ((six && s.rules.sixRollsAgain) || (captured.length > 0 && s.rules.captureRollsAgain) || (finished && s.rules.homeRollsAgain));
  if (extraTurn) s.sixesInARow = six ? s.sixesInARow + 1 : 0;
  else advanceTurn(s);
  return { state: s, captured, finished, extraTurn, forfeited: false, won, path };
}

/** No token can move: the turn passes (a third six forfeits it). */
export function pass(state: LudoState, roll: number): MoveResult {
  const s = clone(state);
  const forfeited = state.rules.maxSixes > 0 && roll === 6 && state.sixesInARow + 1 >= state.rules.maxSixes;
  advanceTurn(s);
  return { state: s, captured: [], finished: false, extraTurn: false, forfeited, won: false, path: [] };
}

/**
 * A sensible computer player: capture if it can, then get a token home, then out of the yard, then off a square where it
 * can be captured, then the token furthest along. Returns null when there is no legal move.
 */
export function chooseMove(state: LudoState, roll: number): number | null {
  const moves = legalMoves(state, roll);
  if (moves.length === 0) return null;
  const me = state.players[state.turn];
  const score = (t: number): number => {
    const to = target(state, t, roll)!;
    const from = me.tokens[t];
    const sq = trackSquare(me.colour, to);
    let v = 0;
    if (sq !== null && !state.rules.safeSquares.includes(sq) && state.players.some((o) => o.colour !== me.colour && o.tokens.some((x) => trackSquare(o.colour, x) === sq))) v += 1000;
    if (to === HOME) v += 500;
    if (from < 0) v += 300;
    const fromSq = trackSquare(me.colour, from);
    if (fromSq !== null && !state.rules.safeSquares.includes(fromSq)) v += 50;
    if (sq !== null && state.rules.safeSquares.includes(sq)) v += 40;
    return v + Math.max(0, from);
  };
  return moves.reduce((best, t) => (score(t) > score(best) ? t : best), moves[0]);
}

/**
 * BOARD GEOMETRY for drawing on a 15 × 15 grid (the classic cross): the cell of a shared-track square, of each colour's
 * home column, its yard slots and the centre.
 */
const TRACK_CELLS: ReadonlyArray<readonly [number, number]> = (() => {
  // Walk the cross clockwise from red's start (column 1, row 6), 52 cells.
  const path: Array<[number, number]> = [];
  const push = (c: number, r: number) => path.push([c, r]);
  for (let c = 1; c <= 5; c++) push(c, 6);
  for (let r = 5; r >= 0; r--) push(6, r);
  push(7, 0);
  for (let r = 0; r <= 5; r++) push(8, r);
  for (let c = 9; c <= 14; c++) push(c, 6);
  push(14, 7);
  for (let c = 14; c >= 9; c--) push(c, 8);
  for (let r = 9; r <= 14; r++) push(8, r);
  push(7, 14);
  for (let r = 14; r >= 9; r--) push(6, r);
  for (let c = 5; c >= 0; c--) push(c, 8);
  push(0, 7);
  push(0, 6);
  return path;
})();

const HOME_COLUMN: Readonly<Record<LudoColour, (i: number) => [number, number]>> = {
  red: (i) => [1 + i, 7], green: (i) => [7, 1 + i], yellow: (i) => [13 - i, 7], blue: (i) => [7, 13 - i],
};
const YARD: Readonly<Record<LudoColour, [number, number]>> = { red: [1, 1], green: [10, 1], yellow: [10, 10], blue: [1, 10] };

/** The grid cell (column, row on a 15 × 15 board) for a token, for drawing. Yard tokens get their own slot. */
export function cellOf(colour: LudoColour, progress: number, token = 0): { col: number; row: number } {
  if (progress < 0) { const [c, r] = YARD[colour]; return { col: c + (token % 2) * 3, row: r + Math.floor(token / 2) * 3 }; }
  if (progress >= HOME) return { col: 7, row: 7 };
  if (progress > LAST_TRACK) { const [c, r] = HOME_COLUMN[colour](progress - LAST_TRACK - 1); return { col: c, row: r }; }
  const [c, r] = TRACK_CELLS[(START_SQUARE[colour] + progress) % TRACK];
  return { col: c, row: r };
}
export const LUDO_TRACK_CELLS = TRACK_CELLS;
`;

const SNAKES = String.raw`/**
 * SNAKES & LADDERS (saanp-seedhi). 100 squares; a ladder carries you up, a snake brings you down.
 *
 *   let game = createSnakes({ players: 2 });
 *   const r = takeTurn(game, rollDie(rng));   r.moved / r.via ('ladder' | 'snake' | null) / r.won / r.extraTurn
 *   game = r.state;
 *   squareCell(37)  → { col, row } on a 10 × 10 grid (row 0 at the top), the board's zig-zag order.
 * Rules (each can be changed): an exact roll is needed to reach 100 (or bounce back off it); a six rolls again.
 */
export interface SnakesRules { exactFinish: boolean; bounceBack: boolean; sixRollsAgain: boolean }
export const DEFAULT_SNAKES_RULES: Readonly<SnakesRules> = { exactFinish: true, bounceBack: false, sixRollsAgain: true };

/** The classic board: from → to. Up is a ladder, down a snake. */
export const CLASSIC_JUMPS: Readonly<Record<number, number>> = {
  // ladders
  1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
  // snakes
  16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
};

export interface SnakesState { positions: number[]; turn: number; winner: number | null; jumps: Record<number, number>; rules: SnakesRules }
export interface SnakesTurn { state: SnakesState; player: number; from: number; landed: number; to: number; via: 'ladder' | 'snake' | null; moved: boolean; won: boolean; extraTurn: boolean }

/** A board is valid when every jump stays on it, starts and ends on different squares, none starts on 100, and none lands on another jump's start (no chains). */
export function validateJumps(jumps: Record<number, number>): string[] {
  const problems: string[] = [];
  for (const [a, b] of Object.entries(jumps)) {
    const from = Number(a), to = Number(b);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > 100 || to < 1 || to > 100) problems.push(from + '→' + to + ' leaves the board');
    else if (from === to) problems.push(from + '→' + to + ' goes nowhere');
    else if (from === 100) problems.push('a jump cannot start on 100');
    else if (jumps[to] !== undefined) problems.push(from + '→' + to + ' lands on another jump');
  }
  return problems;
}

export function createSnakes(o: { players?: number; jumps?: Record<number, number>; rules?: Partial<SnakesRules> } = {}): SnakesState {
  const n = Math.max(1, Math.min(6, Math.floor(o.players ?? 2)));
  const jumps = { ...(o.jumps ?? CLASSIC_JUMPS) };
  const problems = validateJumps(jumps);
  if (problems.length) throw new Error('invalid snakes & ladders board: ' + problems.join('; '));
  return { positions: Array(n).fill(0), turn: 0, winner: null, jumps, rules: { ...DEFAULT_SNAKES_RULES, ...(o.rules ?? {}) } };
}

/** Play the current player's roll. Position 0 is off the board (before square 1). */
export function takeTurn(state: SnakesState, roll: number): SnakesTurn {
  const player = state.turn;
  const from = state.positions[player];
  const base = { player, from, landed: from, to: from, via: null as SnakesTurn['via'], moved: false, won: false, extraTurn: false };
  if (state.winner !== null || !Number.isInteger(roll) || roll < 1) return { state, ...base };
  let landed = from + roll;
  if (landed > 100) {
    if (state.rules.bounceBack) landed = 200 - landed;
    else if (state.rules.exactFinish) landed = from;
    else landed = 100;
  }
  const jump = state.jumps[landed];
  const to = jump ?? landed;
  const via: SnakesTurn['via'] = jump === undefined ? null : jump > landed ? 'ladder' : 'snake';
  const positions = state.positions.slice();
  positions[player] = to;
  const won = to === 100;
  const extraTurn = !won && roll === 6 && state.rules.sixRollsAgain;
  const next: SnakesState = { ...state, positions, winner: won ? player : null, turn: won || extraTurn ? player : (player + 1) % positions.length };
  return { state: next, player, from, landed, to, via, moved: to !== from, won, extraTurn };
}

/** The cell of square n (1..100) on a 10 × 10 grid, row 0 at the TOP: 1 is bottom-left, rows zig-zag, 100 top-left. */
export function squareCell(n: number): { col: number; row: number } {
  const i = Math.max(1, Math.min(100, Math.floor(n))) - 1;
  const rowFromBottom = Math.floor(i / 10);
  const inRow = i % 10;
  return { col: rowFromBottom % 2 === 0 ? inRow : 9 - inRow, row: 9 - rowFromBottom };
}
`;

const INDEX = String.raw`// The India games pack: tested rules engines (the board is drawn by the game).
export { createRng, rollDie, shuffle } from './dice';
export type { Rng } from './dice';
export { createLudo, legalMoves, move, pass, target, chooseMove, trackSquare, cellOf, LUDO_COLOURS, START_SQUARE, STAR_SQUARES, DEFAULT_LUDO_RULES, HOME, TRACK, LAST_TRACK, LUDO_TRACK_CELLS } from './ludo';
export type { LudoColour, LudoRules, LudoState, LudoPlayer, MoveResult } from './ludo';
export { createSnakes, takeTurn, squareCell, validateJumps, CLASSIC_JUMPS, DEFAULT_SNAKES_RULES } from './snakes';
export type { SnakesRules, SnakesState, SnakesTurn } from './snakes';
`;

const FILES: Record<string, string> = {
  [`${BOARD_DIR}/dice.ts`]: DICE,
  [`${BOARD_DIR}/ludo.ts`]: LUDO,
  [`${BOARD_DIR}/snakes.ts`]: SNAKES,
  [`${BOARD_DIR}/index.ts`]: INDEX,
};

export const BOARD_GAME_MODULES: readonly string[] = ['dice', 'ludo', 'snakes'];

const EXAMPLE = [
  "import { createLudo, legalMoves, move, pass, chooseMove, cellOf, createRng, rollDie, type LudoState } from './game/board';",
  '',
  "let game: LudoState = createLudo({ players: ['red', 'yellow'] });   // the player is red, the computer yellow",
  'const rng = createRng(Date.now());',
  '',
  '/** One roll: the human taps a token (onPick), the computer chooses by itself. */',
  'export function playRoll(onPick: (choices: number[]) => number): void {',
  '  const roll = rollDie(rng);',
  '  const choices = legalMoves(game, roll);',
  "  const human = game.players[game.turn].colour === 'red';",
  '  const token = choices.length === 0 ? null : human ? onPick(choices) : chooseMove(game, roll);',
  '  const r = token === null ? pass(game, roll) : move(game, token, roll);',
  '  game = r.state;',
  '  // animate r.path with cellOf(colour, progress, token); announce r.captured, r.finished, r.extraTurn, r.won',
  '  if (r.won) console.info(game.ranking);',
  '}',
].join('\n');

/** Generate the pack (or a subset; every engine needs dice.ts). PURE. */
export function generateBoardGames(include?: string[]): BoardGamesResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;
  let files: Record<string, string>;
  if (!wanted) files = { ...FILES };
  else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    if (Object.keys(files).length === 0) files = { ...FILES };
    files[`${BOARD_DIR}/dice.ts`] = DICE;
    if (Object.keys(files).length === Object.keys(FILES).length - 1) files[`${BOARD_DIR}/index.ts`] = INDEX;
  }
  return {
    files,
    dependencies: [],
    instructions:
      `Added the India games pack (${Object.keys(files).length} files under ${BOARD_DIR}): tested rules for Ludo and Snakes & Ladders, `
      + 'a seeded die, and board geometry for drawing.\n'
      + '```ts\n' + EXAMPLE + '\n```\n'
      + 'RULES: the game\'s rules come from these engines — never re-implement Ludo or Snakes & Ladders logic. Draw the board from '
      + 'cellOf / squareCell, animate a token along r.path, and say what happened (a capture, a token home, another roll, a pass when '
      + 'nothing can move). Let the player tap the token they want from legalMoves; highlight those tokens. A computer opponent '
      + 'uses chooseMove. House rules are options (rules: { ... }), not new code.',
  };
}
