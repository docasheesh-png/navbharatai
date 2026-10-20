// THE CAR IS SEEN FROM BEHIND, AND LEFT IS LEFT — on every path the kit offers (admin 2026-10-11,
// build 46e2d74b).
//
// The admin's report, verbatim: "ek bahut dangerous issue … racing game me car ulti chal rahi hai" — the
// player's car showed its HEADLIGHTS to the player instead of its tail lights, and pressing LEFT turned
// it RIGHT. "Every game built now does this."
//
// 🔑 THOSE ARE ONE DEFECT. Every model faces its local +Z (MODEL_FORWARD). A three.js camera at rest looks
// down −Z, and the rig's resting third-person offset sits at +Z of its target — IN FRONT of a +Z car. Seen
// face-on, the driver's left is the screen's right, so steering that is correct reads as mirrored. The
// kit map measured it on the kit's own update() camera: headlamps 5.56 m from the camera against tail
// lamps 9.50 m, and LEFT moving the car to NDC +0.2082 (screen-RIGHT).
//
// 🔑 THE CLASS: the right camera was OPT-IN. The 2026-10-05 fix added CameraRig.follow / ctx.follow /
// driveVehicle, but the DEFAULT stayed the front view: the 'chase' kind had no branch in update(), the
// shell fell back to rig.update() unless the game remembered ctx.follow(), and the kit's own examples
// recommended rig.update and never called ctx.follow. Its tests drove follow() only, so nothing ever
// looked at the other paths. These tests generate the kit, load it with the repo's real three.js, build a
// car with createCar, drive it with driveVehicle, and frame it through EVERY camera path a game can take
// for a vehicle — and the same for the siblings found on the way: on-foot camera-relative movement
// (cameraRelative), the motorcycle's lean, bars and wheel spin, and the phone's steering pads.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-car-from-behind-${process.pid}`);

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

// ── Measurements ─────────────────────────────────────────────────────────────────────────────────────
const HEADLAMP = 0xfff3d0;
const TAIL_LAMP = 0xd82b1e;
function lamps(car: THREE.Object3D): { head: THREE.Vector3; tail: THREE.Vector3 } {
  car.updateMatrixWorld(true);
  const pick = (hex: number) => {
    let p: THREE.Vector3 | null = null;
    car.traverse((x: any) => { if (!p && x.isMesh && x.material?.isMeshBasicMaterial && x.material.color.getHex() === hex) p = new THREE.Vector3().setFromMatrixPosition(x.matrixWorld); });
    if (!p) throw new Error('lamp not found: ' + hex.toString(16));
    return p as THREE.Vector3;
  };
  return { head: pick(HEADLAMP), tail: pick(TAIL_LAMP) };
}
/** Is the camera nearer the TAIL lamps than the headlamps? Returns both distances for the message. */
function seesTail(cam: THREE.Camera, car: THREE.Object3D) {
  const { head, tail } = lamps(car);
  const dHead = cam.position.distanceTo(head);
  const dTail = cam.position.distanceTo(tail);
  return { ok: dTail < dHead, why: `camera→tail ${dTail.toFixed(2)} m, camera→headlamps ${dHead.toFixed(2)} m` };
}
/** The car's screen x (NDC) through a FROZEN copy of the camera — where LEFT moved it on the screen. */
function frozen(cam: THREE.PerspectiveCamera): THREE.PerspectiveCamera {
  cam.updateMatrixWorld(true);
  const c = cam.clone();
  c.updateMatrixWorld(true);
  return c;
}
const ndcX = (cam: THREE.Camera, p: THREE.Vector3) => p.clone().project(cam).x;

const HEADINGS = [0, Math.PI / 2, Math.PI, -2.2];
const LEFT = { x: -1, y: 0 };   // the runtime's raw axis for ArrowLeft / A
const RIGHT = { x: 1, y: 0 };

/** A real car at a heading, with its vehicle state (which also marks it as a vehicle). */
function carAt(heading: number, detail: 'real' | 'lite' = 'real') {
  const car: THREE.Group = O.createCar({ detail });
  car.rotation.y = heading;
  const state = O.createVehicleState(car);
  return { car, state };
}

