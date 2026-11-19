// AgentV3 — WHAT DID THE AGENT ALREADY PROVE? The shared evidence read, and its first unhunted sibling.
//
// 🔴 THE OPEN ROOT CAUSE THIS CHIPS AT (autopsy 697b38ee, recorded in CLAUDE.md and PROGRESS.md):
// *"there is no shared EVIDENCE LEDGER. The agent's shell commands and the platform's gates keep
// private notions of what has been proven, and the gates trust only their own."* That report carried,
// in one document: `RELEASE_GATE` saying "the typecheck did not run" after two clean `tsc` runs,
// `RUNTIME_UNCHECKED` after three successful console reads, and a release gate telling the user the
// app *"has no test suite that could be run here"* — about a build whose own Playwright suite had
// been installed, run, and PASSED. **Every fact needed to contradict them was already recorded as
// `SANDBOX_CMD` lines in the same report.**
//
// 🔎 ONE HALF WAS ALREADY FIXED, AND ITS SIBLINGS WERE NEVER HUNTED (rule 3). On 2026-09-16
// `typecheckEvidenceFromCommands` (./TscGate) closed the typecheck case exactly right — it reads the
// build's own command log and fills the gate's evidence when the deterministic gate never ran. It was
// wired at ONE call site, for ONE fact. The `tests` case is the same defect, in the same report, with
// the same cure, and nothing read it.
//
// This module is that cure generalised: ONE place a gate asks "what has already been proven?", so the
// third fact does not become a third one-off. TypeScript evidence DELEGATES to the existing implementation;
// Angular's native build contributes its own framework-scoped receipt. Neither verdict is re-derived,
// because a second copy of a verdict is a second copy free to disagree
// (four ladder comments in this repo once described a rung that no longer existed).
//
// 🔒 THE DISCIPLINE, inherited deliberately from the typecheck harvester:
//   • `undefined` means "nothing in the log settles this" — never a silent promotion to a pass.
//   • A run that could NOT EXECUTE is evidence of nothing, in either direction. The tsc harvester
//     skips a help page for this reason; here the same role is played by `TestOutcome.ran`, which is
//     the vaccine's own rule ("a suite that could not EXECUTE is UNVERIFIED, not failed").
//   • The OUTPUT is parsed by the SAME parser the vaccine trusts, and a pass additionally requires
//     observed test execution. Opaque/piped invocations cannot supply a runner completion receipt.
//   • Latest wins: the agent may have fixed the failures in between.
//
// 🔒 WHY FILLING THIS GAP CANNOT COST A USER MONEY, checked rather than assumed. A RED release gate
// flips a build to `ok: false` (and therefore to FREE) only when `shippingIssueCount('error') > 0`,
// and test evidence contributes nothing to that count — the verdict-correction block says so in its
// own words: *"It does NOT fire on a RED driven only by tests, because a suite can be RED while merely
// INDETERMINATE."* So `passed` can only move the gate UP, and `failed` makes the sentence honest
// without touching anybody's bill.
//
// PURE — no I/O, no clock, never throws.

import { parseTestOutcome, stripAnsi, testSuiteCouldNotRun, type TestFramework } from './testRunner';
import { typecheckEvidenceFromCommands } from './TscGate';
import { testInvocationFramework } from './testCommandInvocation';
import { isAngularValidationCommand, parseAngularValidation } from './angularValidation';

/** The two-sided verdict a gate can adopt. Anything less certain is `undefined`. */
export type EvidenceOutcome = 'passed' | 'failed';

