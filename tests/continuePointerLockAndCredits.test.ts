// CONTINUE, POINTER LOCK, CREDITS (admin 2026-11-19 game-gap audit, P2). These run the REAL generated Game.ts and ui/Hud.tsx:
// with options.save the progress survives a visit (saved on pause / round end / hide) and the start screen offers Continue
// and New game; on a desktop the mouse is captured on Play and let go by every non-play screen, and losing the lock mid-play
// (the browser's Esc) pauses; options.credits gives a Credits screen.
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

const DIR = join(__dirname, `.tmp-continue-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let EV: any; let docListeners: Record<string, Array<() => void>> = {};
const store = new Map<string, string>();

beforeAll(async () => {
  (globalThis as any).__rec = rec;
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  (globalThis as any).document = { createElement: (t: string) => new FakeEl(t), addEventListener: (t: string, f: () => void) => { (docListeners[t] ??= []).push(f); }, removeEventListener: (t: string, f: () => void) => { docListeners[t] = (docListeners[t] ?? []).filter((x) => x !== f); }, hidden: false, pointerLockElement: null as unknown, exitPointerLock() { (globalThis as any).document.pointerLockElement = null; } };
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
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { store.clear(); STATE.resetRun(); STATE.setStatus('menu'); });



const doc = () => (globalThis as any).document;
const fire = (t: string) => (docListeners[t] ?? []).slice().forEach((f) => f());

describe('💾 save and Continue', () => {
  it('with options.save, progress is saved on pause and offered as Continue next visit; New game forgets it', () => {
    const a = new SHELL.Game({ container: new FakeEl('div'), setup: () => [], save: true, startScreen: {} });
    expect(a.canContinue).toBe(false);
    a.start(); a.play();
    STATE.state.score = 250; STATE.state.inventory.push('key');
    a.pause();
    a.dispose();
    STATE.resetRun(); STATE.state.inventory.length = 0;
    const b = new SHELL.Game({ container: new FakeEl('div'), setup: () => [], save: true, startScreen: {} });
    expect(b.canContinue).toBe(true);
    expect(STATE.state.score).toBe(250);
    expect(STATE.state.inventory).toEqual(['key']);
    b.start(); b.newGame();
    expect(STATE.state.score).toBe(0);
    expect(STATE.state.inventory).toEqual([]);
    expect(b.canContinue).toBe(false);
    b.dispose();
  });
  it('without options.save nothing is kept and Continue never shows', () => {
    const a = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    STATE.setStatus('playing'); STATE.state.score = 99; a.pause(); a.dispose();
    expect(store.size === 0 || ![...store.keys()].includes('game-save-v1')).toBe(true);
    expect(new SHELL.Game({ container: new FakeEl('div'), setup: () => [] }).canContinue).toBe(false);
  });
  it('the start screen shows Continue and New game only when there is something to continue', () => {
    const game = (canContinue: boolean) => ({ startScreenInfo: { title: 'T', subtitle: '', controls: { touch: '', keyboard: '' } }, canContinue, creditsList: [], canFullscreen: false, minimapOption: false, leaderboardId: 'g', fps: 60, quality: 'high', mapView: () => ({ x: 0, z: 0, forward: { x: 0, z: 1 }, facing: 0, markers: [] }) } as any);
    const yes = renderToStaticMarkup(createElement(HUD.Hud, { game: game(true) }));
    expect(yes).toContain('>Continue<'); expect(yes).toContain('>New game<');
    const no = renderToStaticMarkup(createElement(HUD.Hud, { game: game(false) }));
    expect(no).toContain('>Play<'); expect(no).not.toContain('>New game<');
  });
});

describe('🖱️ pointer lock', () => {
  it('🔴 Play captures the mouse on a desktop; pause lets it go; the browser dropping the lock mid-play pauses the game', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [], startScreen: {} });
    const canvas: any = game.canvas;
    let requested = 0;
    canvas.requestPointerLock = () => { requested++; doc().pointerLockElement = canvas; };
    game.start(); game.play();
    expect(requested).toBe(1);
    game.pause();
    expect(doc().pointerLockElement).toBeNull();
    game.resume();
    canvas.requestPointerLock();
    doc().pointerLockElement = null; fire('pointerlockchange');   // Esc: the browser let go
    expect(STATE.state.status).toBe('paused');
    game.dispose();
  });
  it('pointerLock: false never captures', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [], startScreen: {}, pointerLock: false });
    let requested = 0;
    (game.canvas as any).requestPointerLock = () => { requested++; };
    game.start(); game.play();
    expect(requested).toBe(0);
    game.dispose();
  });
});

describe('🙏 credits', () => {
  it('options.credits becomes a Credits screen', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [], credits: ['Asha', { role: 'Music', name: 'Ravi' }, { role: 'x', name: '' }] });
    expect(game.creditsList).toEqual([{ role: '', name: 'Asha' }, { role: 'Music', name: 'Ravi' }]);
    const html = renderToStaticMarkup(createElement(HUD.CreditsPanel, { list: game.creditsList, onBack: () => {} }));
    expect(html).toContain('Ravi'); expect(html).toContain('Music');
    game.dispose();
  });
});
