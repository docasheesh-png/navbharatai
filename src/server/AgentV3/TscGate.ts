// AgentV3 — pure helper for the post-build TypeScript compile gate.
//
// Both the fast lane (SimpleBuilder.fastVerify) and the new agentic-loop gate need to answer the same
// question from raw `tsc --noEmit` output: "did the compiler report a real type error?". Keeping that
// decision in ONE pure, unit-tested function stops the two call-sites from drifting apart (one of them
// treating a warning as a failure, or missing a real error) — the same single-parser discipline used
// by ContractMap. PURE & deterministic (string in → boolean out), so it is fully testable.

/**
 * True when `tsc --noEmit` output contains at least one real TypeScript compile error (`error TSxxxx`).
 * Warnings, clean runs, and empty/undefined output are all NOT failures. Pure.
 */
export function hasTscErrors(output: string | null | undefined): boolean {
  if (!output) return false;
  return /error TS\d+/.test(output);
}

/**
 * How many real TypeScript diagnostics the output contains.
 *
 * Lives beside `hasTscErrors` on purpose — same single-parser discipline. A repair is only worth
 * keeping if it made the compiler quieter, and answering "quieter?" needs a COUNT, not a boolean.
 * `hasTscErrors` cannot tell 4 errors from 41, which is exactly how a repair that quadrupled the
 * error count was accepted and written over a working file (real build report 2026-08-23).
 *
 * Counts `error TS####` occurrences. tsc's own trailer ("Found 41 errors in 7 files.") carries no
 * `error TS`, so it cannot inflate the count. Pure.
 */
export function countTscErrors(output: string | null | undefined): number {
  if (!output) return 0;
  return (output.match(/error TS\d+/g) ?? []).length;
}

/**
 * True when `tsc --noEmit` output is the CLI HELP/version page rather than a real compile result —
 * what `tsc` prints when there is no tsconfig.json AND no input files, exiting 0. Treating that as a
 * clean pass is a FALSE pass: the type-check never actually ran (a real report hit exactly this — a
 * config-less project's `tsc` "passed" while runtime types were broken). Callers should ensure a
 * tsconfig exists (so tsc really verifies) instead of trusting this output. Pure.
 */
export function looksLikeTscHelpOutput(output: string | null | undefined): boolean {
  if (!output) return false;
  return /tsc:\s*The TypeScript Compiler|COMMON COMMANDS|Compiles the current project|tsc \[options\]|Version\s+\d+\.\d+\.\d+[\s\S]*Syntax:/.test(output);
}
