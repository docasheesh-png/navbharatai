// A GAMEPAD PLAYS THE GAME (admin 2026-11-19 game-gap audit, P1 #17). The runtime's Input header promised "keyboard, mouse,
// gamepad and touch" and there was no Gamepad API code at all — a claim the code did not keep. These tests drive the
// REAL generated core/input.ts with a pad the way the browser reports one (navigator.getGamepads(), polled).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-gamepad-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let IN: any;
let pads: any[] = [];
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

class Target { private l = new Map<string, Array<(e: unknown) => void>>(); addEventListener(t: string, f: (e: unknown) => void) { this.l.set(t, [...(this.l.get(t) ?? []), f]); } removeEventListener() { /* gone */ } }

function pad(o: { axes?: number[]; pressed?: number[] } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: (o.pressed ?? []).includes(i), value: (o.pressed ?? []).includes(i) ? 1 : 0 }));
  return { connected: true, mapping: 'standard', axes: o.axes ?? [0, 0, 0, 0], buttons };
}

beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGameRuntime().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  IN = await import(join(DIR, 'src/game/core/input.ts'));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator); else delete (globalThis as any).navigator;
});
beforeEach(() => { pads = []; });

describe('🎮 the pad, read the way the browser reports it', () => {
  it('the left stick moves (with a deadzone), and letting go stops — exactly', () => {
    const input = new IN.Input(new Target());
    pads = [pad({ axes: [0.08, -0.05, 0, 0] })];
    input.pollGamepads();
    expect(input.axis()).toEqual({ x: 0, y: 0 });              // inside the deadzone: at rest
    pads = [pad({ axes: [1, 0, 0, 0] })];
    input.pollGamepads();
    expect(input.axis().x).toBeCloseTo(1, 5);
    expect(input.gamepad).toBe(true);
    pads = [pad({ axes: [0, 0, 0, 0] })];
    input.pollGamepads();
    expect(input.axis()).toEqual({ x: 0, y: 0 });
  });
  it('an idle pad never clears the touch joystick', () => {
    const input = new IN.Input(new Target());
    pads = [pad()];
    input.setAnalogueMove(0.5, -0.5);
    input.pollGamepads();
    expect(input.axis()).toEqual({ x: 0.5, y: -0.5 });
  });
  it('buttons are actions with real press edges: A jumps, X and RT attack, Start pauses', () => {
    const input = new IN.Input(new Target());
    pads = [pad({ pressed: [0, 7] })];
    input.pollGamepads();
    expect(input.wasPressed('jump')).toBe(true);
    expect(input.wasPressed('attack')).toBe(true);
    expect(input.wasPressed('fire')).toBe(true);               // the attack group answers to the pad too
    input.endFrame();
    input.pollGamepads();                                      // still held
    expect(input.wasPressed('jump')).toBe(false);
    expect(input.isDown('jump')).toBe(true);
    pads = [pad({ pressed: [9] })];
    input.pollGamepads();
    expect(input.wasReleased('jump')).toBe(true);
    expect(input.wasPressed('pause')).toBe(true);
  });
  it('the right stick looks; unplugging releases everything the pad held', () => {
    const input = new IN.Input(new Target());
    pads = [pad({ axes: [0, 0, 1, 0], pressed: [5] })];
    input.pollGamepads();
    expect(input.lookX).toBeGreaterThan(10);
    expect(input.isDown('sprint')).toBe(true);
    pads = [];
    input.pollGamepads();
    expect(input.gamepad).toBe(false);
    expect(input.isDown('sprint')).toBe(false);
  });
  it('no Gamepad API at all is a quiet no-op', () => {
    const input = new IN.Input(new Target());
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    expect(() => input.pollGamepads()).not.toThrow();
    expect(input.gamepad).toBe(false);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  });
});

describe('the shell reads it every step, before the game does', () => {
  it('Game.fixedUpdate polls the pad first', () => {
    const game = generateGameShell().files['src/game/Game.ts'];
    const fixed = game.slice(game.indexOf('private fixedUpdate'), game.indexOf('private render'));
    expect(fixed.indexOf('this.input.pollGamepads();')).toBeGreaterThan(-1);
    expect(fixed.indexOf('this.input.pollGamepads();')).toBeLessThan(fixed.indexOf('this.input.axis()'));
  });
});
