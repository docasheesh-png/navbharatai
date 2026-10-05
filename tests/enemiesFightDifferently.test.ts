// ENEMIES FIGHT DIFFERENTLY, AND FAIRLY (2026-10-05, the game-engine taxonomy: game AI, combat).
//
// Every generated enemy was a melee chaser: it ran straight at the player, so a shooter's enemies queued up
// to be shot and a crowd arrived from one side. And every hit landed the instant an enemy was in range, so
// nothing could be dodged. ai.ts now has roles (ranged holds its distance and strafes; flankers surround),
// telegraphed attacks (a readable wind-up, dodgeable) and boss phases that only advance.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';

const DIR = join(__dirname, `.tmp-game-meta-ai-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let AI: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGameSystems(['ai']).files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  AI = await import(join(DIR, 'src/game/systems/ai.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const player = { x: 0, z: 0 };
const simulate = (cfg: any, starts: Array<[number, number]>, seconds: number, see = true) => {
  let states = starts.map(([x, z]) => AI.initialEnemyState(x, z));
  const trace: any[][] = states.map(() => []);
  let shots = 0;
  for (let i = 0; i < seconds * 60; i++) {
    states = states.map((s: any, k: number) => {
      const neighbours = states.filter((_: any, j: number) => j !== k).map((o: any) => o.position);
      const d = AI.stepEnemyAI(s, { player, neighbours, canSeePlayer: see }, cfg, 1 / 60);
      if (d.wantsAttack) shots++;
      trace[k].push({ ...d.state.position });
      return d.state;
    });
  }
  return { states, trace, shots };
};
const dist = (p: any) => Math.hypot(p.x, p.z);

describe('a ranged enemy holds its distance and moves', () => {
  it('backs off when rushed, closes in when far, settles in its band — and shoots from there', () => {
    const near = simulate(AI.RANGED_ENEMY, [[0, 3]], 6);
    expect(dist(near.states[0].position)).toBeGreaterThan(6.5);
    const far = simulate(AI.RANGED_ENEMY, [[0, 18]], 6);
    expect(dist(far.states[0].position)).toBeLessThan(12.5);
    expect(dist(far.states[0].position)).toBeGreaterThan(6.5);
    expect(far.shots).toBeGreaterThan(60);
    for (const p of far.trace[0].slice(60)) expect(dist(p)).toBeGreaterThan(2);   // never walks into melee range
  });

  it('strafes inside the band — a shooter that stands still is a target', () => {
    const r = simulate(AI.RANGED_ENEMY, [[0, 10]], 4);
    const a = r.trace[0][60], b = r.trace[0][r.trace[0].length - 1];
    expect(Math.abs(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z))).toBeGreaterThan(0.3);
  });

  it('does not shoot what it cannot see', () => {
    expect(simulate(AI.RANGED_ENEMY, [[0, 10]], 2, false).shots).toBe(0);
  });
});

describe('flankers surround; chasers queue', () => {
  it('four enemies from the same side: flankers end up around the player, melee ones stay bunched', () => {
    const starts: Array<[number, number]> = [[1.3, 14], [-0.7, 15], [2.9, 15.5], [-2.1, 14.5]];
    const spread = (cfg: any) => {
      // Where each one ARRIVES FROM: its angle the first time it comes within 5 m. (At the end, separation
      // rings any group round the player — the difference is the direction of the attack.)
      const { trace } = simulate(cfg, starts, 6);
      const arrivals = trace.map((path: any[]) => path.find((p) => dist(p) < 5) ?? path[path.length - 1]);
      // The arc they cover: 2π minus the largest empty gap (angles wrap at ±π).
      const angles = arrivals.map((p: any) => Math.atan2(p.x, p.z)).sort((x: number, y: number) => x - y);
      let gap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
      for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
      return Math.PI * 2 - gap;
    };
    expect(spread(AI.FLANKER_ENEMY)).toBeGreaterThan(spread(AI.DEFAULT_ENEMY) + 0.6);
    expect(spread(AI.FLANKER_ENEMY)).toBeGreaterThan(1.2);
  });

  it('a flanker still arrives and attacks', () => {
    const r = simulate(AI.FLANKER_ENEMY, [[0, 14]], 8);
    expect(dist(r.states[0].position)).toBeLessThan(AI.FLANKER_ENEMY.attackRadius + 0.5);
    expect(r.shots).toBeGreaterThan(0);
  });

  it('the default enemy is unchanged: it comes straight in', () => {
    const r = simulate(AI.DEFAULT_ENEMY, [[0, 14]], 3);
    for (const p of r.trace[0]) expect(Math.abs(p.x)).toBeLessThan(1e-9);
  });
});

describe('a telegraphed attack can be read and dodged', () => {
  it('wind-up → ONE strike step → recovery → ready, and no new attack until then', () => {
    const t = new AI.AttackTelegraph(0.45, 0.6);
    expect(t.request()).toBe(true);
    const phases: string[] = [];
    for (let i = 0; i < 90; i++) phases.push(t.update(1 / 60));
    expect(phases.filter((p) => p === 'strike')).toHaveLength(1);
    expect(phases.indexOf('strike')).toBe(26);                 // 27 steps of 1/60 ≥ 0.45 s
    expect(t.request()).toBe(true);                            // ready again after 0.6 s of recovery
    const t2 = new AI.AttackTelegraph(); t2.request(); t2.update(0.1);
    expect(t2.request()).toBe(false);                          // mid wind-up: cannot restart
    expect(t2.progress).toBeGreaterThan(0.2);
  });
});

describe('a boss fight has phases', () => {
  it('advances at each threshold once, and never replays a transition when healed', () => {
    const b = new AI.BossPhases([0.66, 0.33]);
    expect(b.update(1)).toEqual({ phase: 0, changed: false });
    expect(b.update(0.6)).toEqual({ phase: 1, changed: true });
    expect(b.update(0.5)).toEqual({ phase: 1, changed: false });
    expect(b.update(0.9)).toEqual({ phase: 1, changed: false });
    expect(b.update(0.1)).toEqual({ phase: 2, changed: true });
  });
});
