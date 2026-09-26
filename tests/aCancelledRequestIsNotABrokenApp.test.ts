/**
 * A CANCELLED REQUEST IS NOT A BROKEN APP, AND A REPAIRED APP IS NOT JUDGED BY ITS OLD ERRORS
 * (autopsy 7d79254b, 2026-09-26).
 *
 * An EduHub build rendered in a real browser, typechecked, built for production and passed 11/11 of its
 * own tests. It was reported RED, "not ready to use", and billed ₹0 — on the strength of ONE line:
 *
 *     …/node_modules/.vite/deps/react-dom-C2FHna43.js?v=fb0517f8 — net::ERR_ABORTED
 *
 * That line is a request the browser abandoned (Vite re-optimising its dependencies reloads the page), not
 * a failure. And every render check read the console from the START OF THE BUILD, so after the repair pass
 * cleared the cache and the model's own 120-second `console_errors` came back clean, the next check read
 * the very same stale line — same chunk hash, same `v=` — and gave up. See renderCheckConsole.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  isCancelledRequest,
  renderCheckConsoleSince,
  RENDER_CHECK_CLOCK_SLACK_MS,
} from '../src/server/AgentV3/renderCheckConsole';
import { filterActionableErrors, isFatalRuntimeError } from '../src/server/AgentV3/AutoFix';
import { browsePageScript, BROWSER_DAEMON_SCRIPT } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

/** The exact line from the report. */
const REPORT_LINE = 'https://5173-izl4h60c5oq3nzszecowd.e2b.app/node_modules/.vite/deps/react-dom-C2FHna43.js?v=fb0517f8 — net::ERR_ABORTED';

describe('a cancelled request is not a failure', () => {
  it('recognises the report\'s own line', () => {
    expect(isCancelledRequest(REPORT_LINE)).toBe(true);
  });

  it('does not swallow requests that really failed', () => {
    for (const real of [
      'http://localhost:3001/api/users — net::ERR_CONNECTION_REFUSED',
      'https://api.example.com/x — net::ERR_NAME_NOT_RESOLVED',
      'https://x/app.js — net::ERR_FAILED',
      'HTTP 500 from https://x/api',
    ]) {
      expect(isCancelledRequest(real), real).toBe(false);
    }
    expect(isCancelledRequest(undefined)).toBe(false);
  });

  it('is dropped by the one filter every console reader passes through, and nothing real is', () => {
    const kept = filterActionableErrors([
      { t: 1, kind: 'requestfailed', text: REPORT_LINE },
      { t: 2, kind: 'pageerror', text: "Uncaught TypeError: Cannot read properties of undefined (reading 'map')" },
      { t: 3, kind: 'requestfailed', text: 'http://localhost:3001/api/users — net::ERR_CONNECTION_REFUSED' },
    ]).map((e) => e.text);
    expect(kept).not.toContain(REPORT_LINE);
    expect(kept).toHaveLength(2);
    expect(isFatalRuntimeError(REPORT_LINE)).toBe(false);
  });
});

/**
 * Run a generated browser script against a FAKE Playwright, fire one `requestfailed`, and return what the
 * recorder appended to the console log. This is the recorder's real code, not a copy of its rule.
 */
async function recordedAfterRequestFailure(script: string, errorText: string): Promise<string[]> {
  const appended: string[] = [];
  const handlers: Record<string, (arg: unknown) => void> = {};
  const page = {
    on: (event: string, fn: (arg: unknown) => void) => { handlers[event] = fn; },
    goto: async () => {
      handlers.requestfailed?.({ url: () => 'https://x/node_modules/.vite/deps/react-dom.js', failure: () => ({ errorText }) });
    },
    evaluate: async () => 1,
    waitForTimeout: async () => {},
    content: async () => '<div id="root">ok</div>',
  };
  const browser = { newPage: async () => page, close: async () => {}, contexts: () => [] };
  const fakeRequire = (name: string) => {
    if (name === 'playwright') return { chromium: { launch: async () => browser } };
    if (name === 'fs') return { appendFileSync: (_f: string, line: string) => { appended.push(line); } };
    throw new Error(`unexpected require ${name}`);
  };
  const done = new Promise<void>((resolve) => {
    const ctx = vm.createContext({
      require: fakeRequire,
      console: { log: () => resolve() },
      process: { stderr: { write: () => {} }, exit: () => resolve() },
      document: undefined,
    });
    vm.runInContext(script, ctx);
  });
  await done;
  return appended.filter((l) => l.trim().length > 0);
}