// Every way a game can point a CameraRig at a vehicle it drives.
type RigPath = { name: string; kind: string; frame: (rig: any, car: THREE.Object3D) => void };
const RIG_PATHS: RigPath[] = [
  { name: "'chase' kind, update(car)", kind: 'chase', frame: (rig, car) => rig.update(car, 1 / 60) },
  { name: "'chase' kind, update(car.position)", kind: 'chase', frame: (rig, car) => rig.update(car.position, 1 / 60) },
  { name: "default 'third-person', update(car.position) — the trap the prompt warned about", kind: 'third-person', frame: (rig, car) => rig.update(car.position, 1 / 60) },
  { name: "'orbit' kind, update(car.position)", kind: 'orbit', frame: (rig, car) => rig.update(car.position, 1 / 60) },
  { name: "'fixed' kind, update(car)", kind: 'fixed', frame: (rig, car) => rig.update(car, 1 / 60) },
  { name: 'follow(car)', kind: 'third-person', frame: (rig, car) => rig.follow(car, 1 / 60) },
];

describe('🔴 every camera path a game can take for a vehicle sees the TAIL lights', () => {
  for (const path of RIG_PATHS) {
    for (const heading of HEADINGS) {
      it(`${path.name} — heading ${heading.toFixed(2)}`, () => {
        const { car } = carAt(heading);
        const rig = new CAM.CameraRig({ kind: path.kind });
        for (let i = 0; i < 240; i++) path.frame(rig, car);
        rig.camera.updateMatrixWorld(true);
        const r = seesTail(rig.camera, car);
        expect(r.ok, `the camera is in FRONT of the car: ${r.why}`).toBe(true);
      });
    }
  }
});

describe('🔴 every camera path: LEFT moves the car to the LEFT of the screen, RIGHT to the right', () => {
  for (const path of RIG_PATHS) {
    for (const heading of [0, Math.PI, 1.0]) {
      it(`${path.name} — heading ${heading.toFixed(2)}`, () => {
        for (const [axis, sign] of [[LEFT, -1], [RIGHT, 1]] as const) {
          let { car, state } = carAt(heading, 'lite');
          const rig = new CAM.CameraRig({ kind: path.kind });
          for (let i = 0; i < 240; i++) path.frame(rig, car);
          const cam0 = frozen(rig.camera);
          const x0 = ndcX(cam0, car.position);
          for (let i = 0; i < 30; i++) { state = O.driveVehicle(car, state, axis, 1 / 60); path.frame(rig, car); }
          const x1 = ndcX(cam0, car.position);
          expect(Math.sign(x1 - x0), `${sign < 0 ? 'LEFT' : 'RIGHT'} moved the car to NDC ${x0.toFixed(4)} → ${x1.toFixed(4)}`).toBe(sign);
          expect(Math.abs(x1 - x0)).toBeGreaterThan(0.02);
        }
      });
    }
  }
});

describe('the rest of the rig, after the fix', () => {
  it("first-person in a vehicle looks out over the bonnet, not out of the rear window — and turns with it", () => {
    const { car } = carAt(0.7);
    let state = O.createVehicleState(car);
    const rig = new CAM.CameraRig({ kind: 'first-person' });
    rig.update(car.position, 1 / 60);
    rig.camera.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    const look = rig.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    expect(look.dot(fwd)).toBeGreaterThan(0.95);
    for (let i = 0; i < 30; i++) state = O.driveVehicle(car, state, LEFT, 1 / 60);
    rig.update(car, 1 / 60);
    rig.camera.updateMatrixWorld(true);
    const after = rig.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    // Turning LEFT rotates the view counter-clockwise seen from above: the new look is to the old one's left.
    expect(new THREE.Vector3().crossVectors(look, after).y).toBeGreaterThan(0);
  });

  it("a character ON FOOT is unchanged: the third-person camera still starts at +Z of a plain point", () => {
    const rig = new CAM.CameraRig({ kind: 'third-person' });
    const p = new THREE.Vector3(3, 0, -2);
    for (let i = 0; i < 240; i++) rig.update(p, 1 / 60);
    expect(rig.camera.position.z - p.z).toBeGreaterThan(5);
    expect(Math.abs(rig.camera.position.x - p.x)).toBeLessThan(0.01);
  });

  it("'top-down' and 'side-scroller' keep their genre's fixed view even for a vehicle", () => {
    const { car } = carAt(Math.PI / 2);
    for (const kind of ['top-down', 'side-scroller']) {
      const rig = new CAM.CameraRig({ kind });
      for (let i = 0; i < 240; i++) rig.update(car.position, 1 / 60);
      expect(rig.camera.position.z, kind).toBeGreaterThan(car.position.z);   // the fixed +Z offset, not a chase
    }
  });

  it("'chase' given a bare point (not a vehicle) chases the way it travels, and does not swing round when it reverses", () => {
    const rig = new CAM.CameraRig({ kind: 'chase' });
    const p = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 240; i++) { p.x += 0.1; rig.update(p, 1 / 60); }   // travelling +X
    expect(p.x - rig.camera.position.x, 'the camera trails the point').toBeGreaterThan(5);
    for (let i = 0; i < 120; i++) { p.x -= 0.05; rig.update(p, 1 / 60); }  // reversing
    expect(p.x - rig.camera.position.x, 'reversing must not swing the camera in front').toBeGreaterThan(5);
  });

  it('a CLONE of a car\'s position is just a point — only the live vector names the vehicle', () => {
    const { car } = carAt(0);
    expect(O.vehicleAt(car.position)).toBe(car);
    expect(O.vehicleAt(car.position.clone())).toBeNull();
    expect(O.isVehicle(car)).toBe(true);
    expect(O.isVehicle(O.createCar({ detail: 'lite' }))).toBe(false);
  });
});

