// EVERY ACTION IS SEEN, NOT ONLY COMPUTED (admin 2026-11-19: "pubg jaisa game … 'fire' button press kiya goli chalne lagi
// par character goli chalate huye dikha nahi, character same position me khada raha … jump, action, fight, fire etc me
// action ke movement dikhne chahiye … sirf ek game fix nahi karna hai, navbharatai ko pura sikhana hai"). See
// src/server/AgentV3/actionVisibility.ts. These tests drive the REAL generated kit and shell: a button pressed on the
// touch controls must move the hero's arms, a press during a hit-stop must not be lost, 'fire' must answer to the
// Attack button, and a drifting car must slide, lean and smoke.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { actionPoseHalves, actionPoseFinding, ACTION_VISIBLE_RULE } from '../src/server/AgentV3/actionVisibility';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-actions-seen-${process.pid}`);

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
  find(pred: (e: FakeEl) => boolean): FakeEl[] { return [...(pred(this) ? [this] : []), ...this.children.flatMap((c) => c.find(pred))]; }
}

const bursts: string[] = [];
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
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} burst(name: string): void { (globalThis as any).__bursts.push(name); } }\n',
  'src/game/fx/audio.ts': 'export const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {}, setVolume(): void {} };\n',
  'src/game/fx/feedback.ts': 'export function bindGameFeedback(): () => void { return () => {}; }\n',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let O: any; let H: any; let SHELL: any; let E: any; let IN: any;

