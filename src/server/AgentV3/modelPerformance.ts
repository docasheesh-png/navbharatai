/**
 * MODEL PERFORMANCE, AGGREGATED FROM WHAT A BUILD ALREADY RECORDED — the evidence layer.
 *
 * 🔴 THE GAP THIS CLOSES (audit 2026-09-16). Every build's report already carries `llmCalls`
 * (`LlmCallRecord`: model, latency, in/out tokens, `finishReason`, `ok`, `error`) and accurate
 * per-provider failure buckets (`providerFailures` / `providerFailureReasons`). But
 * `listAllDiagnostics` — the ONLY cross-build index — projects metadata alone: `ok`, `summary`,
 * `rootCause`, `counts`, billing. No provider, no model, no latency. So the question "is Kimi better
 * than GLM on complex files?" could only be answered by opening reports ONE AT A TIME, by hand, and
 * the one real observation anyone had was n = 1.
 *
 * This module turns what is already stored into a compact per-(provider, model) summary, so a routing
 * decision can be made from real builds instead of from a single report. **It reads; it never writes,
 * never calls a model, and never touches a build path.**
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 🔒 THE FOUR INTEGRITY RULES, each forced by something real in the data
 *
 * 1. **A FAILED CALL'S MODEL ID IS NOT THE MODEL THAT FAILED, so failures are never attributed to a
 *    model here.** `AgentRunner`'s failure path (AgentRunner.ts:586) reports the *requested* model —
 *    the outer `model` variable, a Claude id — because the chain threw before any rung reported which
 *    one it was. Only the SUCCESS path carries `turn.model ?? model`, i.e. the rung that actually
 *    answered. Counting failed calls per model would therefore file every GLM starvation under
 *    `claude-haiku`, which is worse than not counting it: it would be a plausible, wrong number in
 *    exactly the comparison this module exists to inform.
 *    So per-MODEL stats come from successful calls, and failures are reported per PROVIDER from
 *    `providerFailures` / `providerFailureReasons`, which `recordProviderFailure` fills with the real
 *    name and the real bucket at the moment of failure.
 *
 * 2. **"Not reported" is never written as zero.** A provider that returns no usage yields
 *    `outputTokens: null`, not `0` — the same distinction `USAGE_NOT_REPORTED` (#2974) draws, because
 *    a streamed turn whose vendor ignores `stream_options.include_usage` genuinely has no number and
 *    an averaged zero would silently halve a model's measured cost. `usageReportedCalls` says how many
 *    of the calls the totals are actually built from.
 *
 * 3. **Failure buckets are read, never re-derived.** `timeout` and `output-budget` come from
 *    `providerFailureReasons`, which `classifyProviderFailure` produced from the live error using the
 *    SAME predicates the runner routed on (`isStarvedBudgetError`, and the timeout test). A second
 *    regex here would be a second opinion, and the two would drift.
 *
 * 4. **No first-pass-success flag is invented.** There is no authoritative field for it: `ok` means
 *    the runner returned a result, the release gate's four states are a different question, and a
 *    repair may have run in between. Inventing `ok && green && no-repairs` would look authoritative
 *    and be a definition nobody agreed. The three COMPONENTS are exposed separately (`ok`,
 *    `gateState`, `previewRepairAttempts`) and the analysis phase decides. See `FIRST_PASS_NOTE`.
 *
 * PURE — no clock, no I/O, no env. Everything is derived from one report object.
 */

import type { BuildDiagnosticsReport, LlmCallRecord, BuildIssue } from './BuildDiagnostics';

/** The provider families that can appear on a build ladder. `unknown` when an id matches none. */
export type ModelProvider = 'GLM' | 'KIMI' | 'CLAUDE' | 'OPENAI' | 'GEMINI' | 'GROK' | 'unknown';

