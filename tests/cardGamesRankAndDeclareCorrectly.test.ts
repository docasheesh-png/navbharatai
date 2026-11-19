// CARD GAMES RANK AND DECLARE CORRECTLY (admin 2026-11-19 game-gap audit, India games pack c). These run the REAL
// generated src/game/board/cards.ts: the deck and the deal, every Teen Patti category in order (with A-2-3 between
// A-K-Q and K-Q-J), and Indian rummy — pure and impure sequences, sets, the declaration rules and the points.
// For fun: points and pretend chips only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';

const DIR = join(__dirname, `.tmp-cards-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let K: any; let D: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateBoardGames().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  K = await import(join(DIR, 'src/game/board/cards.ts'));
  D = await import(join(DIR, 'src/game/board/dice.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** 'AS 10H KD JK' → cards (JK = printed joker). */
const c = (s: string) => s.trim().split(/\s+/).map((t) => {
  if (t === 'JK') return { rank: 0, suit: 'j' };
  const suit = t.slice(-1).toLowerCase(); const r = t.slice(0, -1);
  return { rank: r === 'A' ? 1 : r === 'J' ? 11 : r === 'Q' ? 12 : r === 'K' ? 13 : Number(r), suit };
});

describe('🃏 the deck', () => {
  it('52 distinct cards; two decks and jokers for rummy; dealing goes round the table; too few cards is refused', () => {
    const deck = K.createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(K.cardName)).size).toBe(52);
    expect(K.createDeck({ decks: 2, jokers: 2 })).toHaveLength(106);
    const [hands, rest] = K.deal(K.shuffleCards(deck, D.createRng(3)), 3, 4);
    expect(hands.map((h: any[]) => h.length)).toEqual([3, 3, 3, 3]);
    expect(rest).toHaveLength(40);
    expect(() => K.deal(deck, 20, 3)).toThrow();
    expect(K.cardName({ rank: 12, suit: 'h' })).toBe('Q♥');
  });
});

describe('🔴 Teen Patti', () => {
  it('ranks every category in order: trail > pure sequence > sequence > colour > pair > high card', () => {
    const order = ['QS QH QD', '4H 5H 6H', '4H 5S 6D', '2C 9C KC', 'KS KH 3D', 'AS JD 9C'];
    const cats = order.map((h) => K.teenPattiHand(c(h)).category);
    expect(cats).toEqual(['trail', 'pure-sequence', 'sequence', 'colour', 'pair', 'high-card']);
    for (let i = 0; i < order.length - 1; i++) expect(K.compareTeenPatti(c(order[i]), c(order[i + 1])), order[i]).toBe(1);
  });
  it('A-K-Q is the best sequence, A-2-3 the next, then K-Q-J; K-A-2 is not a sequence', () => {
    expect(K.compareTeenPatti(c('AS KH QD'), c('AH 2S 3D'))).toBe(1);
    expect(K.compareTeenPatti(c('AH 2S 3D'), c('KS QH JD'))).toBe(1);
    expect(K.teenPattiHand(c('KS AH 2D')).category).toBe('high-card');
    expect(K.compareTeenPatti(c('AS AH AD'), c('KS KH KD'))).toBe(1);
  });
  it('ties break by the pair, then the kicker, then the high cards; equal hands tie', () => {
    expect(K.compareTeenPatti(c('9S 9H 2D'), c('8S 8H AD'))).toBe(1);
    expect(K.compareTeenPatti(c('9S 9H 5D'), c('9C 9D 4S'))).toBe(1);
    expect(K.compareTeenPatti(c('AS 9H 5D'), c('AC 9D 4S'))).toBe(1);
    expect(K.compareTeenPatti(c('4H 5S 6D'), c('4C 5D 6S'))).toBe(0);
    expect(() => K.teenPattiHand(c('AS KH'))).toThrow();
  });
});

describe('🔴 Indian rummy', () => {
  const WILD = 7;   // the cut joker: every 7 is a joker
  it('recognises pure sequences (Ace low or high, never round the corner), sequences with jokers, and sets', () => {
    expect(K.meldType(c('5H 6H 7H'), WILD)).toBe('pure-sequence');          // a wild 7 in its natural place stays pure
    expect(K.meldType(c('QS KS AS'), WILD)).toBe('pure-sequence');
    expect(K.meldType(c('AS 2S 3S'), WILD)).toBe('pure-sequence');
    expect(K.meldType(c('KS AS 2S'), WILD)).toBeNull();
    expect(K.meldType(c('5H JK 8H'), 0)).toBeNull();                       // a gap of two needs two jokers
    expect(K.meldType(c('5H JK 8H JK'), 0)).toBe('sequence');
    expect(K.meldType(c('9C 7D JC'), WILD)).toBe('sequence');               // the 7 fills the 10
    expect(K.meldType(c('9C 9D 9S'), WILD)).toBe('set');
    expect(K.meldType(c('9C 9D 9S JK'), WILD)).toBe('set');
    expect(K.meldType(c('9C 9C 9S'), WILD)).toBeNull();                     // two of one suit
    expect(K.meldType(c('9C 9D 9S 9H JK'), WILD)).toBeNull();               // a set is at most four
    expect(K.meldType(c('JK JK 7S'), WILD)).toBeNull();                     // jokers alone
    expect(K.meldType(c('5H 6H'), WILD)).toBeNull();
  });
  it('a declaration needs every card grouped, two sequences, and one of them pure', () => {
    const good = [c('AH 2H 3H'), c('5S 6S JK'), c('9C 9D 9S'), c('KD KS KH QC')].map((g, i) => (i === 3 ? c('KD KS KH') .concat(c('7C')) : g));
    expect(K.checkDeclaration(good, WILD)).toEqual({ valid: true, reason: 'Valid declaration' });
    const noPure = [c('AH JK 3H'), c('5S 6S JK'), c('9C 9D 9S'), c('KD KS KH 7C')];
    expect(K.checkDeclaration(noPure, WILD).reason).toMatch(/pure sequence/);
    const oneSeq = [c('AH 2H 3H'), c('5S 5D 5C'), c('9C 9D 9S'), c('KD KS KH 7C')];
    expect(K.checkDeclaration(oneSeq, WILD).reason).toMatch(/Two sequences/);
    expect(K.checkDeclaration([c('AH 2H 3H')], WILD).reason).toMatch(/13 cards/);
  });
  it('points: loose cards count (faces 10, jokers 0); no pure sequence means everything counts; capped at 80', () => {
    expect(K.cardPoints(c('KS')[0], WILD)).toBe(10);
    expect(K.cardPoints(c('AS')[0], WILD)).toBe(10);
    expect(K.cardPoints(c('7S')[0], WILD)).toBe(0);
    expect(K.cardPoints(c('5S')[0], WILD)).toBe(5);
    const groups = [c('AH 2H 3H'), c('5S 6S JK'), c('9C 9D 9S'), c('KD 2C 4H 8S')];
    expect(K.handPoints(groups, WILD)).toBe(10 + 2 + 4 + 8);
    const noPure = [c('9C 9D 9S'), c('KD KS KH'), c('QD QS QH'), c('JD JS JH 8C')];
    expect(K.handPoints(noPure, WILD)).toBe(80);
  });
  it('the best grouping finds a valid declaration when one exists, and the fewest points when not', () => {
    const hand = c('AH 2H 3H 4H 5S 6S 7D 9C 9D 9S KD KS KH');
    const best = K.bestGrouping(hand, WILD);
    expect(best.points).toBe(0);
    expect(K.checkDeclaration(best.groups, WILD)).toEqual({ valid: true, reason: 'Valid declaration' });
    // One loose 4♣ instead: it is the only card left over.
    expect(K.bestGrouping(c('AH 2H 3H 5S 6S 7D 9C 9D 9S KD KS KH 4C'), WILD).points).toBe(4);
    const messy = c('AH 2H 3H 5S 9D KC 2S 4D 6C 8H 10S QD JC');
    const m = K.bestGrouping(messy, WILD);
    expect(m.points).toBeLessThan(80);
    expect(m.groups.flat()).toHaveLength(13);
  });
});
