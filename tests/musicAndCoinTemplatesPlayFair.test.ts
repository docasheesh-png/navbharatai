// 🥁 THE MUSIC AND PLAY-COIN TEMPLATES PLAY FAIR (template round R11). These run the REAL materialised App.tsx of each.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-music-coins-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['coin-wheel', 'coin-dice', 'beat-steps', 'drum-row'];
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

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('🎡 Coin Wheel', () => {
  const W = () => M['coin-wheel'];
  it('the spin lands on the slice it picked, from any starting angle, after whole turns', () => {
    const n = W().SEGMENTS.length;
    for (let i = 0; i < n; i++) for (const from of [0, 1.3, -7, 40]) {
      const to = W().landingAngle(i, from);
      expect(W().sliceAt(to)).toBe(i);
      expect(to - from).toBeGreaterThanOrEqual(W().OPTIONS.turns * Math.PI * 2 - 1e-9);
      expect(to - from).toBeLessThan((W().OPTIONS.turns + 1) * Math.PI * 2 + 1e-9);
    }
    expect(W().easeOut(0)).toBe(0); expect(W().easeOut(1)).toBe(1); expect(W().easeOut(0.5)).toBeGreaterThan(0.5);
  });
  it('the chances shown add up to 1 and match the slices; payouts follow the slice', () => {
    const c = W().chances();
    expect(c.reduce((s: number, x: any) => s + x.chance, 0)).toBeCloseTo(1);
    expect(c.find((x: any) => x.times === 10).chance).toBeCloseTo(1 / W().SEGMENTS.length);
    expect(W().payout(10, W().SEGMENTS.findIndex((s: any) => s.times === 3))).toBe(30);
    expect(W().pickSegment(seq(0.999))).toBe(W().SEGMENTS.length - 1);
    expect(W().averageReturn()).toBeGreaterThan(0);
  });
});

describe('🎲 Coin Dice', () => {
  const D = () => M['coin-dice'];
  it('every call shows its true chance from all 36 rolls', () => {
    expect(D().chanceOf('low')).toBeCloseTo(15 / 36); expect(D().chanceOf('high')).toBeCloseTo(15 / 36);
    expect(D().chanceOf('seven')).toBeCloseTo(6 / 36); expect(D().chanceOf('doubles')).toBeCloseTo(6 / 36);
  });
  it('pay follows the chance: no call gives back more than it takes on average', () => {
    for (const c of Object.keys(D().CALLS)) expect(D().chanceOf(c) * D().CALLS[c].times).toBeLessThanOrEqual(1.0001);
    expect(D().settle('seven', 10, 3, 4)).toBe(55); expect(D().settle('seven', 10, 3, 3)).toBe(0);
    expect(D().settle('doubles', 10, 3, 3)).toBe(55); expect(D().settle('high', 10, 6, 2)).toBe(24);
  });
  it('dice are 1–6 and the totals chart counts them', () => {
    for (let k = 0; k < 200; k++) { const d = D().die(); expect(d).toBeGreaterThanOrEqual(1); expect(d).toBeLessThanOrEqual(6); }
    expect(D().die(seq(0.9999))).toBe(6);
    const tl = D().tally([[1, 1], [3, 4], [6, 1]]); expect(tl[2]).toBe(1); expect(tl[7]).toBe(2);
  });
});

describe('play coins only', () => {
  it.each(['coin-wheel', 'coin-dice'])('%s says so on screen and never offers real money', (id) => {
    expect(SRC[id]).toContain('Play coins only');
    expect(SRC[id]).not.toMatch(/deposit|withdraw|cash ?out|₹|rupee|upi|paytm/i);
  });
});

