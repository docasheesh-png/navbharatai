// THE SHOOTER'S CAMERA KIT (Kadam 4, 2026-11-27) — measured on the REAL generated three/camera.ts, play/aim.ts and Game.ts.
//
// A reference third-person shooter's camera, compared with ours, did six things. An audit of the kit found three of them
// already there and working, and three missing:
//   (1) behind and above the hero — there (CameraRig third-person) — but OVER THE SHOULDER (≈0.6 m to the side, ≈3.7 m back)
//       was missing: the hero stood dead centre, under the crosshair, so the crosshair aimed through the hero's back;
//   (2) aim mode (closer ≈2.3 m, side 0.75, FOV × 0.82) was missing: the 'aim' action (right mouse / left trigger) existed in
//       DEFAULT_ACTIONS and nothing read it;
//   (3) wall collision — there (a ray from the head, pull in to hit − 0.3) — and it must keep working with the shoulder
//       offset, where the pivot itself can be inside the wall the hero leans on;
//   (4) never below the ground was missing on foot: only the vehicle views (keepClear) kept above the terrain, so looking up
//       or standing below a slope put the on-foot camera under the ground;
//   (5) freefall / parachute framing (farther and higher) was missing;
//   (6) the shot along the camera's centre ray — there (ctx.aim → aimFrom) — but the ray was searched from the CAMERA, so a
//       post between the camera and the hero (the shoulder makes that common) became the aim point and the shot fell back
//       to a direction that misses the crosshair. It now starts at the hero's own depth on that ray.
// Every built piece is on by itself for a game on the shell; these tests drive them through the kit, not a copy of it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-shooter-camera-${process.pid}`);

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
// WebGL, audio and the frame clock are stand-ins; the camera, the aim, the input and the shell are the real generated code.
const STUBS: Record<string, string> = {
  'src/game/three/renderer.ts':
    'export function createRenderer(): any { return { render() {}, dispose() {}, shadowMap: {}, getPixelRatio: () => 1, setPixelRatio() {} }; }\n'
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
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} burst(): void {} }\n',
  'src/game/fx/audio.ts': "export type SoundCategory = 'music' | 'sfx' | 'ui';\nexport const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {}, setVolume(): void {}, play(): () => void { return () => {}; }, playMusic(): void {}, stopMusic(): void {}, duckMusic(): void {} };\n",
};

let CAM: any; let SURF: any; let AIM: any; let SHELL: any;

beforeAll(async () => {
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  (globalThis as any).document = {
    createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false,
    querySelector: () => null,
  };
  (globalThis as any).window = Object.assign(new FakeEl('window'), { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
  (globalThis as any).getComputedStyle = (el: FakeEl) => ({ position: el.style.position || 'static' });
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  for (const [p, c] of Object.entries(STUBS)) writeFileSync(join(DIR, p), c);
  CAM = await import(join(DIR, 'src/game/three/camera.ts'));
  SURF = await import(join(DIR, 'src/game/three/surfaces.ts'));
  AIM = await import(join(DIR, 'src/game/play/aim.ts'));
  SHELL = await import(join(DIR, 'src/game/Game.ts'));
}, 60_000);
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle', 'localStorage']) delete (globalThis as any)[k];
});

const DT = 1 / 60;
const HERO = new THREE.Vector3(0, 0, 0);
function settle(rig: any, target: THREE.Vector3 = HERO, frames = 240): void { for (let i = 0; i < frames; i++) rig.update(target, DT); rig.camera.updateMatrixWorld(true); }
function box(min: [number, number, number], max: [number, number, number]): THREE.Mesh {
  const size = new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial());
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.updateMatrixWorld(true);
  return m;
}
function inside(p: THREE.Vector3, mesh: THREE.Mesh): boolean { return new THREE.Box3().setFromObject(mesh).containsPoint(p); }
/** Does the straight line from a to b pass through the box? (the camera may not see the hero THROUGH the wall) */
function crosses(a: THREE.Vector3, b: THREE.Vector3, mesh: THREE.Mesh): boolean {
  const r = new THREE.Ray(a.clone(), b.clone().sub(a).normalize());
  const hit = r.intersectBox(new THREE.Box3().setFromObject(mesh), new THREE.Vector3());
  return !!hit && hit.distanceTo(a) < a.distanceTo(b) - 1e-6;
}

