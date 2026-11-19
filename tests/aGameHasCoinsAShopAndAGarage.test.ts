// COINS, A SHOP, UPGRADES AND A GARAGE (admin 2026-11-19 game-gap audit, P1: no currency, no shop, no upgrades, no
// car or character to choose). These run the REAL generated core/economy.ts and ui/Hud.tsx: coins are earned and spent
// all-or-nothing, a free car is in use from the start, a bought one is put to use, an upgrade climbs in price to its
// cap, a consumable lands in the bag, and the wallet survives a reload and a corrupt save.
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
import * as THREE from 'three';

const DIR = join(__dirname, `.tmp-economy-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let ECO: any; let INV: any; let EV: any;
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
  ECO = await import(join(DIR, 'src/game/core/economy.ts'));
  INV = await import(join(DIR, 'src/game/core/inventory.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { store.clear(); INV.inventory.clear(); STATE.setStatus('menu'); });




const ITEMS = [
  { id: 'red', name: 'Red car', price: 0, slot: 'car' },
  { id: 'blue', name: 'Blue racer', price: 300, slot: 'car', icon: '🏎️' },
  { id: 'engine', name: 'Engine', price: 100, levels: 3 },
  { id: 'potion', name: 'Potion', price: 40, kind: 'item' },
];

describe('🪙 the wallet', () => {
  it('starts with startCoins, earns, spends all-or-nothing, and ignores nonsense amounts', () => {
    ECO.economy.setup({ id: 'w', items: ITEMS, startCoins: 50 });
    expect(ECO.economy.coins).toBe(50);
    ECO.economy.earn(10); ECO.economy.earn(-5); ECO.economy.earn(Number.NaN);
    expect(ECO.economy.coins).toBe(60);
    expect(ECO.economy.spend(100)).toBe(false);
    expect(ECO.economy.coins).toBe(60);
    expect(ECO.economy.spend(25)).toBe(true);
    expect(ECO.economy.coins).toBe(35);
  });
});

describe('🛒 the shop and the garage', () => {
  it('a free car is owned and in use from the start; a bought car is put to use; Use switches back', () => {
    const heard: string[] = [];
    const off = EV.events.on('SHOP_CHANGED', (p: any) => heard.push(p.action + ':' + p.id));
    ECO.economy.setup({ id: 'g', items: ITEMS, startCoins: 0 });
    expect(ECO.economy.equipped('car')).toBe('red');
    expect(ECO.economy.buy('blue')).toBe('poor');
    expect(ECO.economy.owns('blue')).toBe(false);
    expect(ECO.economy.equip('blue')).toBe(false);
    ECO.economy.earn(300);
    expect(ECO.economy.buy('blue')).toBe('bought');
    expect(ECO.economy.coins).toBe(0);
    expect(ECO.economy.equipped('car')).toBe('blue');
    expect(ECO.economy.buy('blue')).toBe('owned');
    expect(ECO.economy.equip('red')).toBe(true);
    expect(ECO.economy.equipped('car')).toBe('red');
    expect(heard).toEqual(['setup:', 'bought:blue', 'equipped:red']);
    off();
  });
  it('an upgrade climbs in price (×1.5) to its cap, and stat() grows with it', () => {
    ECO.economy.setup({ id: 'u', items: ITEMS, startCoins: 1000 });
    expect(ECO.economy.stat('engine', 30, 4)).toBe(30);
    const paid: number[] = [];
    for (let i = 0; i < 3; i++) { paid.push(ECO.economy.priceOf('engine')); expect(ECO.economy.buy('engine')).toBe('bought'); }
    expect(paid).toEqual([100, 150, 225]);
    expect(ECO.economy.priceOf('engine')).toBeNull();
    expect(ECO.economy.buy('engine')).toBe('max');
    expect(ECO.economy.level('engine')).toBe(3);
    expect(ECO.economy.stat('engine', 30, 4)).toBe(42);
    expect(ECO.economy.coins).toBe(1000 - 475);
    expect(ECO.economy.buy('nothing')).toBe('unknown');
  });
  it('a consumable goes in the bag every time it is bought', () => {
    ECO.economy.setup({ id: 'c', items: ITEMS, startCoins: 100 });
    expect(ECO.economy.buy('potion')).toBe('bought');
    expect(ECO.economy.buy('potion')).toBe('bought');
    expect(ECO.economy.buy('potion')).toBe('poor');
    expect(INV.inventory.count('potion')).toBe(2);
    expect(ECO.economy.coins).toBe(20);
  });
});

describe('💾 saved per game, on the device', () => {
  it('coins, purchases and the car in use survive a reload; another game keeps its own wallet', () => {
    ECO.economy.setup({ id: 'rally', items: ITEMS, startCoins: 400 });
    ECO.economy.buy('blue'); ECO.economy.buy('engine');
    ECO.economy.setup({ id: 'other', items: ITEMS, startCoins: 7 });
    expect(ECO.economy.coins).toBe(7);
    ECO.economy.setup({ id: 'rally', items: ITEMS, startCoins: 400 });   // a reload
    expect(ECO.economy.coins).toBe(0);
    expect(ECO.economy.equipped('car')).toBe('blue');
    expect(ECO.economy.level('engine')).toBe(1);
  });
  it('a corrupt or hand-edited save cannot crash the game or mint coins', () => {
    store.set('nb-economy:bad', '{not json');
    ECO.economy.setup({ id: 'bad', items: ITEMS, startCoins: 5 });
    expect(ECO.economy.coins).toBe(5);
    store.set('nb-economy:bad2', JSON.stringify({ coins: -50, owned: { blue: 'x', engine: 2.7 }, equipped: { car: 'blue' } }));
    ECO.economy.setup({ id: 'bad2', items: ITEMS });
    expect(ECO.economy.coins).toBe(0);
    expect(ECO.economy.owns('blue')).toBe(false);
    expect(ECO.economy.equipped('car')).toBe('red');     // the saved car is not owned → back to one that is
    expect(ECO.economy.level('engine')).toBe(2);
  });
});

describe('the Hud', () => {
  it('the shop lists each item with the right button: in use, use, buy (greyed when short), max', () => {
    ECO.economy.setup({ id: 'h', items: ITEMS, startCoins: 120 });
    const html = renderToStaticMarkup(createElement(HUD.ShopPanel, { onBack: () => {} }));
    expect(html).toContain('aria-label="Coins 120"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>In use</);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Buy 🪙300</);
    expect(html).toMatch(/<button type="button"(?![^>]*disabled)[^>]*>Buy 🪙100</);
    expect(html).toContain('Lv 0/3');
    ECO.economy.earn(1000); ECO.economy.buy('blue');
    const after = renderToStaticMarkup(createElement(HUD.ShopPanel, { onBack: () => {} }));
    expect(after).toMatch(/<button type="button"(?![^>]*disabled)[^>]*>Use</);
  });
});
