// B4 (roadmap Tier 2A) — detect and interpret the project's OWN test suite, not just `tsc`.
//
// "The build is EARNED": running the app's real tests (jest/vitest/pytest/JUnit/Playwright/go test)
// and reading honest pass/fail counts is stronger evidence than a typecheck. This module is PURE and
// fully unit-testable — detection reads the file tree + package.json; parsing reads a command's raw
// stdout/stderr/exitCode. The ToolDispatcher `run_tests` tool wires these to the sandbox actuator's
// runCommand(); nothing here executes anything itself.

import { detectPackageManager, pmRun, pmExec } from '../lib/packageManager';
import { inFlagRollout } from './escalationRollout';
import { envFlag } from '../lib/envFlag';

export type TestFramework =
  | 'vitest'
  | 'jest'
  | 'playwright'
  | 'pytest'
  | 'maven'
  | 'gradle'
  | 'go'
  | 'npm-script';

export interface TestPlan {
  framework: TestFramework;
  /** Exact command to run in the workspace root. */
  command: string;
  /** Honest one-line reason this suite/command was chosen (surfaced to the agent). */
  reason: string;
}

export interface TestOutcome {
  framework: TestFramework;
  command: string;
  exitCode: number;
  /** Counts parsed from the framework's summary; null when the summary could not be parsed. */
  passed: number | null;
  failed: number | null;
  total: number | null;
  /** Best-effort names of failing tests (may be empty even when `failed > 0`). */
  failingTests: string[];
  /** The honest verdict: the process succeeded AND no test is known to have failed. */
  ok: boolean;
  /** One-line human summary. */
  summary: string;
}

/** The npm-init placeholder — a `test` script that is NOT a real suite. */
const PLACEHOLDER_TEST_SCRIPT = /no test specified/i;

function parsePackageJson(raw: string | undefined): {
  testScript?: string;
  deps: Record<string, string>;
} {
  if (!raw) return { deps: {} };
  try {
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const testScript = pkg.scripts?.test?.trim();
    return {
      testScript: testScript && !PLACEHOLDER_TEST_SCRIPT.test(testScript) ? testScript : undefined,
      deps: { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) },
    };
  } catch {
    return { deps: {} };
  }
}

/** Which JS runner a `test` script / dependency set points at (for correct result parsing). */
function jsRunnerOf(scriptOrDep: string): TestFramework | undefined {
  if (/\bvitest\b/.test(scriptOrDep)) return 'vitest';
  if (/\bjest\b/.test(scriptOrDep)) return 'jest';
  if (/\bplaywright\b/.test(scriptOrDep)) return 'playwright';
  return undefined;
}

/**
 * Decide which test suite to run for a workspace. Pure — reads only the file list + package.json.
 * Returns null when no runnable test suite can be detected (an honest "nothing to run", never a fake pass).
 *
 * Priority: the project's OWN `npm test` script wins (it encodes the author's intent); otherwise we
 * infer the runner from config files / dependencies / test-file conventions, per language.
 */
