import { describe, it, expect } from 'vitest';
import { isExpectedNonzeroExit } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * ⚠️ A WORKING COMMAND BECAME A BUILD'S REPORTED ROOT CAUSE (admin's live report, 2026-08-25):
 *
 *     rootCause: "$ diff <(grep …) <(grep …) → exit 1 (0s)"
 *
 * The diff had worked perfectly. The agent was comparing two lists of translation keys, and `diff`
 * exits 1 precisely when the files DIFFER — exit 1 is the ANSWER it went looking for, not a failure.
 *
 * Same family as every name already on that line (grep, ss, lsof, which, test…): a diagnostic tool
 * reporting a finding, read as the tool failing. The day's pattern once more — an exit code standing in
 * for a verdict it does not carry.
 */
describe('a diff that found differences is an answer, not a failure', () => {
  it('exit 1 from diff is expected — that is what "they differ" looks like', () => {
    expect(isExpectedNonzeroExit('diff a.txt b.txt', 1)).toBe(true);
    expect(isExpectedNonzeroExit('diff <(grep -E "^k:" a.tsx) <(grep -E "^k:" b.tsx)', 1)).toBe(true);
  });

  it('exit 2 is a REAL diff error and stays a failure — a missing file, a bad flag', () => {
    // The distinction is the whole reason this is not a blanket exemption.
    expect(isExpectedNonzeroExit('diff a.txt missing.txt', 2)).toBe(false);
  });

  it('a path-prefixed diff is still diff', () => {
    expect(isExpectedNonzeroExit('/usr/bin/diff a b', 1)).toBe(true);
  });

  it('exit 0 is never "expected non-zero" — the guard is about failures only', () => {
    expect(isExpectedNonzeroExit('diff a b', 0)).toBe(false);
  });

  it('a diff PIPED into something else is judged by the last segment, as before', () => {
    // Unchanged behaviour, asserted so the new branch cannot be read as changing pipeline handling.
    expect(isExpectedNonzeroExit('diff a b | head -5', 1)).toBe(false);
    expect(isExpectedNonzeroExit('diff a b | grep foo', 1)).toBe(true); // grep found nothing
  });
});

/**
 * DELIBERATELY NOT EXEMPTED, and this is the judgement call worth recording.
 *
 * The same report carried a second "error": `cd client && tsc --noEmit …` exiting 1. That one is NOT
 * the same thing. A whole-project typecheck exiting 1 means real type errors exist in the user's app —
 * which is exactly what the build should surface, and silencing it to tidy a report would hide a
 * genuine defect. Only the SELF-INVALIDATING single-file probe is excused, and that already has its own
 * rule (isUnconfiguredTscFileProbe).
 */
describe('a real typecheck failure is still a failure', () => {
  it('a whole-project tsc --noEmit exiting 1 is not excused', () => {
    expect(isExpectedNonzeroExit('tsc --noEmit', 1)).toBe(false);
    expect(isExpectedNonzeroExit('cd client && ../node_modules/.bin/tsc --noEmit', 1)).toBe(false);
  });
});
