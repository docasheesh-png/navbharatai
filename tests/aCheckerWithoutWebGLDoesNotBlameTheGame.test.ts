/**
 * 2026-11-19, builds 2439, 2440, 2441, 2471, 2476: every 3D game was scored "Game Quality 60–64 · Controls 0 · 0 fps ·
 * no canvas large enough to measure", and the report told the user "The controls do not move anything". The game
 * itself had rendered its own "3D graphics (WebGL) … Error creating WebGL context" screen INSIDE the playtest — the
 * checking browser had no WebGL. Two halves, both locked here:
 *   1. every platform browser in the sandbox asks for software WebGL (SANDBOX_BROWSER_ARGS), and the sandbox's runtime
 *      Playwright install is pinned to the image's version, so a newer browser that dropped the automatic software
 *      fallback cannot arrive unannounced;
 *   2. a checker without WebGL is reported as OUR checker not drawing 3D, never as the game ignoring its controls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { SANDBOX_BROWSER_ARGS, SANDBOX_PLAYWRIGHT_VERSION } from '../src/server/AgentV3/sandboxBrowserScript';
import { checkerLacksWebGL, gamePlaytestConfig, gamePlaytestModule, parsePlaytest, playtestVerdict, type PlaytestRun } from '../src/server/AgentV3/gamePlaytest';

const replay = { progress: true, restart: true };
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('every platform browser asks for software WebGL, from one place', () => {
  it('CENSUS: each chromium.launch the server writes passes SANDBOX_BROWSER_ARGS', () => {
    const launches = files('src/server').filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p))
      .flatMap((p) => readFileSync(p, 'utf8').split('\n').map((line, i) => ({ p, i: i + 1, line })))
      .filter(({ line }) => /chromium\.launch\(/.test(line) && !/^\s*(\/\/|\*)/.test(line));
    expect(launches.length).toBeGreaterThanOrEqual(9);
    // The playtest passes them through its config (cfg.browserArgs), which is built from the same constant.
    for (const l of launches) expect(l.line, `${l.p}:${l.i}`).toMatch(/SANDBOX_BROWSER_ARGS|cfg\.browserArgs/);
    expect(gamePlaytestConfig('http://x').browserArgs).toEqual([...SANDBOX_BROWSER_ARGS]);
    for (const flag of ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']) expect(SANDBOX_BROWSER_ARGS).toContain(flag);
  });
  it('the sandbox runs ONE Playwright version: both images and the runtime fallback install', () => {
    for (const f of ['infra/e2b/e2b.Dockerfile', 'infra/e2b/e2b-fullstack.Dockerfile']) {
      const pins = [...readFileSync(f, 'utf8').matchAll(/playwright@([0-9][^\s]*)/g)].map((m) => m[1]);
      expect(pins.length, f).toBeGreaterThan(0);
      for (const v of pins) expect(v, f).toBe(SANDBOX_PLAYWRIGHT_VERSION);
    }
    const actuator = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    expect(actuator).toContain('npm install playwright@${SANDBOX_PLAYWRIGHT_VERSION} --prefix');
    expect(actuator).not.toMatch(/`npm install playwright --prefix/);
  });
});

describe('a checker without WebGL does not blame the game', () => {
  const blind: PlaytestRun = { ok: true, webgl: false, fps: 0, spread: 22.9, brightness: 238, idle: 0, moves: [{ label: 'arrows', change: 0 }], errors: ['THREE.WebGLRenderer: Error creating WebGL context.'] };
  it('the report says our checker could not draw 3D — no score, no "controls do not move anything"', () => {
    expect(checkerLacksWebGL(blind)).toBe(true);
    const v = playtestVerdict(blind, replay);
    expect(v.code).toBe('GAME_PLAYTEST_NOT_RUN');
    expect(v.score).toBeNull();
    expect(v.message).toMatch(/could not create a WebGL context/);
    expect(v.message).toMatch(/NavBharatAI's checker, not the game/);
    expect(v.message).not.toMatch(/controls do not move/i);
  });
  it('also when the checker found no surface or produced no frames at all', () => {
    expect(checkerLacksWebGL({ ok: false, webgl: false, error: 'no game surface (canvas) on the page' })).toBe(true);
    expect(checkerLacksWebGL({ ok: true, webgl: false, fps: 0 })).toBe(true);
  });
  it('a 2D canvas game that drew frames without WebGL is still judged on its merits', () => {
    expect(checkerLacksWebGL({ ok: true, webgl: false, fps: 40 })).toBe(false);
  });
  it('a checker WITH WebGL, or an older script that never probed, is judged exactly as before', () => {
    expect(checkerLacksWebGL({ ...blind, webgl: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' })).toBe(false);
    expect(checkerLacksWebGL({ ...blind, webgl: undefined })).toBe(false);
    expect(playtestVerdict({ ...blind, webgl: 'SwiftShader' }, replay).code).toBe('GAME_PLAYTEST_ISSUES');
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const THREE_FILES: Record<string, string> = {
  '/three/three.module.js': 'node_modules/three/build/three.module.js',
  '/three/three.core.js': 'node_modules/three/build/three.core.js',
};
const haveBrowser = existsSync(PW) && existsSync(BROWSERS) && existsSync(THREE_FILES['/three/three.module.js']);
// What the kit's games do when WebGL is missing: show their own error screen instead of a canvas.
const PAGE = `<!doctype html><html><body style="margin:0;background:#f6f7fb"><script type="module">
import * as THREE from '/three/three.module.js';
try {
  const r = new THREE.WebGLRenderer(); r.setSize(innerWidth, innerHeight); document.body.appendChild(r.domElement);
  const s = new THREE.Scene(); s.background = new THREE.Color(0x336699); const c = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()); s.add(box); c.position.z = 3;
  addEventListener('keydown', () => { box.position.x += 0.2; });
  (function f() { box.rotation.y += 0.02; r.render(s, c); requestAnimationFrame(f); })();
} catch (e) { document.body.innerHTML = '<p>3D graphics (WebGL) failed. ' + e.message + '</p>'; console.error(String(e.message || e)); }
</script></body></html>`;

describe.skipIf(!haveBrowser)('in a real Chromium', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const path = (q.url ?? '/').split('?')[0];
      if (THREE_FILES[path]) { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end(readFileSync(THREE_FILES[path])); return; }
      r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE);
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/game`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));
  const play = async (browserArgs: readonly string[]): Promise<PlaytestRun> => {
    const file = join(makeTempDir('nbai-webgl-playtest-'), 'run.mjs');
    writeFileSync(file, gamePlaytestModule({ ...gamePlaytestConfig(base), browserArgs }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 170_000 }, (e, o) => (e ? rej(e) : res(o))));
    return parsePlaytest(stdout);
  };
  it('the shared launch flags give the playtest a working WebGL, and the 3D game is played', async () => {
    const run = await play(SANDBOX_BROWSER_ARGS);
    expect(typeof run.webgl).toBe('string');
    expect(playtestVerdict(run, replay).message).not.toMatch(/could not create a WebGL context/);
  }, 180_000);
  it('a browser without WebGL yields the honest "our checker" verdict, not "Controls 0"', async () => {
    const run = await play(['--no-sandbox', '--disable-webgl', '--disable-3d-apis']);
    expect(run.webgl).toBe(false);
    const v = playtestVerdict(run, replay);
    expect(v.code).toBe('GAME_PLAYTEST_NOT_RUN');
    expect(v.message).toMatch(/NavBharatAI's checker, not the game/);
  }, 180_000);
});
