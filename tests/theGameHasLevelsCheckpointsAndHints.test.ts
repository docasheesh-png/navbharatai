// LEVELS, CHECKPOINTS, DIFFICULTY AND FIRST-TIME HINTS (admin 2026-11-19 game-gap audit, P1 #13): no stage progression,
// no respawn at a checkpoint, no Easy/Normal/Hard and no tutorial existed — LEVEL_* and CHECKPOINT_REACHED were
// declared and never emitted. These run the REAL generated core/levels.ts, core/settings.ts, Game.ts and ui/Hud.tsx.
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

const DIR = join(__dirname, `.tmp-levels-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let LV: any; let EV: any;
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
  LV = await import(join(DIR, 'src/game/core/levels.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { store.clear(); SET.settings.reset(); STATE.setStatus('menu'); });


const L3 = [{ name: 'Village' }, { name: 'Forest' }, { name: 'Fort' }];

describe('🗺️ levels: unlock, stars, next, saved per game', () => {
  it('only the first is open; completing unlocks the next, keeps the best stars, wins the round and announces it', () => {
    LV.levels.define(L3, 'g1');
    expect([0, 1, 2].map((i) => LV.levels.isUnlocked(i))).toEqual([true, false, false]);
    const heard: any[] = [];
    const offs = ['LEVEL_STARTED', 'LEVEL_COMPLETED'].map((e) => EV.events.on(e, (p: any) => heard.push([e, p])));
    expect(LV.levels.start(1)).toBe(false);
    expect(LV.levels.start(0)).toBe(true);
    STATE.setStatus('playing');
    LV.levels.complete(2);
    expect(STATE.state.status).toBe('won');
    expect(LV.levels.isUnlocked(1)).toBe(true);
    expect(LV.levels.stars(0)).toBe(2);
    LV.levels.complete(1);                                  // a worse run never lowers the best
    expect(LV.levels.stars(0)).toBe(2);
    expect(heard.find(([e]) => e === 'LEVEL_COMPLETED')![1]).toMatchObject({ index: 0, stars: 2, next: true });
    expect(LV.levels.next()).toBe(true);
    expect(LV.levels.index).toBe(1);
    expect(STATE.state.level).toBe(2);
    offs.forEach((o: () => void) => o());
  });
  it('progress survives a reload (define again) and is separate per game; a corrupt save starts fresh; reset forgets', () => {
    LV.levels.define(L3, 'g2'); LV.levels.start(0); LV.levels.complete(3);
    LV.levels.define(L3, 'g2');
    expect(LV.levels.isUnlocked(1)).toBe(true);
    expect(LV.levels.stars(0)).toBe(3);
    LV.levels.define(L3, 'other');
    expect(LV.levels.isUnlocked(1)).toBe(false);
    store.set('nb-levels-v1:bad', '{not json');
    LV.levels.define(L3, 'bad');
    expect(LV.levels.isUnlocked(1)).toBe(false);
    LV.levels.define(L3, 'g2'); LV.levels.reset();
    expect(LV.levels.isUnlocked(1)).toBe(false);
  });
});

describe('📍 checkpoints', () => {
  it('a checkpoint is the respawn point in its own level only, and is announced', () => {
    LV.levels.define(L3, 'g3'); LV.levels.start(0);
    expect(LV.levels.respawnPoint()).toBeNull();
    let heard: any = null;
    const off = EV.events.on('CHECKPOINT_REACHED', (p: any) => { heard = p; });
    LV.levels.checkpoint({ x: 4, y: 0, z: -9 });
    off();
    expect(LV.levels.respawnPoint()).toEqual({ x: 4, y: 0, z: -9 });
    expect(heard).toMatchObject({ level: 0, position: { x: 4, y: 0, z: -9 } });
    LV.levels.checkpoint({ x: Number.NaN, y: 0, z: 0 });    // junk is ignored
    expect(LV.levels.respawnPoint()).toEqual({ x: 4, y: 0, z: -9 });
    LV.levels.complete(1); LV.levels.start(1);
    expect(LV.levels.respawnPoint()).toBeNull();
  });
});

describe('🎓 first-time hints and difficulty', () => {
  it('a hint is shown once per game, ever', () => {
    LV.levels.define(L3, 'g4');
    const heard: string[] = [];
    const off = EV.events.on('HINT', (p: any) => heard.push(p.text));
    expect(LV.showHint('jump', 'Press Space to jump')).toBe(true);
    expect(LV.showHint('jump', 'Press Space to jump')).toBe(false);
    LV.levels.define(L3, 'g4');
    expect(LV.showHint('jump', 'Press Space to jump')).toBe(false);
    off();
    expect(heard).toEqual(['Press Space to jump']);
  });
  it('the game shows the controls hint on its first start only', () => {
    LV.levels.define([], 'first-run');
    const heard: string[] = [];
    const off = EV.events.on('HINT', (p: any) => heard.push(p.id));
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    game.start();                       // no start screen: plays at once → GAME_STARTED
    STATE.setStatus('gameover'); game.restart();
    off(); game.dispose();
    expect(heard).toEqual(['controls']);
  });
  it('difficulty is a saved setting with real multipliers', () => {
    expect(SET.settings.get().difficulty).toBe('normal');
    SET.settings.set({ difficulty: 'hard' });
    expect(SET.difficultyScale()).toMatchObject({ enemyDamage: 1.35, enemyHealth: 1.3 });
    expect(SET.difficultyScale('easy').enemyDamage).toBeLessThan(1);
    expect(SET.sanitizeSettings({ difficulty: 'insane' }).difficulty).toBe('normal');
  });
});

describe('🔴 the screens', () => {
  const html = (game: any) => renderToStaticMarkup(createElement(HUD.Hud, { game }));
  it('the start screen lists the levels, locked ones shut; a beaten level offers Next level with its stars', () => {
    LV.levels.define(L3, 'g5');
    const game = new SHELL.Game({ container: new FakeEl('div'), startScreen: {}, setup: () => [] });
    game.start();
    const menu = html(game);
    expect(menu).toContain('aria-label="Levels"');
    expect(menu).toMatch(/aria-label="Level 2 Forest \(Locked\)"[^>]*disabled|disabled[^>]*aria-label="Level 2 Forest \(Locked\)"/);
    LV.levels.start(0); game.play(); LV.levels.complete(2);
    const won = html(game);
    expect(won).toContain('Level complete');
    expect(won).toContain('★★☆');
    expect(won).toMatch(/<button[^>]*>Next level<\/button>/);
    game.dispose();
  });
});
