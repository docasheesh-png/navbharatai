/**
 * Q-136: a state-routed app has no routes for the per-route page check to visit, so its screens are reached by
 * PRESSING them — the click explorer's job. But the explorer judged "blank" by the whole root, so a tab that
 * opened an empty main area under a painted nav passed: the Q-147 class (the frame judged as the page) in a third
 * lane. It now asks the one shared in-browser question (`MAIN_REGION_EMPTY_JS`) after each press, with the same
 * short grace the paint wait gives a screen that is still fetching.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir } from './helpers/tempDir';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  clickExplorerModule, parseExploreOutput, EXPLORE_RESULT_MARKER, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE,
  MAX_SECOND_LEVEL_CLICKS, MAX_SECOND_LEVEL_PER_PARENT,
} from '../src/server/AgentV3/clickExplorer';

describe('the explorer asks the shared question, never a private copy', () => {
  it('the module embeds MAIN_REGION_EMPTY_JS and the grace', () => {
    const mod = clickExplorerModule({ base: 'http://x/', marker: EXPLORE_RESULT_MARKER }, '');
    expect(mod).toContain("document.querySelector('main,[role=main]')");
    expect(mod).toContain("only the app's frame was left");
    const src = readFileSync('src/server/AgentV3/clickExplorer.ts', 'utf8');
    expect(src).toContain('(${MAIN_REGION_EMPTY_JS})()');
    expect(src).not.toMatch(/querySelector\('main,\[role=main\]'\)/);
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser: a state-routed app', () => {
  let server: http.Server;
  let base = '';
  const page = `<!doctype html><html lang="en"><head><title>t</title></head><body><div id="root">
<nav><button onclick="show('home')">Home</button><button onclick="show('orders')">Orders</button><button onclick="show('reports')">Reports</button></nav>
<main id="m"><h1>Home</h1><p>Welcome back</p></main>
</div><script>
function show(s) {
  var m = document.getElementById('m');
  m.innerHTML = '';
  if (s === 'home') m.innerHTML = '<h1>Home</h1><p>Welcome back</p>';
  // Orders loads its data: empty for 700 ms, then filled — a working screen.
  if (s === 'orders') setTimeout(function () { m.innerHTML = '<h1>Orders</h1><p>3 orders today</p>'; }, 700);
  // Reports was never written: its screen renders nothing at all.
}
</script></body></html>`;
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('a tab that fills late is ok; a tab that leaves only the frame is named', async () => {
    const dir = makeTempDir('nbai-explore-main-'); // removed after this file (Q-672)
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base, marker: EXPLORE_RESULT_MARKER, maxClicks: 12, maxSecond: MAX_SECOND_LEVEL_CLICKS, perParent: MAX_SECOND_LEVEL_PER_PARENT, budgetMs: 60_000, loadMs: 10_000, blockWrites: false,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const by = Object.fromEntries(parseExploreOutput(stdout).presses.filter((p) => !p.via).map((p) => [p.label, p]));
    expect(by.Orders.verdict).toBe('ok');
    expect(by.Home.verdict).toBe('ok');
    expect(by.Reports.verdict).toBe('blank');
    expect(by.Reports.note).toMatch(/only the app's frame was left/);
  }, 120_000);
});
