// 🧭 TRAIL WALK IS A REAL OPEN WORLD (template round R6). The library's open-world screen was a 5×5 grid of three dots; it
// is now a seeded map to explore on foot. These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-trail-walk-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any; let SRC = '';
beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  SRC = materializeGame(GAME_LIBRARY.find((g) => g.id === 'trail-walk')!);
  writeFileSync(join(DIR, 'App.tsx'), SRC);
  writeFileSync(join(DIR, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
  M = await import(join(DIR, 'App.tsx'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('🗺️ the world', () => {
  it('the same seed makes the same world; another seed a different one', () => {
    expect(M.generateWorld(7).tiles).toEqual(M.generateWorld(7).tiles);
    expect(M.generateWorld(7).tiles).not.toEqual(M.generateWorld(8).tiles);
  });
  for (const seed of [1, 2, 3, 42, 99, 12345]) for (const [size, relics] of [[40, 6], [56, 10], [72, 14]]) {
    it(`seed ${seed}, ${size}×${size}: every relic can be reached on foot from the start, and none sits on water or in a tree`, () => {
      const w = M.generateWorld(seed, size, relics);
      expect(w.relics).toHaveLength(relics);
      const reach = M.reachable(w, w.start);
      for (const r of w.relics) {
        expect(reach.has(r.y * w.size + r.x), `relic ${r.x},${r.y}`).toBe(true);
        expect(M.BLOCKED.has(M.tileAt(w, r.x, r.y))).toBe(false);
      }
      expect(M.walkable(w, w.start.x, w.start.y)).toBe(true);
      // There is a world to explore: water, woods and open ground all appear.
      const kinds = new Set(w.tiles);
      for (const k of ['grass', 'tree', 'path']) expect(kinds.has(k)).toBe(true);
    });
  }
  it('the border is closed, so nobody walks off the map', () => {
    const w = M.generateWorld(5);
    for (let i = 0; i < w.size; i++) {
      expect(M.walkable(w, i, 0)).toBe(false); expect(M.walkable(w, 0, i)).toBe(false);
      expect(M.walkable(w, i, w.size - 1)).toBe(false); expect(M.walkable(w, -1, i)).toBe(false);
    }
  });
});

describe('🚶 the walker', () => {
  const open = (tile: string, size = 10) => ({ size, tiles: Array(size * size).fill(tile), start: { x: 5, y: 5 }, relics: [] });
  it('walks at walkSpeed on grass and faster on a path', () => {
    const g = M.stepWalker({ x: 5, y: 5, facing: 0 }, { x: 1, y: 0 }, open('grass'), 0.1);
    const p = M.stepWalker({ x: 5, y: 5, facing: 0 }, { x: 1, y: 0 }, open('path'), 0.1);
    expect(g.x - 5).toBeCloseTo(M.OPTIONS.walkSpeed * 0.1, 6);
    expect(p.x - 5).toBeCloseTo(M.OPTIONS.walkSpeed * M.OPTIONS.pathBonus * 0.1, 6);
  });
  it('a diagonal is no faster than a straight line', () => {
    const d = M.stepWalker({ x: 5, y: 5, facing: 0 }, { x: 1, y: 1 }, open('grass'), 0.1);
    expect(Math.hypot(d.x - 5, d.y - 5)).toBeCloseTo(M.OPTIONS.walkSpeed * 0.1, 6);
  });
  it('never walks into water or a tree, and slides along a wall', () => {
    const w = open('grass'); for (let y = 0; y < 10; y++) w.tiles[y * 10 + 6] = 'water';
    let p = { x: 5.5, y: 5, facing: 0 };
    for (let i = 0; i < 60; i++) p = M.stepWalker(p, { x: 1, y: 0.5 }, w, 1 / 30);
    expect(p.x).toBeLessThan(6 - 0.29);
    expect(p.y).toBeGreaterThan(5.5);                    // it slid down the shore instead of sticking
  });
  it('the compass points at the nearest relic', () => {
    const n = M.nearestRelic({ x: 5, y: 5 }, [{ x: 9, y: 4 }, { x: 4, y: 0 }]);
    expect(n.relic).toEqual({ x: 9, y: 4 });
    expect(n.angle).toBeCloseTo(Math.atan2(-0.5, 4.5), 6);
    expect(M.nearestRelic({ x: 0, y: 0 }, [])).toBeNull();
  });
  it('the day turns to night', () => {
    expect(M.daylight(0)).toBe(1);
    expect(M.daylight(0.5)).toBe(1);
    expect(M.daylight(1)).toBeCloseTo(0.45, 6);
  });
});

describe('✏️ editable by chat', () => {
  it('named OPTIONS / TILES / COPY blocks, no minified line, no placeholder left', () => {
    for (const block of ['export const OPTIONS', 'export const TILE_COLORS', 'export const BLOCKED', 'const COPY']) expect(SRC).toContain(block);
    expect(Math.max(...SRC.split('\n').map((l) => l.length))).toBeLessThan(220);
    expect(SRC).not.toMatch(/__TITLE__|__ACCENT__/);
  });
});
