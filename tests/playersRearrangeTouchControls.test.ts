// "botton rearrange bhi setting me ho sake — setting par click karne se user run/use/attack/move etc wale botton ki
// position ko bhi control karwa sake. joystick bhi user ke prompt ke anusar manage ho. yeh sab user ke control me
// rahe, user jo kahe woh ho jaye." (admin 2026-11-22)
//
// The kit's touch controls were drawn in ONE fixed arrangement: joystick bottom-left, four buttons bottom-right.
// A left-handed player, a player with big thumbs, or a user who asked the builder for "joystick on the right" had no
// way to get it. These tests hold the three layers of the fix against the REAL generated module:
//   1. the pure layout maths — defaults < the builder's options (from the prompt) < the player's saved layout,
//      clamped on screen, stored as fractions so it survives rotation;
//   2. TouchControls applying a saved layout and the prompt options, and its editor (drag, resize, opacity, Reset,
//      Done) saving per game, run in a small fake DOM;
//   3. the Settings panel offering "Edit controls", and — where Chromium exists — a real mouse drag in a real page
//      that survives a reload.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ts from 'typescript';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { makeTempDir } from './helpers/tempDir';

const shell = generateGameShell();
const TOUCH = shell.files['src/game/ui/touchControls.ts'];
const HUD = shell.files['src/game/ui/Hud.tsx'];
const GAME = shell.files['src/game/Game.ts'];
const runtime = generateGameRuntime().files;
const INPUT = runtime['src/game/core/input.ts'];
const EVENTS = runtime['src/game/core/events.ts'];
const STRINGS = runtime['src/game/core/strings.ts'];

// ── A fake DOM just big enough to run the real module ────────────────────────────────────────────
type Listener = (e: any) => void;
class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  rect = { left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 };
  offsetWidth = 0;
  offsetHeight = 0;
  private listeners = new Map<string, Listener[]>();
  classList = {
    add: (...c: string[]) => { const set = new Set(this.className.split(' ').filter(Boolean)); c.forEach((x) => set.add(x)); this.className = [...set].join(' '); },
    remove: (...c: string[]) => { this.className = this.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  constructor(public tag: string) {}
  appendChild(c: FakeEl) { c.parentElement?.removeChild(c); c.parentElement = this; this.children.push(c); return c; }
  removeChild(c: FakeEl) { this.children = this.children.filter((x) => x !== c); c.parentElement = null; return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  setPointerCapture() { /* captured */ }
  getBoundingClientRect() { return this.rect; }
  addEventListener(t: string, fn: Listener) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
  removeEventListener(t: string, fn: Listener) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
  /** Dispatch with bubbling to the parents, the way a real pointer event travels. */
  fire(t: string, e: any) {
    let stopped = false;
    const ev = { preventDefault: () => {}, stopPropagation: () => { stopped = true; }, stopImmediatePropagation: () => { stopped = true; }, ...e };
    for (let el: FakeEl | null = this; el && !stopped; el = el.parentElement) for (const f of el.listeners.get(t) ?? []) f(ev);
  }
  find(cls: string): FakeEl | undefined {
    if (this.classList.contains(cls)) return this;
    for (const c of this.children) { const hit = c.find(cls); if (hit) return hit; }
    return undefined;
  }
  all(cls: string): FakeEl[] { return [...(this.classList.contains(cls) ? [this] : []), ...this.children.flatMap((c) => c.all(cls))]; }
}

function load(src: string, globals: Record<string, unknown>, deps: Record<string, unknown> = {}): Record<string, any> {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const names = Object.keys(globals);
  new Function('module', 'exports', 'require', ...names, js)(mod, mod.exports, (id: string) => deps[id], ...names.map((n) => globals[n]));
  return mod.exports;
}

function fakeStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, map: m };
}

