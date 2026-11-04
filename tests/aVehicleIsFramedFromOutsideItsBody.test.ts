// THE VEHICLE IS FRAMED FROM OUTSIDE ITS OWN BODY — whatever its size (admin 2026-11-04, train build
// 61279465-c87d-4c9e-b815-612ce03c9d25: "the third-person camera is positioned inside the train, and the
// train's front geometry blocks most of the player's view").
//
// 🔑 ROOT CAUSE. CameraRig.chaseFrom placed the chase camera a FIXED 7 m behind and 2.2 m above the
// vehicle's pivot. That is right for a 4.5 m car and INSIDE a 20 m locomotive (its body reaches 10 m
// behind the pivot), so the player saw the inside of the train. A sibling: the collision ray was cast
// against every collider INCLUDING the vehicle itself, so a game that listed its train as a collider
// pulled the camera into it even when the offset was big enough.
//
// 🧬 THE CLASS: the camera did not know the size of what it framed. These tests build vehicles of every
// size (car, bike, bus, aircraft, a locomotive, a 3-coach train), drive, turn, reverse and respawn them
// through the REAL generated camera.ts, and measure from geometry — never from a screenshot — that the
// camera is never inside the vehicle, sees the vehicle and the track ahead, and keeps doing so on a phone.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-train-from-outside-${process.pid}`);

// ── A DOM just big enough for the real shell and its real touch controls ─────────────────────────────
type Listener = (e: unknown) => void;
class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  type = '';
  tabIndex = -1;
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
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
  focus() { /* focused */ }
  getBoundingClientRect() { return { left: 0, top: 0, right: 844, bottom: 390, width: 844, height: 390 }; }
  getContext() { return { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }; }
  addEventListener(t: string, fn: Listener) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
  removeEventListener(t: string, fn: Listener) { this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn)); }
  fire(t: string, e: unknown) { for (const f of this.listeners.get(t) ?? []) f(e); }
  all(cls: string): FakeEl[] { return [...(this.classList.contains(cls) ? [this] : []), ...this.children.flatMap((c) => c.all(cls))]; }
}

// The shell's WebGL- and audio-facing layers are replaced by stand-ins; EVERYTHING that decides where the
// camera goes and which way the car turns is the real generated code: Game.ts, camera.ts, objects.ts,
// input.ts, touchControls.ts, character.ts, motor.ts, humanoid.ts.
const STUBS: Record<string, string> = {
  'src/game/three/renderer.ts':
    'export function createRenderer(): any { return { render() {}, dispose() {}, shadowMap: {} }; }\n'
    + 'export function handleResize(): () => void { return () => {}; }\n',
  'src/game/three/lighting.ts':
    "import * as THREE from 'three';\nexport type LightingPresetName = string;\n"
    + 'export interface AppliedLighting { key: THREE.DirectionalLight }\n'
    + 'export function applyLighting(scene: THREE.Scene): AppliedLighting { const key = new THREE.DirectionalLight(); scene.add(key); return { key }; }\n'
    + 'export function followShadow(): void {}\n',
  'src/game/core/loop.ts':
    'export class GameLoop {\n'
    + '  constructor(private readonly update: (dt: number) => void, private readonly render: (alpha: number, frameDelta: number) => void) {}\n'
    + '  start(): void {}\n  stop(): void {}\n  setPaused(): void {}\n'
    + '  step(n = 1, dt = 1 / 60): void { for (let i = 0; i < n; i++) { this.update(dt); this.render(1, dt); } }\n}\n',
  'src/game/core/meta.ts':
    'export function startMeta(): void {}\nexport function mountMetaToasts(): () => void { return () => {}; }\n'
    + 'export const combo = { update(): void {}, break(): void {} };\n',
  'src/game/fx/particles.ts': 'export class ParticleSystem { addTo(): void {} update(): void {} dispose(): void {} }\n',
  'src/game/fx/audio.ts': 'export const audio = { unlock(): void {}, setListener(): void {}, stopAll(): void {} };\n',
  'src/game/fx/feedback.ts': 'export function bindGameFeedback(): () => void { return () => {}; }\n',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let O: any; let CAM: any; let MOTOR: any; let SHELL: any;

beforeAll(async () => {
  (globalThis as any).document = { createElement: (t: string) => new FakeEl(t), addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
  (globalThis as any).window = Object.assign(new FakeEl('window'), { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: true }) });
  (globalThis as any).getComputedStyle = (el: FakeEl) => ({ position: el.style.position || 'static' });
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  for (const [p, c] of Object.entries(STUBS)) writeFileSync(join(DIR, p), c);
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  CAM = await import(join(DIR, 'src/game/three/camera.ts'));
  MOTOR = await import(join(DIR, 'src/game/play/motor.ts'));
  SHELL = await import(join(DIR, 'src/game/Game.ts'));
});
afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  for (const k of ['document', 'window', 'getComputedStyle']) delete (globalThis as any)[k];
});


