// AgentV3 — Frontend resilience: error-boundary check (Section I #5 v1).
//
// A React app with NO error boundary white-screens the entire UI the moment any
// one component throws during render — the opposite of "the app must never break".
// This PURE, deterministic analyser detects whether the project has an error
// boundary and flags a real multi-component React app that has none, so the agent
// adds one at the root.
//
// High-precision: only relevant for React apps with several components, and the
// signal set (componentDidCatch / getDerivedStateFromError / react-error-boundary /
// <ErrorBoundary>) is specific, so a real app with a boundary is never nagged.

export type ErrorBoundaryLevel = 'high' | 'medium' | 'low';

export interface ErrorBoundaryFinding {
  level: ErrorBoundaryLevel;
  message: string;
}

export interface ErrorBoundaryReport {
  /** Whether this looked like a React app worth checking. */
  assessed: boolean;
  hasErrorBoundary: boolean;
  /**
   * Files that PRESENT themselves as an error boundary but do not implement one. See
   * `looksLikeBrokenErrorBoundary` for why this is tracked separately from "there is none".
   */
  brokenBoundaries: string[];
  findings: ErrorBoundaryFinding[];
}

const SIGNAL_RE = /\bcomponentDidCatch\b|\bgetDerivedStateFromError\b|react-error-boundary|<ErrorBoundary[\s/>]/;

/** True if a file's content contains a recognisable error-boundary signal. PURE. */
export function hasErrorBoundarySignal(content: string): boolean {
  return SIGNAL_RE.test(content || '');
}

/** The two React lifecycle hooks that DEFINE an error boundary. Without one of these, it is not one. */
const BOUNDARY_LIFECYCLE_RE = /\bcomponentDidCatch\b|\bgetDerivedStateFromError\b|react-error-boundary/;
/** The file declares something that calls itself an error boundary (not merely renders someone else's). */
const DECLARES_BOUNDARY_RE = /\b(?:class|function|const)\s+\w*ErrorBoundary\w*\b/;

/**
 * Does this file CLAIM to be an error boundary while not implementing one?
 *
 * ROOT CAUSE (admin report 2026-08-12, the dukaan stock app). That build produced `src/ErrorBoundary.tsx`
 * and then reported three separate warnings that never mentioned each other:
 *
 *     [warning] 1 component(s) created but never used: src/ErrorBoundary.tsx (ErrorBoundary)
 *     [warning] React app has no error boundary
 *     tsc: Property 'state'  does not exist on type 'ErrorBoundary'.
 *     tsc: Property 'props'  does not exist on type 'ErrorBoundary'.
 *     tsc: Property 'setState' does not exist on type 'ErrorBoundary'.
 *
 * Three findings, one file, one cause: what was written is not an error boundary. It is a class named
 * ErrorBoundary that reaches for `this.state` / `this.props` / `this.setState` without extending
 * React.Component — which is why TypeScript says those members do not exist — and it carries neither
 * `componentDidCatch` nor `getDerivedStateFromError`, which is why the boundary check saw nothing and
 * said the app has none.
 *
 * The reason this needs its own finding is what the OTHER message causes. "React app has no error
 * boundary" invites exactly one response — add an error boundary — and this repo has already paid for
 * that twice (the duplicate-ErrorBoundary autopsies of 2026-08-02, which needed a dedupe pass and then
 * a second PRE-VERDICT dedupe pass). Telling a repair pass to ADD one, when a broken one is already
 * sitting in the project, is how a duplicate gets created. The honest instruction is: fix that file.
 *
 * Conservative: it fires only on a file that DECLARES an ErrorBoundary of its own. A file that merely
 * renders `<ErrorBoundary>` someone else wrote declares nothing and is never flagged. PURE.
 */
export function looksLikeBrokenErrorBoundary(path: string, content: string): boolean {
  const src = content || '';
  if (!src.trim()) return false;
  const declares = DECLARES_BOUNDARY_RE.test(src) || /errorboundary/i.test((path || '').split('/').pop() || '');
  if (!declares) return false;
  return !BOUNDARY_LIFECYCLE_RE.test(src);
}

/**
 * Decide whether a React app is missing an error boundary. PURE & deterministic.
 * `componentCount` is the number of React components in the project; only a real
 * multi-component app (≥ 2) is assessed so trivial demos are not nagged.
 */
export function analyzeErrorBoundary(
  componentCount: number,
  hasErrorBoundary: boolean,
  brokenBoundaries: readonly string[] = [],
): ErrorBoundaryReport {
  const broken = [...new Set((brokenBoundaries ?? []).filter((p) => typeof p === 'string' && p.trim()))];
  if (!Number.isFinite(componentCount) || componentCount < 2) {
    return { assessed: false, hasErrorBoundary, brokenBoundaries: broken, findings: [] };
  }
  const findings: ErrorBoundaryFinding[] = [];
  if (!hasErrorBoundary) {
    findings.push(broken.length > 0
      // FIX THE ONE THAT EXISTS — never "add one". See looksLikeBrokenErrorBoundary: telling a repair
      // pass to add an error boundary while a broken one sits in the project is how the duplicate
      // ErrorBoundary of the 2026-08-02 autopsies got created.
      ? {
          level: 'medium',
          message: `${broken.join(', ')} is named like an error boundary but does not implement one — it has neither componentDidCatch nor getDerivedStateFromError, so React will never route a render error to it and the whole UI still white-screens. FIX THAT FILE (make it a class extending React.Component with getDerivedStateFromError + componentDidCatch, and render it around the app root). Do NOT add a second error boundary — the app already has this one.`,
        }
      : {
          level: 'medium',
          message: 'No error boundary in this React app — one render error will white-screen the whole UI. Add an ErrorBoundary (or react-error-boundary) around the app root so a single failure degrades gracefully.',
        });
  }
  return { assessed: true, hasErrorBoundary, brokenBoundaries: broken, findings };
}

/** A short, honest error-boundary block for the `evaluate` output. */
export function errorBoundarySummary(report: ErrorBoundaryReport): string {
  if (!report.assessed) return 'Error boundary: — (not a multi-component React app to assess).';
  if (report.findings.length === 0) return 'Error boundary: ✓ the app has an error boundary.';
  const head = report.brokenBoundaries.length > 0 ? 'Error boundary — present but not working:' : 'Error boundary — missing:';
  return [head, ...report.findings.map((f) => `  ⚠ ${f.message}`)].join('\n');
}
