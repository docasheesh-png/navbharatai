// THE GAME FEELS RIGHT ON A PHONE (admin 2026-11-19 game-gap audit, P0 #4, #5, #9): a loading bar instead of a blank
// screen, full screen with the orientation locked, the notch respected, and a vibration on every hit — not only on
// rewards. These tests run the REAL generated core/loading.ts, core/meta.ts, core/settings.ts, fx/feedback.ts, Game.ts and
// ui/Hud.tsx.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameAssetRuntime } from '../src/server/lib/GameAssetRuntimeGenerator';

const DIR = join(__dirname, `.tmp-phone-feel-${process.pid}`);

class FakeEl {
  children: FakeEl[] = []; parentElement: FakeEl | null = null; className = ''; textContent = ''; type = ''; tabIndex = -1;
  width = 0; height = 0; style: Record<string, string> = {}; attrs: Record<string, string> = {}; fullscreenCalls = 0;
  private listeners = new Map<string, Array<(e: unknown) => void>>();
  classList = {
    add: (...c: string[]) => { const set = new Set(this.className.split(' ').filter(Boolean)); c.forEach((x) => set.add(x)); this.className = [...set].join(' '); },
    remove: (...c: string[]) => { this.className = this.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  constructor(public tag: string) {}
  appendChild(c: FakeEl) { c.parentElement = this; this.children.push(c); return c; }
  removeChild(c: FakeEl) { this.children = this.children.filter((x) => x !== c); return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  setPointerCapture() { /* captured */ }
  focus() { /* focused */ }
  async requestFullscreen() { this.fullscreenCalls++; (globalThis as any).document.fullscreenElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 844, bottom: 390, width: 844, height: 390 }; }
  getContext() { return { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }; }
  addEventListener(t: string, fn: (e: unknown) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
  removeEventListener(t: string, fn: (e: unknown) => void) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    'export class GameLoop {\n  running = false; paused = false;\n'
    + '  constructor(private readonly update: (dt: number) => void, private readonly render: (alpha: number, frameDelta: number) => void) {}\n'
    + '  start(): void { this.running = true; }\n  stop(): void { this.running = false; }\n  setPaused(p: boolean): void { this.paused = p; }\n'
    + '  step(n = 1, dt = 1 / 60): void { for (let i = 0; i < n; i++) { if (!this.paused) this.update(dt); this.render(1, dt); } }\n}\n',
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} burst(): void {} }\n',
  'src/game/fx/audio.ts': "export type SoundCategory = 'music' | 'sfx' | 'ui';\nexport const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {}, setVolume(): void {}, play(): () => void { return () => {}; }, playMusic(): void {}, stopMusic(): void {}, duckMusic(): void {} };\n",
};

let LOAD: any; let EV: any; let SET: any; let FB: any; let SHELL: any; let HUD: any; let CANVAS: any; let META: any;
const vibrations: Array<number | number[]> = [];
const viewport = { content: 'width=device-width, initial-scale=1' };
const lockCalls: string[] = [];

beforeAll(async () => {
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  (globalThis as any).document = {
    createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false,
    fullscreenEnabled: true, fullscreenElement: null, exitFullscreen: async () => { (globalThis as any).document.fullscreenElement = null; },
    querySelector: (q: string) => (q.includes('viewport') ? viewport : null),
  };
  (globalThis as any).window = Object.assign(new FakeEl('window'), { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: true }) });
  (globalThis as any).getComputedStyle = (el: FakeEl) => ({ position: el.style.position || 'static' });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: (p: number | number[]) => { vibrations.push(p); return true; }, userActivation: { hasBeenActive: true } } });
  Object.defineProperty(globalThis, 'screen', { configurable: true, value: { orientation: { lock: async (o: string) => { lockCalls.push(o); } } } });
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  for (const [p, c] of Object.entries(STUBS)) writeFileSync(join(DIR, p), c);
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  LOAD = await import(join(DIR, 'src/game/core/loading.ts'));
  SET = await import(join(DIR, 'src/game/core/settings.ts'));
  META = await import(join(DIR, 'src/game/core/meta.ts'));
  FB = await import(join(DIR, 'src/game/fx/feedback.ts'));
  SHELL = await import(join(DIR, 'src/game/Game.ts'));
  HUD = await import(join(DIR, 'src/game/ui/Hud.tsx'));
  CANVAS = await import(join(DIR, 'src/game/GameCanvas.tsx'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', 'localStorage', 'navigator', 'screen']) delete (globalThis as any)[k];
});
beforeEach(() => { vibrations.length = 0; lockCalls.length = 0; SET.settings.reset(); (globalThis as any).document.fullscreenElement = null; });

