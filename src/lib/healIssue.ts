/**
 * WHAT IS A SELF-HEAL? — one answer, asked from one place (admin scorecard 2026-09-25).
 *
 * ## The bug
 *
 * The Builder scorecard's "Most-repaired" line read:
 *
 *   TOOL_DONE ×10313 (236 builds), TOOL_CALL ×10171, AGENT_STEP ×6903, EVENT ×4724, HEARTBEAT ×3431,
 *   SANDBOX_CMD ×2300 — across 264 build(s), 44324 repair(s) named.
 *
 * Not one of those is a repair. A tool call, a heartbeat and a narration line are the build HAPPENING.
 * Two lines above it the same card said "3.36 repairs per build" — 887 in total — and both numbers were
 * printed with full confidence. 44,324 against 887 is a factor of fifty, and the module that produced
 * the big one had written, in its own header, that it inherited its definition of a heal from the
 * recorder "rather than invents" one. It had not. It counted `autoResolved === true`; the recorder's
 * `counts.autoResolved` counts `autoResolved && severity !== 'info' && !observation && !narration &&
 * !workaround`, because every heartbeat, tool call and narration line is recorded `info, autoResolved:
 * true` so that it never counts as an UNRESOLVED defect. The flag means "not a problem left behind";
 * only the recorder's extra clauses turn that into "a problem we fixed". Same word, two definitions,
 * and the breakdown's completeness check — `unattributed = total − seen` — was neutralised by the same
 * error: with `seen` fifty times `total`, it clamped to zero on every build and the truncation it
 * existed to declare became invisible.
 *
 * A third copy lived in `firstPassQuality.ts` (`topHealCodes`), with the observation clause and none
 * of the others — the drifted-copy class this repo has paid for with `safeRelPath` ×4, `tagsOnLine`
 * ×2 and two accessibility analyzers. Three counters, three predicates, one word.
 *
 * ## The rule
 *
 * `isSelfHeal` is the ONLY definition. The recorder's `counts.autoResolved`, the per-build heal-code
 * breakdown and the first-pass work list all call it, so they cannot disagree again: a fourth reader
 * that wants to know whether an issue is a heal asks here, never re-derives it from the flag.
 *
 * ## The second bug, same report: "Workarounds: 100.0% of 165 build(s)"
 *
 * True by construction, and therefore not a measurement. The recorder wrote `counts.workarounds` ONLY
 * when it was above zero, and `workaroundPressure` excludes a build with no recorded count (correctly —
 * an unrecorded build must not score as clean). Every included build therefore had at least one, and
 * the rate could never have printed anything but 100%. `workaroundCountOf` closes that from both ends:
 * the recorder now writes the zero, and for a stored report that predates the zero the count is
 * derived from a COMPLETE timeline with the same predicate — or left `null`, never guessed, when the
 * timeline was trimmed.
 *
 * Pure. `src/lib` so both the server recorder and the shared metrics can import it without a cycle.
 */

/** The slice of a build issue these predicates read — structural, so stored rows and live rows both fit. */
export interface HealIssueLike {
  code?: unknown;
  severity?: unknown;
  autoResolved?: unknown;
  observation?: unknown;
}

/**
 * Codes that mean "we went around it", not "we fixed it" (BuildDiagnostics, admin report 2026-09-13:
 * a build whose `autoResolved: 4` were four PROVIDER_FALLBACK warnings that resolved nothing).
 *
 * ⚠️ Keep this list in sync with any NEW fallback code. Counted by CODE rather than a per-call-site
 * flag precisely so that adding a fallback and forgetting to mark it cannot inflate the heal number.
 */
export const WORKAROUND_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_FALLBACK',
  'SIMPLE_BUILD_FALLBACK',
  'ONESHOT_FALLBACK',
  'SIMPLE_BUILD_OUTCOME',
  // HEAL_RULE 3 (autopsy 303e8a6f's heal census, each verdict checked by a second reviewer): each is recorded
  // WARNING + closed when the engine went AROUND something, and each was counted as a self-heal.
  'GOLDEN_SCAFFOLD_SKIPPED', // the tested template was not seeded; the build wrote the app from scratch instead
  'NO_CLAUDE_BLOCKED', // the Weak-tier guard refused a Claude call; the chain fell to another rung
  'ONESHOT_VERIFY_FAILED', // the one-shot app did not compile after its one repair; handed to the full builder
  'SIMPLE_BUILD_VERIFY_ERROR', // the fast lane could not make its files compile; handed to the full builder
  'GREEN_GUARD_RESTORED', // a rollback threw the turn's work away rather than fixing it
]);

