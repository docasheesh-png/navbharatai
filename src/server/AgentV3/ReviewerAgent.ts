// AgentV3 — Reviewer Agent (Level 8 — multi-agent post-build review).
//
// After the main Architect build loop finishes successfully, a focused
// ReviewerAgent evaluates the complete result against the user's original
// request: "Does the app do what was asked? Is anything missing? Any bugs?"
//
// This is the multi-agent review pattern — a separate AI perspective,
// independent from the agent that built the app. It runs on the same free router
// (via sub-agent spawn) so it costs no extra credits and its findings are emitted
// as narration events visible in the chat. Best-effort — never throws.

import type { SubAgentSpawn } from './ToolDispatcher';

export interface ReviewIssue {
  severity: 'critical' | 'warning' | 'suggestion';
  file?: string;
  message: string;
}

export interface ReviewResult {
  /** False only when at least one CRITICAL issue was found. */
  passed: boolean;
  /** 0 = review was skipped; 1-100 = quality score from the reviewer. */
  score: number;
  issues: ReviewIssue[];
  summary: string;
}

/**
 * A MARKDOWN SECTION HEADING is not a finding. Reviewers routinely write a header like
 * "### [CRITICAL] Issues", "## Critical Issues", or "**Findings**" above the actual list —
 * and a naive per-line `[tag]` scan mis-counts that header as a real critical. Deep-test
 * 66ec5c1e: a "### [CRITICAL] Issues" header became a PHANTOM critical that FAILED a working,
 * render-verified app (and drove the auto-fix loop until the 29-min wall-clock cap). After the
 * severity tag + markdown is stripped, a bare section label is never a finding — skip it.
 */
const SECTION_LABEL_RE =
  /^(critical\s+|major\s+|minor\s+|high\s+|low\s+|potential\s+|other\s+)?(issues?|findings?|problems?|warnings?|suggestions?|concerns?|observations?|summary|assessment|overview|conclusion|review|code review( report)?|report)\s*:?\s*$/i;

/**
 * SELF-DISMISSAL inside a single finding: the reviewer tagged the line [CRITICAL] (often only
 * because a tool flagged it) but then, in the SAME finding, concludes it is NOT real — "this is
 * a false positive", "not a genuine issue". A finding the reviewer discharged in its own words
 * must NOT fail the build. Deep-test 66ec5c1e: the reviewer wrote "this may be a false positive
 * from the tool … the project appears to build and run without it" for BOTH of its criticals, yet
 * the app was reported broken and the auto-fix loop chased the phantoms until the wall-clock cap.
 * Conservative — only the unambiguous "false positive" / "not a real/genuine issue" phrasings, so
 * a genuine critical is never silently downgraded. Such a finding is demoted to a suggestion:
 * retained for the admin audit trail, but never a build-failing critical/warning.
 */
const SELF_DISMISSED_RE =
  /\bfalse[\s-]?positive\b|\bnot (a |an )?(real|actual|genuine|true|valid) (issue|problem|bug|concern|error|violation|vulnerability)\b/i;

/** Parse structured reviewer text into typed issues (best-effort). Exported for direct unit tests. */
export function parseReviewOutput(text: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const line of text.split('\n')) {
    const lower = line.toLowerCase();
    let severity: ReviewIssue['severity'] | null = null;
    if (lower.includes('[critical]') || lower.startsWith('critical:') || line.includes('🚨'))
      severity = 'critical';
    else if (lower.includes('[warning]') || lower.startsWith('warning:') || line.includes('⚠️'))
      severity = 'warning';
    else if (lower.includes('[suggestion]') || lower.startsWith('suggestion:') || line.includes('💡'))
      severity = 'suggestion';
    if (severity) {
      const message = line
        .replace(/\[(critical|warning|suggestion)\]/gi, '')
        .replace(/^(critical|warning|suggestion):/gi, '')
        .replace(/^[#>\s]+/, '')            // strip leading markdown heading (#) / blockquote (>) markers
        .replace(/^\d+[.)]\s*/, '')         // strip a leading list number ("1. ", "2) ")
        .replace(/^[🚨⚠️💡\s•\-*]+/, '')
        .replace(/\*+/g, '')                // strip markdown bold/italic asterisks
        .trim();
      if (!message) continue;
      // A markdown SECTION HEADER ("### [CRITICAL] Issues") is not a finding — never count it.
      if (SECTION_LABEL_RE.test(message)) continue;
      // The reviewer discharged its own finding as a false positive → demote so it can't fail the build.
      const effective: ReviewIssue['severity'] =
        severity !== 'suggestion' && SELF_DISMISSED_RE.test(line) ? 'suggestion' : severity;
      issues.push({ severity: effective, message });
    }
  }
  return issues;
}

