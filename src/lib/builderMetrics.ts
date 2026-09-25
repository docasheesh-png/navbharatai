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
  /**
   * How many times the build ROUTED AROUND a problem instead of fixing it (a fallback to another
   * provider or another lane). Already on every report as `counts.workarounds`, and shown on no
   * scorecard until 2026-09-24 — so the 🔀 bucket the fifth absolute rule demands a tally of was the
   * one bucket the tally could not see.
   */
  workaroundCount?: number | null;
  /**
   * WHICH repairs this build ran, with its own completeness. `undefined` ⇒ never measured, and the
   * breakdown EXCLUDES it rather than scoring it as a build that healed nothing.
   */
  healCodes?: { codes: Record<string, number>; total: number | null; unattributed: number | null } | null;
  /**
   * THE THREE FACTS THAT LET A STUCK PROJECT BE NAMED (admin 2026-09-25: "7 projects currently
   * sitting on a failed build" — and the card could not say which seven). All optional and all
   * already on the stored report; the metric never reads them for a rate, only to describe a row.
   */
  /** The engine's own one-line diagnosis of why this build failed. Admin-only text. */
  rootCause?: string | null;
  /** What the user asked for, truncated upstream. */
  prompt?: string | null;
  /**
   * Did GreenGuard put the LAST WORKING VERSION back after this build failed? `true` means the user
   * still has a working app and the edit was rejected; `false` means the failed attempt is what they
   * are looking at; `null`/undefined means the report cannot say.
   */
  restoredToGreen?: boolean | null;
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
  /**
   * Of those, how many had their last WORKING version put back by GreenGuard — the user's app still
   * runs, the edit was refused. "Sitting on a failed build" is true of both; only this number says
   * whether a real person is looking at a broken screen.
   */
  restoredToGreen: number;
  /** Of those, how many the reports cannot say either way about (a legacy row with no timeline). */
  restoredUnknown: number;
  /**
   * THE SEVEN, NAMED. Newest failure first, capped at STUCK_PROJECTS_SHOWN; `currentlyBroken` is
   * still the full count. A number with no names is a number nobody can act on.
   */
  broken: StuckProject[];
  /** Builds excluded because they were in flight or had no verdict. */
  skipped: number;
}

/** One project whose latest build failed, with everything the stored report can say about it. */
export interface StuckProject {
  workspaceId: string;
  /** When the failing build started (its own clock). */
  lastBuildAt: number;
  /** How many builds in a row have now failed on this project, counting the latest. */
  failedInARow: number;
  /** How many builds this project has in the window at all. */
  builds: number;
  restoredToGreen: boolean | null;
  rootCause: string | null;
  prompt: string | null;
}

