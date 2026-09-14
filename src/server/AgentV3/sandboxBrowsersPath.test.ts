// THE BROWSER WAS ALWAYS THERE — it was just invisible to the user's own test suite.
//
// Admin 2026-08-19 ("isko bana dene se kya badlega"). Investigating the standing
// TEST_SUITE_UNVERIFIED / RUNTIME_UNCHECKED items showed they were NOT infrastructure-blocked, which
// is what had been recorded: every sandbox already downloads Chromium in the background for the
// platform's own page checks and journey runs. A user's Playwright suite simply looks somewhere else
// (Playwright's default ~/.cache/ms-playwright) and dies with "Executable doesn't exist at …".
// These tests pin the hand-off — and the shared path, so the two copies can never drift.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { withSandboxBrowsers, SANDBOX_BROWSERS_PATH } from './testRunner';
import { TOOLS_DIR } from './PageRouteCheck';

describe('withSandboxBrowsers — hand the existing browser to the suite that needs one', () => {
  it('a Playwright suite is pointed at the browser the sandbox already downloaded', () => {
    const out = withSandboxBrowsers('npx playwright test', 'playwright');
    expect(out).toContain('PLAYWRIGHT_BROWSERS_PATH=');
    expect(out).toContain(SANDBOX_BROWSERS_PATH);   // still the fallback when the project has none
    expect(out).toContain('npx playwright test');
  });

  // 🔴 REGRESSION — report 697b38ee (2026-09-14). The hand-off was an OVERRIDE, so it pointed
  // Playwright AWAY from a browser the agent had just installed into the DEFAULT cache: the suite
  // passed at +636.9s and the vaccine, re-running it 145s later with the variable pinned, reported
  // "COULD NOT RUN — the browser binaries are not installed". The release gate then told the user the
  // app had no runnable test suite. The project's own cache must win when it has one.
  it('prefers the browser the PROJECT already has, and falls back to ours only when it has none', () => {
    const out = withSandboxBrowsers('npx playwright test', 'playwright');
    const varValue = out.slice(out.indexOf('=') + 1, out.indexOf(' npx'));
    expect(varValue).toContain('$HOME/.cache/ms-playwright');  // the preferred branch
    expect(varValue).toContain(SANDBOX_BROWSERS_PATH);         // the fallback branch
    // The preferred branch must be the one taken when the project's cache is populated: the test is
    // the `ls` of a chromium-* directory, not the mere existence of the folder (an empty
    // ~/.cache/ms-playwright is created by a failed install and holds no browser at all).
    expect(varValue).toMatch(/ls -d "\$HOME\/\.cache\/ms-playwright"\/chromium-\*/);
  });

  it('an opaque npm "test" script gets it too — it may well BE a browser run', () => {
    expect(withSandboxBrowsers('npm run test', 'npm-script')).toContain('PLAYWRIGHT_BROWSERS_PATH=');
  });

  it('suites that have no use for a browser are left exactly as they were', () => {
    for (const fw of ['vitest', 'jest', 'pytest', 'maven', 'gradle', 'go'] as const) {
      expect(withSandboxBrowsers('run it', fw)).toBe('run it');
    }
  });

  it('never doubles the variable when a command already carries it', () => {
    const once = withSandboxBrowsers('npx playwright test', 'playwright');
    expect(withSandboxBrowsers(once, 'playwright')).toBe(once);
  });
});

describe('the path is ONE fact, not two copies', () => {
  it('matches the tools directory the platform installs its browser into', () => {
    expect(SANDBOX_BROWSERS_PATH).toBe(`${TOOLS_DIR}/.browsers`);
  });

  it('is the same path the sandbox actually installs to (read from E2BActuator itself)', () => {
    // Reading the real source keeps this honest: if someone changes where the install goes, the
    // suite fails here instead of silently going back to "browser not found" on every user build.
    const src = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    expect(src).toContain('playwright install chromium');
    expect(src).toContain('PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers');
    expect(src).toContain("const TOOLS_DIR = '/home/user/.e-tools'");
  });
});
