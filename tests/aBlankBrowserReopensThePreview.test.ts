// failedbr #2498 (2026-11-22): at 782 s and 844 s the builder's clicks failed with "No app page is open in the shared
// browser … (now at about:blank)" although a screenshot and an element scan of the preview had just worked — the shared
// browser had come back blank between calls. The action now reopens the page the build was last looking at, and says so.
// Also here: the same build read the game kit line by line because its turn named no game (the kit API snapshot), and
// explored for 195 s after its second hand-back (the third, firmer hand-back).
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_ACTION_SCRIPT, browserActionPayload } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { gameTurnHandoff } from '../src/server/AgentV3/gameKitSeed';
import { advanceExplorationProgress, initialExplorationProgress, MAX_EXPLORATION_STEERS } from '../src/server/AgentV3/explorationProgress';

const PREVIEW = 'https://5173-iyv833veozkpbano8iisg.e2b.app'; // the preview address in #2498's report

/** Run the EXACT production script against a fake page (the br1956Prevention harness shape). */
async function runAction(argv: string, startUrl: string) {
  const files = new Map<string, string>(); const navigations: string[] = []; const clicks: string[] = [];
  const state = { url: startUrl };
  const page = {
    url: () => state.url,
    setViewportSize: async () => {},
    goto: async (url: string) => { navigations.push(url); state.url = url; },
    evaluate: async () => 0,
    waitForTimeout: async () => {}, waitForLoadState: async () => {}, screenshot: async () => Buffer.from('png'),
    $: async () => null,
    click: async (sel: string) => { if (state.url === 'about:blank') throw new Error('selector timed out'); clicks.push(sel); },
  };
  const browser = { contexts: () => [{ pages: () => [page], addInitScript: async () => {} }] };
  const proc = { argv: ['node', 'script', argv], stdout: { write: () => {} }, stderr: { write: (s: string) => { throw new Error(s); } }, exit: () => {} };
  await vm.runInNewContext(BROWSER_ACTION_SCRIPT, { URL, Buffer, process: proc, require: (name: string) => {
    if (name === 'playwright') return { chromium: { connectOverCDP: async () => browser } };
    if (name === 'fs') return { writeFileSync: (p: string, s: unknown) => files.set(p, String(s)), appendFileSync: () => {} };
    throw new Error(name);
  } });
  const meta = JSON.parse([...files.entries()].find(([p]) => p.endsWith('last-action.json'))![1]);
  return { meta, navigations, clicks };
}

describe('a blank shared browser reopens the preview instead of failing the action', () => {
  it('#2498: click on button.bt-pause after the browser went blank reopens the last preview, clicks, and says so', async () => {
    const r = await runAction(browserActionPayload('click', { selector: 'button.bt-pause' }, PREVIEW), 'about:blank');
    expect(r.navigations).toEqual([PREVIEW]);
    expect(r.clicks).toEqual(['button.bt-pause']);
    expect(r.meta.result).toMatch(/^The shared browser had no page open, so it reopened .* first \(the page started fresh\)\. Clicked button\.bt-pause$/);
    expect(r.meta.url).toBe(PREVIEW);
  });

  it('a URL named by the call wins over the remembered one', async () => {
    const r = await runAction(JSON.stringify({ action: 'press', text: 'Space', url: `${PREVIEW}/play`, reopenUrl: PREVIEW }), 'about:blank');
    expect(r.navigations).toEqual([`${PREVIEW}/play`]);
  });

  it('a live page is never re-navigated, and with nothing to reopen the honest error stays', async () => {
    const live = await runAction(browserActionPayload('click', { selector: '.go' }, PREVIEW), `${PREVIEW}/`);
    expect(live.navigations).toEqual([]);
    const none = await runAction(browserActionPayload('scroll', {}), 'about:blank');
    expect(none.meta.result).toMatch(/^ERROR:.*Navigate to the preview first/);
    expect(none.navigations).toEqual([]);
  });

  it('a navigate never carries the reopen address; the actuator remembers the page from every look', () => {
    expect(JSON.parse(browserActionPayload('navigate', { url: PREVIEW }, 'https://old'))).toEqual({ action: 'navigate', url: PREVIEW });
    const src = fs.readFileSync(path.join(__dirname, '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
    expect(src.match(/this\._lastBrowserUrl\.set\(workspaceId, (?:url|args\.url)\)/g)).toHaveLength(3); // screenshot, scan, action
    expect(src).toContain('const payload = browserActionPayload(action, args, this._lastBrowserUrl.get(workspaceId));');
  });
});

describe('a turn on a game whose words name no game still gets the kit API', () => {
  const kit = { 'src/game/core/input.ts': 'export class Input { wasPressed(code: string): boolean { return false; } }' };
  const run = { writingRun: true, moduleTurn: false, importTurn: false, stopped: false };
  it('an edit or a fix on a project that holds the kit is handed the API snapshot', () => {
    for (const prompt of ['add a pause button', 'fix the error', 'make the player faster']) {
      const h = gameTurnHandoff(prompt, kit, run, {});
      expect(h.block).toContain('GAME KIT API SNAPSHOT');
      expect(h.block).toContain('wasPressed(code: string): boolean;');
      expect(h.contract).toBeNull();
    }
  });
  it('a request for a different kind of app, or a project without the kit, gets nothing', () => {
    expect(gameTurnHandoff('build a notes app', kit, run, {})).toEqual({ contract: null, block: '' });
    expect(gameTurnHandoff('add a pause button', {}, run, {})).toEqual({ contract: null, block: '' });
    expect(gameTurnHandoff('add a pause button', kit, { ...run, writingRun: false }, {})).toEqual({ contract: null, block: '' });
  });
});

describe('exploration after the second hand-back gets a third, that says the next reply must write', () => {
  it('#2498 shape: 24 read-only turns → three hand-backs, the last one "WRITE NOW", then silence', () => {
    let state = initialExplorationProgress(46);
    const steers: string[] = [];
    for (let i = 0; i < 40; i++) {
      const out = advanceExplorationProgress(state, { writingRun: true, changes: 46, toolNames: ['bash'], toolCalls: [{ name: 'bash', input: { command: 'sed -n 1,60p src/game/fx/audio.ts' } }], editingExistingApp: true }, {});
      state = out.state;
      if (out.steer) steers.push(out.steer.message);
    }
    expect(MAX_EXPLORATION_STEERS).toBe(3);
    expect(steers).toHaveLength(3);
    expect(steers[2]).toMatch(/^\[BUILD PROGRESS — WRITE NOW\]/);
    expect(steers[2]).toContain('Your next reply must call write_file or edit_file');
    expect(steers[2]).toContain('File reads remain available in full.');
  });
});
