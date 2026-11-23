// 🔢 STACK TILES SLIDES LIKE THE REAL PUZZLE (template round R7). These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-stack-tiles-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any; let SRC = '';
beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  SRC = materializeGame(GAME_LIBRARY.find((g) => g.id === 'stack-tiles')!);
  writeFileSync(join(DIR, 'App.tsx'), SRC);
  writeFileSync(join(DIR, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
  M = await import(join(DIR, 'App.tsx'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A board from rows of numbers (0 = empty). */
const B = (rows: number[][]) => {
  const tiles: any[] = []; let id = 1;
  rows.forEach((r, row) => r.forEach((value, col) => { if (value) tiles.push({ id: id++, value, row, col }); }));
  return { size: rows.length, tiles, nextId: id };
};
const rows = (b: any) => {
  const g = Array.from({ length: b.size }, () => Array(b.size).fill(0));
  for (const t of b.tiles) g[t.row][t.col] = t.value;
  return g;
};

describe('🔢 the slide', () => {
  it('slides and joins toward each side', () => {
    const b = B([[2, 2, 4, 0], [0, 0, 0, 2], [4, 0, 4, 4], [0, 0, 0, 0]]);
    expect(rows(M.slide(b, 'left').board)).toEqual([[4, 4, 0, 0], [2, 0, 0, 0], [8, 4, 0, 0], [0, 0, 0, 0]]);
    expect(rows(M.slide(b, 'right').board)).toEqual([[0, 0, 4, 4], [0, 0, 0, 2], [0, 0, 4, 8], [0, 0, 0, 0]]);
    expect(rows(M.slide(b, 'up').board)).toEqual([[2, 2, 8, 2], [4, 0, 0, 4], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(rows(M.slide(b, 'down').board)).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 2], [4, 2, 8, 4]]);
  });
  it('a tile joins only once per move, and the pair nearest the wall joins first', () => {
    expect(rows(M.slide(B([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left').board)[0]).toEqual([4, 4, 0, 0]);
    expect(rows(M.slide(B([[4, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left').board)[0]).toEqual([4, 4, 0, 0]);
    expect(rows(M.slide(B([[2, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'right').board)[0]).toEqual([0, 0, 2, 4]);
  });
  it('counts the score of each join, and says when nothing moved', () => {
    const r = M.slide(B([[2, 2, 8, 8], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
    expect(r.gained).toBe(20); expect(r.moved).toBe(true);
    const still = M.slide(B([[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
    expect(still.moved).toBe(false); expect(still.gained).toBe(0);
  });
  it('moved tiles keep their id (so they glide); joined tiles are new and marked merged (so they pop)', () => {
    const b = B([[0, 0, 0, 2], [0, 0, 0, 0], [4, 4, 0, 0], [0, 0, 0, 0]]);
    const r = M.slide(b, 'left').board;
    const two = r.tiles.find((t: any) => t.value === 2);
    expect(two.id).toBe(b.tiles[0].id); expect(two.col).toBe(0);
    const eight = r.tiles.find((t: any) => t.value === 8);
    expect(eight.merged).toBe(true); expect(eight.id).toBeGreaterThanOrEqual(b.nextId);
  });
});

describe('🎲 new tiles and the end', () => {
  it('a new tile lands on an empty square: a 2, or a 4 about one time in ten', () => {
    let fours = 0;
    for (let i = 0; i < 2000; i++) {
      const b = M.spawn(B([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));
      expect(b.tiles).toHaveLength(2);
      const t = b.tiles[1]; expect(t.row * 4 + t.col).not.toBe(0); expect(t.fresh).toBe(true);
      if (t.value === 4) fours++; else expect(t.value).toBe(2);
    }
    expect(fours / 2000).toBeGreaterThan(0.06); expect(fours / 2000).toBeLessThan(0.14);
  });
  it('stuck only when full and no two neighbours match', () => {
    expect(M.stuck(B([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]))).toBe(true);
    expect(M.stuck(B([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]]))).toBe(false);
    expect(M.stuck(B([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]]))).toBe(false);
  });
  it('works on other board sizes', () => {
    expect(rows(M.slide(B([[2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]), 'left').board)[0]).toEqual([4, 4, 2, 0, 0]);
    expect(M.biggest(B([[2, 64, 0], [0, 0, 0], [8, 0, 0]]))).toBe(64);
  });
});

describe('✏️ editable by chat', () => {
  it('named OPTIONS / TILE_COLORS / COPY, a goal and an undo, no minified line', () => {
    for (const block of ['export const OPTIONS', 'export const TILE_COLORS', 'const COPY']) expect(SRC).toContain(block);
    expect(M.OPTIONS.goal).toBe(2048); expect(M.OPTIONS.undos).toBeGreaterThan(0);
    expect(Math.max(...SRC.split('\n').map((l) => l.length))).toBeLessThan(220);
  });
});
