// MATCH-3 (admin 2026-11-20 game-gap audit: every match-3 was hand-written, and the same faults came back — a board that
// starts with matches on it, a board with no move left and no reshuffle, cascades that leave holes, a swap that "works"
// without a match). These run the REAL generated src/game/board/match3.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-match3-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateBoardGames(['match3']).files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  M = await import(join(DIR, 'src/game/board/match3.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A board from letters: each letter a colour, '.' an unused colour pattern that never matches. */
function board(rows: string[], extra: any = {}): any {
  const s = M.createMatch3({ width: rows[0].length, height: rows.length, colors: 6, seed: 1, ...extra });
  let id = 1000;
  s.grid = rows.map((r) => [...r].map((ch) => ({ color: ch.charCodeAt(0) - 97, special: 'none', id: id++ })));
  return s;
}
const full = (s: any) => s.grid.every((row: any[]) => row.every((t) => t.color >= 0 && t.color < s.colors));

describe('a fair board', () => {
  it('50 seeds: never starts with a match, always has a move', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = M.createMatch3({ seed });
      expect(M.findRuns(g), `seed ${seed}`).toEqual([]);
      expect(M.hint(g), `seed ${seed}`).not.toBeNull();
      expect(full(g)).toBe(true);
    }
  });

  it('a swap with no match is refused and changes nothing; only neighbours swap', () => {
    const g = board(['abab', 'baba', 'abab', 'baba']);
    const r = M.swapTiles(g, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(r.ok).toBe(false);
    expect(r.state).toBe(g);
    expect(M.swapTiles(g, { x: 0, y: 0 }, { x: 2, y: 0 }).reason).toMatch(/neighbouring/);
  });

  it('a match clears, tiles fall, the board refills with no holes, and a move is spent', () => {
    const g = board(['aabc', 'cdae', 'efcd', 'dcef']);
    const r = M.swapTiles(g, { x: 2, y: 1 }, { x: 2, y: 0 });   // the 'a' from below completes a-a-a on top
    expect(r.ok).toBe(true);
    expect(r.steps[0].cleared.length).toBeGreaterThanOrEqual(3);
    expect(r.state.score).toBeGreaterThan(0);
    expect(r.state.movesLeft).toBe(g.movesLeft - 1);
    expect(full(r.state)).toBe(true);
    expect(M.findRuns(r.state)).toEqual([]);   // cascades ran until the board was still
  });

  it('a 100-move random game: every board full, still, and playable; chains score more', () => {
    let g = M.createMatch3({ seed: 7, moves: 1000, target: 1e9 });
    let chained = false;
    for (let i = 0; i < 100; i++) {
      const h = M.hint(g);
      expect(h).not.toBeNull();
      const r = M.swapTiles(g, h[0], h[1]);
      expect(r.ok).toBe(true);
      for (const st of r.steps) expect(st.points).toBe(st.cleared.length * 10 * st.chain);
      if (r.steps.some((st: any) => st.chain > 1)) chained = true;
      g = r.state;
      expect(full(g)).toBe(true);
      expect(M.findRuns(g)).toEqual([]);
    }
    expect(chained).toBe(true);
  });
});