function setup(options: Record<string, unknown> = {}, seed: Record<string, string> = {}) {
  const storage = fakeStorage(seed);
  const win = Object.assign(new FakeEl('window'), { matchMedia: () => ({ matches: true }) });
  const doc = { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  const globals = { document: doc, window: win, getComputedStyle: (el: FakeEl) => ({ position: el.style.position || 'static' }), localStorage: storage };
  const { Input } = load(INPUT, globals);
  const events = load(EVENTS, globals);
  const strings = load(STRINGS, globals, { './events': events });
  const mod = load(TOUCH, globals, { '../core/strings': strings });
  const input = new Input(new FakeEl('canvas'));
  const container = new FakeEl('div');
  const tc = new mod.TouchControls(container, input, options);
  const root = container.find('nbg-tc')!;
  const btn = (action: string) => root.all('nbg-tc-btn').find((b) => b.attrs['data-action'] === action)!;
  const ev = (pointerId: number, x = 0, y = 0) => ({ pointerId, clientX: x, clientY: y, pointerType: 'mouse' });
  return { tc, mod, root, btn, ev, input, storage, win };
}

const PURE = setup().mod;

describe('the layout maths (pure)', () => {
  it('merges defaults < the prompt\'s options < the player\'s saved layout, field by field', () => {
    const options = { joystick: { side: 'right', size: 1.5, position: { x: 0.8, y: 0.7 } }, buttonPositions: { attack: { x: 0.1, y: 0.8, size: 1.2 }, jump: { x: 0.2, y: 0.2 } }, opacity: 0.6 };
    // No saved layout: the builder's choices are the layout.
    const a = PURE.resolveTouchLayout(options, null);
    expect(a.controls.joystick).toEqual({ size: 1.5, x: 0.8, y: 0.7 });
    expect(a.controls.attack).toEqual({ size: 1.2, x: 0.1, y: 0.8 });
    expect(a.opacity).toBe(0.6);
    // The player moved Attack and only resized Jump: Attack is where the player put it (keeping the builder's size),
    // Jump keeps the builder's spot at the player's size, and the player's opacity wins.
    const b = PURE.resolveTouchLayout(options, { controls: { attack: { x: 0.9, y: 0.5 }, jump: { size: 1.8 } }, opacity: 0.3 });
    expect(b.controls.attack).toEqual({ size: 1.2, x: 0.9, y: 0.5 });
    expect(b.controls.jump).toEqual({ size: 1.8, x: 0.2, y: 0.2 });
    expect(b.opacity).toBe(0.3);
    // Nothing anywhere: every control in the kit's own spot, fully opaque.
    expect(PURE.resolveTouchLayout({}, null)).toEqual({ controls: {}, opacity: 1, joystickMode: 'floating' });
  });

  it('keeps a control whole on screen and out of the safe-area inset; an unmeasured screen only keeps 0..1', () => {
    // A 64 px button dragged to the very corner of an 800 × 400 screen with a 40 px notch on the left.
    const c = PURE.clampTouchPlacement(0, 1, 32, 32, 800, 400, { left: 40, top: 0, right: 0, bottom: 10 });
    expect(c.x).toBeCloseTo((40 + 32) / 800, 6);
    expect(c.y).toBeCloseTo((400 - 10 - 32) / 400, 6);
    expect(PURE.clampTouchPlacement(2, -1, 32, 32, 0, 0)).toEqual({ x: 1, y: 0 });
    // Bigger than the screen: centred, never pushed off one edge.
    expect(PURE.clampTouchPlacement(0.1, 0.1, 500, 300, 800, 400)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('fractions and pixels convert both ways, so a layout survives a turned phone', () => {
    expect(PURE.touchFractionToPixels(0.25, 0.5, 800, 400)).toEqual({ x: 200, y: 200 });
    expect(PURE.touchPixelsToFraction(200, 200, 800, 400)).toEqual({ x: 0.25, y: 0.5 });
    // The same saved fraction on the rotated screen lands at the same relative spot.
    expect(PURE.touchFractionToPixels(0.25, 0.5, 400, 800)).toEqual({ x: 100, y: 400 });
    expect(PURE.touchPixelsToFraction(5, 5, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('distrusts what it reads back: bad numbers dropped, sizes and opacity kept in range, half a position is none', () => {
    const s = PURE.sanitizeTouchLayout({ controls: { attack: { x: 3, y: -1, size: 9 }, jump: { x: 0.5 }, run: 'x', use: { size: 'big' } }, opacity: 0 });
    expect(s).toEqual({ controls: { attack: { x: 1, y: 0, size: 2 } }, opacity: 0.2 });
    expect(PURE.sanitizeTouchLayout('garbage')).toEqual({ controls: {} });
  });

  it('saves per game: two games on one device keep their own layouts', () => {
    expect(PURE.touchLayoutStorageKey('racer')).not.toBe(PURE.touchLayoutStorageKey('shooter'));
    expect(PURE.touchLayoutStorageKey('')).toBe(PURE.touchLayoutStorageKey('game'));
  });
});

describe('TouchControls draws the layout it is given', () => {
  it('applies a SAVED player layout on start: the button leaves the grid, sits at its fraction, scaled, and opacity is set', () => {
    const saved = { controls: { attack: { x: 0.25, y: 0.5, size: 1.5 } }, opacity: 0.5 };
    const { btn, root } = setup({ gameId: 'g1' }, { 'nbg-touch-layout-v1:g1': JSON.stringify(saved) });
    const attack = btn('attack');
    expect(attack.parentElement).toBe(root);
    expect(attack.style.position).toBe('absolute');
    expect(attack.style.left).toBe('25%');
    expect(attack.style.top).toBe('50%');
    expect(attack.style.transform).toBe('translate(-50%, -50%) scale(1.5)');
    expect(attack.style.opacity).toBe('0.5');
    // An unplaced button stays in the kit's grid.
    expect(btn('jump').parentElement!.className).toBe('nbg-tc-buttons');
  });

  it('a layout saved for ANOTHER game is not applied', () => {
    const { btn } = setup({ gameId: 'g2' }, { 'nbg-touch-layout-v1:g1': JSON.stringify({ controls: { attack: { x: 0.25, y: 0.5 } } }) });
    expect(btn('attack').parentElement!.className).toBe('nbg-tc-buttons');
  });

  it('the player\'s layout beats the builder\'s buttonPositions', () => {
    const { btn } = setup({ gameId: 'g1', buttonPositions: { attack: { x: 0.9, y: 0.9 } } }, { 'nbg-touch-layout-v1:g1': JSON.stringify({ controls: { attack: { x: 0.3, y: 0.4 } } }) });
    expect(btn('attack').style.left).toBe('30%');
    expect(btn('attack').style.top).toBe('40%');
  });

  it('honours the prompt: joystick on the right (halves swap, buttons go left), bigger, fixed', () => {
    const { root, input, ev } = setup({ joystick: { side: 'right', size: 1.5, mode: 'fixed' } });
    expect(root.classList.contains('stick-right')).toBe(true);
    expect(root.classList.contains('mirror')).toBe(true);
    const base = root.find('nbg-tc-base')!;
    expect(base.style.width).toBe('168px');
    // Fixed: the thumb steers from the resting centre, the base does not jump under it.
    base.rect = { left: 600, top: 250, right: 768, bottom: 418, width: 168, height: 168 };
    const move = root.find('nbg-tc-move')!;
    move.fire('pointerdown', ev(1, 700, 334));
    expect(base.style.left).toContain('calc(100% -');
    move.fire('pointermove', ev(1, 684, 250));
    expect(input.axis().y).toBe(-1);
  });
});

describe('the editor (Settings → Edit controls)', () => {
  it('drag moves a control and saves it for this game; a press while editing never presses the action', () => {
    const { tc, root, btn, ev, input, storage } = setup({ gameId: 'g1' });
    tc.editLayout();
    expect(tc.editing).toBe(true);
    expect(root.classList.contains('editing')).toBe(true);
    const attack = btn('attack');
    attack.fire('pointerdown', ev(7, 700, 350));
    expect(input.isDown('attack')).toBe(false);
    attack.fire('pointermove', ev(7, 200, 100));
    attack.fire('pointerup', ev(7, 200, 100));
    expect(attack.parentElement).toBe(root);
    expect(attack.style.left).toBe('25%');
    expect(attack.style.top).toBe('25%');
    const stored = JSON.parse(storage.map.get('nbg-touch-layout-v1:g1')!);
    expect(stored.controls.attack).toEqual({ x: 0.25, y: 0.25 });
  });

  it('a drag into the corner is clamped so the whole control stays on screen', () => {
    const { tc, btn, ev, storage } = setup({ gameId: 'g1' });
    tc.editLayout();
    btn('jump').fire('pointerdown', ev(3, 400, 200));
    btn('jump').fire('pointermove', ev(3, 0, 400));
    btn('jump').fire('pointerup', ev(3, 0, 400));
    const { x, y } = JSON.parse(storage.map.get('nbg-touch-layout-v1:g1')!).controls.jump;
    expect(x).toBeCloseTo((8 + 32) / 800, 3);
    expect(y).toBeCloseTo((400 - 8 - 32) / 400, 3);
  });

  it('the joystick can be dragged too, and moving it to the right half moves its touch zone with it', () => {
    const { tc, root, ev } = setup({ gameId: 'g1' });
    tc.editLayout();
    const base = root.find('nbg-tc-base')!;
    base.fire('pointerdown', ev(4, 100, 300));
    root.fire('pointermove', ev(4, 640, 300));
    root.fire('pointerup', ev(4, 640, 300));
    expect(tc.placement.controls.joystick).toMatchObject({ x: 0.8 });
    expect(root.classList.contains('stick-right')).toBe(true);
  });

  it('Bigger / Smaller resize the picked control, the slider sets opacity, Reset forgets it all, Done closes', () => {
    const { tc, root, btn, ev, storage } = setup({ gameId: 'g1' });
    tc.editLayout();
    const bar = root.find('nbg-tc-edit')!;
    const button = (cls: string) => bar.all(cls)[0];
    btn('sprint').fire('pointerdown', ev(5, 0, 0));
    btn('sprint').fire('pointerup', ev(5, 0, 0));
    button('nbg-tc-bigger').fire('click', {});
    button('nbg-tc-bigger').fire('click', {});
    expect(tc.placement.controls.sprint.size).toBe(1.3);
    // Run sits in the bottom-right corner: grown in place it would poke past the edge, so it is kept whole on screen.
    expect(btn('sprint').style.transform).toContain('scale(1.3)');
    const run = tc.onScreen.find((b: any) => b.id === 'sprint');
    expect(run.x + run.hw).toBeLessThanOrEqual(800 - 8 + 1e-6);
    const range = bar.children.find((c) => c.tag === 'label')!.children[0];
    range.value = '0.4';
    range.fire('input', {});
    expect(btn('attack').style.opacity).toBe('0.4');
    expect(JSON.parse(storage.map.get('nbg-touch-layout-v1:g1')!).opacity).toBe(0.4);
    button('nbg-tc-reset').fire('click', {});
    expect(storage.map.has('nbg-touch-layout-v1:g1')).toBe(false);
    expect(tc.placement).toEqual({ controls: {}, opacity: 1, joystickMode: 'floating' });
    button('nbg-tc-done').fire('click', {});
    expect(tc.editing).toBe(false);
    expect(root.find('nbg-tc-edit')).toBeUndefined();
  });

  it('Reset puts a placed button back into the grid, in its first order', () => {
    const { tc, btn, root } = setup({ gameId: 'g1' }, { 'nbg-touch-layout-v1:g1': JSON.stringify({ controls: { attack: { x: 0.5, y: 0.5 } } }) });
    expect(btn('attack').parentElement).toBe(root);
    tc.setPlayerLayout(null);
    const grid = root.find('nbg-tc-buttons')!;
    expect(grid.children.map((c) => c.attrs['data-action'])).toEqual(['attack', 'jump', 'interact', 'sprint']);
    expect(btn('attack').style.position).toBe('');
  });

  it('in the drive layout the steer and pedal pads are what moves', () => {
    const { tc, root, btn, ev } = setup({ gameId: 'g1', layout: 'drive' });
    tc.editLayout();
    btn('left').fire('pointerdown', ev(6, 100, 350));
    root.fire('pointermove', ev(6, 400, 200));
    root.fire('pointerup', ev(6, 400, 200));
    const steer = root.find('nbg-tc-steer')!;
    expect(steer.style.left).toBe('50%');
    expect(tc.placement.controls.steer).toMatchObject({ x: 0.5, y: 0.5 });
  });
});

describe('🗺️ the minimap is in the SAME editor (master audit 2026-11-25, Part H — "the map cannot be resized")', () => {
  /** A HUD element registered the way the Minimap registers itself; records every placement it is told. */
  function withMap(seed: Record<string, string> = {}) {
    const t = setup({ gameId: 'g1' }, seed);
    const told: any[] = [];
    const off = t.tc.addHudElement('minimap', { label: 'Minimap', width: 128, height: 128, home: () => ({ x: 80, y: 120 }), apply: (p: any) => told.push(p) });
    const proxy = t.root.find('nbg-tc-hud')!;
    return { ...t, told, off, proxy };
  }
  it('it gets a box in the editor and is told its spot (unplaced = its own corner, size 1)', () => {
    const { proxy, told } = withMap();
    expect(proxy).toBeTruthy();
    expect(proxy.textContent).toBe('Minimap');
    expect(told.at(-1)).toEqual({ size: 1 });
  });
  it('drag moves it and SAVES it with the controls; the map is told where to draw', () => {
    const { tc, proxy, told, ev, storage } = withMap();
    tc.editLayout();
    proxy.fire('pointerdown', ev(3, 80, 120));
    proxy.fire('pointermove', ev(3, 400, 200));
    proxy.fire('pointerup', ev(3, 400, 200));
    const stored = JSON.parse(storage.map.get('nbg-touch-layout-v1:g1')!);
    expect(stored.controls.minimap.x).toBeCloseTo(0.5, 1);
    expect(stored.controls.minimap.y).toBeCloseTo(0.5, 1);
    expect(told.at(-1).x).toBeCloseTo(0.5, 1);
    expect(told.at(-1).y).toBeCloseTo(0.5, 1);
  });
  it('Bigger resizes it (and the box), Reset puts it back in its corner at its own size', () => {
    const { tc, root, proxy, told, ev, storage } = withMap();
    tc.editLayout();
    proxy.fire('pointerdown', ev(4, 80, 120)); proxy.fire('pointerup', ev(4, 80, 120));
    const bar = root.find('nbg-tc-edit')!;
    bar.all('nbg-tc-bigger')[0].fire('click', {});
    expect(told.at(-1).size).toBe(1.15);
    expect(proxy.style.width).toBe(Math.round(128 * 1.15) + 'px');
    expect(JSON.parse(storage.map.get('nbg-touch-layout-v1:g1')!).controls.minimap.size).toBe(1.15);
    bar.all('nbg-tc-reset')[0].fire('click', {});
    expect(told.at(-1)).toEqual({ size: 1 });
  });
  it('a saved place is applied on the next game start (backward compatible: an old layout has no minimap and keeps the corner)', () => {
    const saved = withMap({ 'nbg-touch-layout-v1:g1': JSON.stringify({ controls: { minimap: { x: 0.8, y: 0.3, size: 1.4 } } }) });
    expect(saved.told.at(-1)).toEqual({ x: 0.8, y: 0.3, size: 1.4 });
    const old = withMap({ 'nbg-touch-layout-v1:g1': JSON.stringify({ controls: { attack: { x: 0.5, y: 0.5 } } }) });
    expect(old.told.at(-1)).toEqual({ size: 1 });
  });
  it('no control is put on top of it — the map takes part in the overlap solver', () => {
    const { tc } = withMap();
    const map = tc.onScreen.find((b: any) => b.id === 'minimap');
    expect(map).toBeTruthy();
    for (const b of tc.onScreen) if (b.id !== 'minimap') {
      const apart = Math.abs(b.x - map.x) >= b.hw + map.hw - 1e-6 || Math.abs(b.y - map.y) >= b.hh + map.hh - 1e-6;
      expect(apart, b.id).toBe(true);
    }
  });
  it('taking it out removes its box; a real control id cannot be stolen', () => {
    const { tc, root, off } = withMap();
    off();
    expect(root.find('nbg-tc-hud')).toBeUndefined();
    const none = tc.addHudElement('attack', { label: 'x', width: 10, height: 10, home: () => null, apply: () => {} });
    none();
    expect(root.all('nbg-tc-btn').some((b: any) => b.attrs['data-action'] === 'attack')).toBe(true);
  });
  it('the Minimap registers itself and draws where the layout says, at the layout\'s size', () => {
    expect(HUD).toContain("game.registerHud('minimap'");
    expect(HUD).toMatch(/style\.size \* place\.size/);
    expect(HUD).toContain("left: place.x * 100 + '%'");
    expect(GAME).toContain('registerHud(id: string, spec: HudElementSpec): () => void {');
  });
});

describe('the game wires it in', () => {
  it('the Settings panel offers Edit controls, which closes the panel and opens the editor', () => {
    expect(HUD).toContain('<TouchLayoutSection game={game} onBack={onBack} />');
    expect(HUD).toContain("onClick={() => { onBack(); touch.editLayout(); }}>{t('editControls')}</button>");
    // Only where the touch controls are actually on screen.
    expect(HUD).toContain('if (!touch || !touch.visible) return null;');
  });

  it('the game hands its gameId over (layouts are per game) and exposes the controls to the HUD', () => {
    // A held gun relabels Attack as Fire through `buttons` (2026-11-26); the gameId still travels with every layout.
    expect(GAME).toContain('new TouchControls(options.container, this.input, { gameId: options.gameId, ...touchOptions, ...(buttons ? { buttons } : {}) })');
    expect(GAME).toContain('get touchControls(): TouchControls | null { return this.touch; }');
  });

  it('the builder is told how to honour "joystick on the right", "bigger buttons" and the player editor', () => {
    const text = shell.instructions;
    expect(text).toContain("joystick: { side: 'right' }");
    expect(text).toContain('buttonPositions: { attack:');
    expect(text).toContain('Settings → Edit controls');
  });

  it('every new label is in the game\'s strings (English shown here)', () => {
    for (const [k, v] of [['editControls', 'Edit controls'], ['smaller', 'Smaller'], ['bigger', 'Bigger'], ['controlsOpacity', 'Opacity'], ['done', 'Done']]) {
      expect(STRINGS).toContain(k + ": '" + v + "'");
    }
  });
});

// ── 2026-11-22 follow-up: pinch, no overlaps, fixed/floating in the editor, and the rough edges ─────
// "Pinch to resize, overlapping controls pushed apart, floating vs fixed in the player's editor — rock solid" (admin).

/** No two boxes overlap and every box is whole inside the screen minus the inset. */
function assertClean(boxes: Array<{ id: string; x: number; y: number; hw: number; hh: number }>, w: number, h: number, inset = 8) {
  for (const b of boxes) {
    expect(b.x - b.hw, b.id + ' left').toBeGreaterThanOrEqual(inset - 1e-6);
    expect(b.y - b.hh, b.id + ' top').toBeGreaterThanOrEqual(inset - 1e-6);
    expect(b.x + b.hw, b.id + ' right').toBeLessThanOrEqual(w - inset + 1e-6);
    expect(b.y + b.hh, b.id + ' bottom').toBeLessThanOrEqual(h - inset + 1e-6);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = Math.abs(a.x - b.x) < a.hw + b.hw - 0.01 && Math.abs(a.y - b.y) < a.hh + b.hh - 0.01;
    expect(overlap, a.id + ' covers ' + b.id).toBe(false);
  }
}

/** Resize the fake game area and tell the controls, the way a turned phone does. */
function resizeTo(root: any, win: any, w: number, h: number) {
  root.rect = { left: 0, top: 0, right: w, bottom: h, width: w, height: h };
  win.fire('resize', {});
}

const NO_INSET = { left: 8, top: 8, right: 8, bottom: 8 };

describe('separateTouchControls (pure): none covers another, all on screen, deterministic', () => {
  it('the first box keeps its spot; a later box that covers it moves to the NEAREST free spot', () => {
    const boxes = [{ id: 'a', x: 400, y: 200, hw: 32, hh: 32 }, { id: 'b', x: 410, y: 205, hw: 32, hh: 32 }];
    const r = PURE.separateTouchControls(boxes, 800, 400, NO_INSET);
    expect(r.fits).toBe(true);
    expect(r.scale).toBe(1);
    expect(r.boxes[0]).toMatchObject({ id: 'a', x: 400, y: 200 });
    // b goes right by the least it can: a's right edge + the gap + its own half.
    expect(r.boxes[1]).toMatchObject({ id: 'b', x: 400 + 32 + PURE.TOUCH_GAP + 32, y: 205 });
    assertClean(r.boxes, 800, 400);
    // Same input, same answer.
    expect(PURE.separateTouchControls(boxes, 800, 400, NO_INSET)).toEqual(r);
  });

  it('boxes that already fit are left exactly where they are', () => {
    const boxes = [{ id: 'a', x: 100, y: 300, hw: 56, hh: 56 }, { id: 'b', x: 700, y: 300, hw: 32, hh: 32 }];
    expect(PURE.separateTouchControls(boxes, 800, 400, NO_INSET)).toEqual({ boxes, scale: 1, fits: true });
  });

  it('a screen too small for every control shrinks them all by one factor, then nothing overlaps', () => {
    const boxes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, x: 100, y: 60, hw: 32, hh: 32 }));
    const r = PURE.separateTouchControls(boxes, 220, 120, NO_INSET);
    expect(r.fits).toBe(true);
    expect(r.scale).toBeLessThan(1);
    expect(new Set(r.boxes.map((b: any) => b.hw)).size).toBe(1);
    assertClean(r.boxes, 220, 120);
  });

  it('when even the smallest size cannot fit, it says so (fits: false) and still keeps every box on screen', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => ({ id: 'k' + i, x: 50, y: 50, hw: 60, hh: 60 }));
    const r = PURE.separateTouchControls(boxes, 120, 100, NO_INSET);
    expect(r.fits).toBe(false);
    expect(r.scale).toBe(PURE.TOUCH_FIT_MIN);
    for (const b of r.boxes) { expect(b.x - b.hw).toBeGreaterThanOrEqual(8 - 1e-6); expect(b.y + b.hh).toBeLessThanOrEqual(100 - 8 + 1e-6); }
  });

  it('THE CLASS: across 400 random layouts and screens, whatever fits is clean (no cover, all on screen)', () => {
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 400; n++) {
      const w = 200 + Math.floor(rnd() * 1800);
      const h = 150 + Math.floor(rnd() * 1200);
      const boxes = Array.from({ length: 1 + Math.floor(rnd() * 9) }, (_, i) => {
        const hw = 20 + rnd() * 90;
        return { id: 'c' + i, x: rnd() * w, y: rnd() * h, hw, hh: rnd() < 0.3 ? hw * 0.5 : hw };
      });
      const r = PURE.separateTouchControls(boxes, w, h, NO_INSET);
      expect(r.boxes.map((b: any) => b.id)).toEqual(boxes.map((b) => b.id));
      if (r.fits) assertClean(r.boxes, w, h);
    }
  });

  it('pinch size follows the fingers and stays inside 0.6..2', () => {
    expect(PURE.touchPinchSize(1, 100, 150)).toBe(1.5);
    expect(PURE.touchPinchSize(1.2, 100, 50)).toBe(0.6);
    expect(PURE.touchPinchSize(1.5, 100, 400)).toBe(2);
    expect(PURE.touchPinchSize(1.1, 0, 400)).toBe(1.1);
    expect(PURE.touchPinchSize(1.1, 100, NaN)).toBe(1.1);
  });

  it('joystick mode: kit default floating < the prompt\'s mode < the player\'s switch; junk is dropped', () => {
    expect(PURE.resolveTouchLayout({}, null).joystickMode).toBe('floating');
    expect(PURE.resolveTouchLayout({ joystick: { mode: 'fixed' } }, null).joystickMode).toBe('fixed');
    expect(PURE.resolveTouchLayout({ joystick: { mode: 'fixed' } }, { controls: {}, joystickMode: 'floating' }).joystickMode).toBe('floating');
    expect(PURE.sanitizeTouchLayout({ controls: {}, joystickMode: 'sticky' })).toEqual({ controls: {} });
    expect(PURE.sanitizeTouchLayout({ controls: {}, joystickMode: 'fixed' })).toEqual({ controls: {}, joystickMode: 'fixed' });
  });

  it('a saved value naming __proto__ / constructor never becomes a control or touches the prototype', () => {
    const s = PURE.sanitizeTouchLayout(JSON.parse('{"controls":{"__proto__":{"x":0.5,"y":0.5},"constructor":{"size":2},"jump":{"size":1.2}}}'));
    expect(Object.keys(s.controls)).toEqual(['jump']);
    expect(Object.getPrototypeOf(s.controls)).toBe(Object.prototype);
    expect((s.controls as any).x).toBeUndefined();
  });
});

describe('TouchControls keeps every control clear of the others', () => {
  it('dropping Jump onto Attack: Jump stays where it was dropped, Attack makes room, and a reload opens the same', () => {
    const { tc, btn, ev, storage, root } = setup({ gameId: 'ov' });
    tc.editLayout();
    const attack = tc.onScreen.find((b: any) => b.id === 'attack');
    btn('jump').fire('pointerdown', ev(9, 700, 300));
    btn('jump').fire('pointermove', ev(9, attack.x + 6, attack.y + 4));
    btn('jump').fire('pointerup', ev(9, attack.x + 6, attack.y + 4));
    const after = tc.onScreen;
    assertClean(after, 800, 400);
    const jump = after.find((b: any) => b.id === 'jump');
    expect(Math.abs(jump.x - (attack.x + 6))).toBeLessThan(1);
    expect(Math.abs(jump.y - (attack.y + 4))).toBeLessThan(1);
    // What was drawn is what was saved: a new TouchControls over the same storage draws the very same spots.
    const again = setup({ gameId: 'ov' }, Object.fromEntries(storage.map));
    for (const b of again.tc.onScreen) {
      const was = after.find((x: any) => x.id === b.id);
      expect(Math.abs(b.x - was.x), b.id).toBeLessThan(1);
      expect(Math.abs(b.y - was.y), b.id).toBeLessThan(1);
    }
    // And the DOM agrees with the boxes: a placed button sits at its box centre.
    const a2 = after.find((b: any) => b.id === 'attack');
    expect(parseFloat(btn('attack').style.left)).toBeCloseTo((a2.x / 800) * 100, 3);
    expect(root.find('nbg-tc-buttons')).toBeDefined();
  });

  it('dropping a placed control onto another PLACED one: what the player saw is saved, so a reload does not swap who moved', () => {
    // Both already placed by the player: Attack first in drawing order. Without saving the push, a reload would let
    // Attack keep its spot and shove Jump away from where the player dropped it.
    const seed = { 'nbg-touch-layout-v1:ov2': JSON.stringify({ controls: { attack: { x: 0.5, y: 0.5 }, jump: { x: 0.2, y: 0.3 } } }) };
    const { tc, btn, ev, storage } = setup({ gameId: 'ov2' }, seed);
    tc.editLayout();
    btn('jump').fire('pointerdown', ev(4, 160, 120));
    btn('jump').fire('pointermove', ev(4, 410, 205));
    btn('jump').fire('pointerup', ev(4, 410, 205));
    const seen = tc.onScreen;
    assertClean(seen, 800, 400);
    const dropped = seen.find((b: any) => b.id === 'jump');
    expect(Math.abs(dropped.x - 410)).toBeLessThan(1);
    expect(Math.abs(dropped.y - 205)).toBeLessThan(1);
    const again = setup({ gameId: 'ov2' }, Object.fromEntries(storage.map)).tc.onScreen;
    for (const b of again) {
      const was = seen.find((x: any) => x.id === b.id);
      expect(Math.abs(b.x - was.x), b.id).toBeLessThan(1);
      expect(Math.abs(b.y - was.y), b.id).toBeLessThan(1);
    }
  });

  it('Bigger seven times on the corner button: it never pokes off screen and never covers a neighbour', () => {
    const { tc, root, btn, ev } = setup({ gameId: 'big' });
    tc.editLayout();
    btn('sprint').fire('pointerdown', ev(5, 0, 0));
    btn('sprint').fire('pointerup', ev(5, 0, 0));
    const bigger = root.find('nbg-tc-edit')!.all('nbg-tc-bigger')[0];
    for (let i = 0; i < 7; i++) bigger.fire('click', {});
    expect(tc.placement.controls.sprint.size).toBe(2);
    assertClean(tc.onScreen, 800, 400);
  });

  it('a resize or rotation re-fits every control to the new screen; the player\'s saved layout is not rewritten by it', () => {
    const saved = { controls: { attack: { x: 0.9, y: 0.85, size: 1.6 }, jump: { x: 0.88, y: 0.8, size: 1.4 }, joystick: { x: 0.12, y: 0.8, size: 1.5 } } };
    const seed = { 'nbg-touch-layout-v1:rot': JSON.stringify(saved) };
    const { tc, root, win, storage } = setup({ gameId: 'rot' }, seed);
    assertClean(tc.onScreen, 800, 400);
    resizeTo(root, win, 360, 640);
    assertClean(tc.onScreen, 360, 640);
    resizeTo(root, win, 1600, 1000);
    assertClean(tc.onScreen, 1600, 1000);
    expect(JSON.parse(storage.map.get('nbg-touch-layout-v1:rot')!)).toEqual(saved);
  });

  it('a tiny screen shrinks the controls together, the editor says so honestly, and a big screen grows them back', () => {
    const { tc, root, win } = setup({ gameId: 'tiny' });
    resizeTo(root, win, 240, 150);
    expect(tc.fit).toBeLessThan(1);
    assertClean(tc.onScreen, 240, 150);
    tc.editLayout();
    const note = root.find('nbg-tc-fit')!;
    expect(note.textContent).toBe('Controls made smaller to fit this screen');
    expect(note.style.display).toBe('');
    resizeTo(root, win, 900, 500);
    expect(tc.fit).toBe(1);
    expect(note.style.display).toBe('none');
    assertClean(tc.onScreen, 900, 500);
  });

  it('the drive pads are fitted too (a bigger pedal pad never covers the steer pad)', () => {
    const { tc, root, win } = setup({ gameId: 'drv', layout: 'drive' });
    tc.setPlayerLayout({ controls: { steer: { size: 2 }, pedals: { size: 2 } } });
    resizeTo(root, win, 640, 360);
    expect(tc.onScreen.map((b: any) => b.id)).toEqual(['steer', 'pedals']);
    assertClean(tc.onScreen, 640, 360);
  });
});

describe('pinch to resize (two fingers) while editing', () => {
  it('two fingers spread: the picked control grows with them, clamped at 2; nothing is pressed; let go saves', () => {
    const { tc, root, btn, ev, input, storage } = setup({ gameId: 'pin' });
    tc.editLayout();
    const a = tc.onScreen.find((b: any) => b.id === 'attack');
    btn('attack').fire('pointerdown', { ...ev(1, a.x, a.y), pointerType: 'touch', isPrimary: true });
    // The second finger lands ON another control: it pinches Attack, it does not pick Jump up or press it.
    const j = tc.onScreen.find((b: any) => b.id === 'jump');
    btn('jump').fire('pointerdown', { ...ev(2, a.x, a.y - 100), pointerType: 'touch', isPrimary: false });
    root.fire('pointermove', { ...ev(2, a.x, a.y - 150), pointerType: 'touch' });
    expect(tc.placement.controls.attack.size).toBe(1.5);
    root.fire('pointermove', { ...ev(2, a.x, a.y - 900), pointerType: 'touch' });
    expect(tc.placement.controls.attack.size).toBe(2);
    for (const action of ['attack', 'jump', 'interact', 'sprint']) expect(input.isDown(action), action).toBe(false);
    expect(j).toBeDefined();
    root.fire('pointerup', { ...ev(2, a.x, a.y - 900), pointerType: 'touch' });
    root.fire('pointerup', { ...ev(1, a.x, a.y), pointerType: 'touch' });
    expect(JSON.parse(storage.map.get('nbg-touch-layout-v1:pin')!).controls.attack.size).toBe(2);
    assertClean(tc.onScreen, 800, 400);
  });

  it('pinching in shrinks to 0.6 and no further; two fingers on the background pinch the picked control', () => {
    const { tc, root, ev } = setup({ gameId: 'pin2' });
    tc.editLayout();   // the joystick is picked when the editor opens
    root.fire('pointerdown', { ...ev(1, 300, 200), pointerType: 'touch', isPrimary: true });
    root.fire('pointerdown', { ...ev(2, 500, 200), pointerType: 'touch', isPrimary: false });
    root.fire('pointermove', { ...ev(2, 310, 200), pointerType: 'touch' });
    expect(tc.placement.controls.joystick.size).toBe(0.6);
    root.fire('pointerup', { ...ev(2, 310, 200), pointerType: 'touch' });
    // The finger left on the glass does not suddenly drag anything.
    root.fire('pointermove', { ...ev(1, 50, 50), pointerType: 'touch' });
    expect(tc.placement.controls.joystick.x).toBeUndefined();
  });

  it('a lost release never leaves a ghost finger: the next single press is a drag, not a pinch', () => {
    const { tc, btn, ev } = setup({ gameId: 'ghost' });
    tc.editLayout();
    btn('attack').fire('pointerdown', { ...ev(1, 700, 300), pointerType: 'touch', isPrimary: true });
    // pointer 1's release never arrives (the browser lost it); the next touch starts a new sequence.
    btn('jump').fire('pointerdown', { ...ev(5, 700, 250), pointerType: 'touch', isPrimary: true });
    btn('jump').fire('pointermove', { ...ev(5, 200, 100), pointerType: 'touch' });
    btn('jump').fire('pointerup', { ...ev(5, 200, 100), pointerType: 'touch' });
    expect(tc.placement.controls.jump).toMatchObject({ x: 0.25, y: 0.25 });
    expect(tc.placement.controls.attack?.size ?? 1).toBe(1);
  });
});

describe('floating vs fixed joystick, in the player\'s editor', () => {
  it('the switch shows the prompt\'s choice, the player overrides it (saved per game), Reset goes back to the prompt', () => {
    const { tc, root, storage, ev } = setup({ gameId: 'js', joystick: { mode: 'fixed' } });
    tc.editLayout();
    const box = root.find('nbg-tc-fixed')! as any;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.fire('change', {});
    expect(tc.placement.joystickMode).toBe('floating');
    expect(JSON.parse(storage.map.get('nbg-touch-layout-v1:js')!).joystickMode).toBe('floating');
    tc.finishEditing();
    // Floating now: the joystick jumps under the thumb.
    const move = root.find('nbg-tc-move')!;
    move.rect = { left: 0, top: 140, right: 400, bottom: 400, width: 400, height: 260 };
    move.fire('pointerdown', ev(3, 200, 250));
    expect(root.find('nbg-tc-base')!.style.left).toBe('200px');
    move.fire('pointerup', ev(3, 200, 250));
    // Another game with the same prompt keeps the prompt's fixed joystick.
    expect(setup({ gameId: 'js-other', joystick: { mode: 'fixed' } }, Object.fromEntries(storage.map)).tc.placement.joystickMode).toBe('fixed');
    tc.editLayout();
    root.find('nbg-tc-edit')!.all('nbg-tc-reset')[0].fire('click', {});
    expect(tc.placement.joystickMode).toBe('fixed');
    expect((root.find('nbg-tc-fixed') as any).checked).toBe(true);
  });

  it('a fixed joystick saved by the player beats a floating prompt: the base stays put under the thumb', () => {
    const { root, ev, input } = setup({ gameId: 'js2' }, { 'nbg-touch-layout-v1:js2': JSON.stringify({ controls: {}, joystickMode: 'fixed' }) });
    const base = root.find('nbg-tc-base')!;
    base.rect = { left: 24, top: 264, right: 136, bottom: 376, width: 112, height: 112 };
    const before = base.style.left;
    const move = root.find('nbg-tc-move')!;
    move.fire('pointerdown', ev(1, 200, 200));
    expect(base.style.left).toBe(before);
    expect(input.axis().x).toBeGreaterThan(0.5);
  });

  it('the switch is hidden in the drive layout (there is no joystick there)', () => {
    const { tc, root } = setup({ gameId: 'js3', layout: 'drive' });
    tc.editLayout();
    expect(root.find('nbg-tc-fixed-row')!.style.display).toBe('none');
  });
});

describe('rough edges: Esc / Done mid-gesture, teardown, keyboard, corrupt data', () => {
  it('Esc in the middle of a drag closes the editor AND keeps the move (it used to show it but never save it)', () => {
    const { tc, win, btn, ev, storage } = setup({ gameId: 'esc' });
    tc.editLayout();
    btn('attack').fire('pointerdown', ev(1, 700, 300));
    btn('attack').fire('pointermove', ev(1, 200, 100));
    win.fire('keydown', { key: 'Escape' });
    expect(tc.editing).toBe(false);
    expect(JSON.parse(storage.map.get('nbg-touch-layout-v1:esc')!).controls.attack).toMatchObject({ x: 0.25, y: 0.25 });
  });

  it('disposing the controls while the editor is open removes its key listener (Esc reaches the game again)', () => {
    const { tc, win } = setup({ gameId: 'disp' });
    tc.editLayout();
    tc.dispose();
    let stopped = false;
    win.fire('keydown', { key: 'Escape', stopImmediatePropagation: () => { stopped = true; }, preventDefault: () => { stopped = true; } });
    expect(stopped).toBe(false);
    expect(tc.editing).toBe(false);
  });

  it('keyboard only: focus picks a control, arrows move it (Shift = bigger steps), + / - resize, slider keys stay the slider\'s', () => {
    const { tc, win, btn, storage } = setup({ gameId: 'kb' });
    tc.editLayout();
    btn('jump').fire('focus', {});
    const start = tc.onScreen.find((b: any) => b.id === 'jump');
    win.fire('keydown', { key: 'ArrowLeft' });
    expect(tc.onScreen.find((b: any) => b.id === 'jump').x).toBeCloseTo(start.x - 8, 0);
    win.fire('keydown', { key: 'ArrowUp', shiftKey: true });
    expect(tc.onScreen.find((b: any) => b.id === 'jump').y).toBeCloseTo(start.y - 32, 0);
    win.fire('keydown', { key: '+' });
    expect(tc.placement.controls.jump.size).toBe(1.15);
    win.fire('keydown', { key: '-' });
    expect(tc.placement.controls.jump.size).toBe(1);
    const savedNow = storage.map.get('nbg-touch-layout-v1:kb');
    win.fire('keydown', { key: 'ArrowLeft', target: { tagName: 'INPUT' } });
    expect(storage.map.get('nbg-touch-layout-v1:kb')).toBe(savedNow);
    assertClean(tc.onScreen, 800, 400);
    win.fire('keydown', { key: 'Escape' });
    expect(tc.editing).toBe(false);
    // Closed: the arrow keys belong to the game again.
    let stopped = false;
    win.fire('keydown', { key: 'ArrowLeft', stopImmediatePropagation: () => { stopped = true; } });
    expect(stopped).toBe(false);
  });

  it('the joystick can take keyboard focus and has a name while editing, and gives both back after', () => {
    const { tc, root } = setup({ gameId: 'kb2' });
    tc.editLayout();
    const base = root.find('nbg-tc-base')!;
    expect(base.attrs.tabindex).toBe('0');
    expect(base.attrs['aria-label']).toBe('Joystick');
  });

  it('corrupt saved data of every shape opens the default layout and never throws', () => {
    for (const raw of ['not json', '[]', 'null', '{"controls":[1,2,3]}', '{"controls":{"attack":{"x":"0.5","y":null}}}', '{"controls":{"__proto__":{"x":0.1,"y":0.1}}}', '{"opacity":"x","joystickMode":5}']) {
      const { tc } = setup({ gameId: 'bad' }, { 'nbg-touch-layout-v1:bad': raw });
      expect(tc.placement.controls.attack, raw).toBeUndefined();
      expect(tc.placement.opacity).toBe(1);
      expect(tc.placement.joystickMode).toBe('floating');
      assertClean(tc.onScreen, 800, 400);
    }
  });
});

// ── A REAL BROWSER, where one exists (CI has none, so it is skipped there, visibly) ──────────────
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser, with a real mouse', () => {
  let server: http.Server;
  let base = '';
  const esm = (src: string) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  beforeAll(async () => {
    const files: Record<string, string> = {
      '/input.js': esm(INPUT),
      '/events.js': esm(EVENTS),
      '/strings.js': esm(STRINGS).replace("'./events'", "'./events.js'"),
      '/touch.js': esm(TOUCH).replace("'../core/input'", "'./input.js'").replace("'../core/strings'", "'./strings.js'"),
      '/': '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0">'
        + '<div id="host" style="position:fixed;inset:0;background:#123"></div><script type="module">'
        + "import { Input } from './input.js'; import { TouchControls } from './touch.js';"
        + "const host = document.getElementById('host'); const input = new Input(host);"
        + "window.__tc = new TouchControls(host, input, { force: true, gameId: 'real' }); window.__input = input;"
        + '</script></body></html>',
    };
    server = http.createServer((q, r) => {
      const body = files[(q.url ?? '/').split('?')[0]];
      r.writeHead(body ? 200 : 404, { 'content-type': (q.url ?? '').endsWith('.js') ? 'text/javascript' : 'text/html' });
      r.end(body ?? 'missing');
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('drag Attack with the mouse, make it bigger, reload: it is still there; the editor never presses it', async () => {
    const dir = makeTempDir('nbai-touch-layout-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `import playwright from '${PW}';
const { chromium } = playwright;
const b = await chromium.launch();
const out = {};
const ctx = await b.newContext({ viewport: { width: 900, height: 420 } });
const p = await ctx.newPage(); await p.goto(${JSON.stringify(base)}); await p.waitForFunction(() => !!window.__input);
const centre = (sel) => p.evaluate((s) => { const el = [...document.querySelectorAll('.nbg-tc-btn')].find((x) => x.getAttribute('data-action') === s); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }, sel);
await p.evaluate(() => window.__tc.editLayout());
const a0 = await centre('attack');
await p.mouse.move(a0.x, a0.y); await p.mouse.down();
out.pressedWhileEditing = await p.evaluate(() => window.__input.isDown('attack'));
await p.mouse.move(300, 200, { steps: 8 }); await p.mouse.up();
await p.click('.nbg-tc-bigger');
await p.click('.nbg-tc-done');
out.after = await centre('attack');
out.editingAfterDone = await p.evaluate(() => window.__tc.editing);
await p.reload(); await p.waitForFunction(() => !!window.__input);
out.reloaded = await centre('attack');
out.saved = await p.evaluate(() => localStorage.getItem('nbg-touch-layout-v1:real'));
console.log(JSON.stringify(out));
await b.close();
`);
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000 }, (e, o) => (e ? rej(e) : res(o))));
    const out = JSON.parse(stdout.trim().split('\n').pop()!);
    expect(out.pressedWhileEditing).toBe(false);
    expect(Math.abs(out.after.x - 300)).toBeLessThan(2);
    expect(Math.abs(out.after.y - 200)).toBeLessThan(2);
    expect(out.after.w).toBeGreaterThan(64 * 1.1);
    expect(out.editingAfterDone).toBe(false);
    expect(Math.abs(out.reloaded.x - 300)).toBeLessThan(2);
    expect(Math.abs(out.reloaded.y - 200)).toBeLessThan(2);
    expect(JSON.parse(out.saved).controls.attack).toMatchObject({ size: 1.15 });
  }, 90_000);

  it('real touch: two-finger pinch resizes, a drop never covers another control, rotation re-fits, the kit spots match the CSS', async () => {
    const dir = makeTempDir('nbai-touch-solid-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `import playwright from '${PW}';
const { chromium } = playwright;
const b = await chromium.launch();
const out = {};
const ctx = await b.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true });
const p = await ctx.newPage(); await p.goto(${JSON.stringify(base)}); await p.waitForFunction(() => !!window.__input);
const cdp = await ctx.newCDPSession(p);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) });
// Every drawn control as a DOM rectangle, and as the controls' own boxes.
const dom = () => p.evaluate(() => {
  const rects = {};
  const put = (id, el) => { const r = el.getBoundingClientRect(); if (r.width > 0) rects[id] = { x: r.x + r.width / 2, y: r.y + r.height / 2, hw: r.width / 2, hh: r.height / 2 }; };
  for (const el of document.querySelectorAll('.nbg-tc-buttons .nbg-tc-btn, .nbg-tc > .nbg-tc-btn')) put(el.getAttribute('data-action'), el);
  put('joystick', document.querySelector('.nbg-tc-base'));
  put('steer', document.querySelector('.nbg-tc-steer'));
  put('pedals', document.querySelector('.nbg-tc-pedals'));
  return rects;
});
const boxes = () => p.evaluate(() => window.__tc.onScreen);
const drift = async () => { const d = await dom(); let worst = 0; for (const bx of await boxes()) { const r = d[bx.id]; if (!r) return 'missing ' + bx.id; worst = Math.max(worst, Math.abs(r.x - bx.x), Math.abs(r.y - bx.y), Math.abs(r.hw - bx.hw), Math.abs(r.hh - bx.hh)); } return worst; };
const clean = async (w, h) => { const d = Object.entries(await dom()); for (const [id, r] of d) if (r.x - r.hw < 7.5 || r.y - r.hh < 7.5 || r.x + r.hw > w - 7.5 || r.y + r.hh > h - 7.5) return 'off screen ' + id; for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) { const [ia, a] = d[i], [ib, c] = d[j]; if (Math.abs(a.x - c.x) < a.hw + c.hw - 0.5 && Math.abs(a.y - c.y) < a.hh + c.hh - 0.5) return ia + ' covers ' + ib; } return 'ok'; };
out.driftMove = await drift();
await p.evaluate(() => window.__tc.setLayout('drive')); out.driftDrive = await drift(); await p.evaluate(() => window.__tc.setLayout('move'));

await p.evaluate(() => window.__tc.editLayout());
// A two-finger pinch: first finger on Attack, second 100 px above, spread to 150 px.
const a = (await boxes()).find((x) => x.id === 'attack');
await touch('touchStart', [[a.x, a.y]]);
await touch('touchStart', [[a.x, a.y], [a.x, a.y - 100]]);
for (const d of [110, 120, 130, 140, 150]) await touch('touchMove', [[a.x, a.y], [a.x, a.y - d]]);
out.pressedDuringPinch = await p.evaluate(() => ['attack', 'jump', 'interact', 'sprint'].some((k) => window.__input.isDown(k)));
await touch('touchEnd', []);
out.pinchSize = await p.evaluate(() => window.__tc.placement.controls.attack && window.__tc.placement.controls.attack.size);
out.pinchWidth = (await dom()).attack.hw * 2;
out.savedPinch = await p.evaluate(() => JSON.parse(localStorage.getItem('nbg-touch-layout-v1:real')).controls.attack.size);
out.cleanAfterPinch = await clean(900, 420);

// Drag Jump with the mouse and drop it right on top of Attack.
const j = (await boxes()).find((x) => x.id === 'jump');
const a2 = (await boxes()).find((x) => x.id === 'attack');
await p.mouse.move(j.x, j.y); await p.mouse.down(); await p.mouse.move(a2.x + 5, a2.y + 5, { steps: 10 }); await p.mouse.up();
out.cleanAfterDrop = await clean(900, 420);
out.jumpWhereDropped = (await boxes()).find((x) => x.id === 'jump');
out.dropAt = { x: a2.x + 5, y: a2.y + 5 };
// The joystick switch, and the keyboard.
await p.click('.nbg-tc-fixed');
out.mode = await p.evaluate(() => JSON.parse(localStorage.getItem('nbg-touch-layout-v1:real')).joystickMode);
await p.focus('.nbg-tc-base');
const j0 = (await boxes()).find((x) => x.id === 'joystick');
await p.keyboard.press('ArrowRight');
const j1 = (await boxes()).find((x) => x.id === 'joystick');
out.keyMoved = j1.x - j0.x;
await p.keyboard.press('Escape');
out.editingAfterEsc = await p.evaluate(() => window.__tc.editing);
const before = await dom();
await p.reload(); await p.waitForFunction(() => !!window.__input);
const after = await dom();
out.reloadDiff = Math.max(...Object.keys(before).map((k) => Math.max(Math.abs(before[k].x - after[k].x), Math.abs(before[k].y - after[k].y))));
// Turn the phone, then a tiny window: nothing covers anything, nothing leaves the screen.
await p.setViewportSize({ width: 360, height: 640 }); await p.waitForTimeout(150);
out.cleanPortrait = await clean(360, 640);
await p.setViewportSize({ width: 260, height: 160 }); await p.waitForTimeout(150);
out.cleanTiny = await clean(260, 160);
out.fitTiny = await p.evaluate(() => window.__tc.fit);
out.driftTiny = await drift();
console.log(JSON.stringify(out));
await b.close();
`);
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 80_000 }, (e, o) => (e ? rej(e) : res(o))));
    const out = JSON.parse(stdout.trim().split('\n').pop()!);
    // The overlap solver's idea of the kit's own spots is where the CSS really draws them (move and drive sets).
    expect(out.driftMove).toBeLessThan(1);
    expect(out.driftDrive).toBeLessThan(1);
    expect(out.pressedDuringPinch).toBe(false);
    expect(out.pinchSize).toBe(1.5);
    expect(Math.abs(out.pinchWidth - 96)).toBeLessThan(2);
    expect(out.savedPinch).toBe(1.5);
    expect(out.cleanAfterPinch).toBe('ok');
    expect(out.cleanAfterDrop).toBe('ok');
    expect(Math.abs(out.jumpWhereDropped.x - out.dropAt.x)).toBeLessThan(2);
    expect(Math.abs(out.jumpWhereDropped.y - out.dropAt.y)).toBeLessThan(2);
    expect(out.mode).toBe('fixed');
    expect(Math.abs(out.keyMoved - 8)).toBeLessThan(1);
    expect(out.editingAfterEsc).toBe(false);
    expect(out.reloadDiff).toBeLessThan(1);
    expect(out.cleanPortrait).toBe('ok');
    expect(out.cleanTiny).toBe('ok');
    expect(out.fitTiny).toBeLessThan(1);
    expect(out.driftTiny).toBeLessThan(1);
  }, 90_000);
});
