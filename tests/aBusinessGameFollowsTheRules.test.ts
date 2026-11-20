// BUSINESS (vyapaar) AND "A GAME IS NOT ITS THEME" (admin 2026-11-20 game-gap audit). Two things were missing:
// (1) no rules engine for the property-trading board game, and (2) the request never reached one anyway. "business board
// game jisme property kharid sake" was read as a REAL-ESTATE app — and ten of fourteen themed game prompts (restaurant,
// hospital, bank, shop, school, stock-market, gym, pizza, real-estate, and every "gaadi wala" racing game as logistics)
// were read as the business their theme names, so none of them got the game kit. These run the REAL generated
// src/game/board/business.ts and the real domain reader.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames, BOARD_GAME_MODULES } from '../src/server/lib/BoardGamesGenerator';
import { analyzeRequirementGaps, asksForAGame } from '../src/server/lib/RequirementGapAnalyzer';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-business-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let B: any;
let D: any;

beforeAll(async () => {
  const { files } = generateBoardGames(['business']);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  B = await import(join(DIR, 'src/game/board/business.ts'));
  D = await import(join(DIR, 'src/game/board/dice.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const two = () => B.createBusiness({ players: [{ name: 'A' }, { name: 'B' }], seed: 1 });
const idx = (name: string) => B.BUSINESS_BOARD.findIndex((s: any) => s.name === name);

describe('the Business board', () => {
  it('ships in the pack with a sound board', () => {
    expect(BOARD_GAME_MODULES).toContain('business');
    const all = generateBoardGames();
    expect(Object.keys(all.files)).toContain('src/game/board/business.ts');
    expect(all.files['src/game/board/index.ts']).toMatch(/createBusiness/);
    expect(all.instructions).toMatch(/rollBusiness/);
    expect(all.instructions).toMatch(/pretend money/i);
    const board = B.BUSINESS_BOARD;
    expect(board).toHaveLength(36);
    expect([0, 9, 18, 27].map((i) => board[i].kind)).toEqual(['start', 'jail', 'rest', 'goToJail']);
    const groups = new Map<string, number[]>();
    board.forEach((s: any, i: number) => { if (s.kind === 'city') groups.set(s.group, [...(groups.get(s.group) ?? []), i]); });
    for (const [g, sq] of groups) {
      expect(sq.length, g).toBeGreaterThanOrEqual(2);
      expect(sq.length, g).toBeLessThanOrEqual(3);
      for (const i of sq) { const r = board[i].rent; for (let k = 1; k < r.length; k++) expect(r[k]).toBeGreaterThan(r[k - 1]); }
    }
    expect(board.filter((s: any) => s.kind === 'transport')).toHaveLength(4);
    expect(board.filter((s: any) => s.kind === 'utility')).toHaveLength(2);
  });
});

describe('a turn', () => {
  it('landing on an unowned city offers it; buying pays; the next lander pays rent, doubled for a full set', () => {
    let g = two();
    let r = B.roll(g, 1, 2); // 0 → 3 Agra (not doubles)
    g = r.state;
    expect(g.players[0].position).toBe(3);
    expect(g.phase).toBe('buy');
    expect(r.events.at(-1)).toMatchObject({ type: 'canBuy', square: 3, price: 600 });
    r = B.buy(g); g = r.state;
    expect(g.owner[3]).toBe(0);
    expect(g.players[0].cash).toBe(15000 - 600);
    expect(g.phase).toBe('end');
    g = B.endTurn(g).state;
    g = B.roll(g, 1, 2).state; // B lands on Agra
    expect(g.players[1].cash).toBe(15000 - 50);
    expect(g.players[0].cash).toBe(15000 - 600 + 50);
    // Owning Jaipur too completes brown: bare rent doubles.
    g.owner[idx('Jaipur')] = 0;
    expect(B.rentFor(g, 3, 7, 1)).toBe(100);
    expect(B.rentFor(g, 3, 7, 0)).toBe(0); // never rent on your own square
  });

  it('passing Start collects; doubles roll again; three doubles go to jail', () => {
    let g = two();
    g.players[0].position = 33;
    let r = B.roll(g, 2, 3); // 33 + 5 = 38 → 2 (Chance)
    expect(r.events.find((e: any) => e.type === 'collected' && e.reason === 'passed Start')).toBeTruthy();
    g = two();
    r = B.roll(g, 3, 3); g = r.state; // → 6 Lucknow
    if (g.phase === 'buy') g = B.decline(g).state;
    expect(g.phase).toBe('roll');
    expect(g.turn).toBe(0);
    r = B.roll(g, 1, 1); g = r.state;
    if (g.phase === 'buy') g = B.decline(g).state;
    r = B.roll(g, 2, 2); g = r.state;
    expect(r.events.find((e: any) => e.type === 'jailed')).toMatchObject({ reason: 'three doubles' });
    expect(g.players[0].inJail).toBe(true);
    expect(g.players[0].position).toBe(9);
    expect(g.phase).toBe('end');
  });

  it('jail: stay on a miss, leave on doubles, pay the fine after the last try; Go to jail sends you there', () => {
    let g = two();
    g.players[0].position = 20;
    let r = B.roll(g, 3, 4); g = r.state; // → 27 Go to jail
    expect(g.players[0].inJail).toBe(true);
    g = B.endTurn(g).state; g = B.roll(g, 1, 2).state; if (g.phase === 'buy') g = B.decline(g).state; g = B.endTurn(g).state;
    r = B.roll(g, 1, 2); g = r.state;
    expect(r.events[0]).toMatchObject({ type: 'stayedInJail', tries: 1 });
    expect(g.players[0].position).toBe(9);
    g.phase = 'roll'; g.players[0].jailTries = 2;
    const cash = g.players[0].cash;
    r = B.roll(g, 1, 2); g = r.state;
    expect(r.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['paid', 'leftJail', 'moved']));
    expect(g.players[0].inJail).toBe(false);
    expect(g.players[0].cash).toBeLessThanOrEqual(cash - 500);
    // Leaving on doubles moves but does not roll again.
    let h = two(); h.players[0].inJail = true; h.players[0].position = 9;
    h = B.roll(h, 4, 4).state;
    expect(h.players[0].inJail).toBe(false);
    expect(h.players[0].position).toBe(17);
    if (h.phase === 'buy') h = B.decline(h).state;
    expect(h.phase).toBe('end');
  });

  it('a house needs the whole set, unmortgaged, built evenly; a hotel is the fifth; a mortgaged square takes no rent', () => {
    const g = two();
    const [a, b] = [idx('Jaipur'), idx('Agra')];
    g.owner[a] = 0;
    expect(B.cannotBuild(g, 0, a)).toMatch(/whole colour set/);
    g.owner[b] = 0;
    let s = B.build(g, 0, a).state;
    expect(s.houses[a]).toBe(1);
    expect(B.build(s, 0, a).reason).toMatch(/evenly/);
    s = B.build(s, 0, b).state;
    for (let k = 0; k < 4; k++) { s = B.build(s, 0, a).state; s = B.build(s, 0, b).state; }
    expect(s.houses[a]).toBe(5);
    expect(B.build(s, 0, a).reason).toMatch(/hotel/);
    expect(B.rentFor(s, a, 7, 1)).toBe(B.BUSINESS_BOARD[a].rent[5]);
    expect(B.mortgage(s, 0, a).reason).toMatch(/houses/);
    const m = B.mortgage(g, 0, a).state;
    expect(B.rentFor(m, a, 7, 1)).toBe(0);
    expect(B.cannotBuild(m, 0, b)).toMatch(/mortgaged/);
  });

  it('transport and utility rent grow with how many the owner holds', () => {
    const g = two();
    const tr = B.groupSquares(g, 'transport');
    const ut = B.groupSquares(g, 'utility');
    g.owner[tr[0]] = 0;
    expect(B.rentFor(g, tr[0], 7, 1)).toBe(250);
    g.owner[tr[1]] = 0; g.owner[tr[2]] = 0; g.owner[tr[3]] = 0;
    expect(B.rentFor(g, tr[0], 7, 1)).toBe(2000);
    g.owner[ut[0]] = 0;
    expect(B.rentFor(g, ut[0], 7, 1)).toBe(28);
    g.owner[ut[1]] = 0;
    expect(B.rentFor(g, ut[0], 7, 1)).toBe(70);
  });

  it('a player who cannot pay sells houses, then mortgages, and only then goes bankrupt to the creditor — the last one wins', () => {
    const g = two();
    const mum = idx('Mumbai');
    const goa = idx('Goa');
    g.owner[mum] = 1; g.owner[goa] = 1; g.houses[mum] = 5; g.houses[goa] = 4;
    // A owns Jaipur with one... no set: just a square to mortgage.
    g.owner[idx('Jaipur')] = 0;
    g.players[0].cash = 100;
    g.players[0].position = 30; // 30 + 5 = 35 Mumbai with a hotel
    const r = B.roll(g, 2, 3);
    const types = r.events.map((e: any) => e.type);
    expect(types).toContain('mortgaged');
    expect(types).toContain('bankrupt');
    expect(r.state.players[0].bankrupt).toBe(true);
    expect(r.state.owner[idx('Jaipur')]).toBe(1); // to the creditor
    expect(r.state.winner).toBe(1);
    expect(r.state.phase).toBe('over');
    expect(types.at(-1)).toBe('won');
  });

  it('a tax it can cover by mortgaging is paid, not a bankruptcy', () => {
    const g = two();
    g.owner[idx('Mumbai')] = 0;
    g.players[0].cash = 200;
    g.players[0].position = 1; // 1 + 3 = 4 Income tax (1000)
    const r = B.roll(g, 1, 2);
    expect(r.state.players[0].bankrupt).toBe(false);
    expect(r.state.mortgaged[idx('Mumbai')]).toBe(true);
    expect(r.state.players[0].cash).toBe(200 + 2000 - 1000);
  });

  it('wrong-phase moves are refused with a reason, never applied', () => {
    const g = two();
    expect(B.buy(g)).toMatchObject({ ok: false });
    expect(B.endTurn(g)).toMatchObject({ ok: false });
    expect(B.roll(g, 0, 7)).toMatchObject({ ok: false });
    expect(() => B.createBusiness({ players: [{ name: 'solo' }] })).toThrow();
  });
});

describe('computer players', () => {
  it('40 seeded four-computer games: no negative cash, houses only on full sets, nothing owned by the bankrupt, and every game moves', () => {
    let finished = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = D.createRng(seed);
      let g = B.createBusiness({ players: [1, 2, 3, 4].map((n) => ({ name: 'C' + n, computer: true })), seed });
      for (let turn = 0; turn < 1500 && g.phase !== 'over'; turn++) {
        const before = g.turn;
        g = B.computerTurn(g, rng).state;
        expect(g.turn !== before || g.phase === 'over', `seed ${seed} stalled`).toBe(true);
        for (const p of g.players) expect(p.cash, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        g.houses.forEach((h: number, i: number) => {
          if (h === 0) return;
          expect(B.BUSINESS_BOARD[i].kind).toBe('city');
          expect(B.ownsGroup(g, g.owner[i], B.BUSINESS_BOARD[i].group)).toBe(true);
        });
        g.owner.forEach((o: number | null) => { if (o !== null) expect(g.players[o].bankrupt).toBe(false); });
      }
      if (g.phase === 'over') { finished++; expect(g.players.filter((p: any) => !p.bankrupt)).toHaveLength(1); }
    }
    expect(finished).toBeGreaterThan(20); // games end: a winner, not an endless loop of passing Start
  });
});

describe('a game is not its theme', () => {
  const GAMES = [
    'ek business board game banao jisme property kharid sake', 'make a property trading board game with dice', 'restaurant cooking game banao',
    'hospital doctor game for kids', 'bank robbery game banao', 'shop simulator game where you sell items', 'school quiz game for students',
    'stock market trading game with fake money', 'gym workout game', 'pizza delivery game', 'real estate tycoon game',
    'ek 3D open world racing game banao jisme gaadi chale', 'gaadi wala game', 'ek racing game app banao', 'mario jaisa platform game',
  ];
  it.each(GAMES)('"%s" is a game', (prompt) => {
    expect(analyzeRequirementGaps(prompt).domain).toBe('game');
    expect(asksForAGame(prompt)).toBe(true);
  });

  const NOT_GAMES: Array<[string, string]> = [
    ['build a restaurant ordering app', 'restaurant'], ['property listing app for flats', 'real-estate'],
    ['a gym app with a workout game for members', 'fitness'], ['Build a bank app with a small game for kids on the home screen', 'fintech'],
    ['Make a fantasy cricket game with a wallet and real-money prizes', 'fintech'], ['sports club app to book game slots', 'booking'],
    ['gamification for my school app', 'education'],
  ];
  it.each(NOT_GAMES)('"%s" stays %s', (prompt, domain) => {
    expect(analyzeRequirementGaps(prompt).domain).toBe(domain);
    expect(asksForAGame(prompt)).toBe(false);
  });

  it('"game" that only describes another noun names no game', () => {
    expect(analyzeRequirementGaps('a cricket academy app with game schedules and fees').domain).not.toBe('game');
  });

  it('every Business wording is a board game and gets the game kit', () => {
    for (const t of ['business game banao', 'monopoly jaisa game banao', 'vyapaar game banao 4 players', 'व्यापार का खेल बनाओ', 'ek business board game banao jisme property kharid sake']) {
      expect(buildGameContract(t).genre, t).toBe('board');
      expect(gameKitPlan(t), t).toContain('generate_game_runtime');
    }
  });
});
