// "mobile friendly game/app bane — mobile first!!!!!!" (admin 2026-09-30).
//
// Autopsy 6a55d939 ("Build a app like god of war") shipped a game driven by WASD + mouse. The runtime's
// Input had accepted a touch joystick and virtual buttons since the day it was written, but nothing DREW
// them, so on a phone the game rendered and could not be played — and the HUD could only be paused with
// Escape. The knowledge base had been telling users all along that the game "works on a phone".
//
// These tests hold the fix three ways: the shell ships and wires the controls (source); the controls'
// behaviour — joystick maths, dead zone, multi-touch, release — run against the REAL generated code and
// the REAL runtime Input in a small fake DOM (held by CI); and, where Chromium exists, the same two
// modules driven by real touch events.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ts from 'typescript';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { isKeyboardOnlyGame, touchPlayableNote } from '../src/server/AgentV3/touchPlayableGame';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { makeTempDir } from './helpers/tempDir';

const shell = generateGameShell().files;
const TOUCH = shell['src/game/ui/touchControls.ts'];
const INPUT = generateGameRuntime().files['src/game/core/input.ts'];

describe('the game shell draws touch controls and wires them in', () => {
  it('ships the controls, and Game builds them unless a game opts out', () => {
    expect(TOUCH).toContain('export class TouchControls');
    const game = shell['src/game/Game.ts'];
    expect(game).toContain("import { TouchControls, type TouchControlsOptions } from './ui/touchControls';");
    expect(game).toMatch(/if \(options\.touchControls !== false\) \{\s*const touch = new TouchControls\(options\.container, this\.input, options\.touchControls \|\| \{\}\);\s*this\.disposers\.push\(\(\) => touch\.dispose\(\)\);/);
  });

  it('a subset that includes Game always carries the controls', () => {
    expect(Object.keys(generateGameShell(['game']).files)).toContain('src/game/ui/touchControls.ts');
    expect(Object.keys(generateGameShell(['gamecanvas']).files)).toContain('src/game/ui/touchControls.ts');
  });

  it('a phone can pause: the HUD has a real Pause button that takes taps, inside the safe area', () => {
    const hud = shell['src/game/ui/Hud.tsx'];
    expect(hud).toContain('aria-label="Pause" onClick={() => game.pause()}');
    expect(hud).toContain("pointerEvents: 'auto', width: 44, height: 44");
    expect(hud).toContain("top: 'max(12px, env(safe-area-inset-top))'");
  });

  it('shown by INPUT, not width: the primary pointer, or the first real touch', () => {
    expect(TOUCH).toContain("window.matchMedia('(pointer: coarse)').matches");
    expect(TOUCH).toContain("if (e.pointerType === 'touch') this.show();");
  });
});

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

function load(src: string, globals: Record<string, unknown>, deps: Record<string, unknown> = {}): Record<string, any> {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const names = Object.keys(globals);
  new Function('module', 'exports', 'require', ...names, js)(mod, mod.exports, (id: string) => deps[id], ...names.map((n) => globals[n]));
  return mod.exports;
}

function setup(coarse: boolean) {
  const winTarget = new FakeEl('window');
  const doc = { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  const win = Object.assign(winTarget, { matchMedia: () => ({ matches: coarse }) });
  const globals = { document: doc, window: win, getComputedStyle: (el: FakeEl) => ({ position: el.style.position || 'static' }), navigator: { maxTouchPoints: 5 } };
  const { Input } = load(INPUT, globals);
  const { TouchControls } = load(TOUCH, globals);
  const canvas = new FakeEl('canvas');
  const input = new Input(canvas);
  const container = new FakeEl('div');
  const tc = new TouchControls(container, input, {});
  const move = container.find('nbg-tc-move')!;
  move.rect = { left: 0, top: 136, right: 422, bottom: 390, width: 422, height: 254 };
  const buttons = container.all('nbg-tc-btn');
  const btn = (label: string) => buttons.find((b) => b.textContent === label)!;
  const ev = (pointerId: number, x = 0, y = 0) => ({ pointerId, clientX: x, clientY: y, pointerType: 'touch', preventDefault: () => {} });
  return { input, tc, container, move, btn, ev, win };
}

describe('the controls, run for real (the generated module + the runtime Input)', () => {
  it('a touch device sees them; a mouse-only one does not', () => {
    expect(setup(true).tc.visible).toBe(true);
    expect(setup(false).tc.visible).toBe(false);
  });

  it('dragging the joystick up moves the player forward; a tiny wobble inside the dead zone does not', () => {
    const { input, move, ev } = setup(true);
    move.fire('pointerdown', ev(1, 150, 300));
    move.fire('pointermove', ev(1, 150, 297));
    expect(input.axis()).toEqual({ x: 0, y: 0 });
    move.fire('pointermove', ev(1, 150, 200));
    expect(input.axis().y).toBe(-1);
    move.fire('pointermove', ev(1, 250, 300));
    expect(input.axis().x).toBe(1);
  });

  it('multi-touch: moving and attacking at once, each released on its own', () => {
    const { input, move, btn, ev } = setup(true);
    move.fire('pointerdown', ev(1, 150, 300));
    move.fire('pointermove', ev(1, 150, 200));
    btn('Attack').fire('pointerdown', ev(2));
    expect(input.isDown('attack')).toBe(true);
    expect(input.axis().y).toBe(-1);
    btn('Attack').fire('pointerup', ev(2));
    expect(input.isDown('attack')).toBe(false);
    expect(input.axis().y).toBe(-1);
    move.fire('pointerup', ev(1));
    expect(input.axis()).toEqual({ x: 0, y: 0 });
  });

  it('two fingers on one action: letting go of one does not release it', () => {
    const { input, btn, ev } = setup(true);
    btn('Jump').fire('pointerdown', ev(3));
    btn('Jump').fire('pointerdown', ev(4));
    btn('Jump').fire('pointerup', ev(3));
    expect(input.isDown('jump')).toBe(true);
    btn('Jump').fire('pointerup', ev(4));
    expect(input.isDown('jump')).toBe(false);
  });

  it('leaving the app releases everything, or the player keeps running', () => {
    const { input, move, btn, ev, win } = setup(true);
    move.fire('pointerdown', ev(1, 150, 300));
    move.fire('pointermove', ev(1, 150, 200));
    btn('Run').fire('pointerdown', ev(2));
    win.fire('blur', {});
    expect(input.axis()).toEqual({ x: 0, y: 0 });
    expect(input.isDown('sprint')).toBe(false);
  });

  it('dispose removes the overlay', () => {
    const { tc, container } = setup(true);
    tc.dispose();
    expect(container.find('nbg-tc')).toBeUndefined();
  });
});

describe('a game written without the shell is told to be playable on a phone', () => {
  const keyboardGame = "const c = document.querySelector('canvas'); const ctx = c.getContext('2d');\n"
    + "window.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') x -= 5; });\n"
    + 'function loop() { requestAnimationFrame(loop); }';

  it('a keyboard-only game loop is recognised; one with touch, or a form with a shortcut, is not', () => {
    expect(isKeyboardOnlyGame('index.html', keyboardGame)).toBe(true);
    expect(isKeyboardOnlyGame('game.js', keyboardGame + "\nc.addEventListener('touchstart', t);")).toBe(false);
    expect(isKeyboardOnlyGame('src/Form.tsx', "window.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });")).toBe(false);
    expect(isKeyboardOnlyGame('notes.md', keyboardGame)).toBe(false);
  });

  class Act implements ActuatorPort {
    files = new Map<string, string>();
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }

  it('said once per build, while the file is open', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(), 'ws-touch', new WorkspaceState(stream), stream);
    const first = String((await d.dispatch({ id: 'a', name: 'write_file', input: { path: 'game.js', content: keyboardGame } }, 'architect')).content);
    expect(first).toContain('MOBILE FIRST');
    expect(first).toContain('game.js drives the game from the KEYBOARD only');
    const second = String((await d.dispatch({ id: 'b', name: 'write_file', input: { path: 'game2.js', content: keyboardGame } }, 'architect')).content);
    expect(second).not.toContain('MOBILE FIRST');
    expect(touchPlayableNote('x.js')).toContain('touchControls: { buttons: [...] }');
  });
});

