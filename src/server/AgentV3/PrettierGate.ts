// P-PIPE (roadmap Tier 2E) — build-end PRETTIER advisory. The lint quartet already RUNS prettier
// (`detectLinters` plans `prettier --check`), but the LintGate blocks only on real ESLint errors —
// "warnings/formatting never block" — so on a normal build a project's formatting drift is never surfaced
// at build-end at all. This closes that gap the same honest way the CVE/license (#1551) and observability
// (#1548) advisories did: after a SUCCESSFUL build, report which files are unformatted (never blocks — a
// formatting nit must not fail a working app), and stay silent when clean, not-configured, or the tool
// could not run (so we never emit a FALSE "needs formatting" when prettier simply isn't installed).
//
// PURE verdict here (unit-tested); the impure run rides the sandbox actuator (ToolDispatcher.assessPrettierGate).
// Reuses lintRunner's `parseLintOutcome` for the prettier output parse so the two never drift.

import { parseLintOutcome, type LintPlan } from './lintRunner';

export interface PrettierGateResult {
  /** False when prettier could not execute at all (not installed / command threw) — never a false advisory. */
  ran: boolean;
  /** True when every file is already formatted. */
  formatted: boolean;
  /** How many files need formatting (0 when formatted / could-not-run). */
  count: number;
  /** A few representative unformatted file paths (capped). */
  files: string[];
}

// Signals that `npx --no-install prettier` could not run at all (vs. "ran and found unformatted files").
const COULD_NOT_RUN = /command not found|could not determine an executable to run|not found|ENOENT|npm error|npm ERR!|could not find/i;

/**
 * Classify a `prettier --check` run into an honest result. Pure. A non-zero exit whose output looks like a
 * missing-tool error → ran:false (so the gate stays silent instead of reporting every line as "unformatted").
 * Otherwise defers to lintRunner's parse so the file list matches the `lint` tool exactly.
 */
export function prettierGateResult(exitCode: number, stdout: string, stderr: string): PrettierGateResult {
  const text = `${stdout || ''}\n${stderr || ''}`;
  if (exitCode !== 0 && COULD_NOT_RUN.test(text)) {
    return { ran: false, formatted: false, count: 0, files: [] };
  }
  const plan: LintPlan = { tool: 'prettier', command: 'npx --no-install prettier --check .', reason: 'build-end advisory' };
  const outcome = parseLintOutcome(plan, exitCode, stdout, stderr);
  const formatted = outcome.ok;
  return {
    ran: true,
    formatted,
    count: formatted ? 0 : (outcome.errorCount ?? outcome.firstIssues.length),
    files: formatted ? [] : outcome.firstIssues,
  };
}

/**
 * The advisory block appended to a successful build's summary. Pure. Empty string when there is nothing to
 * advise — clean, not-configured (ran:false with no files), or could-not-run — so it never adds noise and
 * never emits a false positive. Never blocks a build (advisory only).
 */
export function prettierAdvisory(r: PrettierGateResult): string {
  if (!r || !r.ran || r.formatted) return '';
  const n = r.count || r.files.length;
  if (n === 0) return '';
  const list = r.files.slice(0, 8).map((f) => `  • ${f}`).join('\n');
  const more = r.files.length > 8 ? `\n  …and more` : '';
  return `🎨 Prettier: ${n} file(s) are not formatted — run \`prettier --write .\` to fix (advisory, does not block the build):${list ? `\n${list}${more}` : ''}`;
}
