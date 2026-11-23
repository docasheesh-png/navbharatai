// 🔤 THE WORD AND TRIVIA TEMPLATES PLAY FAIR (template round R9). These run the REAL materialised App.tsx of each.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-word-trivia-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {}; const SRC: Record<string, string> = {};
const IDS = ['bell-round', 'odd-one', 'letter-link', 'rhyme-pair'];
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
const hasDevanagari = (s: string) => /[\u0900-\u097F]/.test(s);

describe('🔔 Bell Round', () => {
  const B = () => M['bell-round'];
  it('a real bank: every question in English and Hindi, four different options, no repeats', () => {
    const bank = B().QUESTIONS;
    expect(bank.length).toBeGreaterThanOrEqual(30);
    expect(new Set(bank.map((x: any) => x.en)).size).toBe(bank.length);
    for (const x of bank) {
      expect(hasDevanagari(x.hi)).toBe(true);
      expect(x.options).toHaveLength(4);
      expect(new Set(x.options.map((o: any) => o.en)).size).toBe(4);
    }
  });
  it('a game deals different questions with the answer moved around, and still knows the right one', () => {
    const game = B().dealGame(undefined, undefined, Math.random);
    expect(game).toHaveLength(B().OPTIONS.perGame);
    expect(new Set(game.map((r: any) => r.q.en)).size).toBe(game.length);
    for (const r of game) expect(r.order[r.answer]).toBe(0);
    const places = new Set(Array.from({ length: 40 }, () => B().dealGame()[0].answer));
    expect(places.size).toBeGreaterThan(1);
    const sport = B().dealGame(undefined, { ...B().OPTIONS, topic: 'sport' });
    expect(sport.every((r: any) => r.q.topic === 'sport')).toBe(true);
  });
  it('fast and in-a-row answers score more; wrong or late scores nothing', () => {
    const o = B().OPTIONS;
    expect(B().scoreAnswer(true, o.seconds, 0)).toBe(o.points + o.speedBonus);
    expect(B().scoreAnswer(true, 1, 0)).toBeLessThan(B().scoreAnswer(true, 10, 0));
    expect(B().scoreAnswer(true, 5, 3)).toBe(B().scoreAnswer(true, 5, 0) + 3 * o.streakBonus);
    expect(B().scoreAnswer(false, 10, 3)).toBe(0);
    expect(B().scoreAnswer(true, 0, 3)).toBe(0);
  });
  it('50:50 hides two wrong answers and never the right one', () => {
    for (let k = 0; k < 20; k++) {
      const r = B().dealGame()[0]; const hide = B().fiftyFifty(r);
      expect(hide).toHaveLength(2); expect(hide).not.toContain(r.answer);
    }
  });
});

describe('🧩 Odd One', () => {
  const O = () => M['odd-one'];
  it('every set has four items, a group and a reason, in English and Hindi, across three levels', () => {
    for (const s of O().SETS) {
      expect(s.items).toHaveLength(4);
      expect(hasDevanagari(s.group.hi + s.why.hi)).toBe(true);
      expect(s.why.en.length).toBeGreaterThan(5);
    }
    expect(new Set(O().SETS.map((s: any) => s.level))).toEqual(new Set([1, 2, 3]));
  });
  it('easy sets first, harder later; no set twice; the odd one is tracked through the shuffle', () => {
    expect(O().levelFor(0)).toBe(1); expect(O().levelFor(5)).toBe(2); expect(O().levelFor(12)).toBe(3);
    const seen = new Set<number>();
    for (let k = 0; k < O().SETS.length; k++) {
      const { round, index } = O().nextRound(seen, 0);
      expect(seen.has(index)).toBe(false); seen.add(index);
      expect(round.order[round.odd]).toBe(0);
    }
    expect(O().nextRound(new Set(), 0).round.set.level).toBe(1);
    expect(O().nextRound(new Set(), 20).round.set.level).toBe(3);
  });
  it('the clock speeds up but never below the fastest; a streak scores more', () => {
    const o = O().OPTIONS;
    expect(O().secondsFor(0)).toBe(o.seconds);
    expect(O().secondsFor(4)).toBeLessThan(o.seconds);
    expect(O().secondsFor(1000)).toBe(o.fastest);
    expect(O().pointsFor(3)).toBeGreaterThan(O().pointsFor(0));
  });
});

