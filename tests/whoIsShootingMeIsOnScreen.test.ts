// 🎯 WHO IS SHOOTING ME IS ON SCREEN (Kadam 4, 2026-11-26). The reference game's first complaint was "goli kaun maar raha
// pata nahi" — and the kit had nothing that answered it: no marker over an enemy, no arrow toward the attacker. Entities now
// draws both by itself (ENEMY_MARKERS): a red ▼ with the distance over every hostile in front of the camera (yellow while it
// attacks), and an arrow at the screen edge toward each attack that lands. Runs the REAL generated kit with real three.js
// and a minimal DOM.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';

const DIR = join(__dirname, `.tmp-enemy-markers-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let E: any; let C: any;
class El {
  children: El[] = []; parentElement: El | null = null; style: any = { position: 'static' }; attrs: Record<string, string> = {}; textContent = '';
  clientWidth = 800; clientHeight = 600;
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  appendChild(c: El) { c.parentElement = this; this.children.push(c); return c; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); this.parentElement = null; }
}
const body = new El();
beforeAll(async () => {
  (globalThis as any).window = { addEventListener: () => {} };
  (globalThis as any).document = { body, createElement: () => new El() };
  (globalThis as any).getComputedStyle = (e: El) => e.style;
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
  C = await import(join(DIR, 'src/game/systems/combat.ts'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); for (const k of ['window', 'document', 'getComputedStyle']) delete (globalThis as any)[k]; });

/** A camera at the player, looking down −Z (the way a third-person camera behind a +Z… here simply toward −Z). */
const cam = () => { const c = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 500); c.position.set(0, 2, 0); c.lookAt(0, 2, -10); c.updateMatrixWorld(true); return c; };
const host = (camera: THREE.Camera) => { const scene = new THREE.Scene(); const player = { object: new THREE.Object3D() }; scene.add(player.object); const canvas = new El(); body.appendChild(canvas); return { scene, player, onStep: () => () => {}, camera, renderer: { domElement: canvas as any } }; };

describe('🎯 the pure pieces', () => {
  it('screenPoint: in front → on screen; behind → null', () => {
    const c = cam();
    expect(E.screenPoint(c, new THREE.Vector3(0, 2, -10), 800, 600)).toEqual({ x: 400, y: 300 });
    expect(E.screenPoint(c, new THREE.Vector3(0, 2, 10), 800, 600)).toBe(null);
  });
  it('threatAngle: ahead 0, right +π/2, left −π/2, behind ±π', () => {
    const c = cam(); const me = new THREE.Vector3(0, 0, 0);
    expect(E.threatAngle(c, me, new THREE.Vector3(0, 0, -5))).toBeCloseTo(0, 5);
    expect(E.threatAngle(c, me, new THREE.Vector3(5, 0, 0))).toBeCloseTo(Math.PI / 2, 5);    // looking −Z, +X is on the right
    expect(E.threatAngle(c, me, new THREE.Vector3(-5, 0, 0))).toBeCloseTo(-Math.PI / 2, 5);
    expect(Math.abs(E.threatAngle(c, me, new THREE.Vector3(0, 0, 5)))).toBeCloseTo(Math.PI, 5);
  });
});

describe('🎯 Entities draws them by itself', () => {
  it('a hostile in front gets a red ▼ with its distance; one behind gets none; an attack shows an arrow toward it', () => {
    const c = cam(); const h = host(c);
    const playerHealth = new C.Health({ max: 100 });
    const crowd = new E.Entities(h, { playerHealth, attackGraceSeconds: 0 });
    crowd.spawn({ x: 0, z: -12, kind: 'enemy' });
    crowd.spawn({ x: 0, z: 30, kind: 'enemy' });
    crowd.update(1 / 30);
    const layer = h.renderer.domElement.parentElement!.children.find((x: El) => 'data-nb-enemy-markers' in x.attrs)!;
    expect(layer).toBeTruthy();
    expect(layer.children.length).toBe(1);
    expect(layer.children[0].textContent).toMatch(/^▼ 1[12] m$/);
    expect(layer.children[0].style.color).toBe('#ff3b3b');
    // Close in until it attacks (a fresh crowd at arm's length, grace 0): the arrow appears, pointing ahead (angle ≈ 0).
    const near = new E.Entities(host(c), { playerHealth, attackGraceSeconds: 0 });
    near.spawn({ x: 0, z: -1, kind: 'enemy' });
    for (let i = 0; i < 90; i++) near.update(1 / 30);
    const nl = (near as any).overlay as El;
    const arrow = nl.children.find((x) => 'data-nb-threat' in x.attrs);
    expect(arrow, 'an attack that landed shows where it came from').toBeTruthy();
    expect(Math.abs(Number(arrow!.attrs['data-nb-threat']))).toBeLessThan(0.3);
    crowd.dispose(); near.dispose();
    expect(layer.parentElement).toBe(null);
  });
  it('markers: false, or no camera, draws nothing', () => {
    const c = cam(); const h = host(c);
    const off = new E.Entities(h, { markers: false }); off.spawn({ x: 0, z: -12, kind: 'enemy' }); off.update(1 / 30);
    expect((off as any).overlay).toBe(null);
    const noCam = new E.Entities({ scene: new THREE.Scene(), player: { object: new THREE.Object3D() }, onStep: () => () => {} }); noCam.spawn({ x: 0, z: -12, kind: 'enemy' }); noCam.update(1 / 30);
    expect((noCam as any).overlay).toBe(null);
    off.dispose(); noCam.dispose();
  });
});
