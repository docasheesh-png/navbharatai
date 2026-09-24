// THE SCORECARD WAS SCORING COMPLAINTS (admin 2026-09-24: "sahi source laga do").
//
// 🔴 THE DEFECT. `/api/admin/builder-scorecard` read `listAdminBuildReports()` — the admin REPORT
// INBOX. A build enters that collection by exactly two routes, and I counted every writer in the
// repo before saying so: `shouldAutoReport`, which fires only on `verdict === 'bad'`, and a user
// pressing **Report**. Neither admits a build that worked and left its user happy. So a card titled
// "Builder scorecard", whose headline reads "Build success: 90.2% of 41", was measuring the success
// rate OF THE COMPLAINTS — and the admin had no way to tell from the card.
//
// 🔑 THE REPO ALREADY KNEW. `/api/admin/failure-categories` (2026-09-16) was moved to the
// comprehensive source, and its docblock names the trap in as many words: *"rather than the
// user-submitted inbox (`listAdminBuildReports`), which is only the builds someone bothered to click
// Report on and would answer a different, biased question."* The instance was fixed; the sibling was
// never hunted. That is this repo's headline class (autopsy `a38c6fef`), and it is why the guard in
// `tests/theScorecardWasScoringComplaints.test.ts` is written against the SOURCE rather than against
// a number — `tsc` and `vitest` cannot see that a metric is reading the wrong collection.
//
// ⚠️ WHICH DIRECTION THE BIAS RAN, stated because it is not the obvious one. A complaint sample makes
// the engine look WORSE than it is, not better. That is still a defect: it is the number the admin
// would act on, and acting on it would mean chasing a failure rate that is partly an artefact of who
// files reports. An honest number can be bad news; a number whose population is unknown is not a
// number at all.
//
// 🔴 AND A NAIVE SWAP WOULD HAVE TRADED ONE PROBLEM FOR ANOTHER. `listAllDiagnostics` returns ONE row
// per workspace — each workspace's LATEST build. Edit survival groups builds BY workspace, so on that
// source every workspace would hold exactly one build, `edits` would be 0, and the metric would
// silently report "unknown" for ever while looking like it had simply found nothing. Per-build truth
// lives in the `history` subcollection, so this module reads the workspace index from
// `listAllDiagnostics` and then the BUILDS from each workspace's own history.
import { listAllDiagnostics, listDiagnosticsHistoryResult } from '../AgentV3/DiagnosticsStore';
import type { BuildMetricInput } from '../../lib/builderMetrics';

/** Workspaces whose per-build history is fetched. Bounded: this is one Firestore query each. */
export const DEFAULT_HISTORY_WORKSPACES = 60;
/** How many of those queries are in flight at once. */
export const HISTORY_CONCURRENCY = 10;

/**
 * WHAT THIS CARD ACTUALLY MEASURED — carried beside the numbers, never inferred from them.
 *
 * The old card printed a sample size per row (honest) and never named the sample (not honest enough).
 * A reader could see "of 41" and had no way to learn that the 41 were complaints.
 */
export interface ScorecardPopulation {
  /** Always `all-workspaces` now. Kept as a field so a future source is named, not assumed. */
  source: 'all-workspaces';
  /** Workspaces the index returned inside the window. */
  workspaces: number;
  /** Workspaces whose per-build history was actually fetched (bounded by `historyWorkspaces`). */
  historyFetched: number;
  /**
   * Workspaces whose history READ FAILED. Never folded into "no builds": `listDiagnosticsHistoryResult`
   * exists precisely because an empty list and a failed read are different facts, and a failed read
   * counted as zero builds is a metric quietly improving itself on an outage.
   */
  historyUnreadable: number;
  /** Workspaces beyond the bound, represented by their latest build only. */
  latestOnly: number;
  /** Build rows handed to the scorecard. */
  builds: number;
  /** The bound in force for this response. */
  historyWorkspaces: number;
}