// ── The game shell: the path the admin's games actually take ─────────────────────────────────────────
// The car starts PARKED, the way a race sits behind its "Start Race" screen: the game's update() drives it
// only once `race.go` is set. That matters for the proof — a car already moving drives AWAY from a camera
// left at the spawn point, which then ends up "behind" it by accident (found by reverting the fix: the
// first draft of these tests still passed with the shell's auto-follow removed).
interface ShellRun { game: any; car: THREE.Group; container: FakeEl; race: { go: boolean } }
function racingGame(opts: { camera?: string; follow?: boolean; touchControls?: unknown; heading?: number } = {}): ShellRun {
  const container = new FakeEl('div');
  const race = { go: false };
  let car!: THREE.Group;
  let drive: any;
  const game = new SHELL.Game({
    container,
    camera: opts.camera,
    touchControls: opts.touchControls,
    setup: (ctx: any) => {
      car = O.createCar({ detail: 'real' });
      car.rotation.y = opts.heading ?? 0;
      ctx.scene.add(car);
      drive = O.createVehicleState(car);
      if (opts.follow) ctx.follow(car);
      return [];
    },
    update: (ctx: any, dt: number) => { if (race.go) drive = O.driveVehicle(car, drive, ctx.input.axis(), dt); },
  });
  return { game, car, container, race };
}
const canvasOf = (g: any): FakeEl => g.canvas;
const key = (g: any, type: 'keydown' | 'keyup', code: string) => canvasOf(g).fire(type, { code, repeat: false });

/** The camera CHASES the car: behind it along the car's own heading, and within chase distance of it. */
function chasing(cam: THREE.Camera, car: THREE.Object3D) {
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  const rel = cam.position.clone().sub(car.getWorldPosition(new THREE.Vector3())).setY(0);
  return { ok: rel.dot(fwd) < -4 && rel.length() < 12, why: `camera ${rel.dot(fwd).toFixed(2)} m along the car's heading, ${rel.length().toFixed(2)} m away` };
}

// `fromFirstFrame`: the camera is behind the car even while it is PARKED behind a start screen — true
// whenever the game said so (camera: 'chase', or ctx.follow). With neither, the shell can only know the
// player's car once the player drives it (driveVehicle with ctx.input.axis()); before that, a car the
// game merely set up might be an opponent or a bus crossing the road, and must not take the camera from
// a player on foot.
const SHELL_PATHS = [
  { name: 'the shell with NO camera option and NO ctx.follow (what the admin\'s game was)', opts: {}, fromFirstFrame: false },
  { name: "the shell with camera: 'chase' and no ctx.follow", opts: { camera: 'chase' }, fromFirstFrame: true },
  { name: "the shell with camera: 'third-person' + ctx.follow(car) (the documented path)", opts: { camera: 'third-person', follow: true }, fromFirstFrame: true },
  { name: "the shell's own usage example: camera: 'chase' + ctx.follow(car)", opts: { camera: 'chase', follow: true }, fromFirstFrame: true },
];

