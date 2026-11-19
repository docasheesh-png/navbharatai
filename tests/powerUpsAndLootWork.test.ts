// POWER-UPS AND LOOT (admin 2026-11-19 game-gap audit, P2: no timed boosts and no drops). These run the REAL generated
// core/powerups.ts, core/loot.ts, Game.ts and ui/Hud.tsx: power-ups count down in game time only (frozen in the pause menu,
// cleared by a new round), refresh / extend / stack when picked up again; loot tables honour their weights and the pity rule.
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

const DIR = join(__dirname, `.tmp-powerups-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let PU: any; let LT: any; let EV: any;
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
  PU = await import(join(DIR, 'src/game/core/powerups.ts'));
  LT = await import(join(DIR, 'src/game/core/loot.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { PU.powerUps.clear(); STATE.setStatus('menu'); });



const DEFS = { speed: { name: 'Speed', icon: '⚡', seconds: 6 }, magnet: { name: 'Magnet', icon: '🧲', seconds: 5, stack: 'extend' }, fire: { name: 'Fire', icon: '🔥', seconds: 4, stack: 'stack', maxStacks: 3 } };

describe('⚡ power-ups', () => {
  it('last their time, then end with an event; value() reads the boost', () => {
    PU.powerUps.define(DEFS);
    const heard: string[] = [];
    const offs = ['POWERUP_STARTED', 'POWERUP_ENDED'].map((e) => EV.events.on(e, (p: any) => heard.push(e + ':' + p.id)));
    expect(PU.powerUps.give('speed')).toBe(true);
    expect(PU.powerUps.value('speed', 6, 10)).toBe(10);
    PU.powerUps.update(5.9);
    expect(PU.powerUps.active('speed')).toBe(true);
    PU.powerUps.update(0.2);
    expect(PU.powerUps.active('speed')).toBe(false);
    expect(PU.powerUps.value('speed', 6, 10)).toBe(6);
    expect(heard).toEqual(['POWERUP_STARTED:speed', 'POWERUP_ENDED:speed']);
    expect(PU.powerUps.give('nope')).toBe(false);
    offs.forEach((o: () => void) => o());
  });
  it('picked up again: refresh restarts the clock, extend adds time, stack raises the level up to its cap', () => {
    PU.powerUps.define(DEFS);
    PU.powerUps.give('speed'); PU.powerUps.update(4); PU.powerUps.give('speed');
    expect(PU.powerUps.remaining('speed')).toBeCloseTo(6);
    PU.powerUps.give('magnet'); PU.powerUps.update(2); PU.powerUps.give('magnet');
    expect(PU.powerUps.remaining('magnet')).toBeCloseTo(8);
    const levels: number[] = [];
    PU.powerUps.define({ fire: { ...DEFS.fire, onStart: (l: number) => levels.push(l) } });
    for (let i = 0; i < 5; i++) PU.powerUps.give('fire');
    expect(PU.powerUps.level('fire')).toBe(3);
    expect(levels).toEqual([1, 2, 3]);
  });
  it('🔴 the shell counts them in game time: frozen while paused, cleared by a new round', () => {
    PU.powerUps.define(DEFS);
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    STATE.setStatus('playing');
    PU.powerUps.give('speed');
    game.loop.step(60);                         // one second of play
    expect(PU.powerUps.remaining('speed')).toBeCloseTo(5, 1);
    game.pause();
    game.loop.step(600);                        // ten seconds in the pause menu
    expect(PU.powerUps.remaining('speed')).toBeCloseTo(5, 1);
    game.resume();
    game.restart();
    expect(PU.powerUps.active('speed')).toBe(false);
    game.dispose();
  });
  it('the Hud shows each with its icon, level and time left', () => {
    PU.powerUps.define(DEFS);
    PU.powerUps.give('fire'); PU.powerUps.give('fire'); PU.powerUps.give('speed');
    const html = renderToStaticMarkup(createElement(HUD.PowerUpBar));
    expect(html).toContain('aria-label="Power-ups"');
    expect(html).toContain('aria-label="Fire 4s"');
    expect(html).toContain('x2');
    expect(html).toContain('⚡');
    PU.powerUps.clear();
    expect(renderToStaticMarkup(createElement(HUD.PowerUpBar))).toBe('');
  });
});

describe('🎁 loot tables', () => {
  const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  it('drops follow their weights; "nothing" is a real outcome; amounts stay in range', () => {
    const t = LT.createLootTable([{ item: null, weight: 50 }, { item: 'coin', weight: 40, count: [1, 5] }, { item: 'potion', weight: 10, rarity: 'rare' }]);
    const rng = seeded(11);
    const tally: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) { const d = t.roll(rng); tally[String(d.item)] = (tally[String(d.item)] ?? 0) + 1; if (d.item === 'coin') { expect(d.count).toBeGreaterThanOrEqual(1); expect(d.count).toBeLessThanOrEqual(5); } }
    expect(tally.null / 20000).toBeCloseTo(0.5, 1);
    expect(tally.coin / 20000).toBeCloseTo(0.4, 1);
    expect(tally.potion / 20000).toBeCloseTo(0.1, 1);
    expect(t.chances().map((c: any) => c.chance)).toEqual([0.5, 0.4, 0.1]);
  });
  it('🔴 the pity rule: never more than N rolls without a rare or better', () => {
    const t = LT.createLootTable([{ item: 'coin', weight: 999 }, { item: 'gem', weight: 1, rarity: 'epic' }], { pity: { rarity: 'rare', after: 10 } });
    const rng = seeded(5);
    let dry = 0, worst = 0;
    for (let i = 0; i < 500; i++) { const d = t.roll(rng); dry = d.rarity === 'epic' ? 0 : dry + 1; worst = Math.max(worst, dry); }
    expect(worst).toBeLessThanOrEqual(9);
  });
  it('an item drop is announced; an empty table is refused', () => {
    const heard: any[] = [];
    const off = EV.events.on('LOOT_DROPPED', (d: any) => heard.push(d));
    LT.createLootTable([{ item: 'coin', weight: 1 }]).roll(() => 0.5);
    LT.createLootTable([{ item: null, weight: 1 }]).roll(() => 0.5);
    expect(heard).toEqual([{ item: 'coin', rarity: 'common', count: 1 }]);
    off();
    expect(() => LT.createLootTable([{ item: 'x', weight: 0 }])).toThrow();
  });
});