beforeAll(async () => {
  (globalThis as any).__bursts = bursts;
  (globalThis as any).document = { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  (globalThis as any).window = Object.assign(new FakeEl('window'), { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: true }) });
  (globalThis as any).getComputedStyle = (el: FakeEl) => ({ position: el.style.position || 'static' });
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell(), generateGameSystems()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  for (const [p, c] of Object.entries(STUBS)) writeFileSync(join(DIR, p), c);
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  H = await import(join(DIR, 'src/game/three/humanoid.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  IN = await import(join(DIR, 'src/game/core/input.ts'));
  SHELL = await import(join(DIR, 'src/game/Game.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__bursts']) delete (globalThis as any)[k];
});

/** Every joint angle and the hip height, as one vector, so "did the body move" is one number. */
function bodyPose(h: any): number[] {
  return [...Object.values(h.joints).flatMap((j: any) => [j.rotation.x, j.rotation.y, j.rotation.z]), h.joints.hips.position.y];
}
const moved = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

describe('🎬 the humanoid has a visible pose for every action', () => {
  it('every action moves the body clearly at its peak, then hands back to the walk', () => {
    for (const action of Object.keys(H.ACTION_SECONDS)) {
      // Two bodies in lockstep; only one acts. The idle pose breathes, so the twin is the honest "no action" pose.
      const h = H.createHumanoid(); const twin = H.createHumanoid();
      h.update(1 / 60, 0, true); twin.update(1 / 60, 0, true);
      h.act(action);
      let peak = 0;
      const steps = Math.ceil((H.ACTION_SECONDS[action] + 0.1) * 60);
      for (let i = 0; i < steps; i++) {
        h.update(1 / 60, 0, true); twin.update(1 / 60, 0, true);
        peak = Math.max(peak, moved(bodyPose(h), bodyPose(twin)));
      }
      expect(peak, `${action} moved the body by ${peak.toFixed(2)}`).toBeGreaterThan(0.25);
      expect(h.acting(), action).toBeNull();
      h.update(1 / 60, 0, true); twin.update(1 / 60, 0, true);
      expect(moved(bodyPose(h), bodyPose(twin)), `${action} handed back to the idle pose`).toBeLessThan(1e-6);
    }
  });
  it('a landing after a real fall is squashed by itself; a step off a kerb is not', () => {
    const h = H.createHumanoid();
    for (let i = 0; i < 30; i++) h.update(1 / 60, 0, false);   // half a second in the air
    h.update(1 / 60, 0, true);
    expect(h.acting()).toBe('land');
    const k = H.createHumanoid();
    for (let i = 0; i < 3; i++) k.update(1 / 60, 0, false);
    k.update(1 / 60, 0, true);
    expect(k.acting()).toBeNull();
  });
  it('an action plays in the air too (the airborne tuck no longer swallows it)', () => {
    const h = H.createHumanoid();
    h.update(1 / 60, 0, false);
    const tuck = bodyPose(h);
    h.act('fire');
    h.update(1 / 60, 0, false);
    expect(moved(bodyPose(h), tuck)).toBeGreaterThan(0.25);
  });
});

function play(opts: Record<string, unknown> = {}) {
  const container = new FakeEl('div');
  let ctxRef: any;
  const game = new SHELL.Game({ container, setup: (ctx: any) => { ctxRef = ctx; return []; }, ...opts });
  game.loop.step(2);
  const button = (action: string) => container.find((e) => e.tag === 'button' && e.attrs['data-action'] === action)[0];
  const press = (action: string, id = 1) => button(action).fire('pointerdown', { pointerId: id, preventDefault() {} });
  const release = (action: string, id = 1) => button(action).fire('pointerup', { pointerId: id, preventDefault() {} });
  const key = (type: 'keydown' | 'keyup', code: string) => (game.canvas as FakeEl).fire(type, { code, repeat: false });
  return { game, ctx: () => ctxRef ?? game.context, press, release, key, button };
}

describe('🔴 a button the player presses is SEEN on the hero, with no game code at all', () => {
  it('the game gets the hero; the Attack button throws a punch and the arms move', () => {
    const t = play();
    const hero = t.ctx().hero;
    expect(hero).not.toBeNull();
    const before = bodyPose(hero);
    t.press('attack'); t.game.loop.step(1); t.release('attack');
    expect(hero.acting()).toBe('punch');
    t.game.loop.step(4);
    expect(moved(bodyPose(hero), before)).toBeGreaterThan(0.25);
    t.game.dispose();
  });
  it('a gun the player fires shows the recoil; an ENEMY firing the same way does not move the hero', () => {
    const t = play({ update: (ctx: any) => {
      if (ctx.input.wasPressed('attack')) E.events.emit('WEAPON_FIRED', { position: { x: 0, y: 1, z: 0 } });
      if ((globalThis as any).__enemyShoots) E.events.emit('WEAPON_FIRED', { position: { x: 5, y: 1, z: 5 }, ownerId: 'enemy-1' });
    } });
    const hero = t.ctx().hero;
    (globalThis as any).__enemyShoots = true;
    t.game.loop.step(10);
    expect(hero.acting(), 'an enemy shot posed the hero').toBeNull();
    (globalThis as any).__enemyShoots = false;
    t.press('attack'); t.game.loop.step(1); t.release('attack');
    expect(hero.acting()).toBe('fire');
    t.game.dispose();
  });
  it('a melee swing sweeps the arm; Use reaches; a jump launches; a hit flinches', () => {
    const t = play({ update: (ctx: any) => { if (ctx.input.wasPressed('attack')) E.events.emit('MELEE_SWING', {}); } });
    const hero = t.ctx().hero;
    t.press('attack'); t.game.loop.step(1); t.release('attack');
    expect(hero.acting()).toBe('swing');
    t.game.loop.step(40);
    t.press('interact'); t.game.loop.step(1); t.release('interact');
    expect(hero.acting()).toBe('use');
    t.game.loop.step(40);
    E.events.emit('PLAYER_DAMAGED', { amount: 5 });
    expect(hero.acting()).toBe('hit');
    t.game.loop.step(40);
    t.key('keydown', 'Space'); t.game.loop.step(1); t.key('keyup', 'Space');
    expect(hero.acting()).toBe('jump');
    t.game.dispose();
  });
  it('actionPoses maps the game\'s own actions; a body of the game\'s own is not the shell\'s to pose', () => {
    const t = play({ actionPoses: { kick: 'kick' }, touchControls: { buttons: [{ action: 'kick', label: 'Kick' }] } });
    t.press('kick'); t.game.loop.step(1); t.release('kick');
    expect(t.ctx().hero.acting()).toBe('kick');
    t.game.dispose();
    const own = play({ playerBody: H.createHumanoid().root });
    expect(own.ctx().hero).toBeNull();
    own.game.dispose();
  });
});

describe('🔴 a press is never lost', () => {
  it('a jump pressed during a hit-stop freeze happens when the freeze ends', () => {
    let jumped = 0;
    const off = E.events.on('PLAYER_JUMPED', () => { jumped++; });
    const t = play();
    t.game.loop.step(30);                                  // settle on the ground
    t.ctx().feel.addHitStop(0.15);
    t.game.loop.step(1);
    t.key('keydown', 'Space'); t.game.loop.step(1); t.key('keyup', 'Space');
    t.game.loop.step(20);                                  // the freeze ends
    expect(jumped).toBe(1);
    off(); t.game.dispose();
  });
  it('a game that reads "fire" or "shoot" hears the Attack button and the F key', () => {
    const heard: string[] = [];
    const t = play({ update: (ctx: any) => { for (const a of ['fire', 'shoot']) if (ctx.input.wasPressed(a)) heard.push(a); } });
    t.press('attack'); t.game.loop.step(1); t.release('attack');
    t.game.loop.step(2);
    t.key('keydown', 'KeyF'); t.game.loop.step(1); t.key('keyup', 'KeyF');
    expect(heard).toEqual(['fire', 'shoot', 'fire', 'shoot']);
    t.game.dispose();
  });
  it('keepPresses holds the edges for one more frame; a normal endFrame clears them', () => {
    const canvas = new FakeEl('canvas');
    const input = new IN.Input(canvas);
    canvas.fire('keydown', { code: 'KeyF', repeat: false });
    input.endFrame(true);
    expect(input.wasPressed('attack')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('attack')).toBe(false);
    input.dispose();
  });
});

describe('🏁 a drift is a slide you can SEE', () => {
  it('holding Drift at speed slides the car, leans the body and pours tyre smoke; without it the car grips', () => {
    const run = (drift: boolean) => {
      let car: any; let state: any;
      const t = play({
        setup: (ctx: any) => { car = O.createCar({ detail: 'lite' }); ctx.scene.add(car); state = O.createVehicleState(car); return []; },
        update: (ctx: any, dt: number) => { O.driveVehicle(car, state, ctx.input.axis(), dt); },
      });
      bursts.length = 0;
      t.key('keydown', 'ArrowUp'); t.game.loop.step(150);  // build speed
      if (drift) t.key('keydown', 'Space');
      t.key('keydown', 'ArrowLeft'); t.game.loop.step(45);
      const r = { slip: Math.abs(state.slip ?? 0), lean: Math.abs(car.rotation.z - (state.roll ?? 0)), smoke: bursts.filter((b) => b === 'smoke').length, drifting: state.drifting };
      t.game.dispose();
      return r;
    };
    const slide = run(true); const grip = run(false);
    expect(slide.drifting).toBe(true);
    expect(slide.slip).toBeGreaterThan(0.15);
    expect(slide.lean).toBeGreaterThan(0.02);
    expect(slide.smoke).toBeGreaterThan(5);
    expect(grip.slip).toBeLessThan(slide.slip / 3);
    expect(grip.smoke).toBe(0);
  });
  it('the drive layout has a Drift button', () => {
    const t = play();
    expect(t.button('drift')).toBeDefined();
    t.game.dispose();
  });
});

describe('the builder is taught, and a game\'s own body that never poses is caught', () => {
  it('the rule is in the architect prompt and in every game kit handoff', () => {
    expect(architectSystemPrompt('vite-react')).toContain(ACTION_VISIBLE_RULE);
    const block = gameKitHandoffBlock([{ recipe: 'generate_game_runtime', ok: true, content: 'Added runtime' }], { flat: true });
    expect(block).toContain(ACTION_VISIBLE_RULE);
  });
  it('a game body of its own that reads fire and never plays a pose is a finding; posing it, or the default body, is not', () => {
    const own = "const hero = createHumanoid(); if (input.wasPressed('fire')) bullets.fire(muzzle);";
    const idx = (files: Record<string, string>) => new Map(Object.entries(files).map(([p, c]) => [p, actionPoseHalves(p, c)]));
    expect(actionPoseFinding(idx({ 'src/game/shooter/player.ts': own }))).toEqual({ files: ['src/game/shooter/player.ts'], actions: ['fire'] });
    expect(actionPoseFinding(idx({ 'src/game/shooter/player.ts': own + " hero.act('fire');" }))).toBeNull();
    expect(actionPoseFinding(idx({ 'src/game/shooter/main.ts': "if (input.wasPressed('attack')) gun.fire();" }))).toBeNull();
    // Kit files are never read as the game's own.
    expect(actionPoseFinding(idx({ 'src/game/three/humanoid.ts': own }))).toBeNull();
  });
});