/**
 * Codes recorded `autoResolved: true` because they do NOT BLOCK — never because anything was repaired
 * (admin scorecard 2026-09-30).
 *
 * The scorecard's "Most-repaired" list read `READINESS_WARNING ×305 (130 builds)` at the top, then
 * `PREVIEW_SNAPSHOT_STALE ×105`. Neither is a repair. A readiness warning is a finding the gate
 * decided was not a blocker — an import cycle, an unused component, a requested feature that was never
 * built — and it is still in the app when the build ends; the flag is set so it never counts as an
 * UNRESOLVED blocker (see NEVER_ROOT_CAUSE in BuildDiagnostics). A stale snapshot is a copy that stayed
 * stale. So the one number the 50/50 law is read from counted shipped imperfections as heals, and the
 * work list it produced pointed the next autopsy at "the heal that fires most" when nothing had been
 * healed. That is the 2026-09-25 bug (info rows counted as repairs) in its last remaining shape.
 *
 * They are not dropped: they are counted as LEFT OPEN (`isLeftOpen`) — the fifth rule's ❌ bucket, which
 * is where a finding that survived into the delivered app belongs.
 *
 * ⚠️ A NEW code recorded `severity: 'warning'`, `autoResolved: true` that fixed nothing belongs here.
 * Ask of every such record: "what was repaired between the moment this was noticed and now?" — if the
 * answer is "nothing, it was never going to block", it is left open, not a heal.
 */
export const NOT_A_REPAIR_CODES: ReadonlySet<string> = new Set([
  'READINESS_WARNING',
  'PREVIEW_SNAPSHOT_STALE',
  'USAGE_NOT_REPORTED',
  'CHEAP_REVIEW_NOT_RUN',
  // A repair that was UNDONE: the defect it targeted is still there.
  'RUNTIME_FIX_REGRESSED',
  'DESIGN_HEAL_REVERTED',
  // HEAL_RULE 3 (autopsy 303e8a6f's heal census): reported, never corrected — still true when the build ends.
  'FILE_BUDGET_EXCEEDED', // the plan exceeded its file ceiling and was built in full; nothing trimmed
  'GROUNDING_COST', // a lopsided or over-budget grounding block; the cap working, not a repair
  'TIER_LADDER', // a misread ladder setting or an all-keyless ladder; reported, left as it is
]);

/**
 * What a self-heal is, positively: the codes recorded WARNING + closed because the engine really fixed or prevented
 * something (each checked by the heal census of autopsy 303e8a6f). With WORKAROUND_CODES and NOT_A_REPAIR_CODES it
 * makes the classification guilty until listed: a census fails when a NEW code is recorded warning + closed and is
 * in none of the three, so "counted as a heal by default" can never happen silently again.
 */
export const REPAIR_CODES: ReadonlySet<string> = new Set([
  'DATA_LOSS_EVENT', // lost project files were written back from the durable store
  'REPAIR_OUT_OF_SCOPE', // a repair's out-of-scope files were blocked before they reached disk
  'ZOMBIE_WRITE_REFUSED', // a stale lane was stopped from writing over the live app
  'DEP_RECONCILE_GUARDED', // a dependency drop was undone before package.json was written
  'HTML_ENTRY_REPAIRED', // index.html got back the script/mount that boots the app
  'DANGLING_STYLESHEET_IMPORT_REMOVED', // an import of a stylesheet that does not exist was removed
]);

/** The codes HEAL_RULE 3 moved out of the heal count — older reports counted them as repairs. */
const RULE_3_RECLASSIFIED: ReadonlySet<string> = new Set([
  'GOLDEN_SCAFFOLD_SKIPPED', 'NO_CLAUDE_BLOCKED', 'ONESHOT_VERIFY_FAILED', 'SIMPLE_BUILD_VERIFY_ERROR', 'GREEN_GUARD_RESTORED',
  'FILE_BUDGET_EXCEEDED', 'GROUNDING_COST', 'TIER_LADDER',
]);

/**
 * The version of the heal rule a report's `counts.autoResolved` was computed with. Reports written
 * before versioning carry no `counts.healRule`; some counted all closed EVENTS, others used older
 * repair predicates. Their definitions cannot be inferred from the date or a scalar alone.
 */
export const HEAL_RULE = 3;

/**
 * The engine REPEATING a sentence, never a measurement (autopsy 586295b7, 2026-09-20). Excluded from
 * every tally: not an error the build had, not a warning it raised, not something it healed.
 */
