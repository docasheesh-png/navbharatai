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
  findings: ErrorBoundaryFinding[];
}

const SIGNAL_RE = /\bcomponentDidCatch\b|\bgetDerivedStateFromError\b|react-error-boundary|<ErrorBoundary[\s/>]/;

/** True if a file's content contains a recognisable error-boundary signal. PURE. */
export function hasErrorBoundarySignal(content: string): boolean {
  return SIGNAL_RE.test(content || '');
}

/**
 * Decide whether a React app is missing an error boundary. PURE & deterministic.
 * `componentCount` is the number of React components in the project; only a real
 * multi-component app (≥ 2) is assessed so trivial demos are not nagged.
 */
export function analyzeErrorBoundary(componentCount: number, hasErrorBoundary: boolean): ErrorBoundaryReport {
  if (!Number.isFinite(componentCount) || componentCount < 2) {
    return { assessed: false, hasErrorBoundary, findings: [] };
  }
  const findings: ErrorBoundaryFinding[] = [];
  if (!hasErrorBoundary) {
    findings.push({
      level: 'medium',
      message: 'No error boundary in this React app — one render error will white-screen the whole UI. Add an ErrorBoundary (or react-error-boundary) around the app root so a single failure degrades gracefully.',
    });
  }
  return { assessed: true, hasErrorBoundary, findings };
}

/** A short, honest error-boundary block for the `evaluate` output. */
export function errorBoundarySummary(report: ErrorBoundaryReport): string {
  if (!report.assessed) return 'Error boundary: — (not a multi-component React app to assess).';
  if (report.findings.length === 0) return 'Error boundary: ✓ the app has an error boundary.';
  return ['Error boundary — missing:', ...report.findings.map((f) => `  ⚠ ${f.message}`)].join('\n');
}
