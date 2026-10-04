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
  /**
   * The project's stylesheets, path → content, read from the workspace at review time. Present only
   * when a finding claims a CSS class is missing — see `missingClassClaim`.
   */
  stylesheets?: Record<string, string>;
}

// ── A CLAIM A FILE CAN ANSWER (autopsy 15151196, 2026-09-27) ──────────────────────────────────────
// The reviewer reported, at `high` confidence, that `badge`, `alert`, `alert-success`, `muted` and
// `primary` were "used in src/App.tsx, but none of these classes are defined in src/index.css". All five
// were there (lines 64–137); its grep had been run in the wrong regex dialect. The claim is a FACT
// about a file, which the platform can check in microseconds, and it was instead handed to a repair
// agent — which checked, found them, and changed nothing, while the user was told two bugs were fixed.
// So a finding whose first sentence says named classes are not defined is checked against the real
// stylesheets first. Refuted only when EVERY class it names has a selector; one missing class and the
// finding stands, whole.

const MISSING_CLAIM_RE = /\b(?:not|never|nowhere|isn'?t|aren'?t)\s+(?:be\s+)?(?:defined|declared|present|found|styled)\b|\bnone\s+of\s+(?:these|those|the|them)\b[^.!?]{0,40}\b(?:is|are)\s+(?:defined|declared|present|styled)\b|\b(?:is|are)\s+(?:missing|undefined)\b|\bmissing\s+(?:css\s+)?class|\bundefined\s+(?:css\s+)?class|\bdo(?:es)?\s+not\s+exist\b|\bdon'?t\s+exist\b/i;

/**
 * The class names a finding claims are not defined, or null when it makes no such claim. Names come
 * only from `className="…"` / `class="…"` values and backticked `.selectors` in the FIRST sentence —
 * never guessed from prose. PURE.
 */