// Post-review auto-fix scope (autopsy 2026-07-11, Notes report): the C9 repair pass fixes the
// reviewer's [CRITICAL] findings, but the Notes app's REAL functional bugs were all [WARNING]
// severity ("auto-focus broke", "sort ignores edits", "isAtLimit blocks Add") — so they shipped
// unfixed. Not every warning deserves an (expensive) repair pass though: a11y polish, landmarks,
// naming and pure style are advisory. These two pure classifiers split a WARNING into "functional
// (a stated behaviour is broken/missing → worth fixing)" vs "cosmetic (advisory polish → leave it)".

/** Cosmetic / advisory warning signals — NOT worth an auto-repair pass (a11y polish, naming, style). */
const COSMETIC_WARNING_RE = /\b(aria-?\w*|landmark|<main>|semantic|role=|naming|readability|consider (adding|using|renaming)|could be|would be (nice|better|cleaner)|stylistic|cosmetic|whitespace|formatting|indentation|spacing|margin|padding|comment(s|ing)?|prefer\b|nit\b|minor)\b/i;

/** Functional / correctness signals — a warning that names BROKEN behaviour or an unmet requirement. */
const FUNCTIONAL_WARNING_RE = /\b(broke\w*|does ?n'?t|do ?n'?t|not work\w*|fail\w*|bug|incorrect|wrong|invalid|missing|never (fires|works|holds|updates|renders)|steal\w* focus|conflict\w*|ignor\w*|unnecessar\w*|block\w*|mismatch\w*|off-by|race\b|crash\w*|throw\w*|undefined\b|null\b|requirement|logic error)\b/i;

/**
 * From a reviewer's issues, pick the WARNINGs worth an automatic repair pass: functional/correctness
 * warnings (a behaviour the user asked for is broken or missing), excluding purely cosmetic/advisory
 * ones. Pure & deterministic — a fuzzy classifier over the reviewer's own text, kept conservative
 * (must match a functional signal AND not read as cosmetic) so it never churns on style nits.
 */
export function selectAutoFixableWarnings(issues: ReviewIssue[]): ReviewIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter((i) =>
    i && i.severity === 'warning' && typeof i.message === 'string' && i.message.trim().length > 0
    && FUNCTIONAL_WARNING_RE.test(i.message)
    && !COSMETIC_WARNING_RE.test(i.message),
  );
}

/** Source-file extensions that mean "there is real reviewable code in the workspace". */
const SOURCE_RE = /\.(tsx?|jsx?|html?|css|scss|vue|svelte|astro|mjs|cjs|py|go|java|php|rb|rs|swift|kt)$/i;

/**
 * Whether the file listing contains real source the reviewer can judge. Used to GUARD the
 * post-build review: if the workspace read came back empty (a sandbox read hiccup after a
 * successful build, where files genuinely exist), the reviewer has nothing to look at — and must
 * NOT be allowed to declare "missing all source code, 0/100", which is a false negative that
 * contradicts the build the user just watched succeed.
 */
export function hasReviewableSource(fileTree: string[]): boolean {
  return Array.isArray(fileTree) && fileTree.some((p) => SOURCE_RE.test(p));
}

/**
 * Spawn a focused post-build review sub-agent that checks the built app against
 * the user's original request. Returns a structured ReviewResult.
 * Best-effort — resolves to a neutral score-0 result if the spawn fails.
 */
