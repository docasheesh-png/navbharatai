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
]);

/**
 * The version of the heal rule a report's `counts.autoResolved` was computed with. Reports written
 * before 2026-09-30 carry no `counts.healRule`, and their `autoResolved` still includes the rows
 * NOT_A_REPAIR_CODES now excludes — `healCountOf` corrects for that.
 */
export const HEAL_RULE = 2;

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
  if (typeof recorded === 'number' && Number.isFinite(recorded) && recorded >= 0) return Math.floor(recorded);
  if (!isTimelineComplete(report)) return null;
  return (report!.issues ?? []).filter(isWorkaroundIssue).length;
}

const finiteCount = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/**
 * How many defects this build REALLY repaired. The recorder's own number when it was computed with the
 * current rule; for an older report, that number minus the left-open rows it wrongly included. Null when
 * the report recorded no count ("nobody measured", excluded by every aggregate — never zero).
 *
 * ⚠️ On a legacy report whose timeline was trimmed, left-open rows that were cut cannot be subtracted, so
 * the result can still be slightly HIGH — it is never pushed below the truth.
 */
export function healCountOf(report: HealReportLike | null | undefined): number | null {
  const recorded = finiteCount(report?.counts?.autoResolved);
  if (recorded === null) return null;
  const rule = finiteCount(report?.counts?.healRule);
  if (rule !== null && rule >= HEAL_RULE) return recorded;
  const visibleOpen = (Array.isArray(report?.issues) ? report!.issues! : []).filter(isLeftOpen).length;
  return Math.max(0, recorded - visibleOpen);
}
