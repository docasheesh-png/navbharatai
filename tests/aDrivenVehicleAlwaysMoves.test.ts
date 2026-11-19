// EVERY VEHICLE A GAME DRIVES ACTUALLY MOVES — whatever way the game keeps its car and its state
// (admin 2026-11-02, autopsy 8701aaa1 / 7aa2fe7c / c71e56de).
//
// Admin, verbatim: *"jab bhi koi vehicle game banaya jaye, to vehicle chalni chahiye. 50% vehicles chalti
// hi nahi hai. is game me bhi nahi chalo"*.
//
// 🔴 WHAT HAPPENED. The racing game stored its car on the context in setup() and read it back in
// update(). The shell's `context` was a getter that built a NEW object on every access, so update() read
// undefined: driveVehicle(car, undefined) threw "reading 'speed'", and after the builder's "fix" (a fresh
// `{ speed: 0, heading: 0 }` every frame) driveVehicle(undefined, …) threw "reading 'rotation'" — 1,419
// errors in one playtest, Controls 0, the car never moved, three builds in a row.
//
// 🔑 THE CLASS: the car moves only if the game hands driveVehicle the right state, kept the right way —
// an OPT-IN convention, and every miss is a frozen car. These tests drive the REAL generated kit and shell
// through every way a game can keep its car and state (the census below) and require the car to MOVE on
// each. Reverting either half (the per-call context, or the pure driveVehicle) fails them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-vehicle-moves-${process.pid}`);

// ── A DOM just big enough for the real shell and its real touch controls ─────────────────────────────
type Listener = (e: unknown) => void;
class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  type = '';
  tabIndex = -1;
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  private listeners = new Map<string, Listener[]>();
  classList = {
    add: (...c: string[]) => { const set = new Set(this.className.split(' ').filter(Boolean)); c.forEach((x) => set.add(x)); this.className = [...set].join(' '); },
    remove: (...c: string[]) => { this.className = this.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  constructor(public tag: string) {}
  appendChild(c: FakeEl) { c.parentElement = this; this.children.push(c); return c; }
  removeChild(c: FakeEl) { this.children = this.children.filter((x) => x !== c); c.parentElement = null; return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  setPointerCapture() { /* captured */ }
  focus() { /* focused */ }
  getBoundingClientRect() { return { left: 0, top: 0, right: 844, bottom: 390, width: 844, height: 390 }; }
  getContext() { return { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }; }
  addEventListener(t: string, fn: Listener) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
  removeEventListener(t: string, fn: Listener) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
  fire(t: string, e: unknown) { for (const f of this.listeners.get(t) ?? []) f(e); }
  all(cls: string): FakeEl[] { return [...(this.classList.contains(cls) ? [this] : []), ...this.children.flatMap((c) => c.all(cls))]; }
}

// The shell's WebGL- and audio-facing layers are replaced by stand-ins; EVERYTHING that decides where the
// camera goes and which way the car turns is the real generated code: Game.ts, camera.ts, objects.ts,
// input.ts, touchControls.ts, character.ts, motor.ts, humanoid.ts.
const STUBS: Record<string, string> = {
  'src/game/three/renderer.ts':
    'export function createRenderer(): any { return { render() {}, dispose() {}, shadowMap: {}, getPixelRatio: () => 1, setPixelRatio() {} }; }\n'
    + 'export function handleResize(): () => void { return () => {}; }\n',
  'src/game/three/lighting.ts':
    "import * as THREE from 'three';\nexport type LightingPresetName = string;\n"
    + 'export interface AppliedLighting { key: THREE.DirectionalLight }\n'
    + 'export function applyLighting(scene: THREE.Scene): AppliedLighting { const key = new THREE.DirectionalLight(); scene.add(key); return { key }; }\n'
    + 'export function followShadow(): void {}\n',
  'src/game/core/loop.ts':
    'export class GameLoop {\n'
    + '  constructor(private readonly update: (dt: number) => void, private readonly render: (alpha: number, frameDelta: number) => void) {}\n'
    + '  start(): void {}\n  stop(): void {}\n  setPaused(): void {}\n'
    + '  step(n = 1, dt = 1 / 60): void { for (let i = 0; i < n; i++) { this.update(dt); this.render(1, dt); } }\n}\n',
  'src/game/core/meta.ts':
    'export function startMeta(): void {}\nexport function mountMetaToasts(): () => void { return () => {}; }\n'
    + 'export const combo = { update(): void {}, break(): void {} };\n',
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} }\n',
  'src/game/fx/audio.ts': 'export const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {}, setVolume(): void {} };\n',
  'src/game/fx/feedback.ts': 'export function bindGameFeedback(): () => void { return () => {}; }\n',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let O: any; let SHELL: any;

beforeAll(async () => {
  (globalThis as any).document = { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  (globalThis as any).window = Object.assign(new FakeEl('window'), { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: true }) });
  (globalThis as any).getComputedStyle = (el: FakeEl) => ({ position: el.style.position || 'static' });
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  for (const [p, c] of Object.entries(STUBS)) writeFileSync(join(DIR, p), c);
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  SHELL = await import(join(DIR, 'src/game/Game.ts'));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle']) delete (globalThis as any)[k];
});

const key = (g: any, type: 'keydown' | 'keyup', code: string) => (g.canvas as FakeEl).fire(type, { code, repeat: false });