/* eslint-enable @typescript-eslint/no-explicit-any */
const DT = 1 / 60;

/** A box part, double-sided so a ray from INSIDE it still reports the hit (the defect this file is about). */
function part(g: THREE.Group, w: number, h: number, l: number, x: number, y: number, z: number): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  g.add(m);
}
/** The build's train, to its own spec: a 20 x 3 x 4 m locomotive on 0.53 m rails, pivot at its centre, coaches behind (-Z). */
function train(coaches: number): THREE.Group {
  const g = new THREE.Group();
  part(g, 3, 4, 20, 0, 0.53 + 2, 0);
  for (let i = 0; i < coaches; i++) part(g, 3, 4, 22, 0, 0.53 + 2, -10 - 1 - 11 - i * 23);
  return g;
}
function bus(): THREE.Group { const g = new THREE.Group(); part(g, 2.5, 3.2, 12, 0, 1.9, 0); return g; }
function aircraft(): THREE.Group {
  const g = new THREE.Group();
  part(g, 2.2, 2.2, 12, 0, 1.6, 0);           // fuselage
  part(g, 14, 0.3, 2.5, 0, 1.6, 0.5);         // wings
  part(g, 0.3, 2.5, 1.8, 0, 3.2, -5.4);       // fin
  return g;
}

/** The object's extent in its own heading frame — computed HERE, independently of the rig under test. */
function localBox(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().compose(o.getWorldPosition(new THREE.Vector3()), o.getWorldQuaternion(new THREE.Quaternion()), new THREE.Vector3(1, 1, 1)).invert();
  const box = new THREE.Box3();
  o.traverse((x: any) => { if (x.isMesh) { x.geometry.computeBoundingBox(); box.union(x.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, x.matrixWorld))); } });
  return box;
}
function toLocal(o: THREE.Object3D, p: THREE.Vector3): THREE.Vector3 {
  return p.clone().sub(o.getWorldPosition(new THREE.Vector3())).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()).invert());
}
function inside(o: THREE.Object3D, p: THREE.Vector3, margin = 0): boolean { return localBox(o).expandByScalar(margin).containsPoint(toLocal(o, p)); }
function fwdOf(o: THREE.Object3D): THREE.Vector3 { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())); f.y = 0; return f.normalize(); }

/** Where the camera looks: is the point in its frustum (NDC inside the screen, in front of the camera)? */
function onScreen(cam: THREE.PerspectiveCamera, p: THREE.Vector3): boolean {
  cam.updateMatrixWorld(true);
  const v = p.clone().project(cam);
  return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
}
/** Is the line from the camera to `p` blocked by the vehicle's own body before it gets there? */
function blockedBy(cam: THREE.Camera, p: THREE.Vector3, o: THREE.Object3D): boolean {
  const dir = p.clone().sub(cam.position);
  const ray = new THREE.Raycaster(cam.position.clone(), dir.clone().normalize(), 0, dir.length() - 0.05);
  o.updateMatrixWorld(true);
  return ray.intersectObject(o, true).length > 0;
}
/** The fraction of a 9 x 9 grid of view rays whose first hit is the vehicle itself — how much of the screen it fills. */
function screenShare(cam: THREE.PerspectiveCamera, o: THREE.Object3D): number {
  cam.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let hits = 0;
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    ray.setFromCamera(new THREE.Vector2(-0.9 + i * 0.225, -0.9 + j * 0.225), cam);
    if (ray.intersectObject(o, true).length > 0) hits++;
  }
  return hits / 81;
}

function settle(rig: any, o: THREE.Object3D, frames = 180, frame: (rig: any, o: THREE.Object3D) => void = (r, x) => r.follow(x, DT)): void {
  for (let i = 0; i < frames; i++) { frame(rig, o); expect(inside(o, rig.camera.position), `frame ${i}: the camera is INSIDE the vehicle`).toBe(false); }
}

