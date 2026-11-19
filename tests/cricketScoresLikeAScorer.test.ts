// CRICKET SCORES LIKE A SCORER (admin 2026-11-19 game-gap audit, India games pack e). These run the REAL generated
// src/game/board/cricket.ts: legal balls and overs, wides and no-balls (and the free hit), strike rotation, innings
// ends, the chase, the result in a commentator's words, run rates, and timing-based batting.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';

const DIR = join(__dirname, `.tmp-cricket-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let K: any; let D: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateBoardGames().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  K = await import(join(DIR, 'src/game/board/cricket.ts'));
  D = await import(join(DIR, 'src/game/board/dice.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const ball = (runs = 0, out: string | null = null, extra: string | null = null) => ({ runs, out, extra });
const many = (m: any, balls: any[]) => balls.reduce((x, b) => K.bowl(x, b), m);

describe('🏏 the scoring', () => {
  it('six legal balls make an over, the strike changes ends, and odd runs swap the batters', () => {
    let m = K.createMatch({ overs: 2, wickets: 2, teams: ['India', 'Australia'] });
    m = K.bowl(m, ball(1));
    let inn = m.innings[0];
    expect(inn.striker).toBe(1);
    m = many(m, [ball(0), ball(2), ball(4), ball(0), ball(0)]);
    inn = m.innings[0];
    expect(inn.balls).toBe(6);
    expect(K.oversText(inn.balls)).toBe('1.0');
    expect(inn.runs).toBe(7);
    expect(inn.striker).toBe(0);              // batter 1 faced the last ball; the over end gives the strike to batter 0
    expect(inn.thisOver).toEqual([]);
    expect(inn.batters[1]).toMatchObject({ runs: 6, balls: 5, fours: 1 });
  });
  it('a wide adds a run and is bowled again; a no-ball adds a run, the batter keeps the runs hit, and the next ball is a free hit', () => {
    let m = K.createMatch({ overs: 1, wickets: 2 });
    m = K.bowl(m, ball(0, null, 'wide'));
    expect(m.innings[0]).toMatchObject({ runs: 1, balls: 0, extras: 1 });
    m = K.bowl(m, ball(4, null, 'no-ball'));
    expect(m.innings[0]).toMatchObject({ runs: 6, balls: 0, extras: 2, freeHit: true });
    expect(m.innings[0].batters[0]).toMatchObject({ runs: 4, balls: 0 });
    m = K.bowl(m, ball(0, 'bowled'));          // bowled on a free hit: not out
    expect(m.innings[0].wickets).toBe(0);
    expect(m.innings[0].freeHit).toBe(false);
    m = K.bowl(m, ball(0, 'bowled'));
    expect(m.innings[0].wickets).toBe(1);
    expect(m.innings[0].thisOver).toEqual(['wd', 'nb+4', '0', 'W']);
  });
  it('a wicket brings in the next batter at the dismissed batter\'s end; all out ends the innings', () => {
    let m = K.createMatch({ overs: 5, wickets: 2, teams: ['A', 'B'] });
    m = K.bowl(m, ball(0, 'caught'));
    expect(m.innings[0].striker).toBe(2);
    expect(m.innings[0].batters[0].out).toBe('caught');
    m = K.bowl(m, ball(0, 'bowled'));
    expect(m.current).toBe(1);                 // all out → the second innings, chasing 1
    expect(m.innings[1].target).toBe(1);
  });
});

describe('🏆 the chase and the result', () => {
  it('the chase ends the moment the target is passed: won by wickets, with balls left', () => {
    let m = K.createMatch({ overs: 1, wickets: 3, teams: ['India', 'Australia'] });
    m = many(m, [ball(4), ball(4), ball(2), ball(0), ball(0), ball(0)]);   // India 10
    expect(m.current).toBe(1);
    expect(K.summary(m)).toBe('Australia 0/0 (0.0 ov) · need 11 off 6 balls');
    m = many(m, [ball(6), ball(0, 'bowled'), ball(6)]);
    expect(m.over).toBe(true);
    expect(m.result).toBe('Australia won by 2 wickets (3 balls left)');
    expect(m.winner).toBe('Australia');
    expect(K.bowl(m, ball(6))).toBe(m);        // nothing after the end
  });
  it('falling short is a win by runs; equal scores are a tie', () => {
    let m = K.createMatch({ overs: 1, wickets: 3, teams: ['India', 'Australia'] });
    m = many(m, Array(6).fill(ball(2)));        // India 12
    m = many(m, Array(6).fill(ball(1)));        // Australia 6
    expect(m.result).toBe('India won by 6 runs');
    let t = K.createMatch({ overs: 1, wickets: 3 });
    t = many(t, Array(6).fill(ball(1)));
    t = many(t, Array(6).fill(ball(1)));
    expect(t.result).toBe('Match tied');
    expect(t.winner).toBeNull();
  });
  it('run rates: current and required', () => {
    let m = K.createMatch({ overs: 2, wickets: 3 });
    m = many(m, [ball(6), ball(6), ball(0)]);
    expect(K.runRates(m).current).toBe(24);
    expect(K.runRates(m).required).toBeNull();
  });
});

describe('🎯 timing-based batting', () => {
  it('perfect timing is a boundary (a six when going big); a big miss is bowled only when the ball is on the stumps', () => {
    const rng = D.createRng(1);
    expect(K.shotFromTiming(0.01, { onStumps: true }, rng)).toMatchObject({ runs: 4, out: null });
    expect(K.shotFromTiming(-0.02, { onStumps: true, aggressive: true }, rng)).toMatchObject({ runs: 6, out: null });
    expect(K.shotFromTiming(0.5, { onStumps: true }, rng).out).toBe('bowled');
    expect(K.shotFromTiming(0.5, { onStumps: false }, rng)).toMatchObject({ runs: 0, out: null });
  });
  it('worse timing means fewer runs and more edges, and going big is riskier', () => {
    const outRate = (err: number, aggressive: boolean) => {
      const rng = D.createRng(9); let outs = 0;
      for (let i = 0; i < 4000; i++) if (K.shotFromTiming(err, { onStumps: false, aggressive }, rng).out) outs++;
      return outs / 4000;
    };
    expect(outRate(0.05, false)).toBe(0);
    expect(outRate(0.1, false)).toBeLessThan(outRate(0.15, false));
    expect(outRate(0.15, true)).toBeGreaterThan(outRate(0.15, false));
  });
});
