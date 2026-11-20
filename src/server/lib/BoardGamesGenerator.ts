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
//   chess.ts  — chess with every rule (castling, en passant, promotion, check/mate/stalemate, fifty-move, repetition,
//               insufficient material), FEN and SAN, a computer player at three strengths; perft-verified.
//   cards.ts  — a deck and dealing, Teen Patti hand ranking, Indian rummy melds, declarations, points and the best
//               grouping — for FUN: points and pretend chips only, never real money.
//   carrom.ts — carrom with real disc physics (real sizes, elastic collisions, friction, cushions, corner pockets) and the
//               family rules (own coin continues, striker foul returns a coin, the queen must be covered, board scoring).
//   cricket.ts — a cricket match engine: overs, wides and no-balls (free hit), strike rotation, innings ends, chases,
//               results as commentators say them, run rates, and timing-based batting for a tap game.
//   match3.ts — match-3: no starting matches, always a move (reshuffles when stuck), cascades with chain scoring, line /
//               area / bomb tiles, a hint, moves-and-target levels, and cascade steps for animation (2026-11-20).
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

const CHESS = String.raw`/**
 * CHESS — every rule, so a game never ends in "that move isn't allowed!": castling (not out of, through or into check),
 * en passant, promotion, check, checkmate, stalemate, the fifty-move rule, threefold repetition and insufficient
 * material. Positions load and save as FEN; moves read as SAN (e4, Nf3, O-O, exd5, e8=Q+). A computer player at three
 * strengths. The move generator is checked against the published perft counts.
 *
 *   let game = createChess();                          // or createChess('fen string')
 *   const moves = legalMoves(game);                    // every legal move, each with its SAN
 *   game = play(game, { from: 'e2', to: 'e4' });       // or play(game, 'e4'); throws on an illegal move
 *   status(game)                                       // 'playing' | 'checkmate' | 'stalemate' | 'draw-…'
 *   game = play(game, bestMove(game, 2)!);             // the computer (depth 1 easy, 2 normal, 3 hard)
 * Squares are 0..63: a1 = 0, h1 = 7, a8 = 56. square('e4') and squareName(28) convert.
 */
export type Colour = 'w' | 'b';
export type Piece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Cell = Piece | '';
export interface Castling { K: boolean; Q: boolean; k: boolean; q: boolean }
export interface ChessState {
  board: Cell[];
  turn: Colour;
  castling: Castling;
  /** The square a pawn may capture onto en passant, or -1. */
  ep: number;
  halfmove: number;
  fullmove: number;
  /** Position keys since the last capture or pawn move, for threefold repetition. */
  history: string[];
}
export type MoveFlag = 'normal' | 'capture' | 'enpassant' | 'castle-king' | 'castle-queen' | 'double';
export interface ChessMove { from: number; to: number; piece: Piece; captured?: Piece; promotion?: 'q' | 'r' | 'b' | 'n'; flag: MoveFlag; san: string }
export type ChessStatus = 'playing' | 'checkmate' | 'stalemate' | 'draw-fifty' | 'draw-repetition' | 'draw-material';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function square(name: string): number {
  const m = /^([a-h])([1-8])$/.exec(String(name).trim().toLowerCase());
  return m ? (Number(m[2]) - 1) * 8 + (m[1].charCodeAt(0) - 97) : -1;
}
export function squareName(sq: number): string { return 'abcdefgh'[sq & 7] + String((sq >> 3) + 1); }
const fileOf = (sq: number): number => sq & 7;
const rankOf = (sq: number): number => sq >> 3;
export const colourOf = (p: Cell): Colour | null => (p === '' ? null : p === p.toUpperCase() ? 'w' : 'b');
const enemy = (c: Colour): Colour => (c === 'w' ? 'b' : 'w');

export function parseFen(fen: string): ChessState {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 4) throw new Error('bad FEN: ' + fen);
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('bad FEN board: ' + parts[0]);
  const board: Cell[] = new Array(64).fill('');
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else if (/[pnbrqkPNBRQK]/.test(ch) && file < 8) board[rank * 8 + file++] = ch as Piece;
      else throw new Error('bad FEN piece: ' + ch);
    }
    if (file !== 8) throw new Error('bad FEN row: ' + row);
  });
  if (board.filter((p) => p === 'K').length !== 1 || board.filter((p) => p === 'k').length !== 1) throw new Error('a position needs one king of each colour');
  const c = parts[2];
  const state: ChessState = {
    board,
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') },
    ep: parts[3] === '-' ? -1 : square(parts[3]),
    halfmove: Number(parts[4] ?? 0) || 0,
    fullmove: Number(parts[5] ?? 1) || 1,
    history: [],
  };
  state.history = [positionKey(state)];
  return state;
}

export function toFen(s: ChessState): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '', empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = s.board[rank * 8 + file];
      if (p === '') empty++;
      else { if (empty) { row += String(empty); empty = 0; } row += p; }
    }
    rows.push(row + (empty ? String(empty) : ''));
  }
  const c = (s.castling.K ? 'K' : '') + (s.castling.Q ? 'Q' : '') + (s.castling.k ? 'k' : '') + (s.castling.q ? 'q' : '');
  return [rows.join('/'), s.turn, c || '-', s.ep >= 0 ? squareName(s.ep) : '-', String(s.halfmove), String(s.fullmove)].join(' ');
}

/** Board, side to move, castling and en passant: what makes two positions "the same" for repetition. */
function positionKey(s: ChessState): string { return toFen(s).split(' ').slice(0, 4).join(' '); }

export function createChess(fen: string = START_FEN): ChessState { return parseFen(fen); }

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const at = (f: number, r: number): number => (f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f);

/** Is square sq attacked by colour by? */
export function attacked(board: Cell[], sq: number, by: Colour): boolean {
  const f = fileOf(sq), r = rankOf(sq);
  const up = by === 'w' ? 'P' : 'p';
  const pr = by === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) { const t = at(f + df, pr); if (t >= 0 && board[t] === up) return true; }
  const n = by === 'w' ? 'N' : 'n';
  for (const [df, dr] of KNIGHT) { const t = at(f + df, r + dr); if (t >= 0 && board[t] === n) return true; }
  const k = by === 'w' ? 'K' : 'k';
  for (const [df, dr] of KING) { const t = at(f + df, r + dr); if (t >= 0 && board[t] === k) return true; }
  const rq = by === 'w' ? ['R', 'Q'] : ['r', 'q'];
  const bq = by === 'w' ? ['B', 'Q'] : ['b', 'q'];
  for (const [dirs, hit] of [[ROOK_DIRS, rq], [BISHOP_DIRS, bq]] as const) {
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const p = board[rr * 8 + ff];
        if (p !== '') { if ((hit as readonly string[]).includes(p)) return true; break; }
        ff += df; rr += dr;
      }
    }
  }
  return false;
}

export function inCheck(s: ChessState, colour: Colour = s.turn): boolean {
  const king = colour === 'w' ? 'K' : 'k';
  return attacked(s.board, s.board.indexOf(king), enemy(colour));
}

type Raw = Omit<ChessMove, 'san'>;

function pseudoMoves(s: ChessState): Raw[] {
  const out: Raw[] = [];
  const me = s.turn;
  const b = s.board;
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (p === '' || colourOf(p) !== me) continue;
    const f = fileOf(from), r = rankOf(from);
    const add = (to: number, flag: MoveFlag = b[to] ? 'capture' : 'normal') => out.push({ from, to, piece: p, captured: b[to] ? (b[to] as Piece) : undefined, flag });
    const kind = p.toLowerCase();
    if (kind === 'p') {
      const dir = me === 'w' ? 1 : -1, startRank = me === 'w' ? 1 : 6, lastRank = me === 'w' ? 7 : 0;
      const pushPawn = (to: number, flag: MoveFlag, captured?: Piece) => {
        if (rankOf(to) === lastRank) for (const promotion of ['q', 'r', 'b', 'n'] as const) out.push({ from, to, piece: p, captured, promotion, flag });
        else out.push({ from, to, piece: p, captured, flag });
      };
      const one = at(f, r + dir);
      if (one >= 0 && b[one] === '') {
        pushPawn(one, 'normal');
        const two = at(f, r + 2 * dir);
        if (r === startRank && b[two] === '') out.push({ from, to: two, piece: p, flag: 'double' });
      }
      for (const df of [-1, 1]) {
        const t = at(f + df, r + dir);
        if (t < 0) continue;
        if (b[t] !== '' && colourOf(b[t]) !== me) pushPawn(t, 'capture', b[t] as Piece);
        else if (t === s.ep) out.push({ from, to: t, piece: p, captured: (me === 'w' ? 'p' : 'P'), flag: 'enpassant' });
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [df, dr] of kind === 'n' ? KNIGHT : KING) {
        const t = at(f + df, r + dr);
        if (t >= 0 && colourOf(b[t]) !== me) add(t);
      }
      if (kind === 'k') {
        const home = me === 'w' ? 4 : 60;
        if (from === home && !attacked(b, home, enemy(me))) {
          const [kSide, qSide] = me === 'w' ? [s.castling.K, s.castling.Q] : [s.castling.k, s.castling.q];
          const rook = me === 'w' ? 'R' : 'r';
          if (kSide && b[home + 3] === rook && b[home + 1] === '' && b[home + 2] === '' && !attacked(b, home + 1, enemy(me)) && !attacked(b, home + 2, enemy(me))) {
            out.push({ from, to: home + 2, piece: p, flag: 'castle-king' });
          }
          if (qSide && b[home - 4] === rook && b[home - 1] === '' && b[home - 2] === '' && b[home - 3] === '' && !attacked(b, home - 1, enemy(me)) && !attacked(b, home - 2, enemy(me))) {
            out.push({ from, to: home - 2, piece: p, flag: 'castle-queen' });
          }
        }
      }
    } else {
      const dirs = kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [df, dr] of dirs) {
        let ff = f + df, rr = r + dr;
        while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
          const t = rr * 8 + ff;
          if (b[t] === '') add(t);
          else { if (colourOf(b[t]) !== me) add(t); break; }
          ff += df; rr += dr;
        }
      }
    }
  }
  return out;
}

/** Apply a move without checking it is legal (the generator already did). */
function apply(s: ChessState, m: Raw): ChessState {
  const board = s.board.slice();
  const me = s.turn;
  board[m.to] = m.promotion ? ((me === 'w' ? m.promotion.toUpperCase() : m.promotion) as Piece) : m.piece;
  board[m.from] = '';
  if (m.flag === 'enpassant') board[m.to + (me === 'w' ? -8 : 8)] = '';
  if (m.flag === 'castle-king') { board[m.to - 1] = board[m.to + 1]; board[m.to + 1] = ''; }
  if (m.flag === 'castle-queen') { board[m.to + 1] = board[m.to - 2]; board[m.to - 2] = ''; }
  const castling = { ...s.castling };
  const touch = (sq: number) => {
    if (sq === 4) { castling.K = false; castling.Q = false; }
    if (sq === 60) { castling.k = false; castling.q = false; }
    if (sq === 0) castling.Q = false;
    if (sq === 7) castling.K = false;
    if (sq === 56) castling.q = false;
    if (sq === 63) castling.k = false;
  };
  touch(m.from); touch(m.to);
  const reset = m.piece.toLowerCase() === 'p' || !!m.captured;
  const next: ChessState = {
    board, turn: enemy(me), castling,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    halfmove: reset ? 0 : s.halfmove + 1,
    fullmove: me === 'b' ? s.fullmove + 1 : s.fullmove,
    history: reset ? [] : s.history,
  };
  next.history = [...next.history, positionKey(next)];
  return next;
}

function legalRaw(s: ChessState): Raw[] {
  return pseudoMoves(s).filter((m) => !inCheck(apply(s, m), s.turn));
}

function sanOf(s: ChessState, m: Raw, all: Raw[]): string {
  let san: string;
  if (m.flag === 'castle-king') san = 'O-O';
  else if (m.flag === 'castle-queen') san = 'O-O-O';
  else {
    const kind = m.piece.toUpperCase();
    const capture = !!m.captured;
    if (kind === 'P') san = (capture ? 'abcdefgh'[fileOf(m.from)] + 'x' : '') + squareName(m.to) + (m.promotion ? '=' + m.promotion.toUpperCase() : '');
    else {
      const rivals = all.filter((o) => o !== m && o.piece === m.piece && o.to === m.to && o.from !== m.from);
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
        const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
        dis = !sameFile ? 'abcdefgh'[fileOf(m.from)] : !sameRank ? String(rankOf(m.from) + 1) : squareName(m.from);
      }
      san = kind + dis + (capture ? 'x' : '') + squareName(m.to);
    }
  }
  const after = apply(s, m);
  if (inCheck(after)) san += legalRaw(after).length === 0 ? '#' : '+';
  return san;
}

/** Every legal move for the side to move, each with its SAN. */
export function legalMoves(s: ChessState): ChessMove[] {
  const raw = legalRaw(s);
  return raw.map((m) => ({ ...m, san: sanOf(s, m, raw) }));
}

/** The legal moves from one square (for highlighting where a tapped piece can go). */
export function movesFrom(s: ChessState, from: number | string): ChessMove[] {
  const sq = typeof from === 'string' ? square(from) : from;
  return legalMoves(s).filter((m) => m.from === sq);
}

const stripSan = (x: string): string => x.replace(/[+#?!]/g, '').replace(/0/g, 'O').trim();

/** Play a move given as SAN ('Nf3', 'O-O', 'e8=Q') or { from, to, promotion }. Throws on an illegal one. */
export function play(s: ChessState, move: string | { from: number | string; to: number | string; promotion?: 'q' | 'r' | 'b' | 'n' } | ChessMove): ChessState {
  const moves = legalMoves(s);
  let found: ChessMove | undefined;
  if (typeof move === 'string') found = moves.find((m) => stripSan(m.san) === stripSan(move));
  else {
    const from = typeof move.from === 'string' ? square(move.from) : move.from;
    const to = typeof move.to === 'string' ? square(move.to) : move.to;
    const promo = move.promotion ?? 'q';
    found = moves.find((m) => m.from === from && m.to === to && (!m.promotion || m.promotion === promo));
  }
  if (!found) throw new Error('illegal chess move: ' + (typeof move === 'string' ? move : JSON.stringify(move)));
  return apply(s, found);
}

function insufficient(board: Cell[]): boolean {
  const pieces = board.map((p, i) => ({ p, i })).filter((x) => x.p !== '' && x.p.toLowerCase() !== 'k');
  if (pieces.length === 0) return true;
  if (pieces.some((x) => /[pqrPQR]/.test(x.p))) return false;
  if (pieces.length === 1) return true;   // a lone knight or bishop
  // Only bishops, all on squares of one colour.
  if (pieces.every((x) => x.p.toLowerCase() === 'b')) {
    const shade = (i: number) => (fileOf(i) + rankOf(i)) % 2;
    return pieces.every((x) => shade(x.i) === shade(pieces[0].i));
  }
  return false;
}

export function status(s: ChessState): ChessStatus {
  if (legalRaw(s).length === 0) return inCheck(s) ? 'checkmate' : 'stalemate';
  if (insufficient(s.board)) return 'draw-material';
  if (s.halfmove >= 100) return 'draw-fifty';
  const key = s.history[s.history.length - 1];
  if (s.history.filter((k) => k === key).length >= 3) return 'draw-repetition';
  return 'playing';
}

/** Count leaf positions to a depth — the standard test of a move generator. */
export function perft(s: ChessState, depth: number): number {
  if (depth <= 0) return 1;
  const moves = legalRaw(s);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(apply(s, m), depth - 1);
  return n;
}

// ── The computer player: alpha-beta search over material and piece placement. ──
const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// Placement bonuses from White's side, a1 first (rank 1 first). Black reads them mirrored.
const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0, 0, 5, 5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10, -20, -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30],
};

/** Material and placement from White's point of view, in centipawns. */
export function evaluate(s: ChessState): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p === '') continue;
    const kind = p.toLowerCase();
    const white = p !== kind;
    const v = VALUE[kind] + PST[kind][white ? i : (7 - rankOf(i)) * 8 + fileOf(i)];
    score += white ? v : -v;
  }
  return score;
}

const MATE = 100000;

function search(s: ChessState, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = legalRaw(s);
  if (moves.length === 0) return inCheck(s) ? -MATE + ply : 0;
  if (s.halfmove >= 100 || insufficient(s.board)) return 0;
  if (depth === 0) return s.turn === 'w' ? evaluate(s) : -evaluate(s);
  // Captures first (most valuable victim): far better pruning.
  moves.sort((a, b) => (b.captured ? VALUE[b.captured.toLowerCase()] : 0) - (a.captured ? VALUE[a.captured.toLowerCase()] : 0));
  for (const m of moves) {
    const v = -search(apply(s, m), depth - 1, -beta, -alpha, ply + 1);
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return alpha;
}

/**
 * The computer's move: depth 1 easy, 2 normal, 3 hard (each is a full search of that many half-moves plus checkmate
 * detection). Deterministic for the same position. Null when there is no legal move.
 */
export function bestMove(s: ChessState, depth = 2): ChessMove | null {
  const moves = legalMoves(s);
  if (moves.length === 0) return null;
  const d = Math.max(1, Math.min(4, Math.floor(depth)));
  let best = moves[0], bestScore = -Infinity;
  const ordered = moves.slice().sort((a, b) => (b.captured ? VALUE[b.captured.toLowerCase()] : 0) - (a.captured ? VALUE[a.captured.toLowerCase()] : 0));
  for (const m of ordered) {
    const v = -search(apply(s, m), d - 1, -Infinity, -bestScore, 1);
    if (v > bestScore) { bestScore = v; best = m; }
  }
  return best;
}
`;