/** The acceptance view of a train: the locomotive, the first coach and the track ahead are all visible. */
function trainIsFramed(rig: any, t: THREE.Group, coaches: number): void {
  const cam: THREE.PerspectiveCamera = rig.camera;
  const pos = t.getWorldPosition(new THREE.Vector3());
  const f = fwdOf(t);
  const box = localBox(t);
  const loco = pos.clone().add(new THREE.Vector3(0, 2.5, 0));
  // The stretch right under the nose is hidden in ANY chase view; the camera promises the ground from 30 m on.
  const ahead = pos.clone().addScaledVector(f, box.max.z + 35).setY(0.53);
  expect(inside(t, cam.position, 0.2), 'the camera is inside the train').toBe(false);
  expect(onScreen(cam, loco), 'the locomotive is not on screen').toBe(true);
  expect(onScreen(cam, ahead), 'the track 35 m ahead of the train is not on screen').toBe(true);
  expect(blockedBy(cam, ahead, t), "the train's own body blocks the track ahead").toBe(false);
  if (coaches > 0) expect(onScreen(cam, pos.clone().addScaledVector(f, -22).setY(2.5)), 'the first coach is not on screen').toBe(true);
  expect(screenShare(cam, t), 'the train fills most of the screen').toBeLessThan(0.5);
}

