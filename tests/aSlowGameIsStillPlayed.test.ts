/**
 * 🧮 A SLOW GAME IS STILL PLAYED — the playtest's picture work never runs on the game's own page (Kadam 1, 2026-11-26).
 *
 * BR2539, BR2540, BR2542 and BR2545 (Gully Cricket 3D): "The game was never played — the playtest ran out of time while
 * driving it with the keyboard (the page drew 4–5 frames per second)". Measured on a 6 fps page: 7 picture compares took
 * 40.9 s of the 63 s keyboard stage, because each one decoded two 1280x720 PNGs INSIDE the game's page, behind every
 * frame the game drew. Then the phone stage's screenshots, at deviceScaleFactor 2, took 11–14 s each. A slow game
 * starved the very check that measures it.
 *
 * The class: "the playtest's own work waits on the game's main thread or the software renderer". Locked two ways:
 *   1. a census of the playtest script — every image decode runs on the bench page, never on the game's page;
 *   2. a real browser — a WebGL page the software renderer draws at ≈6 fps is played through the keyboard AND the phone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { gamePlaytestModule, gamePlaytestConfig, parsePlaytest } from '../src/server/AgentV3/gamePlaytest';

describe('census: no picture is decoded on the game page', () => {
  const src = gamePlaytestModule(gamePlaytestConfig('http://127.0.0.1:1/'), '');
  it('every createImageBitmap sits inside an evaluate on the bench page', () => {
    const at = [...src.matchAll(/createImageBitmap\(/g)].map((m) => m.index!);
    expect(at.length).toBeGreaterThanOrEqual(3);
    for (const i of at) {
      const before = src.slice(0, i);
      const ev = before.lastIndexOf('.evaluate(');
      expect(ev, 'a picture decode with no evaluate around it').toBeGreaterThan(0);
      expect(before.slice(Math.max(0, ev - 25), ev), `decode at ${i} runs on a page other than the bench`).toMatch(/\(await bench\([a-z]+\)\)$/);
    }
  });
  it('the phone context draws at deviceScaleFactor 1 (the layout is the same; a software renderer draws a quarter of the pixels)', () => {
    expect(src).toMatch(/isMobile: true, hasTouch: true, deviceScaleFactor: 1 \}/);
    expect(src).not.toMatch(/deviceScaleFactor: [2-9]/);
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const HAS_BROWSER = existsSync(PW) && existsSync(BROWSERS);

// A WebGL page whose fragment shader is heavy enough for the software renderer to draw ≈6 fps at 1280x720 — the Gully
// Cricket page. (A page that only burns its MAIN THREAD does not reproduce it: the measured starvation is the in-page
// picture decode queued behind the game's own frames in the software renderer.) Arrows / WASD move the picture.
const SLOW = `<!doctype html><html><body style="margin:0;overflow:hidden;background:#000">
<canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
<script>
const c = document.getElementById('c'); const g = c.getContext('webgl');
function size() { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; g.viewport(0, 0, c.width, c.height); }
size(); addEventListener('resize', size);
const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}';
const fs = 'precision highp float;uniform float t;uniform vec2 o;void main(){vec2 u=gl_FragCoord.xy/400.0+o;float a=0.0;for(int i=0;i<160;i++){a+=sin(u.x*float(i)*0.3+t)*cos(u.y*float(i)*0.2-t);}gl_FragColor=vec4(0.5+0.5*sin(a),0.5+0.5*cos(a+u.x),0.5,1);}';
function sh(k, s) { const x = g.createShader(k); g.shaderSource(x, s); g.compileShader(x); return x; }
const pr = g.createProgram(); g.attachShader(pr, sh(g.VERTEX_SHADER, vs)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(pr); g.useProgram(pr);
const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
const l = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 2, g.FLOAT, false, 0, 0);
const ut = g.getUniformLocation(pr, 't'), uo = g.getUniformLocation(pr, 'o'); let ox = 0, oy = 0; const keys = {};
addEventListener('keydown', (e) => (keys[e.code] = 1)); addEventListener('keyup', (e) => (keys[e.code] = 0));
function f(ts) {
  if (keys.ArrowUp || keys.KeyW) oy += 0.05; if (keys.ArrowLeft || keys.KeyA) ox -= 0.05; if (keys.ArrowRight || keys.KeyD) ox += 0.05;
  g.uniform1f(ut, ts / 1000); g.uniform2f(uo, ox, oy); g.drawArrays(g.TRIANGLES, 0, 3); requestAnimationFrame(f);
}
requestAnimationFrame(f);
</script></body></html>`;

describe.skipIf(!HAS_BROWSER)('🔴 a ≈6 fps game is played through the keyboard and the phone, inside the budget', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(SLOW); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('the run finishes: not partial, keyboard driven, phone checked', async () => {
    const cfg = { ...gamePlaytestConfig(base + '/'), proof: { dir: '' }, budgetMs: 90_000 };
    const file = join(makeTempDir('nbai-slow-playtest-'), 'run.mjs');
    writeFileSync(file, gamePlaytestModule(cfg, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 150_000, maxBuffer: 50e6 }, (e, o) => (e ? rej(e) : res(o))));
    const run = parsePlaytest(stdout) as any;
    // On a machine fast enough that this page is not slow, the run proves less — but it must still finish.
    if (!(run.fps <= 9)) console.warn(`aSlowGameIsStillPlayed: the fixture drew ${run.fps} fps here, so it is not slow on this machine`);
    expect(run.error ?? '', 'the playtest ran out of time').not.toMatch(/ran out of time/);
    expect(run.partial ?? false).toBe(false);
    expect(run.phoneChecked).toBe(true);
    expect(Array.isArray(run.moves) && run.moves.length).toBeGreaterThanOrEqual(5);
  }, 170_000);
});