describe('🔴 the GAME SHELL frames a driven car from behind, on every option a game can pass', () => {
  for (const path of SHELL_PATHS) {
    for (const heading of [0, Math.PI, -2.2]) {
      it(`${path.name} — heading ${heading.toFixed(2)}: tail lights toward the player${path.fromFirstFrame ? ', parked AND racing' : ' once racing'}`, () => {
        const { game, car, race } = racingGame({ ...path.opts, heading });
        game.loop.step(240);                       // the start screen: parked
        if (path.fromFirstFrame) {
          const r = seesTail(game.rig.camera, car);
          const c = chasing(game.rig.camera, car);
          expect(r.ok, `parked: ${r.why}`).toBe(true);
          expect(c.ok, `parked: ${c.why}`).toBe(true);
        }
        race.go = true;
        game.loop.step(240);                       // racing
        const r = seesTail(game.rig.camera, car);
        const c = chasing(game.rig.camera, car);
        expect(r.ok, `racing: ${r.why}`).toBe(true);
        expect(c.ok, `racing: ${c.why}`).toBe(true);
        game.dispose();
      });
    }

    it(`${path.name}: keyboard LEFT (ArrowLeft) goes screen-LEFT, RIGHT (KeyD) goes screen-RIGHT`, () => {
      for (const [code, sign] of [['ArrowLeft', -1], ['KeyD', 1]] as const) {
        const { game, car, race } = racingGame(path.opts);
        game.loop.step(60);                        // parked behind the start line
        race.go = true;
        game.loop.step(120);                       // racing straight, the camera settled behind
        const cam0 = frozen(game.rig.camera);
        const x0 = ndcX(cam0, car.position);
        key(game, 'keydown', code);
        game.loop.step(30);
        const x1 = ndcX(cam0, car.position);
        expect(Math.sign(x1 - x0), `${code}: NDC ${x0.toFixed(4)} → ${x1.toFixed(4)}`).toBe(sign);
        expect(Math.abs(x1 - x0)).toBeGreaterThan(0.02);
        game.dispose();
      }
    });
  }

  it('the on-foot hero is hidden while the shell chases the car the player drives', () => {
    const { game, race } = racingGame();
    race.go = true;
    game.loop.step(2);
    expect(game.hero.root.visible).toBe(false);
    game.dispose();
  });

  it('🔒 a car the GAME drives with its own axis (a bus crossing the road) never takes the camera from a player on foot', () => {
    const container = new FakeEl('div');
    let bus!: THREE.Group; let drive: any;
    const game = new SHELL.Game({
      container,
      setup: (ctx: any) => { bus = O.createCar({ detail: 'lite' }); bus.position.set(20, 0, -30); ctx.scene.add(bus); drive = O.createVehicleState(bus); return []; },
      update: (_ctx: any, dt: number) => { drive = O.driveVehicle(bus, drive, { x: 0, y: -1 }, dt); },   // the game's own AI axis
    });
    game.loop.step(240);
    // Still the on-foot view of the player at the origin: the resting +Z offset, hero visible, joystick up.
    expect(game.rig.camera.position.z).toBeGreaterThan(5);
    expect(Math.abs(game.rig.camera.position.x)).toBeLessThan(0.5);
    expect(game.hero.root.visible).toBe(true);
    expect(game.touch.layout).toBe('move');
    game.dispose();
  });

  it('with an opponent driven first, the camera still chases the car the PLAYER drives', () => {
    const container = new FakeEl('div');
    let mine!: THREE.Group; let rival!: THREE.Group; let a: any; let b: any;
    const game = new SHELL.Game({
      container,
      setup: (ctx: any) => {
        rival = O.createCar({ detail: 'real' }); rival.position.set(-6, 0, 0); ctx.scene.add(rival); a = O.createVehicleState(rival);
        mine = O.createCar({ detail: 'real' }); mine.position.set(6, 0, 0); ctx.scene.add(mine); b = O.createVehicleState(mine);
        return [];
      },
      update: (ctx: any, dt: number) => {
        a = O.driveVehicle(rival, a, { x: 0.3, y: -1 }, dt);          // the opponent's AI, driven first
        b = O.driveVehicle(mine, b, ctx.input.axis(), dt);            // the player's car
      },
    });
    game.loop.step(240);
    const c = chasing(game.rig.camera, mine);
    expect(c.ok, c.why).toBe(true);
    expect(seesTail(game.rig.camera, mine).ok).toBe(true);
    game.dispose();
  });

  // 🔒 Q-864 (found by 46e2d74b, admin 2026-10-12: "game wali rows bhi aap hi karo"). camera: 'chase' guessed
  // "the first vehicle given a state" — right for a one-car racer, wrong for a racer whose RIVAL got its state
  // first and for a walk-and-drive game with a PARKED car. The guess now stands down when it could be wrong.
  it("Q-864: camera 'chase' with a rival set up FIRST never chases the rival — the player's car takes the camera when driven", () => {
    const container = new FakeEl('div');
    const race = { go: false };
    let mine!: THREE.Group; let rival!: THREE.Group; let a: any; let b: any;
    const game = new SHELL.Game({
      container, camera: 'chase',
      setup: (ctx: any) => {
        rival = O.createCar({ detail: 'real' }); rival.position.set(-6, 0, 0); ctx.scene.add(rival); a = O.createVehicleState(rival);
        mine = O.createCar({ detail: 'real' }); mine.position.set(6, 0, 0); ctx.scene.add(mine); b = O.createVehicleState(mine);
        return [];
      },
      update: (ctx: any, dt: number) => {
        if (!race.go) return;                                         // the start screen: nothing driven yet
        a = O.driveVehicle(rival, a, { x: 0.3, y: -1 }, dt);
        b = O.driveVehicle(mine, b, ctx.input.axis(), dt);
      },
    });
    game.loop.step(240);
    expect(chasing(game.rig.camera, rival).ok, 'the rival must not be chased on the start screen').toBe(false);
    race.go = true;
    game.loop.step(240);
    const c = chasing(game.rig.camera, mine);
    expect(c.ok, c.why).toBe(true);
    game.dispose();
  });

  it("Q-864: camera 'chase' in a walk-and-drive game (it reads Use) frames the player ON FOOT, not the parked car", () => {
    const container = new FakeEl('div');
    let parked!: THREE.Group;
    const game = new SHELL.Game({
      container, camera: 'chase',
      setup: (ctx: any) => { parked = O.createCar({ detail: 'lite' }); parked.position.set(8, 0, 4); ctx.scene.add(parked); O.createVehicleState(parked); return []; },
      update: (ctx: any) => { ctx.input.wasPressed('interact'); },   // the Use button: get in / out of the car
    });
    game.loop.step(240);
    expect(chasing(game.rig.camera, parked).ok, 'the parked car must not be chased').toBe(false);
    expect(game.hero.root.visible).toBe(true);
    game.dispose();
  });

  it("Q-864: a ONE-car 'chase' game still has its car chased from the very first frame (the guess stands only when it cannot be wrong)", () => {
    const run = racingGame({ camera: 'chase' });
    run.game.loop.step(240);
    expect(chasing(run.game.rig.camera, run.car).ok).toBe(true);
    run.game.dispose();
  });

  it("the game's own choice wins: ctx.follow(null) puts the camera back on the player on foot", () => {
    const container = new FakeEl('div');
    let car!: THREE.Group; let drive: any;
    const game = new SHELL.Game({
      container,
      setup: (ctx: any) => { car = O.createCar({ detail: 'lite' }); ctx.scene.add(car); drive = O.createVehicleState(car); ctx.follow(null); return []; },
      update: (ctx: any, dt: number) => { drive = O.driveVehicle(car, drive, ctx.input.axis(), dt); },
    });
    game.loop.step(240);
    // Framing the player at the origin from its resting +Z offset — the old on-foot view, by choice.
    expect(game.rig.camera.position.z).toBeGreaterThan(5);
    expect(game.hero.root.visible).toBe(true);
    game.dispose();
  });

  // 🔒 'chase' ON FOOT WALKS STRAIGHT (verifier, 2026-10-11). The first version of this fix chased the
  // walking hero's own heading on foot. Walking is camera-relative, so every step turned the camera and the
  // camera turned the next step: holding S spun the hero on the spot (0.39 m in 3 s, heading −63 rad) and
  // D walked it in circles (1.18 m). On foot a 'chase' game frames the player like 'third-person'.
  for (const [what, hold] of [
    ['S (back)', (g: any) => key(g, 'keydown', 'KeyS')],
    ['D (right)', (g: any) => key(g, 'keydown', 'KeyD')],
    ['a joystick held a little off-centre', (g: any) => { g.input.setAnalogueMove(0.17, -0.98); }],
  ] as const) {
    it(`'chase' on foot (no vehicle at all): holding ${what} walks in a straight line, it does not spin`, () => {
      const game = new SHELL.Game({ container: new FakeEl('div'), camera: 'chase' });
      game.loop.step(30);
      const p0 = game.player.object.position.clone();
      hold(game);
      game.loop.step(60);
      const p1 = game.player.object.position.clone();
      game.loop.step(120);
      const p2 = game.player.object.position.clone();
      const first = p1.clone().sub(p0).setY(0);
      const rest = p2.clone().sub(p1).setY(0);
      expect(p2.clone().sub(p0).setY(0).length(), 'it got somewhere').toBeGreaterThan(10);
      expect(first.normalize().dot(rest.normalize()), 'the second and third seconds go the way the first did').toBeGreaterThan(0.95);
      game.dispose();
    });
  }
});

