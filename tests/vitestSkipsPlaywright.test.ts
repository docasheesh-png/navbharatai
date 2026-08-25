import { describe, it, expect } from 'vitest';
import { detectTestPlan, playwrightOwnsE2e } from '../src/server/AgentV3/testRunner';

/**
 * ⚠️ OUR OWN FILE WAS FAILING OUR OWN GATE (admin build report 2026-08-25, one day after #2650 started
 * writing e2e specs into projects that had a Playwright config and no tests).
 *
 * The report said, on a build that otherwise succeeded:
 *
 *     vitest: FAIL (1/1 passed) — failing: e2e/smoke.spec.ts
 *
 * That file is one WE wrote. Vitest's default include is `**\/*.{test,spec}.?(c|m)[jt]s?(x)`, so it
 * picks the Playwright spec up; the spec imports `@playwright/test`, which we deliberately do NOT
 * install; and the app's own test suite is then reported as failing because of a file the platform put
 * there. The user sees their app blamed for our scaffolding.
 *
 * Exactly the chain `e2eTypecheck.ts` was written for ONE DAY EARLIER — "a test file must never be able
 * to fail the app's release build; every link in that chain is ours" — except that one closed tsconfig.
 * Vitest was the sibling nobody hunted.
 */
const PKG = JSON.stringify({ devDependencies: { vitest: '^2.0.0' } });

describe('vitest is not handed a Playwright spec to run', () => {
  it('excludes e2e/ when a Playwright config owns it', () => {
    const plan = detectTestPlan(['package.json', 'playwright.config.ts', 'e2e/smoke.spec.ts', 'src/a.test.ts'], PKG);
    expect(plan?.framework).toBe('vitest');
    expect(plan?.command).toContain("--exclude 'e2e/**'");
  });

  it('⚠️ does NOT exclude when there is no Playwright config — those may be the user\'s own vitest tests', () => {
    // The quieter, worse bug this guards against: silently skipping a real suite. A folder named e2e is
    // not proof of anything; a Playwright config claiming it is.
    const plan = detectTestPlan(['package.json', 'e2e/checkout.spec.ts'], PKG);
    expect(plan?.framework).toBe('vitest');
    expect(plan?.command).not.toContain('--exclude');
  });

  it('and not when the config exists but nothing is in e2e/ yet', () => {
    const plan = detectTestPlan(['package.json', 'playwright.config.ts', 'src/a.test.ts'], PKG);
    expect(plan?.command).not.toContain('--exclude');
  });

  it('runs the plain command when there is no e2e suite at all', () => {
    const plan = detectTestPlan(['package.json', 'src/a.test.ts'], PKG);
    expect(plan?.command).toBe('npx vitest run');
  });
});

describe('playwrightOwnsE2e — narrow on purpose', () => {
  it('needs BOTH the config and a spec inside e2e/', () => {
    expect(playwrightOwnsE2e(['playwright.config.ts', 'e2e/smoke.spec.ts'])).toBe(true);
    expect(playwrightOwnsE2e(['playwright.config.js', 'e2e/deep/a.test.tsx'])).toBe(true);
    expect(playwrightOwnsE2e(['e2e/smoke.spec.ts'])).toBe(false);          // no config
    expect(playwrightOwnsE2e(['playwright.config.ts'])).toBe(false);        // nothing there yet
    expect(playwrightOwnsE2e(['playwright.config.ts', 'e2e/README.md'])).toBe(false);
  });

  it('is not confused by a similarly-named file elsewhere', () => {
    expect(playwrightOwnsE2e(['playwright.config.ts', 'src/e2e-helpers.ts'])).toBe(false);
    // My first version of this expectation was WRONG and the code was right: the name is anchored at a
    // path boundary, so `not-playwright.config.ts` is not a Playwright config — and treating it as one
    // would silently exclude a user's real vitest tests, which is the bug this guard exists to avoid.
    expect(playwrightOwnsE2e(['not-playwright.config.ts', 'e2e/a.spec.ts'])).toBe(false);
    expect(playwrightOwnsE2e(['apps/web/playwright.config.ts', 'apps/web/e2e/a.spec.ts'])).toBe(true);
  });

  it('never throws on junk', () => {
    expect(() => playwrightOwnsE2e([] as string[])).not.toThrow();
    expect(playwrightOwnsE2e([undefined as unknown as string])).toBe(false);
  });
});
