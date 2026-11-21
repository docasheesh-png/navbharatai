// A CAPTURED MOUSE IS OUR STATE, NOT THE APP'S DEFECT (failedbr #2485, Q-3231).
//
// The report: «COVERED "Full screen" (on the "Play" screen) — it cannot be pressed: something else on the screen is on top
// of it», the same for "Mute"; then a 115-second repair of a healthy HUD, undone. Reproduced on the real kit: pressing Play
// captures the mouse (pointer lock — every pointer event goes to the canvas until Esc), so the browser told our instrument
// the canvas "intercepts pointer events". A person presses Esc first. 🧬 THE CLASS: a state our own instrument put the page
// in, reported as the app's defect (the sibling of Q-3225, the port probe's 502s in the app's console).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  EXPLORE_RESULT_MARKER, MAX_SECOND_LEVEL_CLICKS, MAX_SECOND_LEVEL_PER_PARENT, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE,
  PROMISES_VIEW, THEME_CONTROL, MAX_THEME_PRESSES, MAX_PRIMED_RETRIES, clickExplorerModule, parseExploreOutput, summarizeExplore,
} from '../src/server/AgentV3/clickExplorer';
import { makeTempDir } from './helpers/tempDir';

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

it('the explorer releases a captured mouse before it calls a control covered', () => {
  const src = readFileSync(join(__dirname, '../src/server/AgentV3/clickExplorer.ts'), 'utf8');
  expect(src).toMatch(/if \(\/intercepts pointer events\/i\.test\(message\) && await releaseCapturedMouse\(page\)\) \{/);
  expect(src).toMatch(/document\.exitPointerLock\(\)/);
});

describe.skipIf(!haveBrowser)('in a real browser: a game that captures the mouse on Play', () => {
  let server: http.Server; let base = '';
  // The shape of the kit's own shell: Play starts the round and captures the mouse on the canvas; the HUD sits over it.
  const page = `<!doctype html><html><body style="margin:0">
<canvas id="c" width="800" height="500" style="position:fixed;inset:0;width:100%;height:100%;background:#234"></canvas>
<div id="start" style="position:fixed;left:40%;top:40%"><button id="play" style="font-size:24px;padding:16px 32px">Play</button></div>
<div id="hud" style="position:fixed;top:12px;right:12px;display:none;gap:8px">
  <button id="mute" style="width:48px;height:48px">Mute</button>
  <button id="pause" style="width:48px;height:48px">Pause</button>
  <span id="state">sound on</span>
</div>
<div id="really" style="position:fixed;left:12px;bottom:12px"><button id="boxed" style="width:120px;height:48px">Inventory</button><div style="position:absolute;inset:-8px;background:#0008"></div></div>
<script>
  const c = document.getElementById('c');
  document.getElementById('play').onclick = () => { document.getElementById('start').style.display = 'none'; document.getElementById('hud').style.display = 'flex'; c.requestPointerLock(); };
  document.getElementById('mute').onclick = () => { const s = document.getElementById('state'); s.textContent = s.textContent === 'sound on' ? 'sound off' : 'sound on'; };
  document.getElementById('pause').onclick = () => { document.getElementById('state').textContent = 'paused'; };
</script></body></html>`;
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('Mute and Pause behind a captured mouse are pressed and WORK; a control something really sits on is still covered', async () => {
    const dir = makeTempDir('nbai-pointer-lock-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base, marker: EXPLORE_RESULT_MARKER, maxClicks: 12, maxSecond: MAX_SECOND_LEVEL_CLICKS, perParent: MAX_SECOND_LEVEL_PER_PARENT, maxPrimed: MAX_PRIMED_RETRIES,
      budgetMs: 80_000, loadMs: 10_000, blockWrites: false,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
      themeSrc: THEME_CONTROL.source, themeFlags: THEME_CONTROL.flags, maxThemePresses: MAX_THEME_PRESSES,
      viewSrc: PROMISES_VIEW.source, viewFlags: PROMISES_VIEW.flags,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 110_000 }, (e, out) => (e ? rej(e) : res(out))));
    const run = parseExploreOutput(stdout);
    const by = Object.fromEntries(run.presses.map((p) => [p.label, p]));
    expect(by.Play?.verdict).toBe('ok');
    expect(by.Mute?.verdict, JSON.stringify(by.Mute)).toBe('ok');
    expect(by.Pause?.verdict, JSON.stringify(by.Pause)).toBe('ok');
    // …and the instrument has not gone blind: an element really on top of a control is still the app's defect.
    expect(by.Inventory?.verdict, JSON.stringify(by.Inventory)).toBe('covered');
    const verdict = summarizeExplore(run);
    expect(JSON.stringify(verdict.failures)).not.toMatch(/Mute|Pause/);
    expect(JSON.stringify(verdict.failures)).toMatch(/Inventory/);
  }, 130_000);
});
