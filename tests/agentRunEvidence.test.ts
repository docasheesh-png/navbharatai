// THE SIBLING THE TYPECHECK FIX LEFT BEHIND (autopsy 697b38ee).
//
// That report told the user their app "has no test suite that could be run here" — about a build
// whose own Playwright suite had been installed, run, and PASSED, with the passing run sitting in the
// same report's command log. On 2026-09-16 the IDENTICAL defect was root-caused for the typecheck
// (`typecheckEvidenceFromCommands`) and wired for that one fact. The siblings were never hunted.
//
// `gateEvidence.tests` is written ONLY by the vaccine pass — flag-gated, percentage-gated, and skipped
// entirely on a build not yet marked `ok` — so the gate's silence was structural, not incidental.
//
// Every guard below is proven by REVERSION.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  testFrameworkFromCommand,
  testsEvidenceFromCommands,
  agentRunEvidence,
} from '../src/server/AgentV3/agentRunEvidence';
import { typecheckEvidenceFromCommands } from '../src/server/AgentV3/TscGate';

const cmd = (command: string, stdout = '', exitCode = 0, stderr = '') => ({ command, stdout, stderr, exitCode });

/** A real passing Playwright summary. */
const PW_PASS = '\nRunning 6 tests using 1 worker\n\n  6 passed (12.4s)\n';
/** A real failing one. */
const PW_FAIL = '\nRunning 6 tests using 1 worker\n\n  1 failed\n  5 passed (11.1s)\n';
/** The Shiv Medical Store case: our sandbox, not the user's app. */
const PW_CANNOT_RUN = "Executable doesn't exist at /root/.cache/ms-playwright/chromium-1140/chrome-linux/chrome";

describe('testFrameworkFromCommand — a suite RUN, not a word match', () => {
  it('recognises the real runners', () => {
    expect(testFrameworkFromCommand('npx playwright test')).toBe('playwright');
    expect(testFrameworkFromCommand('cd app && npx playwright test --reporter=line')).toBe('playwright');
    expect(testFrameworkFromCommand('npx vitest run')).toBe('vitest');
    expect(testFrameworkFromCommand('npx jest')).toBe('jest');
    expect(testFrameworkFromCommand('pytest -q')).toBe('pytest');
    expect(testFrameworkFromCommand('go test ./...')).toBe('go');
    expect(testFrameworkFromCommand('npm test')).toBe('npm-script');
    expect(testFrameworkFromCommand('npm run test')).toBe('npm-script');
    expect(testFrameworkFromCommand('npm run test:unit')).toBe('npm-script');
    expect(testFrameworkFromCommand('pnpm test')).toBe('npm-script');
    expect(testFrameworkFromCommand('yarn test')).toBe('npm-script');
  });

  // 🔴 THE TRAP. `playwright install` exits 0 and prints nothing that looks like a failure, so
  // counting it as a run would have manufactured a passing suite out of a download.
  it('an INSTALL is not a run', () => {
    expect(testFrameworkFromCommand('npx playwright install chromium')).toBeNull();
    expect(testFrameworkFromCommand('npx playwright install --with-deps')).toBeNull();
    expect(testFrameworkFromCommand('npm install --save-dev vitest')).toBeNull();
  });

  it('a build, a help page and a watch run are not verdicts', () => {
    expect(testFrameworkFromCommand('npm run build')).toBeNull();
    expect(testFrameworkFromCommand('npx jest --version')).toBeNull();
    expect(testFrameworkFromCommand('npx vitest --help')).toBeNull();
    expect(testFrameworkFromCommand('npx vitest --watch')).toBeNull();
  });

  // 🔴 REVERSION GUARD for the FILE_VERB rule: reading a test file is not running one.
  it('handling a test FILE is not running a suite', () => {
    expect(testFrameworkFromCommand('cat src/tests/login.playwright.test.ts')).toBeNull();
    expect(testFrameworkFromCommand('ls e2e/playwright.test.ts')).toBeNull();
    expect(testFrameworkFromCommand('grep -r "jest" src')).toBeNull();
    expect(testFrameworkFromCommand('rm -rf node_modules/.vitest')).toBeNull();
  });

  it('never throws on junk', () => {
    for (const j of ['', '   ', null, undefined]) {
      expect(() => testFrameworkFromCommand(j as unknown as string)).not.toThrow();
      expect(testFrameworkFromCommand(j as unknown as string)).toBeNull();
    }
  });

  it.each([
    ['CI=1 npx vitest run', 'vitest'],
    ['CI=1 npx vitest', 'vitest'],
    ['env CI=1 ./node_modules/.bin/vitest run', 'vitest'],
    ['cross-env CI=1 npx --no-install vitest run', 'vitest'],
    ['npm exec -- vitest run', 'vitest'],
    ['pnpm exec jest', 'jest'],
    ['python3 -m pytest -v', 'pytest'],
    ['go test -v ./...', 'go'],
    ['cd "game app" && npx playwright test --reporter=list', 'playwright'],
    ['exec -- npx jest', 'jest'],
    ['bun run test:unit', 'npm-script'],
  ])('recognises executable argv in %s', (command, framework) => {
    expect(testFrameworkFromCommand(command)).toBe(framework);
  });

  it.each(['vitest', 'jest', 'pytest', 'playwright'])('package operations mentioning %s cannot execute a suite', (runner) => {
    for (const operation of ['install', 'uninstall', 'remove', 'update', 'info', 'view', 'list', 'audit']) {
      expect(testFrameworkFromCommand(`npm ${operation} ${runner}`)).toBeNull();
      expect(testFrameworkFromCommand(`cd app && pnpm ${operation} ${runner}`)).toBeNull();
    }
    for (const command of [`env CI=1 echo ${runner}`, `printf '${runner}'`, `node -e 'console.log("${runner}")'`, `cat node_modules/.bin/${runner}`]) {
      expect(testFrameworkFromCommand(command)).toBeNull();
    }
  });

  it.each([
    'npm run build -- vitest', 'npm test-not-a-script', 'npm run test:watch',
    'npx vitest watch', 'npx vitest list', 'npx vitest bench', 'npx jest --listTests',
    'pytest --collect-only', 'pytest --co', 'npx playwright show-report',
    'npx vitest run | head -30', 'npx vitest run || true', 'false; npx jest',
    'echo skip && npx jest', 'exec true && npx jest', 'bash -c "npx vitest run"',
    'RUNNER=vitest echo done', '"CI=1" npx vitest run', '$(echo vitest) run',
    'npx vitest run > results.log', 'npx jest\ntrue', 'npx "jest',
  ])('abstains on non-runs or opaque shell execution: %s', (command) => {
    expect(testFrameworkFromCommand(command)).toBeNull();
  });
});

