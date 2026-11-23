// 🌸 TAP BLOOM TIMES LIKE A REAL TAP GAME (template round R7). It was a stub "gap screen"; these run the REAL App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-tap-bloom-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any; let SRC = '';
beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  SRC = materializeGame(GAME_LIBRARY.find((g) => g.id === 'tap-bloom')!);
  writeFileSync(join(DIR, 'App.tsx'), SRC);
  writeFileSync(join(DIR, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
  M = await import(join(DIR, 'App.tsx'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const withPlot = (plot: any, i = 0) => { const g = M.newGarden(); g.plots[i] = plot; return g; };
const run = (g: any, seconds: number, r = () => 0.5) => { let w: number[] = []; for (let k = 0; k < seconds * 50; k++) { const x = M.grow(g, 0.02, r); g = x.garden; w = w.concat(x.wilted); } return { g, w }; };

describe('🌸 the bloom window', () => {
  it('a bud cannot be picked; a bloom can; a bloom left too long wilts and costs a life', () => {
    const O = M.OPTIONS;
    const bud = withPlot({ kind: 'flower', age: 0, life: O.bloomSeconds });
    expect(M.tapPlot(bud, 0).result).toBe('early');
    const bloom = withPlot({ kind: 'flower', age: O.budSeconds + 0.1, life: O.bloomSeconds });
    const r = M.tapPlot(bloom, 0);
    expect(r.result).toBe('picked'); expect(r.garden.score).toBe(10); expect(r.garden.plots[0]).toBeNull();
    const late = withPlot({ kind: 'flower', age: O.budSeconds + O.bloomSeconds - 0.01, life: O.bloomSeconds });
    const after = M.grow(late, 0.05, () => 0.99);
    expect(after.wilted).toEqual([0]); expect(after.garden.lives).toBe(O.lives - 1); expect(after.garden.plots[0]).toBeNull();
  });
  it('a golden flower is worth five; a bee stings when tapped and flies off harmlessly when left', () => {
    const O = M.OPTIONS;
    expect(M.tapPlot(withPlot({ kind: 'golden', age: O.budSeconds + 0.1, life: 1 }), 0).garden.score).toBe(50);
    const bee = withPlot({ kind: 'bee', age: 0.1, life: 1 });
    const s = M.tapPlot(bee, 0); expect(s.result).toBe('stung'); expect(s.garden.lives).toBe(O.lives - 1);
    const left = M.grow(withPlot({ kind: 'bee', age: O.budSeconds + 0.99, life: 1 }), 0.05, () => 0.99);
    expect(left.wilted).toEqual([]); expect(left.garden.lives).toBe(O.lives);
  });
  it('picks in a row build a combo; a wilt resets it', () => {
    const O = M.OPTIONS; let g = M.newGarden();
    for (let k = 0; k < 3; k++) { g.plots[k] = { kind: 'flower', age: O.budSeconds + 0.1, life: 1 }; g = M.tapPlot(g, k).garden; }
    expect(g.combo).toBe(3); expect(g.score).toBe(10 + 20 + 30);
    g.plots[5] = { kind: 'flower', age: O.budSeconds + 0.999, life: 1 };
    expect(M.grow(g, 0.05, () => 0.99).garden.combo).toBe(0);
  });
});

describe('🌱 the garden', () => {
  it('buds keep appearing on free plots only; the kind follows the chances', () => {
    const { g } = run(M.newGarden(), 3, () => 0.5);
    expect(g.plots.filter(Boolean).length).toBeGreaterThan(0);
    const bee = M.grow({ ...M.newGarden(), untilNext: 0 }, 0.01, () => 0.01).garden.plots.find(Boolean);
    expect(bee.kind).toBe('bee');
    const gold = M.grow({ ...M.newGarden(), untilNext: 0 }, 0.01, () => M.OPTIONS.beeChance + 0.01).garden.plots.find(Boolean);
    expect(gold.kind).toBe('golden');
  });
  it('the pace rises with the level and the game ends when the lives are gone', () => {
    expect(M.pace(3)).toBeLessThan(M.pace(1));
    let g = M.newGarden();
    for (let k = 0; k < M.OPTIONS.perLevel; k++) { g.plots[0] = { kind: 'flower', age: M.OPTIONS.budSeconds + 0.1, life: 1 }; g = M.tapPlot(g, 0).garden; }
    expect(g.level).toBe(2);
    const { g: end } = run(M.newGarden(), 60, () => 0.5);
    expect(end.over).toBe(true); expect(end.lives).toBe(0);
    expect(M.tapPlot(end, 0).result).toBe('empty');
  });
});

describe('✏️ editable by chat', () => {
  it('named OPTIONS / LOOKS / COPY, no minified line, no gap-screen leftovers', () => {
    for (const block of ['export const OPTIONS', 'export const LOOKS', 'const COPY']) expect(SRC).toContain(block);
    expect(SRC).not.toContain('const KIND =');
    expect(Math.max(...SRC.split('\n').map((l) => l.length))).toBeLessThan(220);
  });
});