describe('🚆 the reported build: a train is framed from OUTSIDE, with the track ahead in view', () => {
  for (const coaches of [0, 1, 3, 6]) {
    for (const heading of [0, Math.PI / 2, Math.PI, -2.2]) {
      it(`locomotive + ${coaches} coach(es), heading ${heading.toFixed(2)}`, () => {
        const t = train(coaches);
        t.rotation.y = heading;
        t.position.set(30, 0, -40);
        const rig = new CAM.CameraRig({ kind: 'chase' });
        settle(rig, t);
        trainIsFramed(rig, t, coaches);
      });
    }
  }

  it('a game that lists its own train among the camera colliders is NOT pulled into it (the sibling)', () => {
    const t = train(3);
    const rig = new CAM.CameraRig({ kind: 'chase', collidables: [t] });
    settle(rig, t);
    trainIsFramed(rig, t, 3);
  });

  it('a real obstacle behind the train still pulls the camera in front of it — and never into the train', () => {
    const t = train(1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.position.set(0, 10, -45);
    const rig = new CAM.CameraRig({ kind: 'chase', collidables: [t, wall] });
    settle(rig, t);
    expect(rig.camera.position.z, 'the camera went through the wall').toBeGreaterThan(-45);
  });

  it('accelerating, turning, reversing and braking: the camera never enters the train and stays behind it', () => {
    const t = train(3);
    const rig = new CAM.CameraRig({ kind: 'chase' });
    settle(rig, t, 60);
    let speed = 0;
    for (let i = 0; i < 900; i++) {
      const phase = Math.floor(i / 150);
      speed += [0.3, 0.3, 0, -0.5, -0.3, 0.2][phase] ?? 0;   // accelerate, cruise, brake, reverse, brake, go
      speed = Math.max(-8, Math.min(30, speed));
      if (phase === 1 || phase === 5) t.rotation.y += 0.004;   // a long curve
      t.position.addScaledVector(fwdOf(t), speed * DT);
      t.updateMatrixWorld(true);
      rig.update(t, DT);
      const c = rig.camera.position;
      expect([c.x, c.y, c.z].every(Number.isFinite), `frame ${i}: the camera position is not a number`).toBe(true);
      expect(inside(t, c), `frame ${i}: the camera is INSIDE the train`).toBe(false);
      expect(c.clone().sub(t.position).dot(fwdOf(t)), `frame ${i}: the camera swung in FRONT of the train`).toBeLessThan(0);
      expect(c.y, `frame ${i}: the camera is under the ground`).toBeGreaterThanOrEqual(0.5);
    }
    trainIsFramed(rig, t, 3);
  });

  it('a respawn far away is recovered on the next frame — no flight through the world, no frame inside the train', () => {
    const t = train(2);
    const rig = new CAM.CameraRig({ kind: 'chase' });
    settle(rig, t, 60);
    t.position.set(800, 0, 650);
    t.rotation.y = 1.3;
    rig.update(t, DT);
    trainIsFramed(rig, t, 2);
  });

  it('a camera that was put INSIDE the train (or at NaN) by game code is restored on the next frame', () => {
    const t = train(2);
    const rig = new CAM.CameraRig({ kind: 'chase' });
    settle(rig, t, 60);
    rig.camera.position.set(0, 2.5, -5);   // inside the locomotive, behind its pivot
    rig.update(t, DT);
    expect(inside(t, rig.camera.position)).toBe(false);
    rig.camera.position.set(NaN, NaN, NaN);
    rig.update(t, DT);
    trainIsFramed(rig, t, 2);
  });

  it('on a phone, portrait and landscape: the locomotive and the track ahead stay on screen', () => {
    for (const [w, h] of [[390, 844], [844, 390], [360, 780]]) {
      const t = train(3);
      const rig = new CAM.CameraRig({ kind: 'chase' });
      rig.camera.aspect = w / h;
      rig.camera.updateProjectionMatrix();
      settle(rig, t);
      trainIsFramed(rig, t, 3);
    }
  });

  it("'first-person' drives a long vehicle from its FRONT cab, not from inside its middle", () => {
    const t = train(3);
    O.createVehicleState(t);
    const rig = new CAM.CameraRig({ kind: 'first-person' });
    for (let i = 0; i < 30; i++) rig.update(t, DT);
    const local = toLocal(t, rig.camera.position);
    expect(local.z, `the driver's eye is ${local.z.toFixed(1)} m from the pivot of a locomotive whose nose is at +10 m`).toBeGreaterThan(7);
    const ahead = t.position.clone().addScaledVector(fwdOf(t), 40).setY(0.53);
    expect(onScreen(rig.camera, ahead), 'the track ahead is not visible from the cab').toBe(true);
  });

  it("'cinematic' circles the train from outside it, and setKind switches views at run time", () => {
    const t = train(3);
    const rig = new CAM.CameraRig({ kind: 'chase' });
    settle(rig, t, 60);
    rig.setKind('cinematic');
    expect(rig.currentKind).toBe('cinematic');
    settle(rig, t, 600, (r, x) => r.update(x, DT));
    expect(onScreen(rig.camera, t.position.clone().setY(2.5))).toBe(true);
    rig.setKind('chase');
    settle(rig, t, 120, (r, x) => r.update(x, DT));
    trainIsFramed(rig, t, 3);
  });
});

describe('🚗🚌🏍️✈️ every vehicle size is framed from outside, the vehicle and the way ahead on screen', () => {
  const MAKERS: Array<[string, () => THREE.Object3D]> = [
    ['car (createCar)', () => O.createCar({ detail: 'lite' })],
    ['bus (createBus)', () => O.createBus({ detail: 'lite' })],
    ['truck (createTruck)', () => O.createTruck({ detail: 'lite' })],
    ['motorcycle (createMotorcycle)', () => O.createMotorcycle({ detail: 'lite' }).root],
    ['hand-made bus', bus],
    ['aircraft', aircraft],
  ];
  for (const [name, make] of MAKERS) {
    for (const heading of [0, 2.4]) {
      it(`${name}, heading ${heading}`, () => {
        const v = make();
        v.rotation.y = heading;
        const rig = new CAM.CameraRig({ kind: 'chase' });
        settle(rig, v);
        const pos = v.getWorldPosition(new THREE.Vector3());
        const box = localBox(v);
        const ahead = pos.clone().addScaledVector(fwdOf(v), box.max.z + 35).setY(0.2);
        expect(onScreen(rig.camera, pos.clone().setY(box.max.y * 0.5)), 'the vehicle is not on screen').toBe(true);
        expect(onScreen(rig.camera, ahead), 'the way ahead is not on screen').toBe(true);
        expect(blockedBy(rig.camera, ahead, v), 'the vehicle blocks the way ahead').toBe(false);
        expect(screenShare(rig.camera, v), 'the vehicle fills most of the screen').toBeLessThan(0.5);
      });
    }
  }

  it("a car keeps exactly the chase distance it had before (the sizing only ever pushes OUT)", () => {
    const car = O.createCar({ detail: 'lite' });
    const rig = new CAM.CameraRig({ kind: 'chase' });
    settle(rig, car);
    const back = -toLocal(car, rig.camera.position).z;
    expect(back).toBeGreaterThan(6.9);
    expect(back).toBeLessThan(7.6);
  });
});

describe("the kit's two material vocabularies agree (autopsy 61279465: two TS2345 / one TS2820 heals)", () => {
  it("surfaceMaterial('glass') is real glass, and createHouse takes roof 'tile' as 'tiled'", async () => {
    const S = await import(join(DIR, 'src/game/three/surfaces.ts'));
    const glass = S.surfaceMaterial('glass');
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(0.6);
    expect(glass.roughness).toBeLessThan(0.2);
    expect(() => O.createHouse({ roof: 'tile', detail: 'lite' })).not.toThrow();
  });
});
