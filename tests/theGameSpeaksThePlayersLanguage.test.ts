// THE GAME SPEAKS THE PLAYER'S LANGUAGE (admin 2026-11-19 game-gap audit, P0 #8: every kit screen was hard-coded
// English). The kit writes English and Hindi; any other language comes from the builder through options.strings, and a
// missing word falls back to English, never to a blank or a key name. These tests run the REAL generated
// core/strings.ts, core/meta.ts, Game.ts, ui/Hud.tsx and ui/touchControls.ts.
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

const DIR = join(__dirname, `.tmp-game-language-${process.pid}`);

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
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} burst(): void {} }\n',
  'src/game/fx/audio.ts': 'export const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {}, setVolume(c: string, v: number): void { (globalThis as any).__rec.volumes.push([c, v]); } };\n',
  'src/game/fx/feedback.ts': 'export function bindGameFeedback(): () => void { return () => {}; }\n',
};

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let STR: any; let META: any;
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
  STR = await import(join(DIR, 'src/game/core/strings.ts'));
  META = await import(join(DIR, 'src/game/core/meta.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { STR.setGameLanguage('en'); STATE.setStatus('menu'); });


describe('the words', () => {
  it('Hindi has exactly the English keys, none empty — a missing word could only ever show English', () => {
    expect(Object.keys(STR.GAME_STRINGS.hi).sort()).toEqual(Object.keys(STR.GAME_STRINGS.en).sort());
    for (const [k, v] of Object.entries(STR.GAME_STRINGS.hi)) expect(String(v).trim(), k).not.toBe('');
    // Placeholders survive translation.
    for (const [k, v] of Object.entries(STR.GAME_STRINGS.en)) {
      const want = (String(v).match(/\{\w+\}/g) ?? []).sort();
      expect((String(STR.GAME_STRINGS.hi[k]).match(/\{\w+\}/g) ?? []).sort(), k).toEqual(want);
    }
  });
  it('t() follows the chosen language, fills placeholders, and an override wins for that key only', () => {
    expect(STR.t('play')).toBe('Play');
    STR.setGameLanguage('hi');
    expect(STR.t('play')).toBe('खेलें');
    expect(STR.t('newBest', { score: 120 })).toBe('नया बेस्ट! 120');
    STR.setGameLanguage('en', { play: 'விளையாடு', bogus: 'x', menu: 42 as unknown as string });
    expect(STR.t('play')).toBe('விளையாடு');
    expect(STR.t('menu')).toBe('Menu');
    expect(STR.gameLanguage()).toBe('custom');
    expect(STR.setGameLanguage('xx' as never)).toBe('en');
  });
  it("'auto' follows the page's language", () => {
    (globalThis as any).document.documentElement = { lang: 'hi-IN' };
    expect(STR.setGameLanguage('auto')).toBe('hi');
    (globalThis as any).document.documentElement = { lang: 'en' };
    expect(STR.setGameLanguage('auto')).toBe('en');
    delete (globalThis as any).document.documentElement;
  });
});

describe('🔴 the screens and buttons speak it', () => {
  const html = (game: any) => renderToStaticMarkup(createElement(HUD.Hud, { game }));
  it('a Hindi game: start screen, pause menu, game over and the HUD are in Hindi', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), language: 'hi', startScreen: {}, setup: () => [] });
    game.start();
    const menu = html(game);
    expect(menu).toMatch(/<button[^>]*>खेलें<\/button>/);
    expect(menu).toMatch(/<button[^>]*>सेटिंग्स<\/button>/);
    expect(menu).toContain('तैयार?');
    expect(menu).not.toMatch(/>Play<|>Settings</);
    game.play(); game.pause();
    const paused = html(game);
    for (const w of ['रुका हुआ', 'जारी रखें', 'फिर से शुरू', 'मेनू']) expect(paused, w).toContain(w);
    STATE.setStatus('gameover');
    const over = html(game);
    expect(over).toContain('गेम ओवर');
    expect(over).toMatch(/<button[^>]*>फिर खेलें<\/button>/);
    game.dispose();
  });
  it('the kit\'s touch buttons follow the language; a label the game wrote is kept as written', () => {
    const container = new FakeEl('div');
    const game = new SHELL.Game({ container, language: 'hi', setup: () => [] });
    const labels = (root: FakeEl): string[] => [...(root.tag === 'button' ? [root.textContent] : []), ...root.children.flatMap(labels)];
    const all = labels(container);
    for (const w of ['हमला', 'कूदें', 'इस्तेमाल', 'दौड़ें', 'ब्रेक', 'ड्रिफ़्ट', 'गैस']) expect(all, w).toContain(w);
    game.dispose();
    const custom = new FakeEl('div');
    const g2 = new SHELL.Game({ container: custom, language: 'hi', touchControls: { buttons: [{ action: 'attack', label: 'Fire!' }] }, setup: () => [] });
    expect(labels(custom)).toContain('Fire!');
    g2.dispose();
  });
  it('the run summary lines use the language too', () => {
    STR.setGameLanguage('hi');
    const lines = META.summaryLines({ newBest: true, nearMiss: null, run: { score: 50 }, best: 50, previousBest: 10, xpGained: 5, level: 2, xpIntoLevel: 1, xpForNext: 10, levelsGained: 1, unlockedNow: [], achievementsNow: [], goalsCompletedNow: [], goals: [], streak: 3 });
    expect(lines).toEqual(['नया बेस्ट! 50', '+5 XP · लेवल 2 (1/10)', 'लेवल अप! आप लेवल 2 पर पहुँचे', '3 दिन लगातार']);
  });
});