type Way = { name: string; setup: (ctx: any, car: THREE.Group) => void; update: (ctx: any, dt: number) => void };
let held: { car?: THREE.Group; drive?: any } = {};

// Every way a game has been seen (or can plausibly) keep its car and its state between frames.
const WAYS: Way[] = [
  { name: 'the kit example: let drive; drive = driveVehicle(…)',
    setup: (_c, car) => { held.car = car; held.drive = O.createVehicleState(car); },
    update: (ctx, dt) => { held.drive = O.driveVehicle(held.car, held.drive, ctx.input.axis(), dt); } },
  { name: 'car and state kept ON the context (build 8701aaa1)',
    setup: (ctx, car) => { ctx.car = car; ctx.vehicleState = O.createVehicleState(car); },
    update: (ctx, dt) => { ctx.vehicleState = O.driveVehicle(ctx.car, ctx.vehicleState, ctx.input.axis(), dt); } },
  { name: 'the return value discarded',
    setup: (_c, car) => { held.car = car; held.drive = O.createVehicleState(car); },
    update: (ctx, dt) => { O.driveVehicle(held.car, held.drive, ctx.input.axis(), dt); } },
  { name: 'a fresh { speed: 0, heading: 0 } every frame (the builder\'s "fix" in 8701aaa1)',
    setup: (ctx, car) => { ctx.car = car; },
    update: (ctx, dt) => { const s = ctx.vehicleState || { speed: 0, heading: 0 }; O.driveVehicle(ctx.car, s, ctx.input.axis(), dt); } },
  { name: 'no state at all',
    setup: (ctx, car) => { ctx.car = car; },
    update: (ctx, dt) => { O.driveVehicle(ctx.car, undefined, ctx.input.axis(), dt); } },
  { name: 'a spread copy every frame',
    setup: (_c, car) => { held.car = car; held.drive = O.createVehicleState(car); },
    update: (ctx, dt) => { held.drive = { ...O.driveVehicle(held.car, held.drive, ctx.input.axis(), dt) }; } },
];

function play(way: Way) {
  held = {};
  const errors: unknown[] = [];
  let car!: THREE.Group;
  const game = new SHELL.Game({
    container: new FakeEl('div'),
    setup: (ctx: any) => { car = O.createCar({ detail: 'lite' }); ctx.scene.add(car); way.setup(ctx, car); return []; },
    update: (ctx: any, dt: number) => { try { way.update(ctx, dt); } catch (e) { errors.push(e); } },
  });
  const start = car.position.clone();
  key(game, 'keydown', 'ArrowUp');
  game.loop.step(180);                                    // three seconds with the accelerator held
  key(game, 'keyup', 'ArrowUp');
  const moved = car.position.distanceTo(start);
  game.dispose();
  return { moved, errors };
}

describe('🔴 a car the player drives MOVES, whichever way the game keeps it', () => {
  for (const way of WAYS) {
    it(way.name, () => {
      const r = play(way);
      expect(r.errors.map(String), 'update() threw').toEqual([]);
      // 3 s of throttle from rest at 9 m/s² is over 40 m; a car whose speed never builds stays near its start speed (5 m/s ≈ 15 m).
      expect(r.moved, `the car moved ${r.moved.toFixed(2)} m in 3 s with the accelerator held`).toBeGreaterThan(25);
    });
  }
});

describe('the pieces of the fix', () => {
  it('setup() and every update() get the SAME context, and its members stay live', () => {
    const seen: any[] = [];
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: (ctx: any) => { seen.push(ctx); return []; }, update: (ctx: any) => { seen.push(ctx); } });
    game.loop.step(3);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0].scene).toBe(game.scene);
    expect(seen[0].camera).toBe(game.rig.camera);
    game.dispose();
  });

  it('a state the game sets ONCE (a crash stop) is obeyed, then driving resumes from it', () => {
    const car = O.createCar({ detail: 'lite' });
    let drive = O.createVehicleState(car);
    for (let i = 0; i < 60; i++) drive = O.driveVehicle(car, drive, { x: 0, y: -1 }, 1 / 60);
    expect(drive.speed).toBeGreaterThan(10);
    drive = { speed: 0, heading: drive.heading };          // the crash
    drive = O.driveVehicle(car, drive, { x: 0, y: 0 }, 1 / 60);
    expect(drive.speed).toBe(0);
  });

  it('two cars keep two states', () => {
    const a = O.createCar({ detail: 'lite' }), b = O.createCar({ detail: 'lite' });
    let sa = O.createVehicleState(a); let sb = O.createVehicleState(b, { startSpeed: 0 });
    for (let i = 0; i < 60; i++) { sa = O.driveVehicle(a, sa, { x: 0, y: -1 }, 1 / 60); sb = O.driveVehicle(b, sb, { x: 0, y: 0 }, 1 / 60); }
    expect(sa.speed).toBeGreaterThan(10);
    expect(sb.speed).toBe(0);
  });

  it('no vehicle is a clear error that names the fix, not "reading \'rotation\'"', () => {
    expect(() => O.driveVehicle(undefined, { speed: 0, heading: 0 }, { x: 0, y: 0 }, 1 / 60)).toThrow(/no vehicle.*OUTSIDE setup\(\)/);
  });
});
