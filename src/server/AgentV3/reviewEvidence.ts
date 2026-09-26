// AgentV3 — a reviewer's claim that the platform's own evidence has already refuted is not a finding.
//
// 🔴 WHY (autopsy b10aae9a, 2026-09-26). A stationary-log app rendered in a real browser, `tsc --noEmit`
// exited 0, `npm run build` exited 0, and the release gate printed "Proven: … the project typechecks".
// The post-build reviewer then reported:
//
//     [CRITICAL] (confidence: high) TypeScript build errors are present. The user memory reports:
//     - write-typecheck: 3 error(s) in src/components/StationaryList.tsx
//     - write-typecheck: 8 error(s) in src/components/StationaryItem.tsx
//
// Those were the PREVIOUS build's errors, still sitting in project memory as "Recent errors" after they
// had been fixed (the memory half is fixed in `WorkspaceMemory.markTscClean`). The reviewer is read-only:
// it cannot run the compiler, so every compile claim it makes is an INFERENCE. The platform had run the
// compiler. The inference reached the user's summary as "I also noticed one thing I could improve", and
// the same report said, a few lines apart, that the project typechecks and that it has TypeScript errors.
//
// The rule: when the compiler has been run and passed, a reviewer finding whose claim IS "it does not
// compile" is refuted by evidence and dropped — recorded for the admin, never shown to the user, never
// repaired, never allowed to fail a build. It is PRECISION-FIRST: only a finding whose FIRST SENTENCE
// asserts a compile failure is touched. A finding about behaviour, security or design that merely
// mentions TypeScript stays exactly as it was, because swallowing a real finding hides a defect for ever.
// PURE.

import type { ReviewIssue, ReviewResult } from './ReviewerAgent';

/** The platform's own evidence a reviewer claim can be checked against. */
export interface PlatformEvidence {
  /** The release gate's typecheck verdict ('passed' only after a real compile came back clean). */
  typecheck?: string;
}

const COMPILE_FAILURE_CLAIM_RE = new RegExp(
  [
    // "TypeScript (build) errors are present", "tsc errors", "type errors found", "compile errors"
    String.raw`\b(type ?script|tsc|type[- ]?check(?:ing)?|type|compil(?:e|er|ation))\b[^.!?\n]{0,30}\berrors?\b`,
    // "does not compile", "will fail to typecheck", "fails to build with type errors"
    String.raw`\b(does not|doesn't|do not|don't|won't|will not|would not|fails? to|failed to|cannot|can't)\s+(compile|type[- ]?check)\b`,
  ].join('|'),
  'i',
);

/** The first sentence of a finding, with its severity tag and confidence marker removed. */
function claimOf(message: string): string {
  const t = String(message ?? '')
    .replace(/^\s*\[(critical|warning|major|minor|high|low|suggestion)\]\s*/i, '')
    .replace(/^\s*\(confidence:\s*\w+\)\s*/i, '')
    .trim();
  const end = t.search(/[.!?](\s|$)|\n/);
  return end >= 0 ? t.slice(0, end) : t;
}

/** Does this finding ASSERT that the project fails to compile? Only its first sentence counts. PURE. */
export function claimsCompileFailure(message: string): boolean {
  return COMPILE_FAILURE_CLAIM_RE.test(claimOf(message));
}

/**
 * Split a review into what stands and what the evidence refutes. Nothing is refuted unless the compiler
 * really passed, so a build whose typecheck failed or never ran keeps every finding exactly as before.
 *
 * The refuted findings are removed from `issues` (so no repair, no suggestion, no failed verdict can be
 * built on them), `passed` is recomputed from what is left, and a summary that merely repeats a refuted
 * finding is replaced by the first finding that stands. The score is left as the reviewer gave it:
 * inventing a better number would be its own untrue claim.
 */
export function refuteReviewByEvidence(
  review: ReviewResult,
  evidence: PlatformEvidence,
): { review: ReviewResult; refuted: ReviewIssue[] } {
  if (!review || evidence?.typecheck !== 'passed') return { review, refuted: [] };
  const refuted = review.issues.filter((i) => claimsCompileFailure(i.message));
  if (refuted.length === 0) return { review, refuted: [] };
  const kept = review.issues.filter((i) => !refuted.includes(i));
  const summaryRepeatsRefuted = refuted.some((i) => {
    const claim = claimOf(i.message).slice(0, 40).toLowerCase();
    return claim.length > 0 && String(review.summary ?? '').toLowerCase().includes(claim);
  }) || claimsCompileFailure(review.summary ?? '');
  const summary = summaryRepeatsRefuted
    ? (kept[0]?.message ?? 'No finding the platform could confirm.')
    : review.summary;
  return {
    review: { ...review, issues: kept, passed: !kept.some((i) => i.severity === 'critical'), summary },
    refuted,
  };
}