/** At most this many stuck projects are named on the card; the count above the list is the full one. */
export const STUCK_PROJECTS_SHOWN = 50;

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
  let restoredToGreen = 0;
  let restoredUnknown = 0;
  const broken: StuckProject[] = [];

  for (const [workspaceId, list] of byProject.entries()) {
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
    const last = ordered[ordered.length - 1];
    if (last.ok === false) {
      currentlyBroken += 1;
      const restored = typeof last.restoredToGreen === 'boolean' ? last.restoredToGreen : null;
      if (restored === true) restoredToGreen += 1;
      if (restored === null) restoredUnknown += 1;
      let failedInARow = 0;
      for (let i = ordered.length - 1; i >= 0 && ordered[i].ok === false; i--) failedInARow += 1;
      broken.push({
        workspaceId,
        lastBuildAt: last.reportedAt,
        failedInARow,
        builds: ordered.length,
        restoredToGreen: restored,
        rootCause: typeof last.rootCause === 'string' && last.rootCause.trim() ? last.rootCause.trim() : null,
        prompt: typeof last.prompt === 'string' && last.prompt.trim() ? last.prompt.trim() : null,
      });
    }
  }

  // Newest failure first — the person most likely to still be sitting in front of it.
  broken.sort((a, b) => (b.lastBuildAt - a.lastBuildAt) || a.workspaceId.localeCompare(b.workspaceId));

  return {
    projects,
    edits,
    survived,
    rate: edits > 0 ? survived / edits : null,
    longestStreak,
    currentlyBroken,
    restoredToGreen,
    restoredUnknown,
    broken: broken.slice(0, STUCK_PROJECTS_SHOWN),
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

export interface WorkaroundPressure {
  /** Finished builds carrying a workaround count — the only ones this can be computed from. */
  builds: number;
  /** Builds that routed around a problem at least once. */
  buildsWithWorkaround: number;
  rate: number;
  perBuild: number;
  worst: number;
}

/**
 * HOW OFTEN THE BUILDER WENT ROUND A PROBLEM INSTEAD OF THROUGH IT.
 *
 * The fifth absolute rule's 🔀 bucket: *"Every workaround is a DEFERRED root cause — flag it as debt,
 * never as a win"*, and the 50/50 law goes further: *"a workaround must be ARCHITECTURALLY
 * IMPOSSIBLE"*. `BuildDiagnostics` has recorded the number since the bucket was written, and its own
 * comment explains why it is kept OUT of `autoResolved`: *"a tally that counts them as heals hides
 * exactly the debt the tally exists to surface."* The scorecard then showed the heal tally and not
 * this one — so the debt was hidden by the scorecard instead.
 *
 * Same exclusion rule as healPressure and for the same reason: a build with no recorded count is
 * EXCLUDED, never scored as a clean zero, or the rate improves as the window fills with old records.
 *
 * PURE.
 */
export function workaroundPressure(builds: readonly BuildMetricInput[]): WorkaroundPressure {
  const rows = judgeable(builds).filter((b) => typeof b.workaroundCount === 'number' && (b.workaroundCount as number) >= 0);
  const n = rows.length;
  if (n === 0) return { builds: 0, buildsWithWorkaround: 0, rate: 0, perBuild: 0, worst: 0 };
  const counts = rows.map((b) => Math.floor(b.workaroundCount as number));
  const with_ = counts.filter((c) => c > 0).length;
  const total = counts.reduce((a, c) => a + c, 0);
  return {
    builds: n,
    buildsWithWorkaround: with_,
    rate: with_ / n,
    perBuild: Math.round((total / n) * 100) / 100,
    worst: Math.max(...counts),
  };
}

export interface HealCodeRow {
  code: string;
  /** Heals of this code across the window. */
  heals: number;
  /** How many DISTINCT builds ran it — one build healing 86 times is not a widespread class. */
  builds: number;
}

export interface HealBreakdown {
  /** Builds carrying a breakdown at all — the denominator, never the window's size. */
  builds: number;
  /** The heaviest codes first, then alphabetically so the order is stable for a given window. */
  top: HealCodeRow[];
  /** Heals this list can name. */
  attributed: number;
  /**
   * Heals that HAPPENED and could not be named, because the stored timeline was trimmed at 500
   * entries while `counts` kept the build's real number. Never folded into `attributed`, and never
   * hidden: a work list that quietly omits the biggest build's repairs is the wrong work list.
   */
  unattributed: number;
  /** Builds whose total was unrecorded, so nobody can say whether their list was complete. */
  completenessUnknown: number;
}

/** How many codes the headline names. The rest are still counted in `attributed`. */
export const HEAL_CODES_SHOWN = 6;

/**
 * WHICH REPAIRS FIRE — the 50/50 law's missing half, as a ranked list.
 *
 * The heal RATE says the engine repairs itself on 4 builds in 5. It cannot say what to fix. This
 * turns the same data into the thing the law actually asks for: *"trace why the bug class exists and
 * prevent it upstream"* — you cannot trace a class nobody has named.
 *
 * 🔒 THREE HONESTY PROPERTIES, none of them decoration:
 * • A build with no breakdown is EXCLUDED, exactly as `healPressure` excludes one with no count — a
 *   legacy row scored as "healed nothing" would make the list look better as the window ages.
 * • `unattributed` is carried through and reported. The build with 86 heals is precisely the one
 *   whose timeline the 500-entry cap will have trimmed, so the biggest contributor to the rate is
 *   the likeliest to be partly invisible. Presenting the visible codes as the whole list would be
 *   the `reportTruncation` bug in a new place.
 * • `builds` per code is kept beside `heals`, because 86 heals in ONE build and 86 across 43 builds
 *   are different problems and the fix for each is different.
 *
 * PURE.
 */
export function healBreakdown(builds: readonly BuildMetricInput[]): HealBreakdown {
  const rows = judgeable(builds).filter((b) => b.healCodes && typeof b.healCodes === 'object');
  const heals = new Map<string, number>();
  const seenIn = new Map<string, number>();
  let attributed = 0;
  let unattributed = 0;
  let completenessUnknown = 0;

  for (const b of rows) {
    const tally = b.healCodes as NonNullable<BuildMetricInput['healCodes']>;
    for (const [code, n] of Object.entries(tally.codes ?? {})) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue;
      heals.set(code, (heals.get(code) ?? 0) + n);
      seenIn.set(code, (seenIn.get(code) ?? 0) + 1);
      attributed += n;
    }
    if (typeof tally.unattributed === 'number' && tally.unattributed > 0) unattributed += tally.unattributed;
    if (tally.unattributed === null || tally.unattributed === undefined) completenessUnknown += 1;
  }

  const top = [...heals.entries()]
    .map(([code, n]) => ({ code, heals: n, builds: seenIn.get(code) ?? 0 }))
    // Heaviest first; ties broken by NAME so the same window always renders the same order.
    .sort((a, b) => (b.heals - a.heals) || a.code.localeCompare(b.code))
    .slice(0, HEAL_CODES_SHOWN);

  return { builds: rows.length, top, attributed, unattributed, completenessUnknown };
}

