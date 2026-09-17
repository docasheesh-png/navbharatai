// FAILURE CATEGORY — "kis type ki apps nahi ban pa rahi hai? koi specific pattern hai, ya random?"
// (admin, 2026-09-16, asking for a button on the admin panel that answers exactly this from the
// platform's own durable build records, not from a hand-picked sample of reports).
//
// TWO QUESTIONS, TWO AXES — both read from data the platform already stores, nothing invented:
//   1. WHAT TYPE of app fails more than others? → the DOMAIN, reusing the SAME classifier the build
//      prompt itself is already analysed with (`analyzeRequirementGaps` in RequirementGapAnalyzer.ts).
//      Centralised on purpose (fourth absolute rule, step 2): a second domain-guessing regex list here
//      would drift from the real one the moment either was tuned, and this repo has already paid for
//      that shape of bug (four drifted copies of safeRelPath).
//   2. WHY do the failures happen? → keyword-matched against the ENGINE'S OWN real message text
//      (`rootCause`), grounded in strings actually read out of BuildDiagnostics.ts / turnDeadline.ts —
//      never invented wording. Anything that matches nothing known lands in an HONEST `other` bucket
//      rather than being forced into a category it does not belong to.
//
// 🔒 THE SAMPLE IS STATED, NEVER HIDDEN. `listAllDiagnostics` (the source this reads) carries the
// LATEST build per WORKSPACE — the current state of every project, not literally every build ever
// run — and the route bounds how many it reads. Both facts travel with the report as `sampleNote`
// fields the caller must show, the same discipline `ReferralCostCard`'s "lower bound" banner and
// `BuildCostCard`'s per-row `measured` flag already use: a number with no stated sample size is a
// number the admin cannot judge.
//
// PURE — no Firestore, no clock, no env. The caller supplies the rows it already read.
//
// ⚠️ A SIBLING WAS FOUND WHILE BUILDING THIS (redundant-work check, 2026-09-16) AND DELIBERATELY NOT
// MERGED INTO IT — recorded rather than silently duplicated (CLAUDE.md rule 3/6). `src/lib/buildReportAnalytics.ts`
// already classifies failure REASONS with its own regex list (`CATEGORY_RULES`), on the SAME underlying
// rootCause vocabulary (`buildAdminReportRecord` is built from the identical `BuildDiagnosticsReport`
// this module's caller reads). It answers a narrower question from a narrower, self-selected sample: only
// the reports a user chose to file via the "Report" button — see `AdminDashboard.tsx`'s own 2026-08-12
// correction, which moved the "first-pass quality" headline OFF that same biased sample for exactly this
// reason, but never touched this reason-pattern panel. This module intentionally does NOT reuse
// `CATEGORY_RULES`, to avoid changing a live, already-shipped admin panel's classification inside an
// unrelated feature PR. A future pass should decide whether to (a) centralise the two reason-classifiers
// into one shared list, and (b) point `buildReportAnalytics.ts`'s failure-pattern panel at the same
// comprehensive `listAllDiagnostics` source this module uses, retiring the biased-sample version. Left as
// an open item rather than guessed at.

import { analyzeRequirementGaps } from './RequirementGapAnalyzer';
import { textIsAdvisoryCap } from '../AgentV3/advisoryCapOutcome';

/** The subset of a stored build's data this module needs. Matches AllDiagnosticsEntry by shape. */
export interface CategorizableBuild {
  workspaceId: string;
  ok: boolean | null;
  prompt?: string;
  rootCause?: string | null;
}

/**
 * The engine's own real failure vocabulary, matched by substring/pattern against `rootCause`.
 *
 * ⚠️ EVERY PATTERN HERE IS GROUNDED IN A REAL STRING READ OUT OF THE SOURCE, not guessed — see the
 * module header. Order matters: the FIRST pattern that matches wins, so a more specific bucket
 * (e.g. `db-unreachable`) is listed ahead of a more general one that could also fire on its wording.
 */