// ── The phone: a car gets pedals, and LEFT on the screen is LEFT on the keyboard ──────────────────────
describe('🔴 a driving game on a phone gets Left / Right / Brake / Gas, on the keyboard\'s own actions', () => {
  const pad = (container: FakeEl, label: string): FakeEl => {
    const b = container.all('nbg-tc-btn').find((x) => x.textContent === label);
    if (!b) throw new Error('no ' + label + ' pad');
    return b;
  };
  const touch = (pointerId: number) => ({ pointerId, clientX: 0, clientY: 0, pointerType: 'touch', preventDefault: () => {} });
  /** A race under way: the player's car is driving, so the shell knows it. */
  const racing = (opts: Parameters<typeof racingGame>[0] = {}) => { const run = racingGame(opts); run.race.go = true; run.game.loop.step(2); return run; };

  it('the shell switches to the drive layout by itself: from setup with camera \'chase\', on the first drive otherwise', () => {
    const declared = racingGame({ camera: 'chase' });
    expect(declared.game.touch.layout).toBe('drive');
    expect(declared.container.all('nbg-tc')[0].classList.contains('drive')).toBe(true);
    declared.game.dispose();
    const plain = racingGame();
    expect(plain.game.touch.layout).toBe('move');
    plain.race.go = true;
    plain.game.loop.step(1);
    expect(plain.game.touch.layout).toBe('drive');
    plain.game.dispose();
  });

  it("the Left pad gives exactly the axis.x the A key gives, and turns the car screen-LEFT", () => {
    const { game, car, container } = racing();
    game.loop.step(120);
    const cam0 = frozen(game.rig.camera);
    const x0 = ndcX(cam0, car.position);
    pad(container, 'Left').fire('pointerdown', touch(7));
    const fromPad = game.input.axis().x;
    game.loop.step(30);
    const x1 = ndcX(cam0, car.position);
    pad(container, 'Left').fire('pointerup', touch(7));
    key(game, 'keydown', 'KeyA');
    const fromKey = game.input.axis().x;
    expect(fromPad).toBe(-1);
    expect(fromPad).toBe(fromKey);
    expect(x1).toBeLessThan(x0 - 0.02);
    game.dispose();
  });

  it('Right is +1, Gas is up (W), Brake is down (S) — the same signs as the keys, so driveVehicle decides', () => {
    const { game, container } = racing();
    const cases: Array<[string, 'x' | 'y', number]> = [['Right', 'x', 1], ['Gas', 'y', -1], ['Brake', 'y', 1]];
    cases.forEach(([label, k, v], i) => {
      pad(container, label).fire('pointerdown', touch(20 + i));
      expect(game.input.axis()[k], label).toBe(v);
      pad(container, label).fire('pointerup', touch(20 + i));
      expect(game.input.axis()[k], label + ' released').toBe(0);
    });
    game.dispose();
  });

  it('a game that chose its own buttons keeps them; an on-foot game keeps the joystick', () => {
    const own = racing({ touchControls: { buttons: [{ action: 'up', label: 'Pedal' }] } });
    expect(own.game.touch.layout).toBe('move');
    own.game.dispose();
    const onFoot = new SHELL.Game({ container: new FakeEl('div') });
    onFoot.loop.step(5);
    expect(onFoot.touch.layout).toBe('move');
    onFoot.dispose();
  });

  it('switching layout releases whatever was held — a thumb on Left must not keep steering', () => {
    const { game, container } = racing();
    pad(container, 'Left').fire('pointerdown', touch(3));
    expect(game.input.axis().x).toBe(-1);
    game.touch.setLayout('move');
    expect(game.input.axis().x).toBe(0);
    game.dispose();
  });
});

