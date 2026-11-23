// 🎲 THE BOARD AND CARD TEMPLATES PLAY BY THE RULES (template round R8). These run the REAL materialised App.tsx of each.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-board-card-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['ladder-path'];
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

describe('✏️ editable by chat', () => {
  for (const id of IDS) it(id + ': named OPTIONS and COPY blocks, no minified line', () => {
    expect(SRC[id]).toContain('export const OPTIONS'); expect(SRC[id]).toContain('const COPY');
    expect(Math.max(...SRC[id].split('\n').map((l) => l.length))).toBeLessThan(220);
  });
});