const CARDS = String.raw`/**
 * CARDS — a deck, TEEN PATTI hand ranking and INDIAN RUMMY declarations, for games played for FUN: points and pretend
 * chips only. Real-money play is not something this pack supports (India's online real-money gaming ban, 2025).
 *
 *   const deck = shuffle(createDeck(), rng);                     // 52 cards (createDeck({ decks: 2, jokers: 2 }) for rummy)
 *   const [hands, rest] = deal(deck, 3, 4);                      // 4 players, 3 cards each
 *   teenPattiHand(hands[0])  → { category: 'pure-sequence', name: 'Pure sequence', … }
 *   compareTeenPatti(a, b)    → 1 (a wins), -1, or 0 (a tie)
 *   checkDeclaration(groups, wildRank) → { valid, reason }       // rummy: 13 cards in groups
 *   bestGrouping(hand, wildRank)       → the grouping with the fewest points (for the computer and for "sort my cards")
 * A card is { rank: 1..13 (A=1, J=11, Q=12, K=13), suit: 's' | 'h' | 'd' | 'c' }, or a printed joker { rank: 0, suit: 'j' }.
 */
import type { Rng } from './dice';

export type Suit = 's' | 'h' | 'd' | 'c' | 'j';
export interface Card { rank: number; suit: Suit }
export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
const RANK_NAMES = ['JOKER', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣', j: '' };

export function cardName(c: Card): string { return c.suit === 'j' ? 'JOKER' : RANK_NAMES[c.rank] + SUIT_SYMBOL[c.suit]; }
export function isRed(c: Card): boolean { return c.suit === 'h' || c.suit === 'd'; }

export function createDeck(o: { decks?: number; jokers?: number } = {}): Card[] {
  const out: Card[] = [];
  for (let d = 0; d < Math.max(1, Math.floor(o.decks ?? 1)); d++) for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) out.push({ rank, suit });
  for (let j = 0; j < Math.max(0, Math.floor(o.jokers ?? 0)); j++) out.push({ rank: 0, suit: 'j' });
  return out;
}

/** Fisher–Yates with the game's seeded random source. */
export function shuffleCards(cards: readonly Card[], rng: Rng): Card[] {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Deal 'count' cards to each of 'players', one at a time round the table. Returns the hands and what is left. */
export function deal(deck: readonly Card[], count: number, players: number): [Card[][], Card[]] {
  const n = Math.max(1, Math.floor(players)), k = Math.max(0, Math.floor(count));
  if (n * k > deck.length) throw new Error('not enough cards to deal ' + k + ' to ' + n + ' players');
  const hands: Card[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * k; i++) hands[i % n].push(deck[i]);
  return [hands, deck.slice(n * k)];
}

// ── TEEN PATTI ──
export type TeenPattiCategory = 'trail' | 'pure-sequence' | 'sequence' | 'colour' | 'pair' | 'high-card';
const TP_ORDER: TeenPattiCategory[] = ['high-card', 'pair', 'colour', 'sequence', 'pure-sequence', 'trail'];
const TP_NAME: Record<TeenPattiCategory, string> = { trail: 'Trail (three of a kind)', 'pure-sequence': 'Pure sequence', sequence: 'Sequence', colour: 'Colour', pair: 'Pair', 'high-card': 'High card' };
export interface TeenPattiHand { category: TeenPattiCategory; name: string; /** Compared left to right; higher wins. */ score: number[] }

const high = (r: number): number => (r === 1 ? 14 : r);

/** Rank a three-card hand. A-K-Q is the best sequence, then A-2-3, then K-Q-J and down. */
export function teenPattiHand(cards: readonly Card[]): TeenPattiHand {
  if (cards.length !== 3 || cards.some((c) => c.suit === 'j' || c.rank < 1 || c.rank > 13)) throw new Error('teen patti needs three ordinary cards');
  const r = cards.map((c) => high(c.rank)).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const isA23 = r[0] === 14 && r[1] === 3 && r[2] === 2;
  const straight = (r[0] - r[1] === 1 && r[1] - r[2] === 1) || isA23;
  // A-2-3 sits between A-K-Q and K-Q-J.
  const seqValue = isA23 ? 13.5 : r[0];
  let category: TeenPattiCategory; let score: number[];
  if (r[0] === r[2]) { category = 'trail'; score = [r[0]]; }
  else if (straight && flush) { category = 'pure-sequence'; score = [seqValue]; }
  else if (straight) { category = 'sequence'; score = [seqValue]; }
  else if (flush) { category = 'colour'; score = r; }
  else if (r[0] === r[1] || r[1] === r[2]) { category = 'pair'; const pair = r[1]; score = [pair, r[0] === r[1] ? r[2] : r[0]]; }
  else { category = 'high-card'; score = r; }
  return { category, name: TP_NAME[category], score: [TP_ORDER.indexOf(category), ...score] };
}

export function compareTeenPatti(a: readonly Card[], b: readonly Card[]): 1 | -1 | 0 {
  const x = teenPattiHand(a).score, y = teenPattiHand(b).score;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ── INDIAN RUMMY (13 cards) ──
export type MeldType = 'pure-sequence' | 'sequence' | 'set';
const isJoker = (c: Card, wildRank: number): boolean => c.suit === 'j' || c.rank === wildRank;

function naturalRun(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
  return true;
}

/** Same suit, consecutive, no gaps: Ace low (A-2-3) or high (Q-K-A), never round the corner (K-A-2). */
function isPureRun(cards: readonly Card[]): boolean {
  if (cards.length < 3 || cards.some((c) => c.suit === 'j') || !cards.every((c) => c.suit === cards[0].suit)) return false;
  const low = cards.map((c) => c.rank).sort((a, b) => a - b);
  const hi = cards.map((c) => high(c.rank)).sort((a, b) => a - b);
  return naturalRun(low) || naturalRun(hi);
}

function canRunWithJokers(naturals: readonly Card[], jokers: number): boolean {
  const total = naturals.length + jokers;
  if (total < 3) return false;
  // A group of jokers alone is not a sequence.
  if (naturals.length === 0) return false;
  if (!naturals.every((c) => c.suit === naturals[0].suit)) return false;
  for (const mapRank of [(r: number) => r, high]) {
    const rs = naturals.map((c) => mapRank(c.rank)).sort((a, b) => a - b);
    if (new Set(rs).size !== rs.length) continue;
    const span = rs[rs.length - 1] - rs[0] + 1;
    if (span - rs.length <= jokers && total <= 13) return true;
  }
  return false;
}

/** What a group of cards is, or null when it is not a valid meld. The wild rank's cards and printed jokers are jokers. */
export function meldType(cards: readonly Card[], wildRank: number): MeldType | null {
  if (cards.length < 3) return null;
  // A wild-rank card in its natural place still makes a pure sequence.
  if (isPureRun(cards)) return 'pure-sequence';
  const naturals = cards.filter((c) => !isJoker(c, wildRank));
  const jokers = cards.length - naturals.length;
  if (canRunWithJokers(naturals, jokers)) return 'sequence';
  if (cards.length <= 4 && naturals.length > 0 && naturals.every((c) => c.rank === naturals[0].rank)) {
    const suits = naturals.map((c) => c.suit);
    if (new Set(suits).size === suits.length) return 'set';
  }
  return null;
}

/** Card points in rummy: face cards and Aces 10, numbers their value, jokers 0. */
export function cardPoints(c: Card, wildRank: number): number {
  if (isJoker(c, wildRank)) return 0;
  return c.rank === 1 || c.rank >= 11 ? 10 : c.rank;
}

export interface Declaration { valid: boolean; reason: string }

/** A rummy declaration: every card in a valid group, at least two sequences, at least one of them pure. */
export function checkDeclaration(groups: readonly (readonly Card[])[], wildRank: number, handSize = 13): Declaration {
  const count = groups.reduce((n, g) => n + g.length, 0);
  if (count !== handSize) return { valid: false, reason: 'Every one of the ' + handSize + ' cards must be in a group' };
  const types = groups.map((g) => meldType(g, wildRank));
  const bad = types.findIndex((t) => t === null);
  if (bad >= 0) return { valid: false, reason: 'Group ' + (bad + 1) + ' is not a sequence or a set' };
  if (!types.includes('pure-sequence')) return { valid: false, reason: 'A pure sequence (no joker) is needed' };
  if (types.filter((t) => t === 'pure-sequence' || t === 'sequence').length < 2) return { valid: false, reason: 'Two sequences are needed' };
  return { valid: true, reason: 'Valid declaration' };
}

/**
 * Points a grouping leaves the player with: the cards outside valid groups. Without a pure sequence every card counts;
 * with a pure sequence but no second sequence, everything except the pure sequence counts. Capped at 80.
 */
export function handPoints(groups: readonly (readonly Card[])[], wildRank: number): number {
  const types = groups.map((g) => meldType(g, wildRank));
  const sum = (cs: readonly Card[]) => cs.reduce((n, c) => n + cardPoints(c, wildRank), 0);
  const all = groups.reduce((n, g) => n + sum(g), 0);
  const pure = types.indexOf('pure-sequence');
  let points: number;
  if (pure < 0) points = all;
  else if (types.filter((t) => t === 'pure-sequence' || t === 'sequence').length < 2) points = all - sum(groups[pure]);
  else points = groups.reduce((n, g, i) => n + (types[i] ? 0 : sum(g)), 0);
  return Math.min(80, points);
}

/**
 * The grouping with the fewest points (exhaustive over the hand: for the lowest card not yet placed, either leave it
 * loose or start every valid meld that contains it). The last group holds the loose cards. Used for a computer player
 * and for a "sort my cards" button.
 */
export function bestGrouping(hand: readonly Card[], wildRank: number): { groups: Card[][]; points: number } {
  const n = hand.length;
  // Every valid meld of 3–5 cards, as index lists.
  const melds: number[][] = [];
  const idx = hand.map((_, i) => i);
  const choose = (start: number, size: number, acc: number[]) => {
    if (acc.length === size) { if (meldType(acc.map((i) => hand[i]), wildRank)) melds.push(acc.slice()); return; }
    for (let i = start; i < n; i++) { acc.push(idx[i]); choose(i + 1, size, acc); acc.pop(); }
  };
  for (const size of [3, 4, 5]) choose(0, size, []);
  let best: { groups: Card[][]; points: number } = { groups: [hand.slice()], points: handPoints([hand.slice()], wildRank) };
  const used = new Array(n).fill(false);
  const chosen: number[][] = [];
  const loose: number[] = [];
  let visits = 0;
  const walk = (from: number) => {
    if (++visits > 200000) return;   // a hard bound; real 13-card hands finish far below it
    let i = from;
    while (i < n && used[i]) i++;
    if (i === n) {
      const groups = [...chosen.map((g) => g.map((k) => hand[k])), loose.map((k) => hand[k])].filter((g) => g.length);
      const points = handPoints(groups, wildRank);
      if (points < best.points) best = { groups, points };
      return;
    }
    for (const m of melds) {
      // Melds are ascending index lists: start only those whose lowest card is this one.
      if (m[0] !== i || m.some((k) => used[k])) continue;
      m.forEach((k) => { used[k] = true; }); chosen.push(m);
      walk(i + 1);
      chosen.pop(); m.forEach((k) => { used[k] = false; });
    }
    used[i] = true; loose.push(i);
    walk(i + 1);
    loose.pop(); used[i] = false;
  };
  walk(0);
  return best;
}
`;

