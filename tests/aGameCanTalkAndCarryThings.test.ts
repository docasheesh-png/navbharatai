// TALKING AND THE BAG (admin 2026-11-19 game-gap audit, P1: an RPG had no dialogue box with choices, and
// \`state.inventory\` existed with nothing to fill, count, use or show it). These run the REAL generated core/dialogue.ts,
// core/inventory.ts, Game.ts and ui/Hud.tsx: lines and branches, a choice that needs an item, the world holding still
// while someone talks (and the press that closes the box not also jumping), stacks saved with the game.
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

const DIR = join(__dirname, `.tmp-dialogue-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let DLG: any; let INV: any; let EV: any;
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
  DLG = await import(join(DIR, 'src/game/core/dialogue.ts'));
  INV = await import(join(DIR, 'src/game/core/inventory.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { DLG.dialogue.close(); DLG.dialogue.takeJustEnded(); INV.inventory.clear(); STATE.setStatus('menu'); });



describe('🎒 the bag', () => {
  it('adds, counts, caps a stack, removes all-or-nothing, and lives in state.inventory (so save/restart handle it)', () => {
    INV.inventory.define({ potion: { name: 'Health potion', icon: '🧪', max: 3 } });
    expect(INV.inventory.add('potion', 5)).toBe(3);
    expect(INV.inventory.add('key')).toBe(1);
    expect(INV.inventory.count('potion')).toBe(3);
    expect(STATE.state.inventory.filter((x: string) => x === 'potion')).toHaveLength(3);
    expect(INV.inventory.remove('potion', 4)).toBe(false);
    expect(INV.inventory.count('potion')).toBe(3);
    expect(INV.inventory.remove('potion', 2)).toBe(true);
    expect(INV.inventory.list).toEqual([
      { id: 'potion', name: 'Health potion', icon: '🧪', description: '', count: 1, usable: false },
      { id: 'key', name: 'key', icon: '◆', description: '', count: 1, usable: false },
    ]);
    STATE.save(); INV.inventory.clear(); STATE.load();
    expect(INV.inventory.count('potion')).toBe(1);
    expect(INV.inventory.add('', 1)).toBe(0);
    expect(INV.inventory.add('coin', Number.NaN)).toBe(0);
  });
  it('using an item runs its effect and spends it; an effect returning false keeps it; nothing to do is refused', () => {
    const used: string[] = [];
    const off = EV.events.on('ITEM_USED', (p: any) => used.push(p.id + ':' + p.left));
    let full = false; let healed = 0;
    INV.inventory.onUse('potion', () => { if (full) return false; healed++; });
    INV.inventory.add('potion', 2); INV.inventory.add('rock');
    expect(INV.inventory.use('potion')).toBe(true);
    full = true;
    expect(INV.inventory.use('potion')).toBe(false);
    expect(INV.inventory.use('rock')).toBe(false);
    expect(INV.inventory.use('ghost')).toBe(false);
    expect(healed).toBe(1);
    expect(INV.inventory.count('potion')).toBe(1);
    expect(used).toEqual(['potion:1']);
    off();
  });
});

describe('💬 dialogue', () => {
  it('a list of lines plays in order and resolves with no choice', async () => {
    const lines: string[] = [];
    const off = EV.events.on('DIALOGUE_LINE', (v: any) => lines.push(v.speaker + ':' + v.text));
    const done = DLG.dialogue.open([{ speaker: 'Mira', text: 'Follow me.' }, { speaker: 'Mira', text: 'Quietly.' }]);
    expect(DLG.dialogue.active).toBe(true);
    DLG.dialogue.advance(); DLG.dialogue.advance();
    await expect(done).resolves.toBeNull();
    expect(DLG.dialogue.active).toBe(false);
    expect(lines).toEqual(['Mira:Follow me.', 'Mira:Quietly.']);
    off();
  });
  it('choices branch; Continue waits for a pick; a choice needing a missing item cannot be picked until the bag has it', async () => {
    INV.inventory.define({ coin: { name: 'Gold coin' } });
    let bought = 0;
    const script = { start: 'hi', nodes: {
      hi: { speaker: 'Trader', text: 'Want a potion?', choices: [
        { id: 'buy', text: 'Yes', requires: { item: 'coin' }, onChoose: () => { INV.inventory.remove('coin'); INV.inventory.add('potion'); bought++; }, next: 'bye' },
        { id: 'no', text: 'No thanks' }] },
      bye: { speaker: 'Trader', text: 'Stay safe.' } } };
    let done = DLG.dialogue.open(script);
    DLG.dialogue.advance();
    expect(DLG.dialogue.current.text).toBe('Want a potion?');
    expect(DLG.dialogue.current.choices[0]).toEqual({ text: 'Yes', available: false, needs: 'Gold coin' });
    expect(DLG.dialogue.choose(0)).toBe(false);
    expect(DLG.dialogue.choose(1)).toBe(true);
    await expect(done).resolves.toBe('no');
    INV.inventory.add('coin');
    done = DLG.dialogue.open(script);
    expect(DLG.dialogue.choose(0)).toBe(true);
    expect(DLG.dialogue.current.text).toBe('Stay safe.');
    DLG.dialogue.advance();
    await expect(done).resolves.toBe('buy');
    expect(bought).toBe(1);
    expect(INV.inventory.count('coin')).toBe(0);
    expect(INV.inventory.count('potion')).toBe(1);
  });
  it('a broken script never hangs: a missing start resolves null, a missing next ends the talk', async () => {
    await expect(DLG.dialogue.open({ start: 'nope', nodes: {} })).resolves.toBeNull();
    const done = DLG.dialogue.open({ start: 'a', nodes: { a: { text: 'Hi', next: 'gone' } } });
    DLG.dialogue.advance();
    await expect(done).resolves.toBeNull();
    expect(DLG.dialogue.active).toBe(false);
  });
});

describe('🔴 the world holds still while someone talks, and the closing press is not a jump', () => {
  it('no update runs during the talk nor the step it ends on; then play resumes with the press dropped', () => {
    let steps = 0; let jumps = 0;
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: () => [], update: (ctx: any) => { steps++; if (ctx.input.wasPressed('jump')) jumps++; } });
    STATE.setStatus('playing');
    game.loop.step(3);
    const before = steps;
    expect(before).toBeGreaterThan(0);
    DLG.dialogue.say('Guard', 'Halt!');
    game.loop.step(5);
    expect(steps).toBe(before);
    game.input.setVirtualButton('jump', true);   // the Space that closes the box…
    DLG.dialogue.advance();                       // …ends the talk between steps
    game.loop.step(1);
    expect(steps).toBe(before);
    expect(jumps).toBe(0);
    game.input.setVirtualButton('jump', false);
    game.loop.step(2);
    expect(steps).toBe(before + 2);
    expect(jumps).toBe(0);
    game.dispose();
  });
});

describe('the Hud', () => {
  it('the dialogue box shows the speaker, the line and numbered choices, with what a locked one needs', () => {
    INV.inventory.define({ coin: { name: 'Gold coin' } });
    DLG.dialogue.open({ start: 'a', nodes: { a: { speaker: 'Trader', text: 'Deal?', choices: [{ text: 'Buy', requires: { item: 'coin' } }, { text: 'Leave' }] } } });
    const html = renderToStaticMarkup(createElement(HUD.DialogueBox));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Trader');
    expect(html).toContain('Deal?');
    expect(html).toContain('1. Buy (Needs Gold coin)');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>1\. Buy/);
    expect(html).toContain('2. Leave');
    DLG.dialogue.close();
    expect(renderToStaticMarkup(createElement(HUD.DialogueBox))).toBe('');
  });
  it('the bag lists icon, name, count and a Use button only for usable items; empty says so', () => {
    expect(renderToStaticMarkup(createElement(HUD.InventoryPanel, { onBack: () => {} }))).toContain('Your bag is empty');
    INV.inventory.define({ potion: { name: 'Health potion', icon: '🧪', usable: true }, key: { name: 'Gate key', icon: '🔑' } });
    INV.inventory.add('potion', 2); INV.inventory.add('key');
    const html = renderToStaticMarkup(createElement(HUD.InventoryPanel, { onBack: () => {} }));
    expect(html).toContain('Health potion');
    expect(html).toContain(' ×2');
    expect(html).toContain('Gate key');
    expect(html.match(/>Use</g)).toHaveLength(1);
  });
});