/**
 * Which provider serves this model id.
 *
 * ⚠️ DERIVED FROM THE ID, because `llmCalls` has no provider field — `recordLlmCall` accepts one and
 * `AgentRunner`'s two call sites never pass it. The id is what we have, and for the models that
 * actually reach a ladder it is unambiguous. Anything unrecognised is `unknown`, never guessed into a
 * family: a mislabelled row would corrupt the very comparison this is for.
 */
export function providerOfModel(model: string | undefined | null): ModelProvider {
  const m = String(model ?? '').trim().toLowerCase();
  if (!m) return 'unknown';
  if (m.startsWith('glm-')) return 'GLM';
  if (m.startsWith('kimi-') || m.startsWith('moonshot')) return 'KIMI';
  if (m.startsWith('claude-')) return 'CLAUDE';
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) return 'OPENAI';
  if (m.startsWith('gemini-')) return 'GEMINI';
  if (m.startsWith('grok-')) return 'GROK';
  return 'unknown';
}

/** One (provider, model) pair's record within ONE build. Exact identity — never a family bucket. */
export interface ModelStat {
  provider: ModelProvider;
  /** The EXACT id as the report recorded it: `glm-5.3-flash`, `kimi-k2.7-code`, … never normalised. */
  model: string;
  /** Successful calls this model answered. Failures are NOT here — see integrity rule 1. */
  calls: number;
  /** Calls that produced at least one tool use — the build turns that actually did work. */
  deliveredTurns: number;
  /** `finishReason === 'max_tokens'` — the answer was cut at the authorised ceiling. */
  truncatedCalls: number;
  /** How many of `calls` reported usage at all. `calls - usageReportedCalls` reported none. */
  usageReportedCalls: number;
  /** Summed over the calls that REPORTED usage. `null` when none did — never 0 for "unknown". */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Median over calls that carried a latency. `null` when none did. */
  medianLatencyMs: number | null;
  totalLatencyMs: number | null;
  latencySamples: number;
}

/** A provider's failures within ONE build, as the failure ledger recorded them. */
export interface ProviderFailureStat {
  provider: string;
  failures: number;
  /** `classifyProviderFailure` buckets → count, e.g. `{ 'output-budget': 3, timeout: 1 }`. */
  byReason: Record<string, number>;
  /**
   * The ledger's own line, verbatim — e.g. `"18 rate-limit, 2 timeout"`.
   *
   * ⚠️ KEPT BECAUSE THE PARSE IS LOSSY FOR EXACTLY ONE BUCKET. `classifyProviderFailure`'s catch-all
   * is `other: <first line of the error>`, and that text can itself contain a comma — so splitting on
   * commas can cut one `other:` entry into two. Every bucket the routing question turns on
   * (`output-budget`, `timeout`, `rate-limit`, `bad-request`, …) is comma-free and parses exactly; the
   * raw line is here so nothing is ever destroyed by the convenience.
   */
  raw: string;
  /** Convenience projections of the two buckets the routing question turns on. */
  starvedCalls: number;
  timeoutCalls: number;
}

/** What a build's own clock and verdict say, for correlating model choice with outcome. */
export interface BuildOutcomeDims {
  /** `analyzeRequest().taskType`, recorded at build start. `null` on a report written before this shipped. */
  taskType: string | null;
  /** `analyzeRequest().complexityScore` 0-100. `null` on a legacy report — never re-derived (see below). */
  complexityScore: number | null;
  /** The tier the analyser chose to START on. `null` on a legacy report. */
  startTier: string | null;
  /** The release gate's four-state verdict, read out of the RELEASE_GATE issue. `null` if it never ran. */
  gateState: 'green' | 'yellow' | 'red' | 'unknown' | null;
  /**
   * How many times the preview verify loop SAW a problem and went on to a repair pass.
   *
   * ⚠️ NAMED PRECISELY BECAUSE IT IS NOT "ALL REPAIRS". `PREVIEW_NOT_RENDERED` is recorded once per
   * iteration of the preview heal loop, immediately before the heal runner runs — so it counts that
   * loop's model-backed attempts exactly. It does NOT count the deterministic heals (syntax, import
   * path, tsconfig), which spend no model call, nor the design/feature/vaccine passes. Those are all
   * visible in `issueCodeCounts`, unaggregated, so a later question can count whatever it means.
   */
  previewRepairAttempts: number;
  /** Total wall-clock of the build, when both stamps are present. */
  durationMs: number | null;
  /** The CORRECTION_BUDGET line's raw detail (#2979), verbatim. `null` when the build predates it. */
  correctionBudget: string | null;
  /** Every issue code → occurrences. Compact, complete, and invents nothing. */
  issueCodeCounts: Record<string, number>;
}