const CARROM = String.raw`/**
 * CARROM — real disc physics and the family rules. Sizes are the real board's, in millimetres, centred on the board's
 * middle (x right, y down, the board 740 mm square): coins bounce off each other and the cushions, slow down on the
 * board, and drop into a corner pocket. The rules on top: your own coin keeps your turn, pocketing the striker is a
 * foul that returns one of your coins, the queen must be covered by one of your coins in the same turn, and the game is
 * won by pocketing all your coins (scored by the coins the other player has left, plus the queen).
 *
 *   let game = createCarrom();
 *   game = placeStriker(game, x);                     // slide the striker along the current player's baseline
 *   const shot = shoot(game, angle, power);           // angle in radians (0 = right, -π/2 = up the board), power 0..1
 *   shot.frames                                       // positions every 1/60 s, for animation
 *   game = shot.state;  shot.pocketed / shot.foul / shot.turnContinues / shot.message
 * Player 0 shoots from the bottom baseline (white coins), player 1 from the top (black coins).
 */
export const BOARD = 740;
export const HALF = BOARD / 2;
export const POCKET_RADIUS = 22.25;
export const COIN_RADIUS = 15.9;
export const STRIKER_RADIUS = 20.6;
/** Distance of each player's baseline (striker centre line) from the board's middle. */
export const BASELINE = 250;
/** How far along the baseline the striker may slide from the middle, each way. */
export const BASELINE_HALF_LENGTH = 235;
const COIN_MASS = 5.5, STRIKER_MASS = 15;
const FRICTION = 380;          // mm/s² — how quickly a disc slows on the board
const DISC_RESTITUTION = 0.92, WALL_RESTITUTION = 0.72;
const MAX_SPEED = 4200;        // mm/s at full power
const STEP = 1 / 240;

export type DiscKind = 'striker' | 'white' | 'black' | 'queen';
export interface Disc { id: string; kind: DiscKind; x: number; y: number; vx: number; vy: number; r: number; pocketed: boolean }
export type QueenState = 'board' | 'pending' | 'covered';
export interface CarromState {
  discs: Disc[];
  turn: 0 | 1;
  /** Coins each player has pocketed (white for player 0, black for player 1). */
  pocketedBy: [number, number];
  queen: QueenState;
  /** Who covered the queen (null until someone does). */
  queenOwner: 0 | 1 | null;
  over: boolean;
  winner: 0 | 1 | null;
  /** Points the winner scores for the board: the other player's coins left, plus 3 for the queen if the winner covered it. */
  points: number;
}
export interface ShotResult {
  state: CarromState;
  frames: Array<Array<{ id: string; x: number; y: number }>>;
  pocketed: Array<{ id: string; kind: DiscKind }>;
  foul: boolean;
  turnContinues: boolean;
  message: string;
}

const colourOf = (player: 0 | 1): DiscKind => (player === 0 ? 'white' : 'black');

/** The starting position: the queen in the middle, six coins round it, twelve round those, colours alternating. */
export function createCarrom(): CarromState {
  const discs: Disc[] = [{ id: 'queen', kind: 'queen', x: 0, y: 0, vx: 0, vy: 0, r: COIN_RADIUS, pocketed: false }];
  const d = COIN_RADIUS * 2 + 0.2;
  let w = 0, b = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const kind: DiscKind = i % 2 === 0 ? 'white' : 'black';
    discs.push({ id: kind === 'white' ? 'w' + w++ : 'b' + b++, kind, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0, r: COIN_RADIUS, pocketed: false });
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ring = i % 2 === 0 ? d * 2 : d * Math.sqrt(3);
    const kind: DiscKind = i % 2 === 0 ? 'black' : 'white';
    discs.push({ id: kind === 'white' ? 'w' + w++ : 'b' + b++, kind, x: Math.cos(a) * ring, y: Math.sin(a) * ring, vx: 0, vy: 0, r: COIN_RADIUS, pocketed: false });
  }
  discs.push({ id: 'striker', kind: 'striker', x: 0, y: BASELINE, vx: 0, vy: 0, r: STRIKER_RADIUS, pocketed: false });
  return { discs, turn: 0, pocketedBy: [0, 0], queen: 'board', queenOwner: null, over: false, winner: null, points: 0 };
}

const cloneState = (s: CarromState): CarromState => ({ ...s, discs: s.discs.map((d) => ({ ...d })), pocketedBy: [s.pocketedBy[0], s.pocketedBy[1]] });

/** Is the striker free to sit at (x, baseline) — not on top of a coin? */
export function strikerFits(s: CarromState, x: number): boolean {
  const y = s.turn === 0 ? BASELINE : -BASELINE;
  return s.discs.every((d) => d.kind === 'striker' || d.pocketed || Math.hypot(d.x - x, d.y - y) >= d.r + STRIKER_RADIUS);
}

/** Put the striker on the current player's baseline at x (clamped to the line). */
export function placeStriker(s: CarromState, x: number): CarromState {
  const next = cloneState(s);
  const st = next.discs.find((d) => d.kind === 'striker')!;
  st.x = Math.max(-BASELINE_HALF_LENGTH, Math.min(BASELINE_HALF_LENGTH, Number.isFinite(x) ? x : 0));
  st.y = next.turn === 0 ? BASELINE : -BASELINE;
  st.vx = 0; st.vy = 0; st.pocketed = false;
  return next;
}

const POCKETS = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => ({ x: sx * (HALF - POCKET_RADIUS), y: sy * (HALF - POCKET_RADIUS) }));

/** One small physics step for every moving disc. Returns the discs that dropped this step. */
export function stepPhysics(discs: Disc[], dt: number): Disc[] {
  const live = discs.filter((d) => !d.pocketed);
  for (const d of live) {
    const speed = Math.hypot(d.vx, d.vy);
    if (speed > 0) {
      const slow = Math.max(0, speed - FRICTION * dt) / speed;
      d.vx *= slow; d.vy *= slow;
      if (Math.hypot(d.vx, d.vy) < 2) { d.vx = 0; d.vy = 0; }
    }
    d.x += d.vx * dt; d.y += d.vy * dt;
  }
  // Disc-disc collisions: elastic with restitution, by mass, overlap pushed apart.
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy), min = a.r + b.r;
    if (dist >= min || dist === 0) continue;
    const nx = dx / dist, ny = dy / dist;
    const ma = a.kind === 'striker' ? STRIKER_MASS : COIN_MASS, mb = b.kind === 'striker' ? STRIKER_MASS : COIN_MASS;
    const overlap = min - dist;
    a.x -= nx * overlap * (mb / (ma + mb)); a.y -= ny * overlap * (mb / (ma + mb));
    b.x += nx * overlap * (ma / (ma + mb)); b.y += ny * overlap * (ma / (ma + mb));
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel >= 0) continue;   // already moving apart
    const jImpulse = (-(1 + DISC_RESTITUTION) * rel) / (1 / ma + 1 / mb);
    a.vx -= (jImpulse / ma) * nx; a.vy -= (jImpulse / ma) * ny;
    b.vx += (jImpulse / mb) * nx; b.vy += (jImpulse / mb) * ny;
  }
  const dropped: Disc[] = [];
  for (const d of live) {
    if (POCKETS.some((p) => Math.hypot(d.x - p.x, d.y - p.y) < POCKET_RADIUS)) { d.pocketed = true; d.vx = 0; d.vy = 0; dropped.push(d); continue; }
    if (d.x - d.r < -HALF) { d.x = -HALF + d.r; d.vx = Math.abs(d.vx) * WALL_RESTITUTION; }
    if (d.x + d.r > HALF) { d.x = HALF - d.r; d.vx = -Math.abs(d.vx) * WALL_RESTITUTION; }
    if (d.y - d.r < -HALF) { d.y = -HALF + d.r; d.vy = Math.abs(d.vy) * WALL_RESTITUTION; }
    if (d.y + d.r > HALF) { d.y = HALF - d.r; d.vy = -Math.abs(d.vy) * WALL_RESTITUTION; }
  }
  return dropped;
}

/** A free spot near the middle for a coin coming back onto the board. */
function centreSpot(discs: Disc[], r: number): { x: number; y: number } {
  for (let ring = 0; ring < 12; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
    const a = (k / Math.max(1, ring * 6)) * Math.PI * 2;
    const x = Math.cos(a) * ring * r * 2, y = Math.sin(a) * ring * r * 2;
    if (discs.every((d) => d.pocketed || Math.hypot(d.x - x, d.y - y) >= d.r + r)) return { x, y };
  }
  return { x: 0, y: 0 };
}

function returnToCentre(s: CarromState, d: Disc): void {
  const spot = centreSpot(s.discs, d.r);
  d.pocketed = false; d.x = spot.x; d.y = spot.y; d.vx = 0; d.vy = 0;
}

/**
 * Flick the striker. The physics runs until every disc has stopped (at most 20 s of board time); then the rules decide
 * what the shot meant.
 */
export function shoot(state: CarromState, angle: number, power: number): ShotResult {
  if (state.over) return { state, frames: [], pocketed: [], foul: false, turnContinues: false, message: 'The game is over' };
  const s = cloneState(state);
  const me = s.turn, mine = colourOf(me), theirs = colourOf(me === 0 ? 1 : 0);
  const striker = s.discs.find((d) => d.kind === 'striker')!;
  const p = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
  const a = Number.isFinite(angle) ? angle : -Math.PI / 2;
  striker.vx = Math.cos(a) * MAX_SPEED * p; striker.vy = Math.sin(a) * MAX_SPEED * p;
  const frames: ShotResult['frames'] = [];
  const pocketed: ShotResult['pocketed'] = [];
  let t = 0, nextFrame = 0;
  while (t < 20) {
    for (const d of stepPhysics(s.discs, STEP)) pocketed.push({ id: d.id, kind: d.kind });
    t += STEP;
    if (t >= nextFrame) { frames.push(s.discs.filter((d) => !d.pocketed).map((d) => ({ id: d.id, x: d.x, y: d.y }))); nextFrame += 1 / 60; }
    if (s.discs.every((d) => d.pocketed || (d.vx === 0 && d.vy === 0))) break;
  }
  // ── The rules ──
  const strikerIn = pocketed.some((x) => x.kind === 'striker');
  const ownIn = pocketed.filter((x) => x.kind === mine).length;
  const theirIn = pocketed.filter((x) => x.kind === theirs).length;
  const queenIn = pocketed.some((x) => x.kind === 'queen');
  s.pocketedBy[me] += ownIn;
  s.pocketedBy[me === 0 ? 1 : 0] += theirIn;
  const messages: string[] = [];
  let foul = false;
  if (strikerIn) {
    foul = true;
    messages.push('Foul: the striker went in');
    // The penalty: one of your pocketed coins comes back to the middle.
    const back = s.discs.find((d) => d.kind === mine && d.pocketed && !pocketed.some((x) => x.id === d.id)) ?? s.discs.find((d) => d.kind === mine && d.pocketed);
    if (back) { returnToCentre(s, back); s.pocketedBy[me] -= 1; messages.push('one of your coins goes back to the middle'); }
  }
  // The queen: pocketed now, it must be covered by one of your coins in this shot or your next one.
  if (queenIn && !foul) {
    if (ownIn > 0) { s.queen = 'covered'; s.queenOwner = me; messages.push('Queen covered!'); }
    else { s.queen = 'pending'; messages.push('Queen pocketed — cover it with your next coin'); }
  } else if (queenIn && foul) {
    const q = s.discs.find((d) => d.kind === 'queen')!; returnToCentre(s, q); s.queen = 'board';
  } else if (state.queen === 'pending') {
    if (ownIn > 0 && !foul) { s.queen = 'covered'; s.queenOwner = me; messages.push('Queen covered!'); }
    else { const q = s.discs.find((d) => d.kind === 'queen')!; returnToCentre(s, q); s.queen = 'board'; messages.push('The queen was not covered and goes back to the middle'); }
  }
  // Your last coin cannot go in while the queen is still to be won: it comes back.
  const mineLeft = s.discs.filter((d) => d.kind === mine && !d.pocketed).length;
  if (mineLeft === 0 && s.queen !== 'covered') {
    const last = s.discs.find((d) => d.kind === mine && d.pocketed && pocketed.some((x) => x.id === d.id));
    if (last) { returnToCentre(s, last); s.pocketedBy[me] -= 1; foul = true; messages.push('Foul: the queen must be covered before your last coin'); }
  }
  // The striker always comes back for the next shot.
  striker.pocketed = false;
  const minesNow = s.discs.filter((d) => d.kind === mine && !d.pocketed).length;
  const theirsNow = s.discs.filter((d) => d.kind === theirs && !d.pocketed).length;
  if (minesNow === 0 && s.queen === 'covered') {
    s.over = true; s.winner = me;
    s.points = theirsNow + (s.queenOwner === me ? 3 : 0);
    messages.push('Board won!');
  } else if (theirsNow === 0 && s.queen === 'covered') {
    s.over = true; s.winner = me === 0 ? 1 : 0;
    s.points = minesNow + (s.queenOwner === s.winner ? 3 : 0);
    messages.push('Your last opponent coin ended the board for them');
  }
  const turnContinues = !s.over && !foul && (ownIn > 0 || (queenIn && s.queen === 'pending'));
  if (!turnContinues && !s.over) s.turn = me === 0 ? 1 : 0;
  const placed = placeStriker(s, 0);
  if (!messages.length) messages.push(ownIn ? 'Good shot — shoot again' : 'Next player');
  return { state: placed, frames, pocketed, foul, turnContinues, message: messages.join('; ') };
}
`;

