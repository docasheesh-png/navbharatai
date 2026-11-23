// 🌱 THE LEARNING, SIM, STRATEGY AND STORY TEMPLATES PLAY FAIR (template round R12). These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-learn-sim-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['count-garden', 'shape-yard', 'tea-stall', 'river-ferry', 'seed-row', 'tower-line'];
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

describe('🌰 Seed Row', () => {
  const S = () => M['seed-row'];
  it('sowing keeps every seed, skips the other store, and a last seed in your store gives another turn', () => {
    const b = S().newBoard(), first = S().sow(b, 2, 0);
    expect(S().total(first.board)).toBe(S().total(b));
    expect(first.again).toBe(true); expect(first.board[S().storeOf(0)]).toBe(1);
    const big = S().newBoard(); big[5] = 20;
    const r = S().sow(big, 5, 0);
    expect(r.path).not.toContain(S().storeOf(1)); expect(S().total(r.board)).toBe(S().total(big));
  });
  it('a last seed in an empty pit of yours takes it and the pit across', () => {
    const b = S().newBoard(); b[4] = 0; b[3] = 1;
    const across = b[S().opposite(4)], r = S().sow(b, 3, 0);
    expect(r.captured).toBe(across + 1); expect(r.board[4]).toBe(0); expect(r.board[S().opposite(4)]).toBe(0);
    expect(r.board[S().storeOf(0)]).toBe(across + 1);
  });
  it('when one side runs empty the game ends and the rest is swept to its owner', () => {
    const b = Array(14).fill(0); b[5] = 1; b[8] = 3; b[12] = 2;
    const r = S().sow(b, 5, 0);
    expect(r.over).toBe(true); expect(r.again).toBe(false);
    expect(r.board[S().storeOf(0)]).toBe(1); expect(r.board[S().storeOf(1)]).toBe(5);
    expect(S().pitsOf(1).every((p: number) => r.board[p] === 0)).toBe(true);
  });
  it('the computer always picks a legal pit and takes an open capture', () => {
    const r = rng(9);
    for (let g = 0; g < 20; g++) {
      let b = S().newBoard(), side: 0 | 1 = 0;
      for (let turn = 0; turn < 200; turn++) {
        const legal = S().legal(b, side); if (!legal.length) break;
        const pit = side === 1 ? S().bestMove(b, 1, 2) : legal[Math.floor(r() * legal.length)];
        expect(legal).toContain(pit);
        const res = S().sow(b, pit, side); expect(S().total(res.board)).toBe(48); b = res.board;
        if (res.over) break; if (!res.again) side = side === 0 ? 1 : 0;
      }
    }
    const b = Array(14).fill(0); b[7] = 1; b[8] = 0; b[S().opposite(8)] = 9; b[10] = 2; b[2] = 1;
    expect(S().bestMove(b, 1, 1)).toBe(7);
  });
  it('the look-ahead computer beats a random player most of the time', () => {
    const r = rng(4); let wins = 0;
    for (let g = 0; g < 20; g++) {
      let b = S().newBoard(), side: 0 | 1 = 0;
      for (let turn = 0; turn < 300; turn++) {
        const legal = S().legal(b, side); if (!legal.length) break;
        const res = S().sow(b, side === 1 ? S().bestMove(b, 1, 3) : legal[Math.floor(r() * legal.length)], side); b = res.board;
        if (res.over) break; if (!res.again) side = side === 0 ? 1 : 0;
      }
      if (b[S().storeOf(1)] > b[S().storeOf(0)]) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(16);
  });
});

describe('🏹 Tower Line', () => {
  const T = () => M['tower-line'];
  const field = () => ({ towers: [] as any[], walkers: [] as any[], coins: T().OPTIONS.coins, lives: T().OPTIONS.lives, wave: 0, toSpawn: 0, spawnIn: 0 });
  const runWave = (g: any) => { g.wave++; g.toSpawn = T().waveOf(g.wave).count; g.spawnIn = 0;
    for (let i = 0; i < 20000; i++) { const ev = T().stepWave(g, 0.02); if (ev.cleared || g.lives <= 0) return; } throw new Error('wave never ended'); };
  const spots = () => { const out: [number, number, number][] = []; const o = T().OPTIONS;
    for (let c = 0; c < o.cols; c++) for (let r = 0; r < o.rows; r++) {
      let near = 0; for (let d = 0; d <= T().roadLength(); d += 0.5) { const [x, y] = T().pointAt(d); if (Math.hypot(x - c, y - r) <= 2.4) near++; }
      out.push([c, r, near]);
    } return out.sort((a, b) => b[2] - a[2]); };
  it('the road starts and ends at its corners, and no tower can stand on it', () => {
    expect(T().pointAt(0)).toEqual(T().ROAD[0]); expect(T().pointAt(T().roadLength() + 5)).toEqual(T().ROAD[T().ROAD.length - 1]);
    for (const [x, y] of T().ROAD) expect(T().canBuild(x, y, [])).toBe(false);
    expect(T().canBuild(0, 0, [])).toBe(true); expect(T().canBuild(0, 0, [{ kind: 'arrow', col: 0, row: 0, level: 1, cool: 0 }])).toBe(false);
  });
  it('towers aim at the walker furthest along within range; frost slows; a cannon splashes', () => {
    const tw = { kind: 'arrow', col: 5, row: 2, level: 1, cool: 0 };
    const ws = [4.2, 5, 6, 30].map((d) => ({ hp: 10, max: 10, speed: 1, dist: d, slowFor: 0, reward: 1 }));
    expect(T().target(tw, ws).dist).toBe(6);
    const frost = { ...tw, kind: 'frost' }; T().shoot(frost, ws[1], ws); expect(ws[1].slowFor).toBeGreaterThan(0);
    expect(T().walkerSpeed(ws[1])).toBeLessThan(ws[1].speed);
    const before = ws.map((w) => w.hp); T().shoot({ ...tw, kind: 'cannon' }, ws[1], ws);
    expect(ws[0].hp).toBeLessThan(before[0]); expect(ws[2].hp).toBeLessThan(before[2]); expect(ws[3].hp).toBe(before[3]);
  });
  it('upgrades cost more each level and selling gives back less than was spent', () => {
    const tw = { kind: 'cannon', col: 0, row: 0, level: 1, cool: 0 };
    expect(T().upgradeCost({ ...tw, level: 2 })).toBeGreaterThan(T().upgradeCost(tw));
    expect(T().statsOf({ ...tw, level: 3 }).damage).toBeGreaterThan(T().statsOf(tw).damage);
    expect(T().sellValue({ ...tw, level: 2 })).toBeLessThan(T().TOWERS.cannon.cost + T().upgradeCost(tw));
    for (let n = 2; n <= T().WAVE_COUNT; n++) expect(T().waveOf(n).hp * T().waveOf(n).count).toBeGreaterThan(T().waveOf(n - 1).hp * T().waveOf(n - 1).count);
  });
  it('with no towers the gate falls early, but a sensible builder holds all ten waves', () => {
    const empty = field(); let w = 0; while (empty.lives > 0 && w < 10) { runWave(empty); w++; }
    expect(empty.lives).toBeLessThanOrEqual(0); expect(w).toBeLessThanOrEqual(3);
    const g = field(), order = ['arrow', 'arrow', 'cannon', 'frost', 'cannon', 'arrow'];
    const good = spots();
    for (let n = 0; n < T().WAVE_COUNT; n++) {
      for (let guard = 0; guard < 20; guard++) {
        const kind = order[g.towers.length % order.length], spot = good.find(([c, r]) => T().canBuild(c, r, g.towers));
        if (spot && g.coins >= T().TOWERS[kind].cost && g.towers.length < 12) { g.towers.push({ kind, col: spot[0], row: spot[1], level: 1, cool: 0 }); g.coins -= T().TOWERS[kind].cost; continue; }
        const up = g.towers.filter((t: any) => t.level < 3).sort((a: any, b: any) => a.level - b.level)[0];
        if (up && g.coins >= T().upgradeCost(up)) { g.coins -= T().upgradeCost(up); up.level++; continue; }
        break;
      }
      runWave(g);
      expect(g.lives).toBeGreaterThan(0);
    }
  });
});

describe('✏️ editable by chat', () => {
  it.each(IDS)('%s has named blocks, both languages, and no line too long to edit', (id) => {
    expect(SRC[id]).toMatch(/const COPY = \{/);
    expect(SRC[id]).toContain('खेल खत्म'); expect(SRC[id]).toContain('Play again');
    for (const line of SRC[id].split('\n')) expect(line.length).toBeLessThan(220);
  });
});
