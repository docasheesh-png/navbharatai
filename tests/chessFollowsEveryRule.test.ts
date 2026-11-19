// CHESS FOLLOWS EVERY RULE (admin 2026-11-19 game-gap audit, India games pack b). These run the REAL generated
// src/game/board/chess.ts: the move generator matches the published perft counts on five standard positions (the test
// every chess engine is held to — a single castling, en passant or promotion bug changes the totals), and each rule a
// casual implementation gets wrong is checked by name.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames, BOARD_GAME_MODULES } from '../src/server/lib/BoardGamesGenerator';

const DIR = join(__dirname, `.tmp-chess-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateBoardGames().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  C = await import(join(DIR, 'src/game/board/chess.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const sans = (g: any) => C.legalMoves(g).map((m: any) => m.san).sort();
const line = (moves: string[], fen?: string) => moves.reduce((g, m) => C.play(g, m), C.createChess(fen));

describe('🔴 perft — the move generator, counted', () => {
  it.each([
    ['the starting position', C_START(), [20, 400, 8902]],
    ['Kiwipete (castling, pins, en passant)', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['position 3 (en passant discovered checks)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['position 4 (promotions, castling rights)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ])('%s', (_name, fen, counts) => {
    const g = C.createChess(fen as string);
    expect((counts as number[]).map((_, i) => C.perft(g, i + 1))).toEqual(counts);
  }, 120_000);
});

function C_START() { return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; }

describe('the rules a casual version gets wrong', () => {
  it('castling: both sides when clear; never out of, through or into check; lost once the king or rook moves', () => {
    const open = C.createChess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(sans(open)).toEqual(expect.arrayContaining(['O-O', 'O-O-O']));
    const castled = C.play(open, 'O-O');
    expect(castled.board[C.square('g1')]).toBe('K');
    expect(castled.board[C.square('f1')]).toBe('R');
    expect(castled.castling).toMatchObject({ K: false, Q: false, k: true, q: true });
    expect(sans(C.createChess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'))).toContain('O-O');
    expect(sans(C.createChess('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'.replace('4k3', '4r1k1')))).not.toContain('O-O');   // in check
    expect(sans(C.createChess('5rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1'))).not.toContain('O-O');                        // through f1
    expect(sans(C.createChess('6rk/8/8/8/8/8/8/R3K2R w KQ - 0 1'))).not.toContain('O-O');                         // into g1
    const moved = line(['Ra2', 'Kd7', 'Ra1', 'Ke8'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(sans(moved)).not.toContain('O-O-O');
    expect(sans(moved)).toContain('O-O');
  });
  it('en passant: only right after the double step, and it removes the passed pawn', () => {
    const g = line(['e4', 'a6', 'e5', 'd5']);
    expect(sans(g)).toContain('exd6');
    const taken = C.play(g, 'exd6');
    expect(taken.board[C.square('d5')]).toBe('');
    expect(taken.board[C.square('d6')]).toBe('P');
    const late = line(['e4', 'a6', 'e5', 'd5', 'Nf3', 'h6']);
    expect(sans(late)).not.toContain('exd6');
  });
  it('promotion: four choices, written e8=Q; a queen by default when tapped', () => {
    const g = C.createChess('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    expect(sans(g).filter((s: string) => s.startsWith('e8'))).toEqual(['e8=B', 'e8=N', 'e8=Q', 'e8=R']);
    expect(sans(C.createChess('k7/4P3/8/8/8/8/8/4K3 w - - 0 1'))).toEqual(expect.arrayContaining(['e8=Q+', 'e8=R+', 'e8=B', 'e8=N']));   // along the back rank

    expect(C.play(g, { from: 'e7', to: 'e8' }).board[C.square('e8')]).toBe('Q');
    expect(C.play(g, { from: 'e7', to: 'e8', promotion: 'n' }).board[C.square('e8')]).toBe('N');
  });
  it('a pinned piece cannot move off the line; a king cannot step into check', () => {
    const pinned = C.createChess('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(C.movesFrom(pinned, 'e2')).toEqual([]);
    const king = C.createChess('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1');
    expect(C.movesFrom(king, 'e1').map((m: any) => m.san).sort()).toEqual(['Kf1', 'Kxd2']);
  });
  it('SAN disambiguates two knights and marks check and mate', () => {
    const g = C.createChess('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1');   // both knights reach d2
    expect(sans(g)).toEqual(expect.arrayContaining(['Nbd2', 'Nfd2', 'Na3']));
    expect(() => C.play(C.createChess(), 'e5')).toThrow(/illegal/);
    const mate = line(['f3', 'e5', 'g4']);
    expect(sans(mate)).toContain('Qh4#');
  });
});

describe('how a game ends', () => {
  it("checkmate (fool's mate) and stalemate", () => {
    expect(C.status(line(['f3', 'e5', 'g4', 'Qh4']))).toBe('checkmate');
    expect(C.status(C.createChess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe('stalemate');
    expect(C.status(C.createChess())).toBe('playing');
  });
  it('draws: insufficient material, the fifty-move rule, threefold repetition', () => {
    expect(C.status(C.createChess('8/8/4k3/8/8/3K4/8/8 w - - 0 1'))).toBe('draw-material');
    expect(C.status(C.createChess('8/8/4k3/8/8/3KN3/8/8 w - - 0 1'))).toBe('draw-material');
    expect(C.status(C.createChess('8/8/4k3/8/8/3KR3/8/8 w - - 0 1'))).toBe('playing');
    expect(C.status(C.createChess('8/8/4k3/8/8/3KR3/8/8 w - - 100 80'))).toBe('draw-fifty');
    const rep = line(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
    expect(C.status(rep)).toBe('draw-repetition');
  });
  it('FEN round-trips, and a position without both kings is refused', () => {
    for (const fen of [C_START(), 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1']) expect(C.toFen(C.createChess(fen))).toBe(fen);
    expect(C.toFen(line(['e4']))).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(() => C.createChess('8/8/8/8/8/8/8/K7 w - - 0 1')).toThrow(/king/);
  });
});

describe('🤖 the computer player', () => {
  it('takes a free queen, finds mate in one, and never returns an illegal move', () => {
    const free = C.createChess('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1');
    expect(C.bestMove(free, 1).san).toBe('Qxd5');
    const mateIn1 = C.createChess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(C.bestMove(mateIn1, 2).san).toBe('Ra8#');
    let g = C.createChess();
    for (let i = 0; i < 16 && C.status(g) === 'playing'; i++) {
      const m = C.bestMove(g, 2);
      expect(C.legalMoves(g).some((x: any) => x.san === m.san)).toBe(true);
      g = C.play(g, m);
    }
    expect(C.bestMove(line(['f3', 'e5', 'g4', 'Qh4']), 2)).toBeNull();
  });
  it('is part of the pack', () => {
    expect(BOARD_GAME_MODULES).toContain('chess');
    expect(Object.keys(generateBoardGames(['chess']).files).sort()).toEqual(['src/game/board/chess.ts', 'src/game/board/dice.ts']);
  });
});
