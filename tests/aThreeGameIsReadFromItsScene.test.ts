/**
 * Q-869 (found gating #3679, code from #3678): the playtest's camera and steering verdicts were read only from PIXEL
 * motion between frames, and under CPU load the same racing pages flipped their verdicts — a working countdown game
 * called stalled, a mirrored car missed. Pixels depend on how many frames a loaded machine draws. A three.js game's
 * scene does not: the vehicle's position and the camera's are state.
 *
 * So for a three.js game the playtest now reads the scene itself (three.js announces its renderer to
 * window.__THREE_DEVTOOLS__; wrapping render() hands over the scene and camera): which object the accelerator sped up
 * (not a traffic car that moves anyway), whether the camera follows it, whether the camera sits ahead of where it is
 * going, and which way LEFT turned it. Pixels judge only what the scene cannot say.
 *
 * These pages are real three.js (the repo's own `three`), rendered by the real playtest module in a real Chromium.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import {
  gamePlaytestModule, gamePlaytestConfig, parsePlaytest, playtestVerdict, sceneVerdict,
  CAMERA_FACES_VEHICLE_FIX, STEERING_MIRRORED_FIX, type PlaytestRun,
} from '../src/server/AgentV3/gamePlaytest';

/** A three.js racer. `cam`: behind the car, in front of it, or fixed; `treadmill`: the car stays and the world moves. */
function threeRacer(o: { cam: 'behind' | 'front' | 'fixed'; mirrored?: boolean; treadmill?: boolean }): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;overflow:hidden;background:#000"><script type="module">
import * as THREE from '/three/three.module.js';
const r = new THREE.WebGLRenderer({ antialias: false });
r.setSize(innerWidth, innerHeight); r.domElement.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none';
document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x88aacc);
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.4));
const tc = document.createElement('canvas'); tc.width = tc.height = 64; const g = tc.getContext('2d');
for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i * 7 + j * 3) % 5 < 2 ? '#3a7a3a' : '#2b5a2b'; g.fillRect(i * 8, j * 8, 8, 8); }
const tex = new THREE.CanvasTexture(tc); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(120, 120); tex.magFilter = THREE.NearestFilter;
const world = new THREE.Group(); scene.add(world);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ map: tex }));
ground.rotation.x = -Math.PI / 2; world.add(ground);
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 160; i++) {
  const h = 2 + rnd() * 10, post = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2), new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(rnd(), 0.4, 0.4) }));
  post.position.set((rnd() - 0.5) * 300, h / 2, (rnd() - 0.5) * 300); world.add(post);
}
const makeCar = (color) => { const c = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshLambertMaterial({ color })); b.position.y = 0.5; c.add(b); scene.add(c); return c; };
const car = makeCar(0xdd3333);
// Traffic that moves whatever the player presses — faster than the player, so it must not be taken for the vehicle.
const traffic = makeCar(0x3333dd); traffic.position.set(-40, 0, 20);
const held = new Set(); addEventListener('keydown', (e) => held.add(e.code)); addEventListener('keyup', (e) => held.delete(e.code));
let speed = 0, heading = 0;
function frame() {
  if (held.has('ArrowUp') || held.has('KeyW')) speed = Math.min(speed + 0.01, 0.3); else speed = Math.max(0, speed - 0.005);
  const turn = (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0) - (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0);
  heading += turn * 0.03 * ${o.mirrored ? -1 : 1};
  const fx = Math.sin(heading), fz = Math.cos(heading);
  ${o.treadmill ? 'world.position.x -= fx * speed; world.position.z -= fz * speed;' : 'car.position.x += fx * speed; car.position.z += fz * speed;'}
  car.rotation.y = heading;
  traffic.position.x += 0.5; if (traffic.position.x > 60) traffic.position.x = -60;
  ${o.cam === 'fixed'
    ? 'cam.position.set(0, 6, -12); cam.lookAt(0, 0, 6);'
    : `cam.position.set(car.position.x ${o.cam === 'front' ? '+' : '-'} fx * 10, 5, car.position.z ${o.cam === 'front' ? '+' : '-'} fz * 10); cam.lookAt(car.position.x, 0.5, car.position.z);`}
  r.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}

const PAGES: Record<string, string> = {
  '/three-chase': threeRacer({ cam: 'behind' }),
  '/three-front': threeRacer({ cam: 'front' }),
  '/three-mirrored': threeRacer({ cam: 'behind', mirrored: true }),
  '/three-treadmill': threeRacer({ cam: 'fixed', treadmill: true }),
};
const THREE_FILES: Record<string, string> = {
  '/three/three.module.js': 'node_modules/three/build/three.module.js',
  '/three/three.core.js': 'node_modules/three/build/three.core.js',
};

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS) && existsSync(THREE_FILES['/three/three.module.js']);
const DRIVING = { progress: true, restart: true, driving: true };