describe('🎯 (1) over the shoulder: behind, above and to the right of the hero', () => {
  it('settles 3.7 m behind a pivot 0.6 m to the right, looking where the centred view looks; the hero is left of the crosshair', () => {
    const rig = new CAM.CameraRig({ shoulder: true });
    settle(rig);
    const f = rig.framing;
    expect(f).toMatchObject({ distance: 3.7, side: 0.6, height: 1.6, fov: 1, air: 'ground', aiming: false });
    const c = rig.camera.position;
    // Yaw 0 looks down −Z, so the view's right is +X and behind is +Z; the default pitch (−0.2) lifts it.
    expect(c.x).toBeCloseTo(0.6, 3);
    expect(c.z).toBeCloseTo(3.7 * Math.cos(-0.2), 3);
    expect(c.y).toBeCloseTo(1.6 + 3.7 * Math.sin(0.2), 3);
    const fwd = rig.camera.getWorldDirection(new THREE.Vector3());
    expect(fwd.x).toBeCloseTo(0, 3);
    expect(fwd.y).toBeCloseTo(-Math.sin(0.2), 3);
    const head = new THREE.Vector3(0, 1.6, 0).project(rig.camera);
    expect(head.x, 'the hero must stand LEFT of the crosshair, not under it').toBeLessThan(-0.05);
    expect(Math.abs(head.y)).toBeLessThan(0.05);
  });
  it('turns with the player: the shoulder stays on the view\'s right at any yaw, and side: -0.6 is the left shoulder', () => {
    for (const yaw of [0, 1.2, Math.PI, -2.3]) {
      for (const side of [0.6, -0.6]) {
        const rig = new CAM.CameraRig({ shoulder: { side } });
        rig.look(-yaw / 0.0025, 0);
        settle(rig);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rig.camera.quaternion);
        const rel = rig.camera.position.clone().sub(new THREE.Vector3(0, 1.6, 0));
        expect(rel.dot(right), `yaw ${yaw} side ${side}`).toBeCloseTo(side, 2);
      }
    }
  });
  it('without the shoulder the centred view is exactly what it was: 7 m, 2.2 m, looking at the head', () => {
    const rig = new CAM.CameraRig();
    settle(rig);
    expect(rig.framing).toMatchObject({ distance: 7, side: 0, height: 2.2, fov: 1 });
    expect(rig.camera.position.x).toBeCloseTo(0, 6);
    expect(rig.camera.position.distanceTo(new THREE.Vector3(0, 2.2, 0))).toBeCloseTo(7, 4);
  });
});

describe('🔭 (2) aim mode: closer, further to the side, a narrower view — damped, and given back exactly', () => {
  it('Aim moves to 2.3 m / 0.75 m / FOV × 0.82 over a few frames, never in one jump; letting go returns to 60°', () => {
    const rig = new CAM.CameraRig({ shoulder: true });
    settle(rig);
    expect(rig.camera.fov).toBe(60);
    rig.setAiming(true);
    rig.update(HERO, DT);
    const first = rig.framing;
    expect(first.distance).toBeLessThan(3.7);
    expect(first.distance, 'one frame must not snap the whole way').toBeGreaterThan(3.0);
    settle(rig, HERO, 120);
    expect(rig.framing).toMatchObject({ distance: 2.3, side: 0.75, fov: 0.82, aiming: true });
    expect(rig.camera.fov).toBeCloseTo(60 * 0.82, 6);
    expect(rig.camera.position.distanceTo(new THREE.Vector3(0.75, 1.6, 0))).toBeCloseTo(2.3, 3);
    rig.setAiming(false);
    settle(rig, HERO, 120);
    expect(rig.camera.fov).toBe(60);
    expect(rig.framing).toMatchObject({ distance: 3.7, side: 0.6, aiming: false });
  });
  it('the scope zoom and the aim share one field of view: 4x while aiming is 60 × 0.82 ÷ 4, and both off is 60 again', () => {
    const rig = new CAM.CameraRig({ shoulder: true });
    settle(rig);
    rig.setAiming(true); rig.setZoom(4);
    settle(rig, HERO, 120);
    expect(rig.camera.fov).toBeCloseTo(60 * 0.82 / 4, 6);
    rig.setAiming(false); rig.setZoom(1);
    settle(rig, HERO, 120);
    expect(rig.camera.fov).toBe(60);
  });
  it('a game\'s own camera.fov stands while neither aim nor zoom is in use, and is what aim narrows', () => {
    const rig = new CAM.CameraRig({ shoulder: true });
    rig.camera.fov = 75;
    settle(rig);
    expect(rig.camera.fov).toBe(75);
    rig.setAiming(true); settle(rig, HERO, 120);
    expect(rig.camera.fov).toBeCloseTo(75 * 0.82, 6);
    rig.setAiming(false); settle(rig, HERO, 120);
    expect(rig.camera.fov).toBe(75);
  });
  it('no aim without the shoulder framing (a platformer\'s right click changes nothing)', () => {
    const rig = new CAM.CameraRig();
    settle(rig);
    rig.setAiming(true); settle(rig, HERO, 60);
    expect(rig.framing).toMatchObject({ distance: 7, aiming: false, fov: 1 });
    expect(rig.camera.fov).toBe(60);
  });
});