describe('🔒 a game that reads Attack / Jump / Use / Run keeps them on a phone, in the car too (verifier, 2026-10-11)', () => {
  // An open-world game: walk to the car, Use (E) to get in, drive with the player's own axis, Use to get
  // out. The first version of the 'drive' layout hid the action buttons the moment the car was driven, so
  // a phone had no Use button and the player could never leave the car.
  it('the joystick and the Use button stay up while the player drives, and Use gets them out again', () => {
    const container = new FakeEl('div');
    let car!: THREE.Group; let drive: any; let inCar = false;
    const game = new SHELL.Game({
      container,
      setup: (ctx: any) => { car = O.createCar({ detail: 'lite' }); car.position.set(0, 0, 5); ctx.scene.add(car); return []; },
      update: (ctx: any, dt: number) => {
        if (ctx.input.wasPressed('interact')) { inCar = !inCar; if (inCar) { drive = O.createVehicleState(car); ctx.follow(car); } else ctx.follow(null); }
        if (inCar) drive = O.driveVehicle(car, drive, ctx.input.axis(), dt);
      },
    });
    const root = container.all('nbg-tc')[0];
    game.loop.step(10);
    key(game, 'keydown', 'KeyE'); game.loop.step(1); key(game, 'keyup', 'KeyE'); game.loop.step(30);
    expect(inCar).toBe(true);
    expect(game.rig.camera.position.distanceTo(car.position), 'the car is chased').toBeLessThan(12);
    expect(game.touch.layout, 'the joystick + Use layout stays').toBe('move');
    expect(root.classList.contains('drive'), 'the .drive class hides the action buttons').toBe(false);
    const use = container.all('nbg-tc-btn').find((b) => b.textContent === 'Use')!;
    use.fire('pointerdown', { pointerId: 9, clientX: 0, clientY: 0, pointerType: 'touch', preventDefault: () => {} });
    game.loop.step(1);
    use.fire('pointerup', { pointerId: 9, clientX: 0, clientY: 0, pointerType: 'touch', preventDefault: () => {} });
    game.loop.step(2);
    expect(inCar, 'the on-screen Use button got the player out').toBe(false);
    game.dispose();
  });

  it("the shell's own reads (Run, Jump for the walker) do not count — a plain racing game still gets the pedals", () => {
    const { game, race } = racingGame();
    race.go = true;
    game.loop.step(5);
    expect(game.touch.layout).toBe('drive');
    game.dispose();
  });
});

