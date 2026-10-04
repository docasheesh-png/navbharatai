/**
 * QUEUE Q-247 (candy report 7da1cdca, 2026-10-04): THE EXPLORER COULD NOT PRESS "⏸" AND COULD NOT SAY WHY.
 *
 * The report carried only "could not be pressed: locator.click: Timeout 4000ms exceeded." — Playwright's
 * FIRST line. The reason (another element took the click, or the control never became visible) is in the
 * call log beneath it, and that was thrown away. So the autopsy could not tell an overlay of the app's
 * from one of ours (the 3D shell's touch controls were in that build by mistake, Q-245) from a control
 * that was never really clickable. The instrument now keeps the reason; this locks it in a real browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  clickExplorerModule, CONSOLE_NOISE, EXPLORE_RESULT_MARKER, NEVER_PRESS, parseExploreOutput, WRITE_VERBS,
} from '../src/server/AgentV3/clickExplorer';

describe('the generated runner', () => {
  const mod = clickExplorerModule({ base: 'http://x/' });

  it('keeps the reason a press failed instead of its first line', () => {
    expect(mod).toContain("res.note = 'could not be pressed: ' + pressFailureNote(e);");
    expect(mod).toContain("res.note = 'could not be used: ' + pressFailureNote(e);");
    expect(mod).not.toMatch(/split\('\\n'\)\[0\]\.slice\(0, 120\);\n\s*\}\n\s*armed = false/);
  });

  it('parses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-covered-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, mod);
    execFileSync(process.execPath, ['--check', file]);
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const page = `<!doctype html><html lang="en"><head><title>t</title></head><body><div id="root">
<h1>Candy</h1><p id="msg">home</p>
<button aria-label="Pause" title="Pause" style="position:fixed;top:8px;right:8px">⏸</button>
<button onclick="document.getElementById('msg').textContent='shuffled'">Shuffle</button>
<div class="tc-pad" style="position:fixed;top:0;right:0;width:120px;height:80px;background:transparent"></div>
</div></body></html>`;
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('names the element that covered the control, and still presses the rest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-covered-real-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base, marker: EXPLORE_RESULT_MARKER, maxClicks: 6, maxSecond: 0, perParent: 0, budgetMs: 40_000, loadMs: 10_000, blockWrites: false,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const run = parseExploreOutput(stdout);
    const pause = run.presses.find((p) => p.label !== 'Shuffle');
    expect(pause?.verdict).toBe('skipped');
    expect(pause?.note).toBe('could not be pressed: covered by <div class="tc-pad"></div>');
    expect(run.presses.find((p) => p.label === 'Shuffle')?.verdict).toBe('ok');
  }, 120_000);
});
