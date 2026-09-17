import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveRootCause,
  ineligibleUnresolvedNote,
  type BuildIssue,
} from '../src/server/AgentV3/BuildDiagnostics';

/**
 * 🔴 A SUCCESSFUL BUILD'S VERDICT CONTRADICTED ITS OWN HEADER, AND NAMED A CAUSE FOR A FAILURE THAT
 * NEVER HAPPENED (autopsy fdd59ef8, second half — 2026-09-17).
 *
 * That autopsy fixed ONE branch of `deriveRootCause`: a build that did NOT succeed had announced
 * "NO unresolved problem was recorded" while its own `counts.unresolved` read 2. The sibling branch
 * one line below — the one every SUCCESSFUL build reaches — kept the identical false sentence,
 * `'Build completed successfully with no problems recorded.'`, and that is the common path, not the
 * rare one: DESIGN_CONSISTENCY, RELEASE_GATE, TIME_TO_FIRST_CALL and DEPENDENCY_VULNERABILITIES are
 * all recorded unresolved and all in NEVER_ROOT_CAUSE, so a green build routinely ends with a
 * non-zero unresolved count and a verdict claiming zero.
 *
 * The same branch had a second defect, in the opposite direction. When one unresolved item WAS
 * eligible, it returned that item's bare message into a field called `rootCause` — rendered to the
 * admin as "Root cause:". On a build that succeeded there is no failure for anything to be the cause
 * OF, so the app's own failing test suite read as the reason a working app had failed.
 *
 * ⚠️ HIDING THE ITEM WAS CONSIDERED AND REJECTED. Adding `TEST_SUITE` to NEVER_ROOT_CAUSE would have
 * silenced the most useful finding on a build where everything else is clean — a suite that RAN and
 * failed is real evidence about the app. Its sibling `TEST_SUITE_UNVERIFIED` is in that set for the
 * opposite reason: our sandbox could not run it at all.
 */

const issue = (over: Partial<BuildIssue> & { code: string }): BuildIssue => ({
  ts: 1,
  phase: 'build',
  severity: 'warning',
  message: `message for ${over.code}`,
  autoResolved: false,
  ...over,
});

const ADVISORY = issue({ code: 'DESIGN_CONSISTENCY', message: 'Design consistency 50/100 (D) across 12 file(s).' });
const GATE = issue({ code: 'RELEASE_GATE', message: 'RELEASE GATE: YELLOW — it runs and renders.' });
const FAILING_SUITE = issue({
  code: 'TEST_SUITE',
  message: 'vitest: 3 of 11 tests failing — failing: cart.spec.ts, auth.spec.ts',
});

