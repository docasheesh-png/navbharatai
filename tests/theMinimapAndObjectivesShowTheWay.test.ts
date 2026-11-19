// THE MINIMAP AND THE OBJECTIVES (admin 2026-11-19 game-gap audit, P1 #16): a 3D game had no minimap and no tracker of
// what the player is trying to do (QUEST_* were declared and unused). These run the REAL generated three/markers.ts,
// core/quests.ts, Game.ts and ui/Hud.tsx: markers land around the player turned with the camera, far goals pin to the
// edge, and objectives count up and complete.
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

const DIR = join(__dirname, `.tmp-minimap-${process.pid}`);

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

let SET: any; let SHELL: any; let STATE: any; let HUD: any; let MK: any; let Q: any; let EV: any;
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
  MK = await import(join(DIR, 'src/game/three/markers.ts'));
  Q = await import(join(DIR, 'src/game/core/quests.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', '__rec', 'localStorage']) delete (globalThis as any)[k];
});
beforeEach(() => { MK.clearMapMarkers(); Q.objectives.clear(); STATE.setStatus('menu'); });


describe('🗺️ the minimap\'s arithmetic', () => {
  const view = { x: 0, z: 0, forward: { x: 0, z: 1 } };   // camera looks along +Z
  it('ahead is up, the camera\'s right is right, and the player is the centre', () => {
    expect(HUD.minimapPoint(view, { x: 0, z: 0 }, 60, 128)).toMatchObject({ x: 64, y: 64, edge: false });
    const ahead = HUD.minimapPoint(view, { x: 0, z: 30 }, 60, 128);
    expect(ahead.x).toBeCloseTo(64); expect(ahead.y).toBeLessThan(64);
    // With forward +Z, the camera's right is -X (three.js: a camera looking down +Z has +X on its LEFT).
    const right = HUD.minimapPoint(view, { x: -30, z: 0 }, 60, 128);
    expect(right.x).toBeGreaterThan(64); expect(right.y).toBeCloseTo(64);
  });
  it('turns with the camera, and a far goal is pinned to the edge, pointing the way', () => {
    const turned = { x: 0, z: 0, forward: { x: 1, z: 0 } };
    const p = HUD.minimapPoint(turned, { x: 30, z: 0 }, 60, 128);
    expect(p.y).toBeLessThan(64); expect(p.x).toBeCloseTo(64);
    const far = HUD.minimapPoint(view, { x: 0, z: 5000 }, 60, 128);
    expect(far.edge).toBe(true);
    expect(Math.hypot(far.x - 64, far.y - 64)).toBeCloseTo(58, 0);
  });
});

describe('📍 markers', () => {
  it('a marker reports its object\'s world position; hidden, removed or unparented objects are left out', () => {
    const scene = new THREE.Scene();
    const a = new THREE.Object3D(); a.position.set(5, 0, -3); scene.add(a);
    const b = new THREE.Object3D(); scene.add(b);
    const offA = MK.addMapMarker(a, 'enemy');
    MK.addMapMarker(b, 'goal');
    scene.updateMatrixWorld(true);
    expect(MK.mapMarkers()).toContainEqual({ x: 5, z: -3, kind: 'enemy' });
    b.visible = false;
    expect(MK.mapMarkers().map((m: any) => m.kind)).toEqual(['enemy']);
    offA();
    expect(MK.mapMarkers()).toEqual([]);
  });
  it('the game\'s mapView carries the player and the markers', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), setup: (ctx: any) => { const g = new THREE.Object3D(); g.position.set(10, 0, 10); ctx.scene.add(g); MK.addMapMarker(g, 'goal'); return []; } });
    game.scene.updateMatrixWorld(true);
    const v = game.mapView();
    expect(v.markers).toContainEqual({ x: 10, z: 10, kind: 'goal' });
    expect(Math.hypot(v.forward.x, v.forward.z)).toBeCloseTo(1);
    game.dispose();
  });
});

describe('🎯 objectives', () => {
  it('count up to their target, complete, announce, and the list knows when all are done', () => {
    const heard: string[] = [];
    const offs = ['QUEST_STARTED', 'QUEST_COMPLETED'].map((e) => EV.events.on(e, (p: any) => heard.push(e + ':' + p.id)));
    Q.objectives.set([{ id: 'coins', text: 'Collect coins', target: 3 }, { id: 'boss', text: 'Defeat the guard' }]);
    Q.objectives.progress('coins'); Q.objectives.progress('coins', 5);
    expect(Q.objectives.list.find((o: any) => o.id === 'coins')).toMatchObject({ progress: 3, done: true });
    expect(Q.objectives.allDone).toBe(false);
    Q.objectives.complete('boss');
    expect(Q.objectives.allDone).toBe(true);
    expect(STATE.state.questsCompleted).toEqual(expect.arrayContaining(['coins', 'boss']));
    expect(heard).toEqual(['QUEST_STARTED:coins', 'QUEST_STARTED:boss', 'QUEST_COMPLETED:coins', 'QUEST_COMPLETED:boss']);
    offs.forEach((o: () => void) => o());
  });
  it('the Hud lists them with progress and ticks', () => {
    Q.objectives.set([{ id: 'coins', text: 'Collect coins', target: 10 }, { id: 'boss', text: 'Defeat the guard' }]);
    Q.objectives.progress('coins', 4); Q.objectives.complete('boss');
    const html = renderToStaticMarkup(createElement(HUD.ObjectiveList));
    expect(html).toContain('aria-label="Objectives"');
    expect(html).toContain('• Collect coins 4/10');
    expect(html).toContain('✓ Defeat the guard');
    expect(renderToStaticMarkup(createElement(HUD.Minimap, { game: { minimapOption: false } }))).toBe('');
  });
});