/** One `AllDiagnosticsEntry`-shaped row → the metric input. Exported so the test can drive it. */
export function toMetricInput(e: {
  workspaceId?: string | null;
  savedAt?: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  ok?: boolean | null;
  billedInr?: number | null;
  counts?: { autoResolved?: number | null; workarounds?: number | null } | null;
}): BuildMetricInput {
  const started = typeof e.startedAt === 'number' ? e.startedAt : null;
  const ended = typeof e.endedAt === 'number' ? e.endedAt : null;
  return {
    workspaceId: e.workspaceId ?? null,
    // `startedAt` is the build's own clock; `savedAt` is when the row was written. Prefer the build's.
    reportedAt: started ?? (typeof e.savedAt === 'number' ? e.savedAt : 0),
    ok: typeof e.ok === 'boolean' ? e.ok : null,
    // A build with no end has not finished — never a zero-length build.
    buildMs: started !== null && ended !== null && ended >= started ? ended - started : null,
    billedInr: typeof e.billedInr === 'number' ? e.billedInr : null,
    // `undefined`, not 0, when the field is absent: healPressure EXCLUDES an unrecorded build and
    // would otherwise score a legacy row as a clean first pass.
    healCount: typeof e.counts?.autoResolved === 'number' ? e.counts.autoResolved : undefined,
    workaroundCount: typeof e.counts?.workarounds === 'number' ? e.counts.workarounds : undefined,
    
  };
}

/** Run `work` over `items` a few at a time. Order is irrelevant here; the bound is not. */
async function inChunks<T, R>(items: readonly T[], size: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(work)));
  }
  return out;
}

/**
 * The builds the scorecard is computed from, and an honest account of where they came from.
 *
 * Never throws: every read below already swallows its own failure, and a scorecard that 500s teaches
 * the admin nothing. A read that failed is COUNTED (`historyUnreadable`) rather than silently dropped.
 */
export async function collectScorecardBuilds(
  limit: number,
  historyWorkspaces: number = DEFAULT_HISTORY_WORKSPACES,
): Promise<{ builds: BuildMetricInput[]; population: ScorecardPopulation }> {
  const index = await listAllDiagnostics(limit).catch(() => []);
  const cap = Math.max(0, Math.floor(historyWorkspaces));
  const withHistory = index.slice(0, cap);
  const latestOnlyRows = index.slice(cap);

  let historyUnreadable = 0;
  const fromHistory = await inChunks(withHistory, HISTORY_CONCURRENCY, async (entry) => {
    const { entries, ok } = await listDiagnosticsHistoryResult(entry.workspaceId)
      .catch(() => ({ entries: [], ok: false }));
    if (!ok) {
      historyUnreadable += 1;
      // The read failed, so fall back to the one row we DO hold for this workspace rather than
      // dropping it — a workspace missing from the count is a workspace the rate silently ignores.
      return [toMetricInput(entry)];
    }
    // A workspace with no history rows yet still has its latest report; use it rather than nothing.
    if (entries.length === 0) return [toMetricInput(entry)];
    return entries.map((h) => toMetricInput({ ...h, workspaceId: entry.workspaceId, billedInr: undefined }));
  });

  const builds = [
    ...fromHistory.flat(),
    ...latestOnlyRows.map(toMetricInput),
  ];

  return {
    builds,
    population: {
      source: 'all-workspaces',
      workspaces: index.length,
      historyFetched: withHistory.length,
      historyUnreadable,
      latestOnly: latestOnlyRows.length,
      builds: builds.length,
      historyWorkspaces: cap,
    },
  };
}

/** One sentence naming the population, appended to the headline so the card cannot omit it. */
export function populationNote(p: ScorecardPopulation): string {
  const parts = [
    `Measured over ${p.builds} build(s) from ${p.workspaces} workspace(s) — EVERY workspace on the`
    + ` platform, not only the builds someone reported.`,
  ];
  if (p.latestOnly > 0) {
    parts.push(`${p.latestOnly} workspace(s) beyond the ${p.historyWorkspaces}-workspace history bound`
      + ` are represented by their latest build only.`);
  }
  if (p.historyUnreadable > 0) {
    parts.push(`${p.historyUnreadable} workspace(s) could not have their history read and are counted`
      + ` by their latest build — not as zero.`);
  }
  return parts.join(' ');
}