const CRICKET = String.raw`/**
 * CRICKET — the scoring a cricket fan checks first: legal balls and overs, wides and no-balls (a run, the ball bowled
 * again, a free hit after a no-ball), the strike changing on odd runs and at the end of every over, an innings ending on
 * overs, all out or the target, and the result said the way commentators say it. Plus the batting itself for a tap game:
 * the timing of the swing decides the shot.
 *
 *   let match = createMatch({ overs: 2, wickets: 3, teams: ['India', 'Australia'] });
 *   const out = shotFromTiming(timingError, { onStumps: true, aggressive: false }, rng);   // the player's tap
 *   match = bowl(match, { extra: null, ...out });                                          // or { extra: 'wide' }
 *   match.innings[match.current]                 → runs, wickets, balls, the batters, the over so far
 *   summary(match)                               → '45/2 (1.3 ov) · need 12 off 3 balls'
 *   match.result                                 → 'India won by 12 runs' when it is over
 */
import type { Rng } from './dice';

export type Dismissal = 'bowled' | 'caught' | 'lbw' | 'run-out' | 'stumped';
export type Extra = 'wide' | 'no-ball' | null;
export interface Ball { runs: number; out: Dismissal | null; extra: Extra }
export interface BatterCard { name: string; runs: number; balls: number; fours: number; sixes: number; out: Dismissal | null }
export interface Innings {
  team: string;
  runs: number; wickets: number;
  /** Legal balls bowled. */
  balls: number;
  extras: number;
  batters: BatterCard[];
  /** Index into batters of the one on strike, and the other one. */
  striker: number; nonStriker: number;
  /** This over, ball by ball, as shown on a scoreboard: '1', '4', 'W', 'wd', 'nb'. */
  thisOver: string[];
  freeHit: boolean;
  target: number | null;
  done: boolean;
}
export interface MatchOptions { overs?: number; wickets?: number; teams?: [string, string]; batters?: [string[], string[]] }
export interface Match { overs: number; wickets: number; teams: [string, string]; innings: Innings[]; current: number; over: boolean; result: string | null; winner: string | null }

const names = (team: string, n: number, given?: string[]): string[] => Array.from({ length: n }, (_, i) => given?.[i] ?? team + ' ' + (i + 1));

function newInnings(team: string, wickets: number, target: number | null, given?: string[]): Innings {
  const batters = names(team, wickets + 1, given).map((name) => ({ name, runs: 0, balls: 0, fours: 0, sixes: 0, out: null }));
  return { team, runs: 0, wickets: 0, balls: 0, extras: 0, batters, striker: 0, nonStriker: 1, thisOver: [], freeHit: false, target, done: false };
}

export function createMatch(o: MatchOptions = {}): Match {
  const overs = Math.max(1, Math.min(50, Math.floor(o.overs ?? 2)));
  const wickets = Math.max(1, Math.min(10, Math.floor(o.wickets ?? 10)));
  const teams: [string, string] = o.teams ?? ['Team A', 'Team B'];
  return { overs, wickets, teams, innings: [newInnings(teams[0], wickets, null, o.batters?.[0])], current: 0, over: false, result: null, winner: null };
}

/** Overs as a cricketer writes them: 13 legal balls → '2.1'. */
export function oversText(balls: number): string { return Math.floor(balls / 6) + '.' + (balls % 6); }

function cloneInnings(i: Innings): Innings { return { ...i, batters: i.batters.map((b) => ({ ...b })), thisOver: i.thisOver.slice() }; }

/** Bowl one ball. A wide or a no-ball adds a run and does not count as a ball; the ball after a no-ball is a free hit. */
export function bowl(match: Match, ball: Ball): Match {
  if (match.over) return match;
  const m: Match = { ...match, innings: match.innings.slice() };
  const inn = cloneInnings(m.innings[m.current]);
  m.innings[m.current] = inn;
  const runs = Math.max(0, Math.min(6, Math.floor(Number.isFinite(ball.runs) ? ball.runs : 0)));
  const bat = inn.batters[inn.striker];
  if (ball.extra === 'wide') {
    inn.runs += 1 + runs; inn.extras += 1 + runs; inn.thisOver.push(runs ? 'wd+' + runs : 'wd');
    if (runs % 2 === 1) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
  } else {
    const noBall = ball.extra === 'no-ball';
    // On a no-ball or a free hit the batter can only be run out.
    const protectedBall = noBall || inn.freeHit;
    const out = ball.out && !(protectedBall && ball.out !== 'run-out') ? ball.out : null;
    inn.runs += runs + (noBall ? 1 : 0);
    if (noBall) inn.extras += 1;
    bat.runs += runs;
    bat.balls += noBall ? 0 : 1;
    if (runs === 4) bat.fours++;
    if (runs === 6) bat.sixes++;
    if (!noBall) inn.balls++;
    inn.thisOver.push(noBall ? (runs ? 'nb+' + runs : 'nb') : out ? 'W' : String(runs));
    inn.freeHit = noBall;
    if (runs % 2 === 1) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
    if (out) {
      inn.wickets++;
      bat.out = out;
      const next = Math.max(inn.striker, inn.nonStriker) + 1;
      // The new batter takes the dismissed batter's end.
      if (inn.batters[inn.striker] === bat) inn.striker = next; else inn.nonStriker = next;
    }
    // End of the over: the strike changes ends.
    if (!noBall && inn.balls % 6 === 0) { [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker]; inn.thisOver = []; }
  }
  const chased = inn.target !== null && inn.runs >= inn.target;
  if (inn.wickets >= m.wickets || inn.balls >= m.overs * 6 || chased) inn.done = true;
  if (inn.done) finishInnings(m);
  return m;
}

function finishInnings(m: Match): void {
  if (m.current === 0) {
    const first = m.innings[0];
    m.innings.push(newInnings(m.teams[1], m.wickets, first.runs + 1));
    m.current = 1;
    return;
  }
  const [a, b] = m.innings;
  m.over = true;
  if (b.runs > a.runs) {
    const left = m.wickets - b.wickets;
    m.winner = b.team;
    m.result = b.team + ' won by ' + left + ' wicket' + (left === 1 ? '' : 's') + ' (' + (m.overs * 6 - b.balls) + ' balls left)';
  } else if (b.runs < a.runs) {
    const by = a.runs - b.runs;
    m.winner = a.team;
    m.result = a.team + ' won by ' + by + ' run' + (by === 1 ? '' : 's');
  } else { m.winner = null; m.result = 'Match tied'; }
}

/** The scoreboard line: '45/2 (5.3 ov)', with the chase when there is one. */
export function summary(m: Match): string {
  const inn = m.innings[m.current];
  let line = inn.team + ' ' + inn.runs + '/' + inn.wickets + ' (' + oversText(inn.balls) + ' ov)';
  if (inn.target !== null && !m.over) {
    const need = inn.target - inn.runs, left = m.overs * 6 - inn.balls;
    line += ' · need ' + need + ' off ' + left + ' ball' + (left === 1 ? '' : 's');
  }
  if (m.over && m.result) line += ' · ' + m.result;
  return line;
}

/** Runs per over so far, and (in a chase) the rate still needed. */
export function runRates(m: Match): { current: number; required: number | null } {
  const inn = m.innings[m.current];
  const current = inn.balls ? (inn.runs / inn.balls) * 6 : 0;
  const left = m.overs * 6 - inn.balls;
  const required = inn.target !== null && left > 0 ? ((inn.target - inn.runs) / left) * 6 : null;
  return { current: Math.round(current * 100) / 100, required: required === null ? null : Math.round(required * 100) / 100 };
}

/**
 * THE BATTING: the player's tap against the perfect moment. timingError is in seconds (negative = early). Perfect timing
 * hits a boundary (a six when going big), good timing finds runs, and the further off it is the likelier an edge to a
 * fielder; a big miss is bowled when the ball was on the stumps and a dot ball when it was not.
 */
export function shotFromTiming(timingError: number, ball: { onStumps: boolean; aggressive?: boolean }, rng: Rng): { runs: number; out: Dismissal | null; shot: string } {
  const e = Math.abs(Number.isFinite(timingError) ? timingError : 1);
  const big = !!ball.aggressive;
  if (e <= 0.03) return big ? { runs: 6, out: null, shot: 'six' } : { runs: 4, out: null, shot: 'four' };
  if (e <= 0.07) {
    if (big) return rng() < 0.15 ? { runs: 0, out: 'caught', shot: 'caught in the deep' } : { runs: 4, out: null, shot: 'four' };
    return rng() < 0.5 ? { runs: 2, out: null, shot: 'two' } : { runs: 3, out: null, shot: 'three' };
  }
  if (e <= 0.12) return rng() < (big ? 0.3 : 0.1) ? { runs: 0, out: 'caught', shot: 'edged and caught' } : { runs: 1, out: null, shot: 'single' };
  if (e <= 0.2) return rng() < (big ? 0.45 : 0.25) ? { runs: 0, out: 'caught', shot: 'edged and caught' } : { runs: 0, out: null, shot: 'dot' };
  return ball.onStumps ? { runs: 0, out: 'bowled', shot: 'bowled' } : { runs: 0, out: null, shot: 'missed' };
}
`;