// ── A REAL BROWSER, where one exists (CI has none, so it is skipped there, visibly) ──────────────
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser, with real touch events', () => {
  let server: http.Server;
  let base = '';
  const esm = (src: string) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  beforeAll(async () => {
    const files: Record<string, string> = {
      '/input.js': esm(INPUT),
      '/touch.js': esm(TOUCH).replace("'../core/input'", "'./input.js'"),
      '/': '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0">'
        + '<div id="host" style="position:fixed;inset:0;background:#123"></div><script type="module">'
        + "import { Input } from './input.js'; import { TouchControls } from './touch.js';"
        + "const host = document.getElementById('host'); const input = new Input(host);"
        + 'window.__tc = new TouchControls(host, input, {}); window.__input = input;'
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

  it('phone: joystick + attack together, released on lift; desktop: no overlay', async () => {
    const dir = makeTempDir('nbai-touch-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `import playwright from '${PW}';
const { chromium } = playwright;
const b = await chromium.launch();
const out = {};
const phone = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
const p = await phone.newPage(); await p.goto(${JSON.stringify(base)}); await p.waitForFunction(() => !!window.__input);
out.shown = await p.evaluate(() => window.__tc.visible);
const atk = await p.evaluate(() => { const r = [...document.querySelectorAll('.nbg-tc-btn')].find((x) => x.textContent === 'Attack').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const cdp = await phone.newCDPSession(p);
const t = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
await t('touchStart', [{ x: 150, y: 300, id: 0 }]);
await t('touchMove', [{ x: 150, y: 200, id: 0 }]);
await t('touchStart', [{ x: 150, y: 200, id: 0 }, { x: atk.x, y: atk.y, id: 1 }]);
out.held = await p.evaluate(() => ({ y: window.__input.axis().y, attack: window.__input.isDown('attack') }));
await t('touchEnd', []);
out.released = await p.evaluate(() => ({ y: window.__input.axis().y, attack: window.__input.isDown('attack') }));
const desk = await b.newContext({ viewport: { width: 1280, height: 800 } });
const d = await desk.newPage(); await d.goto(${JSON.stringify(base)}); await d.waitForFunction(() => !!window.__input);
out.desktop = await d.evaluate(() => window.__tc.visible);
console.log(JSON.stringify(out));
await b.close();
`);
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000 }, (e, o) => (e ? rej(e) : res(o))));
    const out = JSON.parse(stdout.trim().split('\n').pop()!);
    expect(out.shown).toBe(true);
    expect(out.held).toEqual({ y: -1, attack: true });
    expect(out.released).toEqual({ y: 0, attack: false });
    expect(out.desktop).toBe(false);
  }, 90_000);
});
