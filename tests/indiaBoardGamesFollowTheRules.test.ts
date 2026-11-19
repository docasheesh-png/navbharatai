// LUDO AND SNAKES & LADDERS FOLLOW THE RULES A FAMILY EXPECTS (admin 2026-11-19 game-gap audit, P1: the India games
// pack). These run the REAL generated src/game/board/ engines: leaving the yard on a six, sixes rolling again and the
// third one forfeiting, safe squares, captures, the exact finish, the pass when nothing can move, finishing order, and
// the snakes & ladders board with its exact-finish and bounce-back rules.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames, BOARD_GAME_MODULES } from '../src/server/lib/BoardGamesGenerator';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-board-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let L: any; let S: any; let D: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateBoardGames().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  L = await import(join(DIR, 'src/game/board/ludo.ts'));
  S = await import(join(DIR, 'src/game/board/snakes.ts'));
  D = await import(join(DIR, 'src/game/board/dice.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A game with tokens placed by hand: tokens[colour] = progress values. */
function placed(tokens: Record<string, number[]>, turn = 0, rules: any = {}) {
  const g = L.createLudo({ players: Object.keys(tokens), rules });
  g.players.forEach((p: any) => { p.tokens = tokens[p.colour].slice(); });
  g.turn = turn;
  return g;
}

describe('🎲 the die', () => {
  it('is fair and repeatable from a seed', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const rng = D.createRng(42);
    for (let i = 0; i < 60000; i++) counts[D.rollDie(rng) - 1]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
    const a = D.createRng(7), b = D.createRng(7);
    expect([1, 2, 3, 4, 5].map(() => D.rollDie(a))).toEqual([1, 2, 3, 4, 5].map(() => D.rollDie(b)));
    expect(D.shuffle([1, 2, 3, 4, 5], D.createRng(1)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('🔴 Ludo', () => {
  it('a token leaves the yard only on a six, onto its own start square, and the six rolls again', () => {
    const g = L.createLudo({ players: ['red', 'yellow'] });
    for (const roll of [1, 2, 3, 4, 5]) expect(L.legalMoves(g, roll)).toEqual([]);
    const r = L.move(g, 0, 6);
    expect(r.state.players[0].tokens[0]).toBe(0);
    expect(L.trackSquare('red', 0)).toBe(0);
    expect(r.extraTurn).toBe(true);
    expect(r.state.turn).toBe(0);
  });
  it('no legal move passes the turn; a third six in a row forfeits it', () => {
    const g = L.createLudo({ players: ['red', 'yellow'] });
    expect(L.pass(g, 3).state.turn).toBe(1);
    const sixes = placed({ red: [10, -1, -1, -1], yellow: [-1, -1, -1, -1] });
    sixes.sixesInARow = 2;
    expect(L.legalMoves(sixes, 6)).toEqual([]);
    const r = L.pass(sixes, 6);
    expect(r.forfeited).toBe(true);
    expect(r.state.turn).toBe(1);
    expect(r.state.sixesInARow).toBe(0);
  });
  it('landing on an opponent sends it home and earns a roll; a safe square protects it', () => {
    // red at progress 5 (square 5); yellow sits on square 9 (yellow progress (9 - 26 + 52) = 35)
    const g = placed({ red: [5, -1, -1, -1], yellow: [35, -1, -1, -1] });
    const r = L.move(g, 0, 4);
    expect(r.captured).toEqual([{ colour: 'yellow', token: 0 }]);
    expect(r.state.players[1].tokens[0]).toBe(-1);
    expect(r.extraTurn).toBe(true);
    // the star square 8 is safe: yellow at progress 34 = square 8
    const safe = placed({ red: [5, -1, -1, -1], yellow: [34, -1, -1, -1] });
    const s = L.move(safe, 0, 3);
    expect(s.captured).toEqual([]);
    expect(s.state.players[1].tokens[0]).toBe(34);
    expect(s.extraTurn).toBe(false);
  });
  it('tokens in their own home column cannot be captured', () => {
    // yellow's progress 52 is in its home column — no square on the shared track
    const g = placed({ red: [20, -1, -1, -1], yellow: [52, -1, -1, -1] });
    expect(L.trackSquare('yellow', 52)).toBeNull();
    expect(L.move(g, 0, 4).captured).toEqual([]);
  });
  it('home needs the exact number; getting there earns a roll; the path is every square passed', () => {
    const g = placed({ red: [53, -1, -1, -1], yellow: [-1, -1, -1, -1] });
    expect(L.legalMoves(g, 4)).toEqual([]);
    expect(L.legalMoves(g, 3)).toEqual([0]);
    const r = L.move(g, 0, 3);
    expect(r.finished).toBe(true);
    expect(r.extraTurn).toBe(true);
    expect(r.path).toEqual([54, 55, 56]);
    expect(() => L.move(g, 0, 4)).toThrow(/illegal/);
  });
  it('a player who gets all four home ranks first; the last one left ends the game', () => {
    const g = placed({ red: [56, 56, 56, 55], green: [-1, -1, -1, -1], yellow: [10, -1, -1, -1] });
    const r = L.move(g, 3, 1);
    expect(r.won).toBe(true);
    expect(r.state.ranking).toEqual(['red']);
    expect(r.state.over).toBe(false);
    expect(r.state.turn).toBe(1);
    const two = placed({ red: [56, 56, 56, 55], yellow: [10, -1, -1, -1] });
    const end = L.move(two, 3, 1);
    expect(end.state.over).toBe(true);
    expect(end.state.ranking).toEqual(['red', 'yellow']);
    expect(L.legalMoves(end.state, 6)).toEqual([]);
  });
  it('finished players are skipped in the turn order', () => {
    const g = placed({ red: [10, -1, -1, -1], green: [56, 56, 56, 56], yellow: [5, -1, -1, -1] });
    g.players[1].finished = true;
    expect(L.move(g, 0, 2).state.turn).toBe(2);
  });
  it('the computer captures when it can, then goes home, then leaves the yard', () => {
    const cap = placed({ red: [5, 30, -1, -1], yellow: [35, -1, -1, -1] });
    expect(L.chooseMove(cap, 4)).toBe(0);
    const home = placed({ red: [52, 10, -1, -1], yellow: [-1, -1, -1, -1] });
    expect(L.chooseMove(home, 4)).toBe(0);
    const out = placed({ red: [10, -1, -1, -1], yellow: [-1, -1, -1, -1] });
    expect(L.chooseMove(out, 6)).toBe(1);
    expect(L.chooseMove(L.createLudo({ players: ['red', 'blue'] }), 3)).toBeNull();
  });
  it('a full computer-vs-computer game always ends, with every token home and a full ranking', () => {
    for (const seed of [1, 2, 3]) {
      let g = L.createLudo({ players: ['red', 'green', 'yellow', 'blue'] });
      const rng = D.createRng(seed);
      let rolls = 0;
      while (!g.over && rolls++ < 20000) {
        const roll = D.rollDie(rng);
        const t = L.chooseMove(g, roll);
        g = (t === null ? L.pass(g, roll) : L.move(g, t, roll)).state;
      }
      expect(g.over, 'seed ' + seed).toBe(true);
      expect(g.ranking.slice().sort()).toEqual(['blue', 'green', 'red', 'yellow']);
    }
  });
  it('the board geometry: 52 distinct track cells, each colour starts on its arm, home is the centre', () => {
    expect(L.LUDO_TRACK_CELLS).toHaveLength(52);
    expect(new Set(L.LUDO_TRACK_CELLS.map((c: number[]) => c.join(','))).size).toBe(52);
    expect(L.cellOf('red', 0)).toEqual({ col: 1, row: 6 });
    expect(L.cellOf('green', 0)).toEqual({ col: 8, row: 1 });
    expect(L.cellOf('yellow', 0)).toEqual({ col: 13, row: 8 });
    expect(L.cellOf('blue', 0)).toEqual({ col: 6, row: 13 });
    expect(L.cellOf('red', 56)).toEqual({ col: 7, row: 7 });
    expect(L.cellOf('red', 51)).toEqual({ col: 1, row: 7 });
    // the last track square before each home column sits next to that column
    expect(L.cellOf('red', 50)).toEqual({ col: 0, row: 7 });
  });
  it('rejects a game with fewer than two colours', () => {
    expect(() => L.createLudo({ players: ['red'] })).toThrow();
    expect(() => L.createLudo({ players: ['red', 'red'] })).toThrow();
  });
});

describe('🐍 Snakes & Ladders', () => {
  it('ladders carry up, snakes bring down, and the turn passes', () => {
    const g = S.createSnakes({ players: 2 });
    const up = S.takeTurn(g, 1);
    expect(up).toMatchObject({ landed: 1, to: 38, via: 'ladder' });
    expect(up.state.turn).toBe(1);
    const at = { ...g, positions: [12, 0] };
    expect(S.takeTurn(at, 4)).toMatchObject({ landed: 16, to: 6, via: 'snake' });
  });
  it('a six rolls again; an exact roll is needed for 100 (or it bounces back when asked)', () => {
    const g = S.createSnakes({ players: 2 });
    expect(S.takeTurn({ ...g, positions: [30, 0] }, 6).state.turn).toBe(0);
    const near = { ...g, positions: [97, 0] };
    expect(S.takeTurn(near, 5)).toMatchObject({ to: 97, moved: false, won: false });
    expect(S.takeTurn(near, 3)).toMatchObject({ to: 100, won: true });
    const bounce = S.createSnakes({ players: 2, rules: { bounceBack: true } });
    expect(S.takeTurn({ ...bounce, positions: [97, 0] }, 5)).toMatchObject({ landed: 98, to: 78, via: 'snake' });
  });
  it('the winner is final; a broken board is refused', () => {
    const g = S.createSnakes({ players: 2 });
    const won = S.takeTurn({ ...g, positions: [96, 0] }, 4).state;
    expect(won.winner).toBe(0);
    expect(S.takeTurn(won, 3).moved).toBe(false);
    expect(S.validateJumps(S.CLASSIC_JUMPS)).toEqual([]);
    expect(() => S.createSnakes({ jumps: { 10: 20, 20: 5 } })).toThrow(/another jump/);
    expect(() => S.createSnakes({ jumps: { 100: 3 } })).toThrow();
  });
  it('squares zig-zag on the grid: 1 bottom-left, 10 bottom-right, 11 above 10, 100 top-left', () => {
    expect(S.squareCell(1)).toEqual({ col: 0, row: 9 });
    expect(S.squareCell(10)).toEqual({ col: 9, row: 9 });
    expect(S.squareCell(11)).toEqual({ col: 9, row: 8 });
    expect(S.squareCell(100)).toEqual({ col: 0, row: 0 });
  });
});

describe('the recipe', () => {
  it('is registered, and a subset always brings the die', () => {
    expect(GAME_RECIPES.generate_board_games).toBe(generateBoardGames);
    expect(BOARD_GAME_MODULES).toEqual(['dice', 'ludo', 'snakes', 'chess', 'cards']);
    expect(Object.keys(generateBoardGames(['snakes']).files).sort()).toEqual(['src/game/board/dice.ts', 'src/game/board/snakes.ts']);
  });
});
