/**
 * AUTOPSY 12511a9c (2026-09-30) — a calculator rendered, and one console line made it "not rendered".
 *
 * The app painted in a real browser (158 CSS rules, 20 of 20 buttons styled). Its check still read
 * "didn't render correctly" because of one line: "The script has an unsupported MIME type ('text/html')" —
 * Chrome's message for a service worker whose script came back as HTML. The production-defaults pass had
 * just written index.html (adding `register('/sw.js')`) BEFORE writing public/sw.js, so an open page was
 * reloaded into a request for a file that did not exist yet. A repair (~90 s) and then a runtime auto-fix
 * (~3 min, after the preview had ALREADY re-checked clean) were spent on it, and billed.
 *
 *  1. A rendered app whose only evidence against it is its console is looked at once more, free, before a
 *     repair is paid for (`recheckBeforeRepair`).
 *  2. The runtime auto-fix never reads further back than the last CLEAN real-browser check
 *     (`runtimeAutofixSince`) — the sibling the 7d79254b fix did not reach.
 *  3. The defaults pass writes the files index.html names BEFORE index.html.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  recheckBeforeRepair, runtimeAutofixSince, RUNTIME_AUTOFIX_LOOKBACK_MS,
} from '../src/server/AgentV3/renderCheckConsole';

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('a rendered app is looked at again before a repair is paid for', () => {
  const saved = process.env.AGENTV3_CONSOLE_RECHECK;
  afterEach(() => { if (saved === undefined) delete process.env.AGENTV3_CONSOLE_RECHECK; else process.env.AGENTV3_CONSOLE_RECHECK = saved; });

  it('only a real-browser render with console lines, and only once', () => {
    expect(recheckBeforeRepair({ rendered: true, consoleErrorCount: 1, source: 'browser', recheckSpent: false })).toBe(true);
    expect(recheckBeforeRepair({ rendered: true, consoleErrorCount: 1, source: 'browser', recheckSpent: true })).toBe(false);
    expect(recheckBeforeRepair({ rendered: false, consoleErrorCount: 1, source: 'browser', recheckSpent: false })).toBe(false);
    expect(recheckBeforeRepair({ rendered: true, consoleErrorCount: 0, source: 'browser', recheckSpent: false })).toBe(false);
    expect(recheckBeforeRepair({ rendered: true, consoleErrorCount: 2, source: 'curl', recheckSpent: false })).toBe(false);
  });

  it('AGENTV3_CONSOLE_RECHECK=off restores repair-on-first-sight', () => {
    process.env.AGENTV3_CONSOLE_RECHECK = 'off';
    expect(recheckBeforeRepair({ rendered: true, consoleErrorCount: 1, source: 'browser', recheckSpent: false })).toBe(false);
  });

  it('🔒 the verify loop asks it BEFORE recording PREVIEW_NOT_RENDERED, and the second look is not a repair attempt', () => {
    const loop = route.slice(route.indexOf('let consoleRecheckSpent = false;'), route.indexOf("code: 'PREVIEW_NOT_RENDERED'"));
    expect(loop.length).toBeGreaterThan(1000);
    const ask = loop.indexOf('if (recheckBeforeRepair({ rendered: verdict.rendered, consoleErrorCount: consoleErrs.length, source: shot.source, recheckSpent: consoleRecheckSpent })');
    expect(ask).toBeGreaterThan(0);
    const branch = loop.slice(ask, ask + 900);
    expect(branch).toContain('consoleRecheckSpent = true;');
    expect(branch).toContain('attempt -= 1;');
    expect(branch).toContain('continue;');
    // It is asked before the success test, so a clean second look takes the ordinary verified path.
    expect(ask).toBeLessThan(loop.indexOf('if (verdict.rendered && consoleErrs.length === 0) {'));
  });
});

describe('the runtime auto-fix never reads a line a clean check already answered', () => {
  it('reads three minutes back, or from the last clean real-browser check if that is later', () => {
    const now = 1_000_000;
    expect(runtimeAutofixSince({ now, lastCleanBrowserCheckAt: null })).toBe(now - RUNTIME_AUTOFIX_LOOKBACK_MS);
    expect(runtimeAutofixSince({ now, lastCleanBrowserCheckAt: now - 30_000 })).toBe(now - 30_000);
    expect(runtimeAutofixSince({ now, lastCleanBrowserCheckAt: now - 999_000 })).toBe(now - RUNTIME_AUTOFIX_LOOKBACK_MS);
    expect(runtimeAutofixSince({ now, lastCleanBrowserCheckAt: Number.NaN })).toBe(now - RUNTIME_AUTOFIX_LOOKBACK_MS);
  });

  it('the report\'s own timeline: the stale line at 688 s is not read by the fix at 804 s', () => {
    const build = 1790785433173;
    const staleLine = build + 254_884; // PREVIEW_NOT_RENDERED
    const cleanCheck = build + 336_000; // the verify loop's clean re-look started before 776 s
    const autofix = build + 370_865; // RUNTIME_AUTOFIX_TRIGGERED
    expect(runtimeAutofixSince({ now: autofix, lastCleanBrowserCheckAt: cleanCheck })).toBeGreaterThan(staleLine);
    // The old fixed window would have read it.
    expect(autofix - RUNTIME_AUTOFIX_LOOKBACK_MS).toBeLessThan(staleLine);
  });

  it('🔒 every clean real-browser check records its start, and the auto-fix window reads it', () => {
    expect(route).toContain("if (shot.source === 'browser') lastCleanBrowserCheckAt = verifyCheckStartedAt;");
    expect(route).toContain("if (shot.source === 'browser') lastCleanBrowserCheckAt = rescueCheckStartedAt;");
    expect(route).toContain("if (proven && shot.source === 'browser') lastCleanBrowserCheckAt = proofStartedAt;");
    expect(route).toContain('let sinceMs = runtimeAutofixSince({ now: Date.now(), lastCleanBrowserCheckAt });');
    expect(route).not.toContain('let sinceMs = Date.now() - 180_000;');
  });
});

describe('the defaults pass writes what index.html names before index.html', () => {
  it('🔒 the public files are written, then the index.html patch', () => {
    const pass = route.slice(route.indexOf('const defaults = planAppDefaults('), route.indexOf('🔒 SAY WHAT LANDED, NOT WHAT WAS PLANNED'));
    const files = pass.indexOf('for (const [rel, content] of Object.entries(defaults.files))');
    const patch = pass.indexOf('if (defaults.indexHtml != null && indexHtml != null && defaults.indexHtml !== indexHtml)');
    expect(files).toBeGreaterThan(0);
    expect(patch).toBeGreaterThan(files);
  });
});
