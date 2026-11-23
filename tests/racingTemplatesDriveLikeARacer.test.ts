// 🏎️ THE RACING TEMPLATES DRIVE LIKE A RACER (template round R4). Ring Rally and Slope Ride are one road-race game in our
// own code: a road seen from behind the car, bends that push the car outward, hills, rivals that keep the pack close, a
// best lap, coins and rocks. These run the REAL materialised App.tsx of each template.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_LIBRARY, materializeGame } from '../src/server/AgentV3/gameLibrary/registry';

const DIR = join(__dirname, `.tmp-road-race-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
const M: Record<string, any> = {};
const SRC: Record<string, string> = {};
beforeAll(async () => {
  for (const id of ['ring-rally', 'slope-ride']) {
    const dir = join(DIR, id); mkdirSync(dir, { recursive: true });
    SRC[id] = materializeGame(GAME_LIBRARY.find((g) => g.id === id)!);
    writeFileSync(join(dir, 'App.tsx'), SRC[id]);
    writeFileSync(join(dir, 'theme.tsx'), 'export default function ThemeToggle() { return null; }\n');
    M[id] = await import(join(dir, 'App.tsx'));
  }
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const noInput = { left: false, right: false, gas: false, brake: false, tilt: 0 };

describe('🏎️ both racing templates are the road race, each in its own mode', () => {
  it('Ring Rally races laps against rivals; Slope Ride is an endless run with lives', () => {
    expect(M['ring-rally'].OPTIONS.mode).toBe('race');
    expect(M['slope-ride'].OPTIONS.mode).toBe('run');
    expect(SRC['ring-rally']).toContain("'ring-rally-best-v1'");
    expect(SRC['slope-ride']).toContain("'slope-ride-best-v1'");
  });
  it('stays editable by chat: named OPTIONS / COURSE / COLORS / COPY blocks, no minified line', () => {
    for (const s of Object.values(SRC)) {
      for (const block of ['export const OPTIONS', 'export const COURSE', 'export const COLORS', 'const COPY']) expect(s).toContain(block);
      expect(Math.max(...s.split('\n').map((l) => l.length))).toBeLessThan(220);
      expect(s).not.toMatch(/__MODE__|__BEST__|__TITLE__|__ACCENT__/);
    }
  });
});

describe('🛣️ the track', () => {
  it('every course comes back to the height it started at, so the loop has no step', () => {
    for (const id of ['ring-rally', 'slope-ride']) {
      const t = M[id].buildTrack();
      expect(t.segments.length).toBeGreaterThan(300);
      expect(t.segments[0].y1).toBe(0);
      expect(Math.abs(t.segments[t.segments.length - 1].y2)).toBeLessThan(1e-6);
      for (let i = 1; i < t.segments.length; i++) expect(t.segments[i].y1).toBe(t.segments[i - 1].y2);
    }
  });
});

describe('🚗 the car', () => {
  const K = () => M['ring-rally'];
  it('the gas speeds it up, coasting slows it, the brake stops it', () => {
    const t = K().buildTrack(); let car = { z: 0, x: 0, speed: 0, distance: 0 };
    for (let i = 0; i < 60; i++) car = K().stepCar(car, { ...noInput, gas: true }, t, 1 / 30);
    expect(car.speed).toBeGreaterThan(K().OPTIONS.maxSpeed * 0.3);
    expect(car.z).toBeGreaterThan(0);
    const coast = K().stepCar(car, noInput, t, 1 / 30);
    expect(coast.speed).toBeLessThan(car.speed);
    let braking = car; for (let i = 0; i < 90; i++) braking = K().stepCar(braking, { ...noInput, brake: true }, t, 1 / 30);
    expect(braking.speed).toBe(0);
  });
  it('a right bend pushes the car to the outside (left) unless the player steers into it', () => {
    const t = K().buildTrack([['bend', 40, 5, 0]]);
    const mid = { z: 20 * K().OPTIONS.segmentLength, x: 0, speed: K().OPTIONS.maxSpeed, distance: 0 };
    expect(K().stepCar(mid, { ...noInput, gas: true }, t, 1 / 30).x).toBeLessThan(0);
    expect(K().stepCar(mid, { ...noInput, gas: true, right: true }, t, 1 / 30).x).toBeGreaterThan(K().stepCar(mid, { ...noInput, gas: true }, t, 1 / 30).x);
  });
  it('off the road the car slows to a crawl', () => {
    const t = K().buildTrack(); const fast = { z: 0, x: 2, speed: K().OPTIONS.maxSpeed, distance: 0 };
    expect(K().stepCar(fast, { ...noInput, gas: true }, t, 0.1).speed).toBeLessThan(fast.speed * 0.95);
  });
  it('tilt steers like the pads', () => {
    const t = K().buildTrack(); const car = { z: 0, x: 0, speed: K().OPTIONS.maxSpeed / 2, distance: 0 };
    expect(K().stepCar(car, { ...noInput, tilt: 0.8 }, t, 1 / 30).x).toBeGreaterThan(0);
    expect(K().stepCar(car, { ...noInput, tilt: -0.8 }, t, 1 / 30).x).toBeLessThan(0);
  });
});

describe('🏁 rivals and hazards', () => {
  it('a rival far behind speeds up and one far ahead eases off (the pack stays close)', () => {
    const K = M['ring-rally']; const t = K.buildTrack(); const seg = K.OPTIONS.segmentLength;
    const player = { z: 200 * seg, x: 0, speed: 0, distance: 200 * seg };
    const behind = { kind: 'rival', offset: 0.5, z: 100 * seg, speed: 1000, color: '' };
    const ahead = { kind: 'rival', offset: 0.5, z: 300 * seg, speed: 1000, color: '' };
    K.stepRivals([behind, ahead], player, t, 1);
    expect(behind.z - 100 * seg).toBeGreaterThan(1000);
    expect(ahead.z - 300 * seg).toBeLessThan(1000);
  });
  it('the player starts behind the pack and passes a rival to gain a place', () => {
    const K = M['ring-rally']; const t = K.buildTrack(); const rivals = K.placeThings(t, 'race', 5);
    expect(K.placeOf({ z: 0, x: 0, speed: 0, distance: 0 }, rivals)).toBe(6);
    expect(K.placeOf({ z: 0, x: 0, speed: 0, distance: rivals[0].z + 1 }, rivals)).toBe(5);
  });
  it('running into a rival slows you to below its speed', () => {
    const K = M['ring-rally']; const t = K.buildTrack();
    const r = { kind: 'rival', offset: 0, z: 1000, speed: 5000, color: '' };
    expect(K.collide({ z: 900, x: 0, speed: 11000, distance: 900 }, [r], t).car.speed).toBeLessThan(5000);
  });
  it('Slope Ride: a rock is a crash, a coin is collected once', () => {
    const K = M['slope-ride']; const t = K.buildTrack(); const things = K.placeThings(t, 'run');
    expect(things.some((x: any) => x.kind === 'rock')).toBe(true);
    expect(things.some((x: any) => x.kind === 'coin')).toBe(true);
    const rock = { kind: 'rock', offset: 0, z: 1000, speed: 0, color: '' }, coin = { kind: 'coin', offset: 0.6, z: 1000, speed: 0, color: '' };
    const crash = K.collide({ z: 950, x: 0, speed: 9000, distance: 0 }, [rock], t);
    expect(crash.crashed).toBe(true); expect(crash.car.speed).toBe(0);
    expect(K.collide({ z: 950, x: 0.6, speed: 9000, distance: 0 }, [coin], t).coins).toBe(1);
    expect(K.collide({ z: 950, x: 0.6, speed: 9000, distance: 0 }, [coin], t).coins).toBe(0);
  });
});
