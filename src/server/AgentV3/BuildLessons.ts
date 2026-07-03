// AgentV3 — turn a build's DIAGNOSTICS (what actually went wrong) into a durable, specific LESSON.
//
// The self-learning loop already exists (reflect → record note → user brain → recall into future
// builds), but it learned from the generic build SUMMARY, not from the rich build report. So the real
// struggles the report captured — the root cause, the unresolved problems, the judge's findings — were
// never distilled into a lesson, and the SAME mistakes could recur. This pure function distils them
// into one concise, actionable lesson string the reflection records (so it flows to the session memory
// AND the cross-project user brain), fulfilling "galtiyon se seekhe, repeat na kare".
//
// PURE & deterministic (diagnostics in → lesson string | null out) → fully unit-testable.

export interface DiagnosticsLessonInput {
  ok?: boolean;
  rootCause?: string;
  /** The non-info problems channel (already noise-filtered by BuildDiagnostics). */
  problems?: Array<{ severity?: string; message?: string; code?: string }>;
  /** The Sonnet judge's findings, when it failed a cheap build. */
  judgeFindings?: string[];
}

/** How many distinct problems to fold into one lesson (keep it short + memorable). */
const MAX_PROBLEMS = 3;

/**
 * Distil a build's diagnostics into ONE actionable lesson, or null when there is nothing worth
 * learning (a genuinely clean build). PURE.
 */
export function buildLessonFromDiagnostics(d: DiagnosticsLessonInput): string | null {
  if (!d) return null;
  const problems = (d.problems ?? [])
    .filter((p) => (p.severity === 'error' || p.severity === 'warning') && (p.message || '').trim())
    // Readiness/tooling noise that is not a transferable lesson.
    .filter((p) => p.code !== 'HEARTBEAT' && p.code !== 'TOOL_CALL' && p.code !== 'TOOL_DONE')
    .map((p) => (p.message || '').trim());
  const judge = (d.judgeFindings ?? []).map((f) => (f || '').trim()).filter(Boolean);

  // A clean, judge-passed build with no rootCause + no problems teaches nothing — skip (no memory churn).
  if (d.ok && problems.length === 0 && judge.length === 0 && !d.rootCause) return null;

  const parts: string[] = [];
  if (d.rootCause && d.rootCause.trim()) parts.push(`root cause was "${d.rootCause.trim()}"`);
  if (judge.length) parts.push(`the strong review found: ${judge.slice(0, MAX_PROBLEMS).join('; ')}`);
  const probTop = problems.slice(0, MAX_PROBLEMS);
  if (probTop.length) parts.push(`unresolved problems: ${probTop.join('; ')}`);
  if (parts.length === 0) return null;

  const outcome = d.ok ? 'A build shipped but had issues' : 'A build failed';
  return `LESSON — ${outcome}: ${parts.join(', ')}. Watch for and prevent this next time.`;
}
