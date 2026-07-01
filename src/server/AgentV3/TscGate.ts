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