describe('testsEvidenceFromCommands — the autopsy case, and the two ways to be wrong about it', () => {
  // 🔴 THE INCIDENT. Before this, the gate said the app had no suite that could be run.
  it('a Playwright suite the agent installed and PASSED is evidence of a pass', () => {
    expect(testsEvidenceFromCommands([
      cmd('npx playwright install chromium', 'downloading...'),
      cmd('npx playwright test', PW_PASS),
    ])).toBe('passed');
  });

  it('a genuinely failing suite is evidence of a failure', () => {
    expect(testsEvidenceFromCommands([cmd('npx playwright test', PW_FAIL, 1)])).toBe('failed');
  });

  // 🔴 THE OPPOSITE MISTAKE, which this must never make: blaming the user's app for OUR sandbox.
  it('a suite that could NOT EXECUTE is evidence of nothing — never a failure', () => {
    expect(testsEvidenceFromCommands([cmd('npx playwright test', '', 1, PW_CANNOT_RUN)])).toBeUndefined();
    expect(testsEvidenceFromCommands([cmd('npm test', 'npm ERR! Missing script: "test"', 1)])).toBeUndefined();
  });

  it('a could-not-run after a real pass does not erase the pass', () => {
    expect(testsEvidenceFromCommands([
      cmd('npx playwright test', PW_PASS),
      cmd('npx playwright test', '', 1, PW_CANNOT_RUN),
    ])).toBe('passed');
  });

  it('latest wins — the agent may have fixed the failures in between', () => {
    expect(testsEvidenceFromCommands([
      cmd('npx playwright test', PW_FAIL, 1),
      cmd('npx playwright test', PW_PASS),
    ])).toBe('passed');
    expect(testsEvidenceFromCommands([
      cmd('npx playwright test', PW_PASS),
      cmd('npx playwright test', PW_FAIL, 1),
    ])).toBe('failed');
  });

  it('a log with no suite run settles nothing', () => {
    expect(testsEvidenceFromCommands([cmd('npm run build', 'built'), cmd('ls -la')])).toBeUndefined();
    expect(testsEvidenceFromCommands([])).toBeUndefined();
    expect(testsEvidenceFromCommands(null)).toBeUndefined();
    expect(testsEvidenceFromCommands(undefined)).toBeUndefined();
  });

  // An install-only log is the shape the autopsy's build had BEFORE its run — it must stay silent.
  it('installing the browsers alone proves nothing', () => {
    expect(testsEvidenceFromCommands([cmd('npx playwright install chromium', 'ok')])).toBeUndefined();
  });

  it('cdffbb71: removing the missing runner and its test cannot become a passing test suite', () => {
    const reportCommands = [
      cmd('npm run test', '\n> my-angular-app@1.0.0 test\n> vitest run\n', 127, 'sh: 1: vitest: not found\n'),
      cmd('npm uninstall vitest', '\nremoved 21 packages, and audited 852 packages in 5s\n'),
      cmd('rm src/app/models.test.ts'),
    ];
    expect(testsEvidenceFromCommands(reportCommands)).toBeUndefined();
    expect(agentRunEvidence(reportCommands)).not.toHaveProperty('tests');
  });

  it.each([undefined, null, NaN, Infinity, -1])('an unknown or invalid exit %s is not a completed passing run', (exitCode) => {
    expect(testsEvidenceFromCommands([{ command: 'npx playwright test', stdout: PW_PASS, exitCode }])).toBeUndefined();
  });

  it.each([
    ['npx vitest run', ''],
    ['npx vitest run --passWithNoTests', 'No test files found, exiting with code 0'],
    ['npx vitest run', 'Tests 0 passed (0)'],
    ['npx playwright test', '0 passed (0.1s)'],
    ['go test ./...', '? example/app [no test files]'],
    ['npm test', '> app@1.0.0 test\n> echo "Tests 2 passed (2)"\nTests 2 passed (2)'],
    ['npm test', '> app@1.0.0 test\n> npm install vitest\nadded 20 packages'],
  ])('a zero exit without test execution is unverified: %s / %s', (command, output) => {
    expect(testsEvidenceFromCommands([cmd(command, output)])).toBeUndefined();
  });

  it.each([
    ['vitest run', 'Tests 4 passed (4)'],
    ['vitest', 'Tests 4 passed (4)'],
    ['jest', 'Tests: 4 passed, 4 total'],
    ['playwright test', PW_PASS],
    ['python3 -m pytest', '==== 4 passed in 0.02s ===='],
    ['go test ./...', 'ok example/app 0.012s'],
  ])('reads an npm test script using its actual runner: %s', (script, output) => {
    expect(testsEvidenceFromCommands([cmd('npm test', `> app@1.0.0 test\n> ${script}\n\n${output}`)])).toBe('passed');
  });

  it('preserves failing executions and latest actual results while ignoring package management', () => {
    expect(testsEvidenceFromCommands([
      cmd('npx vitest run', 'Tests 1 failed | 2 passed (3)', 1),
      cmd('npm uninstall vitest', 'removed 21 packages'),
    ])).toBe('failed');
    expect(testsEvidenceFromCommands([cmd('npx jest', 'suite failed while loading', 1)])).toBe('failed');
    expect(testsEvidenceFromCommands([
      cmd('npx vitest run', 'Tests 1 failed | 2 passed (3)', 1),
      cmd('npx vitest run', 'Tests 3 passed (3)'),
    ])).toBe('passed');
  });

  it('does not turn a failed summary into a pass when the shell reports zero', () => {
    expect(testsEvidenceFromCommands([cmd('npx vitest run', 'Tests 1 failed | 2 passed (3)')])).toBe('failed');
  });
});