// ── K-5: on-foot movement is camera-relative at EVERY yaw, not only at 0 and π ────────────────────────
describe('🔴 on foot, W walks AWAY from the camera and D walks screen-RIGHT, however the camera is turned', () => {
  it('stays camera-relative DURING an orbit half-turn, including the first displayed frame', () => {
    const rig = new CAM.CameraRig({ kind: 'third-person' });
    const target = new THREE.Vector3();
    for (let i = 0; i < 120; i++) rig.update(target, 1 / 60);
    for (const yaw of [Math.PI, -Math.PI / 2, Math.PI / 2]) {
      rig.look(-yaw / 0.0025, 0);
      for (let frame = 0; frame < 60; frame++) {
        const fwd = rig.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        for (const [x, z, expected] of [[0, -1, fwd], [1, 0, right], [0, 1, fwd.clone().negate()], [-1, 0, right.clone().negate()]] as const) {
          const move = MOTOR.cameraRelative(x, z, rig.yaw);
          expect(new THREE.Vector3(move.x, 0, move.z).dot(expected), `frame ${frame}`).toBeGreaterThan(0.999);
        }
        rig.update(target, 1 / 60);
      }
    }
  });

  it('a chase target never shows its front during a respawn or a half-turn', () => {
    for (const make of ['createCar', 'createMotorcycle', 'createBicycle']) {
      const made = O[make]();
      const vehicle = made.root ?? made;
      const rig = new CAM.CameraRig({ kind: 'chase' });
      for (const heading of [0, Math.PI, -Math.PI / 2, Math.PI / 2]) {
        vehicle.rotation.y = heading;
        vehicle.position.set(20, 0, -40);
        for (let frame = 0; frame < 30; frame++) {
          rig.follow(vehicle, 1 / 60);
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.quaternion);
          expect(rig.camera.position.clone().sub(vehicle.position).dot(forward), `${make}, heading ${heading}, frame ${frame}`).toBeLessThan(0);
        }
      }
    }
  });

  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, -0.6, Math.PI]) {
    it(`camera yaw ${yaw.toFixed(3)}`, () => {
      const rig = new CAM.CameraRig({ kind: 'third-person' });
      rig.look(-yaw / 0.0025, 0);   // the real look() API: yaw −= dx · 0.0025
      const target = new THREE.Vector3();
      for (let i = 0; i < 600; i++) rig.update(target, 1 / 60);
      rig.camera.updateMatrixWorld(true);
      const fwd = rig.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const right = new THREE.Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 0).setY(0).normalize();
      const w = MOTOR.cameraRelative(0, -1, rig.yaw);   // W: axis.y = −1
      const d = MOTOR.cameraRelative(1, 0, rig.yaw);    // D: axis.x = +1
      expect(new THREE.Vector3(w.x, 0, w.z).dot(fwd), 'W must walk away from the camera').toBeGreaterThan(0.99);
      expect(new THREE.Vector3(d.x, 0, d.z).dot(right), 'D must walk to the right of the screen').toBeGreaterThan(0.99);
    });
  }
});

