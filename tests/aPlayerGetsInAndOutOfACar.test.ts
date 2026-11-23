// GET IN AND OUT OF A VEHICLE (admin 2026-11-20 game-gap audit: every walk-and-drive game hand-wrote it with Use and
// ctx.follow, and the walking body kept moving, unseen, the whole time the player drove — so getting out put them
// wherever the invisible body had wandered). These run the REAL generated Game.ts, objects.ts, input.ts and character
// controller: ctx.vehicles.add(car) is all a game writes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-enter-vehicle-${process.pid}`);

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
let O: any; let SHELL: any; let TC: any;

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
  TC = await import(join(DIR, 'src/game/ui/touchControls.ts'));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle']) delete (globalThis as any)[k];
});

const key = (g: any, type: 'keydown' | 'keyup', code: string) => (g.canvas as FakeEl).fire(type, { code, repeat: false });
/** A drive-pad button by its action, in the real touch overlay. */
const pad = (g: any, action: string): FakeEl => (g.touch.root as FakeEl).all('nbg-tc-btn').find((b) => b.attrs['data-action'] === action && !!b.parentElement?.className.includes('nbg-tc-pedals'))!;
/** A pointer event just big enough for the real overlay. */
const ptr = (pointerId: number) => ({ pointerId, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} });
const tap = (g: any, code: string) => { key(g, 'keydown', code); g.loop.step(1); key(g, 'keyup', code); g.loop.step(1); };

/** A game with one car parked beside the player. seats: hand it to ctx.vehicles. drivesItself: the game drives it too. */
function makeGame(o: { seats?: boolean; gap?: number; drivesItself?: boolean; touch?: any; reads?: string } = {}) {
  let car!: THREE.Group;
  let ctxRef: any;
  let drive: any;
  const game = new SHELL.Game({
    container: new FakeEl('div'),
    ...(o.touch ? { touchControls: o.touch } : {}),
    setup: (ctx: any) => {
      ctxRef = ctx;
      car = O.createCar({ detail: 'lite' });
      const p = ctx.player.object.position;
      car.position.set(p.x + (o.gap ?? 2.8), p.y, p.z);
      ctx.scene.add(car);
      if (o.seats !== false) ctx.vehicles.add(car);
      if (o.drivesItself) drive = O.createVehicleState(car, { startSpeed: 0 });
      return [];
    },
    update: (ctx: any, dt: number) => {
      if (o.reads) ctx.input.wasPressed(o.reads);
      if (o.drivesItself && ctx.vehicles.seated === car) drive = O.driveVehicle(car, drive, ctx.input.axis(), dt);
    },
  });
  game.loop.step(2);
  return { game, car, ctx: ctxRef };
}

