/**
 * Guider — shared, provider-agnostic "requirements brain" that wraps ANY generator
 * (NavBharatAI Pro's build OR EngineerAI's agent loop) with a closed control loop:
 *
 *   understand → PROPOSE a design → CONFIRM with the user → build → grade → refine
 *
 * Two hard product rules baked into these types:
 *  1. The guider may design its OWN plan, but it must NEVER implement that plan
 *     directly — the caller has to get the user's confirmation first
 *     (`confirmationRequired`). See Guider.run()'s confirmation gate.
 *  2. Everything the user reads (the design proposal, clarifying questions) is in
 *     the USER'S OWN LANGUAGE (`GuiderPlan.language`).
 *
 * The guider is decoupled from both systems: callers inject a `callModel` (for
 * interpret/grade) and a `generate` (the real builder). It lives outside Pro so
 * Pro and EngineerAI can both use it.
 */

/** One checkable acceptance criterion derived from the user's request. */
export interface AcceptanceCriterion {
  id: string;
  text: string;
}

/** Structured understanding of what the user actually wants. */
export interface GuiderSpec {
  summary: string;
  requirements: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  outOfScope: string[];
}

/**
 * Result of the interpret stage. The caller shows `designProposal` (+ any
 * `clarifyingQuestions`) to the user IN `language`, and only calls Guider.run()
 * once the user has confirmed.
 */
export interface GuiderPlan {
  /** The user's language (e.g. 'hi', 'en', 'hinglish') — all user-facing text uses it. */
  language: string;
  spec: GuiderSpec;
  /** The guider's proposed design/plan, written in the user's language. */
  designProposal: string;
  /** True ⇒ the caller MUST get user confirmation before Guider.run() implements it. */
  confirmationRequired: boolean;
  /** Optional questions (in the user's language) when the request is ambiguous. */
  clarifyingQuestions: string[];
}

/** A single unmet acceptance criterion found by the grader. */
export interface GuiderGap {
  criterionId: string;
  issue: string;
}

/** The grader's verdict on one generated result against the spec. */
export interface GuiderGrade {
  pass: boolean;
  /** 0–100 quality/coverage score. */
  score: number;
  gaps: GuiderGap[];
  summary: string;
}

export type GuiderPhase =
  | 'interpreting'
  | 'awaiting_confirmation'
  | 'generating'
  | 'grading'
  | 'refining'
  | 'done'
  | 'stopped';

/** Progress event the caller can surface in the UI (professional, transparent). */
export interface GuiderProgress {
  phase: GuiderPhase;
  message: string;
  iteration?: number;
  score?: number;
}

/**
 * What the injected `generate` returns. `gradeContext` is a compact textual view
 * of the produced artifact (file tree + validation report + key snippets) that the
 * grader reads — keeping the guider agnostic to how the artifact is stored.
 */
export interface GenResult {
  ok: boolean;
  gradeContext: string;
  /** Opaque payload passed back to the caller untouched (e.g. the files map). */
  raw?: unknown;
}

export type GuiderStatus = 'passed' | 'budget_exhausted' | 'no_progress' | 'stopped';

/** Final outcome of the build→grade→refine loop. Honest — never a fake "done". */
export interface GuiderRunResult {
  status: GuiderStatus;
  iterations: number;
  finalGrade?: GuiderGrade;
  /** The best result produced (highest grade), even when status isn't 'passed'. */
  output?: GenResult;
}