export function detectTestPlan(files: string[], packageJsonRaw?: string): TestPlan | null {
  const has = (re: RegExp) => files.some(f => re.test(f));
  const { testScript, deps } = parsePackageJson(packageJsonRaw);
  // Run under the project's OWN package manager (pnpm/yarn/bun/npm), not a hardcoded npm — otherwise a
  // pnpm/yarn/bun workspace's tests run under the wrong manager (D11 / P-PIPE-runtime).
  const pm = detectPackageManager(files, packageJsonRaw);
  const exec = pmExec(pm);

  // 1. The project's own test script (skipping the npm-init placeholder), via its package manager.
  if (testScript) {
    const framework = jsRunnerOf(testScript) ?? 'npm-script';
    return {
      framework,
      command: pmRun(pm, 'test'),
      reason: `package.json defines a real "test" script (${testScript}); running it via ${pmRun(pm, 'test')}.`,
    };
  }

  // 2. JS/TS runners by config file or declared dependency — invoked through the project's PM runner.
  if (has(/(^|\/)vitest\.config\.[cm]?[jt]s$/) || 'vitest' in deps) {
    return { framework: 'vitest', command: `${exec} vitest run`, reason: `Vitest config/dependency detected (${pm}).` };
  }
  if (has(/(^|\/)jest\.config\.[cm]?[jt]s$/) || has(/(^|\/)jest\.config\.json$/) || 'jest' in deps) {
    return { framework: 'jest', command: `${exec} jest --ci`, reason: `Jest config/dependency detected (${pm}).` };
  }
  if (has(/(^|\/)playwright\.config\.[cm]?[jt]s$/) || '@playwright/test' in deps) {
    return { framework: 'playwright', command: `${exec} playwright test`, reason: `Playwright config/dependency detected (${pm}).` };
  }

  // 3. Python — pytest by convention.
  if (has(/(^|\/)conftest\.py$/) || has(/(^|\/)test_[^/]+\.py$/) || has(/(^|\/)[^/]+_test\.py$/)) {
    return { framework: 'pytest', command: 'python -m pytest -q', reason: 'Python test files / conftest.py detected.' };
  }

  // 4. Java (Maven) — Surefire runs under `mvn test`.
  if (has(/(^|\/)pom\.xml$/)) {
    return { framework: 'maven', command: 'mvn -q -B test', reason: 'Maven pom.xml detected — running Surefire tests.' };
  }

  // 4b. JVM (Gradle) — build.gradle / build.gradle.kts (Java/Kotlin/Android). Prefer the committed
  // `gradlew` wrapper (pins the exact Gradle version); fall back to a system `gradle` when there is none.
  if (has(/(^|\/)build\.gradle(\.kts)?$/)) {
    const wrapper = has(/(^|\/)gradlew$/);
    return {
      framework: 'gradle',
      command: wrapper ? './gradlew test' : 'gradle test',
      reason: wrapper
        ? 'Gradle build file + gradlew wrapper detected — running ./gradlew test.'
        : 'Gradle build file detected (no wrapper) — running gradle test.',
    };
  }

  // 5. Go — `*_test.go` files.
  if (has(/(^|\/)[^/]+_test\.go$/)) {
    return { framework: 'go', command: 'go test ./...', reason: 'Go *_test.go files detected.' };
  }

  return null;
}

/**
 * App Health Culture — the VACCINE pass (Immune System Phase 2, admin 2026-07-12).
 *
 * `run_tests` is an agent TOOL — the build agent may or may not choose to call it. The vaccine turns
 * that into a guaranteed SYSTEM reflex: after a successful build, if the project ships a real test
 * suite, the platform runs it itself, reads honest pass/fail counts, and records a TEST_SUITE finding
 * in the build report — so a green build that its own tests fail can never be reported as "verified".
 * OFF by default (`AGENTV3_VACCINE=on` to enable) because it runs an extra command (build time / cost),
 * same opt-in discipline as the runtime auto-fix and feature-heal loops. It NEVER blocks a build: when
 * no suite exists it is an honest no-op, and a failing suite is a WARNING finding, not a hard fail.
 */
export function vaccineEnabled(rolloutKey?: string): boolean {
  // Optional percentage canary: AGENTV3_VACCINE_PCT=N enables it for N% of builds (keyed by workspaceId).
  // Unset PCT = 100% (a plain global "on"). Same rollout infra as escalation/feature-heal.
  return inFlagRollout(envFlag('AGENTV3_VACCINE'), process.env.AGENTV3_VACCINE_PCT, rolloutKey);
}

/** An agent-facing repair instruction for a failing test suite (used only when a heal pass runs). */
export function testOutcomeRepairPrompt(outcome: TestOutcome): string {
  if (outcome.ok) return '';
  const names = outcome.failingTests.slice(0, 15);
  return [
    `The app builds, but its OWN test suite is failing (${outcome.summary}).`,
    ...(names.length ? ['Failing tests:', ...names.map((n) => `  - ${n}`)] : []),
    '',
    'Read the failing test(s) and the code under test, then fix the SOURCE so the tests pass — do not',
    'delete, skip, or weaken a test to make it green (that would hide the bug, not fix it). Make the',
    'smallest correct edits and keep the existing passing tests intact.',
  ].join('\n');
}

