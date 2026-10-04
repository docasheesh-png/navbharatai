/**
 * AUTOPSY f496c75b (open since 2026-09-30): A CONTROL WITHOUT A CONTROL'S TAG WAS INVISIBLE TWICE.
 *
 * A 3D fight game's "Tap to Start" was a <div> with a click listener. The click explorer reads only
 * buttons, links and role=… elements, so it found nothing to press; the accessibility linter that
 * writes the build report's ACCESSIBILITY line had no rule for a clickable div, so it scored 100.
 *
 * Now the explorer also presses an element the app gave a click-type listener (seen by an init script
 * before the app's code runs), an inline onclick, or a React press handler — never the page's roots,
 * never a wrapper around a real control. And the linter flags a clickable div/span with no role.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  parseExploreOutput, clickExplorerModule,
  EXPLORE_RESULT_MARKER, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE,
  MAX_SECOND_LEVEL_CLICKS, MAX_SECOND_LEVEL_PER_PARENT,
} from '../src/server/AgentV3/clickExplorer';
import { lintA11y, clickableNonInteractiveCount } from '../src/server/AppMakerLab/intelligence/A11yLinter';

describe('the accessibility linter sees a clickable div', () => {
  it('flags a div or span with a click handler and no role, in JSX and in HTML', () => {
    expect(clickableNonInteractiveCount('<div className="start" onClick={() => go()}>Tap to Start</div>')).toBe(1);
    expect(clickableNonInteractiveCount('<span onclick="go()">Tap</span>')).toBe(1);
    expect(lintA11y('<div onClick={go}>Tap to Start</div>').violations.map((v) => v.type)).toContain('click-noninteractive');
    expect(lintA11y('<div onClick={go}>Tap to Start</div>').score).toBeLessThan(100);
  });

  it('leaves a real button, a role=button div, a component and a data attribute alone', () => {
    expect(clickableNonInteractiveCount('<button onClick={go}>x</button>')).toBe(0);
    expect(clickableNonInteractiveCount('<div role="button" tabIndex={0} onClick={go}>x</div>')).toBe(0);
    expect(clickableNonInteractiveCount('<Card onClick={go}>x</Card>')).toBe(0);
    expect(clickableNonInteractiveCount('<div data-onclick="x">y</div>')).toBe(0);
  });
});

// A REAL BROWSER, where one exists (the session container). CI has none; the string tests above hold there.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('the explorer presses a div that acts as a button', () => {
  let server: http.Server;
  let base = '';
  const page = `<!doctype html><html lang="en"><head><title>t</title></head><body><div id="root">
<h1>Fight</h1><p id="m">ready</p>
<div id="start" style="padding:20px">Tap to Start</div>
<span onclick="document.getElementById('m').textContent='score 10'">Show score</span>
<div id="react-tab">Stats tab</div>
<div id="card" onclick="document.getElementById('m').textContent='card'">Card <button onclick="document.body.dataset.gone='1'">Delete all</button></div>
<div id="outer"><div id="inner">Inner action</div></div>
<div class="plain">Just text</div>
</div>
<script>
document.getElementById('start').addEventListener('click', function () { null.startGame(); });
document.getElementById('outer').addEventListener('click', function () {});
document.getElementById('inner').addEventListener('click', function () { document.getElementById('m').textContent = 'inner'; });
// React keeps a press handler in the node's props and listens at the root.
document.getElementById('react-tab')['__reactProps$test'] = { onClick: function () {} };
document.getElementById('root').addEventListener('click', function (e) {
  if (e.target.closest('#react-tab')) document.getElementById('m').textContent = 'stats';
});
</script></body></html>`;

  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const ok = (q.url ?? '/').split('?')[0] === '/';
      r.writeHead(ok ? 200 : 404, { 'content-type': 'text/html' });
      r.end(ok ? page : 'Cannot GET');
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('presses the listener div, the onclick span and the React div; never a root, a wrapper or plain text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-explore-div-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base, marker: EXPLORE_RESULT_MARKER, maxClicks: 12, maxSecond: MAX_SECOND_LEVEL_CLICKS, perParent: MAX_SECOND_LEVEL_PER_PARENT, budgetMs: 60_000, loadMs: 10_000, blockWrites: false,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    const run = parseExploreOutput(stdout);
    const by = Object.fromEntries(run.presses.filter((p) => !p.via).map((p) => [p.label, p.verdict]));
    expect(by['Tap to Start']).toBe('error');
    expect(by['Show score']).toBe('ok');
    expect(by['Stats tab']).toBe('ok');
    expect(by['Inner action']).toBe('ok');
    const pressed = run.presses.map((p) => p.label);
    expect(pressed.some((l) => /^Card/.test(l))).toBe(false); // a wrapper around a real control
    expect(pressed.some((l) => /Just text|Fight|ready/.test(l))).toBe(false);
    expect(pressed).not.toContain('Delete all');
  }, 120_000);
});
