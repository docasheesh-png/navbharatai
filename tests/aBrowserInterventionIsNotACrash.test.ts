// A BROWSER INTERVENTION IS NOT A CRASH (admin 2026-11-20, game audit 2, item #4; failedbr #2477). A game that scored
// 86 — answering up / W, left / A, right / D, Space and a drag — was called "the game was played and is not playable
// (runtime error)" because Chrome logged "Unable to preventDefault inside passive event listener invocation": the
// browser declining one call, after which the game ran on. It is now recorded apart and becomes a SOFT finding with
// its exact fix (on a phone the page can scroll under the thumb), never a runtime error and never "not playable".
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { gamePlaytestModule, gamePlaytestConfig, parsePlaytest, playtestDefects, scorePlaytest, BROWSER_INTERVENTION, type PlaytestRun } from '../src/server/AgentV3/gamePlaytest';
import { gameIncompleteReason, gameRepairPrompt } from '../src/server/AgentV3/gameRepair';

const REPORTED = 'Unable to preventDefault inside passive event listener invocation.';

describe('🧭 the classification', () => {
  it('🔴 the exact message from build #2477 is a soft finding with its fix — not a runtime error, not "not playable"', () => {
    const run: PlaytestRun = { ok: true, errorCount: 0, errors: [], interventions: [REPORTED] } as PlaytestRun;
    const defects = playtestDefects(run, null);
    expect(defects.map((d) => d.code)).toEqual(['GAME_DEFECT_TOUCH_SCROLLS']);
    expect(defects[0].evidence).toMatch(/passive: false|touch-action: none/);
    expect(gameIncompleteReason(defects, [])).toBeNull();
    expect(gameRepairPrompt('make a game', defects, [])).toMatch(/GAME_DEFECT_TOUCH_SCROLLS: .*\{ passive: false \}/);
  });
  it('a real uncaught error is still a runtime error and still blocks', () => {
    const run = { ok: true, errorCount: 1, errors: ['player.velocity is undefined'] } as PlaytestRun;
    expect(playtestDefects(run, null).map((d) => d.code)).toContain('GAME_DEFECT_RUNTIME_ERROR');
    expect(gameIncompleteReason(playtestDefects(run, null), [])).toMatch(/runtime error/);
  });
  it('the pattern matches the browser\'s wording (with or without the [Intervention] tag), and nothing ordinary', () => {
    expect(BROWSER_INTERVENTION.test(REPORTED)).toBe(true);
    expect(BROWSER_INTERVENTION.test('[Intervention] Ignored attempt to cancel a touchmove event')).toBe(true);
    expect(BROWSER_INTERVENTION.test('TypeError: Cannot read properties of undefined')).toBe(false);
  });
});

/** A small canvas game. Each flag removes one thing a real game needs. */
function game(o: { keys?: boolean; pointer?: boolean; crashOnMove?: boolean; interveneOnMove?: boolean; still?: boolean; blank?: boolean }): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#000"><canvas id="c" style="display:block;width:100vw;height:100vh;touch-action:none"></canvas><script>
const c = document.getElementById('c'); const g = c.getContext('2d');
const fit = () => { c.width = innerWidth; c.height = innerHeight; }; fit(); addEventListener('resize', fit);
let x = 0.5, y = 0.5, t = 0, vx = 0, vy = 0;
${o.keys ? `const held = new Set(); addEventListener('keydown', (e) => held.add(e.code)); addEventListener('keyup', (e) => held.delete(e.code));` : 'const held = new Set();'}
${o.pointer ? `let drag = null; c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointermove', (e) => { if (!drag) return; x += (e.clientX - drag.x) / innerWidth; y += (e.clientY - drag.y) / innerHeight; drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });` : ''}
function frame() {
  t += 1 / 60;
  vx = (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0) - (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0);
  vy = (held.has('ArrowDown') || held.has('KeyS') ? 1 : 0) - (held.has('ArrowUp') || held.has('KeyW') ? 1 : 0);
  if (held.has('Space')) y -= 0.02;
  ${o.crashOnMove ? `if (vx || vy) { throw new Error('player.velocity is undefined'); }` : ''}
  ${o.interveneOnMove ? `if ((vx || vy) && !window.__said) { window.__said = true; console.error('[Intervention] Unable to preventDefault inside passive event listener invocation.'); }` : ''}
  x = Math.min(0.95, Math.max(0.05, x + vx * 0.012)); y = Math.min(0.95, Math.max(0.05, y + vy * 0.012));
  ${o.blank ? `g.fillStyle = '#123'; g.fillRect(0, 0, c.width, c.height);` : `
  const sky = g.createLinearGradient(0, 0, 0, c.height); sky.addColorStop(0, '#5aa0e6'); sky.addColorStop(1, '#2f6b2f');
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; const cx = ${o.still ? '0.3' : '((t * 0.08) % 1.2) - 0.1'} * c.width; g.beginPath(); g.arc(cx, c.height * 0.2, 60, 0, 7); g.fill();
  g.fillStyle = '#d33'; g.fillRect(x * c.width - 60, y * c.height - 60, 120, 120);`}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}


const PAGES: Record<string, string> = { '/intervenes': game({ keys: true, pointer: true, interveneOnMove: true }) };
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('🔴 in a real browser: a working game that triggers an intervention', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((q, r) => { const b = PAGES[(q.url ?? '/').split('?')[0]]; r.writeHead(b ? 200 : 404, { 'content-type': 'text/html' }); r.end(b ?? 'no'); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('is recorded as an intervention, counts as no error, keeps "Stable" at 100, and is not called unplayable', async () => {
    const dir = makeTempDir('nbai-intervention-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, gamePlaytestModule(gamePlaytestConfig(base + '/intervenes'), `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 120_000 }, (e, o) => (e ? rej(e) : res(o))));
    const run = parsePlaytest(stdout);
    expect(run.ok).toBe(true);
    expect(run.interventions?.[0]).toMatch(/passive event listener/);
    expect(run.errorCount).toBe(0);
    const score = scorePlaytest(run, { progress: true, restart: true } as never);
    expect(score.dimensions.stable).toBe(100);
    const defects = playtestDefects(run, score);
    expect(defects.map((d) => d.code)).toContain('GAME_DEFECT_TOUCH_SCROLLS');
    expect(defects.map((d) => d.code)).not.toContain('GAME_DEFECT_RUNTIME_ERROR');
    expect(gameIncompleteReason(defects, [])).toBeNull();
  }, 150_000);
});
