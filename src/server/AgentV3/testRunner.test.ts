import { describe, it, expect, afterEach } from 'vitest';
import { detectTestPlan, parseTestOutcome, vaccineEnabled, testOutcomeRepairPrompt, type TestPlan } from './testRunner';

// B4: detection + parsing of the project's OWN test suite. Both functions are pure, so we exercise
// every framework branch with real-shaped tool output — no sandbox needed.

describe('detectTestPlan', () => {
  it('prefers the project\'s own real test script (npm by default)', () => {
    const pkg = JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^2' } });
    const plan = detectTestPlan(['package.json', 'src/a.test.ts'], pkg);
    expect(plan).not.toBeNull();
    expect(plan!.framework).toBe('vitest');
    expect(plan!.command).toBe('npm run test');
  });

  it('runs the test script under the project\'s own package manager (pnpm/yarn/bun)', () => {
    const pkg = JSON.stringify({ scripts: { test: 'vitest run' } });
    expect(detectTestPlan(['package.json', 'pnpm-lock.yaml'], pkg)!.command).toBe('pnpm run test');
    expect(detectTestPlan(['package.json', 'yarn.lock'], pkg)!.command).toBe('yarn test');
    expect(detectTestPlan(['package.json', 'bun.lockb'], pkg)!.command).toBe('bun run test');
    // Corepack packageManager field wins even without a lockfile.
    const pinned = JSON.stringify({ scripts: { test: 'vitest run' }, packageManager: 'pnpm@9.0.0' });
    expect(detectTestPlan(['package.json'], pinned)!.command).toBe('pnpm run test');
  });

  it('invokes an inferred runner through the project\'s PM exec (pnpm exec / bunx)', () => {
    expect(detectTestPlan(['vitest.config.ts', 'pnpm-lock.yaml'])!.command).toBe('pnpm exec vitest run');
    expect(detectTestPlan(['jest.config.js', 'bun.lockb'])!.command).toBe('bunx jest --ci');
    expect(detectTestPlan(['playwright.config.ts', 'yarn.lock'])!.command).toBe('yarn playwright test');
  });

  it('ignores the npm-init placeholder test script and falls through to config detection', () => {
    const pkg = JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
      devDependencies: { jest: '^29' },
    });
    const plan = detectTestPlan(['package.json'], pkg);
    expect(plan!.framework).toBe('jest');
    expect(plan!.command).toBe('npx jest --ci');
  });

  it('detects vitest by config file with no package.json', () => {
    const plan = detectTestPlan(['vitest.config.ts', 'src/x.ts']);
    expect(plan!.framework).toBe('vitest');
    expect(plan!.command).toBe('npx vitest run');
  });

  it('detects playwright by config', () => {
    const plan = detectTestPlan(['playwright.config.ts', 'tests/e2e.spec.ts']);
    expect(plan!.framework).toBe('playwright');
  });

  it('detects pytest by test file convention', () => {
    expect(detectTestPlan(['app.py', 'test_app.py'])!.framework).toBe('pytest');
    expect(detectTestPlan(['pkg/service_test.py'])!.framework).toBe('pytest');
    expect(detectTestPlan(['conftest.py'])!.framework).toBe('pytest');
  });

  it('detects maven and go', () => {
    expect(detectTestPlan(['pom.xml', 'src/main/java/App.java'])!.framework).toBe('maven');
    expect(detectTestPlan(['main.go', 'main_test.go'])!.framework).toBe('go');
  });

  it('detects Gradle (build.gradle / .kts) and prefers the gradlew wrapper', () => {
    const withWrapper = detectTestPlan(['build.gradle', 'gradlew', 'src/test/java/AppTest.java'])!;
    expect(withWrapper.framework).toBe('gradle');
    expect(withWrapper.command).toBe('./gradlew test');

    const kts = detectTestPlan(['app/build.gradle.kts', 'settings.gradle.kts'])!;
    expect(kts.framework).toBe('gradle');
    expect(kts.command).toBe('gradle test'); // no wrapper committed → system gradle
  });

  it('Maven wins over Gradle when both build files are present (Surefire path)', () => {
    expect(detectTestPlan(['pom.xml', 'build.gradle'])!.framework).toBe('maven');
  });

  it('returns null when no test suite is present (honest — never a fake pass)', () => {
    expect(detectTestPlan(['index.html', 'style.css'])).toBeNull();
    expect(detectTestPlan(['package.json'], JSON.stringify({ scripts: { build: 'vite build' } }))).toBeNull();
  });
});

const planFor = (framework: TestPlan['framework']): TestPlan => ({ framework, command: 'x', reason: 'r' });