describe('🎵 Beat Steps', () => {
  const B = () => M['beat-steps'];
  it('songs are readable step charts: every lane the same length, notes in time order on the half-beat', () => {
    for (const [name, s] of Object.entries<any>(B().SONGS)) {
      expect(new Set(s.lanes.map((l: string) => l.length)).size, name).toBe(1);
      expect(s.lanes).toHaveLength(4);
      const notes = B().chartFor(name), half = 30 / s.bpm;
      expect(notes.length).toBe(s.lanes.join('').split('x').length - 1);
      for (let i = 1; i < notes.length; i++) expect(notes[i].time).toBeGreaterThanOrEqual(notes[i - 1].time);
      for (const n of notes) expect(((n.time - 1) / half) % 1).toBeCloseTo(0);
    }
  });
  it('a tap is judged perfect, good or miss by how far it is from the note, early or late the same', () => {
    const o = B().OPTIONS;
    expect(B().judge(0)).toBe('perfect'); expect(B().judge(-o.perfectMs)).toBe('perfect');
    expect(B().judge(o.perfectMs + 1)).toBe('good'); expect(B().judge(-(o.goodMs - 1))).toBe('good');
    expect(B().judge(o.goodMs + 1)).toBe('miss');
  });
  it('a tap goes to the nearest open note in its lane; accuracy, grade and combo points', () => {
    const notes = [{ lane: 0, time: 1 }, { lane: 0, time: 1.08 }, { lane: 1, time: 1 }];
    expect(B().noteFor(notes, 0, 1.07)).toBe(notes[1]);
    expect(B().noteFor(notes, 0, 1.5)).toBeNull();
    expect(B().noteFor([{ lane: 0, time: 1, hit: 'good' }], 0, 1)).toBeNull();
    expect(B().accuracy([{ hit: 'perfect' }, { hit: 'good' }, { hit: 'miss' }, { hit: 'perfect' }])).toBeCloseTo(0.625);
    expect(B().gradeFor(0.96)).toBe('S'); expect(B().gradeFor(0.4)).toBe('D');
    expect(B().pointsFor('perfect', 25)).toBe(300); expect(B().pointsFor('miss', 25)).toBe(0);
  });
});

describe('🥁 Drum Row', () => {
  const R = () => M['drum-row'];
  it('rhythms are 4 rows of 16 steps and use only the drums of their level', () => {
    for (const r of R().RHYTHMS) {
      expect(r.lines).toHaveLength(4);
      for (const l of r.lines) expect(l).toMatch(/^[x.]{16}$/);
      r.lines.forEach((l: string, d: number) => { if (d >= r.level) expect(l).not.toContain('x'); });
    }
  });
  it('steps are evenly spaced with swing on every second step', () => {
    const o = R().OPTIONS, times = R().stepTimes(), step = 60 / o.bpm / 4;
    expect(times).toHaveLength(o.steps);
    expect(times[2] - times[0]).toBeCloseTo(2 * step);
    expect(times[1]).toBeCloseTo(step * (1 + o.swing));
    expect(R().stepTimes({ ...o, swing: 0 })[1]).toBeCloseTo(step);
  });
  it('a copy is scored by right, missed and extra hits', () => {
    const target = R().parse(['x...x...........', '................', '................', '................']);
    expect(R().compare(target, target)).toEqual({ right: 2, missed: 0, extra: 0, score: 1 });
    const mine = R().parse(['x.......x.......', '................', '................', '................']);
    expect(R().compare(target, mine)).toEqual({ right: 1, missed: 1, extra: 1, score: 0 });
    expect(R().compare(target, R().emptyGrid()).score).toBe(0);
    for (let k = 0; k < 30; k++) { const id = R().pickRhythm(2, 2); expect(id).not.toBe(2); expect(R().RHYTHMS[id].level).toBe(2); }
  });
});

describe('✏️ editable by chat', () => {
  it.each(IDS)('%s has named OPTIONS and COPY blocks, both languages, and no line too long to edit', (id) => {
    expect(SRC[id]).toMatch(/export const OPTIONS = \{/);
    expect(SRC[id]).toMatch(/const COPY = \{/);
    expect(SRC[id]).toContain('खेल खत्म'); expect(SRC[id]).toContain('Play again');
    for (const line of SRC[id].split('\n')) expect(line.length).toBeLessThan(220);
  });
});
