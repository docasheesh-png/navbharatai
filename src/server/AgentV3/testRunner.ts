// B4 (roadmap Tier 2A) — detect and interpret the project's OWN test suite, not just `tsc`.
//
// "The build is EARNED": running the app's real tests (jest/vitest/pytest/JUnit/Playwright/go test)
// and reading honest pass/fail counts is stronger evidence than a typecheck. This module is PURE and
// fully unit-testable — detection reads the file tree + package.json; parsing reads a command's raw
// stdout/stderr/exitCode. The ToolDispatcher `run_tests` tool wires these to the sandbox actuator's
// runCommand(); nothing here executes anything itself.

import { detectPackageManager, pmRun, pmExec } from '../lib/packageManager';
import { shellQuote } from '../lib/shellQuote';
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

/**
 * The sandbox's OWN Playwright browser directory.
 *
 * Every sandbox downloads chromium here in the background as it starts (E2BActuator), because the
 * platform's own page checks and user-journey runs need a real browser. The user's app never learns
 * about it: a suite run as `playwright test` looks in Playwright's DEFAULT cache
 * (~/.cache/ms-playwright) and dies with "Executable doesn't exist at …".
 *
 * Kept in step with E2BActuator's TOOLS_DIR by `sandboxBrowsersPath.test.ts` — two hardcoded copies of
 * one path is exactly how this class of bug returns.
 */
export const SANDBOX_BROWSERS_PATH = '/home/user/.e-tools/.browsers';

/**
 * The test command, with the sandbox's already-downloaded browser made visible to it.
 *
 * ROOT CAUSE THIS CLOSES (Shiv Medical Store, 2026-08-10, and every browser suite since): the readiness
 * gate could not run a user's Playwright suite and had to report TEST_SUITE_UNVERIFIED — not because
 * the sandbox lacked a browser, but because the browser we had already installed sat under a path the
 * user's suite never looks in. One environment variable makes the existing binary visible; nothing is
 * downloaded, so this costs no time and no money.
 *
 * Applied to BROWSER suites only. A vitest/jest/pytest run has no use for the variable, and prefixing
 * every command would mean a Windows-shell-unsafe string travelling where it earns nothing.
 */
export function withSandboxBrowsers(command: string, framework: TestFramework): string {
  const needsBrowser = framework === 'playwright'
    // An npm "test" script is opaque — it may well BE a playwright run, and the variable is inert
    // when it is not, so the safe choice is to provide it.
    || framework === 'npm-script';
  if (!needsBrowser) return command;
  if (command.includes('PLAYWRIGHT_BROWSERS_PATH')) return command;   // already carries it — never double it
  return `PLAYWRIGHT_BROWSERS_PATH=${SANDBOX_BROWSERS_PATH} ${command}`;
}

/** What `withTestFilter` did, so the caller can tell the truth about it. */
export interface FilteredTestPlan {
  /** The command to run. Unchanged when the filter could not be applied. */
  command: string;
  /** True only when the filter is genuinely in the command. */
  applied: boolean;
  /** Set when a filter was asked for and NOT applied — an honest reason, never silence. */
  note: string;
}

/**
 * Run only the tests whose name matches `filter`, instead of the whole suite.
 *
 * WHY IT MATTERS (ROADMAP §8B B4). A build that is fixing one failing test re-ran the ENTIRE suite
 * after every attempt. That is the user's sandbox minutes — real money at $0.083/hour — and the wall
 * clock they sit through, spent re-proving tests that already passed.
 *
 * 🔒 THE SECURITY POINT. `filter` is written by a MODEL and pasted into a shell command that runs
 * inside the user's sandbox, so it goes through `shellQuote` — the single server-wide implementation,
 * which makes `; rm -rf /` an ordinary argument rather than a command. Never interpolate it raw, and
 * never "sanitise" it with a character allowlist instead: quoting is what is provably complete.
 *
 * 🔒 THE HONESTY POINT. A framework whose filter flag we do not know returns the command UNCHANGED
 * with `applied: false` and a reason. The alternative — dropping the filter silently — would run the
 * whole suite while the agent believed it had run one test, and it would read a green full-suite run
 * as proof that its one fix worked.
 */