describe('special tiles', () => {
  it('four in a line makes a line tile; five makes a bomb; an L makes an area tile', () => {
    const four = M.swapTiles(board(['aaba', 'cdae', 'efcd', 'dcef', 'fedc']), { x: 2, y: 1 }, { x: 2, y: 0 });
    expect(four.steps[0].made.map((m: any) => m.special)).toContain('line-v');
    const five = M.swapTiles(board(['aabaa', 'cdaef', 'efcdc', 'dcefe', 'fedcd']), { x: 2, y: 1 }, { x: 2, y: 0 });
    expect(five.steps[0].made.map((m: any) => m.special)).toContain('bomb');
    // An L: column 0 has a, a over the gap and row 2 has a, a beside it; the 'a' below drops into the corner.
    const L = board(['abcde', 'acdef', 'faadc', 'adefb', 'efbcd']);
    const lr = M.swapTiles(L, { x: 0, y: 2 }, { x: 0, y: 3 });
    expect(lr.ok).toBe(true);
    expect(lr.steps[0].made).toEqual([{ x: 0, y: 2, special: 'area' }]);
  });

  it('a line tile clears its whole row when it goes; an area tile clears 3 x 3; a bomb swapped clears that colour', () => {
    const line = board(['abcde', 'bcdea', 'aafbc', 'cdeab', 'deabc']);
    line.grid[2][3].special = 'line-h'; line.grid[2][3].color = 0;   // row 2: a a f a(line) c
    line.grid[1][2].color = 0;                                         // an 'a' above the gap
    const lr = M.swapTiles(line, { x: 2, y: 1 }, { x: 2, y: 2 });     // brings 'a' into row 2: a a a a(line)
    expect(lr.ok).toBe(true);
    // The whole row went: four cleared, and the fifth cell is the NEW line tile this four-in-a-row made, which stays.
    const row2 = lr.steps[0].cleared.filter((c: any) => c.y === 2).length;
    const madeInRow = lr.steps[0].made.filter((m: any) => m.y === 2).length;
    expect(row2 + madeInRow).toBe(5);
    expect(madeInRow).toBe(1);

    const bomb = board(['abcde', 'bcdea', 'cdeab', 'deabc', 'eabcd']);
    bomb.grid[0][0].special = 'bomb';
    const before = bomb.grid.flat().filter((t: any) => t.color === 1).length; // colour 'b' = 1
    const br = M.swapTiles(bomb, { x: 0, y: 0 }, { x: 1, y: 0 });     // bomb swapped with a 'b'
    expect(br.ok).toBe(true);
    expect(br.steps[0].cleared.length).toBeGreaterThanOrEqual(before);

    const area = board(['abcde', 'bcdea', 'aafbc', 'cdeab', 'deabc']);
    area.grid[1][2].color = 0;
    area.grid[2][1].special = 'area';
    const ar = M.swapTiles(area, { x: 2, y: 1 }, { x: 2, y: 2 });
    expect(ar.ok).toBe(true);
    const around = ar.steps[0].cleared.filter((c: any) => Math.abs(c.x - 1) <= 1 && Math.abs(c.y - 2) <= 1).length;
    expect(around).toBe(9);
  });
});

describe('never stuck, always the same course for the same seed', () => {
  it('a board left with no move reshuffles itself into a playable one (never a dead end)', () => {
    // Many small, many-coloured boards end a move stuck; across 30 seeds of 4 x 4 with 8 colours that happens for real.
    let reshuffles = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let s = M.createMatch3({ seed, width: 4, height: 4, colors: 8, moves: 60, target: 1e9 });
      for (let i = 0; i < 60 && s.status === 'playing'; i++) {
        const h = M.hint(s);
        expect(h, 'seed ' + seed + ' move ' + i).not.toBeNull();
        const r = M.swapTiles(s, h[0], h[1]);
        if (r.reshuffled) { reshuffles += 1; expect(M.findRuns(r.state)).toEqual([]); }
        s = r.state;
      }
    }
    expect(reshuffles).toBeGreaterThan(0);
  });

  it('the same seed and the same swaps give the same boards and score', () => {
    const play = () => { let s = M.createMatch3({ seed: 42 }); for (let i = 0; i < 20; i++) { const h = M.hint(s); s = M.swapTiles(s, h[0], h[1]).state; } return s; };
    const a = play(), b = play();
    expect(a.grid.map((r: any[]) => r.map((t) => t.color))).toEqual(b.grid.map((r: any[]) => r.map((t) => t.color)));
    expect(a.score).toBe(b.score);
  });

  it('reaching the target wins; running out of moves loses; a finished game takes no more swaps', () => {
    let s = M.createMatch3({ seed: 5, moves: 3, target: 1e9 });
    for (let i = 0; i < 3; i++) { const h = M.hint(s); s = M.swapTiles(s, h[0], h[1]).state; }
    expect(s.status).toBe('lost');
    expect(M.swapTiles(s, { x: 0, y: 0 }, { x: 1, y: 0 }).ok).toBe(false);
    let w = M.createMatch3({ seed: 5, moves: 50, target: 1 });
    const h = M.hint(w); w = M.swapTiles(w, h[0], h[1]).state;
    expect(w.status).toBe('won');
  });
});

describe('a match-3 request gets the engine', () => {
  it('the seed lays the pack down for match-3 words, and not for other puzzles', () => {
    for (const p of ['match 3 game banao', 'candy crush jaisa game banao', 'ek gems match puzzle game with levels']) {
      expect(gameKitPlan(p), p).toContain('generate_board_games');
    }
    for (const p of ['a sudoku puzzle game', 'jigsaw puzzle game']) expect(gameKitPlan(p), p).not.toContain('generate_board_games');
  });
});
