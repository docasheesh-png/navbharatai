/**
 * 🏏 Admin 2026-11-26: "cricket game me bowl bat se touch hi nahi ho rahi, na run lag rahe hai, na chauke chhakke … pura logic
 * theek karna, aur user AI ko bol kar API call se kuch change karwa sake". Two roots, both locked here on the REAL emitted
 * engine: (1) the timing windows were 30 ms / 70 ms — tighter than a phone's touch delay — so a thumb never scored; (2) the
 * kit had no play: the moment the ball meets the bat, the ball leaving the bat and the scoring were each game's own code, and
 * deliveryPath ran the ball on through the batter. createCricketPlay plays a ball end to end; cricketRules.ts is the user's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames, cricketRulesFileSource, CRICKET_RULES_PATH } from '../src/server/lib/BoardGamesGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-bat-ball-${process.pid}`);
let K: any; let D: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateBoardGames().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  K = await import(join(DIR, 'src/game/board/cricket.ts'));
  D = await import(join(DIR, 'src/game/board/dice.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** Bowl one ball and tap `offset` seconds from the true moment (the touch delay added, as a phone would). */
function playBall(play: any, offset: number | null, aggressive = false, lag = 0.05) {
  play.bowlNext();
  let swung: any = null;
  const step = 1 / 60;
  const tapAt = offset === null ? Infinity : play.untilBat() + offset + lag;
  let clock = 0, guard = 0;
  let touched = false;
  while (play.phase === 'bowling' || play.phase === 'hit') {
    if (!swung && clock >= tapAt) swung = play.swing(aggressive);
    play.update(step); clock += step;
    if (play.phase === 'hit') touched = true;
    if (++guard > 2000) throw new Error('the ball never finished');
  }
  return { swung, touched, last: play.last };
}

describe('🏏 the bat meets the ball', () => {
  it('a well-timed tap on a phone scores a boundary, and the ball visibly leaves the bat over the rope', () => {
    const play = K.createCricketPlay({ rng: D.createRng(3), overs: 5 });
    const r = playBall(play, 0.01);
    expect(r.touched).toBe(true);
    expect(r.last.runs).toBe(4);
    expect(play.match.innings[0].runs).toBe(4);
    expect(play.match.innings[0].batters[0].fours).toBe(1);
  });

  it('going big with good timing is a six that lands beyond the boundary', () => {
    const f = K.cricketLayout({ boundary: 60 });
    const play = K.createCricketPlay({ layout: f, rng: D.createRng(5) });
    play.bowlNext();
    const tapIn = play.untilBat() + 0.05;
    let t = 0;
    let shot: any = null; let farthest = 0;
    while (play.phase === 'bowling' || play.phase === 'hit') {
      if (!shot && t >= tapIn) shot = play.swing(true);
      play.update(1 / 60); t += 1 / 60;
      const b = play.ball();
      farthest = Math.max(farthest, Math.hypot(b.x - f.batter.x, b.z - f.batter.z));
    }
    expect(shot.runs).toBe(6);
    expect(farthest).toBeGreaterThan(60);
    expect(play.match.innings[0].batters[0].sixes).toBe(1);
  });

  it('over a whole match on normal difficulty, a decent tapper scores runs, fours and sixes (the reported game scored none)', () => {
    const rng = D.createRng(11);
    const play = K.createCricketPlay({ rng, overs: 3, wickets: 10 });
    let balls = 0;
    while (play.phase !== 'over' && balls < 18) {
      // A human thumb on glass: late by 35 to 90 ms (the frame step only adds to it), not going big. Under the old
      // 30 ms boundary window this thumb could never hit a four.
      playBall(play, 0.035 + rng() * 0.055, false);
      balls++;
      for (let i = 0; i < 90 && play.phase === 'dead'; i++) play.update(1 / 60);
    }
    const inn = play.match.innings[0];
    const fours = inn.batters.reduce((n: number, b: any) => n + b.fours, 0), sixes = inn.batters.reduce((n: number, b: any) => n + b.sixes, 0);
    expect(inn.runs).toBeGreaterThan(15);
    expect(fours).toBeGreaterThan(0);
    expect(sixes).toBe(0);   // a six only when going big
    expect(inn.balls).toBe(18);
  });

  it('a ball left alone goes on to the stumps: bowled when on them, a dot when not; a swing is taken once', () => {
    let bowled = 0, dots = 0;
    const play = K.createCricketPlay({ rng: D.createRng(2), overs: 20, wickets: 10 });
    for (let i = 0; i < 30; i++) {
      const r = playBall(play, null);
      if (r.last.out === 'bowled') bowled++; else if (r.last.runs === 0) dots++;
      for (let k = 0; k < 90 && play.phase === 'dead'; k++) play.update(1 / 60);
    }
    expect(bowled).toBeGreaterThan(0);
    expect(dots).toBeGreaterThan(0);
    play.bowlNext();
    expect(play.swing()).not.toBeNull();
    expect(play.swing()).toBeNull();
  });

  it('the windows: hard keeps the old tight ones, normal and easy are wider, and each is a phone-reachable target', () => {
    expect(K.CRICKET_TIMING.hard).toEqual({ perfect: 0.03, good: 0.07, edge: 0.12, late: 0.2 });
    expect(K.CRICKET_TIMING.normal.perfect).toBeGreaterThan(K.CRICKET_TIMING.hard.perfect);
    expect(K.CRICKET_TIMING.easy.good).toBeGreaterThan(K.CRICKET_TIMING.normal.good);
    const rng = D.createRng(1);
    expect(K.shotFromTiming(0.06, { onStumps: true }, rng, 'easy').runs).toBe(4);
    expect(K.shotFromTiming(0.06, { onStumps: true }, rng, 'hard').runs).toBeLessThan(4);
  });
});