const REASON_PATTERNS: ReadonlyArray<{ key: string; label: string; test: RegExp }> = [
  {
    key: 'db-unreachable',
    label: 'Database was not actually reachable',
    // BuildDiagnostics.ts: "reported exit 0 but the database was NOT reachable — the migration/query
    // did not actually run."
    test: /database was not reachable|db unreachable|database is unreachable|could not (connect|reach) (the )?database/i,
  },
  {
    key: 'sandbox-unavailable',
    label: 'Build sandbox unavailable (infra, not the app)',
    // BuildDiagnostics.ts: "could not run — the build sandbox was unavailable (reaped/expired/unreachable)."
    test: /sandbox was unavailable|sandbox (is )?unavailable|could not run.{0,40}sandbox/i,
  },
  {
    key: 'provider-budget',
    label: 'AI provider timed out / ran out of budget',
    // turnDeadline.ts: BUDGET_EXHAUSTED_MESSAGE / BUDGET_REACHED_MESSAGE; plus the platform's own
    // "no provider answered" wording (autopsy 4efab9d7) and a plain provider timeout.
    test: /build budget (exhausted|reached)|no provider answered|timed out|time budget ended/i,
  },
  {
    key: 'cost-ceiling',
    label: 'Hit the build cost ceiling',
    test: /cost ceiling|spending (limit|cap) reached/i,
  },
  {
    key: 'stuck-tool',
    label: 'A tool call got stuck and never returned',
    // BuildDiagnostics.ts STUCK_TOOL: "Stuck on '<tool>' — in-flight …s, never completed."
    test: /stuck on ['"]|never completed/i,
  },
  {
    key: 'tool-call-failed',
    label: 'A tool call failed',
    test: /tool call failed/i,
  },
  {
    key: 'typecheck-failed',
    label: 'TypeScript / compile check failed',
    test: /\btsc\b|typecheck|type error|compil(e|ation) (fail|error)/i,
  },
  {
    key: 'dependency-error',
    label: 'A dependency / package could not be installed',
    test: /npm (err|install)|module not found|cannot find package|dependency (error|failed)/i,
  },
  {
    key: 'preview-failed',
    label: 'The preview did not render',
    test: /preview (failed|error|unverified)|did not render|blank (page|screen)/i,
  },
  {
    key: 'runtime-error',
    label: 'A runtime / console error in the built app',
    test: /runtime error|console error|uncaught|unhandled (rejection|exception)/i,
  },
  {
    key: 'review-critical',
    label: 'A reviewer found a critical issue',
    // BuildDiagnostics.ts deriveRootCause: "Critical issue found by review: <finding>"
    test: /critical issue found by review/i,
  },
  {
    key: 'no-files',
    label: 'No files were produced',
    test: /no files (were )?(changed|written|produced)|empty build|nothing was written/i,
  },
];

/** One build's failure reason, from its stored rootCause text. Pure, exported for direct testing. */
export function classifyFailureReason(rootCause: string | null | undefined): { key: string; label: string } {
  const text = String(rootCause ?? '').trim();
  if (!text) return { key: 'no-root-cause', label: 'No root cause was recorded' };
  /**
   * 🔴 NOT A FAILURE, AND IT LOOKED LIKE THE BIGGEST ONE (report af3a3f7f, 2026-09-17). The advisory
   * cap used to share the code `OUTCOME_STOPPED` with the real wall-clock stop, and its sentence
   * contains no keyword in the list below — so a fully built, browser-verified app landed in the
   * honest-but-useless `other` bucket. Named here because this module only ever sees the PROSE:
   * `listAllDiagnostics` projects `rootCause` and drops the issue codes.
   */
  if (textIsAdvisoryCap(text)) {
    return { key: 'advisory-cap', label: 'Not a failure — the app was built; only the post-build checks ran out of time' };
  }
  for (const p of REASON_PATTERNS) if (p.test.test(text)) return { key: p.key, label: p.label };
  // Honest, not a guess forced into a bucket it may not belong to — the raw text still rides in the
  // example list, so the admin can read it and decide whether a new pattern is worth adding.
  return { key: 'other', label: 'Other (not yet in the known pattern list)' };
}

/** The domain a build's prompt most likely belongs to, reusing the platform's OWN classifier. Pure. */
export function domainOfPrompt(prompt: string | null | undefined): string {
  return analyzeRequirementGaps(String(prompt ?? '')).domain;
}

export interface ReasonExample {
  workspaceId: string;
  /** The build's own rootCause text, capped — the evidence behind the count, not a summary of it. */
  rootCause: string;
}

export interface ReasonRow {
  key: string;
  label: string;
  count: number;
  /** Share of ALL FAILED builds this reason accounts for, 0–100, 1 dp. */
  sharePct: number;
  examples: ReasonExample[];
}

export interface DomainRow {
  domain: string;
  total: number;
  failed: number;
  succeeded: number;
  /** failed / (failed + succeeded), 0–100, 1 dp. `null` when this domain has no judged builds. */
  failureRatePct: number | null;
  /** This domain's own top failure reasons, most common first. */
  topReasons: ReasonRow[];
}

export interface FailureCategoryReport {
  totalBuilds: number;
  /** Builds excluded because they had no settled verdict (still running / legacy record). */
  unjudged: number;
  ok: number;
  failed: number;
  /** failed / (failed + ok), 0–100, 1 dp. `null` when nothing here has a verdict yet. */
  overallFailureRatePct: number | null;
  /** By app type, sorted by FAILED count descending — the domains worth looking at first. */
  byDomain: DomainRow[];
  /** By failure reason, across every domain, sorted by count descending. */
  byReason: ReasonRow[];
}

const MAX_EXAMPLES_PER_REASON = 3;
const EXAMPLE_ROOT_CAUSE_MAX = 220;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function ratePct(part: number, whole: number): number | null {
  return whole > 0 ? round1((part / whole) * 100) : null;
}

/** Tally reasons across a set of already-failed builds, sorted by count desc. Pure, internal. */
function tallyReasons(failedBuilds: readonly CategorizableBuild[]): ReasonRow[] {
  const byKey = new Map<string, { label: string; count: number; examples: ReasonExample[] }>();
  for (const b of failedBuilds) {
    const { key, label } = classifyFailureReason(b.rootCause);
    const entry = byKey.get(key) ?? { label, count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < MAX_EXAMPLES_PER_REASON && b.rootCause) {
      const text = String(b.rootCause).trim();
      entry.examples.push({
        workspaceId: b.workspaceId,
        rootCause: text.length <= EXAMPLE_ROOT_CAUSE_MAX ? text : `${text.slice(0, EXAMPLE_ROOT_CAUSE_MAX)}…`,
      });
    }
    byKey.set(key, entry);
  }
  const total = failedBuilds.length;
  return [...byKey.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count, sharePct: ratePct(v.count, total) ?? 0, examples: v.examples }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Categorise a set of already-read build records into the two admin-panel tables: by app TYPE and by
 * failure REASON. Deterministic; never throws; empty input yields an honest all-zero report.
 */
export function categorizeBuildFailures(builds: readonly CategorizableBuild[] | null | undefined): FailureCategoryReport {
  const rows = Array.isArray(builds) ? builds.filter((b) => b && typeof b.workspaceId === 'string') : [];
  const judged = rows.filter((b) => typeof b.ok === 'boolean');
  const ok = judged.filter((b) => b.ok === true);
  const failed = judged.filter((b) => b.ok === false);

  const byDomainMap = new Map<string, { total: number; failed: CategorizableBuild[]; succeeded: number }>();
  for (const b of judged) {
    const domain = domainOfPrompt(b.prompt);
    const entry = byDomainMap.get(domain) ?? { total: 0, failed: [], succeeded: 0 };
    entry.total += 1;
    if (b.ok === false) entry.failed.push(b); else entry.succeeded += 1;
    byDomainMap.set(domain, entry);
  }

  const byDomain: DomainRow[] = [...byDomainMap.entries()]
    .map(([domain, v]) => ({
      domain,
      total: v.total,
      failed: v.failed.length,
      succeeded: v.succeeded,
      failureRatePct: ratePct(v.failed.length, v.total),
      topReasons: tallyReasons(v.failed).slice(0, 5),
    }))
    .sort((a, b) => b.failed - a.failed || b.total - a.total);

  return {
    totalBuilds: rows.length,
    unjudged: rows.length - judged.length,
    ok: ok.length,
    failed: failed.length,
    overallFailureRatePct: ratePct(failed.length, judged.length),
    byDomain,
    byReason: tallyReasons(failed),
  };
}
