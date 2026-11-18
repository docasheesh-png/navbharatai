// A GAME ALWAYS RUNS WHEN IT SAYS IT IS PLAYING (autopsy 2026-11-17, published battle royale a-6b8ad5b4…).
//
// Admin, verbatim: *"par mai chahta hu har baar pura game open ho"*. The published game showed its HUD
// (Score 0 · Enemies left 19 · ⏸) over an empty page. Its own setup() called setStatus('playing'), so the
// HUD hid the Play menu, while the shell ran its loop only from start() — which nothing called. Not one frame
// was drawn; the playtest read "input ignored · no canvas large enough to measure" (Controls 0).
//
// THE CLASS: the loop was tied to ONE caller (start()) instead of to the state it represents. These tests run
// the REAL generated Game.ts and core/state.ts and require that 'playing' from ANY caller runs the loop, and
// that the world is drawn once even behind the menu.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-loop-follows-status-${process.pid}`);

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
    'export function createRenderer(): any { return { render() { (globalThis as any).__frames = ((globalThis as any).__frames ?? 0) + 1; }, dispose() {}, shadowMap: {} }; }\n'
    + 'export function handleResize(): () => void { return () => {}; }\n',
  'src/game/three/lighting.ts':
    "import * as THREE from 'three';\nexport type LightingPresetName = string;\n"
    + 'export interface AppliedLighting { key: THREE.DirectionalLight }\n'
    + 'export function applyLighting(scene: THREE.Scene): AppliedLighting { const key = new THREE.DirectionalLight(); scene.add(key); return { key }; }\n'
    + 'export function followShadow(): void {}\n',
  'src/game/core/loop.ts':
    'export class GameLoop {\n'
    + '  constructor(private readonly update: (dt: number) => void, private readonly render: (alpha: number, frameDelta: number) => void) {}\n'
    + '  running = false;\n  start(): void { this.running = true; }\n  stop(): void { this.running = false; }\n  setPaused(): void {}\n'
    + '  step(n = 1, dt = 1 / 60): void { for (let i = 0; i < n; i++) { this.update(dt); this.render(1, dt); } }\n}\n',
  'src/game/core/meta.ts':
    'export function startMeta(): void {}\nexport function mountMetaToasts(): () => void { return () => {}; }\n'
    + 'export const combo = { update(): void {}, break(): void {} };\n',
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} }\n',
  'src/game/fx/audio.ts': 'export const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {} };\n',
  'src/game/fx/feedback.ts': 'export function bindGameFeedback(): () => void { return () => {}; }\n',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let SHELL: any; let STATE: any;

beforeAll(async () => {
  (globalThis as any).document = { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  (globalThis as any).window = Object.assign(new FakeEl('window'), { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: true }) });
  (globalThis as any).getComputedStyle = (el: FakeEl) => ({ position: el.style.position || 'static' });
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  for (const [p, c] of Object.entries(STUBS)) writeFileSync(join(DIR, p), c);
  STATE = await import(join(DIR, 'src/game/core/state.ts'));
  SHELL = await import(join(DIR, 'src/game/Game.ts'));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__frames']) delete (globalThis as any)[k];
});
beforeEach(() => { STATE.setStatus('menu'); (globalThis as any).__frames = 0; });

const make = (setup?: (ctx: any) => void) => new SHELL.Game({ container: new FakeEl('div'), setup: (ctx: any) => { setup?.(ctx); return []; } });

describe('🔴 the loop runs whenever the game is playing, whoever set it', () => {
  it("the game's own setup() sets 'playing' (the published battle royale): the loop runs and a frame is drawn", () => {
    const game = make(() => STATE.setStatus('playing'));
    expect(STATE.state.status).toBe('playing');
    expect(game.loop.running, 'the HUD says playing but no frame would ever be drawn').toBe(true);
    expect((globalThis as any).__frames).toBeGreaterThanOrEqual(1);
    game.dispose();
  });

  it("a menu game draws its world once behind the menu, and runs on Play (start())", () => {
    const game = make();
    expect(game.loop.running).toBe(false);
    expect((globalThis as any).__frames, 'an empty page behind the menu').toBeGreaterThanOrEqual(1);
    game.start();
    expect(game.loop.running).toBe(true);
    game.dispose();
  });

  it("game code that sets 'playing' later (a button of its own) also runs the loop", () => {
    const game = make();
    STATE.setStatus('playing');
    expect(game.loop.running).toBe(true);
    game.dispose();
  });

  it("a disposed game is never restarted by a later 'playing'", () => {
    const game = make();
    game.dispose();
    STATE.setStatus('playing');
    expect(game.loop.running).toBe(false);
  });
});
