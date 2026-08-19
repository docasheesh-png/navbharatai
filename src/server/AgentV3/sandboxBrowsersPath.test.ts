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
    expect(out).toBe(`PLAYWRIGHT_BROWSERS_PATH=${SANDBOX_BROWSERS_PATH} npx playwright test`);
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