describe.skipIf(!haveBrowser)('a three.js racer is read from its own scene, in a real browser (Q-869)', () => {
  let server: http.Server;
  let base = '';
  const runs: Record<string, PlaytestRun> = {};
  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const path = (q.url ?? '/').split('?')[0];
      if (THREE_FILES[path]) { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end(readFileSync(THREE_FILES[path])); return; }
      const b = PAGES[path]; r.writeHead(b ? 200 : 404, { 'content-type': 'text/html' }); r.end(b ?? 'no');
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function play(path: string): Promise<PlaytestRun> {
    if (runs[path]) return runs[path];
    const file = join(makeTempDir('nbai-three-playtest-'), 'run.mjs');
    writeFileSync(file, gamePlaytestModule(gamePlaytestConfig(base + path), `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 170_000 }, (e, o) => (e ? rej(e) : res(o))));
    runs[path] = parsePlaytest(stdout);
    return runs[path];
  }

  it('a chase camera done right: the scene says the camera is BEHIND and LEFT turns left — no verdict', async () => {
    const run = await play('/three-chase');
    expect(run.ok).toBe(true);
    expect(sceneVerdict(run.scene)).toEqual({ faces: false, mirrored: false });
    const s = playtestVerdict(run, DRIVING).score!;
    expect([s.cameraFacesVehicle, s.steeringMirrored]).toEqual([undefined, undefined]);
  }, 200_000);

  it('🔒 a camera in FRONT of the car is read from the scene, and named', async () => {
    const run = await play('/three-front');
    expect(sceneVerdict(run.scene).faces).toBe(true);
    const v = playtestVerdict(run, DRIVING);
    expect(v.score!.cameraFacesVehicle).toBe(true);
    expect(v.message).toContain(CAMERA_FACES_VEHICLE_FIX);
  }, 200_000);

  it('🔒 mirrored steering is read from the scene, and named', async () => {
    const run = await play('/three-mirrored');
    expect(sceneVerdict(run.scene)).toEqual({ faces: false, mirrored: true });
    const v = playtestVerdict(run, DRIVING);
    expect(v.score!.steeringMirrored).toBe(true);
    expect(v.message).toContain(STEERING_MIRRORED_FIX);
  }, 200_000);

  it('🔒 precision: a fixed camera over a world that moves (not the car) gives the scene no say, and no verdict', async () => {
    const run = await play('/three-treadmill');
    expect(run.ok).toBe(true);
    expect(sceneVerdict(run.scene)).toEqual({ faces: null, mirrored: null });
    const s = playtestVerdict(run, DRIVING).score!;
    expect([s.cameraFacesVehicle, s.steeringMirrored]).toEqual([undefined, undefined]);
  }, 200_000);
});

describe('what the scene says (sceneVerdict, pure)', () => {
  it('judges only a vehicle that moved, with a camera that follows it', () => {
    expect(sceneVerdict({ moved: 3, follows: true, ahead: 0.95, looks: 0.98 })).toEqual({ faces: true, mirrored: null });
    expect(sceneVerdict({ moved: 3, follows: true, ahead: -0.97, looks: 0.98, turn: 14 })).toEqual({ faces: false, mirrored: false });
    expect(sceneVerdict({ moved: 3, follows: true, ahead: -0.97, looks: 0.98, turn: -14 })).toEqual({ faces: false, mirrored: true });
    expect(sceneVerdict({ moved: 3, follows: false, ahead: 0.95, looks: 0.98, turn: -14 })).toEqual({ faces: null, mirrored: null });
    expect(sceneVerdict({ moved: 0.05, follows: true, ahead: 0.95, looks: 0.98 })).toEqual({ faces: null, mirrored: null });
    expect(sceneVerdict({ moved: 3, follows: true, ahead: 0.1, looks: 0.98, turn: 2 })).toEqual({ faces: null, mirrored: null });
    expect(sceneVerdict(undefined)).toEqual({ faces: null, mirrored: null });
  });

  it('🔒 the scene outranks pixels, and pixels decide only what the scene could not', () => {
    const base: PlaytestRun = { ok: true, spread: 30, idle: 0.05, fps: 60, gas: 3, moves: [{ label: 'up / W', change: 2 }, { label: 'left / A', change: 2 }, { label: 'right / D', change: 2 }], touchControls: 4, touchIdle: 0.1, touch: 3, errorCount: 0 };
    const roadUp = { total: -12, pos: 0, neg: 9, pairs: 10, edge: 0, read: 30 };
    const behind = { moved: 3, follows: true, ahead: -0.97, looks: 0.98, turn: 12 };
    // Pixels alone said "faces the car"; the scene proves the camera is behind — no verdict.
    expect(playtestVerdict({ ...base, gasFlow: roadUp, scene: behind }, DRIVING).score!.cameraFacesVehicle).toBeUndefined();
    expect(playtestVerdict({ ...base, gasFlow: roadUp }, DRIVING).score!.cameraFacesVehicle).toBe(true);
    // No scene (a 2D canvas game): pixels judge as before.
    expect(playtestVerdict({ ...base, gasFlow: roadUp, scene: undefined }, DRIVING).score!.cameraFacesVehicle).toBe(true);
  });
});
