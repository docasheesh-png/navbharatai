/**
 * Q-2303 — A CLEAN CONSOLE READ IS PROOF ONLY OF WHAT A BROWSER SAW (autopsy 8701aaa1 / c71e56de, build report #1846).
 *
 * The builder of a 3D racing game asked `console_errors` three times and was told, each time, "the console was read
 * and it was clean" — and declared the game fixed. The platform's own playtest measured 1,298 errors in the same
 * build. Root cause: `captured` meant "the log FILE exists", and the file outlives the turn that wrote it (the
 * sandbox resumes, the log is append-only), so a window in which NO browser opened the app read as a clean one.
 * The last read came after an edit no browser had run. Locked here: a session is stamped, `captured` needs a look
 * IN the window, a look older than the last write is called stale, and every browser lane records and stamps.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  E2BActuator, SCREENSHOT_SCRIPT, SCREENSHOT_CDP_SCRIPT, BROWSER_ACTION_SCRIPT, BROWSER_DAEMON_SCRIPT, browsePageScript,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { consoleCleanVerdict } from '../src/server/AgentV3/renderCheckConsole';

function actuatorReading(log: string): E2BActuator {
  const act = new E2BActuator('test-key');
  (act as unknown as Record<string, unknown>).getSandbox = async () => ({ files: { read: async () => log } });
  return act;
}
const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;

describe('🔴 captured means a browser looked IN the window, not that a log file exists', () => {
  it('the report case: a log left by an earlier turn, no look in this window ⇒ NOT captured', async () => {
    const log = line({ t: 1000, kind: 'session' }) + '\n' /* a legacy empty marker */ + line({ t: 1100, kind: 'pageerror', text: 'old' });
    const r = await actuatorReading(log).getConsoleErrors('ws', 5000);
    expect(r).toEqual({ errors: [], captured: false, lastSessionAt: 1000 });
  });
  it('a stamped look in the window with nothing thrown ⇒ captured and clean', async () => {
    const r = await actuatorReading(line({ t: 1000, kind: 'session' }) + line({ t: 6000, kind: 'session' })).getConsoleErrors('ws', 5000);
    expect(r).toEqual({ errors: [], captured: true, lastSessionAt: 6000 });
  });
  it('an error in the window is first-hand evidence on its own, and the marker is never reported as an error', async () => {
    const r = await actuatorReading(line({ t: 6000, kind: 'pageerror', text: 'boom', stack: 'at x (http://localhost:5173/src/a.ts:1:2)' }) + line({ t: 6001, kind: 'session' }))
      .getConsoleErrors('ws', 5000);
    expect(r.captured).toBe(true);
    expect(r.errors).toEqual([{ t: 6000, kind: 'pageerror', text: 'boom', stack: 'at x (http://localhost:5173/src/a.ts:1:2)' }]);
  });
  it('no log at all is still "never looked"', async () => {
    const act = new E2BActuator('test-key');
    (act as unknown as Record<string, unknown>).getSandbox = async () => ({ files: { read: async () => { throw new Error('missing'); } } });
    expect(await act.getConsoleErrors('ws', 0)).toEqual({ errors: [], captured: false });
  });
});

describe('🔴 a clean read older than the last change is called what it is', () => {
  it('the report case: the last look came before the last edit ⇒ "NOT evidence", and what to do', () => {
    const text = consoleCleanVerdict({ lastSessionAt: 1_000, lastWriteAt: 30_000, now: 40_000 });
    expect(text).toContain('BEFORE your last file change');
    expect(text).toContain('NOT evidence that your change works');
    expect(text).toContain('Take a screenshot');
    expect(text).not.toMatch(/^No runtime browser errors/);
  });
  it('a look after the last change is clean — and says a game in PLAY is measured elsewhere', () => {
    const text = consoleCleanVerdict({ lastSessionAt: 35_000, lastWriteAt: 30_000, now: 40_000 });
    expect(text).toMatch(/^No runtime browser errors/);
    expect(text).toContain('5s ago, after your last change');
    expect(text).toContain('playtest');
  });
});

describe('🔒 every browser lane LISTENS and STAMPS its look, and every script is valid JavaScript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nbai-console-lanes-'));
  const scripts: Record<string, string> = {
    'screenshot (fallback browser)': SCREENSHOT_SCRIPT,
    'screenshot (shared CDP browser)': SCREENSHOT_CDP_SCRIPT,
    'browser action': BROWSER_ACTION_SCRIPT,
    'browser daemon': BROWSER_DAEMON_SCRIPT,
    'browseUrl (render check)': browsePageScript('http://127.0.0.1:5173'),
  };
  for (const [name, src] of Object.entries(scripts)) {
    it(`${name}: parses with node --check and stamps a session`, () => {
      const file = join(dir, `${name.replace(/\W+/g, '_')}.js`);
      writeFileSync(file, src);
      expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow();
      expect(src, name).toMatch(/kind:'session'/);
    });
  }
  it('the fallback screenshot browser attaches the shared listeners before it navigates', () => {
    const on = SCREENSHOT_SCRIPT.indexOf("p.on('pageerror'");
    expect(on).toBeGreaterThan(-1);
    expect(on).toBeLessThan(SCREENSHOT_SCRIPT.indexOf('p.goto('));
  });
  it('the daemon listens to a new page the moment it opens, not on the next poll', () => {
    expect(BROWSER_DAEMON_SCRIPT).toContain("ctx.on('page',attach)");
  });
});
