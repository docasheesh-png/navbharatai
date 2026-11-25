/**
 * 🕒 A PLAYTEST THAT RUNS OUT OF TIME SAYS WHERE THE TIME WENT (failedbr BR2514–BR2519, 2026-11-24).
 *
 * Six games in a row: "The game was never played — the playtest ran out of time while starting the game." The report could
 * not say whether the page took most of the budget to load, or a press hung on a main thread busy building a 1000-house
 * world (BR2514's own note: "the click timed out during world building — 40 point lights is too heavy"). Without that the
 * class had no root cause. Now each stage's seconds are recorded and said. Run in a REAL browser, as the sandbox runs it:
 * a game whose Play button freezes the page (a huge synchronous world build), with a short budget.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { gamePlaytestModule, gamePlaytestConfig, parsePlaytest, playtestVerdict, replayFromCode } from '../src/server/AgentV3/gamePlaytest';

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const HAS_BROWSER = existsSync(PW) && existsSync(BROWSERS);

// Play builds "the world" synchronously for 25 s — the main thread is gone, exactly like a huge world built in one go.
const FROZEN = `<!doctype html><html><body style="margin:0;background:#123">
<button id="play" style="position:absolute;left:40%;top:40%;width:200px;height:80px">Play</button>
<script>
document.getElementById('play').addEventListener('click', () => {
  const until = Date.now() + 25000; let x = 0; while (Date.now() < until) x += Math.sqrt(x + 1);
  const c = document.createElement('canvas'); c.width = 800; c.height = 450; document.body.appendChild(c);
});
</script></body></html>`;

describe.skipIf(!HAS_BROWSER)('🔴 out of time while starting a frozen game: the stages and their seconds are said', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(FROZEN); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('the out-of-time line names each stage with its seconds, the unfinished one marked', async () => {
    const cfg = { ...gamePlaytestConfig(base + '/'), budgetMs: 12_000 };
    const file = join(makeTempDir('nbai-frozen-playtest-'), 'run.mjs');
    writeFileSync(file, gamePlaytestModule(cfg, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, o) => (e ? rej(e) : res(o))));
    const run = parsePlaytest(stdout);
    expect(run.ok).toBe(false);
    const said = String((run as any).error);
    expect(said).toMatch(/ran out of time while starting the game/);
    expect(said).toMatch(/time spent: loading the game [\d.]+ s · starting the game [\d.]+ s \(unfinished\)/);
    // The seconds are real: the unfinished stage is where nearly all of the 12 s went.
    const m = said.match(/starting the game ([\d.]+) s \(unfinished\)/);
    expect(Number(m?.[1])).toBeGreaterThan(6);
    // …and the verdict the report shows carries it.
    expect(playtestVerdict(run, replayFromCode({})).message).toMatch(/time spent: loading the game/);
  }, 120_000);
});