// ── K-6: a bike leans, steers and rolls the way it is going ─────────────────────────────────────────
describe('🔴 the motorcycle and the bicycle lean and steer to the RIDER\'s left on LEFT, and roll forwards', () => {
  for (const make of ['createMotorcycle', 'createBicycle'] as const) {
    it(`${make}: ride(LEFT) leans and turns the bars left (+X for a +Z bike); RIGHT the other way`, () => {
      for (const [axis, side] of [[LEFT, 1], [RIGHT, -1]] as const) {
        const bike = O[make]({ detail: 'real' });
        for (let i = 0; i < 60; i++) bike.ride(axis, 12, 1 / 60);
        bike.root.updateMatrixWorld(true);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bike.root.quaternion);
        const steer = bike.root.getObjectByName('steer');
        const wheelFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(steer.getWorldQuaternion(new THREE.Quaternion()));
        expect(Math.sign(up.x), 'lean').toBe(side);
        expect(Math.sign(wheelFwd.x), 'bars').toBe(side);
      }
    });

    it(`${make}: standing still it does not lean`, () => {
      const bike = O[make]({ detail: 'lite' });
      for (let i = 0; i < 60; i++) bike.ride(LEFT, 0, 1 / 60);
      expect(bike.root.rotation.z).toBe(0);
    });

    it(`${make}: rolling forward turns the top of each wheel FORWARD (+Z), and driveVehicle rolls BOTH wheels`, () => {
      const bike = O[make]({ detail: 'lite' });
      const wheels: THREE.Object3D[] = [];
      bike.root.traverse((o: THREE.Object3D) => { if (o.name === 'wheel') wheels.push(o); });
      expect(wheels).toHaveLength(2);
      bike.roll(5, 0.05);
      for (const w of wheels) {
        const top = new THREE.Vector3(0, 1, 0).applyEuler(w.rotation);
        expect(top.z, 'the top of a wheel moving forward goes forward').toBeGreaterThan(0);
      }
      const before = wheels.map((w) => w.rotation.x);
      let st = O.createVehicleState(bike.root);
      st = O.driveVehicle(bike.root, st, { x: 0, y: -1 }, 1 / 60);
      wheels.forEach((w, i) => expect(w.rotation.x, `wheel ${i} under driveVehicle`).toBeGreaterThan(before[i]));
    });
  }

  it("a car's road wheels keep the rate they always had (3.2 rad per metre)", () => {
    const car = O.createCar({ detail: 'lite' });
    const wheels = car.children.filter((c: THREE.Object3D) => c.name === 'wheel');
    expect(wheels).toHaveLength(4);
    O.rollWheels(car, 10, 0.1);
    for (const w of wheels) expect(w.rotation.x).toBeCloseTo(3.2, 6);
  });
});
