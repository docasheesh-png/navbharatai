// SHARE THE SCORE, CLIMB YOUR OWN BOARD (admin 2026-11-19 game-gap audit, P2: no share and no leaderboard). These run the
// REAL generated core/leaderboard.ts, Game.ts and ui/Hud.tsx: every finished round lands on this device's top ten by
// itself, the end screen lists the best five with this round highlighted, and Share uses the phone's share sheet or copies.
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

const DIR = join(__dirname, `.tmp-share-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let LB: any; let EV: any; let STR: any;
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
  LB = await import(join(DIR, 'src/game/core/leaderboard.ts'));
  STR = await import(join(DIR, 'src/game/core/strings.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { store.clear(); STATE.setStatus('menu'); });



describe('🏆 the leaderboard on this device', () => {
  it('keeps the top ten, best first, and says which place a score took', () => {
    for (const sc of [50, 300, 120]) LB.leaderboard.record('g', sc);
    expect(LB.leaderboard.top('g').map((e: any) => e.score)).toEqual([300, 120, 50]);
    expect(LB.leaderboard.record('g', 200)).toBe(2);
    for (let i = 0; i < 10; i++) LB.leaderboard.record('g', 1000 + i);
    expect(LB.leaderboard.top('g')).toHaveLength(10);
    expect(LB.leaderboard.record('g', 1)).toBeNull();
    expect(LB.leaderboard.record('g', 0)).toBeNull();
    expect(LB.leaderboard.top('other')).toEqual([]);
  });
  it('a corrupt save is ignored, not a crash', () => {
    store.set('nb-leaderboard:bad', '{oops');
    expect(LB.leaderboard.top('bad')).toEqual([]);
    store.set('nb-leaderboard:bad2', JSON.stringify([{ score: 'x' }, { score: 40, name: 'A' }, { score: -3 }]));
    expect(LB.leaderboard.top('bad2').map((e: any) => e.score)).toEqual([40]);
  });
  it('🔴 the shell records every finished round by itself, under the game\'s id', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [], gameId: 'rally' });
    STATE.setStatus('playing'); STATE.state.score = 420; STATE.setStatus('gameover');
    game.restart(); STATE.state.score = 77; STATE.setStatus('won');
    expect(LB.leaderboard.top('rally').map((e: any) => e.score)).toEqual([420, 77]);
    game.dispose();
  });
  it('the end screen lists the best five with the round just played highlighted', () => {
    LB.leaderboard.record('h', 500); LB.leaderboard.record('h', 900); LB.leaderboard.record('h', 700);
    const html = renderToStaticMarkup(createElement(HUD.DeviceLeaderboard, { gameId: 'h' }));
    expect(html).toContain('Best on this device');
    expect(html).toMatch(/<li style="font-weight:900;color:#fde047">700<\/li>/);
    expect(html.indexOf('>900<')).toBeLessThan(html.indexOf('>700<'));
    expect(renderToStaticMarkup(createElement(HUD.DeviceLeaderboard, { gameId: 'empty' }))).toBe('');
  });
});

describe('📤 sharing the score', () => {
  const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const withNav = (nav: unknown) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
  const restore = () => { if (realNav) Object.defineProperty(globalThis, 'navigator', realNav); else delete (globalThis as any).navigator; };
  it('uses the share sheet where there is one, copies where there is not, and says when neither exists', async () => {
    const shared: any[] = [];
    withNav({ share: async (d: any) => { shared.push(d); } });
    expect(await HUD.shareScore('I scored 9', 'https://x')).toBe('shared');
    expect(shared).toEqual([{ text: 'I scored 9', url: 'https://x' }]);
    const copied: string[] = [];
    withNav({ clipboard: { writeText: async (t: string) => { copied.push(t); } } });
    expect(await HUD.shareScore('I scored 9', 'https://x')).toBe('copied');
    expect(copied).toEqual(['I scored 9 https://x']);
    withNav({ share: async () => { throw new Error('dismissed'); }, clipboard: { writeText: async () => {} } });
    expect(await HUD.shareScore('a', 'b')).toBe('copied');
    withNav({});
    expect(await HUD.shareScore('a', 'b')).toBe('unavailable');
    expect(HUD.canShare()).toBe(false);
    restore();
  });
  it('the share text names the score and the game, in the player\'s language', () => {
    expect(STR.t('shareText', { score: 1250, game: 'Desert Rally' })).toBe('I scored 1250 in Desert Rally! Can you beat it?');
  });
});
