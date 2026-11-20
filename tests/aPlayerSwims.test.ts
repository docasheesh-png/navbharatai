// SWIMMING (admin 2026-11-20 game-gap audit: a player who walked into a lake sank to the bottom and walked along it,
// because nothing in the kit knew what water was). These run the REAL generated play/motor.ts and play/character.ts on
// real terrain: a lake 3 m deep over flat ground at y = 0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-swim-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let M: any; let W: any; let IN: any;

beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }) }) };
  (globalThis as any).window = { innerWidth: 800, innerHeight: 600 };
  for (const r of [generateGameRuntime(), generateGameController(), generateGame3D()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  C = await import(join(DIR, 'src/game/play/character.ts'));
  M = await import(join(DIR, 'src/game/play/motor.ts'));
  W = await import(join(DIR, 'src/game/three/world.ts'));
  IN = await import(join(DIR, 'src/game/core/input.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).document; delete (globalThis as any).window; });

const still = { moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, jumpHeld: false };
const run = (pc: any, seconds: number, input: any = still) => { for (let i = 0; i < Math.round(seconds * 60); i++) pc.update(1 / 60, input, 0); };
const lake = (surface = 3, options: any = {}) => {
  const pc = new C.CharacterController({ water: surface, ...options });
  pc.setColliders([W.createTerrain({ size: 200, flat: true })]);
  pc.reset(0, surface, 0);
  return pc;
};

describe('🏊 water', () => {
  it('THE BUG: without water the player sinks to the lake bed (the baseline this fixes)', () => {
    const pc = new C.CharacterController();
    pc.setColliders([W.createTerrain({ size: 200, flat: true })]);
    pc.reset(0, 3, 0);
    run(pc, 3);
    expect(pc.object.position.y).toBeCloseTo(0, 2);
    expect(pc.swimming).toBe(false);
  });

  it('in deep water the player floats, head out, and never reaches the bottom', () => {
    const pc = lake();
    let lowest = Infinity;
    for (let i = 0; i < 300; i++) { pc.update(1 / 60, still, 0); lowest = Math.min(lowest, pc.object.position.y); }
    expect(pc.swimming).toBe(true);
    expect(pc.underwater).toBe(false);
    expect(lowest).toBeGreaterThan(1);
    expect(pc.object.position.y).toBeCloseTo(3 - M.DEFAULT_SWIM.floatDepth, 1);
  });

  it('shallow water is still walking', () => {
    const pc = lake(0.5);
    run(pc, 2);
    expect(pc.swimming).toBe(false);
    expect(pc.isGrounded).toBe(true);
  });

  it('swimming is slower than walking, and sprint helps a little', () => {
    const swimmer = lake();
    run(swimmer, 1);
    run(swimmer, 3, { ...still, moveZ: -1 });
    const swim = swimmer.speed;
    run(swimmer, 2, { ...still, moveZ: -1, sprint: true });
    const fast = swimmer.speed;
    expect(swim).toBeGreaterThan(1.5);
    expect(swim).toBeLessThanOrEqual(M.DEFAULT_SWIM.swimSpeed + 1e-6);
    expect(fast).toBeGreaterThan(swim);
    expect(fast).toBeLessThan(M.DEFAULT_MOTOR.maxSpeed);
  });

  it('dive goes under; breath runs out and is reported once a second; letting go floats up and breath refills', () => {
    let outs = 0;
    const pc = lake(6, { onOutOfBreath: () => { outs += 1; } });
    run(pc, 1);
    run(pc, 2, { ...still, diveHeld: true });
    expect(pc.underwater).toBe(true);
    expect(pc.breath).toBeLessThan(1);
    run(pc, 18, { ...still, diveHeld: true });
    expect(pc.breath).toBe(0);
    expect(outs).toBeGreaterThanOrEqual(4);
    expect(outs).toBeLessThanOrEqual(6);
    run(pc, 8);
    expect(pc.underwater).toBe(false);
    expect(pc.breath).toBe(1);
  });

  it('Jump held swims up from deep down; Jump at the surface climbs out', () => {
    const pc = lake(8);
    run(pc, 1);
    run(pc, 3, { ...still, diveHeld: true });
    const deep = pc.object.position.y;
    run(pc, 1, { ...still, jumpHeld: true });
    expect(pc.object.position.y).toBeGreaterThan(deep + 1);
    const top = lake();
    run(top, 2);
    top.update(1 / 60, { ...still, jumpPressed: true, jumpHeld: true }, 0);
    expect(top.velocity.y).toBeGreaterThan(5);
    expect(top.swimming).toBe(false);
  });

  it('a river: water only where the function says, and walking into it starts swimming', () => {
    const pc = new C.CharacterController({ water: (x: number) => (x < -5 ? 2.5 : null) });
    pc.setColliders([W.createTerrain({ size: 200, flat: true })]);
    pc.reset(0, 0, 0);
    run(pc, 1);
    expect(pc.swimming).toBe(false);
    // Walk left (camera yaw 0: D is +x, so A is -x) into the river.
    run(pc, 3, { ...still, moveX: -1 });
    expect(pc.object.position.x).toBeLessThan(-5);
    // The river bed is the same flat ground, so the water is 2.5 m deep: deep enough to swim.
    run(pc, 1);
    expect(pc.swimming).toBe(true);
  });

  it('a respawn clears swimming and refills breath; setWater(null) takes the water away', () => {
    const pc = lake(6);
    run(pc, 2, { ...still, diveHeld: true });
    pc.reset(0, 0, 0);
    expect(pc.swimming).toBe(false);
    expect(pc.breath).toBe(1);
    pc.setWater(null);
    pc.reset(0, 3, 0);
    run(pc, 3);
    expect(pc.object.position.y).toBeCloseTo(0, 2);
  });

  it('the motor step is pure, and dive has a default key (C / Left Ctrl / right stick)', () => {
    const prev = M.initialMotorState();
    const input = { ...still, jumpHeld: true };
    const snap = JSON.stringify({ prev, input });
    const r = M.stepSwim(prev, input, 3, 1 / 60);
    expect(JSON.stringify({ prev, input })).toBe(snap);
    expect(r.state.vy).toBeGreaterThan(0);
    expect(IN.DEFAULT_ACTIONS.crouch).toEqual(expect.arrayContaining(['KeyC', 'ControlLeft']));
    expect(generateGameController().instructions).toMatch(/player\.setWater/);
    // The shell hands the dive key to the controller, and Crouch can be rebound in Settings → Controls.
    expect(generateGameShell().files['src/game/Game.ts']).toMatch(/diveHeld: this\.input\.isDown\('crouch'\)/);
    expect(generateGameRuntime().files['src/game/core/keybinds.ts']).toMatch(/'crouch'/);
  });
});
