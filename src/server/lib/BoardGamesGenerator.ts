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

const INDEX = String.raw`// The India games pack: tested rules engines (the board is drawn by the game).
export { createRng, rollDie, shuffle } from './dice';
export type { Rng } from './dice';
export { createLudo, legalMoves, move, pass, target, chooseMove, trackSquare, cellOf, LUDO_COLOURS, START_SQUARE, STAR_SQUARES, DEFAULT_LUDO_RULES, HOME, TRACK, LAST_TRACK, LUDO_TRACK_CELLS } from './ludo';
export type { LudoColour, LudoRules, LudoState, LudoPlayer, MoveResult } from './ludo';
export { createSnakes, takeTurn, squareCell, validateJumps, CLASSIC_JUMPS, DEFAULT_SNAKES_RULES } from './snakes';
export type { SnakesRules, SnakesState, SnakesTurn } from './snakes';
export { createChess, parseFen, toFen, legalMoves as chessMoves, movesFrom, play as playChess, status as chessStatus, inCheck, attacked, perft, evaluate, bestMove, square, squareName, colourOf, START_FEN } from './chess';
export type { ChessState, ChessMove, ChessStatus, Colour, Piece, Cell, Castling, MoveFlag } from './chess';
`;

const FILES: Record<string, string> = {
  [`${BOARD_DIR}/dice.ts`]: DICE,
  [`${BOARD_DIR}/ludo.ts`]: LUDO,
  [`${BOARD_DIR}/snakes.ts`]: SNAKES,
  [`${BOARD_DIR}/chess.ts`]: CHESS,
  [`${BOARD_DIR}/index.ts`]: INDEX,
};

export const BOARD_GAME_MODULES: readonly string[] = ['dice', 'ludo', 'snakes', 'chess'];

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
      `Added the India games pack (${Object.keys(files).length} files under ${BOARD_DIR}): tested rules for Ludo, Snakes & Ladders and chess, `
      + 'a seeded die, and board geometry for drawing.\n'
      + '```ts\n' + EXAMPLE + '\n```\n'
      + 'RULES: the game\'s rules come from these engines — never re-implement Ludo, Snakes & Ladders or chess logic. For chess, highlight movesFrom(game, square) when a piece is tapped, ask which piece on a promotion, show check, and end the game on chessStatus (checkmate, stalemate and each draw named). Draw the board from '
      + 'cellOf / squareCell, animate a token along r.path, and say what happened (a capture, a token home, another roll, a pass when '
      + 'nothing can move). Let the player tap the token they want from legalMoves; highlight those tokens. A computer opponent '
      + 'uses chooseMove. House rules are options (rules: { ... }), not new code.',
  };
}
