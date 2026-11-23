// 🌺 GARDEN MATCH MATCHES LIKE A REAL MATCH-3 (template round R7). These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-garden-match-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any; let SRC = '';
beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  SRC = materializeGame(GAME_LIBRARY.find((g) => g.id === 'garden-match')!);
  writeFileSync(join(DIR, 'App.tsx'), SRC);
  writeFileSync(join(DIR, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
  M = await import(join(DIR, 'App.tsx'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A grid from rows of digits; '.' = empty. */
const G = (rows: string[]) => rows.join('').split('').map((ch) => (ch === '.' ? null : { kind: Number(ch) }));

describe('🌺 the board', () => {
  it('a new board never starts with a run and always has a move', () => {
    for (let s = 0; s < 40; s++) {
      const g = M.newGrid(7, 5);
      expect(M.findRuns(g, 7)).toEqual([]);
      expect(M.findMove(g, 7)).not.toBeNull();
    }
  });
  it('finds runs across and down, of any length', () => {
    const g = G(['0001', '2131', '2341', '2000']);
    const runs = M.findRuns(g, 4).map((r: number[]) => r.sort((a, b) => a - b));
    expect(runs).toContainEqual([0, 1, 2]);
    expect(runs).toContainEqual([13, 14, 15]);
    expect(runs).toContainEqual([4, 8, 12]);
    expect(runs).toContainEqual([3, 7, 11]);
  });
});

describe('🔁 the swap', () => {
  it('a swap that makes nothing is refused (it slides back); not neighbours is refused', () => {
    const g = G(['0123', '1230', '2301', '3012']);
    expect(M.swapTiles(g, 4, 0, 1).ok).toBe(false);
    expect(M.swapTiles(g, 4, 0, 5).ok).toBe(false);
    expect(M.swapTiles(g, 4, 3, 4).ok).toBe(false);          // end of one row and start of the next are not neighbours
  });
  it('a good swap clears the run, things fall, new flowers fill the top, and every clear scores 10 × flowers × chain', () => {
    const g = G(['0123', '3012', '2031', '1230']);
    expect(M.findRuns(g, 4)).toEqual([]);
    const r = M.swapTiles(g, 4, 0, 1);
    expect(r.ok).toBe(true);
    expect([...r.steps[0].cleared].sort((a: number, b: number) => a - b)).toEqual([1, 5, 9]);
    expect(r.steps[0].points).toBe(30);
    expect(r.grid.every(Boolean)).toBe(true);
    expect(M.findRuns(r.grid, 4)).toEqual([]);                // the board is still when the move ends
    for (const s of r.steps.filter((x: any) => x.points)) expect(s.points).toBe(s.cleared.length * 10 * s.chain);
    expect(r.points).toBe(r.steps.reduce((a: number, s: any) => a + s.points, 0));
  });
  it('a stuck random source never locks the game', () => {
    const g = G(['0123', '3012', '2031', '1230']);
    const r = M.swapTiles(g, 4, 0, 1, 5, () => 0.5);         // every new flower the same kind → endless chains
    expect(r.ok).toBe(true);
    expect(r.steps.length).toBeLessThan(70);
  });
  it('four in a row leaves a line flower; five leaves a bomb; a bomb swapped clears its partner\'s kind', () => {
    const four = G(['0030', '1201', '2312', '3123']);       // swap (0,2)=3 with (1,2)=0 → 0 0 0 0
    const r4 = M.swapTiles(four, 4, 2, 6);
    expect(r4.ok).toBe(true);
    expect(r4.steps[0].grid[2]).toEqual({ kind: 0, special: 'line' });
    const five = G(['00100', '12021', '21312', '13231', '32123']);
    const r5 = M.swapTiles(five, 5, 2, 7);
    expect(r5.ok).toBe(true);
    expect(r5.steps[0].grid[2]).toEqual({ kind: 0, special: 'bomb' });
    const withBomb = G(['0123', '1230', '2301', '3012']);
    withBomb[5] = { kind: 2, special: 'bomb' };
    const rb = M.swapTiles(withBomb, 4, 5, 6);
    expect(rb.ok).toBe(true);
    const kindOfPartner = 3;
    const cleared = new Set(rb.steps[0].cleared);
    withBomb.forEach((t: any, i: number) => { if (t && t.kind === kindOfPartner && i !== 6) expect(cleared.has(i)).toBe(true); });
  });
  it('the level goal grows', () => {
    expect(M.targetFor(1)).toBe(M.OPTIONS.target);
    expect(M.targetFor(3)).toBe(M.OPTIONS.target * 2);
  });
});

describe('✏️ editable by chat', () => {
  it('named OPTIONS / FLOWERS / COPY, no minified line', () => {
    for (const block of ['export const OPTIONS', 'export const FLOWERS', 'const COPY']) expect(SRC).toContain(block);
    expect(Math.max(...SRC.split('\n').map((l) => l.length))).toBeLessThan(220);
  });
});