describe('parseTestOutcome', () => {
  it('vitest — all passed', () => {
    const o = parseTestOutcome(planFor('vitest'), 0, ' Tests  5 passed (5)\n', '');
    expect(o.ok).toBe(true);
    expect(o.passed).toBe(5);
    expect(o.failed).toBe(0);
    expect(o.total).toBe(5);
  });

  it('vitest — some failed → ok is false and counts parse', () => {
    const o = parseTestOutcome(planFor('vitest'), 1, ' Tests  2 failed | 5 passed (7)\n', '');
    expect(o.ok).toBe(false);
    expect(o.failed).toBe(2);
    expect(o.passed).toBe(5);
    expect(o.total).toBe(7);
  });

  it('jest — failed/passed/total summary', () => {
    const o = parseTestOutcome(planFor('jest'), 1, 'Tests:       1 failed, 2 passed, 3 total\n', '');
    expect(o.failed).toBe(1);
    expect(o.passed).toBe(2);
    expect(o.total).toBe(3);
    expect(o.ok).toBe(false);
  });

  it('pytest — counts failures and errors together', () => {
    const o = parseTestOutcome(planFor('pytest'), 1, '===== 1 failed, 5 passed, 1 error in 0.3s =====\nFAILED test_app.py::test_x\n', '');
    expect(o.passed).toBe(5);
    expect(o.failed).toBe(2); // 1 failed + 1 error
    expect(o.failingTests).toContain('test_app.py::test_x');
    expect(o.ok).toBe(false);
  });

  it('maven — sums Surefire lines across modules', () => {
    const out = 'Tests run: 4, Failures: 0, Errors: 0, Skipped: 0\nTests run: 4, Failures: 1, Errors: 0, Skipped: 0\n';
    const o = parseTestOutcome(planFor('maven'), 1, out, '');
    expect(o.total).toBe(8);
    expect(o.failed).toBe(1);
    expect(o.passed).toBe(7);
    expect(o.ok).toBe(false);
  });

  it('go — counts FAIL/PASS lines and names failing tests; exit code drives ok', () => {
    const out = '--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\nFAIL\n';
    const o = parseTestOutcome(planFor('go'), 1, out, '');
    expect(o.passed).toBe(1);
    expect(o.failed).toBe(1);
    expect(o.failingTests).toContain('TestB');
    expect(o.ok).toBe(false);
  });

  it('gradle — BUILD SUCCESSFUL with no FAILED lines → ok, counts stay null (honest)', () => {
    const o = parseTestOutcome(planFor('gradle'), 0, '> Task :test\n\nBUILD SUCCESSFUL in 12s\n', '');
    expect(o.ok).toBe(true);
    expect(o.failed).toBeNull();
    expect(o.total).toBeNull();
    expect(o.failingTests).toEqual([]);
  });

  it('gradle — BUILD FAILED names failing tests; exit code drives ok', () => {
    const out = [
      '> Task :test FAILED',
      'com.example.CalcTest > divideByZeroThrows FAILED',
      'com.example.CalcTest > addsTwoNumbers FAILED',
      'BUILD FAILED in 9s',
    ].join('\n');
    const o = parseTestOutcome(planFor('gradle'), 1, out, '');
    expect(o.ok).toBe(false);
    expect(o.failed).toBe(2);
    expect(o.failingTests).toContain('com.example.CalcTest > divideByZeroThrows');
    expect(o.failingTests).toContain('com.example.CalcTest > addsTwoNumbers');
  });

  it('gradle — a non-zero exit with no parseable FAILED lines is still an honest failure', () => {
    const o = parseTestOutcome(planFor('gradle'), 1, 'FAILURE: Build failed with an exception.\n', '');
    expect(o.ok).toBe(false);
    expect(o.failed).toBeNull(); // could not attribute to specific tests — honest
  });

  it('playwright — passed with a flaky counted into total', () => {
    const o = parseTestOutcome(planFor('playwright'), 0, '  5 passed (3.1s)\n', '');
    expect(o.ok).toBe(true);
    expect(o.passed).toBe(5);
    expect(o.failed).toBe(0);
  });

  it('unparseable output falls back to the exit code (0 → ok, non-0 → not ok)', () => {
    const good = parseTestOutcome(planFor('vitest'), 0, 'some non-standard output', '');
    expect(good.ok).toBe(true);
    expect(good.passed).toBeNull();
    const bad = parseTestOutcome(planFor('vitest'), 1, 'crashed before running', 'stack trace');
    expect(bad.ok).toBe(false);
    expect(bad.total).toBeNull();
  });
});

describe('vaccineEnabled — Phase 2 opt-in flag', () => {
  const prev = process.env.AGENTV3_VACCINE;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_VACCINE;
    else process.env.AGENTV3_VACCINE = prev;
  });
  it('is OFF by default (unset)', () => {
    delete process.env.AGENTV3_VACCINE;
    expect(vaccineEnabled()).toBe(false);
  });
  it("is ON only for the exact opt-in value 'on'", () => {
    process.env.AGENTV3_VACCINE = 'on';
    expect(vaccineEnabled()).toBe(true);
  });
  it('is ON for any explicit yes, OFF for an explicit no or an empty value', () => {
    // CONTRACT CHANGED DELIBERATELY (audit finding #1, 2026-08-09): rejecting `1`/`on` was the
    // DEFECT, not a safeguard — the admin's habit is `on`, so a money gate written that way was
    // silently OFF. An explicit YES is still required; only the spellings widened.
    for (const v of ['true', '1', 'yes', 'on']) {
      process.env.AGENTV3_VACCINE = v;
      expect(vaccineEnabled(), v).toBe(true);
    }
    for (const v of ['off', 'false', '0', '']) {
      process.env.AGENTV3_VACCINE = v;
      expect(vaccineEnabled(), v).toBe(false);
    }
  });
});

describe('testOutcomeRepairPrompt', () => {
  it('is empty for a passing suite (no repair needed)', () => {
    const ok = parseTestOutcome(planFor('vitest'), 0, 'Tests  5 passed (5)', '');
    expect(testOutcomeRepairPrompt(ok)).toBe('');
  });
  it('names the failing tests and forbids deleting/skipping them', () => {
    const bad = parseTestOutcome(planFor('vitest'), 1, 'Tests  1 failed | 4 passed (5)\n × adds a task 3ms', '');
    const p = testOutcomeRepairPrompt(bad);
    expect(p).toMatch(/failing/i);
    expect(p).toMatch(/do not/i);
    expect(p).toMatch(/skip|delete|weaken/i);
  });
  it('still asks for a source fix when no individual failing test could be attributed', () => {
    const bad = parseTestOutcome(planFor('vitest'), 1, 'crashed before running', 'stack');
    const p = testOutcomeRepairPrompt(bad);
    expect(p).toMatch(/fix the source/i);
  });
});