export function withTestFilter(plan: TestPlan, filter?: string | null): FilteredTestPlan {
  const f = String(filter ?? '').trim();
  if (!f) return { command: plan.command, applied: false, note: '' };
  const q = shellQuote(f);
  switch (plan.framework) {
    // Vitest and Jest both take `-t` for "test name contains".
    case 'vitest':
    case 'jest':
      return { command: `${plan.command} -t ${q}`, applied: true, note: '' };
    // Playwright's name filter is `-g` (grep).
    case 'playwright':
      return { command: `${plan.command} -g ${q}`, applied: true, note: '' };
    case 'pytest':
      return { command: `${plan.command} -k ${q}`, applied: true, note: '' };
    // Go's -run takes a regexp over test function names.
    case 'go':
      return { command: `${plan.command} -run ${q}`, applied: true, note: '' };
    // Surefire's -Dtest= is a single argument, so the whole `-Dtest=<pattern>` is quoted as one.
    case 'maven':
      return { command: `${plan.command} ${shellQuote(`-Dtest=${f}`)}`, applied: true, note: '' };
    case 'gradle':
      return { command: `${plan.command} --tests ${q}`, applied: true, note: '' };
    // An npm "test" script is OPAQUE — it may be vitest, jest, a shell pipeline, or a Makefile. `--`
    // would forward to some of those and break others, and a filter that lands in the wrong runner
    // silently runs everything. Refusing is the honest answer.
    case 'npm-script':
    default:
      return {
        command: plan.command,
        applied: false,
        note: `The filter was NOT applied: this project runs its tests through its own "test" script, `
          + `which could be any runner, so there is no filter flag that is safe to add. The FULL suite ran — `
          + `read the results as a whole-suite result, not as one test.`,
      };
  }
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
  /**
   * Did the suite actually EXECUTE? False when it could not run at all (its runner is missing, a
   * browser binary was never installed, the script does not exist) — which is OUR infrastructure
   * failing, not a defect in the user's app. Same distinction the tsc gate already draws with
   * `ran:false`: a suite that could not run must be reported as UNVERIFIED, never as FAILED.
   */
  ran: boolean;
  /** When `ran` is false, the reason in one line — for an honest report instead of a fake failure. */
  couldNotRunReason?: string;
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
/**
 * A test suite is present but its runner is not installed — the honest reason nothing ran.
 *
 * Without this the improved rule above would trade a false accusation for silence, and silence is how
 * "we did not check" becomes indistinguishable from "there was nothing to check". Returns null when
 * there is genuinely no suite. Pure.
 */
export function suitePresentButRunnerMissing(files: string[], packageJsonRaw?: string): string | null {
  const { testScript, deps } = parsePackageJson(packageJsonRaw);
  if (testScript) return null; // the project's own script wins; it was planned above
  const has = (re: RegExp) => (files || []).some((f) => re.test(f));
  const cases: Array<{ present: boolean; pkg: string; label: string }> = [
    { present: has(/(^|\/)playwright\.config\.[cm]?[jt]s$/), pkg: '@playwright/test', label: 'Playwright' },
    { present: has(/(^|\/)vitest\.config\.[cm]?[jt]s$/), pkg: 'vitest', label: 'Vitest' },
    { present: has(/(^|\/)jest\.config\.[cm]?[jt]s$|(^|\/)jest\.config\.json$/), pkg: 'jest', label: 'Jest' },
  ];
  for (const c of cases) {
    if (c.present && !(c.pkg in deps)) {
      return `This project has a ${c.label} test suite but \`${c.pkg}\` is not installed here, so it was NOT run — `
        + `nothing about those tests passed or failed. Install it with \`npm i -D ${c.pkg}\` and run them yourself.`;
    }
  }
  return null;
}

/**
 * Does a Playwright config claim the `e2e/` directory, so its specs are not vitest's to run?
 *
 * The narrow question on purpose. "Is there an e2e folder" would also match a project that keeps its
 * own vitest tests there, and excluding those would silently skip a real suite. PURE.
 */
export function playwrightOwnsE2e(files: string[]): boolean {
  const list = files || [];
  const hasConfig = list.some((f) => /(^|\/)playwright\.config\.[cm]?[jt]s$/.test(String(f ?? '')));
  if (!hasConfig) return false;
  return list.some((f) => /(^|\/)e2e\/.+\.(spec|test)\.[cm]?[jt]sx?$/.test(String(f ?? '')));
}

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

  // 2. JS/TS runners — THE PACKAGE MUST ACTUALLY BE DECLARED, not merely configured.
  //
  // ROOT CAUSE (BENCHMARK 0 report, 2026-08-12). A config file alone used to be enough. And WE write one:
  // the E2E scaffold drops `playwright.config.ts` into every app and says so out loud — "It has not been
  // run here — run it yourself with `npm run test:e2e` after `npm i -D @playwright/test`". Then this
  // function found that config, ran `playwright test` against a runner nobody had installed, got exit 1
  // with no output, and the app was reported as having a failing test suite. The release gate escalated
  // that to "Not shippable" — for a game the admin was playing at the time.
  //
  // So: we wrote the tests, said their runner was not installed, ran them anyway, and blamed the user's
  // app for the result. A config file proves INTENT; the dependency proves it can actually run. The rule
  // is applied to all three runners, not just Playwright — vitest and jest had the identical hole.
  if ('vitest' in deps) {
    // ⚠️ A PLAYWRIGHT SPEC MUST NOT BE RUN BY VITEST — and this was OUR OWN file failing OUR OWN gate
    // (admin build report 2026-08-25, the day after #2650 started writing e2e specs).
    //
    // The user's report said `vitest: FAIL — failing: e2e/smoke.spec.ts`. That file is one WE wrote.
    // Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, so it picks the Playwright spec
    // up; the spec imports `@playwright/test`, which we deliberately do NOT install; and the app's own
    // test suite is then reported as failing because of a file the platform put there.
    //
    // Exactly the chain `e2eTypecheck.ts` was written for one day earlier — "a test file must never be
    // able to fail the app's release build. Every link in that chain is ours" — for tsconfig. Vitest
    // was the sibling nobody hunted.
    //
    // CONDITIONAL, and that matters: a project with no Playwright config may legitimately keep its own
    // VITEST tests in `e2e/`, and excluding those would silently skip a user's real suite — a quieter
    // and worse bug than the one being fixed. The Playwright config is what makes that directory
    // Playwright's.
    //
    // `--exclude` is ADDITIVE, verified against vitest itself rather than assumed ("Additional file
    // globs to be excluded from test"): the default excludes — node_modules above all — survive.
    const exclude = playwrightOwnsE2e(files) ? " --exclude 'e2e/**'" : '';
    return { framework: 'vitest', command: `${exec} vitest run${exclude}`, reason: `Vitest is a declared dependency (${pm}).` };
  }
  if ('jest' in deps) {
    return { framework: 'jest', command: `${exec} jest --ci`, reason: `Jest is a declared dependency (${pm}).` };
  }
  if ('@playwright/test' in deps) {
    return { framework: 'playwright', command: `${exec} playwright test`, reason: `Playwright is a declared dependency (${pm}).` };
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
  return inFlagRollout(envFlag('AGENTV3_VACCINE'), process.env.AGENTV3_VACCINE_PCT, rolloutKey, 'AGENTV3_VACCINE_PCT');
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

/**
 * Could this suite not RUN at all?
 *
 * ROOT CAUSE (Shiv Medical Store report, 2026-08-10): the readiness gate recorded
 * `playwright: FAIL (exit=1)` and counted it as an unresolved defect of the user's app. The real cause
 * was in OUR sandbox — "Executable doesn't exist at /home/user/.cache/ms-playwright/chromium…": the
 * browser binaries were never installed. Reporting that as the app's failing test suite is the same
 * dishonesty the tsc gate already fixed by reporting `ran:false` instead of a compile failure.
 *
 * DELIBERATELY SIGNATURE-BASED, never inferred from "no counts parsed". Treating an unparseable run as
 * "could not run" would hide REAL failing tests behind a reassuring "unverified", which is far worse
 * than the bug being fixed. Only an explicit, unambiguous infrastructure signature counts.
 */
export function testSuiteCouldNotRun(exitCode: number, output: string): string | null {
  const out = String(output || '');
  const signatures: Array<{ re: RegExp; reason: string }> = [
    { re: /Executable doesn't exist at|please run the following command to download new browsers|npx playwright install/i,
      reason: 'the Playwright browser binaries are not installed in the sandbox' },
    { re: /browserType\.launch: .*(ENOENT|not found)/i, reason: 'the test browser could not be launched in the sandbox' },
    { re: /\bMissing script:\s*\S+/i, reason: 'the package.json has no such test script' },
    { re: /Cannot find module ['"]?(?:@playwright|vitest|jest|mocha)/i, reason: 'the test runner itself is not installed' },
    { re: /(?:command not found|is not recognized as an internal or external command)/i, reason: 'the test command does not exist in the sandbox' },
    { re: /No tests found|no test files found/i, reason: 'the suite matched no test files' },
  ];
  for (const { re, reason } of signatures) if (re.test(out)) return reason;
  // 127 is the shell's own "command not found" — unambiguous, and never produced by a failing test.
  if (exitCode === 127) return 'the test command does not exist in the sandbox';
  return null;
}

/**
 * Did this run report a single test result?
 *
 * NOT a downgrade — deliberately. An earlier attempt at the admin's `playwright: FAIL (exit=1)` report
 * made "no tally" mean "could not run", and the existing suite rejected it for a better reason than the
 * one I had: hiding genuinely failing tests behind a reassuring "unverified" is the opposite mistake
 * and a more damaging one, so only an EXPLICIT infra signature may downgrade a failure.
 *
 * The real defect in that report was never the verdict, it was the silence. `playwright: FAIL (exit=1)`
 * with no other word leaves the admin unable to tell "your tests failed" from "our sandbox died", and
 * the two need completely different responses. So the verdict stands and the SUMMARY says which of the
 * two it cannot rule out. Pure.
 */
export function reportedNoTestResults(output: string): boolean {
  const out = String(output || '');
  return !(/\b\d+\s+(passed|failed|passing|failing|skipped|pending|tests?)\b/i.test(out)
    || /Tests?:\s*\d+/i.test(out)
    || /\b\d+\s*\/\s*\d+\b/.test(out));
}

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
  // A suite that never executed is UNVERIFIED, not failed. Only asked when the run did not pass —
  // a green run obviously ran, and an infra string in passing output must not downgrade a real pass.
  const couldNotRunReason = ok ? null : testSuiteCouldNotRun(exitCode, out);
  const ran = couldNotRunReason == null;
  const countStr =
    total != null ? `${passed ?? 0}/${total} passed${failed ? `, ${failed} failed` : ''}` : `exit=${exitCode}`;
  // A BARE VERDICT WITH NO EVIDENCE IS NOT A REPORT (admin report 2026-08-12). That build recorded
  // exactly `playwright: FAIL (exit=1)` — no counts, no failing test names, nothing. The admin could
  // not tell "your tests failed" from "our sandbox died", and those need opposite responses. The
  // verdict is unchanged (only an explicit infra signature may downgrade a failure); what changes is
  // that the report now admits which of the two it cannot rule out.
  const blindFailure = !ok && ran && total == null && reportedNoTestResults(out);
  const summary = ran
    ? `${plan.framework}: ${ok ? 'PASS' : 'FAIL'} (${countStr})`
      + (blindFailure
        ? ' — the run reported no test results at all, so this could be a failing test OR the runner'
          + ' failing to start; the output gave nothing to tell them apart'
        : '')
    : `${plan.framework}: COULD NOT RUN — ${couldNotRunReason}. The app's tests were not verified (this is a sandbox limitation, not a defect in the app).`;

  return {
    framework: plan.framework, command: plan.command, exitCode, passed, failed, total, failingTests, ok, summary,
    ran, ...(couldNotRunReason ? { couldNotRunReason } : {}),
  };
}
