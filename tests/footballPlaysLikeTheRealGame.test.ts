// ⚽ FOOTBALL PLAYS LIKE THE REAL GAME (template round R5, owner decision: a football kit). These run the REAL generated
// src/game/board/football.ts and the humanoid's keeper dive.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateBoardGames } from '../src/server/lib/BoardGamesGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-football-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let F: any; let H: any;
beforeAll(async () => {
  const files = { ...generateBoardGames(['football']).files, ...generateGame3D().files };
  for (const [p, c] of Object.entries(files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c as string); }
  F = await import(join(DIR, 'src/game/board/football.ts'));
  H = await import(join(DIR, 'src/game/three/humanoid.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const d = (a: any, b: any) => Math.hypot(a.x - b.x, a.z - b.z);
const run = (ball: any, pitch: any, touch: 'home' | 'away' = 'home', seconds = 6) => {
  let r: any = { ball, goal: null, out: null };
  for (let i = 0; i < seconds * 60 && !r.goal && !r.out; i++) r = F.stepBall(r.ball, 1 / 60, pitch, touch);
  return r;
};

describe('⚽ footballLayout — the pitch a fan recognises', () => {
  for (const heading of [0, Math.PI / 2, -2.4]) for (const players of [5, 7, 11] as const) {
    it(`heading ${heading.toFixed(1)}, ${players}-a-side: each team in its own half, keepers in their area, all facing the goal they attack`, () => {
      const p = F.footballLayout({ centre: { x: 12, z: -30 }, heading, players });
      expect(p.players).toHaveLength(players * 2);
      expect(F.checkFootballLayout(p, p.players)).toEqual([]);
      expect(d(p.goals.home.centre, p.goals.away.centre)).toBeCloseTo(p.length, 6);
      expect(d(p.goals.away.leftPost, p.goals.away.rightPost)).toBeCloseTo(F.GOAL_WIDTH, 6);
      expect(d(p.penaltySpots.away, p.goals.away.centre)).toBeCloseTo(F.PENALTY_SPOT, 6);
      const gk = p.players.filter((x: any) => x.role === 'GK');
      expect(gk).toHaveLength(2);
      expect(d(gk[0], p.goals.home.centre)).toBeLessThan(5);
    });
  }
  it('flags a keeper in the wrong goal, a player in the other half and one facing his own goal', () => {
    const p = F.footballLayout({ players: 5 });
    const bad = p.players.map((x: any) => ({ ...x }));
    bad[0] = { ...bad[0], ...p.goals.away.centre, x: p.goals.away.centre.x, z: p.goals.away.centre.z - 2 };
    bad[3] = { ...bad[3], z: 10 };
    bad[4] = { ...bad[4], yaw: bad[4].yaw + Math.PI };
    const problems = F.checkFootballLayout(p, bad).join(' | ');
    expect(problems).toMatch(/keeper/);
    expect(problems).toMatch(/other team's half/);
    expect(problems).toMatch(/does not face/);
  });
});

describe('⚽ the ball', () => {
  const p = () => F.footballLayout({ length: 60, width: 40 });
  const atSpot = (s: any) => ({ x: s.x, y: F.BALL_RADIUS, z: s.z, vx: 0, vy: 0, vz: 0 });
  it('a shot along the ground between the posts is a goal for the team that shot', () => {
    const pitch = p();
    const r = run(F.kickBall(atSpot(pitch.penaltySpots.away), pitch.goals.away.centre, { power: 0.7 }), pitch);
    expect(r.goal).toBe('home');
  });
  it('the same shot at the other end scores for away', () => {
    const pitch = p();
    expect(run(F.kickBall(atSpot(pitch.penaltySpots.home), pitch.goals.home.centre, { power: 0.7 }), pitch, 'away').goal).toBe('away');
  });
  it('wide of the post is no goal: a goal kick, or a corner when the defenders touched it last', () => {
    const pitch = p(); const post = pitch.goals.away.leftPost, out = Math.sign(post.x - pitch.goals.away.centre.x);
    const wide = { x: post.x + 3 * out, z: post.z };
    const shot = F.kickBall(atSpot(pitch.penaltySpots.away), wide, { power: 0.7 });
    const r = run(shot, pitch, 'home');
    expect(r.goal).toBeNull(); expect(r.out.kind).toBe('goal-kick'); expect(r.out.team).toBe('away');
    const c = run(shot, pitch, 'away');
    expect(c.out.kind).toBe('corner'); expect(c.out.team).toBe('home');
  });
  it('over the bar is no goal', () => {
    const pitch = p();
    expect(run(F.kickBall(atSpot(pitch.penaltySpots.away), pitch.goals.away.centre, { power: 1, loft: 0.7 }), pitch).goal).toBeNull();
  });
  it('over the touchline is a throw-in to the other team', () => {
    const pitch = p();
    const r = run(F.kickBall(atSpot(pitch.centreSpot), { x: pitch.centre.x + 50, z: pitch.centre.z }, { power: 0.6 }), pitch, 'home');
    expect(r.out.kind).toBe('throw-in'); expect(r.out.team).toBe('away');
  });
  it('a pass rolls, slows down and stops; a lofted ball bounces and comes down', () => {
    const pitch = F.footballLayout();
    let b = F.kickBall(atSpot(pitch.centreSpot), { x: 0, z: 30 }, { power: 0.4 });
    const speeds: number[] = [];
    for (let i = 0; i < 600; i++) { b = F.stepBall(b, 1 / 60, pitch).ball; speeds.push(Math.hypot(b.vx, b.vz)); }
    expect(speeds[60]).toBeLessThan(speeds[0]);
    expect(speeds[599]).toBe(0);
    let l = F.kickBall(atSpot(pitch.centreSpot), { x: 0, z: 40 }, { power: 0.6, loft: 0.6 });
    let peak = 0;
    for (let i = 0; i < 400; i++) { l = F.stepBall(l, 1 / 60, pitch).ball; peak = Math.max(peak, l.y); }
    expect(peak).toBeGreaterThan(2);
    expect(l.y).toBeCloseTo(F.BALL_RADIUS, 3);
  });
});

describe('🧤 players that think', () => {
  it('the keeper stands between the ball and the goal centre, and dives the right way at a shot', () => {
    const p = F.footballLayout({ length: 60, width: 40 });
    const ballRight = { x: 10, y: F.BALL_RADIUS, z: 20, vx: 0, vy: 0, vz: 0 };   // toward the away goal at +Z, off to +X
    const k = F.keeperMove(p, 'away', ballRight);
    expect(k.dive).toBeNull();
    expect(k.to.x).toBeGreaterThan(0);                                         // shifted toward the ball's side
    expect(Math.abs(k.to.x)).toBeLessThanOrEqual(F.GOAL_WIDTH / 2);
    // The away keeper faces −Z; with Y up his right is +X. A fast shot to the −X corner: he dives left.
    const shot = F.kickBall({ x: 0, y: F.BALL_RADIUS, z: 20, vx: 0, vy: 0, vz: 0 }, { x: -3.2, z: 30 }, { power: 0.9 });
    expect(F.keeperMove(p, 'away', { ...shot, z: 25 }).dive).toBe('left');
    const other = F.kickBall({ x: 0, y: F.BALL_RADIUS, z: 20, vx: 0, vy: 0, vz: 0 }, { x: 3.2, z: 30 }, { power: 0.9 });
    expect(F.keeperMove(p, 'away', { ...other, z: 25 }).dive).toBe('right');
  });
  it('the team keeps its shape: everyone shifts toward the ball, the keeper stays', () => {
    const p = F.footballLayout({ players: 7 });
    const ball = { x: 0, z: 30 };
    for (const pl of p.players.filter((x: any) => x.team === 'home')) {
      const s = F.shapeSpot(p, pl, ball);
      if (pl.role === 'GK') expect(s).toEqual(pl); else expect(s.z).toBeGreaterThan(pl.z);
    }
    const c = F.chaser(p, p.players, 'home', ball);
    expect(c.role).not.toBe('GK');
  });
  it('passTarget picks an open team-mate ahead, not one marked', () => {
    const p = F.footballLayout({ players: 5 });
    const home = p.players.filter((x: any) => x.team === 'home');
    const from = home.find((x: any) => x.role === 'DF');
    const fwds = home.filter((x: any) => x.role === 'FW');
    const marked = F.passTarget(p, from, home, [{ x: fwds[0].x, z: fwds[0].z + 0.5 }]);
    expect(marked).toBe(fwds[1]);
  });
});

describe('🕒 the match', () => {
  it('two halves, half time, the other team kicks off, a result', () => {
    let m = F.createFootballMatch({ teams: ['Mumbai', 'Pune'], minutesPerHalf: 1 });
    m = F.scoreGoal(m, 'home', 'A');
    expect(m.kickOff).toBe('away');
    m = F.tickMatch(m, 61);
    expect(m.phase).toBe('half-time');
    expect(F.scoreline(m)).toBe('Mumbai 1–0 Pune · HT');
    expect(F.scoreGoal(m, 'away').score.away).toBe(0);                          // no goals at half time
    m = F.resume(m); m = F.tickMatch(m, 30);
    expect(F.matchMinute(m)).toBe(68);
    m = F.scoreGoal(m, 'away', 'B'); m = F.scoreGoal(m, 'away', 'C');
    m = F.tickMatch(m, 31);
    expect(m.phase).toBe('full-time');
    expect(m.result).toBe('Pune won 2–1');
    expect(m.goals.map((g: any) => g.minute)).toEqual([1, 68, 68]);
  });
  it('a shoot-out ends when one side cannot be caught, and goes to sudden death when level', () => {
    let s = F.createShootout('home');
    for (const [h, a] of [[true, false], [true, false], [true, false]]) { s = F.takePenalty(s, h); if (!s.winner) s = F.takePenalty(s, a); }
    expect(s.winner).toBe('home');                                               // 3–0 with two left for away: cannot be caught
    let t = F.createShootout('home');
    for (let i = 0; i < 10; i++) t = F.takePenalty(t, true);
    expect(t.winner).toBeNull();
    t = F.takePenalty(t, true); t = F.takePenalty(t, false);
    expect(t.winner).toBe('home');
  });
  it('a penalty aimed inside the posts and kept low scores; the aim runs from the taker\'s left to right', () => {
    const p = F.footballLayout({ length: 60, width: 40 });
    for (const aim of [0.15, 0.5, 0.85]) expect(run(F.penaltyShot(p, 'away', aim, 0.2).ball, p).goal).toBe('home');
    const l = F.penaltyShot(p, 'away', 0, 0).target, r = F.penaltyShot(p, 'away', 1, 0).target;
    expect(d(l, p.goals.away.leftPost)).toBeLessThan(1e-9);
    expect(d(r, p.goals.away.rightPost)).toBeLessThan(1e-9);
  });
});

describe('🧤 the keeper dives', () => {
  for (const [name, sign] of [['dive', 1], ['dive-left', -1]] as const) {
    it(`act('${name}') lays the body out to that side and gets back up`, () => {
      const h = H.createHumanoid();
      h.update(1 / 60, 0, true); h.act(name);
      let tip = 0;
      for (let i = 0; i < Math.ceil(H.ACTION_SECONDS[name] * 60) + 2; i++) {
        h.update(1 / 60, 0, true);
        const z = h.joints.hips.rotation.z;
        tip = sign > 0 ? Math.max(tip, z) : Math.min(tip, z);
      }
      expect(Math.abs(tip)).toBeGreaterThan(0.8);
      expect(h.acting()).toBeNull();
      expect(h.joints.hips.rotation.z).toBe(0);
    });
  }
});
