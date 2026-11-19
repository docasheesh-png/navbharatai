// THE GAME HAS MENUS, AND ITS SETTINGS ACTUALLY DO SOMETHING (admin 2026-11-19 game-gap audit, P0 #1–2).
//
// Found: a <GameCanvas> game opened straight into play (no start screen); the pause menu had only "Resume"; there was no
// mute; and state.settings held a music volume, an sfx volume and a quality that NOTHING read. These tests run the
// REAL generated core/settings.ts, Game.ts and ui/Hud.tsx: the settings are validated and saved, mute silences the
// master bus, quality lowers the renderer's pixels, look speed scales the camera, and the screens carry real buttons.
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
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';

const DIR = join(__dirname, `.tmp-menus-settings-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any;
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
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { SET.settings.reset(); rec.volumes.length = 0; rec.pixelRatios.length = 0; STATE.setStatus('menu'); });

describe('⚙️ settings are validated, saved and announced', () => {
  it('a change is saved on the device, mirrored into state.settings, and every listener hears it', () => {
    const heard: any[] = [];
    const off = SET.settings.subscribe((s: any) => heard.push(s));
    SET.settings.set({ musicVolume: 0.25, quality: 'low' });
    off();
    expect(JSON.parse(store.get('nb-game-settings-v1')!)).toMatchObject({ musicVolume: 0.25, quality: 'low' });
    expect(STATE.state.settings).toMatchObject({ musicVolume: 0.25, quality: 'low' });
    expect(heard.at(-1)).toMatchObject({ musicVolume: 0.25, quality: 'low' });
  });
  it('untrusted values fall back to the defaults (a corrupt save never breaks the game)', () => {
    expect(SET.sanitizeSettings({ masterVolume: 9, musicVolume: 'loud', quality: 'ultra', lookSensitivity: 100, muted: 'yes' }))
      .toEqual({ ...SET.DEFAULT_SETTINGS, masterVolume: 1, lookSensitivity: 3 });
    expect(SET.sanitizeSettings(null)).toEqual(SET.DEFAULT_SETTINGS);
  });
  it('toggleMute flips and returns the new state', () => {
    expect(SET.settings.toggleMute()).toBe(true);
    expect(SET.settings.toggleMute()).toBe(false);
  });
});

describe('🔴 the shell APPLIES the settings (they used to be stored and never read)', () => {
  it('mute silences the master bus without losing the volume; volumes reach their buses', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    SET.settings.set({ masterVolume: 0.7, sfxVolume: 0.4 });
    expect(rec.volumes).toContainEqual(['master', 0.7]);
    expect(rec.volumes).toContainEqual(['sfx', 0.4]);
    SET.settings.set({ muted: true });
    expect(rec.volumes.filter(([c]) => c === 'master').at(-1)).toEqual(['master', 0]);
    SET.settings.set({ muted: false });
    expect(rec.volumes.filter(([c]) => c === 'master').at(-1)).toEqual(['master', 0.7]);
    game.dispose();
  });
  it('quality scales DOWN from the pixel ratio the device chose, never above it', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    SET.settings.set({ quality: 'low' });
    expect(rec.pixelRatios.at(-1)).toBeCloseTo(1.1);
    SET.settings.set({ quality: 'high' });
    expect(rec.pixelRatios.at(-1)).toBe(2);
    game.dispose();
  });
  it('after dispose, a settings change no longer reaches the old game', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    game.dispose();
    rec.volumes.length = 0;
    SET.settings.set({ sfxVolume: 0.1 });
    expect(rec.volumes).toEqual([]);
  });
});

describe('🔴 the screens: a start screen, a full pause menu, a mute button', () => {
  const html = (game: any) => renderToStaticMarkup(createElement(HUD.Hud, { game }));
  it('a GameCanvas-style game opens on a start screen with Play and Settings; Play begins the round', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), startScreen: { title: 'Desert Rally', subtitle: 'Beat the clock' }, setup: () => [] });
    game.start();
    const menu = html(game);
    expect(menu).toContain('Desert Rally');
    expect(menu).toContain('Beat the clock');
    expect(menu).toMatch(/<button[^>]*>Play<\/button>/);
    expect(menu).toMatch(/<button[^>]*>Settings<\/button>/);
    expect(menu).toContain('WASD');                               // keyboard text on a non-touch device
    game.play();
    expect(STATE.state.status).toBe('playing');
    const hud = html(game);
    expect(hud).toMatch(/aria-label="Mute"/);
    expect(hud).toMatch(/aria-label="Pause"/);
    game.dispose();
  });
  it('the pause menu has Resume, Restart, Settings and Menu; game over has Play again and Menu', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), startScreen: {}, setup: () => [] });
    game.start(); game.play(); game.pause();
    const paused = html(game);
    for (const label of ['Resume', 'Restart', 'Settings', 'Menu']) expect(paused, label).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    STATE.setStatus('gameover');
    const over = html(game);
    expect(over).toMatch(/<button[^>]*>Play again<\/button>/);
    expect(over).toMatch(/<button[^>]*>Menu<\/button>/);
    game.dispose();
  });
  it('muted shows the "Sound on" control', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    game.start();
    SET.settings.set({ muted: true });
    expect(html(game)).toMatch(/aria-label="Sound on"/);
    game.dispose();
  });
  it('the builder is told the 3D shell already has these screens', () => {
    expect(architectSystemPrompt('vite-react')).toMatch(/ALREADY HAS the start screen, the pause menu/);
  });
});
