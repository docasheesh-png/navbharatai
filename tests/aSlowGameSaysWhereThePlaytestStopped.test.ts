// A GAME TOO HEAVY TO PLAY IN TIME SAYS WHERE THE PLAYTEST STOPPED — it never dies in silence (autopsy
// 61279465, 2026-11-04 — the 3D train simulator).
//
// The report said only "game-playtest timed out after 80000ms". The route's outer timeout killed the
// playtest's browser, so nothing it had measured survived: not the stage it reached, not the frame rate
// of the heavy scene that made it slow. The script now keeps its OWN deadline, inside the route's, and
// at that deadline it reports how far it got and how fast the page was drawing — a NOT RUN with a cause.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { gamePlaytestModule, gamePlaytestConfig, parsePlaytest, playtestVerdict, PLAYTEST_BUDGET_MS } from '../src/server/AgentV3/gamePlaytest';

// A canvas "game" whose every frame burns 250 ms of main thread — the shape of a heavy 3D scene on the
// sandbox's software renderer.
const HEAVY = `<!doctype html><html><body style="margin:0"><canvas id="c" style="width:100vw;height:100vh"></canvas><script>
const c = document.getElementById('c'); const g = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
let t = 0;
function frame() { const end = performance.now() + 250; while (performance.now() < end) { t++; }
  g.fillStyle = 'hsl(' + (t % 360) + ',60%,50%)'; g.fillRect(0, 0, c.width, c.height); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
</script></body></html>`;

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe('the playtest keeps its own deadline, inside the route\'s', () => {
  it('the deadline is handed to the script, and it is shorter than the route\'s timeout (budget + 20 s)', () => {
    const cfg = gamePlaytestConfig('http://127.0.0.1:5173');
    expect(cfg.budgetMs).toBe(PLAYTEST_BUDGET_MS);
    const src = gamePlaytestModule(cfg);
    expect(src).toMatch(/const watchdog = setTimeout\(/);
    expect(src).toMatch(/clearTimeout\(watchdog\)/);
    expect(src).toMatch(/ran out of time while/);
  });

  it('a partial run reads as NOT RUN — with the stage and the frame rate in the sentence, never as a pass', () => {
    const v = playtestVerdict(
      { ok: false, partial: true, stage: 'driving it with the keyboard', fps: 3, error: 'the playtest ran out of time while driving it with the keyboard (the page drew 3 frames per second)' },
      { progress: true, restart: true },
    );
    expect(v.code).toBe('GAME_PLAYTEST_NOT_RUN');
    expect(v.message).toContain('driving it with the keyboard');
    expect(v.message).toContain('3 frames per second');
    expect(v.score).toBeNull();
  });
});

describe.skipIf(!haveBrowser)('in a real browser: a scene too heavy to finish in time', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(HEAVY); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('stops itself at its deadline and reports the stage it reached', async () => {
    const dir = makeTempDir('nbai-playtest-slow-');
    const file = join(dir, 'run.mjs');
    const cfg = { ...gamePlaytestConfig(base + '/'), budgetMs: 10_000 };
    writeFileSync(file, gamePlaytestModule(cfg, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const t0 = Date.now();
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, o) => (e ? rej(e) : res(o))));
    const ms = Date.now() - t0;
    const run = parsePlaytest(stdout);
    expect(run.ok).toBe(false);
    expect(run.partial).toBe(true);
    expect(typeof run.stage).toBe('string');
    expect(run.error).toMatch(/ran out of time while /);
    expect(ms, 'the script must end at its own deadline, not run on until something kills it').toBeLessThan(40_000);
    expect(playtestVerdict(run, { progress: true, restart: true }).code).toBe('GAME_PLAYTEST_NOT_RUN');
  }, 120_000);
});
