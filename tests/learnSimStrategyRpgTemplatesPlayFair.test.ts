// 🌱 THE LEARNING, SIM, STRATEGY AND STORY TEMPLATES PLAY FAIR (template round R12). These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-learn-sim-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['count-garden', 'shape-yard', 'tea-stall', 'river-ferry'];
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

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('🌼 Count Garden', () => {
  const C = () => M['count-garden'];
  it('every question has exactly one right answer among different, close, non-negative choices', () => {
    const r = rng(1);
    for (let level = 0; level < C().LEVELS.length; level++) for (let k = 0; k < 60; k++) {
      const q = C().makeQuestion(level, r);
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.options.filter((o: any) => o === q.answer)).toHaveLength(1);
      if (q.kind === 'add') expect(q.answer).toBe(q.a + q.b);
      if (q.kind === 'take') { expect(q.answer).toBe(q.a - q.b); expect(q.answer).toBeGreaterThan(0); }
      if (q.kind === 'more') expect(q.answer).toBe(q.a > q.b ? 'left' : q.a < q.b ? 'right' : 'same');
      for (const o of q.options) if (typeof o === 'number') { expect(o).toBeGreaterThanOrEqual(0); expect(Math.abs(o - (q.answer as number))).toBeLessThanOrEqual(3); }
    }
  });
  it('the level moves up after a run of right answers and back after mistakes, within bounds', () => {
    const o = C().OPTIONS, top = C().LEVELS.length - 1;
    expect(C().adapt(0, o.upAfter, 0)).toBe(1); expect(C().adapt(2, 0, o.downAfter)).toBe(1);
    expect(C().adapt(0, 0, o.downAfter)).toBe(0); expect(C().adapt(top, o.upAfter, 0)).toBe(top);
    expect(C().adapt(2, 1, 1)).toBe(2);
    expect(C().starsFor(true, false)).toBe(2); expect(C().starsFor(false, true)).toBe(1); expect(C().starsFor(false, false)).toBe(0);
  });
  it('number names in both languages, 0 to 20', () => {
    expect(C().NUMBER_NAMES.en).toHaveLength(21); expect(C().NUMBER_NAMES.hi).toHaveLength(21);
    expect(C().NUMBER_NAMES.hi[5]).toBe('पाँच');
  });
});

describe('🔷 Shape Yard', () => {
  const S = () => M['shape-yard'];
  it('every round has exactly one shape that fits, among different choices', () => {
    const r = rng(2);
    for (let n = 0; n < 300; n++) {
      const round = S().makeRound(n % 10, r);
      expect(round.options).toHaveLength(S().OPTIONS.choices);
      expect(new Set(round.options).size).toBe(round.options.length);
      expect(round.options.filter((id: string) => S().fits(S().shapeById(id), round.ask))).toEqual([round.answer]);
      if (round.ask.kind === 'sides') expect(round.ask.sides).toBeGreaterThan(0);
    }
  });
  it('each shape is drawn with as many corners as it has sides', () => {
    for (const s of S().SHAPES) if (s.sides > 0) expect(s.points(50)).toHaveLength(s.sides);
  });
});

describe('🍵 Tea Stall', () => {
  const T = () => M['tea-stall'];
  it('orders always have tea, only the ingredients of that day, and patience that shrinks but never too far', () => {
    const r = rng(3);
    for (let k = 0; k < 200; k++) {
      const d1 = T().makeOrder(1, r); expect(d1.wants).toContain('tea');
      expect(d1.wants).not.toContain('elaichi'); expect(d1.wants).not.toContain('ginger');
      const d5 = T().makeOrder(5, r); expect(d5.patience).toBeGreaterThanOrEqual(10);
    }
    expect(T().makeOrder(1, () => 0.5, ['bench']).patience).toBe(T().makeOrder(1, () => 0.5).patience + 6);
  });
  it('a cup matches only the exact order, in any order of adding', () => {
    const order = { who: '', wants: ['tea', 'milk', 'sugar'], waited: 0, patience: 20 };
    expect(T().matches(['sugar', 'tea', 'milk'], order)).toBe(true);
    expect(T().matches(['tea', 'milk'], order)).toBe(false);
    expect(T().matches(['tea', 'milk', 'sugar', 'ginger'], order)).toBe(false);
  });
  it('a quick serve earns a tip; the kettle adds to every cup; days get busier', () => {
    const fast = { who: '', wants: ['tea', 'milk'], waited: 0, patience: 20 }, slow = { ...fast, waited: 19 };
    expect(T().priceFor(fast)).toBeGreaterThan(T().priceFor(slow));
    expect(T().priceFor(slow, ['kettle'])).toBe(T().priceFor(slow) + 2);
    expect(T().arrivalGap(4)).toBeLessThan(T().arrivalGap(1));
    expect(T().arrivalGap(1, ['sign'])).toBeLessThan(T().arrivalGap(1));
    expect(SRC['tea-stall']).toContain('Play coins only');
    expect(SRC['tea-stall']).not.toMatch(/deposit|withdraw|cash ?out|₹|rupee|upi/i);
  });
});

describe('⛵ River Ferry', () => {
  const F = () => M['river-ferry'];
  it('every puzzle can be solved, and every step of the best solution is allowed and safe', () => {
    for (const p of F().PUZZLES) {
      const path = F().solve(p);
      expect(path, p.en).not.toBeNull();
      expect(path.length).toBeGreaterThan(1);
      let far: string[] = [];
      for (const load of path) { expect(F().problem(p, far, load)).toBeNull(); far = F().cross(far, load); }
      expect(far.length).toBe(p.who.length);
    }
    expect(F().solve(F().PUZZLES[0])).toHaveLength(7);
  });
  it('says why a crossing is not allowed', () => {
    const p = F().PUZZLES[0];
    expect(F().problem(p, [], ['goat'])).toBe('needs');
    expect(F().problem(p, [], ['man', 'goat', 'grass'])).toBe('full');
    expect(F().problem(p, [], ['man', 'grass'])).toBe('unsafe');                 // tiger left with goat
    expect(F().unsafePair(p, ['man', 'grass'])).toEqual(['tiger', 'goat']);
    expect(F().problem(p, [], ['man', 'goat'])).toBeNull();
    expect(F().problem(p, ['man', 'goat'], ['man', 'tiger'])).toBe('needs');       // the tiger is on the other bank
  });
  it('stars follow the fewest crossings', () => {
    expect(F().starsFor(7, 7)).toBe(3); expect(F().starsFor(10, 7)).toBe(2); expect(F().starsFor(20, 7)).toBe(1);
  });
});

describe('✏️ editable by chat', () => {
  it.each(IDS)('%s has named blocks, both languages, and no line too long to edit', (id) => {
    expect(SRC[id]).toMatch(/const COPY = \{/);
    expect(SRC[id]).toContain('खेल खत्म'); expect(SRC[id]).toContain('Play again');
    for (const line of SRC[id].split('\n')) expect(line.length).toBeLessThan(220);
  });
});