describe('🧱 (3) a wall never has the camera inside it — with the shoulder offset too', () => {
  it('a wall the hero leans on at the RIGHT (the shoulder pivot is inside it): the camera stays on the hero\'s side', () => {
    const wall = box([0.45, 0, -5], [1.45, 5, 10]);
    const rig = new CAM.CameraRig({ shoulder: true });
    rig.setCollidables([wall]);
    const focus = new THREE.Vector3(0, 1.6, 0);
    for (const aim of [false, true]) {
      rig.setAiming(aim);
      for (let i = 0; i < 240; i++) {
        rig.update(HERO, DT);
        const c = rig.camera.position;
        expect(inside(c, wall), `frame ${i}${aim ? ' aiming' : ''}: camera inside the wall at ${c.toArray().map((v) => v.toFixed(2))}`).toBe(false);
        expect(crosses(focus, c, wall), `frame ${i}: the hero is seen through the wall`).toBe(false);
      }
    }
    expect(rig.camera.position.x).toBeLessThan(0.45);
  });
  it('a wall behind the hero pulls the camera in front of it, 0.3 m short of the hit along the ray', () => {
    const wall = box([-10, 0, 2], [10, 6, 3]);
    const rig = new CAM.CameraRig({ shoulder: true });
    rig.setCollidables([wall]);
    settle(rig);
    const c = rig.camera.position;
    expect(c.z).toBeLessThan(2);
    expect(inside(c, wall)).toBe(false);
    // The pulled-in camera sits on the ray from the head to where it wanted to be.
    const focus = new THREE.Vector3(0, 1.6, 0);
    const wanted = new THREE.Vector3(0.6, 1.6 + 3.7 * Math.sin(0.2), 3.7 * Math.cos(0.2));
    const dir = wanted.clone().sub(focus).normalize();
    const hitT = (2 - focus.z) / dir.z;
    expect(c.distanceTo(focus)).toBeCloseTo(hitT - CAM.CAMERA_WALL_GAP, 2);
  });
});

describe('🌍 (4) the on-foot camera never goes under the ground', () => {
  afterAll(() => SURF.setGround(null));
  it('looking up on flat ground keeps the camera 0.4 m above it (it went to y ≈ −1)', () => {
    SURF.setGround(() => 0);
    const rig = new CAM.CameraRig({ shoulder: true });
    rig.look(0, -400);   // pitch −0.2 → +0.8: the view looks up, the offset swings low behind the hero
    for (let i = 0; i < 240; i++) {
      rig.update(HERO, DT);
      expect(rig.camera.position.y, `frame ${i}`).toBeGreaterThanOrEqual(CAM.CAMERA_GROUND_GAP - 1e-9);
    }
    expect(rig.camera.position.y).toBeCloseTo(0.4, 6);
  });
  it('a slope rising behind the hero: above the terrain under the camera, centred view and shoulder alike', () => {
    SURF.setGround((_x: number, z: number) => Math.max(0, z) * 0.9);
    for (const shoulder of [false, true]) {
      const rig = new CAM.CameraRig({ shoulder });
      settle(rig);
      const c = rig.camera.position;
      expect(c.y, `shoulder ${shoulder}`).toBeGreaterThanOrEqual(Math.max(0, c.z) * 0.9 + 0.4 - 1e-9);
    }
  });
  it('a world with no ground (space, a floored arena) is not clamped to y = 0', () => {
    SURF.setGround(null);
    const rig = new CAM.CameraRig({ shoulder: true });
    rig.look(0, -400);
    const deep = new THREE.Vector3(0, -50, 0);
    settle(rig, deep);
    expect(rig.camera.position.y).toBeLessThan(-49);
  });
});

