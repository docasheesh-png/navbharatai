// Builder metrics — the numbers we could not see.
//
// WHY THIS EXISTS. An 84-point "Vision 10/10" directive was reviewed against the codebase and almost
// every capability it asked for already existed: state machine, project graph, architecture memory,
// task planning, multi-agent roles, model routing, dependency intelligence, preview + browser
// execution, regression memory, staged auto-repair, git checkpoints, security analysis, deployment
// with health checks — roughly 280 modules. Two things genuinely did not exist. This is one of them:
// **measurement**.
//
// That gap is the theme of every autopsy this platform has run. A build charged ₹566.96 and nobody
// could tell whether that was right, because 65% of its tokens were unattributed. A design gate ships
// and nobody knows whether it fires on the right pages. A dev-server keepalive ships and nobody knows
// whether the server now stays up. **We ship fix after fix without being able to say whether the
// engine is getting better.**
//
// COMPUTED FROM REAL BUILDS, NEVER A BENCHMARK APP. The directive itself forbids cheating a benchmark
// (§53: no hardcoded benchmark projects, no special-casing, no manual repair). A synthetic "500-edit
// test" on one hand-picked app is precisely the thing that gets gamed — and it measures a project
// nobody actually uses. These metrics come from the build reports the platform ALREADY stores, so they
// measure the engine's real behaviour on real users' real projects.
//
// THE HONESTY RULES, inherited from firstPassQuality.ts and non-negotiable:
//   • A missing field means "this record predates it", NOT zero. Counting a legacy row as a success
//     silently inflates the one number used to judge whether the engine is improving.
//   • No data ⇒ `null`, never `0`. "0%" and "no builds yet" are different facts, and reporting the
//     first when the second is true is the kind of lie that survives for months.
//   • An in-flight build has no verdict and is excluded — not counted as a failure.
//   • Every rate reports the sample size it rests on, so a 100% built from two builds cannot masquerade
//     as a result.
//
// Pure + dependency-free → unit-testable without a store.

/** The subset of a stored build report these metrics need. Matches AdminBuildReportMeta by shape. */
export interface BuildMetricInput {
  workspaceId: string | null;
  reportedAt: number;
  ok: boolean | null;
  inFlight?: boolean;
  buildMs?: number | null;
  billedInr?: number | null;
  /** How many defects the build FIXED ITSELF. See healPressure — this is a red flag, not a credit. */
  healCount?: number | null;
}

/** Builds that can actually be judged: finished, with a real verdict. */
export function judgeable(builds: readonly BuildMetricInput[]): BuildMetricInput[] {
  return (builds ?? []).filter((b) => !!b && b.inFlight !== true && typeof b.ok === 'boolean');
}

export interface EditSurvival {
  /** Projects with more than one recorded build — the only ones that can show survival at all. */
  projects: number;
  /** Follow-up builds across those projects. The FIRST build creates the app; it is not an edit. */
  edits: number;
  survived: number;
  /** survived / edits, or null when no project has been edited yet. */
  rate: number | null;
  /** The longest run of consecutive successful edits on any single project. */
  longestStreak: number;
  /** Projects whose most recent build FAILED — the ones a user is currently stuck on. */
  currentlyBroken: number;
  /** Builds excluded because they were in flight or had no verdict. */
  skipped: number;
}

/**
 * EDIT SURVIVAL — the directive's §9/§78 benchmark, measured honestly.
 *
 * It asks for a 500-edit test on one complex app. That is a worse measurement than this one: a single
 * curated project can be nursed, and it says nothing about the projects users actually keep. Grouping
 * real builds by workspace answers the same question — *does a project stay alive as it is edited?* —
 * across everything the platform has really built.
 *
 * The first build of a workspace is the CREATION, not an edit, so it is excluded from the rate. A
 * project that was born broken should be counted by build-success, not held against edit survival.
 */
export function editSurvival(builds: readonly BuildMetricInput[]): EditSurvival {
  const all = builds ?? [];
  const usable = judgeable(all);
  const byProject = new Map<string, BuildMetricInput[]>();
  for (const b of usable) {
    const key = b.workspaceId;
    if (!key) continue; // no workspace ⇒ cannot attribute it to a project's history
    const list = byProject.get(key) ?? [];
    list.push(b);
    byProject.set(key, list);
  }

  let projects = 0;
  let edits = 0;
  let survived = 0;
  let longestStreak = 0;
  let currentlyBroken = 0;

  for (const list of byProject.values()) {
    // Oldest first. reportedAt is the only ordering we have, and a stable tie-break keeps the result
    // deterministic when two builds share a millisecond.
    const ordered = [...list].sort((a, b) => a.reportedAt - b.reportedAt);
    if (ordered.length < 2) continue;
    projects += 1;

    let streak = 0;
    for (let i = 1; i < ordered.length; i++) {
      edits += 1;
      if (ordered[i].ok === true) {
        survived += 1;
        streak += 1;
        if (streak > longestStreak) longestStreak = streak;
      } else {
        streak = 0;
      }
    }
    if (ordered[ordered.length - 1].ok === false) currentlyBroken += 1;
  }

  return {
    projects,
    edits,
    survived,
    rate: edits > 0 ? survived / edits : null,
    longestStreak,
    currentlyBroken,
    skipped: all.length - usable.length,
  };
}

