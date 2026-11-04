// A CAMERA INSIDE THE VEHICLE IS CAUGHT BY PLAYING THE GAME — whoever wrote the camera (autopsy 61279465,
// 2026-11-04 — the 3D train simulator).
//
// The kit's CameraRig is now sized by the vehicle (aVehicleIsFramedFromOutsideItsBody.test.ts), but a game
// that writes its own camera never reaches that fix. The reported build's view was the inside of its own
// locomotive, and no check could have said so. The playtest now asks the game's own scene, while it drives,
// whether the camera sits inside the vehicle's geometry — tested per mesh in that mesh's own space.
//
// Real three.js (the repo's own `three`), the real playtest module, a real Chromium.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { gamePlaytestModule, gamePlaytestConfig, parsePlaytest, playtestVerdict, playtestDefects, scorePlaytest, replayFromCode, CAMERA_INSIDE_VEHICLE_FIX, type PlaytestRun } from '../src/server/AgentV3/gamePlaytest';

/** A train game: a 20 m locomotive + one 22 m coach, pivot at the loco's centre, a hand-written chase camera. */
function trainGame(cam: 'fixed-7m' | 'sized'): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;overflow:hidden;background:#000"><script type="module">
import * as THREE from '/three/three.module.js';
const r = new THREE.WebGLRenderer({ antialias: false });
r.setSize(innerWidth, innerHeight); r.domElement.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none';
document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x88aacc);
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 800);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.4));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0x3a7a3a }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 160; i++) { const h = 2 + rnd() * 10, p = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2), new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(rnd(), 0.4, 0.4) })); p.position.set((rnd() - 0.5) * 300, h / 2, (rnd() - 0.5) * 600); scene.add(p); }
const train = new THREE.Group(); scene.add(train);
const side = THREE.DoubleSide;
const loco = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 20), new THREE.MeshLambertMaterial({ color: 0xcc3333, side })); loco.position.y = 2.5; train.add(loco);
const coach = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 22), new THREE.MeshLambertMaterial({ color: 0x3355cc, side })); coach.position.set(0, 2.5, -22); train.add(coach);
const held = new Set(); addEventListener('keydown', (e) => held.add(e.code)); addEventListener('keyup', (e) => held.delete(e.code));
let speed = 0, heading = 0;
function frame() {
  if (held.has('ArrowUp') || held.has('KeyW')) speed = Math.min(speed + 0.01, 0.3); else speed = Math.max(0, speed - 0.005);
  heading += ((held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0) - (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0)) * 0.02;
  const fx = Math.sin(heading), fz = Math.cos(heading);
  train.position.x += fx * speed; train.position.z += fz * speed; train.rotation.y = heading;
  const back = ${cam === 'sized' ? '45' : '7'}, up = ${cam === 'sized' ? '12' : '2.2'};
  cam.position.set(train.position.x - fx * back, up, train.position.z - fz * back);
  cam.lookAt(train.position.x + fx * 30, 1, train.position.z + fz * 30);
  r.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}

const PAGES: Record<string, string> = { '/inside': trainGame('fixed-7m'), '/outside': trainGame('sized') };
const THREE_FILES: Record<string, string> = {
  '/three/three.module.js': 'node_modules/three/build/three.module.js',
  '/three/three.core.js': 'node_modules/three/build/three.core.js',
};
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS) && existsSync(THREE_FILES['/three/three.module.js']);
const DRIVING = { progress: true, restart: true, driving: true };

describe('the score reads the measurement — pure', () => {
  const base: PlaytestRun = { ok: true, spread: 30, idle: 1, fps: 60, moves: [{ label: 'up / W', change: 5 }, { label: 'left / A', change: 5 }, { label: 'Space', change: 5 }], touch: 5, touchIdle: 0, errorCount: 0 };
  it('a camera inside the vehicle is a camera defect, with its own fix and the measured size', () => {
    const run = { ...base, cameraInside: [3, 4, 20] };
    const s = scorePlaytest(run, DRIVING);
    expect(s.cameraInsideVehicle).toBe(true);
    const v = playtestVerdict(run, DRIVING);
    expect(v.code).toBe('GAME_PLAYTEST_ISSUES');
    expect(v.message).toContain(CAMERA_INSIDE_VEHICLE_FIX);
    expect(v.message).toContain('3 × 4 × 20 m');
    expect(playtestDefects(run, s, []).map((d) => d.code)).toContain('GAME_DEFECT_CAMERA_WRONG');
  });
  it('a cockpit game is not flagged: inside the vehicle IS its view', () => {
    const cockpit = replayFromCode({ 'src/game/Drive.ts': "const rig = new CameraRig({ kind: 'first-person' }); const state = driveVehicle(car, s, axis, dt);" });
    expect(cockpit.cockpit).toBe(true);
    expect(scorePlaytest({ ...base, cameraInside: [3, 4, 20] }, cockpit).cameraInsideVehicle).toBeUndefined();
  });
  it('not a driving game: never read', () => {
    expect(scorePlaytest({ ...base, cameraInside: [3, 4, 20] }, { progress: true, restart: true }).cameraInsideVehicle).toBeUndefined();
  });
});

describe.skipIf(!haveBrowser)('in a real browser: a hand-written train camera, inside and outside the train', () => {
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
    const file = join(makeTempDir('nbai-train-playtest-'), 'run.mjs');
    writeFileSync(file, gamePlaytestModule(gamePlaytestConfig(base + path), `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 170_000 }, (e, o) => (e ? rej(e) : res(o))));
    runs[path] = parsePlaytest(stdout);
    return runs[path];
  }

  it('THE REPORTED CAMERA (7 m back, 2.2 m up, inside a 20 m locomotive) is measured as inside the train', async () => {
    const run = await play('/inside');
    expect(run.ok, JSON.stringify(run).slice(0, 300)).toBe(true);
    expect(run.cameraInside).toEqual([3, 4, 20]);
    expect(playtestVerdict(run, DRIVING).message).toContain(CAMERA_INSIDE_VEHICLE_FIX);
  }, 200_000);

  it('the same game with a camera sized to the train is not flagged', async () => {
    const run = await play('/outside');
    expect(run.ok).toBe(true);
    expect(run.cameraInside).toBeUndefined();
    expect(scorePlaytest(run, DRIVING).cameraInsideVehicle).toBeUndefined();
  }, 200_000);
});