describe('🔡 Letter Link', () => {
  const L = () => M['letter-link'];
  it('marks greens, yellows and greys, and handles repeated letters the way players expect', () => {
    expect(L().scoreGuess('APPLE', 'APPLE')).toEqual(Array(5).fill('green'));
    expect(L().scoreGuess('LEMON', 'MELON')).toEqual(['yellow', 'green', 'yellow', 'green', 'green']);
    expect(L().scoreGuess('SPEED', 'ABIDE')).toEqual(['grey', 'grey', 'yellow', 'grey', 'yellow']);   // one E only
    expect(L().scoreGuess('EERIE', 'THERE')).toEqual(['yellow', 'grey', 'yellow', 'grey', 'green']);
    expect(L().scoreGuess('LLAMA', 'HELLO')).toEqual(['yellow', 'yellow', 'grey', 'grey', 'grey']);
  });
  it('hard mode makes you keep greens and use yellows', () => {
    const h = [{ guess: 'CRANE', marks: L().scoreGuess('CRANE', 'TRAIN') }];
    expect(L().hardModeProblem('TRAIN', h)).toBeNull();
    expect(L().hardModeProblem('BLAST', h)).toBe('R @2');
    expect(L().hardModeProblem('ARMOR', h)).not.toBeNull();
  });
  it('the keyboard keeps the best mark each letter has shown', () => {
    const h = ['CRANE', 'TRAIN'].map((g) => ({ guess: g, marks: L().scoreGuess(g, 'TRAIN') }));
    const k = L().keyStates(h);
    expect(k.N).toBe('green'); expect(k.C).toBe('grey'); expect(k.A).toBe('green');
  });
  it('two banks of real five-letter words; the daily word is the same all day and changes the next', () => {
    for (const bank of Object.values(L().WORDS) as string[][]) {
      expect(bank.length).toBeGreaterThanOrEqual(20);
      for (const w of bank) expect(w).toMatch(/^[A-Z]{5}$/);
      expect(new Set(bank).size).toBe(bank.length);
    }
    const n = L().WORDS.english.length;
    expect(L().dailyIndex(new Date(2026, 10, 23, 8), n)).toBe(L().dailyIndex(new Date(2026, 10, 23, 22), n));
    expect(L().dailyIndex(new Date(2026, 10, 24), n)).not.toBe(L().dailyIndex(new Date(2026, 10, 23), n));
    expect(L().pickWord({ ...L().OPTIONS, words: 'hinglish' }, seq(0))).toBe(L().WORDS.hinglish[0]);
  });
  it('the stats count wins, streaks and the guess chart', () => {
    let s = L().emptyStats();
    s = L().recordGame(s, 3); s = L().recordGame(s, 4); s = L().recordGame(s, 0); s = L().recordGame(s, 3);
    expect(s).toEqual({ played: 4, won: 3, streak: 1, bestStreak: 2, chart: [0, 0, 2, 1, 0, 0] });
  });
});

describe('🎶 Rhyme Pair', () => {
  const R = () => M['rhyme-pair'];
  it('English and Hindi sound families, no word in two families', () => {
    for (const lang of ['en', 'hi']) {
      const bank: string[][] = R().RHYMES[lang];
      expect(bank.length).toBeGreaterThanOrEqual(R().OPTIONS.mostPairs);
      const all = bank.flat();
      expect(new Set(all).size).toBe(all.length);
      if (lang === 'hi') expect(all.every(hasDevanagari)).toBe(true);
    }
    expect(R().rhymes('cat', 'hat', R().RHYMES.en)).toBe(true);
    expect(R().rhymes('cat', 'cake', R().RHYMES.en)).toBe(false);
    expect(R().rhymes('पानी', 'रानी', R().RHYMES.hi)).toBe(true);
  });
  it('every card on a board has exactly one partner, and levels add pairs up to the cap', () => {
    for (const lang of ['en', 'hi']) {
      const board = R().buildBoard(6, R().RHYMES[lang]);
      expect(board).toHaveLength(12);
      for (const tile of board) expect(board.filter((x: any) => x.id !== tile.id && R().rhymes(x.word, tile.word, R().RHYMES[lang]))).toHaveLength(1);
      expect(new Set(board.map((x: any) => x.id)).size).toBe(12);
    }
    expect(R().pairsFor(1)).toBe(R().OPTIONS.firstPairs);
    expect(R().pairsFor(99)).toBe(R().OPTIONS.mostPairs);
  });
  it('quick matches build a combo; the hint finds a pair still on the board', () => {
    expect(R().nextCombo(2, 1)).toBe(3); expect(R().nextCombo(5, 30)).toBe(1);
    expect(R().pointsFor(3)).toBe(3 * R().OPTIONS.points);
    const board = R().buildBoard(2, R().RHYMES.en);
    const [a, b] = R().findPair(board, new Set())!;
    expect(board[a].family).toBe(board[b].family);
    expect(R().findPair(board, new Set(board.map((x: any) => x.id)))).toBeNull();
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