export interface BuilderScorecard {
  success: BuildSuccess;
  survival: EditSurvival;
  time: Distribution;
  cost: Distribution;
  /** How often the builder had to repair its own output — the 50/50 law as a number. */
  heal: HealPressure;
  /** How often it routed AROUND a problem instead — the deferred-debt half of the same law. */
  workaround: WorkaroundPressure;
  /** WHICH repairs fire — the heal rate turned into a work list. */
  healCodes: HealBreakdown;
}

export function builderScorecard(builds: readonly BuildMetricInput[]): BuilderScorecard {
  return {
    success: buildSuccess(builds),
    survival: editSurvival(builds),
    time: timeToWorkingApp(builds),
    cost: costPerWorkingApp(builds),
    heal: healPressure(builds),
    workaround: workaroundPressure(builds),
    healCodes: healBreakdown(builds),
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
    // "Sitting on a failed build" is two different situations, and the card must say which: the last
    // working version put back (the edit was refused, the app still runs) or the failed attempt left
    // standing (a real person is looking at a broken screen). An unknown is named as unknown.
    const s = card.survival;
    const restoredNote = s.currentlyBroken > 0
      ? ` — ${s.restoredToGreen} restored to the last working version, `
        + `${s.currentlyBroken - s.restoredToGreen - s.restoredUnknown} left on the failed attempt`
        + (s.restoredUnknown > 0 ? `, ${s.restoredUnknown} unknown` : '')
        + (s.broken.length > 0 ? `; named below` : '')
      : '';
    lines.push(
      `Edit survival: ${pct(card.survival.rate)} of ${s.edits} edit(s) across `
      + `${s.projects} project(s); longest clean run ${s.longestStreak}; `
      + `${s.currentlyBroken} project(s) currently sitting on a failed build${restoredNote}${note}.`,
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

  // 🔀 THE DEFERRED-DEBT HALF. Stated separately from the heal line, never summed into it: a heal
  // fixed something, a workaround did not, and the fifth rule calls the second one debt. Silent when
  // nothing recorded a count, so "none happened" and "nothing was measured" stay distinguishable.
  if (card.workaround.builds > 0) {
    lines.push(
      `Workarounds: ${pct(card.workaround.rate)} of ${card.workaround.builds} build(s) routed AROUND a `
      + `problem instead of fixing it (${card.workaround.perBuild} per build on average, worst `
      + `${card.workaround.worst}). A workaround is a deferred root cause, never a win.`,
    );
  }

  // 🔧 THE WORK LIST. The line above says the engine repairs itself; this one says what to go and
  // prevent. Silent when nothing was measured, so "no build recorded a breakdown" and "no heals
  // fired" stay different statements.
  if (card.healCodes.builds > 0 && card.healCodes.top.length > 0) {
    const named = card.healCodes.top
      .map((r) => `${r.code} ×${r.heals} (${r.builds} build${r.builds === 1 ? '' : 's'})`)
      .join(', ');
    // The caveat rides IN the sentence, never as a footnote a card could drop: the build with the
    // most heals is the likeliest to have had its timeline trimmed, so it is the likeliest to be
    // missing from the very list meant to rank it.
    const missing = card.healCodes.unattributed > 0
      ? ` ${card.healCodes.unattributed} further repair(s) happened and could not be named — those builds' `
        + 'timelines were trimmed before storage, so this ranking is incomplete by that much.'
      : '';
    const unknown = card.healCodes.completenessUnknown > 0
      ? ` ${card.healCodes.completenessUnknown} build(s) recorded no total, so their lists cannot be checked for completeness.`
      : '';
    lines.push(
      `Most-repaired: ${named} — across ${card.healCodes.builds} build(s) carrying a breakdown, `
      + `${card.healCodes.attributed} repair(s) named.${missing}${unknown}`,
    );
  }

  return lines.join('\n');
}