export function missingClassClaim(message: string): string[] | null {
  const claim = claimOf(message);
  if (!/\bclass(?:es|name)?\b/i.test(claim) || !MISSING_CLAIM_RE.test(claim)) return null;
  const names = new Set<string>();
  for (const m of claim.matchAll(/\bclass(?:Name)?\s*=\s*\\?["'{`]([^"'`}]+)["'`}]/g)) {
    for (const n of m[1].split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(n)) names.add(n);
  }
  for (const m of claim.matchAll(/`\.([A-Za-z_][\w-]*)`/g)) names.add(m[1]);
  return names.size > 0 ? [...names] : null;
}

/** Is there a selector for `.name` anywhere in these stylesheets? PURE. */
export function classIsDefined(name: string, stylesheets: Record<string, string>): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\.${esc}(?![\\w-])`);
  return Object.values(stylesheets).some((css) => re.test(String(css ?? '')));
}

/** A finding that only restates a refuted class claim ("the missing classes still leave…"). */
const DERIVED_CLASS_CLAIM_RE = /\bthe\s+missing\s+(?:css\s+)?class(?:es|names)?\b/i;

const COMPILE_FAILURE_CLAIM_RE = new RegExp(
  [
    // "TypeScript (build) errors are present", "tsc errors", "type errors found", "compile errors"
    String.raw`\b(type ?script|tsc|type[- ]?check(?:ing)?|compil(?:e|er|ation))\b[^.!?\n]{0,30}\berrors?\b`,
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

/** A sentence about how the code is TYPED or WIRED — the kind of cause a "will not compile" rests on. */
const TYPE_LEVEL_RE = /\b(import(?:s|ed|ing)?|export(?:s|ed)?|types?|typed|enums?|interfaces?|declar\w*|modules?|generics?|tsconfig|annotat\w*|casts?|signature|circular)\b/i;
/** A sentence about what a USER meets — never swallowed with a refuted compile claim. */
const BEHAVIOUR_RE = /\b(click\w*|press\w*|tap\w*|crash\w*|render\w*|display\w*|shows?|shown|sav(?:e|es|ed|ing)|load\w*|data|users?|buttons?|pages?|screens?|los(?:e|es|t)|security|xss|secret|leak\w*|slow|freez\w*|blank)\b/i;

function sentencesOf(message: string): string[] {
  const t = String(message ?? '')
    .replace(/^\s*\[(critical|warning|major|minor|high|low|suggestion)\]\s*/i, '')
    .replace(/^\s*\(confidence:\s*\w+\)\s*/i, '')
    .trim();
  return t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * A compile claim LATER in a finding (autopsy f496c75b: "src/game/types.ts imports the enum as a type.
 * This file will not compile."). Only the first sentence used to count, so a passing typecheck could not
 * refute it. Now, with the compiler passed: 'whole' when every other sentence is about how the code is
 * typed or wired (the claim IS the finding); the finding WITHOUT its compile sentences when it also says
 * something about behaviour (that part stands, untouched); null when no later sentence claims a compile
 * failure. PURE.
 */
export function laterCompileClaim(message: string): 'whole' | string | null {
  const parts = sentencesOf(message);
  if (parts.length < 2) return null;
  const compile = parts.slice(1).filter((x) => COMPILE_FAILURE_CLAIM_RE.test(x));
  if (compile.length === 0) return null;
  const rest = parts.filter((x) => !compile.includes(x));
  if (rest.every((x) => TYPE_LEVEL_RE.test(x) && !BEHAVIOUR_RE.test(x))) return 'whole';
  const prefix = String(message).match(/^\s*(?:\[[a-z]+\]\s*)?(?:\(confidence:\s*\w+\)\s*)?/i)?.[0] ?? '';
  return prefix + rest.join(' ');
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
): { review: ReviewResult; refuted: ReviewIssue[]; amended: ReviewIssue[] } {
  if (!review) return { review, refuted: [], amended: [] };
  const sheets = evidence?.stylesheets && Object.keys(evidence.stylesheets).length > 0 ? evidence.stylesheets : null;
  const refutedSet = new Set<ReviewIssue>();
  const amendedMap = new Map<ReviewIssue, string>();
  if (evidence?.typecheck === 'passed') {
    for (const i of review.issues) {
      if (claimsCompileFailure(i.message)) { refutedSet.add(i); continue; }
      const later = laterCompileClaim(i.message);
      if (later === 'whole') refutedSet.add(i);
      else if (later) amendedMap.set(i, later);
    }
  }
  if (sheets) {
    const classClaims = review.issues.map((i) => ({ i, names: missingClassClaim(i.message) })).filter((c) => c.names);
    const standing = classClaims.filter((c) => !c.names!.every((n) => classIsDefined(n, sheets)));
    for (const c of classClaims) if (!standing.includes(c)) refutedSet.add(c.i);
    // A follow-on finding that rests on "the missing classes" falls with them — but only when every
    // class claim in this review was refuted, so it can never lean on one that stands.
    if (classClaims.length > 0 && standing.length === 0) {
      for (const i of review.issues) if (DERIVED_CLASS_CLAIM_RE.test(i.message)) refutedSet.add(i);
    }
  }
  const refuted = review.issues.filter((i) => refutedSet.has(i));
  const amended = review.issues.filter((i) => amendedMap.has(i) && !refutedSet.has(i));
  if (refuted.length === 0 && amended.length === 0) return { review, refuted: [], amended: [] };
  const kept = review.issues.filter((i) => !refuted.includes(i))
    .map((i) => (amendedMap.has(i) ? { ...i, message: amendedMap.get(i)! } : i));
  const summaryRepeatsRefuted = refuted.some((i) => {
    const claim = claimOf(i.message).slice(0, 40).toLowerCase();
    return claim.length > 0 && String(review.summary ?? '').toLowerCase().includes(claim);
  }) || (evidence?.typecheck === 'passed' && claimsCompileFailure(review.summary ?? ''));
  const summary = summaryRepeatsRefuted
    ? (kept[0]?.message ?? 'No finding the platform could confirm.')
    : review.summary;
  return {
    review: { ...review, issues: kept, passed: !kept.some((i) => i.severity === 'critical'), summary },
    refuted,
    amended,
  };
}
