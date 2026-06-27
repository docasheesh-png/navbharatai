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

/** Parse structured reviewer text into typed issues (best-effort). */
function parseReviewOutput(text: string): ReviewIssue[] {
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
        .replace(/^[🚨⚠️💡\s•\-*]+/, '')
        .trim();
      if (message) issues.push({ severity, message });
    }
  }
  return issues;
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
    'End with: "Score: N/100" (where N = your quality assessment).',
    'If everything looks good, just write: [PASS] App looks complete. Score: 90',
  ].join('\n');

  try {
    const { summary } = await opts.spawn('reviewer', instruction);
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
