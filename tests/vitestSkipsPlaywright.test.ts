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

/**
 * 🔴 THE SIBLING THE 2026-08-25 FIX NEVER REACHED (autopsy, build 9cca1fd5, 2026-09-17).
 *
 * Every test above declares `vitest` as a bare DEPENDENCY, with no `"test"` script in package.json —
 * so every one of them exercises ONLY step 2 of `detectTestPlan` (the config/dependency inference
 * branch). A real app almost never looks like that: once it has real vitest unit tests, its
 * package.json nearly always ALSO carries `"scripts": { "test": "vitest" }`, and `e2eAutoScaffold.ts`
 * never touches that script when it drops Playwright specs in later. `detectTestPlan` checks the
 * project's OWN test script FIRST (step 1) and returns immediately — so the exclusion two tests above
 * prove exists was, for the overwhelmingly common case, unreachable code. The live report: an app
 * whose 29/29 real unit tests passed was told `vitest: FAIL`, because its own `"test": "vitest run"`
 * script swept up `e2e/smoke.spec.ts` exactly as the original bug described — one call-site fixed,
 * the other never hunted.
 */
describe('the same exclusion applies to the project\'s OWN "test" script (step 1), not just step 2', () => {
  const withTestScript = (script: string) => JSON.stringify({ scripts: { test: script }, devDependencies: { vitest: '^2.0.0' } });

  it('excludes e2e/ when the declared test script is vitest and a Playwright config owns e2e/', () => {
    const plan = detectTestPlan(
      ['package.json', 'playwright.config.ts', 'e2e/smoke.spec.ts', 'src/a.test.ts'],
      withTestScript('vitest run'),
    );
    expect(plan?.framework).toBe('vitest');
    // Passed through the package manager's own `--` forwarding, which npm requires and yarn/pnpm/bun
    // all honour identically for a `run <script>` invocation.
    expect(plan?.command).toBe(`npm run test -- --exclude 'e2e/**'`);
  });

  it('still runs the user\'s own package manager, with the same forwarding syntax', () => {
    const pkg = withTestScript('vitest');
    const files = ['package.json', 'playwright.config.ts', 'e2e/smoke.spec.ts', 'yarn.lock'];
    expect(detectTestPlan(files, pkg)?.command).toBe(`yarn test -- --exclude 'e2e/**'`);
  });

  it('does NOT exclude when there is no Playwright config — those may be the user\'s own vitest tests', () => {
    const plan = detectTestPlan(['package.json', 'e2e/checkout.spec.ts'], withTestScript('vitest run'));
    expect(plan?.command).toBe('npm run test');
  });

  it('does NOT exclude a non-vitest test script, even with a Playwright config present', () => {
    // The script is jest's, not vitest's — vitest's `--exclude` flag would be meaningless to it, and
    // jest's own default testMatch does not sweep up Playwright specs the way vitest's does.
    const pkg = JSON.stringify({ scripts: { test: 'jest --ci' }, devDependencies: { jest: '^29' } });
    const plan = detectTestPlan(['package.json', 'playwright.config.ts', 'e2e/smoke.spec.ts'], pkg);
    expect(plan?.framework).toBe('jest');
    expect(plan?.command).toBe('npm run test');
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