/** One shell command as a build already records it (`BuildDiagnostics.commands`). */
export interface RecordedCommand {
  command: string;
  /** Live reader only: false means the compiler result does not prove this source revision. */
  typecheckCurrent?: boolean;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

/**
 * Which test framework does this command actually RUN — or `null` when it is not a suite run at all.
 *
 * Deliberately narrow, in the spirit of `looksLikeTypecheckCommand`: the question is not "does this
 * string contain the word jest" but "did a suite run here and can its verdict be read from the
 * output". `npm run build` and `npx playwright install chromium` are not that, however much of the
 * vocabulary they share. Pure.
 */
export function testFrameworkFromCommand(command: string | null | undefined): TestFramework | null {
  return testInvocationFramework(String(command ?? ''));
}

/**
 * Did the AGENT ITSELF already run the app's test suite, and what did it find?
 *
 * The `tests` twin of `typecheckEvidenceFromCommands`, and it exists because that fix was applied to
 * one fact and its sibling in the same autopsy was left alone. `gateEvidence.tests` is populated ONLY
 * by the vaccine pass — which is flag-gated, percentage-gated, and skipped entirely on a build not yet
 * marked `ok` — so an agent that ran the suite itself, successfully, left the gate saying the app had
 * no suite that could be run.
 *
 * `undefined` whenever nothing in the log is a completed suite run, and a run that could not EXECUTE
 * is skipped rather than counted as a failure: blaming a user's app because our sandbox lacked a
 * browser binary is the Shiv Medical Store mistake, and it must not be reintroduced through a
 * fallback. Pure.
 */
export function testsEvidenceFromCommands(
  commands: ReadonlyArray<RecordedCommand> | null | undefined,
): EvidenceOutcome | undefined {
  let verdict: EvidenceOutcome | undefined;
  for (const c of commands || []) {
    let framework = testFrameworkFromCommand(c?.command);
    if (!framework) continue;
    // An absent/null exit is not zero. This fallback has no runner-owned completion receipt.
    if (typeof c.exitCode !== 'number' || !Number.isInteger(c.exitCode) || c.exitCode < 0) continue;
    const output = stripAnsi(`${c.stdout ?? ''}\n${c.stderr ?? ''}`);
    if (framework === 'npm-script') {
      // npm prints the script body beneath its package/script header. It may be `echo ...`, a
      // browser install, or even `tsc`: the name "test" alone does not establish a test execution.
      const script = output.match(/^> [^\n]+\n> ([^\n]+)$/m)?.[1];
      if (script) {
        const invoked = testFrameworkFromCommand(script);
        if (!invoked || invoked === 'npm-script') continue;
        framework = invoked;
      }
    }
    const outcome = parseTestOutcome(
      { framework, command: String(c.command), reason: 'recovered from the build\'s own command log' },
      c.exitCode,
      String(c.stdout ?? ''),
      String(c.stderr ?? ''),
    );
    // Could not execute ⇒ evidence of nothing, in either direction. Leave the previous verdict alone.
    if (!outcome.ran) continue;
    if (outcome.ok) {
      // cdffbb71: uninstalling Vitest was misclassified as a suite and its exit 0 became PASS.
      // Even a real runner may exit 0 for --passWithNoTests. A pass needs observed test execution;
      // missing infrastructure/no-tests remains unverified even when a wrapper masks its exit.
      const executed = (outcome.passed ?? 0) + (outcome.failed ?? 0) > 0
        || (framework === 'go' && /^ok\s+\S+\s+(?:[\d.]+s|\(cached\))\s*$/m.test(output));
      if (!executed || testSuiteCouldNotRun(c.exitCode, output)) continue;
    }
    verdict = outcome.ok ? 'passed' : 'failed'; // latest wins — the agent may have fixed it since
  }
  return verdict;
}

/** What a build's own command log already settles. Absent keys mean "the log does not say". */
export interface AgentRunEvidence {
  typecheck?: EvidenceOutcome;
  tests?: EvidenceOutcome;
}

/**
 * THE ONE READ. A gate asks this instead of growing its own private fallback, which is how the
 * typecheck fix came to be wired at a single call site for a single fact while its sibling went
 * unread in the same report.
 *
 * ⚠️ STILL OPEN, and named here so the next occurrence is recognised rather than re-discovered: the
 * autopsy's third false statement was `RUNTIME_UNCHECKED` recorded after three successful browser
 * console reads. That proof does not live in the shell-command log at all — it is held by the page
 * checks — so it needs the ledger's WRITE half (an actor recording a proven fact), not this READ
 * half. This module deliberately does not guess at it. Pure.
 */
export function agentRunEvidence(
  commands: ReadonlyArray<RecordedCommand> | null | undefined,
): AgentRunEvidence {
  const list = commands || [];
  let typecheck = typecheckEvidenceFromCommands(list);
  // Angular's configured build checks templates as well as TypeScript. Keep its actual receipt in
  // the same ledger: a later NG9/NG5002 failure must not be hidden behind an earlier clean tsc.
  // Generic compiler recognition remains delegated, including diagnostics after a native build.
  let nativeIndex = -1;
  let nativeOutcome: EvidenceOutcome | undefined;
  for (let i = 0; i < list.length; i++) {
    const command = list[i];
    if (!command || command.typecheckCurrent === false
      || !isAngularValidationCommand(String(command.command ?? ''))) continue;
    const result = parseAngularValidation(command.exitCode, String(command.stdout ?? ''), String(command.stderr ?? ''));
    if (result.status === 'passed' || result.status === 'failed') {
      nativeIndex = i;
      nativeOutcome = result.status;
    }
  }
  if (nativeOutcome) {
    // Plain tsc cannot clear a failed Angular template check. Conversely a later TypeScript failure
    // still matters after a successful Angular build. A later native build can settle both scopes.
    const laterTypeScript = typecheckEvidenceFromCommands(list.slice(nativeIndex + 1));
    typecheck = laterTypeScript === 'failed' ? 'failed' : nativeOutcome;
  }
  const tests = testsEvidenceFromCommands(list);
  return { ...(typecheck ? { typecheck } : {}), ...(tests ? { tests } : {}) };
}
