/**
 * FULL SCREEN, ON A PHONE, THE WAY THE PLAYER ASKED FOR IT (admin 2026-11-26, an iPhone screenshot in the NavBharatAI app):
 *   1. "swipe se full screen nahi honi chahiye, bas button (already hai) se honi chahiye"
 *   2. "full screen theek se ho bhi nahi rahi hai" — the picture filled only the top two thirds; the game's own background
 *      showed below it, under the touch buttons.
 *
 * 2's root: Game.ts gives its canvas `width: 100%; height: 100%`, then createRenderer() called `renderer.setSize(window.
 * innerWidth, window.innerHeight)`, whose default ALSO writes those numbers in px onto the canvas style. handleResize()
 * then (correctly, for a canvas the layout sizes) resized only the drawing buffer, so the canvas's box stayed the window
 * size it had at start-up forever: going full screen grew the game's box, and the picture stayed in the old one.
 * 1's root: play() asked for full screen on every touch device; full screen is now only the Full screen button's.
 *
 * These tests run the REAL generated three/renderer.ts (against a recording stand-in for three, since there is no WebGL
 * here) and census every kit file for who may ask the browser for full screen.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FAKE_THREE = `
export const SRGBColorSpace = 'srgb', ACESFilmicToneMapping = 4, PCFSoftShadowMap = 2;
export class WebGLRenderer {
  shadowMap = { enabled: false, type: 0 }; outputColorSpace = ''; toneMapping = 0; toneMappingExposure = 1;
  domElement; buffer = { w: 0, h: 0 };
  constructor(o) { this.domElement = o.canvas ?? { style: {} }; }
  setPixelRatio() {}
  // three's own behaviour: updateStyle defaults to true and then writes the size in px onto the canvas style.
  setSize(w, h, updateStyle = true) {
    this.buffer = { w, h };
    if (updateStyle !== false) { this.domElement.style.width = w + 'px'; this.domElement.style.height = h + 'px'; }
  }
}
`;

let R: any;
const listeners = new Map<string, Array<() => void>>();
let observed: Array<() => void> = [];

beforeAll(async () => {
  const dir = makeTempDir('nbai-fill-screen-');
  mkdirSync(join(dir, 'three'), { recursive: true });
  const renderer = generateGame3D().files['src/game/three/renderer.ts'];
  writeFileSync(join(dir, 'three', 'renderer.ts'), renderer.replace("from 'three'", "from './fakeThree.mjs'"));
  writeFileSync(join(dir, 'three', 'fakeThree.mjs'), FAKE_THREE);
  writeFileSync(join(dir, 'three', 'surfaces.ts'), 'export function softwareRenderer(): boolean { return false; }\n');
  (globalThis as any).window = {
    innerWidth: 390, innerHeight: 560, devicePixelRatio: 2,
    addEventListener: (t: string, fn: () => void) => listeners.set(t, [...(listeners.get(t) ?? []), fn]),
    removeEventListener: () => {},
  };
  (globalThis as any).ResizeObserver = class { constructor(fn: () => void) { observed.push(fn); } observe() {} disconnect() {} };
  R = await import(join(dir, 'three', 'renderer.ts'));
}, 60_000);
afterAll(() => { delete (globalThis as any).window; delete (globalThis as any).ResizeObserver; });

describe('the canvas fills whatever box the game is given (failedbr screenshot 2026-11-26)', () => {
  it('a canvas the page sizes keeps its 100% — and follows its box into full screen', () => {
    observed = [];
    const canvas = { style: { display: 'block', width: '100%', height: '100%' } };
    const renderer = R.createRenderer({ canvas });
    expect(canvas.style).toMatchObject({ width: '100%', height: '100%' });
    // The game's box: the page's size at start, then the whole phone screen once full screen is on.
    let box = { width: 390, height: 560 };
    const container = { getBoundingClientRect: () => box };
    const camera = { aspect: 1, updateProjectionMatrix() {} };
    R.handleResize(renderer, camera, container);
    box = { width: 390, height: 844 };
    for (const fn of observed) fn();
    expect(canvas.style).toMatchObject({ width: '100%', height: '100%' });
    expect(renderer.buffer).toEqual({ w: 390, h: 844 });
    expect(camera.aspect).toBeCloseTo(390 / 844);
  });

  it('a canvas nobody sizes still gets the window size (a full-page game is unchanged)', () => {
    const canvas = { style: {} as Record<string, string> };
    R.createRenderer({ canvas });
    expect(canvas.style).toMatchObject({ width: '390px', height: '560px' });
  });
});

describe('full screen is only ever the Full screen button (admin 2026-11-26)', () => {
  const kit = [...recipeFilePool()].filter(([p]) => /\.(?:ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p));

  it('no kit file asks the browser for full screen except Game.toggleFullscreen', () => {
    const askers = kit.filter(([, f]) => /\.(?:webkit)?[rR]equestFullscreen\s*\(|webkitEnterFullscreen\s*\(/.test(f.content)).map(([p]) => p);
    expect(askers).toEqual(['src/game/Game.ts']);
  });

  it('the one call to toggleFullscreen outside Game.ts is the Full screen button', () => {
    const calls: string[] = [];
    for (const [p, f] of kit) {
      for (const line of f.content.split('\n')) {
        if (!/toggleFullscreen\(\)/.test(line) || /async toggleFullscreen\(\)/.test(line)) continue;
        calls.push(p + ': ' + line.trim());
      }
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^src\/game\/ui\/Hud\.tsx: <button type="button" aria-label=\{fullscreen \? t\('exitFullScreen'\) : t\('fullScreen'\)\}/);
  });
});