export interface Distribution {
  samples: number;
  median: number | null;
  p90: number | null;
  worst: number | null;
}

/** Median / p90 / worst of a numeric sample. Empty ⇒ all null, never 0. Pure. */
export function distribution(values: readonly number[]): Distribution {
  const nums = (values ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
    .slice().sort((a, b) => a - b);
  if (nums.length === 0) return { samples: 0, median: null, p90: null, worst: null };
  const at = (q: number): number => nums[Math.min(nums.length - 1, Math.floor(q * nums.length))];
  const mid = nums.length % 2 === 1
    ? nums[(nums.length - 1) / 2]
    : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2;
  return { samples: nums.length, median: mid, p90: at(0.9), worst: nums[nums.length - 1] };
}

/**
 * TIME TO WORKING APP — measured over SUCCESSFUL builds only.
 *
 * Averaging failures in would flatter a slow engine: a build that gives up at 30s is not "fast". The
 * median leads because build times are long-tailed and a single 15-minute outlier would drag a mean
 * into fiction; p90 and worst are reported beside it so the tail cannot hide behind the median.
 */
export function timeToWorkingApp(builds: readonly BuildMetricInput[]): Distribution {
  return distribution(
    judgeable(builds)
      .filter((b) => b.ok === true && typeof b.buildMs === 'number' && (b.buildMs as number) > 0)
      .map((b) => b.buildMs as number),
  );
}

/**
 * COST PER WORKING APP — over successful builds only, for the same reason.
 *
 * `worst` matters more than the median here and is deliberately surfaced: the ₹566.96 build that
 * triggered this whole line of work sat inside a perfectly healthy-looking average.
 */
export function costPerWorkingApp(builds: readonly BuildMetricInput[]): Distribution {
  return distribution(
    judgeable(builds)
      .filter((b) => b.ok === true && typeof b.billedInr === 'number' && (b.billedInr as number) >= 0)
      .map((b) => b.billedInr as number),
  );
}

export interface BuildSuccess {
  total: number;
  succeeded: number;
  failed: number;
  rate: number | null;
  /** In-flight or verdict-less records, excluded rather than counted as failures. */
  skipped: number;
}

/** Build success rate — the directive's headline §51 metric. */
export function buildSuccess(builds: readonly BuildMetricInput[]): BuildSuccess {
  const all = builds ?? [];
  const usable = judgeable(all);
  const succeeded = usable.filter((b) => b.ok === true).length;
  return {
    total: usable.length,
    succeeded,
    failed: usable.length - succeeded,
    rate: usable.length > 0 ? succeeded / usable.length : null,
    skipped: all.length - usable.length,
  };
}

export interface HealPressure {
  /** Finished builds carrying a heal count — the only ones this can be computed from. */
  builds: number;
  /** Builds that had to fix themselves at least once. */
  buildsNeedingHeal: number;
  /** Share of builds that needed a heal. THIS is the number the 50/50 law is about. */
  rate: number;
  /** Mean heals per build, so a few disastrous builds are distinguishable from a broad drift. */
  perBuild: number;
  /** The worst single build in the window — a ceiling worth seeing, not an average. */
  worst: number;
}

/**
 * HOW OFTEN THE BUILDER HAS TO FIX ITS OWN WORK.
 *
 * ADMIN's 50/50 law, made countable: *"a self-heal is NOT a success — it is a RED FLAG. Why did the
 * builder not produce this correctly in the FIRST attempt? The goal is 100% correct in ONE pass, with
 * ZERO heals needed."*
 *
 * Every other number on this scorecard measures whether the app came out working. This one measures
 * whether it came out working **the first time** — and it is the only one that can get WORSE while
 * every other number looks fine, because a heal that fires turns a defect into a green tick. Without
 * it, "success 95%" reads as excellence when it may be 95% of builds quietly repairing themselves.
 *
 * A build with no recorded heal count is EXCLUDED rather than counted as zero. Older records predate
 * the field, and scoring them as "needed no heal" would make the rate improve as the window fills with
 * old data — an error in the flattering direction, which is the one to guard against.
 *
 * PURE.
 */
export function healPressure(builds: readonly BuildMetricInput[]): HealPressure {
  const rows = judgeable(builds).filter((b) => typeof b.healCount === 'number' && (b.healCount as number) >= 0);
  const n = rows.length;
  if (n === 0) return { builds: 0, buildsNeedingHeal: 0, rate: 0, perBuild: 0, worst: 0 };
  const counts = rows.map((b) => Math.floor(b.healCount as number));
  const needing = counts.filter((c) => c > 0).length;
  const total = counts.reduce((a, c) => a + c, 0);
  return {
    builds: n,
    buildsNeedingHeal: needing,
    rate: needing / n,
    perBuild: Math.round((total / n) * 100) / 100,
    worst: Math.max(...counts),
  };
}

export interface BuilderScorecard {
  success: BuildSuccess;
  survival: EditSurvival;
  time: Distribution;
  cost: Distribution;
  /** How often the builder had to repair its own output — the 50/50 law as a number. */
  heal: HealPressure;
}

export function builderScorecard(builds: readonly BuildMetricInput[]): BuilderScorecard {
  return {
    success: buildSuccess(builds),
    survival: editSurvival(builds),
    time: timeToWorkingApp(builds),
    cost: costPerWorkingApp(builds),
    heal: healPressure(builds),
  };
}

/** The sample size below which a rate is noise dressed as a measurement. */
export const MIN_SAMPLES_FOR_RATE = 5;

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const mins = (ms: number): string => `${(ms / 60000).toFixed(1)} min`;

/**
 * Honest prose for the admin dashboard.
 *
 * A rate built from two builds is not a rate, so below MIN_SAMPLES_FOR_RATE the number is still shown
 * but explicitly marked as too small to read anything into — the alternative (hiding it) invites the
 * assumption that nothing was measured, and the other alternative (stating it plainly) invites a
 * decision based on noise.
 */
export function scorecardHeadline(card: BuilderScorecard): string {
  const lines: string[] = [];

  if (card.success.rate === null) {
    lines.push('No finished builds recorded yet — build success is unknown.');
  } else {
    const note = card.success.total < MIN_SAMPLES_FOR_RATE ? ' (too few builds to read a trend into)' : '';
    lines.push(`Build success: ${pct(card.success.rate)} of ${card.success.total}${note}.`);
  }

  if (card.survival.rate === null) {
    lines.push('Edit survival: no project has been edited more than once yet — unknown.');
  } else {
    const note = card.survival.edits < MIN_SAMPLES_FOR_RATE ? ' (too few edits to read a trend into)' : '';
    lines.push(
      `Edit survival: ${pct(card.survival.rate)} of ${card.survival.edits} edit(s) across `
      + `${card.survival.projects} project(s); longest clean run ${card.survival.longestStreak}; `
      + `${card.survival.currentlyBroken} project(s) currently sitting on a failed build${note}.`,
    );
  }

  lines.push(card.time.median === null
    ? 'Time to working app: no successful build with a duration yet.'
    : `Time to working app: ${mins(card.time.median)} median, ${mins(card.time.p90 as number)} p90, `
      + `${mins(card.time.worst as number)} worst (${card.time.samples} build(s)).`);

  lines.push(card.cost.median === null
    ? 'Cost per working app: no successful build with a charge yet.'
    : `Cost per working app: ₹${(card.cost.median as number).toFixed(2)} median, `
      + `₹${(card.cost.worst as number).toFixed(2)} worst (${card.cost.samples} build(s)).`);

  // THE 50/50 LAW, STATED AS A NUMBER. Every line above measures whether the app came out working.
  // This one measures whether it came out working the FIRST time — the only line here that can get
  // worse while all the others look fine, because a heal that fires turns a defect into a green tick.
  if (card.heal.builds === 0) {
    lines.push('First-pass quality: no build has recorded a heal count yet — unknown.');
  } else {
    const note = card.heal.builds < MIN_SAMPLES_FOR_RATE ? ' (too few builds to read a trend into)' : '';
    lines.push(
      `First-pass quality: ${pct(1 - card.heal.rate)} of ${card.heal.builds} build(s) needed NO self-repair; `
      + `${card.heal.buildsNeedingHeal} had to fix themselves (${card.heal.perBuild} repairs per build on `
      + `average, worst ${card.heal.worst}). A heal is a defect that was generated and then papered over — `
      + `the target is zero${note}.`,
    );
  }

  return lines.join('\n');
}
