// A RACE HAS RIVALS, A COUNTDOWN, A PLACE, A CLOCK AND (WHEN ASKED) A FINISH (admin 2026-11-19 game-gap audit, P0 #6).
// Racing games had none of these: no 3-2-1, no other cars to race, no position, no lap timer, no results. These run the
// REAL generated kit: TrackStream.poseAt puts a car on the road's own centre line, and three/race.ts holds everyone at
// the line, drives the rivals along the road, ranks the player, and ends a finite race with results.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-race-kit-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let O: any; let RACE: any; let E: any; let S: any;

beforeAll(async () => {
  for (const r of [generateGameRuntime(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  RACE = await import(join(DIR, 'src/game/three/race.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  S = await import(join(DIR, 'src/game/core/state.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const straight = { pieces: [{ kind: 'straight', length: 400 }], loop: 'infinite', width: 9 };

describe('TrackStream.poseAt — a point on the road at any distance', () => {
  it('starts at the start pose, stays on the centre line a metre per metre, and is null where no road is laid', () => {
    const stream = O.createTrackStream(straight, { detail: 'lite' });
    const p0 = stream.poseAt(0);
    expect(p0.x).toBeCloseTo(stream.startPose.x, 3);
    expect(p0.z).toBeCloseTo(stream.startPose.z, 3);
    expect(p0.heading).toBeCloseTo(stream.startPose.heading, 3);
    const a = stream.poseAt(100), b = stream.poseAt(101);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(1, 1);
    expect(stream.poseAt(1e7)).toBeNull();
    expect(stream.poseAt(Number.NaN)).toBeNull();
    stream.dispose();
  });
  it('follows a curve: the heading turns along the piece', () => {
    const stream = O.createTrackStream({ pieces: [{ kind: 'curve', length: 120, angle: Math.PI / 2 }], loop: 'infinite' }, { detail: 'lite' });
    const turn = stream.poseAt(119).heading - stream.poseAt(1).heading;
    expect(Math.abs(turn)).toBeGreaterThan(1.3);
    stream.dispose();
  });
});

describe('🔴 the race', () => {
  function setup(opts: Record<string, unknown> = {}) {
    const scene = new THREE.Scene();
    const stream = O.createTrackStream(straight, { detail: 'lite' });
    scene.add(stream.root);
    const heard: Array<[string, any]> = [];
    const offs = ['RACE_COUNTDOWN', 'RACE_STARTED', 'RACE_STATUS', 'RACE_FINISHED'].map((e) => E.events.on(e, (p: any) => heard.push([e, p])));
    const race = RACE.createRace(scene, { stream, ...opts });
    return { scene, stream, race, heard, done: () => { race.dispose(); stream.dispose(); offs.forEach((o: () => void) => o()); } };
  }

  it('3-2-1-GO holds everyone at the line: no driving, no rival moves, until GO', () => {
    const t = setup({ opponents: 3, countdown: 3 });
    expect(t.race.rivals).toHaveLength(3);
    expect(t.race.canDrive()).toBe(false);
    const start = t.race.rivals.map((r: any) => r.distance);
    for (let i = 0; i < 170; i++) t.race.update(1 / 60, 0);
    expect(t.race.canDrive()).toBe(false);
    expect(t.race.rivals.map((r: any) => r.distance)).toEqual(start);
    for (let i = 0; i < 20; i++) t.race.update(1 / 60, 0);
    expect(t.race.canDrive()).toBe(true);
    expect(t.heard.filter(([e]) => e === 'RACE_COUNTDOWN').map(([, p]) => p.n)).toEqual([3, 2, 1, 0]);
    expect(t.heard.some(([e]) => e === 'RACE_STARTED')).toBe(true);
    t.done();
  });
  it('rivals drive the road in their own lanes and pass a player who stays at the line (last place)', () => {
    const t = setup({ opponents: 3, countdown: 0 });
    for (let i = 0; i < 300; i++) t.race.update(1 / 60, 0);
    for (const r of t.race.rivals) {
      expect(r.distance).toBeGreaterThan(40);
      const pose = t.stream.poseAt(r.distance);
      expect(Math.hypot(r.car.position.x - pose.x, r.car.position.z - pose.z)).toBeCloseTo(Math.abs(r.lane), 1);
      expect(r.car.rotation.y).toBeCloseTo(pose.heading, 3);
    }
    expect(t.race.status().position).toBe(4);
    const live = t.heard.filter(([e]) => e === 'RACE_STATUS').at(-1)![1];
    expect(live).toMatchObject({ position: 4, total: 4, finish: null });
    t.done();
  });
  it('a player who pulls away leads; the rivals are rubber-banded so the race stays close', () => {
    const t = setup({ opponents: 2, countdown: 0, maxSpeed: 20 });
    let d = 0;
    for (let i = 0; i < 600; i++) { d += 30 / 60; t.race.update(1 / 60, d); }
    expect(t.race.status().position).toBe(1);
    const fastest = Math.max(...t.race.rivals.map((r: any) => r.speed));
    expect(fastest).toBeGreaterThan(20 * 0.82 * 0.94);     // pushed above their plain pace by the gap
    t.done();
  });
  it('an endless race (the default) never finishes', () => {
    const t = setup({ opponents: 1, countdown: 0 });
    let d = 0;
    for (let i = 0; i < 1200; i++) { d += 40 / 60; t.race.update(1 / 60, d); }
    expect(t.race.status().phase).toBe('racing');
    expect(t.heard.some(([e]) => e === 'RACE_FINISHED')).toBe(false);
    t.done();
  });
  it('a finite race ends at the line with ordered results, ends the round, and Play again runs it from the grid', () => {
    S.setStatus('playing');
    const t = setup({ opponents: 3, countdown: 1, finishDistance: 300 });
    for (let i = 0; i < 70; i++) t.race.update(1 / 60, 0);    // through the countdown
    let d = 0;
    for (let i = 0; i < 1200 && t.race.status().phase !== 'finished'; i++) { d += 26 / 60; t.race.update(1 / 60, d); }
    const st = t.race.status();
    expect(st.phase).toBe('finished');
    expect(st.results).toHaveLength(4);
    const times = st.results.map((r: any) => r.time ?? Infinity);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(st.results.filter((r: any) => r.player)).toHaveLength(1);
    const fin = t.heard.find(([e]) => e === 'RACE_FINISHED')![1];
    expect(fin.position).toBe(st.results.findIndex((r: any) => r.player) + 1);
    expect(S.state.status).toBe(fin.position === 1 ? 'won' : 'gameover');
    expect(RACE.lastRaceResults).toEqual(st.results);
    expect(t.race.canDrive()).toBe(false);
    S.setStatus('playing');                                   // Play again
    expect(t.race.status().phase).toBe('countdown');
    expect(RACE.lastRaceResults).toBeNull();
    expect(t.race.rivals.every((r: any) => r.distance < 0 && r.finishTime === null)).toBe(true);
    t.done();
  });
});

describe('the racing starter and the Hud use it', () => {
  const shell = generateGameShell().files;
  it('RacingRoadGame races 3 rivals by default, holds the car at the line through the countdown, and stays endless', () => {
    const src = shell['src/game/RacingRoadGame.tsx'];
    expect(src).toMatch(/opponents = 3, finishKm = null/);
    expect(src).toMatch(/race = createRace\(ctx\.scene, \{ stream, opponents, finishDistance: finishKm != null && finishKm > 0 \? finishKm \* 1000 : null \}\)/);
    expect(src).toMatch(/if \(!race \|\| race\.canDrive\(\)\) drive = driveVehicle\(car, drive, ctx\.input\.axis\(\), dt\);/);
    expect(src).toMatch(/'P' \+ standing\.position \+ '\/' \+ standing\.total/);
  });
  it('the Hud shows the countdown and the place, and lists a finished race\'s results on the end screen', () => {
    const hud = shell['src/game/ui/Hud.tsx'];
    expect(hud).toMatch(/export function RaceOverlay\(\)/);
    expect(hud).toMatch(/<RaceOverlay \/>/);
    expect(hud).toMatch(/aria-label="Race results"/);
  });
});
