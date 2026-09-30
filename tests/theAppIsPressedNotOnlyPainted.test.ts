import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  pressDecision, parseExploreOutput, summarizeExplore, exploreUserSummary, mergeUserProofs,
  clickExplorerScript, clickExplorerModule, clickExplorerEnabled, pressName,
  EXPLORE_RESULT_MARKER, NEVER_PRESS, WRITE_VERBS, CONSOLE_NOISE,
  MAX_SECOND_LEVEL_CLICKS, MAX_SECOND_LEVEL_PER_PARENT,
} from '../src/server/AgentV3/clickExplorer';

/**
 * Competitive gap G1 (2026-09-28): every check we ran after a build watched the app PAINT or drove one
 * form. Nothing pressed the rest of it, so "the tab white-screens", "the button throws", "the link goes
 * nowhere" survived every check we own. The click explorer presses each SAFE control on a fresh load.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const line = (o: unknown) => `${EXPLORE_RESULT_MARKER}${JSON.stringify(o)}`;
const summaryLine = (over: Record<string, unknown> = {}) => line({ type: 'summary', loaded: true, note: '', found: 5, chosen: 2, skipped: [], ...over });
const press = (over: Record<string, unknown> = {}) => line({ type: 'press', label: 'Tab two', tag: 'button', verdict: 'ok', note: 'it responded', errors: [], changed: true, ...over });

describe('what it will and will not press', () => {
  it('presses an ordinary named control', () => {
    expect(pressDecision({ label: 'Tab two', tag: 'button' })).toEqual({ press: true });
    expect(pressDecision({ label: 'Help', tag: 'a', href: '/help', sameOrigin: true })).toEqual({ press: true });
  });

  it('never presses anything that deletes, pays, sends or logs out', () => {
    for (const label of ['Delete all', 'Remove', 'Clear list', 'Log out', 'Sign out', 'Pay ₹99', 'Buy now', 'Checkout', 'Share', 'Send', 'Download CSV', 'Upload photo']) {
      expect(pressDecision({ label, tag: 'button' }).press, label).toBe(false);
    }
  });

  it('never submits a form, never leaves the app, never presses an unnamed control', () => {
    expect(pressDecision({ label: 'Go', tag: 'button', submitsForm: true }).press).toBe(false);
    expect(pressDecision({ label: 'Docs', tag: 'a', href: 'https://example.com', sameOrigin: false }).press).toBe(false);
    expect(pressDecision({ label: 'Mail us', tag: 'a', href: 'mailto:a@b.c' }).press).toBe(false);
    expect(pressDecision({ label: 'Guide', tag: 'a', href: '/g', opensNewTab: true }).press).toBe(false);
    expect(pressDecision({ label: '  ', tag: 'button' }).press).toBe(false);
  });

  it('refuses creating verbs ONLY when the app writes to the user\'s own database', () => {
    expect(pressDecision({ label: 'Add item', tag: 'button' }).press).toBe(true);
    expect(pressDecision({ label: 'Add item', tag: 'button', blockWrites: true }).press).toBe(false);
    expect(pressDecision({ label: 'Settings', tag: 'button', blockWrites: true }).press).toBe(true);
  });

  it('matches whole words, so a harmless label is not refused by a substring', () => {
    expect(NEVER_PRESS.test('Borders')).toBe(false);
    expect(NEVER_PRESS.test('Recall')).toBe(false);
    expect(WRITE_VERBS.test('Addresses')).toBe(false);
  });

  it('the in-page collector uses the SAME rules, passed in rather than copied', () => {
    const script = clickExplorerScript('http://x/', { blockWrites: true });
    expect(script).toContain(JSON.stringify(NEVER_PRESS.source));
    expect(script).toContain(JSON.stringify(WRITE_VERBS.source));
    expect(script).toContain('"blockWrites":true');
  });

  it('filters development chatter from console errors, never an uncaught exception', () => {
    expect(CONSOLE_NOISE.test('Warning: Each child in a list should have a unique "key" prop.')).toBe(true);
    expect(CONSOLE_NOISE.test('Failed to load resource: the server responded with a status of 404')).toBe(true);
    expect(CONSOLE_NOISE.test("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(false);
  });
});

describe('three outcomes, never two', () => {
  it('no output at all is NOT RUN — never a pass', () => {
    const v = summarizeExplore(parseExploreOutput(''));
    expect(v.code).toBe('EXPLORE_NOT_RUN');
    expect(v.outcome).toBe('not-run');
    expect(exploreUserSummary(v).headline).toBe('');
  });

  it('an app that did not load is NOT RUN, and says why', () => {
    const v = summarizeExplore(parseExploreOutput(line({ type: 'summary', loaded: false, note: 'the app answered HTTP 502', found: 0, chosen: 0, skipped: [] })));
    expect(v.code).toBe('EXPLORE_NOT_RUN');
    expect(v.message).toContain('HTTP 502');
  });

  it('a loaded app with nothing safe to press is its own outcome, not a pass', () => {
    const v = summarizeExplore(parseExploreOutput(summaryLine({ found: 3, chosen: 0 })));
    expect(v.code).toBe('EXPLORE_NOTHING_TO_PRESS');
    expect(exploreUserSummary(v).headline).toBe('');
  });

  it('presses that could not be completed prove nothing', () => {
    const v = summarizeExplore(parseExploreOutput([summaryLine(), press({ verdict: 'skipped', note: 'could not be pressed' })].join('\n')));
    expect(v.code).toBe('EXPLORE_NOTHING_TO_PRESS');
  });

  it('every press responding is a pass, and the user is told how many', () => {
    const v = summarizeExplore(parseExploreOutput([summaryLine(), press(), press({ label: 'Help', tag: 'a' })].join('\n')));
    expect(v.code).toBe('EXPLORE_PASSED');
    const card = exploreUserSummary(v);
    expect(card.ok).toBe(true);
    expect(card.steps[0]).toContain('Pressed 2 buttons');
  });

  it('one broken control fails it, and the card names that control in plain words', () => {
    const v = summarizeExplore(parseExploreOutput([
      summaryLine(), press(), press({ label: 'Settings', verdict: 'blank', note: 'the screen went blank' }),
    ].join('\n')));
    expect(v.code).toBe('EXPLORE_FAILED');
    const card = exploreUserSummary(v);
    expect(card.ok).toBe(false);
    expect(card.steps[0]).toBe('Pressing "Settings" left the screen blank.');
    expect(card.steps[1]).toContain('other 1');
  });

  it('a control found on an inner screen is named with the screen it was on', () => {
    const run = parseExploreOutput([summaryLine(), press(), press({ label: 'Refresh', verdict: 'error', via: 'Reports' })].join('\n'));
    expect(run.presses[0].via).toBeUndefined();
    expect(run.presses[1].via).toBe('Reports');
    expect(pressName(run.presses[1])).toBe('"Refresh" (on the "Reports" screen)');
    const v = summarizeExplore(run);
    expect(v.message).toContain('"Refresh" (on the "Reports" screen)');
    expect(exploreUserSummary(v).steps[0]).toBe('Pressing "Refresh" (on the "Reports" screen) caused an error in the app.');
    // A blank or non-string via is not a screen name.
    expect(parseExploreOutput(press({ via: '   ' })).presses[0].via).toBeUndefined();
    expect(parseExploreOutput(press({ via: 7 })).presses[0].via).toBeUndefined();
  });

  it('drops malformed lines rather than guessing', () => {
    const run = parseExploreOutput([`${EXPLORE_RESULT_MARKER}{not json`, press({ verdict: 'exploded' }), summaryLine()].join('\n'));
    expect(run.presses).toHaveLength(0);
    expect(run.summary?.loaded).toBe(true);
  });

  it('the user card carries no codes, tool or vendor names', () => {
    const v = summarizeExplore(parseExploreOutput([summaryLine(), press({ label: 'Stats', verdict: 'error' })].join('\n')));
    const text = JSON.stringify(exploreUserSummary(v));
    expect(text).not.toMatch(/EXPLORE_|playwright|chromium|glm|kimi|claude|gemini|grok/i);
  });
});

describe('one card, several checks', () => {
  const pass = { ok: true, headline: 'NavBharatAI ran 2 tests on your app in a real browser', steps: ['a'] };
  const fail = { ok: false, headline: 'NavBharatAI tested your app and found a problem', steps: ['b'] };
  it('a problem in either wins the card, and every step is kept', () => {
    const m = mergeUserProofs(pass, fail);
    expect(m.ok).toBe(false);
    expect(m.headline).toBe(fail.headline);
    expect(m.steps).toEqual(['a', 'b']);
  });
  it('one proof passes through unchanged; none says nothing', () => {
    expect(mergeUserProofs(null, pass)).toBe(pass);
    expect(mergeUserProofs(null, undefined).headline).toBe('');
  });
});

describe('the runner itself', () => {
  it('the generated module is valid JavaScript (node --check)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-explore-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({ base: 'http://x/', marker: EXPLORE_RESULT_MARKER, maxClicks: 3, maxSecond: 2, perParent: 1, budgetMs: 10_000, loadMs: 1000, blockWrites: false, neverSrc: NEVER_PRESS.source, neverFlags: 'i', writeSrc: WRITE_VERBS.source, writeFlags: 'i', noiseSrc: CONSOLE_NOISE.source, noiseFlags: 'i' }));
    expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow();
  });
  it('carries no raw control character — a single backslash in the source template becomes one', () => {
    // `node --check` cannot see this: "\\b" written as "\b" in the TypeScript template is a BACKSPACE in
    // the generated regex, which parses fine and silently never matches "404".
    const mod = clickExplorerModule({ base: 'http://x/' });
    expect(mod).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    expect(mod).toContain('404\\b');
  });
  it('explores one level deeper, bounded, and never re-presses a control the first screen already had', () => {
    const cfg = JSON.parse(clickExplorerScript('http://x/', { blockWrites: false }).match(/const cfg = (\{.*\});/)![1]);
    expect(cfg.maxSecond).toBe(MAX_SECOND_LEVEL_CLICKS);
    expect(cfg.perParent).toBe(MAX_SECOND_LEVEL_PER_PARENT);
    expect(MAX_SECOND_LEVEL_PER_PARENT).toBeLessThan(MAX_SECOND_LEVEL_CLICKS);
    const mod = clickExplorerModule({ base: 'http://x/' });
    expect(mod).toContain('pressOne(browser, target, firstScreen)');
    expect(mod).toContain('second.slice(0, cfg.maxSecond)');
    // Only a press that worked and changed the screen is explored past.
    expect(mod).toMatch(/discoverAgainst && res\.verdict === 'ok' && res\.changed/);
  });
  it('runs through the shared run line, so the browser path and the diagnostic tail come with it', () => {
    const script = clickExplorerScript('http://x/', { blockWrites: false });
    expect(script).toMatch(/^cat > \/tmp\/nbai-explore\.mjs <<'NBAI_EOF'/);
    expect(script).toContain('PLAYWRIGHT_BROWSERS_PATH=/home/user/.e-tools/.browsers');
    expect(script).toContain("import playwright from '/home/user/.e-tools/node_modules/playwright/index.js'");
  });
  it('the kill switch reverts it', () => {
    expect(clickExplorerEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(clickExplorerEnabled({ AGENTV3_CLICK_EXPLORE: ' OFF ' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('the wiring (source guards — tsc and vitest cannot see a missing call)', () => {
  const route = read('src/server/routes/agentv3.ts');
  it('the route runs it behind its switch and passes the user-database rule', () => {
    expect(route).toMatch(/clickExplorerEnabled\(\) && result\.ok && lastPreviewUrl/);
    // The signed-in session rides beside the rule (weLookBehindTheSignInPage.test.ts); the rule itself must stay.
    expect(route).toMatch(/clickExplorerScript\(lastPreviewUrl, \{ blockWrites: writesToUserDatabase\(exploreFiles\)(?:, storageState: signedInState\(\))? \}\)/);
    expect(route).toMatch(/code: explored\.code/);
  });
  it('the build card is emitted ONCE, merged — a second event would erase the journey\'s proof', () => {
    expect((route.match(/emit\(\{ type: 'verified'/g) ?? []).length).toBe(1);
    expect(route).toMatch(/mergeUserProofs\(journeyProof, exploreProof\)/);
  });
  it('its "did not look" codes are never counted against the app nor offered as a fix', () => {
    const diag = read('src/server/AgentV3/BuildDiagnostics.ts');
    expect(diag).toContain("'EXPLORE_NOT_RUN', 'EXPLORE_NOTHING_TO_PRESS'");
    const sugg = read('src/server/AgentV3/buildFindingSuggestions.ts');
    expect(sugg).toContain("code: 'EXPLORE_FAILED'");
    expect(sugg).toContain("'EXPLORE_NOT_RUN', 'EXPLORE_NOTHING_TO_PRESS', 'EXPLORE_PASSED'");
  });
});

// A REAL BROWSER, where one exists. CI has none, so this runs on a developer machine or a session
// container (Chromium at /opt/pw-browsers) and is skipped — visibly — elsewhere. The string tests above
// are what CI holds; this is what proves the collector and the verdicts agree with a real page.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  const pages: Record<string, string> = {
    '/': `<!doctype html><html lang="en"><head><title>t</title></head><body><div id="root">
<h1>Demo</h1><p id="msg">home</p>
<button onclick="openTab()">Tab two</button>
<button onclick="null.boom()">Open stats</button>
<button onclick="document.getElementById('root').innerHTML=''">Settings</button>
<button onclick="document.body.appendChild(document.createElement('vite-error-overlay'))">Reports view</button>
<a href="/missing-page">About us</a>
<a href="/help">Help</a>
<button onclick="document.body.dataset.gone='1'">Delete all</button>
<button onclick="document.getElementById('msg').textContent='added'">Add item</button>
<form><input name="q" aria-label="q"><button>Go</button></form>
<a href="https://example.com">Docs</a>
<div id="panel"></div>
</div>
<script>
function openTab() {
  document.getElementById('msg').textContent = 'two';
  // An inner screen: one control that throws, one that is fine, one that must never be pressed, a
  // third safe one past the per-screen cap, and a first-screen control repeated (must not be re-pressed).
  document.getElementById('panel').innerHTML = '<button id="r">Refresh</button><button>Sort by name</button><button>Remove row</button><button>Show more</button>';
  document.getElementById('r').onclick = function () { null.refresh(); };
}
</script></body></html>`,
    '/help': '<!doctype html><html><body><div id="root"><h1>Help page</h1><button onclick="window.nope()">Show answers</button></div></body></html>',
  };
  beforeAll(async () => {
    server = http.createServer((q, r) => {
      const body = pages[(q.url ?? '/').split('?')[0]];
      r.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
      r.end(body ?? `Cannot GET ${q.url}`);
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function explore(blockWrites: boolean) {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-explore-real-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, clickExplorerModule({
      base, marker: EXPLORE_RESULT_MARKER, maxClicks: 12, maxSecond: MAX_SECOND_LEVEL_CLICKS, perParent: MAX_SECOND_LEVEL_PER_PARENT, budgetMs: 60_000, loadMs: 10_000, blockWrites,
      neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
      noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
    }, `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    // Async, not execFileSync: the test's own HTTP server lives on this event loop.
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, out) => (e ? rej(e) : res(out))));
    return parseExploreOutput(stdout);
  }

  it('judges each control correctly and never presses the unsafe ones', async () => {
    const run = await explore(false);
    const by = Object.fromEntries(run.presses.map((p) => [p.via ? `${p.via} > ${p.label}` : p.label, p.verdict]));
    expect(by).toEqual({
      'Tab two': 'ok', 'Open stats': 'error', Settings: 'blank', 'Reports view': 'crashed',
      'About us': 'broken-link', Help: 'ok', 'Add item': 'ok',
      // The second level: what "Tab two" and the Help page revealed. "Remove row" is never pressed,
      // "Show more" is past the per-screen cap, and no first-screen control is pressed twice.
      'Tab two > Refresh': 'error', 'Tab two > Sort by name': 'ok', 'Help > Show answers': 'error',
    });
    expect(run.presses.map((p) => p.label)).not.toContain('Remove row');
    const skipped = run.summary!.skipped.map((s) => s.label);
    expect(skipped).toEqual(expect.arrayContaining(['Delete all', 'Go', 'Docs']));
    expect(summarizeExplore(run).code).toBe('EXPLORE_FAILED');
  }, 120_000);

  it('with the user\'s own database, a creating verb is not pressed', async () => {
    const run = await explore(true);
    expect(run.presses.map((p) => p.label)).not.toContain('Add item');
    expect(run.summary!.skipped.map((s) => s.label)).toContain('Add item');
  }, 120_000);
});