describe('the recorder never writes a cancellation down', () => {
  it('a cancelled request leaves the log untouched', async () => {
    const lines = await recordedAfterRequestFailure(browsePageScript('https://x/'), 'net::ERR_ABORTED');
    expect(lines.filter((l) => l.includes('requestfailed'))).toEqual([]);
  });

  it('a real failure is still recorded, word for word', async () => {
    const lines = await recordedAfterRequestFailure(browsePageScript('https://x/'), 'net::ERR_CONNECTION_REFUSED');
    const rec = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === 'requestfailed');
    expect(rec).toHaveLength(1);
    expect(rec[0].text).toContain('net::ERR_CONNECTION_REFUSED');
  });

  it('the model\'s own browser session uses the same listener, so it cannot drift', () => {
    expect(BROWSER_DAEMON_SCRIPT).toContain('net::ERR_ABORTED');
    expect(browsePageScript('https://x/')).toContain('net::ERR_ABORTED');
  });
});

describe('a render check is judged by its OWN console, not the whole build\'s', () => {
  // The report's clock, relative to build start (ms).
  const buildStartedAt = 1_790_428_925_853;
  const staleErrorAt = buildStartedAt + 423_000; // recorded around the first check
  const secondCheckAt = buildStartedAt + 719_000; // after the repair cleared the cache

  it('the repaired app\'s check no longer sees the error from before the repair', () => {
    const since = renderCheckConsoleSince({ checkStartedAt: secondCheckAt, buildStartedAt, checkRecordsConsole: true });
    expect(staleErrorAt > since).toBe(false);
    expect(since).toBe(secondCheckAt - RENDER_CHECK_CLOCK_SLACK_MS);
  });

  it('still sees an error the check itself produced', () => {
    const since = renderCheckConsoleSince({ checkStartedAt: secondCheckAt, buildStartedAt, checkRecordsConsole: true });
    expect(secondCheckAt + 2_000 > since).toBe(true);
  });

  it('never opens before the build began', () => {
    expect(renderCheckConsoleSince({ checkStartedAt: buildStartedAt + 1_000, buildStartedAt, checkRecordsConsole: true })).toBe(buildStartedAt);
  });

  it('with the page recorder off, keeps the whole-build window — that is the only evidence then', () => {
    expect(renderCheckConsoleSince({ checkStartedAt: secondCheckAt, buildStartedAt, checkRecordsConsole: false })).toBe(buildStartedAt);
  });
});

describe('🔒 every render verdict asks for its own window', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('no render check reads the console from the start of the build any more', () => {
    // tsc and vitest cannot see which window a call asks for — that is how three sites shared the bug.
    expect(route).not.toMatch(/getConsoleErrors\(workspaceId, buildStartedAt\)/);
    expect(route.match(/renderCheckConsoleSince\(\{ checkStartedAt: /g)?.length).toBe(3);
  });

  it('each check takes its start time BEFORE it opens the page', () => {
    for (const name of ['rescueCheckStartedAt', 'verifyCheckStartedAt', 'proofStartedAt']) {
      const declared = route.indexOf(`const ${name} = Date.now()`);
      expect(declared, name).toBeGreaterThan(-1);
      const browsed = route.indexOf('actuator.browseUrl(', declared);
      const read = route.indexOf(`checkStartedAt: ${name}`, declared);
      expect(browsed, name).toBeGreaterThan(declared);
      expect(read, name).toBeGreaterThan(browsed);
    }
  });
});