export const NARRATION_CODES: ReadonlySet<string> = new Set(['AGENT_NOTE', 'AGENT_STEP']);

const codeOf = (i: HealIssueLike | null | undefined): string => String(i?.code ?? '');

/** True when this entry is narration. PURE. */
export function isNarrationIssue(i: HealIssueLike | null | undefined): boolean {
  return NARRATION_CODES.has(codeOf(i));
}

/**
 * True when this entry records the engine routing AROUND a problem — a deferred root cause, counted as
 * debt and never as a heal. An `info` row of a workaround code is a note, not a fallback that fired.
 */
export function isWorkaroundIssue(i: HealIssueLike | null | undefined): boolean {
  return !!i && WORKAROUND_CODES.has(codeOf(i)) && i.severity !== 'info';
}

/**
 * THE definition of a self-heal: a WARNING or ERROR the engine recorded and then genuinely resolved.
 *
 * Every clause exists because its absence has inflated the number once:
 * - `severity !== 'info'` — heartbeats, tool calls, phase timings and `SANDBOX_CMD` are `info`,
 *   `autoResolved: true`, so that they never count as unresolved. Mitrify autopsy #2 (2026-08-04): a
 *   read-only survey turn reported "healCount 32" from them alone.
 * - `observation !== true` — an advisory note about the user's pre-existing code is neither ours to have
 *   healed nor ours to owe (same day).
 * - not narration — a repeated sentence is not a measurement (586295b7).
 * - not a workaround — a fallback that fired fixed nothing (2026-09-13).
 * - not left open — a finding recorded as non-blocking was never repaired (2026-09-30).
 */
export function isSelfHeal(i: HealIssueLike | null | undefined): boolean {
  if (!i || i.autoResolved !== true) return false;
  if (i.observation === true) return false;
  if (i.severity === 'info') return false;
  if (isNarrationIssue(i)) return false;
  if (WORKAROUND_CODES.has(codeOf(i))) return false;
  if (NOT_A_REPAIR_CODES.has(codeOf(i))) return false;
  return true;
}

/**
 * A non-blocking finding that was still there when the build ended — neither a heal nor a blocker.
 * Counted so it is never lost when it stops being called a repair. PURE.
 */
export function isLeftOpen(i: HealIssueLike | null | undefined): boolean {
  if (!i || i.autoResolved !== true) return false;
  if (i.observation === true || i.severity === 'info') return false;
  return NOT_A_REPAIR_CODES.has(codeOf(i));
}

/** A stored or live report, read structurally — this module never imports the recorder. */
export interface HealReportLike {
  issues?: HealIssueLike[] | null;
  counts?: { total?: unknown; workarounds?: unknown; autoResolved?: unknown; healRule?: unknown; leftOpen?: unknown } | null;
  truncation?: { channels?: { issues?: { kept?: unknown; total?: unknown } | null } | null } | null;
}

/**
 * Is EVERY issue the build recorded present in this copy of the report?
 *
 * Three things can make the answer no, and a count derived from an incomplete timeline would be an
 * under-count wearing a measurement's clothes: the storage trim (`truncation.channels.issues` says
 * `kept < total`), the recorder's own in-memory cap (it writes a `TIMELINE_TRUNCATED` row), and a
 * timeline shorter than the recorder's own `counts.total`. Unknown ⇒ false: "cannot tell" is not
 * "complete".
 */
export function isTimelineComplete(report: HealReportLike | null | undefined): boolean {
  const issues = Array.isArray(report?.issues) ? report!.issues! : null;
  if (!issues) return false;
  const total = report?.counts?.total;
  if (typeof total !== 'number' || !Number.isFinite(total)) return false;
  if (issues.length < total) return false;
  const fact = report?.truncation?.channels?.issues;
  if (fact && typeof fact.kept === 'number' && typeof fact.total === 'number' && fact.kept < fact.total) return false;
  if (issues.some((i) => codeOf(i) === 'TIMELINE_TRUNCATED')) return false;
  return true;
}

/**
 * How many times this build routed AROUND a problem — the recorder's own number when it wrote one, else
 * a count over a COMPLETE timeline (which may legitimately be zero), else `null`.
 *
 * Zero and null are different answers and must stay so: zero means "this build had none", null means
 * "nobody can say" — and `workaroundPressure` excludes the second rather than scoring it as clean.
 */
