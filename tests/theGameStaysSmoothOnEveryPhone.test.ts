// SMOOTH ON EVERY PHONE (admin 2026-11-19 game-gap audit, P1: no frame-rate watch, no automatic quality — and the
// Graphics setting's "low = no shadows" promise was never kept). These run the REAL generated core/perf.ts, Game.ts and
// ui/Hud.tsx: the governor steps the picture down after sustained struggling and back up after a long good run, ignores
// hitches and the warm-up, never goes above the player's choice; the shell applies it (pixels, shadows) and reports it.
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

const DIR = join(__dirname, `.tmp-perf-${process.pid}`);

class FakeEl {
  children: FakeEl[] = []; parentElement: FakeEl | null = null; className = ''; textContent = ''; type = ''; tabIndex = -1;
  width = 0; height = 0; style: Record<string, string> = {}; attrs: Record<string, string> = {};
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
  getBoundingClientRect() { return { left: 0, top: 0, right: 844, bottom: 390, width: 844, height: 390 }; }
  getContext() { return { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }; }
  addEventListener(t: string, fn: (e: unknown) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
  removeEventListener(t: string, fn: (e: unknown) => void) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const rec = { volumes: [] as Array<[string, number]>, pixelRatios: [] as number[] };
const STUBS: Record<string, string> = {
  'src/game/three/renderer.ts':
    'export function createRenderer(): any { return { render() {}, dispose() {}, shadowMap: {}, getPixelRatio: () => 2, setPixelRatio(r: number) { (globalThis as any).__rec.pixelRatios.push(r); } }; }\n'
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
  'src/game/core/meta.ts':
    'export function startMeta(): void {}\nexport function mountMetaToasts(): () => void { return () => {}; }\n'
    + 'export const combo = { update(): void {}, break(): void {}, multiplier: 1 };\nexport const meta = { lastSummary: null };\nexport function summaryLines(): string[] { return []; }\n',
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} burst(): void {} }\n',
  'src/game/fx/audio.ts': 'export const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {}, setVolume(c: string, v: number): void { (globalThis as any).__rec.volumes.push([c, v]); } };\n',
  'src/game/fx/feedback.ts': 'export function bindGameFeedback(): () => void { return () => {}; }\n',
};

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let PERF: any; let EV: any;
const store = new Map<string, string>();