describe('⏳ loading progress is real, and is shown', () => {
  it('jobs move the fraction only by their own progress, and it ends when the last one ends', () => {
    const a = LOAD.loading.begin('Loading models');
    const b = LOAD.loading.begin('Loading models');
    expect(LOAD.loading.get()).toMatchObject({ active: true, pending: 2, fraction: 0 });
    LOAD.loading.progress(a, 0.5);
    expect(LOAD.loading.get().fraction).toBeCloseTo(0.25);
    LOAD.loading.end(a);
    expect(LOAD.loading.get().fraction).toBeCloseTo(0.5);
    LOAD.loading.end(b);
    expect(LOAD.loading.get()).toMatchObject({ active: false, pending: 0, fraction: 1 });
  });
  it('the model loader reports on the event bus (never importing loading.ts), and loading.ts turns it into progress', () => {
    const src = generateGameAssetRuntime();
    expect(src).toContain("import { events } from '../core/events';");
    expect(src).not.toMatch(/from '\.\.\/core\/loading'/);
    expect(src).toMatch(/events\.emit\('ASSET_LOADING', \{ id: job, fraction: 1, done: true \}\)/);
    EV.events.emit('ASSET_LOADING', { id: 77, fraction: 0, done: false });
    EV.events.emit('ASSET_LOADING', { id: 77, fraction: 0.6, done: false });
    expect(LOAD.loading.get()).toMatchObject({ active: true, label: 'Loading models' });
    expect(LOAD.loading.get().fraction).toBeCloseTo(0.6);
    EV.events.emit('ASSET_LOADING', { id: 77, fraction: 1, done: true });
    expect(LOAD.loading.get().active).toBe(false);
  });
  it('the Hud draws a progress bar while loading, nothing otherwise; the canvas says Loading… before the world exists', () => {
    expect(renderToStaticMarkup(createElement(HUD.LoadingBar, { state: { active: false, fraction: 1, label: '', pending: 0 } }))).toBe('');
    const bar = renderToStaticMarkup(createElement(HUD.LoadingBar, { state: { active: true, fraction: 0.42, label: 'Loading models', pending: 1 } }));
    expect(bar).toContain('role="progressbar"');
    expect(bar).toContain('aria-valuenow="42"');
    expect(bar).toContain('Loading models 42%');
    expect(renderToStaticMarkup(createElement(CANVAS.GameCanvas, {}))).toContain('Loading…');
  });
});

describe('📱 full screen, the orientation, the notch', () => {
  it('the game asks for viewport-fit=cover while mounted and gives the page its viewport back on dispose', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    expect(viewport.content).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
    game.dispose();
    expect(viewport.content).toBe('width=device-width, initial-scale=1');
  });
  it('Full screen fills the screen and locks it sideways; orientation "any" never locks; a second toggle leaves', async () => {
    const host = new FakeEl('div'); const container = new FakeEl('div'); host.appendChild(container);
    const game = new SHELL.Game({ container, setup: () => [] });
    expect(game.canFullscreen).toBe(true);
    await game.toggleFullscreen();
    expect(host.fullscreenCalls).toBe(1);
    expect(game.isFullscreen).toBe(true);
    expect(lockCalls).toEqual(['landscape']);
    await game.toggleFullscreen();
    expect(game.isFullscreen).toBe(false);
    game.dispose();
    const free = new SHELL.Game({ container: new FakeEl('div'), orientation: 'any', setup: () => [] });
    await free.toggleFullscreen();
    expect(lockCalls).toEqual(['landscape']);
    free.dispose();
  });
  it('on a phone, Play goes full screen (the tap is the permission)', async () => {
    const host = new FakeEl('div'); const container = new FakeEl('div'); host.appendChild(container);
    const game = new SHELL.Game({ container, startScreen: {}, setup: () => [] });
    game.start();
    game.play();
    await Promise.resolve();
    expect(host.fullscreenCalls).toBe(1);
    game.dispose();
  });
  it('the Hud shows the Full screen button only where the browser allows it', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    game.start();
    expect(renderToStaticMarkup(createElement(HUD.Hud, { game }))).toMatch(/aria-label="Full screen"/);
    (globalThis as any).document.fullscreenEnabled = false;
    expect(renderToStaticMarkup(createElement(HUD.Hud, { game }))).not.toMatch(/aria-label="Full screen"/);
    (globalThis as any).document.fullscreenEnabled = true;
    game.dispose();
  });
});

describe('📳 a hit is FELT, and the player can turn it off', () => {
  it('taking damage, dying and a melee hit vibrate the phone through the feedback table', () => {
    const off = FB.bindGameFeedback({});
    META.meta.profile.haptics = true;
    EV.events.emit('PLAYER_DAMAGED', { amount: 5 });
    EV.events.emit('MELEE_HIT', {});
    expect(vibrations).toEqual([[45, 30, 45], 25]);
    SET.settings.set({ vibration: false });
    EV.events.emit('PLAYER_DAMAGED', { amount: 5 });
    expect(vibrations).toHaveLength(2);
    off();
  });
  it('every hit-class event in the table carries a haptic', () => {
    for (const e of ['PLAYER_DAMAGED', 'PLAYER_DIED', 'MELEE_HIT', 'PROJECTILE_HIT', 'ENEMY_DIED', 'BOSS_DEFEATED']) {
      expect(FB.FEEDBACK[e]?.haptic, e).toBeDefined();
    }
  });
});