describe('🪂 (5) a long fall is framed farther and higher; a jump is not', () => {
  function fall(rig: any, speed: number, seconds: number, from: THREE.Vector3, grounded: boolean | null = false): THREE.Vector3 {
    const p = from.clone();
    for (let t = 0; t < seconds; t += DT) { p.y -= speed * DT; if (grounded !== null) rig.setGrounded(grounded); rig.update(p, DT); }
    return p;
  }
  it('freefall: +4 m back, +1.5 m up; a parachute: +2.5 m, +1 m; landing: back to the walking view', () => {
    const rig = new CAM.CameraRig({ shoulder: true });
    let p = new THREE.Vector3(0, 300, 0);
    rig.setGrounded(true); settle(rig, p, 30);
    p = fall(rig, 40, 1.5, p);
    expect(rig.framing).toMatchObject({ air: 'freefall', distance: 7.7, height: 3.1, side: 0 });
    expect(rig.camera.position.distanceTo(p.clone().add(new THREE.Vector3(0, 3.1, 0)))).toBeCloseTo(7.7, 1);
    p = fall(rig, 4, 2, p);
    expect(rig.framing).toMatchObject({ air: 'parachute', distance: 6.2, height: 2.6 });
    rig.setGrounded(true); settle(rig, p, 120);
    expect(rig.framing).toMatchObject({ air: 'ground', distance: 3.7, height: 1.6, side: 0.6 });
  });
  it('a jump (up 7 m/s, gravity 20) and a run down a slope never leave the walking framing', () => {
    const rig = new CAM.CameraRig({ shoulder: true });
    const p = new THREE.Vector3(0, 0, 0);
    rig.setGrounded(true); settle(rig, p, 30);
    let vy = 7;
    for (let i = 0; i < 60; i++) { vy -= 20 * DT; p.y = Math.max(0, p.y + vy * DT); rig.setGrounded(p.y === 0 && i > 0); rig.update(p, DT); expect(rig.framing.air, `jump frame ${i}`).toBe('ground'); }
    for (let i = 0; i < 240; i++) { p.y -= 3 * DT; rig.setGrounded(true); rig.update(p, DT); expect(rig.framing.air).toBe('ground'); }
  });
  it('a game that never says grounded (a hand-moved drop) still gets the freefall framing; a teleport is not a fall', () => {
    const rig = new CAM.CameraRig();
    let p = new THREE.Vector3(0, 300, 0);
    settle(rig, p, 10);
    p = fall(rig, 30, 1, p, null);
    expect(rig.framing.air).toBe('freefall');
    const respawn = new THREE.Vector3(0, 0, 0);
    rig.update(respawn, DT);
    expect(rig.framing.air).toBe('ground');
  });
  it('a game can force it (forceAirMode) and turn it off (air: false)', () => {
    const rig = new CAM.CameraRig({ shoulder: true });
    rig.forceAirMode('parachute'); settle(rig);
    expect(rig.framing).toMatchObject({ air: 'parachute', distance: 6.2 });
    rig.forceAirMode(null); settle(rig);
    expect(rig.framing.air).toBe('ground');
    const off = new CAM.CameraRig({ air: false });
    let p = new THREE.Vector3(0, 300, 0);
    settle(off, p, 10);
    p = fall(off, 30, 1.5, p);
    expect(off.framing.distance).toBe(7);
  });
});