describe('🏏 the user changes the match by asking', () => {
  it('cricketRules.ts starts from the request and is the one place a change goes', () => {
    expect(CRICKET_RULES_PATH).toBe('src/game/cricketRules.ts');
    const src = cricketRulesFileSource('5 over aur 4 wicket ka easy cricket game');
    expect(src).toContain('overs: 5,');
    expect(src).toContain('wickets: 4,');
    expect(src).toContain("difficulty: 'easy'");
    expect(cricketRulesFileSource('cricket game banao')).toContain("difficulty: 'normal'");
    expect(cricketRulesFileSource('100 over')).toContain('overs: 50,');
  });
  it('the builder is told to play through createCricketPlay and CRICKET_RULES, never its own timing', () => {
    const text = generateBoardGames().instructions;
    expect(text).toMatch(/THE PLAY IS createCricketPlay\(\{ layout: f, \.\.\.CRICKET_RULES \}\)/);
    expect(text).toMatch(/is a change to CRICKET_RULES/);
  });
});

describe('🏏 the rules file and the engine compile in the app they ship to', () => {
  it('no diagnostic for cricketRules.ts against the board pack, under the scaffold tsconfig', async () => {
    const ts = await import('typescript');
    const { resolve } = await import('node:path');
    const { tsconfig } = await import('../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents');
    const dir = join(DIR, 'app');
    for (const [p, c] of Object.entries(generateBoardGames().files)) { const f = join(dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
    writeFileSync(join(dir, CRICKET_RULES_PATH), cricketRulesFileSource('5 over easy cricket'));
    const parsed = ts.parseJsonConfigFileContent(JSON.parse(tsconfig), ts.sys, dir);
    const mods = resolve(__dirname, '..', 'node_modules');
    const program = ts.createProgram([join(dir, CRICKET_RULES_PATH)], { ...parsed.options, noEmit: true, typeRoots: [join(mods, '@types')], types: [] });
    const errs = ts.getPreEmitDiagnostics(program).filter((d) => d.file && d.file.fileName.startsWith(dir))
      .map((d) => `${d.file!.fileName.slice(dir.length + 1)} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    expect(errs).toEqual([]);
  }, 120_000);
});