describe('a SUCCESSFUL build no longer claims a zero its own counts contradict', () => {
  it('names the unresolved items that were recorded but could not be a cause', () => {
    const cause = deriveRootCause({ issues: [ADVISORY, GATE], ok: true }) ?? '';
    expect(cause).toContain('Build completed successfully');
    expect(cause).toContain('2 unresolved item(s) WERE recorded');
    expect(cause).toContain('DESIGN_CONSISTENCY');
    expect(cause).toContain('RELEASE_GATE');
    // The old, false sentence must be gone on this input — it is what the autopsy is about.
    expect(cause).not.toContain('with no problems recorded');
  });

  it('a genuinely clean build keeps the old sentence byte-for-byte', () => {
    expect(deriveRootCause({ issues: [], ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  it('an INFO-severity item is not a "problem" and does not trigger the note', () => {
    const info = issue({ code: 'TEST_SUITE', severity: 'info', autoResolved: true });
    expect(deriveRootCause({ issues: [info], ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  it('an OBSERVATION about the user\'s pre-existing code is neither ours nor unresolved', () => {
    // `counts.unresolved` excludes observations, so counting one here would contradict the header in
    // the OTHER direction — a verdict claiming problems the header says do not exist.
    const obs = issue({ code: 'INTEGRITY_UNUSED_DEP', observation: true, autoResolved: false });
    expect(deriveRootCause({ issues: [obs], ok: true })).toBe('Build completed successfully with no problems recorded.');
  });
});

describe('a SUCCESSFUL build never presents a finding as the cause of a failure', () => {
  it('a failing test suite is NAMED in full, but not called a cause', () => {
    const cause = deriveRootCause({ issues: [FAILING_SUITE], ok: true }) ?? '';
    // Still named — hiding it was the rejected fix.
    expect(cause).toContain('vitest: 3 of 11 tests failing');
    expect(cause).toContain('cart.spec.ts');
    // …but the causal claim is withdrawn.
    expect(cause).toContain('SUCCEEDED');
    expect(cause).toContain('did not stop anything');
  });

  it('the same finding on a FAILED build is still the plain root cause', () => {
    // A failing suite genuinely can explain a build that did not succeed — this fix must not have
    // quietly demoted it there too.
    expect(deriveRootCause({ issues: [FAILING_SUITE], ok: false })).toBe(FAILING_SUITE.message);
  });

  it('an eligible ERROR on a successful build is named the same honest way', () => {
    const err = issue({ code: 'DB_UNREACHABLE', severity: 'error', message: 'the app has no schema.' });
    const cause = deriveRootCause({ issues: [err], ok: true }) ?? '';
    expect(cause).toContain('the app has no schema.');
    expect(cause).toContain('SUCCEEDED');
  });

  it('a build that is STILL RUNNING is untouched — it has its own sentence', () => {
    const cause = deriveRootCause({ issues: [FAILING_SUITE], stillRunning: true }) ?? '';
    expect(cause).toContain('STILL RUNNING');
    expect(cause).not.toContain('SUCCEEDED');
  });
});

describe('ineligibleUnresolvedNote (pure)', () => {
  const everythingExcluded = () => true;

  it('returns null when nothing candidate-shaped was recorded', () => {
    expect(ineligibleUnresolvedNote([], everythingExcluded)).toBeNull();
    expect(ineligibleUnresolvedNote([issue({ code: 'X', severity: 'info' })], everythingExcluded)).toBeNull();
    expect(ineligibleUnresolvedNote([issue({ code: 'X', autoResolved: true })], everythingExcluded)).toBeNull();
    expect(ineligibleUnresolvedNote([issue({ code: 'X', observation: true })], everythingExcluded)).toBeNull();
  });

  it('counts through the CALLER\'s predicate, never a private copy of the rule', () => {
    // An item the caller considers ELIGIBLE is a candidate for the cause, so it is not "ineligible".
    expect(ineligibleUnresolvedNote([ADVISORY], () => false)).toBeNull();
    expect(ineligibleUnresolvedNote([ADVISORY], () => true)).toContain('DESIGN_CONSISTENCY');
  });

  it('de-duplicates repeated codes but counts every item', () => {
    const note = ineligibleUnresolvedNote([ADVISORY, { ...ADVISORY, ts: 2 }], everythingExcluded) ?? '';
    expect(note).toContain('2 unresolved item(s)');
    expect(note.match(/DESIGN_CONSISTENCY/g)?.length).toBe(1);
  });

  it('caps the code list at five and says how many more there are', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((code) => issue({ code }));
    const note = ineligibleUnresolvedNote(many, everythingExcluded) ?? '';
    expect(note).toContain('7 unresolved item(s)');
    expect(note).toContain('+2 more');
    expect(note).not.toContain('G,');
  });

  it('does not carry the stale hard-coded parenthetical the inline version had', () => {
    const note = ineligibleUnresolvedNote([FAILING_SUITE], everythingExcluded) ?? '';
    // The old wording asserted WHICH advisory it was ("a design/accessibility advisory or the
    // release-gate summary") — true of one report, false the moment a different code is the one there.
    expect(note).not.toContain('design/accessibility');
    expect(note).toContain('TEST_SUITE');
  });
});

describe('the sibling branches carried the same false zero (rule 3 — hunt the siblings)', () => {
  it('a STILL-RUNNING build names what has been recorded so far', () => {
    const cause = deriveRootCause({ issues: [ADVISORY], stillRunning: true }) ?? '';
    expect(cause).toContain('STILL RUNNING');
    expect(cause).toContain('1 unresolved item(s) WERE recorded');
    expect(cause).not.toContain('no unresolved issue has been recorded so far');
  });

  it('a build CUT OFF before recording an outcome names them too', () => {
    const cause = deriveRootCause({ issues: [ADVISORY, GATE], endedWithoutOutcome: true }) ?? '';
    expect(cause).toContain('without recording an outcome');
    expect(cause).toContain('2 unresolved item(s) WERE recorded');
    expect(cause).not.toContain('no unresolved issue was recorded either');
  });

  it('a build the USER stopped names them too', () => {
    const stop = issue({ code: 'USER_STOPPED_BUILD', message: 'Stopped, as you asked.', autoResolved: true, severity: 'info' });
    const cause = deriveRootCause({ issues: [stop, ADVISORY], ok: false }) ?? '';
    expect(cause).toContain('The USER stopped this build');
    expect(cause).toContain('1 unresolved item(s) WERE recorded');
    expect(cause).not.toContain('no unresolved problem was recorded.');
  });

  it('…and each keeps its original sentence when there genuinely is nothing', () => {
    expect(deriveRootCause({ issues: [], stillRunning: true }))
      .toContain('no unresolved issue has been recorded so far');
    expect(deriveRootCause({ issues: [], endedWithoutOutcome: true }))
      .toContain('no unresolved issue was recorded either');
    const stop = issue({ code: 'USER_STOPPED_BUILD', message: 'Stopped, as you asked.', autoResolved: true, severity: 'info' });
    expect(deriveRootCause({ issues: [stop], ok: false }))
      .toContain('no unresolved problem was recorded');
  });
});

describe('the FAILED-build branch still reads from the same helper', () => {
  it('a failed build whose only unresolved items are ineligible names them', () => {
    // `problem === resolvedOnly`: nothing eligible-and-unresolved, so the fallback reaches an
    // auto-resolved item — the original fdd59ef8 case.
    const resolved = issue({ code: 'PROVIDER_FALLBACK', autoResolved: true, message: 'Provider fell back.' });
    const cause = deriveRootCause({ issues: [ADVISORY, GATE, resolved], ok: false }) ?? '';
    expect(cause).toContain('2 unresolved item(s) WERE recorded');
    expect(cause).toContain('DESIGN_CONSISTENCY');
    expect(cause).toContain('Provider fell back.');
    expect(cause).not.toContain('NO unresolved problem was recorded');
  });

  it('…and still says NO unresolved problem when there genuinely was none', () => {
    const resolved = issue({ code: 'PROVIDER_FALLBACK', autoResolved: true, message: 'Provider fell back.' });
    const cause = deriveRootCause({ issues: [resolved], ok: false }) ?? '';
    expect(cause).toContain('NO unresolved problem was recorded');
  });
});

/**
 * ⚠️ REVERSION GUARD, reading CODE rather than a fixed window (six brittle source-reading guards
 * broke on correct code in this repo on one day). The behavioural tests above cannot see a future
 * edit that re-inlines the note into one branch and leaves the sibling behind — which is precisely
 * how this defect survived its own autopsy.
 */
describe('the two halves of one verdict cannot drift apart again', () => {
  const src = readFileSync(join(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
  // Strip comments so an explanatory sentence can never satisfy or defeat an assertion about code.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('EVERY "nothing unresolved" claim flows through the shared helper — no private copy', () => {
    // 4 branches assert it (still-running, ended-without-outcome, user-stopped, resolved-only) and the
    // success branch reads the note directly. A future branch that hard-codes the claim instead is
    // exactly how this defect survived its own autopsy, which fixed one of the four.
    const viaHelper = code.match(/nothingUnresolved\(/g) ?? [];
    expect(viaHelper.length).toBe(4); // the four branches; the definition itself is `nothingUnresolved =`
    // …and no branch may return the bare claim as a literal any more.
    expect(code).not.toMatch(/and no unresolved issue has been recorded so far\./);
    expect(code).not.toMatch(/and no unresolved issue was recorded either\./);
    expect(code).not.toMatch(/Nothing failed, and no unresolved problem was recorded\./);
  });

  it('the ok===true branch is decided BEFORE the bare `problem.message` return', () => {
    const okBranch = code.indexOf('if (ok === true) {');
    const bare = code.indexOf('if (problem) return problem.message;');
    expect(okBranch).toBeGreaterThan(-1);
    expect(bare).toBeGreaterThan(-1);
    // Order is the whole fix: below the bare return, a successful build would never reach it.
    expect(okBranch).toBeLessThan(bare);
  });

  it('TEST_SUITE is deliberately NOT in NEVER_ROOT_CAUSE, while its unverified sibling is', () => {
    const set = code.slice(code.indexOf('const NEVER_ROOT_CAUSE'));
    const block = set.slice(0, set.indexOf(']);'));
    expect(block).toContain("'TEST_SUITE_UNVERIFIED'");
    expect(block).not.toContain("'TEST_SUITE',");
  });
});
