// P-TQA.8 — Flaky test detection (pure, dependency-free, unit-tested).
//
// TestPanel showed only the latest pass/fail per test — a test that alternates pass/fail every run
// looked identical to a stable one. This tracks each test's recent run outcomes (capped history) so a
// flaky test can be flagged. Persisted to localStorage (per-browser, real, no extra endpoint); the
// spec named Firestore `testRuns/{workspaceId}` — localStorage is the dependency-free equivalent that
// avoids shipping an unwired server route.

/** Per-test run history: testId → recent outcomes (true = pass), oldest-first, capped. */
export type TestRunHistory = Record<string, boolean[]>;

export const FLAKY_STORAGE_KEY = 'nbai:test_runs';
const HISTORY_CAP = 20;
const DEFAULT_MIN_RUNS = 5;
const DEFAULT_THRESHOLD = 0.2;

/** Append a run outcome for a test, capped to the most recent HISTORY_CAP. Returns a NEW map. Pure. */
export function recordRun(history: TestRunHistory, testId: string, passed: boolean): TestRunHistory {
  if (!testId) return history;
  const prev = Array.isArray(history[testId]) ? history[testId] : [];
  const next = [...prev, !!passed].slice(-HISTORY_CAP);
  return { ...history, [testId]: next };
}

/** Fraction of recent runs that FAILED (0..1). Pure. */
export function flakinessRate(history: TestRunHistory, testId: string): number {
  const runs = history[testId];
  if (!Array.isArray(runs) || runs.length === 0) return 0;
  const fails = runs.reduce((n, ok) => n + (ok ? 0 : 1), 0);
  return fails / runs.length;
}

/**
 * A test is FLAKY when it has both passed AND failed across at least `minRuns` runs and its failure
 * rate is above `threshold` but not 100% (a test that always fails is broken, not flaky). Pure.
 */
export function isFlaky(
  history: TestRunHistory,
  testId: string,
  minRuns = DEFAULT_MIN_RUNS,
  threshold = DEFAULT_THRESHOLD,
): boolean {
  const runs = history[testId];
  if (!Array.isArray(runs) || runs.length < minRuns) return false;
  const passes = runs.filter(Boolean).length;
  const fails = runs.length - passes;
  if (passes === 0 || fails === 0) return false; // all-pass or all-fail = not flaky
  return flakinessRate(history, testId) > threshold;
}

/** Parse persisted JSON into a validated history. Never throws. */
export function loadHistory(raw: string | null | undefined): TestRunHistory {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: TestRunHistory = {};
    for (const [id, runs] of Object.entries(parsed)) {
      if (typeof id !== 'string' || !id || !Array.isArray(runs)) continue;
      const clean = runs.filter((r): r is boolean => typeof r === 'boolean').slice(-HISTORY_CAP);
      if (clean.length > 0) out[id] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Serialise history for persistence. Pure. */
export function serializeHistory(history: TestRunHistory): string {
  return JSON.stringify(history);
}
