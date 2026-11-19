// EVERY PLAYER CAN PLAY (admin 2026-11-19 game-gap audit, P2 accessibility: no reduced motion, no larger text, no
// colour-blind colours, no captions). These run the REAL generated settings, Game.ts and ui/Hud.tsx: reduce motion stops the
// camera shake (and follows the device on a first visit), large text enlarges the menus and the top bar, colour-blind
// colours swap the health bar and the minimap to the Okabe-Ito palette, and captions put important sounds into words.
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

const DIR = join(__dirname, `.tmp-a11y-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let EV: any; let STR: any;
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
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  STR = await import(join(DIR, 'src/game/core/strings.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { SET.settings.reset(); STATE.setStatus('menu'); });



describe('♿ the settings', () => {
  it('are validated and saved, and the settings panel has a switch for each', () => {
    expect(SET.sanitizeSettings({ reduceMotion: 'yes', largeText: 1, colourSafe: true, captions: true })).toMatchObject({ reduceMotion: false, largeText: false, colourSafe: true, captions: true });
    const hud = generateGameShell().files['src/game/ui/Hud.tsx'];
    for (const k of ['reduceMotion', 'largeText', 'colourSafe', 'captions']) expect(hud).toContain("<Toggle label={t('" + k + "')} on={s." + k + "}");
  });
  it('large text draws the start screen a quarter bigger', () => {
    expect(renderToStaticMarkup(createElement(HUD.Hud, { game: fakeGame() }))).not.toContain('zoom:1.25');
    SET.settings.set({ largeText: true });
    expect(renderToStaticMarkup(createElement(HUD.Hud, { game: fakeGame() }))).toContain('zoom:1.25');
  });
});

/** The minimum the Hud reads from a game. */
function fakeGame() {
  return { startScreenInfo: { title: 'T', subtitle: '', controls: { touch: '', keyboard: '' } }, canContinue: false, creditsList: [], canFullscreen: false, isFullscreen: false, minimapOption: false, leaderboardId: 'g',
    fps: 60, quality: 'high', mapView: () => ({ x: 0, z: 0, forward: { x: 0, z: 1 }, facing: 0, markers: [] }), play() {}, pause() {}, resume() {}, restart() {}, toMenu() {}, toggleFullscreen: async () => {} } as any;
}

describe('🎥 reduce motion', () => {
  it('🔴 a hit shakes the camera normally, and not at all with Reduce motion on', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    STATE.setStatus('playing');
    const shook = () => { const before = game.rig.camera.position.clone(); game.feel.addTrauma(1); game.loop.step(1); return game.rig.camera.position.distanceTo(before); };
    // Let the camera settle first so only the shake moves it.
    game.loop.step(120);
    const withShake = shook();
    game.feel.reset(); game.loop.step(120);
    SET.settings.set({ reduceMotion: true });
    game.loop.step(1);
    const noShake = shook();
    expect(withShake).toBeGreaterThan(0.001);
    expect(noShake).toBeLessThan(withShake / 10);
    game.dispose();
  });
});

describe('🎨 colour-blind colours, 🔤 large text', () => {
  it('the minimap and the health bar switch to the Okabe-Ito palette', () => {
    expect(HUD.markerColour('enemy', false)).toBe('#f87171');
    expect(HUD.markerColour('enemy', true)).toBe('#e69f00');
    expect(HUD.markerColour('pickup', true)).toBe('#56b4e9');
    expect(HUD.HEALTH_COLOURS_SAFE).toEqual({ ok: '#56b4e9', low: '#e69f00' });
  });
});

describe('💬 captions', () => {
  it('important sounds have words, in the player\'s language, for every captioned event', () => {
    const keys = Object.values(HUD.CAPTIONED) as string[];
    for (const k of keys) expect(STR.t(k)).not.toBe(k);
    expect(Object.keys(HUD.CAPTIONED)).toEqual(expect.arrayContaining(['PLAYER_DAMAGED', 'ENEMY_DIED', 'BOSS_SPAWNED']));
    expect(STR.t('capHit')).toBe('You were hit');
  });
});