const MATCH3 = String.raw`/**
 * MATCH-3 — swap two neighbouring tiles to line up three or more of a colour (game-gap audit 2026-11-20: every match-3
 * was hand-written, and the same faults came back — a board that starts with matches already on it, a board with no move
 * left and no reshuffle, cascades that leave holes, and a swap that "works" without making a match).
 *
 *   let game = createMatch3({ width: 8, height: 8, colors: 6, moves: 25, target: 3000, seed: Date.now() });
 *   const r = swapTiles(game, { x: 2, y: 3 }, { x: 3, y: 3 });   // r.ok false = no match: swap it back on screen
 *   game = r.state;   // r.steps: what cleared, what fell and what came in, cascade by cascade — animate them in order
 *   hint(game)        // a swap that works, for a "show me" button
 *
 * RULES: three or more in a row or column clear; four in a line makes a LINE tile (clears its row or column when it
 * goes), five makes a BOMB (clears every tile of the colour it is swapped with, or its own colour when matched), and an
 * L or T makes an AREA tile (clears the 3 x 3 around it). Tiles fall and new ones drop in from the top; each cascade in a
 * chain scores more. The board never starts with a match, always has a move, and reshuffles itself when stuck.
 */
import { createRng, type Rng } from './dice';

export type Special = 'none' | 'line-h' | 'line-v' | 'area' | 'bomb';
export interface Tile { color: number; special: Special; id: number }
export interface Cell { x: number; y: number }
export type Match3Status = 'playing' | 'won' | 'lost';
export interface Match3State {
  width: number; height: number; colors: number;
  /** grid[y][x]; y = 0 is the TOP row. */
  grid: Tile[][];
  score: number;
  movesLeft: number;
  target: number;
  status: Match3Status;
  /** Seed state for the refills, so a replay drops the same tiles. */
  seed: number;
  nextId: number;
  /** How many times the board reshuffled itself because no move was left. */
  shuffles: number;
}
export interface CascadeStep {
  /** Cells cleared this cascade (before the fall). */
  cleared: Cell[];
  /** Special tiles made this cascade, where they were made (before the fall). */
  made: Array<Cell & { special: Special }>;
  /** Points scored this cascade. */
  points: number;
  /** Which cascade in the chain (1 = the swap's own match). */
  chain: number;
}
export interface SwapResult { state: Match3State; ok: boolean; steps: CascadeStep[]; reason?: string; reshuffled: boolean }

const clone = (s: Match3State): Match3State => ({ ...s, grid: s.grid.map((row) => row.map((t) => ({ ...t }))) });
const inside = (s: Match3State, c: Cell): boolean => c.x >= 0 && c.y >= 0 && c.x < s.width && c.y < s.height;

/** Advance the stored seed and return a random source for this call (replays are exact). */
function rngOf(s: Match3State): Rng {
  const r = createRng(s.seed);
  return () => { const v = r(); s.seed = (s.seed * 1103515245 + 12345) >>> 0; return v; };
}

function newTile(s: Match3State, rng: Rng, color?: number): Tile {
  return { color: color ?? Math.floor(rng() * s.colors), special: 'none', id: s.nextId++ };
}

/** Every run of three or more, as lists of cells (a cell in a row run and a column run is in both). */
export function findRuns(s: Match3State): Cell[][] {
  const runs: Cell[][] = [];
  for (let y = 0; y < s.height; y++) {
    let start = 0;
    for (let x = 1; x <= s.width; x++) {
      if (x < s.width && s.grid[y][x].color === s.grid[y][start].color && s.grid[y][x].color >= 0) continue;
      if (x - start >= 3 && s.grid[y][start].color >= 0) runs.push(Array.from({ length: x - start }, (_, i) => ({ x: start + i, y })));
      start = x;
    }
  }
  for (let x = 0; x < s.width; x++) {
    let start = 0;
    for (let y = 1; y <= s.height; y++) {
      if (y < s.height && s.grid[y][x].color === s.grid[start][x].color && s.grid[y][x].color >= 0) continue;
      if (y - start >= 3 && s.grid[start][x].color >= 0) runs.push(Array.from({ length: y - start }, (_, i) => ({ x, y: start + i })));
      start = y;
    }
  }
  return runs;
}

/** Would swapping a and b make a match (or fire a bomb)? Does not change the board. */
function swapMakesMatch(s: Match3State, a: Cell, b: Cell): boolean {
  if (s.grid[a.y][a.x].special === 'bomb' || s.grid[b.y][b.x].special === 'bomb') return true;
  const t = s.grid[a.y][a.x]; s.grid[a.y][a.x] = s.grid[b.y][b.x]; s.grid[b.y][b.x] = t;
  const ok = findRuns(s).length > 0;
  s.grid[b.y][b.x] = s.grid[a.y][a.x]; s.grid[a.y][a.x] = t;
  return ok;
}

/** A swap that makes a match, or null when the board is stuck. */
export function hint(s: Match3State): [Cell, Cell] | null {
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const a = { x, y }, b = { x: x + dx, y: y + dy };
      if (inside(s, b) && swapMakesMatch(s, a, b)) return [a, b];
    }
  }
  return null;
}

/** Fill the board with no match on it and at least one move. */
function deal(s: Match3State, rng: Rng): void {
  for (let attempt = 0; attempt < 200; attempt++) {
    s.grid = [];
    for (let y = 0; y < s.height; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < s.width; x++) {
        // Never the colour that would make three with the two to the left or the two above.
        const banned = new Set<number>();
        if (x >= 2 && row[x - 1].color === row[x - 2].color) banned.add(row[x - 1].color);
        if (y >= 2 && s.grid[y - 1][x].color === s.grid[y - 2][x].color) banned.add(s.grid[y - 1][x].color);
        let c = Math.floor(rng() * s.colors);
        for (let k = 0; banned.has(c) && k < s.colors; k++) c = (c + 1) % s.colors;
        row.push(newTile(s, rng, c));
      }
      s.grid.push(row);
    }
    if (hint(s)) return;
  }
}

/** Rearrange the same tiles until there is no match and at least one move. */
function reshuffle(s: Match3State, rng: Rng): void {
  const tiles = s.grid.flat();
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    s.grid = Array.from({ length: s.height }, (_, y) => tiles.slice(y * s.width, (y + 1) * s.width));
    if (findRuns(s).length === 0 && hint(s)) { s.shuffles += 1; return; }
  }
  // A colour-starved board that no order can save: deal a fresh one.
  deal(s, rng);
  s.shuffles += 1;
}

export function createMatch3(o: { width?: number; height?: number; colors?: number; moves?: number; target?: number; seed?: number } = {}): Match3State {
  const width = Math.max(4, Math.min(12, Math.floor(o.width ?? 8)));
  const height = Math.max(4, Math.min(12, Math.floor(o.height ?? 8)));
  const colors = Math.max(3, Math.min(8, Math.floor(o.colors ?? 6)));
  const s: Match3State = {
    width, height, colors, grid: [], score: 0,
    movesLeft: Math.max(1, Math.floor(o.moves ?? 25)), target: Math.max(0, Math.floor(o.target ?? 3000)),
    status: 'playing', seed: (Math.floor(o.seed ?? Date.now()) >>> 0) || 1, nextId: 1, shuffles: 0,
  };
  deal(s, rngOf(s));
  return s;
}

/** The cells a special tile clears when it goes off. */
function blast(s: Match3State, at: Cell, special: Special, swappedColor: number | null): Cell[] {
  const out: Cell[] = [];
  if (special === 'line-h') for (let x = 0; x < s.width; x++) out.push({ x, y: at.y });
  else if (special === 'line-v') for (let y = 0; y < s.height; y++) out.push({ x: at.x, y });
  else if (special === 'area') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = { x: at.x + dx, y: at.y + dy }; if (inside(s, c)) out.push(c); }
  else if (special === 'bomb') {
    const color = swappedColor ?? s.grid[at.y][at.x].color;
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (s.grid[y][x].color === color) out.push({ x, y });
    out.push(at);
  }
  return out;
}

/** Clear, make specials, set off specials, drop, refill — until the board is still. Mutates s. */
function resolve(s: Match3State, rng: Rng, first: { cells: Cell[]; swapped: Cell[] }, steps: CascadeStep[]): void {
  let chain = 0;
  let pending: Cell[] | null = first.cells.length ? first.cells : null;
  for (let guard = 0; guard < 100; guard++) {
    const runs = pending ? [] : findRuns(s);
    if (!pending && runs.length === 0) break;
    chain += 1;
    const clear = new Map<string, Cell>();
    const add = (c: Cell): void => { clear.set(c.x + ',' + c.y, c); };
    (pending ?? []).forEach(add);
    runs.flat().forEach(add);
    // Specials made by this cascade's runs: 5 = bomb, an L/T crossing = area, 4 = line. Made where the swap landed when
    // it is in the run, else in the run's middle.
    const made: Array<Cell & { special: Special }> = [];
    const key = (c: Cell): string => c.x + ',' + c.y;
    const inRuns = new Map<string, number>();
    runs.forEach((r) => r.forEach((c) => inRuns.set(key(c), (inRuns.get(key(c)) ?? 0) + 1)));
    const crossing = [...inRuns.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    for (const r of runs) {
      const spot = r.find((c) => first.swapped.some((w) => w.x === c.x && w.y === c.y) && chain === 1) ?? r[Math.floor(r.length / 2)];
      const cross = r.find((c) => crossing.includes(key(c)));
      if (r.length >= 5) made.push({ ...spot, special: 'bomb' });
      else if (cross && !made.some((m) => key(m) === key(cross))) made.push({ ...cross, special: 'area' });
      else if (r.length === 4) made.push({ ...spot, special: r[0].y === r[1].y ? 'line-v' : 'line-h' });
    }
    // Set off every special that is being cleared (which can clear more specials: follow them).
    const queue = [...clear.values()];
    const fired = new Set<string>();
    while (queue.length) {
      const c = queue.pop() as Cell;
      const t = s.grid[c.y][c.x];
      if (t.special === 'none' || fired.has(key(c))) continue;
      fired.add(key(c));
      for (const b of blast(s, c, t.special, null)) if (!clear.has(key(b))) { add(b); queue.push(b); }
    }
    const cleared = [...clear.values()].filter((c) => !made.some((m) => key(m) === key(c)));
    const points = cleared.length * 10 * chain;
    s.score += points;
    for (const c of cleared) s.grid[c.y][c.x] = { color: -1, special: 'none', id: 0 };
    for (const m of made) { const t = s.grid[m.y][m.x]; s.grid[m.y][m.x] = { ...t, special: m.special, color: m.special === 'bomb' ? t.color : t.color }; }
    // Drop: every column falls to the bottom, new tiles come in from the top.
    for (let x = 0; x < s.width; x++) {
      const kept: Tile[] = [];
      for (let y = s.height - 1; y >= 0; y--) if (s.grid[y][x].color >= 0) kept.push(s.grid[y][x]);
      for (let y = s.height - 1, i = 0; y >= 0; y--, i++) s.grid[y][x] = i < kept.length ? kept[i] : newTile(s, rng);
    }
    steps.push({ cleared, made, points, chain });
    pending = null;
  }
}

/** Swap two neighbouring tiles. A swap that makes no match is refused (ok false) and the board is unchanged. */
export function swapTiles(state: Match3State, a: Cell, b: Cell): SwapResult {
  const fail = (reason: string): SwapResult => ({ state, ok: false, steps: [], reason, reshuffled: false });
  if (state.status !== 'playing') return fail('the game is over');
  if (!inside(state, a) || !inside(state, b)) return fail('off the board');
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return fail('only neighbouring tiles swap');
  if (!swapMakesMatch(state, a, b)) return fail('no match');
  const s = clone(state);
  const rng = rngOf(s);
  const ta = s.grid[a.y][a.x], tb = s.grid[b.y][b.x];
  s.grid[a.y][a.x] = tb; s.grid[b.y][b.x] = ta;
  // A bomb swapped with a tile clears that tile's colour; two bombs clear the board.
  const first: Cell[] = [];
  const bombAt = ta.special === 'bomb' ? b : tb.special === 'bomb' ? a : null;
  if (bombAt) {
    const other = bombAt === b ? tb : ta;
    if (other.special === 'bomb') { for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) first.push({ x, y }); }
    else { s.grid[bombAt.y][bombAt.x] = { ...s.grid[bombAt.y][bombAt.x], special: 'none' }; first.push(...blast(s, bombAt, 'bomb', other.color)); }
  }
  s.movesLeft -= 1;
  const steps: CascadeStep[] = [];
  resolve(s, rng, { cells: first, swapped: [a, b] }, steps);
  let reshuffled = false;
  if (!hint(s)) { reshuffle(s, rng); reshuffled = true; }
  if (s.score >= s.target) s.status = 'won';
  else if (s.movesLeft <= 0) s.status = 'lost';
  return { state: s, ok: true, steps, reshuffled };
}
`;