export interface ModelPerformanceSummary {
  models: ModelStat[];
  providerFailures: ProviderFailureStat[];
  /**
   * Failed model calls that could not be attributed to a model — see integrity rule 1. A build with a
   * high count here has failures whose per-model share is genuinely unknown, and the per-PROVIDER
   * figures above are the honest place to read them.
   */
  unattributedFailedCalls: number;
  /** Passthrough of the build's own attribution, so "GLM: 0" can be read as reached-or-absent. */
  providerDelivery: Record<string, number> | null;
  builtBy: string | null;
  providerChain: string | null;
  dims: BuildOutcomeDims;
}

/**
 * WHY THERE IS NO `firstPassSuccess` FIELD.
 *
 * The admin asked for one "using an existing authoritative field/state if one exists" and to "report
 * that limitation rather than inventing a definition" otherwise. No such field exists:
 *   • `ok` means the RUNNER returned a result — a build that healed three times is still `ok: true`.
 *   • the release gate answers a different question (was it PROVEN to run), and `unknown` is neither
 *     a pass nor a failure by its own design.
 *   • nothing anywhere records "no repair was needed" as a fact.
 * So the components are exposed and the definition is left to whoever analyses the data.
 */
export const FIRST_PASS_NOTE =
  'No authoritative first-pass-success field exists. Use ok + gateState + previewRepairAttempts and '
  + 'state the definition you chose; this projection deliberately does not choose one for you.';

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The gate state out of the RELEASE_GATE issue's message (`releaseGateSummary` writes the word). */
export function gateStateFromIssues(issues: readonly BuildIssue[] | undefined): BuildOutcomeDims['gateState'] {
  const hit = (issues ?? []).find((i) => i?.code === 'RELEASE_GATE');
  if (!hit) return null;
  const m = /Release gate:\s*(GREEN|YELLOW|RED|UNKNOWN)\b/.exec(String(hit.message ?? ''));
  return m ? (m[1].toLowerCase() as BuildOutcomeDims['gateState']) : null;
}

/** Per-(provider, model) statistics over the SUCCESSFUL calls of one build. */
export function modelStatsFromCalls(calls: readonly LlmCallRecord[] | undefined): ModelStat[] {
  const by = new Map<string, ModelStat & { _lat: number[] }>();
  for (const c of calls ?? []) {
    if (!c || c.ok !== true) continue; // integrity rule 1
    const model = String(c.model ?? '').trim();
    if (!model) continue;
    const key = model;
    let s = by.get(key);
    if (!s) {
      s = {
        provider: providerOfModel(model), model, calls: 0, deliveredTurns: 0, truncatedCalls: 0,
        usageReportedCalls: 0, inputTokens: null, outputTokens: null,
        medianLatencyMs: null, totalLatencyMs: null, latencySamples: 0, _lat: [],
      };
      by.set(key, s);
    }
    s.calls += 1;
    if (isNum(c.toolCalls) && c.toolCalls > 0) s.deliveredTurns += 1;
    if (c.finishReason === 'max_tokens') s.truncatedCalls += 1;
    // Integrity rule 2: a call reports usage only if at least one of the two numbers is present.
    const hasIn = isNum(c.inputTokens);
    const hasOut = isNum(c.outputTokens);
    if (hasIn || hasOut) {
      s.usageReportedCalls += 1;
      if (hasIn) s.inputTokens = (s.inputTokens ?? 0) + (c.inputTokens as number);
      if (hasOut) s.outputTokens = (s.outputTokens ?? 0) + (c.outputTokens as number);
    }
    if (isNum(c.latencyMs)) s._lat.push(c.latencyMs);
  }
  return [...by.values()].map(({ _lat, ...rest }) => ({
    ...rest,
    latencySamples: _lat.length,
    medianLatencyMs: median(_lat),
    totalLatencyMs: _lat.length ? _lat.reduce((a, b) => a + b, 0) : null,
  })).sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
}