function toInt(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Interpret a test command's raw output into an honest outcome. Pure. Never invents a pass:
 * when counts can't be parsed, `passed/failed/total` stay null and `ok` falls back to the exit code.
 */
export function parseTestOutcome(
  plan: TestPlan,
  exitCode: number,
  stdout: string,
  stderr: string,
): TestOutcome {
  const out = `${stdout}\n${stderr}`;
  let passed: number | null = null;
  let failed: number | null = null;
  let total: number | null = null;
  const failingTests: string[] = [];

  switch (plan.framework) {
    case 'vitest':
    case 'npm-script': {
      // Vitest: "Tests  2 failed | 5 passed (7)"  or  "Tests  5 passed (5)"
      const m = out.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\((\d+)\))?/i);
      if (m) {
        failed = toInt(m[1]) ?? 0;
        passed = toInt(m[2]);
        total = toInt(m[3]) ?? (passed != null ? passed + (failed ?? 0) : null);
      }
      for (const fm of out.matchAll(/(?:^|\n)\s*(?:×|✗|FAIL)\s+(.+?)(?:\s+\d+ms)?\s*$/gm)) {
        if (fm[1]) failingTests.push(fm[1].trim());
      }
      break;
    }
    case 'jest': {
      // Jest: "Tests:       1 failed, 2 passed, 3 total"
      const m = out.match(/Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/i);
      if (m) {
        failed = toInt(m[1]) ?? 0;
        passed = toInt(m[3]);
        total = toInt(m[4]);
      }
      for (const fm of out.matchAll(/(?:^|\n)\s*(?:✕|×)\s+(.+?)\s*$/gm)) {
        if (fm[1]) failingTests.push(fm[1].trim());
      }
      break;
    }
    case 'playwright': {
      // Playwright: "2 failed" / "5 passed (3.1s)" on separate summary lines.
      passed = toInt(out.match(/(\d+)\s+passed/i)?.[1]);
      failed = toInt(out.match(/(\d+)\s+failed/i)?.[1]) ?? 0;
      const flaky = toInt(out.match(/(\d+)\s+flaky/i)?.[1]) ?? 0;
      if (passed != null) total = passed + (failed ?? 0) + flaky;
      break;
    }
    case 'pytest': {
      // pytest: "===== 1 failed, 5 passed in 0.12s ====="
      passed = toInt(out.match(/(\d+)\s+passed/i)?.[1]);
      failed = toInt(out.match(/(\d+)\s+failed/i)?.[1]) ?? 0;
      const errors = toInt(out.match(/(\d+)\s+error/i)?.[1]) ?? 0;
      failed = (failed ?? 0) + errors;
      if (passed != null) total = passed + failed;
      for (const fm of out.matchAll(/(?:^|\n)FAILED\s+(\S+)/g)) {
        if (fm[1]) failingTests.push(fm[1].trim());
      }
      break;
    }
    case 'maven': {
      // Surefire: "Tests run: 8, Failures: 1, Errors: 0, Skipped: 0" (may appear per-module; sum them).
      let run = 0, fail = 0, seen = false;
      for (const fm of out.matchAll(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/g)) {
        seen = true;
        run += toInt(fm[1]) ?? 0;
        fail += (toInt(fm[2]) ?? 0) + (toInt(fm[3]) ?? 0);
      }
      if (seen) {
        total = run;
        failed = fail;
        passed = run - fail;
      }
      break;
    }
    case 'gradle': {
      // Gradle's default `test` task does NOT print pass/fail counts to stdout (they live in the HTML
      // report), so counts stay null (honest) and the exit code drives ok. Failing tests surface as
      // "com.example.FooTest > doesThing FAILED"; collect those names for an honest failure list.
      for (const fm of out.matchAll(/^(\S+)\s+>\s+(.+?)\s+FAILED\s*$/gm)) {
        if (fm[1] && fm[2]) failingTests.push(`${fm[1]} > ${fm[2].trim()}`);
      }
      if (failingTests.length) failed = failingTests.length;
      break;
    }
    case 'go': {
      // `go test`: count "--- FAIL:" / "--- PASS:" lines; the exit code is authoritative for ok/fail.
      const fails = [...out.matchAll(/---\s+FAIL:\s+(\S+)/g)];
      const passes = [...out.matchAll(/---\s+PASS:\s+(\S+)/g)];
      if (fails.length || passes.length) {
        failed = fails.length;
        passed = passes.length;
        total = failed + passed;
        for (const fm of fails) if (fm[1]) failingTests.push(fm[1].trim());
      }
      break;
    }
  }

  const ok = exitCode === 0 && (failed == null || failed === 0);
  const countStr =
    total != null ? `${passed ?? 0}/${total} passed${failed ? `, ${failed} failed` : ''}` : `exit=${exitCode}`;
  const summary = `${plan.framework}: ${ok ? 'PASS' : 'FAIL'} (${countStr})`;

  return { framework: plan.framework, command: plan.command, exitCode, passed, failed, total, failingTests, ok, summary };
}