describe('agentRunEvidence — one read, and typecheck is DELEGATED not re-derived', () => {
  const log = [
    cmd('npx tsc --noEmit', ''),
    cmd('npx playwright test', PW_PASS),
  ];

  it('reports both facts the log settles', () => {
    expect(agentRunEvidence(log)).toEqual({ typecheck: 'passed', tests: 'passed' });
  });

  // ⚠️ REVERSION GUARD: a second copy of a verdict is a second copy free to disagree.
  it('typecheck always equals the existing implementation, never a reimplementation', () => {
    const logs = [
      log,
      [cmd('npx tsc --noEmit', "src/App.tsx(3,1): error TS2304: Cannot find name 'x'.", 1)],
      [cmd('npm run build', 'built')],
      [],
    ];
    for (const l of logs) {
      expect(agentRunEvidence(l).typecheck).toBe(typecheckEvidenceFromCommands(l));
    }
  });

  it('a fact the log does not settle is ABSENT, never a default pass', () => {
    const r = agentRunEvidence([cmd('npm run build', 'built')]);
    expect(r.typecheck).toBeUndefined();
    expect(r.tests).toBeUndefined();
    expect(Object.keys(r)).toHaveLength(0);
  });

  it('never throws', () => {
    for (const j of [null, undefined, []]) {
      expect(() => agentRunEvidence(j as never)).not.toThrow();
    }
  });

  const angularCommand = './node_modules/.bin/ng build --progress=false';
  const angularPass = cmd(angularCommand, 'Application bundle generation complete. [3.116 seconds]\nOutput location: /app/dist/app');
  const angularFail = cmd(angularCommand, "✘ [ERROR] NG9: Property 'colour' does not exist on type 'BetTarget'. [plugin angular-compiler]", 1);

  it('recovers the Angular builder receipt even when no plain tsc command ran', () => {
    expect(agentRunEvidence([angularPass]).typecheck).toBe('passed');
  });

  it('native template failure supersedes an earlier clean tsc and cannot be cleared by plain tsc', () => {
    const tsc = cmd('npx tsc --noEmit');
    expect(agentRunEvidence([tsc, angularFail]).typecheck).toBe('failed');
    expect(agentRunEvidence([angularFail, tsc]).typecheck).toBe('failed');
    expect(agentRunEvidence([tsc, angularFail, angularPass]).typecheck).toBe('passed');
  });

  it('a later TypeScript failure still defeats an earlier Angular pass', () => {
    const failure = cmd('npx tsc --noEmit', 'src/a.ts(1,1): error TS2304: Cannot find name x.', 1);
    expect(agentRunEvidence([angularPass, failure]).typecheck).toBe('failed');
    expect(agentRunEvidence([failure, angularPass]).typecheck).toBe('passed');
  });

  it('unavailable and incomplete Angular checks add no proof', () => {
    for (const record of [cmd(angularCommand, '', 127, './node_modules/.bin/ng: not found'), cmd(angularCommand, 'Building...'), { ...angularPass, exitCode: null }]) {
      expect(agentRunEvidence([record]).typecheck).toBeUndefined();
      expect(agentRunEvidence([angularFail, record]).typecheck).toBe('failed');
    }
  });

  it('Angular success text under help/echo/package-management argv is not build evidence', () => {
    for (const command of ['echo ./node_modules/.bin/ng build', 'npm install @angular/cli', './node_modules/.bin/ng build --help', './node_modules/.bin/ng build | head']) {
      expect(agentRunEvidence([{ ...angularPass, command }]).typecheck).toBeUndefined();
    }
  });
});

