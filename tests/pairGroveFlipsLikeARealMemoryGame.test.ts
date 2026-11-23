// 🃏 PAIR GROVE FLIPS LIKE A REAL MEMORY GAME (template round R7). These run the REAL materialised App.tsx.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-pair-grove-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any; let SRC = '';
beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  SRC = materializeGame(GAME_LIBRARY.find((g) => g.id === 'pair-grove')!);
  writeFileSync(join(DIR, 'App.tsx'), SRC);
  writeFileSync(join(DIR, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
  M = await import(join(DIR, 'App.tsx'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const twin = (deck: any[], id: number) => deck.find((c) => c.id !== id && c.face === deck.find((d) => d.id === id).face).id;
const other = (deck: any[], id: number) => deck.find((c) => c.face !== deck.find((d) => d.id === id).face).id;

describe('🃏 the deck', () => {
  it('every face exactly twice, shuffled, capped at the faces there are', () => {
    const d = M.makeDeck(6);
    expect(d).toHaveLength(12);
    const counts = new Map<string, number>(); for (const c of d) counts.set(c.face, (counts.get(c.face) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(M.makeDeck(99)).toHaveLength(M.FACES.length * 2);
    const orders = new Set(Array.from({ length: 20 }, () => M.makeDeck(6).map((c: any) => c.id).join()));
    expect(orders.size).toBeGreaterThan(15);
  });
  it('levels grow by two pairs up to the faces available', () => {
    expect(M.pairsFor(1)).toBe(M.OPTIONS.firstPairs);
    expect(M.pairsFor(2)).toBe(M.OPTIONS.firstPairs + 2);
    expect(M.pairsFor(50)).toBe(M.FACES.length);
  });
});

describe('🔁 a turn', () => {
  it('a match stays face up and scores times the combo; a miss resets the combo', () => {
    let r = M.newRound(M.makeDeck(4, () => 0.3));
    const a = r.deck[0].id;
    r = M.turnCard(r, a).round;
    const m = M.turnCard(r, twin(r.deck, a));
    expect(m.result).toBe('match'); expect(m.round.combo).toBe(1); expect(m.round.score).toBe(M.OPTIONS.pairPoints);
    expect(m.round.deck.filter((c: any) => c.done)).toHaveLength(2);
    r = m.round;
    const b = r.deck.find((c: any) => !c.done).id;
    r = M.turnCard(r, b).round;
    const m2 = M.turnCard(r, twin(r.deck, b));
    expect(m2.round.combo).toBe(2); expect(m2.round.score).toBe(M.OPTIONS.pairPoints * 3);
    r = m2.round;
    const c = r.deck.find((x: any) => !x.done).id;
    r = M.turnCard(r, c).round;
    const miss = M.turnCard(r, other(r.deck.filter((x: any) => !x.done), c));
    expect(miss.result).toBe('miss'); expect(miss.round.combo).toBe(0); expect(miss.round.open).toHaveLength(2);
    expect(M.closeMiss(miss.round).open).toEqual([]);
    expect(miss.round.turns).toBe(3);
  });
  it('no third card while two are open, no card twice, no card already matched', () => {
    let r = M.newRound(M.makeDeck(4));
    const a = r.deck[0].id;
    r = M.turnCard(r, a).round;
    expect(M.turnCard(r, a).result).toBe('ignored');
    const miss = M.turnCard(r, other(r.deck, a)).round;
    expect(M.turnCard(miss, miss.deck.find((c: any) => !miss.open.includes(c.id)).id).result).toBe('ignored');
  });
  it('clearing every pair ends the level; fewer turns earn more stars', () => {
    let r = M.newRound(M.makeDeck(3));
    while (!M.cleared(r)) { const a = r.deck.find((c: any) => !c.done).id; r = M.turnCard(M.turnCard(r, a).round, twin(r.deck, a)).round; }
    expect(r.turns).toBe(3); expect(M.starsFor(r.turns, 3)).toBe(3);
    expect(M.starsFor(5, 3)).toBe(2); expect(M.starsFor(9, 3)).toBe(1);
  });
});

describe('✏️ editable by chat', () => {
  it('named OPTIONS / FACES / COPY, real flips, no minified line', () => {
    for (const block of ['export const OPTIONS', 'export const FACES', 'const COPY', 'rotateY(180deg)']) expect(SRC).toContain(block);
    expect(Math.max(...SRC.split('\n').map((l) => l.length))).toBeLessThan(220);
  });
});
