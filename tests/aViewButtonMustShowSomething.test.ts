// Q-518 (autopsy 39e982bd, 2026-10-04): the explorer recorded *"OK \"View Details\" — it responded (nothing
// visibly changed)"* and counted a dead control as a pass. A control whose NAME promises something to look at
// (PROMISES_VIEW) now fails when the page, its address and every scroll position stay byte-identical and no
// tab, file picker or download opened. Everything else that is quiet — Copy, Show more — passes as before.
//
// The precision corpus is the real browser below: one dead "View Details" and every legitimate shape a view
// control takes (a dialog, a scroll to its section, a new tab, a file picker, a hash link), each of which must
// still pass. And the sibling the hunt found: an unresponsive light/dark switch was handed the SEARCH box's
// repair instruction.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  PROMISES_VIEW, THEME_CONTROL, MAX_THEME_PRESSES, MAX_PRIMED_RETRIES, clickExplorerModule, parseExploreOutput, summarizeExplore, exploreUserSummary,
  EXPLORE_RESULT_MARKER, MAX_SECOND_LEVEL_CLICKS, MAX_SECOND_LEVEL_PER_PARENT, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE,
  type PressResult, type ExploreRun,
} from '../src/server/AgentV3/clickExplorer';
import { explorerRepairFindings } from '../src/server/AgentV3/explorerRepair';
import { makeTempDir } from './helpers/tempDir';

describe('which names promise something to look at', () => {
  it.each(['View Details', 'View', 'Details', 'Open', 'Read more', 'Learn more', 'View all', 'विवरण देखें'])('promises: %s', (n) => expect(PROMISES_VIEW.test(n)).toBe(true));
  it.each(['Copy', 'Save', 'Show more', 'Load more', 'More', 'Like', 'Overview', 'Reopened', 'Preview mode'])('does not: %s', (n) => expect(PROMISES_VIEW.test(n)).toBe(false));
});

describe('the words a person and the repair read', () => {
  const run = (p: PressResult): ExploreRun => ({ summary: { loaded: true, note: '', found: 1, chosen: 1, skipped: [] }, outOfTime: false, diagnostic: null, presses: [p] });
  const dead: PressResult = { label: 'View Details', tag: 'button', verdict: 'unresponsive', note: 'its name promises…', errors: [], changed: false, expects: 'view' };
  const darkSwitch: PressResult = { label: '🌓', tag: 'button', verdict: 'unresponsive', note: 'colours', errors: [], changed: false, expects: 'theme' };

  it('a dead view control is a failure that says nothing appeared, never "colours"', () => {
    const v = summarizeExplore(run(dead));
    expect(v.outcome).toBe('failed');
    const card = exploreUserSummary(v).steps.join(' ');
    expect(card).toContain('Pressing "View Details" showed nothing');
    expect(card).not.toContain('colours');
    // A record written before `expects` existed was a theme switch, and still reads as one.
    const { expects: _e, ...old } = darkSwitch;
    expect(exploreUserSummary(summarizeExplore(run(old))).steps.join(' ')).toContain("never changed the app's colours");
  });

  it('each unresponsive press gets its own repair — a theme switch is never told to filter a list', () => {
    const [view, theme] = explorerRepairFindings([dead, darkSwitch]);
    expect(view).toContain('open what its name says');
    expect(theme).toContain("change the app's colours");
    for (const f of [view, theme]) expect(f).not.toContain('filters that list');
  });

  it('the parser keeps what the name promised', () => {
    const out = parseExploreOutput(`${EXPLORE_RESULT_MARKER}${JSON.stringify({ type: 'press', label: 'View Details', tag: 'button', verdict: 'unresponsive', note: 'x', errors: [], changed: false, expects: 'view' })}`);
    expect(out.presses[0]!.expects).toBe('view');
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<style>#menu { margin-top: 3000px; } dialog { display: none; } dialog[open] { display: block; }</style></head><body><div id="root">
<h1>PrimeClash</h1>
<button id="dead" onclick="void 0">View Details</button>
<button onclick="document.getElementById('dlg').setAttribute('open', '')">View profile</button>
<button onclick="document.getElementById('menu').scrollIntoView()">View menu</button>
<button onclick="window.open('about:blank', '_blank')">View on map</button>
<button onclick="document.getElementById('f').click()">Open file</button>
<button onclick="void 0">Copy</button>
<button onclick="void 0">Show more</button>
<input id="f" type="file" style="display:none" aria-label="file">
<dialog id="dlg"><p>Player stats: 12 wins</p></dialog>
<section id="menu"><h2>Menu</h2></section>
</div></body></html>`;
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('only the dead "View Details" fails; a dialog, a scroll, a new tab, a file picker, Copy and Show more all pass', async () => {
    const dir = makeTempDir('nbai-view-real-');
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
    expect(by['View Details']!.verdict).toBe('unresponsive');
    for (const ok of ['View profile', 'View menu', 'View on map', 'Open file', 'Copy', 'Show more']) expect(by[ok]?.verdict, ok).toBe('ok');
  }, 130_000);
});