beforeAll(async () => {
  (globalThis as any).__rec = rec;
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  (globalThis as any).document = { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  (globalThis as any).window = Object.assign(new FakeEl('window'), { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
  (globalThis as any).getComputedStyle = (el: FakeEl) => ({ position: el.style.position || 'static' });
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  for (const [p, c] of Object.entries(STUBS)) writeFileSync(join(DIR, p), c);
  SET = await import(join(DIR, 'src/game/core/settings.ts'));
  STATE = await import(join(DIR, 'src/game/core/state.ts'));
  SHELL = await import(join(DIR, 'src/game/Game.ts'));
  HUD = await import(join(DIR, 'src/game/ui/Hud.tsx'));
  PERF = await import(join(DIR, 'src/game/core/perf.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { SET.settings.reset(); rec.pixelRatios.length = 0; STATE.setStatus('menu'); });



const frames = (gov: any, fps: number, seconds: number) => { let changed = 0; for (let t = 0; t < seconds; t += 1 / fps) if (gov.feed(1 / fps)) changed++; return changed; };

describe('📉 the governor', () => {
  it('a device holding 60 never drops; one stuck at 20 drops one level after ~3 s, then a second, never a third', () => {
    const fine = PERF.createPerfGovernor();
    frames(fine, 60, 30);
    expect(fine.drop).toBe(0);
    expect(fine.fps).toBeGreaterThan(55);
    const slow = PERF.createPerfGovernor();
    frames(slow, 20, 2 + 2.5);                    // warm-up + not yet 3 s of struggle
    expect(slow.drop).toBe(0);
    frames(slow, 20, 1.5);
    expect(slow.drop).toBe(1);
    frames(slow, 20, 30);
    expect(slow.drop).toBe(2);
  });
  it('a long good run brings it back up one level at a time; the middle band holds still', () => {
    const g = PERF.createPerfGovernor();
    frames(g, 20, 20);
    expect(g.drop).toBe(2);
    frames(g, 48, 60);                            // between low and high: no change either way
    expect(g.drop).toBe(2);
    frames(g, 60, 13);
    expect(g.drop).toBe(1);
    frames(g, 60, 13);
    expect(g.drop).toBe(0);
  });
  it('hitches (a tab switch, a long load) and the warm-up are ignored', () => {
    const g = PERF.createPerfGovernor();
    for (let i = 0; i < 40; i++) g.feed(0.9);     // 36 s of "frames" that are really pauses
    expect(g.drop).toBe(0);
    frames(g, 15, 1.9);                           // all inside the warm-up
    expect(g.drop).toBe(0);
    expect(g.feed(Number.NaN)).toBe(false);
    expect(g.feed(-1)).toBe(false);
  });
  it('steppedQuality never goes above the choice and never below low', () => {
    expect(PERF.steppedQuality('high', 0)).toBe('high');
    expect(PERF.steppedQuality('high', 1)).toBe('medium');
    expect(PERF.steppedQuality('high', 2)).toBe('low');
    expect(PERF.steppedQuality('medium', 5)).toBe('low');
    expect(PERF.steppedQuality('low', 0)).toBe('low');
  });
});

describe('🎮 the shell applies it', () => {
  function play() {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    STATE.setStatus('playing');
    return game;
  }
  const stepAt = (game: any, fps: number, seconds: number) => { for (let t = 0; t < seconds; t += 1 / fps) game.render(1, 1 / fps); };

  it('a struggling device is stepped down: fewer pixels, then no shadows; the player\'s choice is the ceiling', () => {
    const game = play();
    expect(game.quality).toBe('high');
    expect(game.lights.key.castShadow).toBe(true);
    const heard: any[] = [];
    const off = EV.events.on('PERF_CHANGED', (p: any) => heard.push(p));
    stepAt(game, 20, 6);
    expect(game.quality).toBe('medium');
    expect(rec.pixelRatios.at(-1)).toBeCloseTo(2 * 0.8);
    stepAt(game, 20, 4);
    expect(game.quality).toBe('low');
    expect(game.lights.key.castShadow).toBe(false);
    expect(heard.at(-1)).toMatchObject({ quality: 'low', chosen: 'high', auto: true });
    expect(game.fps).toBeLessThan(40);
    off(); game.dispose();
  });
  it('Auto quality off: the player\'s choice stands however slow it runs; Low always drops the shadows', () => {
    SET.settings.set({ autoQuality: false });
    const game = play();
    stepAt(game, 15, 12);
    expect(game.quality).toBe('high');
    SET.settings.set({ quality: 'low' });
    expect(game.quality).toBe('low');
    expect(game.lights.key.castShadow).toBe(false);
    SET.settings.set({ quality: 'high' });
    expect(game.lights.key.castShadow).toBe(true);
    game.dispose();
  });
  it('a frozen start screen or pause menu is never measured', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    STATE.setStatus('paused');
    stepAt(game, 10, 12);
    expect(game.quality).toBe('high');
    game.dispose();
  });
  it('the settings are validated and saved; the FPS counter shows the rate and the quality', () => {
    expect(SET.sanitizeSettings({ autoQuality: 'yes', showFps: 1 })).toMatchObject({ autoQuality: true, showFps: false });
    const html = renderToStaticMarkup(createElement(HUD.FpsCounter, { game: { fps: 24, quality: 'medium' } }));
    expect(html).toContain('24 FPS · Balanced');
    expect(html).toContain('#f87171');
  });
});