export function workaroundCountOf(report: HealReportLike | null | undefined): number | null {
  const recorded = report?.counts?.workarounds;
  if (typeof recorded === 'number' && Number.isFinite(recorded) && recorded >= 0) {
    const rule = finiteCount(report?.counts?.healRule);
    if (rule !== null && rule >= HEAL_RULE) return Math.floor(recorded);
    // An older report did not count the HEAL_RULE 3 workaround codes — add the ones its timeline shows.
    const added = (Array.isArray(report?.issues) ? report!.issues! : []).filter((i) => RULE_3_RECLASSIFIED.has(codeOf(i)) && isWorkaroundIssue(i)).length;
    return Math.floor(recorded) + added;
  }
  if (!isTimelineComplete(report)) return null;
  return (report!.issues ?? []).filter(isWorkaroundIssue).length;
}

const finiteCount = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Why a recorded counter may (or may not) be read as a repair measurement. */
export type HealCountProvenance =
  | 'current-rule' | 'rule-2-adjusted' | 'rule-2-visible-adjustment' | 'future-rule'
  | 'legacy-closed-events' | 'legacy-unverified' | 'unrecorded';

/** Whether a provenance tag permits a numeric producer total (possibly explicitly qualified). */
export function hasMeasuredRepairProvenance(provenance: unknown): boolean {
  return provenance === 'current-rule' || provenance === 'rule-2-adjusted'
    || provenance === 'rule-2-visible-adjustment' || provenance === 'future-rule';
}

export interface HealTimelineEvidence {
  status: 'complete' | 'incomplete' | 'unknown';
  reason: 'coherent-census' | 'declared-loss' | 'recorder-cap' | 'short-timeline'
    | 'missing-timeline' | 'missing-total' | 'invalid-census' | 'invalid-row' | 'inconsistent-channel';
}

export interface HealCountInterpretation {
  /** Exact finite numeric evidence only; malformed payloads remain solely in the original report. */
  rawAutoResolved: number | null;
  rawHealRule: number | null;
  rawAutoResolvedState: 'numeric' | 'missing' | 'invalid';
  rawHealRuleState: 'numeric' | 'missing' | 'invalid';
  /** Repair total usable by metrics. Null is authoritative unknown, NOT a raw-counter fallback. */
  total: number | null;
  /** Historical arithmetic retained for compatibility only; NOT an independent repair measurement. */
  compatibilityCount: number | null;
  provenance: HealCountProvenance;
  /** Current-predicate rows actually visible; null means the timeline is unavailable, not zero. */
  observed: number | null;
  timeline: HealTimelineEvidence;
}

/** Bounded, JSON/Firestore-safe evidence; never copy arbitrary raw payloads into listing metadata. */
const rawCountEvidence = (value: unknown): { value: number | null; state: 'numeric' | 'missing' | 'invalid' } =>
  typeof value === 'number' && Number.isFinite(value) ? { value, state: 'numeric' }
    : { value: null, state: value == null ? 'missing' : 'invalid' };

const censusInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** A strict evidence check local to repair provenance; does not change other timeline consumers. */
function repairTimelineEvidence(report: HealReportLike | null | undefined): HealTimelineEvidence {
  const issues = report?.issues;
  if (!Array.isArray(issues)) return { status: 'unknown', reason: 'missing-timeline' };
  if (issues.some((i) => codeOf(i) === 'TIMELINE_TRUNCATED')) return { status: 'incomplete', reason: 'recorder-cap' };
  const fact = report?.truncation?.channels?.issues;
  if (fact != null) {
    if (!censusInteger(fact.kept) || !censusInteger(fact.total) || fact.kept !== issues.length || fact.kept > fact.total) {
      return { status: 'unknown', reason: 'inconsistent-channel' };
    }
    if (fact.kept < fact.total) return { status: 'incomplete', reason: 'declared-loss' };
  }
  const total = report?.counts?.total;
  if (total == null) return { status: 'unknown', reason: 'missing-total' };
  if (!censusInteger(total) || issues.length > total) return { status: 'unknown', reason: 'invalid-census' };
  if (issues.length < total) return { status: 'incomplete', reason: 'short-timeline' };
  if (issues.some((i) => !i || typeof i !== 'object' || Array.isArray(i)
    || typeof i.code !== 'string' || !i.code.trim()
    || typeof i.severity !== 'string' || !['info', 'warning', 'error'].includes(i.severity)
    || typeof i.autoResolved !== 'boolean'
    || (i.observation !== undefined && typeof i.observation !== 'boolean'))) {
    return { status: 'unknown', reason: 'invalid-row' };
  }
  return { status: 'complete', reason: 'coherent-census' };
}