describe('🚗 ctx.vehicles: walk up, get in, drive, get out', () => {
  it('Use beside the car gets in; the body is held still while the car drives; Use gets out beside it', () => {
    const { game, car, ctx } = makeGame();
    expect(game.seatPrompt).toBe('in');
    expect(ctx.vehicles.inReach).toBe(car);
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).toBe(car);
    expect(game.seatPrompt).toBe('out');
    const body = ctx.player.object.position.clone();
    const start = car.position.clone();
    key(game, 'keydown', 'ArrowUp');
    game.loop.step(120);
    key(game, 'keyup', 'ArrowUp');
    expect(car.position.distanceTo(start), 'the car drives').toBeGreaterThan(10);
    expect(ctx.player.object.position.distanceTo(body), 'the body did not wander while driving').toBeLessThan(0.01);
    const cam = game.rig.camera.position;
    expect(cam.distanceTo(car.position), 'the camera chases the car, not the parked body').toBeLessThan(cam.distanceTo(body));
    // Use at speed: brake first, then out.
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).toBe(car);
    expect(game.seatPrompt).toBeNull();
    game.loop.step(180);
    expect(ctx.vehicles.seated).toBeNull();
    const at = ctx.player.object.position;
    const flat = Math.hypot(at.x - car.position.x, at.z - car.position.z);
    expect(flat, 'out beside the car').toBeGreaterThan(0.8);
    expect(flat).toBeLessThan(3.5);
    // Parked: it does not roll away once the player has left it.
    const parked = car.position.clone();
    game.loop.step(60);
    expect(car.position.distanceTo(parked)).toBeLessThan(0.05);
    expect(game.seatPrompt).toBe('in');
    game.dispose();
  });

  it('too far away, Use does nothing to the car', () => {
    const { game, car, ctx } = makeGame({ gap: 12 });
    expect(game.seatPrompt).toBeNull();
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).toBeNull();
    const start = car.position.clone();
    key(game, 'keydown', 'ArrowUp');
    game.loop.step(60);
    expect(car.position.distanceTo(start)).toBeLessThan(0.05);
    game.dispose();
  });

  it('a game that drives the car itself is not driven twice', () => {
    const run = (drivesItself: boolean) => {
      const { game, car } = makeGame({ drivesItself });
      tap(game, 'KeyE');
      const start = car.position.clone();
      key(game, 'keydown', 'ArrowUp');
      game.loop.step(120);
      const d = car.position.distanceTo(start);
      game.dispose();
      return d;
    };
    const shell = run(false);
    const own = run(true);
    expect(own).toBeGreaterThan(10);
    expect(Math.abs(own - shell) / shell).toBeLessThan(0.15);
  });

  it('after getting out of a car the game drove itself, the camera follows the player again, not the parked car', () => {
    const { game, car, ctx } = makeGame({ drivesItself: true });
    tap(game, 'KeyE');
    key(game, 'keydown', 'ArrowUp');
    game.loop.step(120);
    key(game, 'keyup', 'ArrowUp');
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).toBeNull();
    game.loop.step(60);
    const cam = game.rig.camera.position;
    const me = ctx.player.object.position;
    expect(Math.hypot(cam.x - me.x, cam.z - me.z)).toBeLessThan(12);
    expect((game as any).chased).toBeNull();
    void car;
    game.dispose();
  });

  it('opt-in: a game that never calls ctx.vehicles keeps today\'s behaviour — Use does not put the player in a car', () => {
    const { game, car, ctx } = makeGame({ seats: false });
    expect(game.seatPrompt).toBeNull();
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).toBeNull();
    const start = car.position.clone();
    key(game, 'keydown', 'ArrowUp');
    game.loop.step(60);
    expect(car.position.distanceTo(start)).toBeLessThan(0.05);
    game.dispose();
  });

  // 🚗 admin 2026-11-23: "car control hardcore joystick se nahi honi chahiye". A seated player used to keep the joystick,
  // because the pedal set had no Use button; the pedals now carry Use (the way out), so the car gets the pedals.
  it('on a phone, a seated player gets the Left/Right + Brake/Gas pads WITH Use on them (the way out)', () => {
    const { game, ctx } = makeGame();
    expect((game as any).touch?.layout).toBe('move');                                 // on foot: the joystick
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).not.toBeNull();
    const touch = (game as any).touch;
    expect(touch.layout).toBe('drive');
    expect(touch.root.classList.contains('exit')).toBe(true);
    const use = pad(game, 'interact');
    expect(use, 'Use is one of the pedal buttons').toBeTruthy();
    // Pressing Use on the pads gets out, and the joystick comes back.
    use.fire('pointerdown', ptr(7));
    game.loop.step(1);
    use.fire('pointerup', ptr(7));
    game.loop.step(2);
    expect(ctx.vehicles.seated).toBeNull();
    expect(touch.layout).toBe('move');
    expect(touch.root.classList.contains('exit')).toBe(false);
    game.dispose();
  });

  it('a game that reads another action button while driving (fires from the car) keeps the joystick and its buttons', () => {
    const { game, ctx } = makeGame({ reads: 'attack' });
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).not.toBeNull();
    expect((game as any).touch.layout).toBe('move');
    game.dispose();
  });

  it("touchControls.drive: 'joystick' (the user asked for one) keeps the joystick in the car", () => {
    const { game, ctx } = makeGame({ touch: { drive: 'joystick' } });
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).not.toBeNull();
    expect((game as any).touch.layout).toBe('move');
    game.dispose();
  });

  it("touchControls.drive: 'auto' — the car drives forward by itself, Brake stops it, and there is no Gas pad", () => {
    const { game, car, ctx } = makeGame({ touch: { drive: 'auto' } });
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).toBe(car);
    const touch = (game as any).touch;
    expect(touch.layout).toBe('drive');
    expect(touch.root.classList.contains('auto')).toBe(true);
    const start = car.position.clone();
    game.loop.step(120);
    expect(car.position.distanceTo(start), 'it drove with no key and no pedal').toBeGreaterThan(5);
    const forward = car.position.clone().sub(start).normalize();
    const brake = pad(game, 'down');
    brake.fire('pointerdown', ptr(3));
    game.loop.step(240);
    const stopped = car.position.clone();
    game.loop.step(30);
    // Held Brake stops it (then backs up, as S on a keyboard does) — it never keeps driving forward.
    expect(car.position.clone().sub(stopped).dot(forward), 'held Brake: no more forward').toBeLessThan(0.05);
    brake.fire('pointerup', ptr(3));
    game.dispose();
  });

  it("touchControls.drive: 'tilt' — the pads stay until the sensor answers, then the phone's tilt steers", () => {
    const { game, ctx } = makeGame({ touch: { drive: 'tilt' } });
    tap(game, 'KeyE');
    expect(ctx.vehicles.seated).not.toBeNull();
    const touch = (game as any).touch;
    expect(touch.layout).toBe('drive');
    expect(touch.root.classList.contains('tilting'), 'no reading yet: Left/Right stay').toBe(false);
    ((globalThis as any).window as FakeEl).fire('deviceorientation', { beta: 0, gamma: 20 });
    expect(touch.root.classList.contains('tilting')).toBe(true);
    expect(game.input.axis().x).toBeGreaterThan(0.5);                                  // tilted right → steer right
    ((globalThis as any).window as FakeEl).fire('deviceorientation', { beta: 0, gamma: -20 });
    expect(game.input.axis().x).toBeLessThan(-0.5);
    game.dispose();
  });

  it('the builder is told to use it, and the Hud shows the prompt', () => {
    const shell = generateGameShell();
    expect(shell.instructions).toMatch(/ctx\.vehicles\.add\(car\)/);
    expect(shell.files['src/game/ui/Hud.tsx']).toMatch(/<SeatPrompt game=\{game\} \/>/);
  });
});

describe('🚗 the car controls follow the words (touchControls.drive)', () => {
  it('an unknown or missing choice is the pads; the four choices are kept', () => {
    expect(TC.resolveDriveControls(undefined)).toBe('pads');
    expect(TC.resolveDriveControls('hardcore')).toBe('pads');
    for (const m of ['pads', 'tilt', 'auto', 'joystick']) expect(TC.resolveDriveControls(m)).toBe(m);
  });
  it('tilt steers by the axis across the screen, with a dead zone, in every orientation', () => {
    expect(TC.steerFromTilt(0, 1, 0)).toBe(0);                     // inside the dead zone: straight
    expect(TC.steerFromTilt(0, 28, 0)).toBeCloseTo(1, 5);          // portrait, tilted right: full right
    expect(TC.steerFromTilt(0, -60, 0)).toBeCloseTo(-1, 5);        // clamped
    expect(TC.steerFromTilt(28, 0, 90)).toBeCloseTo(1, 5);         // landscape one way: beta steers
    expect(TC.steerFromTilt(28, 0, 270)).toBeCloseTo(-1, 5);       // and the other way round, reversed
    expect(TC.steerFromTilt(Number.NaN, null, 0)).toBe(0);
  });
});
