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
    expect(PURE.resolveTouchLayout({}, null)).toEqual({ controls: {}, opacity: 1 });
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
    expect(btn('sprint').style.transform).toBe('scale(1.3)');
    const range = bar.children.find((c) => c.tag === 'label')!.children[0];
    range.value = '0.4';
    range.fire('input', {});
    expect(btn('attack').style.opacity).toBe('0.4');
    expect(JSON.parse(storage.map.get('nbg-touch-layout-v1:g1')!).opacity).toBe(0.4);
    button('nbg-tc-reset').fire('click', {});
    expect(storage.map.has('nbg-touch-layout-v1:g1')).toBe(false);
    expect(tc.placement).toEqual({ controls: {}, opacity: 1 });
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

describe('the game wires it in', () => {
  it('the Settings panel offers Edit controls, which closes the panel and opens the editor', () => {
    expect(HUD).toContain('<TouchLayoutSection game={game} onBack={onBack} />');
    expect(HUD).toContain("onClick={() => { onBack(); touch.editLayout(); }}>{t('editControls')}</button>");
    // Only where the touch controls are actually on screen.
    expect(HUD).toContain('if (!touch || !touch.visible) return null;');
  });

  it('the game hands its gameId over (layouts are per game) and exposes the controls to the HUD', () => {
    expect(GAME).toContain('new TouchControls(options.container, this.input, { gameId: options.gameId, ...touchOptions })');
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
});