export async function reviewBuild(opts: {
  userRequest: string;
  fileTree: string[];
  fileSample: { path: string; content: string }[];
  spawn: SubAgentSpawn;
}): Promise<ReviewResult> {
  const { userRequest, fileTree, fileSample } = opts;

  // Defensive: never review an unreadable/empty workspace — an empty listing means we could not
  // read the files, NOT that the app has no code. Return a neutral, honest skipped result so the
  // user never sees a false "missing all source code, 0/100" after a successful build.
  if (!hasReviewableSource(fileTree)) {
    return {
      passed: true,
      score: 0,
      issues: [],
      summary: 'Review skipped — the workspace file listing could not be read (the build still completed).',
    };
  }

  const fileContext = fileSample
    .slice(0, 5)
    .map(
      ({ path, content }) =>
        `\n--- ${path} (${content.length} chars) ---\n${content.slice(0, 500)}`,
    )
    .join('\n');

  const instruction = [
    'You are a code reviewer. Evaluate whether the app fully meets the user\'s request.',
    '',
    `USER REQUEST: "${userRequest}"`,
    '',
    `FILES BUILT (${fileTree.length} total):`,
    fileTree.slice(0, 20).join('\n'),
    '',
    'SAMPLE FILE CONTENTS:',
    fileContext,
    '',
    'For each issue, prefix the line with [CRITICAL], [WARNING], or [SUGGESTION]:',
    '  [CRITICAL] = feature is missing or completely broken.',
    '  [WARNING]  = works but has a bug or missing edge case.',
    '  [SUGGESTION] = minor improvement that would help.',
    '',
    'Be precise with [CRITICAL] — it fails the whole build, so only use it for a real, confirmed break:',
    '  • Put the severity tag on the FINDING itself, never on a section heading (do not write "### [CRITICAL] Issues").',
    '  • If you inspect a tool-reported problem and conclude it is a false positive, or the app builds and',
    '    runs fine despite it, do NOT tag it [CRITICAL] — omit it, or use [SUGGESTION]. Never label a finding',
    '    [CRITICAL] and then explain in the same finding that it is a false positive.',
    '',
    'End with: "Score: N/100" (where N = your quality assessment).',
    'If everything looks good, just write: [PASS] App looks complete. Score: 90',
  ].join('\n');

  try {
    const { ok, summary } = await opts.spawn('reviewer', instruction);
    // VAJRA V4-2 honesty: a reviewer that FAILED (ok:false — e.g. its own prompt hit a provider
    // limit) or whose "summary" is itself a provider-failure error must NOT render as a real review
    // with a made-up "(85/100)" score (report 2026-07-07: "⚠️ Build Review (85/100): Error: All v5.0
    // providers failed…"). Score 0 → formatReview shows nothing; the build stands on its own gates.
    if (ok === false || isReviewFailureSummary(summary)) {
      return { passed: true, score: 0, issues: [], summary: 'Review did not complete.' };
    }
    const issues = parseReviewOutput(summary);
    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const passed = criticalCount === 0;
    const scoreMatch = summary.match(/score[:\s]+(\d+)/i);
    const score = scoreMatch
      ? Math.min(100, Math.max(1, parseInt(scoreMatch[1], 10)))
      : passed
      ? 85
      : 40;
    return { passed, score, issues, summary: summary.slice(0, 600) };
  } catch {
    return { passed: true, score: 0, issues: [], summary: 'Review skipped.' };
  }
}

/** True when a reviewer's returned summary is actually a failure/error string, not a real review. Pure. */
export function isReviewFailureSummary(summary: unknown): boolean {
  if (typeof summary !== 'string' || !summary.trim()) return true;
  return /^\s*error\b|all v3\.0 providers failed|providers? (failed|are unavailable)|too large for every ai provider|step limit reached|budget (cap|limit) reached/i.test(summary);
}

/** Format a ReviewResult as a narration string. Returns '' if score is 0 (skipped). */
export function formatReview(review: ReviewResult): string {
  if (review.score === 0) return '';
  const icon = review.score >= 90 ? '✅' : review.score >= 70 ? '⚠️' : '❌';
  const header = `${icon} Build Review (${review.score}/100): ${review.summary}`;
  if (review.issues.length === 0) return header;
  const issueLines = review.issues
    .slice(0, 5)
    .map(
      (i) =>
        `  ${i.severity === 'critical' ? '🚨' : i.severity === 'warning' ? '⚠️' : '💡'} ${i.message}`,
    );
  return [header, ...issueLines].join('\n');
}