describe('🎯 (6) the shot leaves along the crosshair from IN FRONT of the hero', () => {
  function shooterCamera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    cam.position.set(0.6, 2.3, 3.7);
    cam.lookAt(0.6, 2.3, -10);
    cam.updateMatrixWorld(true);
    return cam;
  }
  it('a post between the over-the-shoulder camera and the hero is not the aim point — the enemy ahead is', () => {
    const scene = new THREE.Scene();
    const hero = new THREE.Group(); scene.add(hero);
    const post = box([0.3, 1.5, 1.8], [0.9, 3, 2.2]); post.name = 'post'; scene.add(post);
    const enemy = box([0, 0, -12], [1.2, 3, -11]); enemy.name = 'enemy'; scene.add(enemy);
    const a = AIM.aimFrom(shooterCamera(), scene, { body: hero, own: [hero] });
    expect(a.hit?.name).toBe('enemy');
    expect(a.point.z).toBeCloseTo(-11, 3);
    // The bullet goes from the gun to that point — where the crosshair is.
    expect(a.shot.z).toBeLessThan(-0.9);
  });
  it('anything at or past the hero is still hit: an enemy one metre in front, and in first person a post at arm\'s length', () => {
    const scene = new THREE.Scene();
    const hero = new THREE.Group(); scene.add(hero);
    const near = box([0.2, 1.5, -1.2], [1.0, 3, -0.8]); near.name = 'near'; scene.add(near);
    expect(AIM.aimFrom(shooterCamera(), scene, { body: hero, own: [hero] }).hit?.name).toBe('near');
    const eye = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    eye.position.set(0, 1.6, 0); eye.lookAt(0, 1.6, -10); eye.updateMatrixWorld(true);
    const arm = box([-0.3, 1.2, -0.9], [0.3, 2, -0.5]); arm.name = 'arm'; scene.add(arm);
    expect(AIM.aimFrom(eye, scene, { body: hero, own: [hero] }).hit?.name).toBe('arm');
  });
  it('aimNear is the hero\'s chest depth on the ray less the margin; 0.05 with no body or top-down', () => {
    const hero = new THREE.Group();
    const near = AIM.aimNear(new THREE.Vector3(0, 1.4, 4), new THREE.Vector3(0, 0, -1), hero, null);
    expect(near).toBeCloseTo(4 - AIM.HERO_DEPTH_MARGIN, 6);
    expect(AIM.aimNear(new THREE.Vector3(0, 1.4, 4), new THREE.Vector3(0, 0, -1), null, null)).toBe(0.05);
    expect(AIM.aimNear(new THREE.Vector3(0, 1.4, 4), new THREE.Vector3(0, 0, -1), hero, 0)).toBe(0.05);
  });
});

describe('🎮 the shell wires it by itself: a hero with a gun gets the shoulder camera and Aim', () => {
  it('holding a pistol: over the shoulder; Aim held moves in and narrows; let go and it comes back', () => {
    const game = new SHELL.Game({ container: new FakeEl('div'), player: { holds: { right: 'pistol' } }, setup: () => [] });
    game.start();
    game.loop.step(120);
    expect(game.rig.framing).toMatchObject({ side: 0.6, distance: 3.7, aiming: false });
    const base = game.rig.camera.fov;
    game.input.setVirtualButton('aim', true);
    game.loop.step(120);
    expect(game.rig.framing).toMatchObject({ aiming: true, distance: 2.3, side: 0.75 });
    expect(game.rig.camera.fov).toBeCloseTo(base * 0.82, 6);
    game.input.setVirtualButton('aim', false);
    game.loop.step(120);
    expect(game.rig.framing).toMatchObject({ aiming: false, distance: 3.7 });
    expect(game.rig.camera.fov).toBe(base);
    game.dispose();
  });
  it('no gun: the centred view, and Aim does nothing; shoulderCamera: false / an object override the default', () => {
    const bare = new SHELL.Game({ container: new FakeEl('div'), setup: () => [] });
    bare.start(); bare.input.setVirtualButton('aim', true); bare.loop.step(60);
    expect(bare.rig.framing).toMatchObject({ side: 0, aiming: false, fov: 1 });
    bare.dispose();
    const off = new SHELL.Game({ container: new FakeEl('div'), player: { holds: { right: 'pistol' } }, shoulderCamera: false, setup: () => [] });
    off.start(); off.loop.step(30);
    expect(off.rig.framing.side).toBe(0);
    off.dispose();
    const left = new SHELL.Game({ container: new FakeEl('div'), shoulderCamera: { side: -0.6 }, setup: () => [] });
    left.start(); left.loop.step(30);
    expect(left.rig.framing.side).toBe(-0.6);
    left.dispose();
  });
});
