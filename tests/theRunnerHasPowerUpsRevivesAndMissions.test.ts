// THE RUNNER HAS POWER-UPS, REVIVES AND MISSIONS (template round R10, kit part). Runs the REAL generated core/runner.ts
// and LaneRunnerGame.tsx. A seed still lays exactly the same course (power-ups have their own random stream), every
// power-up sits in a lane with a way through, magnet / shield / double do what they say and run out, a crash can be
// revived once, missions count the right things and raise the score multiplier, and the starter offers "Keep running"
// for a few seconds before game over (or goes straight to game over when revives are off).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';

const DIR = join(__dirname, `.tmp-runner-extras-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let K: any; let R: any; let S: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameSystems(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  }
  K = await import(join(DIR, 'src/game/core/runner.ts'));
  R = await import(join(DIR, 'src/game/LaneRunnerGame.tsx'));
  S = await import(join(DIR, 'src/game/core/state.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
beforeEach(() => { S.setStatus('menu'); S.resetRun?.(); });

const layout = (run: any) => JSON.stringify({ o: run.obstacles, c: run.pickups });

describe('🧲 power-ups in the kit runner', () => {
  it('a seed lays exactly the same obstacles and coins with power-ups on or off', () => {
    for (const seed of [1, 7, 42, 999]) {
      const on = new K.LaneRunner({ seed, spawnAhead: 3000 }), off = new K.LaneRunner({ seed, spawnAhead: 3000, powerUpChance: 0 });
      expect(layout(on)).toBe(layout(off));
      expect(on.powerUps.length).toBeGreaterThan(0); expect(off.powerUps).toEqual([]);
      on.reset(seed + 1); off.reset(seed + 1);
      expect(layout(on)).toBe(layout(off));
    }
  });
  it('every power-up sits in a lane with no block in its row, and all three kinds appear', () => {
    const kinds = new Set<string>();
    for (const lanes of [1, 3, 5]) {
      const run = new K.LaneRunner({ seed: lanes * 13, lanes, spawnAhead: 4000 });
      for (const p of run.powerUps) {
        kinds.add(p.kind);
        expect(run.obstacles.some((o: any) => o.lane === p.lane && o.kind === 'block' && Math.abs(o.z - p.z) < 1)).toBe(false);
      }
    }
    expect([...kinds].sort()).toEqual(['double', 'magnet', 'shield']);
  });
  it('a magnet pulls in coins from every lane, double counts each coin twice, and both run out', () => {
    const run = new K.LaneRunner({ seed: 5, powerUpChance: 0, magnetSeconds: 2, doubleSeconds: 2 });
    run.obstacles = []; run.pickups = [{ id: 1, lane: 0, z: run.distance + 1 }, { id: 2, lane: 2, z: run.distance + 1.2 }];
    run.magnet = 2;
    const evs = run.update(0.05);
    expect(evs.filter((e: any) => e.type === 'coin')).toHaveLength(2);
    run.double = 2; run.obstacles = []; run.pickups = [{ id: 3, lane: run.lane, z: run.distance + 0.3 }];
    const before = run.coins; run.update(0.05);
    expect(run.coins - before).toBe(2);
    for (let i = 0; i < 60; i++) { run.obstacles = []; run.update(0.05); }
    expect(run.magnet).toBe(0); expect(run.double).toBe(0);
  });
  it('a shield takes one hit and the run goes on; the next hit after the grace ends the run', () => {
    const run = new K.LaneRunner({ seed: 9, powerUpChance: 0 });
    const wall = (z: number) => { run.obstacles = [{ id: 900 + z, lane: run.lane, z: run.distance + z, kind: 'block' }]; };
    run.shield = 10; wall(0.2);
    const evs = run.update(0.05);
    expect(evs.map((e: any) => e.type)).toContain('shielded'); expect(run.alive).toBe(true); expect(run.shield).toBe(0);
    for (let i = 0; i < 40; i++) { run.obstacles = []; run.update(0.05); }
    wall(0.2); run.update(0.05);
    expect(run.alive).toBe(false);
  });
  it('picking a power-up up switches it on', () => {
    const run = new K.LaneRunner({ seed: 2, powerUpChance: 0, shieldSeconds: 7 });
    run.obstacles = []; run.powerUps = [{ id: 1, lane: run.lane, z: run.distance + 0.3, kind: 'shield' }];
    const evs = run.update(0.05);
    expect(evs.some((e: any) => e.type === 'powerup' && e.power.kind === 'shield')).toBe(true);
    expect(run.shield).toBeGreaterThan(6.5); expect(run.powerUps).toEqual([]);
  });
});

describe('❤️ revive', () => {
  const crash = (run: any) => { run.obstacles = [{ id: 1, lane: run.lane, z: run.distance + 0.2, kind: 'block' }]; run.update(0.05); };
  it('only after a crash, only as many times as allowed, and the road ahead is clear', () => {
    const run = new K.LaneRunner({ seed: 3, powerUpChance: 0 });
    expect(run.revive()).toBe(false);
    crash(run); expect(run.alive).toBe(false);
    run.obstacles.push({ id: 2, lane: run.lane, z: run.distance + 5, kind: 'block' }, { id: 3, lane: 0, z: run.distance + 500, kind: 'low' });
    expect(run.revive()).toBe(true);
    expect(run.alive).toBe(true); expect(run.grace).toBeGreaterThan(0);
    expect(run.obstacles.map((o: any) => o.id)).toEqual([3]);
    crash(run); expect(run.alive).toBe(true);         // grace: passes through
    for (let i = 0; i < 40; i++) { run.obstacles = []; run.update(0.05); }
    crash(run); expect(run.alive).toBe(false);
    expect(run.revive()).toBe(false);
    run.reset(); expect(run.revivesLeft).toBe(1);
    const none = new K.LaneRunner({ seed: 3, revives: 0, powerUpChance: 0 });
    crash(none); expect(none.revive()).toBe(false);
  });
});

describe('🎯 missions', () => {
  it('three different goals a level, bigger each level, and a multiplier that climbs', () => {
    for (let level = 0; level < 8; level++) {
      const goals = K.RunnerMissions.goalsFor(level);
      expect(new Set(goals.map((g: any) => g.kind)).size).toBe(3);
      for (const g of goals) expect(g.target).toBe(Math.round(K.RUNNER_MISSION_BASE[g.kind] * (1 + level * 0.5)));
    }
    const m = new K.RunnerMissions(); expect(m.level).toBe(0); expect(m.multiplier).toBe(1);
    m.level = 4; expect(m.multiplier).toBe(5); m.level = 99; expect(m.multiplier).toBe(30);
  });
  it('counts the right events, keeps distance to one run, and levels up when all three are done', () => {
    const m = new K.RunnerMissions({ level: 0, goals: [
      { kind: 'distance', target: 100, progress: 0 }, { kind: 'jumps', target: 2, progress: 0 }, { kind: 'coins', target: 3, progress: 0 }] });
    m.track([{ type: 'jump' }, { type: 'coin' }, { type: 'slide' }], { distance: 60 });
    expect(m.goals.map((g: any) => g.progress)).toEqual([60, 1, 1]);
    m.newRun(); expect(m.goals[0].progress).toBe(0);
    const a = m.track([{ type: 'jump' }], { distance: 10 });
    expect(a.finished.map((g: any) => g.kind)).toEqual(['jumps']); expect(a.levelledUp).toBe(false);
    m.track([{ type: 'coin' }, { type: 'coin' }], { distance: 20 });
    const b = m.track([], { distance: 100 });
    expect(b.levelledUp).toBe(true); expect(m.level).toBe(1); expect(m.multiplier).toBe(2);
    expect(m.goals.every((g: any) => g.progress === 0)).toBe(true);
  });
  it('a save comes back the same, and a broken save starts fresh', () => {
    const m = new K.RunnerMissions(); m.level = 3; m.goals = K.RunnerMissions.goalsFor(3); m.goals[1].progress = 4;
    expect(new K.RunnerMissions(JSON.parse(JSON.stringify(m.save()))).save()).toEqual(m.save());
    for (const bad of [null, 'x', { level: 2 }, { level: 1, goals: [{ kind: 'fly', target: 1, progress: 0 }] }]) {
      const f = new K.RunnerMissions(bad); expect(f.level).toBe(0); expect(f.goals).toHaveLength(3);
    }
  });
  it('the score is distance plus coins, times the multiplier', () => {
    const run = new K.LaneRunner({ seed: 1 }); run.distance = 123.9; run.coins = 4;
    expect(run.score).toBe(163); run.scoreMultiplier = 3; expect(run.score).toBe(489);
  });
});

describe('🏃 the starter uses them', () => {
  function start(props: object) {
    const scene = new THREE.Scene();
    const pressed = new Set<string>();
    const input = { press: (a: string) => pressed.add(a), wasPressed: (a: string) => pressed.has(a), endFrame: () => pressed.clear(), isDown: () => false, axis: () => ({ x: 0, y: 0 }) };
    const ctx: any = { scene, input, follow: () => {} };
    const game = R.createLaneRunnerScene(props);
    game.setup(ctx);
    S.setStatus('playing');
    return { game, ctx, input, scene };
  }
  const step = (s: any, seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) { s.game.update(s.ctx, 1 / 60); s.input.endFrame(); } };
  const crashNow = (s: any) => {
    const run = s.game.run;
    run.shield = 0; run.grace = 0;
    run.obstacles.push({ id: 77_000 + Math.round(run.distance), lane: run.lane, z: run.distance + 0.3, kind: 'block' });
    step(s, 0.1);
  };
  it('after a crash it offers "Keep running" for a few seconds, then game over', () => {
    const s = start({ seed: 3, reviveSeconds: 2 });
    crashNow(s);
    expect(s.game.run.alive).toBe(false); expect(S.state.status).toBe('playing');
    expect(s.game.hud().reviveOffer).toBeGreaterThan(1.5);
    step(s, 2.2);
    expect(S.state.status).toBe('gameover'); expect(s.game.hud().reviveOffer).toBe(0);
    s.game.dispose();
  });
  it('taking the revive keeps the run going; the next crash is game over', () => {
    const s = start({ seed: 4 });
    crashNow(s);
    const at = s.game.run.distance;
    expect(s.game.revive()).toBe(true);
    step(s, 0.5);
    expect(s.game.run.alive).toBe(true); expect(s.game.run.distance).toBeGreaterThan(at);
    step(s, 2); crashNow(s);
    expect(S.state.status).toBe('gameover'); expect(s.game.revive()).toBe(false);
    s.game.dispose();
  });
  it('with revives off a crash is game over at once, as before', () => {
    const s = start({ seed: 3, revives: 0 });
    crashNow(s);
    expect(S.state.status).toBe('gameover');
    s.game.dispose();
  });
  it('draws the power-ups the rules hold and reports missions in the overlay; the kit score is the run score', () => {
    const s = start({ seed: 8, powerUpChance: 1 });
    step(s, 0.05);
    const root = s.scene.getObjectByName('Lane runner')!;
    const powerMeshes = root.children.filter((c: any) => c.isMesh && ['TorusGeometry', 'SphereGeometry', 'OctahedronGeometry'].includes(c.geometry?.type) && c.position.y === 1);
    expect(s.game.run.powerUps.length).toBeGreaterThan(0);
    for (const p of s.game.run.powerUps) expect(powerMeshes.filter((m: any) => m.position.z === p.z)).toHaveLength(1);
    const hud = s.game.hud();
    expect(hud.missions).toHaveLength(3); expect(hud.multiplier).toBe(1);
    expect(R.missionText({ kind: 'coins', target: 40, progress: 0 })).toBe('Collect 40 coins');
    s.game.missions.goals = s.game.missions.goals.map((g: any) => ({ ...g, progress: g.target }));
    s.game.missions.goals[0] = { kind: 'distance', target: 1, progress: 0 };
    step(s, 0.2);
    expect(s.game.run.scoreMultiplier).toBe(2); expect(s.game.hud().toast).toMatch(/×2/);
    expect(S.state.score).toBe(s.game.run.score);
    s.game.dispose();
  });
  it('missions can be switched off', () => {
    const s = start({ seed: 8, missions: false });
    expect(s.game.missions).toBeNull(); expect(s.game.hud().missions).toEqual([]);
    s.game.dispose();
  });
});
