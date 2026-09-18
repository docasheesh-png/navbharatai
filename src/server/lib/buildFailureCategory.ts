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
// ✅ THE SIBLING IS MERGED (2026-09-17, the "Top failure patterns" autopsy). This module's first version
// recorded (2026-09-16) that `src/lib/buildReportAnalytics.ts` classified the SAME rootCause vocabulary
// with its own regex list (`CATEGORY_RULES`) and left the two apart as an open item. The next day the
// admin's "Top failure patterns" card showed three RAW SENTENCES as "patterns" — the model's summary
// narration, a provider diagnostic and a tool error — because that list's fallback used the first line
// of `rootCause` as the bucket label. The reason classifier now lives ONCE, in `src/lib/failureReason.ts`
// (isomorphic, so the client-side card can import it), and both panels read it. The DOMAIN half and the
// verdict split stay here; they are server-only and need nothing the card needs.

import { analyzeRequirementGaps } from './RequirementGapAnalyzer';
import { classifyFailureReason, type FailureReason } from '../../lib/failureReason';

/**
 * Re-exported so every existing caller (and `tests/failureNaming.test.ts`) keeps its import path. The
 * classifier itself — `OUTCOME_REASONS`, the grounded text patterns, the advisory-cap rule — is defined
 * ONCE in `src/lib/failureReason.ts`; do not add a pattern here.
 */
export { classifyFailureReason };
export type { FailureReason };

/** The subset of a stored build's data this module needs. Matches AllDiagnosticsEntry by shape. */
export interface CategorizableBuild {
  workspaceId: string;
  ok: boolean | null;
  prompt?: string;
  rootCause?: string | null;
  /** The build's own `OUTCOME_*` code — a machine fact, and the thing to read BEFORE the prose. */
  outcomeCode?: string | null;
  /** The severity that outcome was recorded at. One code can mean opposite things without it. */
  outcomeSeverity?: string | null;
  /** Was the app SEEN running (real browser render / published preview)? See `appWasSeenRunning`. */
  appSeenRunning?: boolean | null;
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

/**
 * PHASE 1 — THE THREE POPULATIONS INSIDE ONE FAILURE RATE (admin 2026-09-17).
 *
 * "40.8% failed" is not one thing, and treating it as one makes the target unreachable by definition:
 * you cannot fix builds that are not broken. Splitting it is what turns a number into work.
 *
 * ⚠️ WHAT IS DELIBERATELY MISSING, said plainly rather than guessed: **builds the USER stopped**.
 * `buildAbortCause.ts` knows the difference (`'user-stop'`, and it refuses to default to it — "an abort
 * we cannot explain is not a user's fault"), but that cause is NOT persisted into the report, so it
 * cannot be separated from stored data today. Inventing a rule for it — "short builds are abandoned",
 * "OUTCOME_STOPPED means cancelled" — would put a guess into the one number meant to end guessing.
 * Recorded as an open root cause instead.
 */
export interface VerdictSplit {
  /** Judged failed, and the app was never seen running. The real target. */
  engineFailed: number;
  /**
   * 🔴 Judged FAILED while the app was SEEN RUNNING in a real browser. Not a build failure — a wrong
   * verdict, and every one of these is a user who was told their working app had failed.
   */
  builtButJudgedFailed: number;
  /** Judged ok. */
  succeeded: number;
  /** No settled verdict — still running, or a legacy record. */
  unjudged: number;
  /**
   * Failures that could not be checked either way, because the record predates render evidence being
   * projected. Counted separately so the split is never presented as more certain than it is.
   */
  evidenceUnknown: number;
  /**
   * PHASE 4 — THE NUMBER THE 90% TARGET IS MEASURED AGAINST, defined once so it cannot drift.
   *
   * **Did the user end up with a working app?** = (succeeded + builtButJudgedFailed) ÷ (those + engineFailed).
   *
   * 🔑 A BUILD WE WRONGLY CALLED FAILED STILL GAVE THE USER A WORKING APP, so it belongs on the top of
   * this fraction. That is not letting ourselves off — it is the opposite: it separates "the engine
   * cannot build apps" from "the engine builds apps and then lies about them", which are different
   * problems with different fixes, and only the first is what people mean by a failure rate.
   *
   * ⚠️ `evidenceUnknown` is EXCLUDED from both halves, deliberately. Those are records written before
   * render evidence was kept; putting them anywhere would be a guess, and a target measured against a
   * guess can be hit without anything improving. `null` until at least one build can be judged.
   */
  appDeliveredPct: number | null;
  /**
   * What we TOLD people: succeeded ÷ the same denominator. The GAP between this and `appDeliveredPct`
   * is the honesty debt — every point of it is a user shown a failure for an app that worked.
   */
  reportedOkPct: number | null;
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
  /** The three populations inside the headline rate — see `VerdictSplit`. */
  verdictSplit: VerdictSplit;
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
    const { key, label } = classifyFailureReason(b.rootCause, b.outcomeCode, b.outcomeSeverity);
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

  /**
   * The split. A failure whose record carries NO render evidence field at all (written before it was
   * projected) is `evidenceUnknown`, never silently counted as a genuine engine failure — "we did not
   * look" and "we looked and saw nothing" are different facts, and only one of them is a bug report.
   */
  const engineFailed = failed.filter((b) => b.appSeenRunning === false).length;
  const builtButJudgedFailed = failed.filter((b) => b.appSeenRunning === true).length;
  const evidenceUnknown = failed.length - engineFailed - builtButJudgedFailed;
  // Only builds we can actually judge count — see `appDeliveredPct`.
  const judgeable = ok.length + engineFailed + builtButJudgedFailed;
  const verdictSplit: VerdictSplit = {
    engineFailed,
    builtButJudgedFailed,
    succeeded: ok.length,
    unjudged: rows.length - judged.length,
    evidenceUnknown,
    appDeliveredPct: ratePct(ok.length + builtButJudgedFailed, judgeable),
    reportedOkPct: ratePct(ok.length, judgeable),
  };

  return {
    totalBuilds: rows.length,
    unjudged: rows.length - judged.length,
    ok: ok.length,
    failed: failed.length,
    verdictSplit,
    overallFailureRatePct: ratePct(failed.length, judged.length),
    byDomain,
    byReason: tallyReasons(failed),
  };
}
