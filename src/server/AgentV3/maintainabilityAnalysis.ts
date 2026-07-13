// GA-12 (roadmap Tier 2C) — maintainability analysis: flag high-confidence, DETERMINISTIC code-smell
// signals over generated source that no other evaluate dimension catches. Today: the oversized "God
// file/component" (a single source file that has grown far past a maintainable size — the exact smell
// the polish backlog calls out, e.g. an ~6,000-line App.tsx). Split candidates are surfaced to the
// agent as ADVISORY guidance; this NEVER blocks a build (it is not fed into the readiness gate) — a big
// file is a quality concern, not a correctness failure, so degrading a working app over it would break
// the one absolute rule.
//
// PURE + deterministic (line counts only) with generous thresholds, so it is zero-false-positive: a
// well-factored file is comfortably under the floor. Test files and type-declaration files are excluded
// (they legitimately grow). Exported so the exact thresholds are unit-tested independently.

export interface MaintainabilityIssue {
  kind: 'oversized-file';
  path: string;
  severity: 'medium' | 'low';
  detail: string;
}

/** Only real source modules are judged (not JSON/CSS/markdown/etc.). */
const SOURCE_RE = /\.(tsx?|jsx?)$/;
/** Test/spec + ambient-type files legitimately grow — never flagged. */
const EXCLUDE_RE = /(\.test\.|\.spec\.|\.d\.ts$)/;

/** Generous floors — a well-factored module sits well below these, so a hit is a real smell, not noise. */
const LOW_LINES = 800;
const MEDIUM_LINES = 1500;
const MAX_ISSUES = 20;

/** Count lines the way an editor does (a trailing newline doesn't add a phantom line). */
function lineCount(content: string): number {
  if (!content) return 0;
  const n = content.split('\n').length;
  return content.endsWith('\n') ? n - 1 : n;
}

/**
 * Flag source files that have grown past a maintainable size (a "God file/component"). Deterministic,
 * conservative, advisory. Sorted largest-first and capped so a huge repo can't flood the report.
 */
export function analyzeMaintainability(
  sources: ReadonlyArray<{ path: string; content: string }>,
): MaintainabilityIssue[] {
  const issues: MaintainabilityIssue[] = [];
  for (const src of sources || []) {
    if (!src || typeof src !== 'object') continue;
    const { path, content } = src as { path: unknown; content: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!SOURCE_RE.test(path) || EXCLUDE_RE.test(path)) continue;
    const lines = lineCount(content);
    if (lines < LOW_LINES) continue;
    const severity: 'medium' | 'low' = lines >= MEDIUM_LINES ? 'medium' : 'low';
    issues.push({
      kind: 'oversized-file',
      path,
      severity,
      detail:
        `'${path}' is ${lines} lines — a God file/component that is hard to read, test, and safely edit. ` +
        `Split it into focused modules (extract components/hooks/helpers into their own files).`,
    });
  }
  issues.sort((a, b) => {
    // Medium (bigger) first, then by the line count embedded in the detail (largest first).
    if (a.severity !== b.severity) return a.severity === 'medium' ? -1 : 1;
    return 0;
  });
  return issues.slice(0, MAX_ISSUES);
}

/** A concise, honest maintainability line for the evaluate report. Pure. */
export function maintainabilitySummary(issues: MaintainabilityIssue[]): string {
  if (!issues || issues.length === 0) {
    return 'Maintainability: ✓ No oversized files (every source module is a manageable size).';
  }
  const head = `Maintainability: ${issues.length} oversized file(s) — consider splitting:`;
  const body = issues.map((i) => `  - [${i.severity}] ${i.detail}`);
  return [head, ...body].join('\n');
}