/** The existing rule-specific adjustment, kept separate from whether its producer is identifiable. */
function compatibleHealCount(report: HealReportLike | null | undefined): number | null {
  const recorded = finiteCount(report?.counts?.autoResolved);
  if (recorded === null) return null;
  const rule = finiteCount(report?.counts?.healRule);
  if (rule !== null && rule >= HEAL_RULE) return recorded;
  const issues = Array.isArray(report?.issues) ? report!.issues! : [];
  // Subtract once: rule 2 already excluded the earlier left-open codes.
  const countedThen = (i: HealIssueLike | null | undefined) => !!i && i.autoResolved === true && i.observation !== true && i.severity !== 'info' && !isNarrationIssue(i);
  const reclassified = issues.filter((i) => countedThen(i) && RULE_3_RECLASSIFIED.has(codeOf(i))).length;
  const leftOpenBeforeRule2 = rule === null || rule < 2
    ? issues.filter((i) => isLeftOpen(i) && !RULE_3_RECLASSIFIED.has(codeOf(i))).length
    : 0;
  return Math.max(0, recorded - reclassified - leftOpenBeforeRule2);
}

/**
 * Interpret evidence, never rewrite history. An unversioned counter might count closed EVENTS,
 * not repairs. Only a coherent complete census with a positive closed-info witness identifies that
 * specific old producer signature. Sparse/ambiguous legacy data stays unverified, not recovered.
 * Narrative text and repeated-row multiplicity are deliberately not repair measurements.
 *
 * Supported rule 2 retains its visible one-time adjustment even on cropped evidence (qualified, not
 * exact current-rule truth). Future rules retain producer totals without assuming their definitions.
 * Existing fractional normalization is retained for versioned numeric compatibility, not used to
 * manufacture a valid producer tag or a positive historical signature.
 */
export function interpretRepairCount(report: HealReportLike | null | undefined): HealCountInterpretation {
  const rawAutoResolved = report?.counts?.autoResolved;
  const rawHealRule = report?.counts?.healRule;
  const compatibilityCount = compatibleHealCount(report);
  const timeline = repairTimelineEvidence(report);
  const issues = Array.isArray(report?.issues) ? report!.issues! : null;
  const observed = issues ? issues.filter(isSelfHeal).length : null;
  let provenance: HealCountProvenance = 'unrecorded';
  let total: number | null = null;
  if (compatibilityCount !== null) {
    if (censusInteger(rawHealRule) && rawHealRule >= 2) {
      total = compatibilityCount;
      provenance = rawHealRule === HEAL_RULE ? 'current-rule'
        : rawHealRule > HEAL_RULE ? 'future-rule'
          : timeline.status === 'complete' ? 'rule-2-adjusted' : 'rule-2-visible-adjustment';
    } else {
      const closedEvents = issues?.filter((i) => i?.autoResolved === true).length;
      const closedInfo = issues?.some((i) => i?.autoResolved === true && i.severity === 'info');
      provenance = rawHealRule == null && timeline.status === 'complete' && censusInteger(rawAutoResolved)
        && rawAutoResolved === closedEvents && closedInfo ? 'legacy-closed-events' : 'legacy-unverified';
    }
  }
  const rawCount = rawCountEvidence(rawAutoResolved);
  const rawRule = rawCountEvidence(rawHealRule);
  return { rawAutoResolved: rawCount.value, rawHealRule: rawRule.value,
    rawAutoResolvedState: rawCount.state, rawHealRuleState: rawRule.state,
    total, compatibilityCount, provenance, observed, timeline };
}

/** Read a listing projection without reviving unknowns or losing a valid older versioned projection. */
export function repairCountFromProjection(report: HealReportLike & {
  healCodes?: { total: number | null; interpretation?: HealCountInterpretation } | null;
}): HealCountInterpretation | null {
  if (report.healCodes === null) return null; // normalization failed; raw fallback is not evidence
  const interpreted = report.healCodes?.interpretation ?? interpretRepairCount(report);
  if (report.healCodes === undefined) return interpreted;
  return { ...interpreted, total: interpreted.total === null || !hasMeasuredRepairProvenance(interpreted.provenance)
    ? null : report.healCodes.total };
}

/**
 * Compatibility API for historical callers. A proven closed-event counter is never a repair total.
 * Other legacy arithmetic is retained, but unverified: measurement consumers MUST use
 * interpretRepairCount().total and carry its provenance instead of promoting this estimate.
 */
export function healCountOf(report: HealReportLike | null | undefined): number | null {
  const interpreted = interpretRepairCount(report);
  return interpreted.provenance === 'legacy-closed-events' ? null : interpreted.compatibilityCount;
}