const INDEX = String.raw`// The India games pack: tested rules engines (the board is drawn by the game).
export { createRng, rollDie, shuffle } from './dice';
export type { Rng } from './dice';
export { createLudo, legalMoves, move, pass, target, chooseMove, trackSquare, cellOf, LUDO_COLOURS, START_SQUARE, STAR_SQUARES, DEFAULT_LUDO_RULES, HOME, TRACK, LAST_TRACK, LUDO_TRACK_CELLS } from './ludo';
export type { LudoColour, LudoRules, LudoState, LudoPlayer, MoveResult } from './ludo';
export { createSnakes, takeTurn, squareCell, validateJumps, CLASSIC_JUMPS, DEFAULT_SNAKES_RULES } from './snakes';
export type { SnakesRules, SnakesState, SnakesTurn } from './snakes';
export { createChess, parseFen, toFen, legalMoves as chessMoves, movesFrom, play as playChess, status as chessStatus, inCheck, attacked, perft, evaluate, bestMove, square, squareName, colourOf, START_FEN } from './chess';
export type { ChessState, ChessMove, ChessStatus, Colour, Piece, Cell, Castling, MoveFlag } from './chess';
export { createDeck, shuffleCards, deal, cardName, isRed, SUITS, teenPattiHand, compareTeenPatti, meldType, cardPoints, checkDeclaration, handPoints, bestGrouping } from './cards';
export type { Card, Suit, TeenPattiCategory, TeenPattiHand, MeldType, Declaration } from './cards';
export { createCarrom, placeStriker, strikerFits, shoot, stepPhysics, BOARD as CARROM_BOARD, BASELINE, BASELINE_HALF_LENGTH, COIN_RADIUS, STRIKER_RADIUS, POCKET_RADIUS } from './carrom';
export type { CarromState, Disc, DiscKind, QueenState, ShotResult } from './carrom';
export { createMatch, bowl, summary, runRates, oversText, shotFromTiming } from './cricket';
export type { Match, MatchOptions, Innings, BatterCard, Ball, Dismissal, Extra } from './cricket';
export { createMatch3, swapTiles, hint as match3Hint, findRuns } from './match3';
export type { Match3State, Match3Status, Tile, Special, Cell as Match3Cell, CascadeStep, SwapResult } from './match3';
`;

