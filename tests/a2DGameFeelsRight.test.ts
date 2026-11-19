// A 2D GAME FEELS RIGHT ON ITS FIRST BUILD (admin 2026-11-19 game-gap audit, P1: no 2D toolkit — every platformer
// hand-rolled its own jump, collision and camera). These run the REAL generated src/game/2d/ modules: a body never
// passes through a wall at any speed, a one-way platform holds from above only, the jump has coyote time, buffering and a
// short hop, the camera eases and stays in the level, parallax repeats seamlessly, particles are capped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGame2D, GAME_2D_MODULES } from '../src/server/lib/Game2DGenerator';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-2d-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let TM: any; let PH: any; let CAM: any; let PX: any; let PT: any; let SP: any;

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame2D().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  TM = await import(join(DIR, 'src/game/2d/tilemap.ts'));
  PH = await import(join(DIR, 'src/game/2d/physics.ts'));
  CAM = await import(join(DIR, 'src/game/2d/camera.ts'));
  PX = await import(join(DIR, 'src/game/2d/parallax.ts'));
  PT = await import(join(DIR, 'src/game/2d/particles.ts'));
  SP = await import(join(DIR, 'src/game/2d/sprite.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const T = 32;
const LEVEL = [
  '..............................',
  '..............................',
  '..........====................',
  '..............................',
  '.P.......................#....',
  '..........^^.............#....',
  '##############################',
];
const map = () => TM.Tilemap.fromRows(LEVEL, T);
const run = (c: any, m: any, seconds: number, input: any = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) c.step({ x: 0, jumpPressed: false, jumpHeld: false, ...input }, m, 1 / 60); };

describe('🧱 the tilemap', () => {
  it('reads tiles, markers and edges: sides and bottom are solid, the top is open', () => {
    const m = map();
    expect(m.width).toBe(30 * T); expect(m.height).toBe(7 * T);
    expect(m.typeAt(0, 6)).toBe('solid');
    expect(m.typeAt(10, 2)).toBe('platform');
    expect(m.typeAt(10, 5)).toBe('hazard');
    expect(m.typeAt(-1, 3)).toBe('solid');
    expect(m.typeAt(5, 99)).toBe('solid');
    expect(m.typeAt(5, -3)).toBe('empty');
    expect(m.markers('P')).toEqual([{ x: 1.5 * T, y: 4.5 * T, col: 1, row: 4 }]);
    m.set(25, 4, '.');
    expect(m.typeAt(25, 4)).toBe('empty');
  });
});

describe('🏃 platformer physics', () => {
  it('falls onto the ground and stands still on it', () => {
    const m = map();
    const c = new PH.PlatformerController(PH.createBody(1.5 * T, 3 * T, 22, 30));
    run(c, m, 1);
    expect(c.body.onGround).toBe(true);
    expect(c.body.y + 15).toBeCloseTo(6 * T, 1);
    const y = c.body.y; run(c, m, 1);
    expect(c.body.y).toBeCloseTo(y, 5);
  });
  it('🔴 never passes through a wall, however fast it moves', () => {
    const m = map();
    for (const speed of [300, 3000, 30000]) {
      const b = PH.createBody(20 * T, 5.5 * T, 22, 30);
      b.vx = speed;
      for (let i = 0; i < 30; i++) PH.moveBody(b, m, 1 / 60);
      expect(b.x + 11, 'speed ' + speed).toBeLessThanOrEqual(25 * T);
      expect(b.hitWall === 1 || b.x + 11 > 25 * T - 1).toBe(true);
    }
  });
  it('a one-way platform holds a body falling onto it, and lets one jumping up pass through', () => {
    const m = map();
    const up = PH.createBody(10.5 * T, 5.4 * T - 30, 22, 30);
    up.vy = -900;
    let passed = false;
    for (let i = 0; i < 40; i++) { PH.moveBody(up, m, 1 / 60, { gravity: 0 }); if (up.y < 2 * T) passed = true; }
    expect(passed).toBe(true);
    const down = PH.createBody(10.5 * T, 0.5 * T, 22, 30);
    for (let i = 0; i < 60; i++) PH.moveBody(down, m, 1 / 60);
    expect(down.onGround).toBe(true);
    expect(down.y + 15).toBeCloseTo(2 * T, 1);
  });
  it('down + jump on a platform drops through it', () => {
    const m = map();
    const c = new PH.PlatformerController(PH.createBody(10.5 * T, 0.5 * T, 22, 30));
    run(c, m, 1);
    expect(c.body.y + 15).toBeCloseTo(2 * T, 1);
    run(c, m, 1 / 60, { jumpPressed: true, jumpHeld: true, down: true });
    run(c, m, 1);
    expect(c.body.y).toBeGreaterThan(3 * T);
  });
  it('coyote time: a jump pressed just after leaving a ledge still jumps; long after, it does not', () => {
    // A tall drop below the ledge: the level's bottom edge is solid, so a short one would land the body at once.
    const m = TM.Tilemap.fromRows(['..........', '..........', '..........', '####......', ...Array(8).fill('..........')], T);
    const make = () => { const c = new PH.PlatformerController(PH.createBody(3.5 * T, 2 * T, 22, 30)); run(c, m, 0.5); return c; };
    const late = make();
    run(late, m, 0.4, { x: 1 });                  // walk off the ledge and keep going
    run(late, m, 1 / 60, { x: 1, jumpPressed: true, jumpHeld: true });
    expect(late.jumped).toBe(false);
    const quick = make();
    let steps = 0;
    while (quick.body.onGround && steps++ < 200) run(quick, m, 1 / 60, { x: 1 });
    run(quick, m, 2 / 60, { x: 1 });              // a hair after the edge
    run(quick, m, 1 / 60, { x: 1, jumpPressed: true, jumpHeld: true });
    expect(quick.jumped).toBe(true);
  });
  it('jump buffering: a press just before landing jumps on landing', () => {
    const m = map();
    const c = new PH.PlatformerController(PH.createBody(5.5 * T, 3 * T, 22, 30));
    let steps = 0;
    while (c.body.y + 15 < 6 * T - 8 && steps++ < 200) run(c, m, 1 / 60);
    run(c, m, 1 / 60, { jumpPressed: true, jumpHeld: true });
    let jumped = c.jumped;
    for (let i = 0; i < 6 && !jumped; i++) { run(c, m, 1 / 60, { jumpHeld: true }); jumped = c.jumped; }
    expect(jumped).toBe(true);
  });
  it('holding jump goes higher than a tap (a variable jump height)', () => {
    const peak = (hold: boolean) => {
      const m = map();
      const c = new PH.PlatformerController(PH.createBody(5.5 * T, 5 * T, 22, 30));
      run(c, m, 0.5);
      const ground = c.body.y; let top = ground;
      run(c, m, 1 / 60, { jumpPressed: true, jumpHeld: true });
      for (let i = 0; i < 60; i++) { run(c, m, 1 / 60, { jumpHeld: hold }); top = Math.min(top, c.body.y); }
      return ground - top;
    };
    expect(peak(true)).toBeGreaterThan(peak(false) * 1.6);
  });
  it('spikes are detected; boxes overlap', () => {
    const m = map();
    expect(PH.touchesHazard(PH.createBody(10.5 * T, 5.6 * T, 22, 30), m)).toBe(true);
    expect(PH.touchesHazard(PH.createBody(5.5 * T, 5.5 * T, 22, 30), m)).toBe(false);
    expect(PH.overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 0, w: 10, h: 10 })).toBe(true);
    expect(PH.overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('🎥 the camera', () => {
  it('ignores small moves (dead zone), catches up on big ones, and stays inside the level', () => {
    const cam = new CAM.Camera2D(320, 180, { bounds: { x: 0, y: 0, w: 2000, h: 400 }, deadZone: { x: 40, y: 60 } });
    cam.snap(500, 200);
    cam.follow(520, 200, 1 / 60);
    expect(cam.x).toBe(500);
    for (let i = 0; i < 120; i++) cam.follow(900, 200, 1 / 60);
    expect(cam.x).toBeGreaterThan(850);
    cam.snap(0, 0);
    expect(cam.view.x).toBe(0);
    expect(cam.view.y).toBe(0);
    cam.snap(5000, 5000);
    expect(cam.view.x + cam.view.w).toBe(2000);
  });
  it('the easing is the same at 30 and 144 fps; world ↔ screen round-trips; a shake fades', () => {
    const at = (fps: number) => { const c = new CAM.Camera2D(320, 180, { deadZone: { x: 0, y: 0 } }); c.snap(0, 0); for (let i = 0; i < fps / 2; i++) c.follow(300, 0, 1 / fps); return c.x; };
    expect(Math.abs(at(30) - at(144))).toBeLessThan(6);
    const c = new CAM.Camera2D(320, 180); c.snap(100, 50);
    const s = c.toScreen(130, 70); const w = c.toWorld(s.x, s.y);
    expect(w.x).toBeCloseTo(130); expect(w.y).toBeCloseTo(70);
    c.shake(1); c.follow(100, 50, 1 / 60);
    expect(Math.hypot(c.toScreen(100, 50).x - 160, c.toScreen(100, 50).y - 90)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) c.follow(100, 50, 1 / 60);
    expect(c.toScreen(100, 50)).toEqual({ x: 160, y: 90 });
  });
});

describe('🌄 parallax, ✨ particles, 🖼️ sprites', () => {
  it('parallax repeats cover the whole screen at any camera position, moving slower than the world', () => {
    for (const camX of [0, 137, -999, 123456]) {
      const xs = PX.Parallax.repeats(camX, 0.3, 200, 640);
      expect(xs[0]).toBeLessThanOrEqual(0); expect(xs[0]).toBeGreaterThan(-200);
      expect(xs.at(-1)! + 200).toBeGreaterThanOrEqual(640);
    }
    expect(PX.Parallax.repeats(100, 0.5, 200, 640)[0]).toBe(-50);
  });
  it('particles burst, move, fade away, and never exceed the cap', () => {
    const fx = new PT.Particles2D(50);
    fx.burst('explosion', 0, 0);
    expect(fx.count).toBe(36);
    fx.burst('explosion', 0, 0);
    expect(fx.count).toBe(50);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    expect(fx.count).toBe(0);
    fx.burst('nope' as any, 0, 0); fx.burst('dust', Number.NaN, 0);
    expect(fx.count).toBe(0);
  });
  it('the animator plays clips at their fps, holds a one-shot on its last frame, and draws a placeholder without art', () => {
    const sheet = new SP.SpriteSheet(null, 16, 16, 4);
    const a = new SP.Animator(sheet, { run: { frames: [4, 5, 6, 7], fps: 10 }, hit: { frames: [8, 9], fps: 10, loop: false } });
    a.update(0.25);
    expect(a.frame).toBe(6);
    a.play('run'); expect(a.frame).toBe(6);          // the same clip carries on
    a.play('hit'); a.update(1);
    expect(a.frame).toBe(9); expect(a.done).toBe(true);
    expect(sheet.frameRect(6)).toEqual({ sx: 32, sy: 16, sw: 16, sh: 16 });
    const calls: string[] = [];
    const ctx: any = { save() {}, restore() {}, translate() {}, scale() {}, fillRect: () => calls.push('rect'), drawImage: () => calls.push('image'), set fillStyle(_v: string) {}, set globalAlpha(_v: number) {} };
    a.draw(ctx, 10, 10, { flipX: true });
    expect(calls).toContain('rect');
    expect(calls).not.toContain('image');
  });
});

describe('the recipe', () => {
  it('is a registered game recipe with every module, and a physics subset brings the tilemap', () => {
    expect(GAME_RECIPES.generate_game_2d).toBe(generateGame2D);
    expect(GAME_2D_MODULES).toEqual(['sprite', 'camera', 'tilemap', 'physics', 'parallax', 'particles']);
    expect(Object.keys(generateGame2D(['physics']).files).sort()).toEqual(['src/game/2d/physics.ts', 'src/game/2d/tilemap.ts']);
  });
});
