import * as THREE from 'three';
// TWO PLAYERS ON ONE DEVICE (admin 2026-11-19 game-gap audit, P2 local multiplayer). These run the REAL generated
// core/input.ts, three/splitscreen.ts and Game.ts: player 1 and player 2 have their own keys and their own gamepad (a
// press for one never moves the other), and a split screen draws each camera in its own half with the right shape.
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

const DIR = join(__dirname, `.tmp-2p-${process.pid}`);

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
const rec = { volumes: [] as Array<[string, number]>, pixelRatios: [] as number[], renders: [] as string[], viewports: [] as number[][] };
const STUBS: Record<string, string> = {
  'src/game/three/renderer.ts':
    'export function createRenderer(): any { const rec = (globalThis as any).__rec; return { render(_s: unknown, c: any) { rec.renders.push(c.uuid); }, dispose() {}, shadowMap: {}, getPixelRatio: () => 2, setPixelRatio(r: number) { rec.pixelRatios.push(r); }, getSize: (v: any) => v.set(800, 400), setViewport(x: number, y: number, w: number, h: number) { rec.viewports.push([x, y, w, h]); }, setScissor() {}, setScissorTest() {} }; }\n'
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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let EV: any; let IN: any; let SPLIT: any;
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
  IN = await import(join(DIR, 'src/game/core/input.ts'));
  SPLIT = await import(join(DIR, 'src/game/three/splitscreen.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { STATE.setStatus('menu'); });



class KeyTarget { private l = new Map<string, Array<(e: unknown) => void>>(); addEventListener(t: string, f: (e: unknown) => void) { this.l.set(t, [...(this.l.get(t) ?? []), f]); } removeEventListener() { /* gone */ } fire(t: string, e: unknown) { (this.l.get(t) ?? []).forEach((f) => f(e)); } }
const key = (target: KeyTarget, type: 'keydown' | 'keyup', code: string) => target.fire(type, { code, repeat: false });

describe('🎮🎮 two players, two sets of controls', () => {
  it('🔴 player 1 has WASD (not the arrows), player 2 has the arrows; one\'s keys never move the other', () => {
    const t = new KeyTarget();
    const p1 = new IN.Input(t, IN.PLAYER1_ACTIONS), p2 = new IN.Input(t, IN.PLAYER2_ACTIONS);
    key(t, 'keydown', 'ArrowUp');
    expect(p1.axis()).toEqual({ x: 0, y: 0 });
    expect(p2.axis().y).toBe(-1);
    key(t, 'keyup', 'ArrowUp'); key(t, 'keydown', 'KeyW');
    expect(p1.axis().y).toBe(-1);
    expect(p2.axis()).toEqual({ x: 0, y: 0 });
    key(t, 'keydown', 'ShiftRight');
    expect(p2.wasPressed('jump')).toBe(true);
    expect(p1.wasPressed('jump')).toBe(false);
    for (const codes of Object.values(IN.PLAYER1_ACTIONS) as string[][]) expect(codes.some((c) => c.startsWith('Arrow'))).toBe(false);
  });
  it('each player reads only their own gamepad', () => {
    const pad = (x: number) => ({ connected: true, mapping: 'standard', axes: [x, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
    const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad(1), pad(-1)] } });
    const t = new KeyTarget();
    const p1 = new IN.Input(t, IN.PLAYER1_ACTIONS, { padIndex: 0 }), p2 = new IN.Input(t, IN.PLAYER2_ACTIONS, { padIndex: 1 });
    p1.pollGamepads(); p2.pollGamepads();
    expect(p1.axis().x).toBeCloseTo(1); expect(p2.axis().x).toBeCloseTo(-1);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad(1)] } });
    p2.pollGamepads();
    expect(p2.gamepad).toBe(false);
    if (real) Object.defineProperty(globalThis, 'navigator', real); else delete (globalThis as any).navigator;
  });
});

describe('🖥️ the split screen', () => {
  it('side by side when wide, one above the other when tall (player 1 left / top), covering the screen exactly', () => {
    expect(SPLIT.splitRects(800, 400, 2)).toEqual([{ x: 0, y: 0, w: 400, h: 400 }, { x: 400, y: 0, w: 400, h: 400 }]);
    expect(SPLIT.splitRects(400, 801, 2)).toEqual([{ x: 0, y: 401, w: 400, h: 400 }, { x: 0, y: 0, w: 400, h: 401 }]);
    expect(SPLIT.splitRects(800, 400, 1)).toEqual([{ x: 0, y: 0, w: 800, h: 400 }]);
  });
  it('🔴 the shell gives ctx.players two inputs and draws two views once the game passes player 2\'s camera', () => {
    let ctxRef: any;
    const game = new SHELL.Game({ container: new FakeEl('div'), players: 2, setup: (ctx: any) => { ctxRef = ctx; return []; } });
    game.loop.step(1);
    expect(ctxRef.players).toHaveLength(2);
    expect(ctxRef.players[0]).toBe(ctxRef.input);
    const cam2 = new THREE.PerspectiveCamera();
    ctxRef.splitScreen(cam2);
    rec.renders.length = 0; rec.viewports.length = 0;
    game.loop.step(1);
    expect(rec.renders).toEqual([game.rig.camera.uuid, cam2.uuid]);
    expect(rec.viewports.slice(0, 2)).toEqual([[0, 0, 400, 400], [400, 0, 400, 400]]);
    expect(cam2.aspect).toBe(1);
    ctxRef.splitScreen(null);
    rec.renders.length = 0;
    game.loop.step(1);
    expect(rec.renders).toEqual([game.rig.camera.uuid]);
    game.dispose();
    const solo = new SHELL.Game({ container: new FakeEl('div'), setup: (ctx: any) => { ctxRef = ctx; return []; } });
    expect(ctxRef.players).toHaveLength(1);
    solo.dispose();
  });
});