describe('wiring — the gate reads it, and only to FILL a gap', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Since Q-101 (2026-10-05) the gate reads the ONE evidence ledger, which composes this reader unchanged.
  it('the release-gate assembly reads the evidence ledger (which composes agentRunEvidence)', () => {
    expect(route).toContain('fillGateFromLedger(gateEvidence, gateLedger)');
    expect(readFileSync(join(__dirname, '../src/server/AgentV3/evidenceLedger.ts'), 'utf8')).toContain('agentRunEvidence(commands)');
  });

  // 🔴 REVERSION GUARD: without the 'not-run' condition this would OVERRIDE the deterministic gate's
  // real evidence with a log reading — the fallback becoming an authority.
  it('it only fills evidence that is still not-run — it never overrides a real result', () => {
    expect(readFileSync(join(__dirname, '../src/server/AgentV3/evidenceLedger.ts'), 'utf8')).toContain("if (entry && gate[name] === 'not-run') gate[name] = entry.outcome;");
  });

  it('it runs BEFORE the release gate is computed, or it could not affect it', () => {
    const read = route.indexOf('fillGateFromLedger(gateEvidence');
    const gate = route.indexOf('releaseGate(gateEvidence');
    expect(read).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeLessThan(gate);
  });

  it('it cannot break a build — wrapped in a swallowing try/catch', () => {
    const at = route.indexOf('fillGateFromLedger(gateEvidence');
    const around = route.slice(Math.max(0, at - 300), at + 500);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toMatch(/\}\s*catch\s*\{/);
  });
});
