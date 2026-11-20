// THE ENDLESS RUNNER AND SWIPE (admin 2026-11-20 game-gap audit: no swipe and no runner in the kit, so every runner was
// hand-written with the same bugs — a row with no way through, a fast run jumping clean THROUGH an obstacle between two
// frames, LEFT going right). These run the REAL generated core/runner.ts and core/swipe.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime, GAME_RUNTIME_MODULES } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-runner-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let R: any;
let S: any;

beforeAll(async () => {
  const { files } = generateGameRuntime(['runner', 'swipe']);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  R = await import(join(DIR, 'src/game/core/runner.ts'));
  S = await import(join(DIR, 'src/game/core/swipe.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A player who reads the next row and takes the way through it: a free lane, else jump a 'low', slide a 'high'. */
function autopilot(run: any): { left?: boolean; right?: boolean; jump?: boolean; slide?: boolean } {
  const ahead = run.obstacles.filter((o: any) => o.z + 0.6 >= run.distance);
  if (!ahead.length) return {};
  const z = Math.min(...ahead.map((o: any) => o.z));
  const row = ahead.filter((o: any) => o.z === z);
  const at = (l: number) => row.find((o: any) => o.lane === l);
  let target = run.lane;
  if (at(run.lane)?.kind === 'block') {
    let best = -1;
    for (let l = 0; l < run.lanes; l++) if (!at(l) && (best < 0 || Math.abs(l - run.lane) < Math.abs(best - run.lane))) best = l;
    if (best < 0) for (let l = 0; l < run.lanes; l++) if (at(l)?.kind !== 'block' && (best < 0 || Math.abs(l - run.lane) < Math.abs(best - run.lane))) best = l;
    target = best;
  }
  const mine = at(target);
  const dist = z - run.distance;
  return {
    left: target < run.lane,
    right: target > run.lane,
    jump: target === run.lane && mine?.kind === 'low' && !run.jumping && dist < run.speed * 0.3 && dist > 0,
    slide: target === run.lane && mine?.kind === 'high' && !run.sliding && dist < run.speed * 0.25 && dist > 0,
  };
}

describe('the lane runner', () => {
  it('ships in the runtime and lists its modules', () => {
    expect(GAME_RUNTIME_MODULES).toEqual(expect.arrayContaining(['runner', 'swipe']));
    const all = generateGameRuntime();
    expect(Object.keys(all.files)).toEqual(expect.arrayContaining(['src/game/core/runner.ts', 'src/game/core/swipe.ts']));
    expect(all.instructions).toMatch(/LaneRunner/);
    expect(all.instructions).toMatch(/bindSwipe/);
    // swipe.ts imports the Input type, so asking for swipe alone still brings input.ts.
    expect(Object.keys(generateGameRuntime(['swipe']).files)).toContain('src/game/core/input.ts');
  });

  it('every course has a way through: 60 seeded runs, played for 90 seconds each, never crash', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const run = new R.LaneRunner({ lanes: 3, seed });
      for (let i = 0; i < 90 * 60; i++) {
        const evs = run.update(1 / 60, autopilot(run));
        const crash = evs.find((e: any) => e.type === 'crash');
        if (crash) throw new Error(`seed ${seed} crashed at ${run.distance.toFixed(1)} on ${JSON.stringify(crash.obstacle)}`);
      }
      expect(run.alive).toBe(true);
      expect(run.speed).toBe(30); // reached max speed, so the guarantee held at the fastest pace too
    }
  });

  it('every row of a multi-lane road leaves at least one lane with no block', () => {
    for (const lanes of [2, 3, 5]) {
      const run = new R.LaneRunner({ lanes, seed: 7, spawnAhead: 5000 });
      const rows = new Map<number, Set<number>>();
      for (const o of run.obstacles) if (o.kind === 'block') rows.set(o.z, (rows.get(o.z) ?? new Set()).add(o.lane));
      expect(rows.size).toBeGreaterThan(20);
      for (const blocked of rows.values()) expect(blocked.size).toBeLessThan(lanes);
    }
  });

  it('a fast run cannot tunnel through an obstacle between two steps', () => {
    // 120 units/s at 4 steps a second is 30 units a step — far longer than an obstacle. Standing still in the middle lane
    // must still meet the first thing laid in it.
    const run = new R.LaneRunner({ lanes: 1, seed: 3, startSpeed: 120, maxSpeed: 120 });
    let crashed = false;
    for (let i = 0; i < 40 && !crashed; i++) crashed = run.update(0.25).some((e: any) => e.type === 'crash');
    expect(crashed).toBe(true);
  });

  it('lane 0 is the left lane: left() lowers the lane and moves x to the left', () => {
    const run = new R.LaneRunner({ lanes: 3, seed: 1 });
    expect(run.lane).toBe(1);
    expect(run.x).toBe(0);
    run.update(1 / 60, { left: true });
    expect(run.lane).toBe(0);
    for (let i = 0; i < 30; i++) run.update(1 / 60);
    expect(run.x).toBeCloseTo(run.laneX(0));
    expect(run.laneX(0)).toBeLessThan(run.laneX(2));
    expect(run.left()).toBe(false); // the road's edge
  });

  it('a one-lane road never lays a block, and a jump clears a low and a slide passes a high', () => {
    const run = new R.LaneRunner({ lanes: 1, seed: 11, spawnAhead: 3000 });
    expect(run.obstacles.length).toBeGreaterThan(10);
    expect(run.obstacles.every((o: any) => o.kind !== 'block')).toBe(true);
    for (let i = 0; i < 60 * 60; i++) {
      const evs = run.update(1 / 60, autopilot(run));
      expect(evs.find((e: any) => e.type === 'crash')).toBeUndefined();
    }
  });

  it('the same seed lays the same course; reset() starts it again', () => {
    const a = new R.LaneRunner({ seed: 42 });
    const b = new R.LaneRunner({ seed: 42 });
    expect(a.obstacles).toEqual(b.obstacles);
    for (let i = 0; i < 100; i++) a.update(1 / 60, autopilot(a));
    a.reset();
    expect(a.obstacles).toEqual(b.obstacles);
    expect(a.distance).toBe(0);
  });

  it('runnerInput reads the kit actions: up also jumps', () => {
    const pressed = new Set(['up', 'down']);
    expect(R.runnerInput({ wasPressed: (a: string) => pressed.has(a) })).toEqual({ left: false, right: false, jump: true, slide: true });
  });
});

describe('swipe', () => {
  it('reads direction from the finger: screen y grows down, so moving up the screen is up', () => {
    expect(S.swipeDirection(-50, 5, 100)).toBe('left');
    expect(S.swipeDirection(50, -5, 100)).toBe('right');
    expect(S.swipeDirection(4, -60, 100)).toBe('up');
    expect(S.swipeDirection(4, 60, 100)).toBe('down');
    expect(S.swipeDirection(10, 10, 100)).toBeNull(); // too short
    expect(S.swipeDirection(80, 0, 900)).toBeNull(); // too slow: a drag
  });

  class Target {
    style: Record<string, string> = { touchAction: 'auto' };
    private l = new Map<string, Array<(e: unknown) => void>>();
    addEventListener(t: string, fn: (e: unknown) => void) { this.l.set(t, [...(this.l.get(t) ?? []), fn]); }
    removeEventListener(t: string, fn: (e: unknown) => void) { this.l.set(t, (this.l.get(t) ?? []).filter((f) => f !== fn)); }
    fire(t: string, e: Record<string, unknown>) { for (const fn of this.l.get(t) ?? []) fn({ pointerId: 1, pointerType: 'touch', target: null, ...e }); }
    count() { return [...this.l.values()].reduce((n, a) => n + a.length, 0); }
  }

  it('a swipe presses the same action a key does, once, while the finger is still moving', () => {
    const t = new Target();
    const taps: Array<[string, boolean]> = [];
    const off = S.bindSwipe(t, { setVirtualButton: (a: string, d: boolean) => taps.push([a, d]) });
    expect(t.style.touchAction).toBe('none'); // the page does not scroll under the swipe
    t.fire('pointerdown', { clientX: 200, clientY: 300 });
    t.fire('pointermove', { clientX: 200, clientY: 250 });
    expect(taps).toEqual([['jump', true], ['jump', false]]);
    t.fire('pointermove', { clientX: 200, clientY: 100 });
    t.fire('pointerup', { clientX: 200, clientY: 100 });
    expect(taps.length).toBe(2); // one swipe per finger-down
    t.fire('pointerdown', { clientX: 200, clientY: 300 });
    t.fire('pointerup', { clientX: 140, clientY: 302 }); // a flick that lifts before any move
    expect(taps.slice(2)).toEqual([['left', true], ['left', false]]);
    off();
    expect(t.count()).toBe(0);
    expect(t.style.touchAction).toBe('auto');
  });

  it('a press that starts on a button is the button, and a mouse is not a finger unless asked', () => {
    const t = new Target();
    const taps: string[] = [];
    S.bindSwipe(t, { setVirtualButton: (a: string, d: boolean) => { if (d) taps.push(a); } });
    t.fire('pointerdown', { clientX: 0, clientY: 0, target: { closest: (sel: string) => (sel.includes('button') ? {} : null) } });
    t.fire('pointermove', { clientX: 90, clientY: 0 });
    t.fire('pointerdown', { pointerId: 2, pointerType: 'mouse', clientX: 0, clientY: 0 });
    t.fire('pointermove', { pointerId: 2, pointerType: 'mouse', clientX: 90, clientY: 0 });
    expect(taps).toEqual([]);
  });
});
