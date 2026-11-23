// 🎲 THE BOARD AND CARD TEMPLATES PLAY BY THE RULES (template round R8). These run the REAL materialised App.tsx of each.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-board-card-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['ladder-path', 'courtyard'];
beforeAll(async () => {
  for (const id of IDS) {
    const dir = join(DIR, id); mkdirSync(dir, { recursive: true });
    SRC[id] = materializeGame(GAME_LIBRARY.find((g) => g.id === id)!);
    writeFileSync(join(dir, 'App.tsx'), SRC[id]);
    writeFileSync(join(dir, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
    M[id] = await import(join(dir, 'App.tsx'));
  }
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('🪜 Ladder Path', () => {
  const L = () => M['ladder-path'];
  it('the board is a real one: every jump is on the board and none lands on another', () => {
    expect(L().checkJumps(L().JUMPS)).toEqual([]);
    expect(L().checkJumps({ 5: 5, 10: 120, 20: 30, 30: 2 })).toHaveLength(4);
  });
  it('the squares snake: 1 bottom-left, 10 bottom-right, 11 above 10, 100 top-left', () => {
    expect(L().cellOf(1)).toEqual({ row: 9, col: 0 });
    expect(L().cellOf(10)).toEqual({ row: 9, col: 9 });
    expect(L().cellOf(11)).toEqual({ row: 8, col: 9 });
    expect(L().cellOf(100)).toEqual({ row: 0, col: 0 });
  });
  it('a token hops square by square, then climbs a ladder or slides down a snake', () => {
    const up = L().takeTurn(1, 3);
    expect(up.path).toEqual([2, 3, 4]); expect(up.via).toBe('ladder'); expect(up.to).toBe(L().JUMPS[4]);
    const down = L().takeTurn(10, 6);
    expect(down.via).toBe('snake'); expect(down.to).toBe(L().JUMPS[16]);
    expect(L().takeTurn(2, 1).via).toBeNull();
  });
  it('a six rolls again (unless it wins); house rules change the finish', () => {
    expect(L().takeTurn(2, 6).again).toBe(true);
    expect(L().takeTurn(2, 5).again).toBe(false);
    const o = L().OPTIONS;
    expect(L().takeTurn(97, 5, o).to).toBe(97);                                     // exact finish: too far, stay
    expect(L().takeTurn(97, 3, o).won).toBe(true);
    expect(L().takeTurn(97, 5, { ...o, bounceBack: true }).landed).toBe(98);          // 98 99 100 99 98
    expect(L().takeTurn(97, 5, { ...o, exactFinish: false }).won).toBe(true);
    expect(L().takeTurn(94, 6, { ...o, exactFinish: false }).again).toBe(false);
  });
});

describe('🏯 Courtyard', () => {
  const C = () => M.courtyard;
  it('the courtyard has 24 squares round the edge, each side starts half way round from the other', () => {
    expect(C().LOOP).toBe(24);
    expect((C().START[1] - C().START[0] + 24) % 24).toBe(12);
    const cells = new Set(Array.from({ length: 24 }, (_, k) => String(C().cellOf(0, k + 1))));
    expect(cells.size).toBe(24);
    expect(C().cellOf(0, C().HOME)).toEqual([3, 3]); expect(C().cellOf(1, C().HOME)).toEqual([3, 3]);
    expect(C().cellOf(0, 0)).toBeNull();
  });
  it('a token comes out only on a six; exact roll to get home', () => {
    const tk = [[0, 0, 0], [0, 0, 0]];
    expect(C().legalMoves(tk, 0, 5)).toEqual([]);
    expect(C().legalMoves(tk, 0, 6)).toEqual([0, 1, 2]);
    const near = [[C().HOME - 2, 0, 0], [0, 0, 0]];
    expect(C().legalMoves(near, 0, 3)).toEqual([]);
    const r = C().moveToken(near, 0, 0, 2);
    expect(r.home).toBe(true); expect(r.again).toBe(true);
  });
  it('landing on a rival sends it back to the yard and rolls again; not on a starred square', () => {
    // side 0 at progress 3 (loop square 2); side 1 at loop square 5 = its progress (5 - 12 + 24) % 24 + 1 = 18
    const tk = [[3, 0, 0], [18, 0, 0]];
    expect(C().loopSquare(1, 18)).toBe(5);
    const r = C().moveToken(tk, 0, 0, 3);
    expect(r.captured).toBe(true); expect(r.tokens[1][0]).toBe(0); expect(r.again).toBe(true);
    const safe = [[4, 0, 0], [19, 0, 0]];                                      // loop square 6 is starred
    expect(C().loopSquare(1, 19)).toBe(6);
    expect(C().moveToken(safe, 0, 0, 3).captured).toBe(false);
  });
  it('all tokens home wins', () => {
    const H = C().HOME;
    const r = C().moveToken([[H, H, H - 1], [0, 0, 0]], 0, 2, 1);
    expect(r.won).toBe(true); expect(r.again).toBe(false);
  });
  it('the computer captures when it can, and brings a token out on a six', () => {
    const tk = [[18, 0, 0], [3, 0, 0]];                                        // side 0 token at loop 17; side 1 at loop 14
    expect(C().loopSquare(0, 18)).toBe(17); expect(C().loopSquare(1, 3)).toBe(14);
    // side 1 rolls 3: token 0 from loop 14 to 17 captures
    expect(C().chooseMove(tk, 1, 3)).toBe(0);
    expect(C().chooseMove([[5, 0, 0], [0, 0, 0]], 1, 6)).toBe(0);
    expect(C().chooseMove([[0, 0, 0], [0, 0, 0]], 1, 4)).toBeNull();
  });
  it('a smart computer beats a random one most of the time', () => {
    const o = C().OPTIONS; let smart = 0;
    for (let g = 0; g < 60; g++) {
      let tk = [[0, 0, 0], [0, 0, 0]], side = g % 2, turns = 0;
      for (;;) {
        const roll = 1 + Math.floor(Math.random() * 6);
        const pick = C().chooseMove(tk, side, roll, { ...o, smartComputer: side === 0 });
        if (pick === null) { side = 1 - side; continue; }
        const r = C().moveToken(tk, side, pick, roll, o); tk = r.tokens;
        if (r.won) { if (side === 0) smart++; break; }
        if (!r.again) side = 1 - side;
        if (++turns > 5000) break;
      }
    }
    expect(smart).toBeGreaterThan(33);
  });
});

describe('✏️ editable by chat', () => {
  for (const id of IDS) it(id + ': named OPTIONS and COPY blocks, no minified line', () => {
    expect(SRC[id]).toContain('export const OPTIONS'); expect(SRC[id]).toContain('const COPY');
    expect(Math.max(...SRC[id].split('\n').map((l) => l.length))).toBeLessThan(220);
  });
});