const FILES: Record<string, string> = {
  [`${BOARD_DIR}/dice.ts`]: DICE,
  [`${BOARD_DIR}/ludo.ts`]: LUDO,
  [`${BOARD_DIR}/snakes.ts`]: SNAKES,
  [`${BOARD_DIR}/chess.ts`]: CHESS,
  [`${BOARD_DIR}/cards.ts`]: CARDS,
  [`${BOARD_DIR}/carrom.ts`]: CARROM,
  [`${BOARD_DIR}/cricket.ts`]: CRICKET,
  [`${BOARD_DIR}/match3.ts`]: MATCH3,
  [`${BOARD_DIR}/index.ts`]: INDEX,
};

export const BOARD_GAME_MODULES: readonly string[] = ['dice', 'ludo', 'snakes', 'chess', 'cards', 'carrom', 'cricket', 'match3'];

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
      `Added the India games pack (${Object.keys(files).length} files under ${BOARD_DIR}): tested rules for Ludo, Snakes & Ladders, chess, carrom, cricket and card games (Teen Patti, rummy), `
      + 'a seeded die, and board geometry for drawing.\n'
      + '```ts\n' + EXAMPLE + '\n```\n'
      + 'RULES: the game\'s rules come from these engines — never re-implement Ludo, Snakes & Ladders, chess or match-3 logic. For match-3, every swap goes through swapTiles(game, a, b): ok false means swap the two back on screen; otherwise animate r.steps in order (cleared, then the fall, chain by chain) and show game.score, game.movesLeft and game.status; a Hint button uses match3Hint(game). For chess, highlight movesFrom(game, square) when a piece is tapped, ask which piece on a promotion, show check, and end the game on chessStatus (checkmate, stalemate and each draw named). For cricket, every ball goes through bowl() (with shotFromTiming for the player\'s tap) and the scoreboard shows summary() and match.innings[match.current].thisOver. For carrom, drag the striker along the baseline (placeStriker), aim and pull back for power, then play shot.frames as the animation and show shot.message. Card games are for FUN: points or pretend chips only — never real money, never a deposit, a wallet top-up or a cash prize (India bans real-money online games). Draw the board from '
      + 'cellOf / squareCell, animate a token along r.path, and say what happened (a capture, a token home, another roll, a pass when '
      + 'nothing can move). Let the player tap the token they want from legalMoves; highlight those tokens. A computer opponent '
      + 'uses chooseMove. House rules are options (rules: { ... }), not new code.',
  };
}
