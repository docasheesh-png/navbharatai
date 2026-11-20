// A 2D GAME IS PLAYABLE ON A PHONE (admin 2026-11-20, game audit 2, item #3). failedbr #2435 — "Mere liye super Mario Bros
// game banao" — found no touch support in the kit (its grep for "virtual|analogue" came back empty), hand-rolled its
// own buttons, and scored Phone 0. The 2D kit now carries the SAME joystick and buttons the 3D shell uses
// (src/game/2d/touch.ts → ui/touchControls.ts). These run the REAL generated modules on a fake page.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGame2D, GAME_2D_MODULES } from '../src/server/lib/Game2DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { missingLayerFiles } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-2d-touch-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let T: any; let IN: any;

// ── A FAKE DOM just big enough to run the real module ────────────────────────────────────────────
type Listener = (e: unknown) => void;
class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  type = '';
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  rect = { left: 0, top: 0, right: 844, bottom: 390, width: 844, height: 390 };
  private listeners = new Map<string, Listener[]>();
  classList = {
    add: (...c: string[]) => { const set = new Set(this.className.split(' ').filter(Boolean)); c.forEach((x) => set.add(x)); this.className = [...set].join(' '); },
    remove: (...c: string[]) => { this.className = this.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  constructor(public tag: string) {}
  appendChild(c: FakeEl) { c.parentElement = this; this.children.push(c); return c; }
  removeChild(c: FakeEl) { this.children = this.children.filter((x) => x !== c); c.parentElement = null; return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  setPointerCapture() { /* captured */ }
  getBoundingClientRect() { return this.rect; }
  addEventListener(t: string, fn: Listener) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
  removeEventListener(t: string, fn: Listener) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
  fire(t: string, e: unknown) { for (const f of this.listeners.get(t) ?? []) f(e); }
  find(cls: string): FakeEl | undefined {
    if (this.classList.contains(cls)) return this;
    for (const c of this.children) { const hit = c.find(cls); if (hit) return hit; }
    return undefined;
  }
  all(cls: string): FakeEl[] { return [...(this.classList.contains(cls) ? [this] : []), ...this.children.flatMap((c) => c.all(cls))]; }
}


beforeAll(async () => {
  // What a 2D game's project holds: the runtime (seeded) + the 2D kit + whatever kit files the 2D kit imports.
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame2D().files };
  for (const [p, f] of missingLayerFiles(files, new Set(Object.keys(files)))) files[p] = f.content;
  for (const [p, c] of Object.entries(files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  const win = Object.assign(new FakeEl('window'), { matchMedia: () => ({ matches: true }) });
  Object.assign(globalThis as any, {
    document: { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false },
    window: win, getComputedStyle: (el: FakeEl) => ({ position: el.style.position || 'static' }),
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 5 } });
  T = await import(join(DIR, 'src/game/2d/touch.ts'));
  IN = await import(join(DIR, 'src/game/core/input.ts'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); for (const k of ['document', 'window', 'getComputedStyle']) delete (globalThis as any)[k]; });

function setup(options: any = {}) {
  const stage = new FakeEl('div');
  const input = new IN.Input(new FakeEl('canvas'));
  const tc = T.mountTouchControls2D(stage, input, options);
  const move = stage.find('nbg-tc-move')!;
  move.rect = { left: 0, top: 136, right: 422, bottom: 390, width: 422, height: 254 };
  // The move layout's buttons (the hidden drive layout — steer and pedals — has its own).
  const buttons = stage.find('nbg-tc-buttons')!.all('nbg-tc-btn');
  const ev = (pointerId: number, x = 0, y = 0) => ({ pointerId, clientX: x, clientY: y, pointerType: 'touch', preventDefault: () => {} });
  return { stage, input, tc, move, buttons, ev };
}

describe('📱 the 2D kit\'s touch controls', () => {
  it('the 2D kit brings ui/touchControls.ts with it (a 2D game never has to hand-roll buttons)', () => {
    expect(GAME_2D_MODULES).toContain('touch');
    const files = { ...generateGameRuntime().files, ...generateGame2D().files };
    expect([...missingLayerFiles(files, new Set(Object.keys(files))).keys()]).toContain('src/game/ui/touchControls.ts');
  });
  it('🔴 shown on a phone; the joystick moves the player through the same Input the keyboard uses', () => {
    const { input, tc, move, ev } = setup();
    expect(tc.visible).toBe(true);
    move.fire('pointerdown', ev(1, 150, 300));
    move.fire('pointermove', ev(1, 250, 300));
    expect(input.axis().x).toBe(1);
    move.fire('pointerup', ev(1, 250, 300));
    expect(input.axis()).toEqual({ x: 0, y: 0 });
  });
  it('🔴 Jump and Attack by default — a press is a real press edge — and no camera drag in 2D', () => {
    const { stage, input, buttons, ev } = setup();
    expect(buttons.map((b: FakeEl) => b.textContent)).toEqual(['Jump', 'Attack']);
    const jump = buttons[0];
    jump.fire('pointerdown', ev(2));
    expect(input.wasPressed('jump')).toBe(true);
    expect(input.isDown('jump')).toBe(true);
    jump.fire('pointerup', ev(2));
    expect(input.isDown('jump')).toBe(false);
    // No camera drag: a finger dragged where the look zone would be turns nothing.
    const look = stage.find('nbg-tc-look');
    if (look) { look.fire('pointerdown', ev(3, 700, 200)); look.fire('pointermove', ev(3, 790, 200)); }
    expect(input.lookX).toBe(0);
  });
  it('a game picks its own buttons (a runner needs only Jump)', () => {
    const { buttons } = setup({ buttons: [{ action: 'jump', label: 'Jump' }] });
    expect(buttons.map((b: FakeEl) => b.textContent)).toEqual(['Jump']);
  });
});
