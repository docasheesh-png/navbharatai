// A DEATH THE PLAYER CAN SEE (admin 2026-11-19 game-gap audit, P2: a body that "died" kept standing or vanished). These
// run the REAL generated three/humanoid.ts and Game.ts: die() topples the body from the hips onto the ground (backward
// when hit from the front, forward from behind) and it stays down — no walking, no actions — until revive(); the shell
// drops the player's body on PLAYER_DIED and stands it up for the next life.
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

const DIR = join(__dirname, `.tmp-death-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let HM: any; let EV: any;
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
  HM = await import(join(DIR, 'src/game/three/humanoid.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { STATE.resetRun(); STATE.setStatus('menu'); });



const step = (h: any, seconds: number, speed = 0) => { for (let i = 0; i < Math.round(seconds * 60); i++) h.update(1 / 60, speed, true); };

describe('💀 the humanoid falls and stays down', () => {
  it('🔴 die() topples the body from the hips onto the ground over about 0.6 s', () => {
    const h = HM.createHumanoid();
    const standing = h.joints.hips.position.y;
    h.die();
    step(h, 0.1);
    const early = h.joints.hips.rotation.x;
    step(h, 0.6);
    expect(Math.abs(early)).toBeLessThan(Math.PI / 2 - 0.3);           // still falling at 0.1 s
    expect(h.joints.hips.rotation.x).toBeCloseTo(-Math.PI / 2, 3);     // backward: hit from the front
    expect(h.joints.hips.position.y).toBeLessThan(standing * 0.4);
    expect(h.isDown()).toBe(true);
  });
  it('hit from behind falls forward; while down it neither walks nor plays actions', () => {
    const h = HM.createHumanoid();
    h.die(false);
    step(h, 1);
    expect(h.joints.hips.rotation.x).toBeCloseTo(Math.PI / 2, 3);
    const legs = h.joints.leftHip.rotation.x;
    step(h, 1, 5);                                                      // asked to run
    expect(h.joints.leftHip.rotation.x).toBeCloseTo(legs, 6);
    h.act('punch');
    step(h, 0.1);
    expect(h.acting()).toBeNull();
  });
  it('revive() stands it straight back up, ready to walk', () => {
    const h = HM.createHumanoid();
    h.die(); step(h, 1); h.revive();
    expect(h.isDown()).toBe(false);
    expect(h.joints.hips.rotation.x).toBe(0);
    step(h, 0.5, 3);
    expect(Math.abs(h.joints.leftHip.rotation.x)).toBeGreaterThan(0.05);
  });
});

describe('🎮 the shell plays it for the player', () => {
  it('🔴 PLAYER_DIED drops the player\'s body; the next life (PLAYER_SPAWNED) or round stands it up', () => {
    let ctxRef: any;
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: (ctx: any) => { ctxRef = ctx; return []; } });
    STATE.setStatus('playing');
    game.loop.step(1);
    expect(ctxRef.hero).not.toBeNull();
    EV.events.emit('PLAYER_DIED', { livesLeft: 2 });
    expect(ctxRef.hero.isDown()).toBe(true);
    EV.events.emit('PLAYER_SPAWNED', {});
    expect(ctxRef.hero.isDown()).toBe(false);
    EV.events.emit('PLAYER_DIED', { livesLeft: 0 });
    game.restart();
    expect(ctxRef.hero.isDown()).toBe(false);
    game.dispose();
  });
});
