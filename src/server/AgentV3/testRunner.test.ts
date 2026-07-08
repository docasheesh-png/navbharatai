import { describe, it, expect } from 'vitest';
import { detectTestPlan, parseTestOutcome, type TestPlan } from './testRunner';

// B4: detection + parsing of the project's OWN test suite. Both functions are pure, so we exercise
// every framework branch with real-shaped tool output — no sandbox needed.

describe('detectTestPlan', () => {
  it('prefers the project\'s own real npm test script', () => {
    const pkg = JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^2' } });
    const plan = detectTestPlan(['package.json', 'src/a.test.ts'], pkg);
    expect(plan).not.toBeNull();
    expect(plan!.framework).toBe('vitest');
    expect(plan!.command).toBe('npm test --silent');
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