/** Per-provider failures, read from the ledger the runner filled — never re-classified here. */
export function providerFailureStats(r: Pick<BuildDiagnosticsReport, 'providerFailures' | 'providerFailureReasons'>): ProviderFailureStat[] {
  const counts = r.providerFailures ?? {};
  const reasonsRaw = r.providerFailureReasons ?? {};
  const names = new Set([...Object.keys(counts), ...Object.keys(reasonsRaw)]);
  const out: ProviderFailureStat[] = [];
  for (const provider of names) {
    // `providerFailureReasons` serialises as "3 output-budget, 1 timeout" (see BuildDiagnostics), so
    // the buckets are parsed back out rather than re-derived from any error text.
    const byReason: Record<string, number> = {};
    for (const part of String(reasonsRaw[provider] ?? '').split(',')) {
      const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(part);
      if (m) byReason[m[2]] = (byReason[m[2]] ?? 0) + Number(m[1]);
    }
    out.push({
      provider,
      failures: isNum(counts[provider]) ? counts[provider] : 0,
      byReason,
      raw: String(reasonsRaw[provider] ?? ''),
      starvedCalls: byReason['output-budget'] ?? 0,
      timeoutCalls: byReason['timeout'] ?? 0,
    });
  }
  return out.sort((a, b) => b.failures - a.failures || a.provider.localeCompare(b.provider));
}

/** The build-level dimensions a model comparison has to be correlated against. */
export function buildOutcomeDims(r: BuildDiagnosticsReport): BuildOutcomeDims {
  const issues = r.issues ?? [];
  const issueCodeCounts: Record<string, number> = {};
  for (const i of issues) {
    const code = String(i?.code ?? '').trim();
    if (code) issueCodeCounts[code] = (issueCodeCounts[code] ?? 0) + 1;
  }
  const budget = issues.find((i) => i?.code === 'CORRECTION_BUDGET');
  const req = (r as { requestAnalysis?: { taskType?: string; complexityScore?: number; startTier?: string } }).requestAnalysis;
  return {
    taskType: typeof req?.taskType === 'string' && req.taskType ? req.taskType : null,
    complexityScore: isNum(req?.complexityScore) ? req.complexityScore : null,
    startTier: typeof req?.startTier === 'string' && req.startTier ? req.startTier : null,
    gateState: gateStateFromIssues(issues),
    previewRepairAttempts: issueCodeCounts['PREVIEW_NOT_RENDERED'] ?? 0,
    durationMs: isNum(r.startedAt) && isNum(r.endedAt) && r.endedAt >= r.startedAt ? r.endedAt - r.startedAt : null,
    correctionBudget: typeof budget?.detail === 'string' && budget.detail.trim() ? budget.detail.trim() : null,
    issueCodeCounts,
  };
}

/** The whole per-build projection. Pure; safe on a partial or legacy report. */
export function summarizeModelPerformance(report: BuildDiagnosticsReport | null | undefined): ModelPerformanceSummary {
  const r = (report ?? {}) as BuildDiagnosticsReport;
  const calls = r.llmCalls ?? [];
  return {
    models: modelStatsFromCalls(calls),
    providerFailures: providerFailureStats(r),
    unattributedFailedCalls: calls.filter((c) => c && c.ok === false).length,
    providerDelivery: r.providerDelivery ?? null,
    builtBy: r.builtBy ?? null,
    providerChain: r.providerChain ?? null,
    dims: buildOutcomeDims(r),
  };
}
