/**
 * AgentV3 — cost & quality telemetry (cost-ladder measurement layer).
 *
 * The cost-ladder (P2) routes simple apps to cheaper models. To PROVE that saves
 * money without hurting quality — and to satisfy the design doc's P8 gate
 * ("measure cheap-tier quality + fallback rate per task-type before cutover") —
 * every v5.0 build records a dimensioned telemetry row here: its task type, start
 * tier, billed amount, token usage, success, and duration. Aggregated per calendar
 * day with per-task-type and per-start-tier breakdowns so an admin can see, e.g.,
 * "simple_app builds on the gemini tier succeed 96% of the time at ₹X each".
 *
 * This is the HONEST foundation a cost dashboard needs — without it any per-model
 * breakdown UI would be faking numbers (CLAUDE.md real-features rule). The store
 * mirrors UserCostStore exactly: VITEST-skip, best-effort, never throws, set+merge.
 *
 * Collection: `agentv3_cost_telemetry`
 * Doc ID:     `YYYY-MM-DD` (one doc per calendar day)
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

/** One build's measured outcome, fed into the daily aggregate. */
export interface CostTelemetryEntry {
  /** Analyser task type, e.g. 'simple_app' | 'complex_app' | 'coding'. */
  taskType: string;
  /** Analyser start tier, e.g. 'gemini' | 'haiku' | 'sonnet' | 'opus'. */
  startTier: string;
  /** Marked-up amount the user was billed (USD). */
  billedUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Whether the build completed successfully (quality signal per tier). */
  ok: boolean;
  /** Power / Only-Opus mode (ladder bypassed). */
  powerMode: boolean;
  /** Wall-clock duration of the build (ms). */
  durationMs: number;
  /** P-PE.2 — the architect prompt version id active for this build (traceability). */
  promptVersion?: string;
  /**
   * PR4 cost-down tripwire — the provider that actually DROVE most of this build's tool-loop
   * turns (e.g. 'GLM' | 'KIMI' | 'CLAUDE' | 'CLAUDE_HAIKU'). Lets an admin measure the
   * cheap-floor-vs-Claude delivery split: if cheap-floor delivery falls / Claude fallback
   * spikes after enabling AGENTV3_CHEAP_FLOOR, roll the floor back (flag off). Absent on lanes
   * that don't drive the agentic loop (SimpleBuild/OneShot) → folded under 'unknown'.
   */
  deliveredVia?: string;
  /**
   * T1-escalation-on — the canary cohort this build belonged to: 'off' (flag off), 'in' (inside the
   * AGENTV3_ESCALATION_PCT rollout — the ladder applies), or 'out' (flag on but outside the partial
   * rollout — the control group). Comparing 'in' vs 'out' success/cost on the same days is the
   * measurement that justifies (or vetoes) raising the rollout percentage.
   */
  escalationCohort?: 'in' | 'out' | 'off';
  /** How many tier escalations this build actually performed (0 = the first tier delivered). */
  escalations?: number;
  /**
   * How deep down its tier's LADDER this build went: 1 = the lead rung delivered the whole thing,
   * 2 = it fell one rung, and so on (see ladderDepth.ts). Absent when no delivered slice could be
   * attributed to a rung — never guessed.
   *
   * ⚠️ NOT the same measurement as `escalations` or `deliveredVia`, and that is the whole point.
   * `escalations` counts TIER escalations (a re-run on a higher tier), which is 0 for every ordinary
   * fall inside one tier; `deliveredVia` names the VENDOR, and on Weak/Normal the vendor GLM holds
   * rung 1 AND rung 3, so it cannot tell the two apart.
   */
  ladderDepth?: number;
  /**
   * Billing Phase 3 — per-provider TOKEN attribution for this build (reconciled to the billed total,
   * so the aux-call remainder is under 'other'). Powers the admin usage-report's per-provider tokens,
   * real-cost baseline, and achieved-margin columns. Absent on lanes that don't attribute.
   */
  providerUsage?: Record<string, { inputTokens: number; outputTokens: number }>;
  /**
   * Billing Phase 3 — a LOSS: real tokens were spent but the build was zeroed (empty / unrendered
   * preview / free onboarding), so NavBharatAI ate the provider cost. `lossRealCostUsd` is the
   * Sonnet-equivalent baseline of that eaten cost. Only set when billedUsd === 0 AND tokens were spent.
   */
  wasLoss?: boolean;
  lossRealCostUsd?: number;
  /**
   * 🔴 WHAT THIS BUILD REALLY COST US — the per-model rate card over the provider ledger, priced by
   * `decideBuildBilling` itself (the SAME code that priced the bill), plus the VM beside it.
   *
   * WHY IT IS HERE AT ALL, recorded so nobody re-derives it: every cost figure in the admin usage
   * report was, until 2026-09-23, `sonnetEquivalentUsd` — a Sonnet-equivalent BASELINE. That is an
   * honest upper bound and the module said so in words, but the report's own field was called
   * `marginUsd` and the card painted it RED, so a 30-day window read as a $1,257 LOSS when it was
   * really "we charged 18% of what Sonnet would have cost". The admin sent that report to ask about
   * the loss. **The real number already existed one variable away and was thrown on the floor.**
   *
   * ⚠️ OPTIONAL, AND AN ABSENT VALUE IS NEVER A ZERO. A lane that does not report it is counted OUT
   * of `realCostBuilds`, so a partial sum can never be displayed as a total — the coverage count is
   * what lets the card say "measured on N of M builds" instead of quietly under-stating our spend.
   */
  realCostUsd?: number;
  /** The E2B VM cost of this build (USD), beside the tokens. Same optionality rule as above. */
  sandboxUsd?: number;
  /**
   * Per-(provider, MODEL) token attribution, keyed `PROVIDER|model`. The provider map above cannot
   * answer what a build cost, because one vendor holds several rungs at very different prices —
   * `glm-4.7-flashx` is $0.07/MTok and `glm-5.3` is $1.40, a 20x spread under the single key 'GLM';
   * `kimi-k2.7-code` $0.95 against `kimi-k3` $3.00 under 'KIMI'. Absent on lanes that do not attribute.
   */
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number }>;
}

/** Rolled-up counters for one slice (a task type or a start tier). */
export interface TelemetryBreakdown {
  builds: number;
  okBuilds: number;
  billedUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/** Billing Phase 3 — rolled-up per-provider usage for the admin usage-report. */
export interface ProviderUsageBreakdown {
  /** How many builds this provider contributed tokens to. */
  builds: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DailyCostTelemetryDoc {
  date: string; // YYYY-MM-DD
  totalBuilds: number;
  okBuilds: number;
  powerBuilds: number;
  totalBilledUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  byTaskType: Record<string, TelemetryBreakdown>;
  byStartTier: Record<string, TelemetryBreakdown>;
  /** PR4 — per delivering provider (GLM/KIMI/CLAUDE/…): the cheap-floor-vs-Claude split. */
  byDeliveredVia: Record<string, TelemetryBreakdown>;
  /** T1-escalation-on — per canary cohort ('in'/'out'/'off'): the A/B split for the rollout decision. */
  byEscalationCohort?: Record<string, TelemetryBreakdown>;
  /** T1-escalation-on — builds where the ladder actually climbed at least one tier. */
  escalatedBuilds?: number;
  /**
   * How many of today's builds finished on rung 1, rung 2, … of their tier's ladder, keyed by the
   * depth as a string ('1', '2', …) plus 'unknown'. The one number that says how often a build
   * leaves the lead rung — and therefore how much of the engine's cost and of the model reasoning
   * the user sees comes from the rungs below it.
   */
  byLadderDepth?: Record<string, TelemetryBreakdown>;
  /** Billing Phase 3 — per-provider token totals across the day (admin usage-report source). */
  byProviderUsage?: Record<string, ProviderUsageBreakdown>;
  /** Billing Phase 3 — builds zeroed after spending real tokens (a loss NavBharatAI absorbed). */
  lossBuilds?: number;
  /**
   * Billing Phase 3 — Sonnet-equivalent baseline cost (USD) of all today's loss builds.
   * ⚠️ BASELINE, NOT SPEND — see `lossSpendUsd` below for what those builds really cost. The field
   * keeps its name and its meaning because documents written before 2026-09-23 hold that meaning,
   * and re-pointing a field at a different number would mix two meanings inside one 30-day window
   * with nothing on any screen saying so.
   */
  lossRealCostUsd?: number;
  /** Per-(provider, model) token totals across the day — the source of the report's per-model rows. */
  byModelUsage?: Record<string, ProviderUsageBreakdown & { cacheReadInputTokens?: number }>;
  /** What today's builds REALLY cost in provider tokens (USD), summed over builds that reported it. */
  totalRealCostUsd?: number;
  /** What today's builds really cost in E2B VM time (USD), over the same builds. */
  totalSandboxUsd?: number;
  /**
   * How many of today's builds actually reported a real cost. **The two sums above are meaningless
   * without it**: a day mixing builds that report and builds that do not would otherwise present a
   * partial sum as the whole day's spend — under-stating our own cost on the exact panel used to
   * judge it, which is the `E2B_USD_PER_HOUR` drift in a new place.
   */
  realCostBuilds?: number;
  /** What the ZEROED builds really cost (USD, tokens + VM) — the measured twin of lossRealCostUsd. */
  lossSpendUsd?: number;
  /** P-PE.2 — the most recent architect prompt version id recorded today (traceability). */
  lastPromptVersion?: string;
  updatedAt: number;
}

function emptyBreakdown(): TelemetryBreakdown {
  return { builds: 0, okBuilds: 0, billedUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
}

function emptyDoc(date: string): DailyCostTelemetryDoc {
  return {
    date,
    totalBuilds: 0,
    okBuilds: 0,
    powerBuilds: 0,
    totalBilledUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    byTaskType: {},
    byStartTier: {},
    byDeliveredVia: {},
    byEscalationCohort: {},
    escalatedBuilds: 0,
    byProviderUsage: {},
    lossBuilds: 0,
    lossRealCostUsd: 0,
    updatedAt: 0,
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function addToBreakdown(slot: TelemetryBreakdown, entry: CostTelemetryEntry): TelemetryBreakdown {
  return {
    builds: slot.builds + 1,
    okBuilds: slot.okBuilds + (entry.ok ? 1 : 0),
    billedUsd: round6(slot.billedUsd + entry.billedUsd),
    inputTokens: slot.inputTokens + entry.inputTokens,
    outputTokens: slot.outputTokens + entry.outputTokens,
    durationMs: slot.durationMs + entry.durationMs,
  };
}

/**
 * PURE — fold one build's telemetry into a day's aggregate. No I/O. The store calls
 * this inside a Firestore transaction; tests exercise it directly. A null `existing`
 * (first build of the day) starts a fresh doc. Unknown task types / tiers create
 * their own slice on first sight, so the breakdown is self-extending.
 */
export function foldCostTelemetry(
  existing: DailyCostTelemetryDoc | null,
  date: string,
  entry: CostTelemetryEntry,
  now: number,
): DailyCostTelemetryDoc {
  const doc = existing ? { ...existing } : emptyDoc(date);
  const taskKey = entry.taskType || 'unknown';
  const tierKey = entry.startTier || 'unknown';

  const byTaskType = { ...doc.byTaskType };
  byTaskType[taskKey] = addToBreakdown(byTaskType[taskKey] ?? emptyBreakdown(), entry);

  const byStartTier = { ...doc.byStartTier };
  byStartTier[tierKey] = addToBreakdown(byStartTier[tierKey] ?? emptyBreakdown(), entry);

  // PR4 — fold the delivering provider. `?? {}` tolerates docs written before this field existed.
  const viaKey = entry.deliveredVia || 'unknown';
  const byDeliveredVia = { ...(doc.byDeliveredVia ?? {}) };
  byDeliveredVia[viaKey] = addToBreakdown(byDeliveredVia[viaKey] ?? emptyBreakdown(), entry);

  // T1-escalation-on — fold the canary cohort ('in'/'out'/'off'; 'unknown' for lanes that don't label).
  const cohortKey = entry.escalationCohort || 'unknown';
  const byEscalationCohort = { ...(doc.byEscalationCohort ?? {}) };
  byEscalationCohort[cohortKey] = addToBreakdown(byEscalationCohort[cohortKey] ?? emptyBreakdown(), entry);

  // How deep this build went down its ladder. `?? {}` tolerates day docs written before this field
  // existed (same migration pattern as the two folds above), and a build whose depth could not be
  // attributed lands under 'unknown' rather than being dropped — a silently missing build would make
  // the rung-1 share look better than it is, which is the one direction this number must not lie in.
  const depthKey = Number.isFinite(entry.ladderDepth) && (entry.ladderDepth as number) > 0
    ? String(entry.ladderDepth)
    : 'unknown';
  const byLadderDepth = { ...(doc.byLadderDepth ?? {}) };
  byLadderDepth[depthKey] = addToBreakdown(byLadderDepth[depthKey] ?? emptyBreakdown(), entry);

  // Billing Phase 3 — fold this build's per-provider token attribution into the day's totals.
  // `?? {}` tolerates day docs written before this field existed (same migration pattern as above).
  const byProviderUsage = { ...(doc.byProviderUsage ?? {}) };
  for (const [provider, u] of Object.entries(entry.providerUsage ?? {})) {
    const slot = byProviderUsage[provider] ?? { builds: 0, inputTokens: 0, outputTokens: 0 };
    byProviderUsage[provider] = {
      builds: slot.builds + 1,
      inputTokens: slot.inputTokens + (Number.isFinite(u.inputTokens) ? u.inputTokens : 0),
      outputTokens: slot.outputTokens + (Number.isFinite(u.outputTokens) ? u.outputTokens : 0),
    };
  }

  // Per-(provider, model) tokens. Same `?? {}` migration pattern as every fold above.
  const byModelUsage = { ...(doc.byModelUsage ?? {}) };
  for (const [key, u] of Object.entries(entry.modelUsage ?? {})) {
    const slot = byModelUsage[key] ?? { builds: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
    byModelUsage[key] = {
      builds: slot.builds + 1,
      inputTokens: slot.inputTokens + (Number.isFinite(u.inputTokens) ? u.inputTokens : 0),
      outputTokens: slot.outputTokens + (Number.isFinite(u.outputTokens) ? u.outputTokens : 0),
      cacheReadInputTokens: (slot.cacheReadInputTokens ?? 0)
        + (Number.isFinite(u.cacheReadInputTokens) ? (u.cacheReadInputTokens as number) : 0),
    };
  }

  // 🔒 A BUILD THAT DID NOT REPORT A REAL COST ADDS NOTHING AND IS NOT COUNTED. `measuredReal` is
  // deliberately a check on the NUMBER, not on truthiness: a genuinely free build costs $0.00 and
  // must still count toward coverage, while an absent value must not read as a zero-cost build.
  const measuredReal = Number.isFinite(entry.realCostUsd);
  const buildRealUsd = measuredReal
    ? Math.max(0, entry.realCostUsd as number) + Math.max(0, Number.isFinite(entry.sandboxUsd) ? (entry.sandboxUsd as number) : 0)
    : 0;

  return {
    date,
    totalBuilds: doc.totalBuilds + 1,
    okBuilds: doc.okBuilds + (entry.ok ? 1 : 0),
    powerBuilds: doc.powerBuilds + (entry.powerMode ? 1 : 0),
    totalBilledUsd: round6(doc.totalBilledUsd + entry.billedUsd),
    totalInputTokens: doc.totalInputTokens + entry.inputTokens,
    totalOutputTokens: doc.totalOutputTokens + entry.outputTokens,
    totalDurationMs: doc.totalDurationMs + entry.durationMs,
    byTaskType,
    byStartTier,
    byDeliveredVia,
    byEscalationCohort,
    escalatedBuilds: (doc.escalatedBuilds ?? 0) + ((entry.escalations ?? 0) > 0 ? 1 : 0),
    byLadderDepth,
    byProviderUsage,
    byModelUsage,
    totalRealCostUsd: round6((doc.totalRealCostUsd ?? 0) + (measuredReal ? Math.max(0, entry.realCostUsd as number) : 0)),
    totalSandboxUsd: round6((doc.totalSandboxUsd ?? 0)
      + (measuredReal && Number.isFinite(entry.sandboxUsd) ? Math.max(0, entry.sandboxUsd as number) : 0)),
    realCostBuilds: (doc.realCostBuilds ?? 0) + (measuredReal ? 1 : 0),
    lossBuilds: (doc.lossBuilds ?? 0) + (entry.wasLoss ? 1 : 0),
    lossRealCostUsd: round6((doc.lossRealCostUsd ?? 0) + (entry.wasLoss ? (entry.lossRealCostUsd ?? 0) : 0)),
    lossSpendUsd: round6((doc.lossSpendUsd ?? 0) + (entry.wasLoss ? buildRealUsd : 0)),
    // Carry the latest prompt version when present; otherwise keep the prior value.
    lastPromptVersion: entry.promptVersion ?? doc.lastPromptVersion,
    updatedAt: now,
  };
}

/** One provider's line in the admin usage-report: tokens, real-cost baseline, and revenue share. */
export interface UsageReportRow {
  provider: string;
  builds: number;
  inputTokens: number;
  outputTokens: number;
  /** Sonnet-equivalent baseline cost (USD) — an HONEST UPPER BOUND (cheap providers cost less). */
  baselineCostUsd: number;
}

export interface UsageReport {
  fromDate: string;
  toDate: string;
  totalBuilds: number;
  /** Total marked-up amount billed to users (USD) across the window. */
  totalBilledUsd: number;
  /** Sum of every provider's Sonnet-equivalent baseline cost (USD). */
  totalBaselineCostUsd: number;
  /**
   * Achieved margin against the baseline = billed − baselineCost. Because the baseline OVER-states the
   * true cost of cheap providers, REAL margin is at least this. Ratio is billed / baselineCost.
   */
  marginUsd: number;
  marginRatio: number;
  /** Builds zeroed after spending real tokens, and the baseline cost NavBharatAI absorbed. */
  lossBuilds: number;
  lossRealCostUsd: number;
  perProvider: UsageReportRow[];

  // ── THE MEASURED SIDE (2026-09-23). Everything above prices every engine at Sonnet's rate. ──
  /**
   * What the providers REALLY cost, summed from each build's own rate-card figure. `null` when not
   * one build in the window reported it — never 0, because "we did not measure it" and "it was free"
   * are different facts and only one of them may be shown as a number.
   */
  totalRealCostUsd: number | null;
  /** The E2B VM cost over the same builds, same null rule. */
  totalSandboxUsd: number | null;
  /** Tokens + VM. The one figure to compare against `totalBilledUsd`. */
  totalRealSpendUsd: number | null;
  /** billed − real spend. The ACTUAL margin, and `null` while nothing is measured. */
  realMarginUsd: number | null;
  /** How many builds in the window reported a real cost, out of `totalBuilds`. */
  realCostBuilds: number;
  /**
   * 🔒 `realCostBuilds / totalBuilds`. A caller MUST show this beside the money: while the window
   * still holds days written before the real cost was recorded, the sums above cover only part of
   * it, and a partial sum presented as a total under-states our own spend.
   */
  realCostCoverage: number;
  /** What the zeroed builds really cost us (tokens + VM), same null rule. */
  lossSpendUsd: number | null;
  /** Per-(provider, model) rows — the only view that can tell a $0.07 rung from a $1.40 one. */
  perModel: UsageReportModelRow[];
  /** Builds by how deep down their tier's ladder they finished ('1', '2', …, 'unknown'). */
  byLadderDepth: Record<string, number>;
}

/** One (provider, model) line — tokens at the rung level, which is where price actually varies. */
export interface UsageReportModelRow {
  provider: string;
  /** The model id, or 'unknown' for a slice whose runner never reported one. */
  model: string;
  builds: number;
  inputTokens: number;
  outputTokens: number;
  /** The share of inputTokens the provider served from its prefix cache (already inside inputTokens). */
  cacheReadInputTokens: number;
}

/**
 * PURE — fold a window of daily telemetry docs into the admin usage-report. Given the day docs and a
 * cost-baseline function (injected so the module stays decoupled from pricing), sum per-provider
 * tokens, price each provider's tokens at the baseline, and compute the achieved margin vs the total
 * billed. No I/O; the route reads the docs, this shapes them; tests exercise it directly.
 */
export function buildUsageReport(
  docs: DailyCostTelemetryDoc[],
  baselineCostUsd: (u: { inputTokens: number; outputTokens: number }) => number,
): UsageReport {
  const perProviderTokens = new Map<string, { builds: number; inputTokens: number; outputTokens: number }>();
  let totalBuilds = 0;
  let totalBilledUsd = 0;
  let lossBuilds = 0;
  let lossRealCostUsd = 0;
  let realCostUsd = 0;
  let sandboxUsd = 0;
  let realCostBuilds = 0;
  let lossSpendUsd = 0;
  let anyRealCost = false;
  const perModelTokens = new Map<string, { builds: number; inputTokens: number; outputTokens: number; cacheReadInputTokens: number }>();
  const byLadderDepth: Record<string, number> = {};
  const dates = docs.map(d => d.date).filter(Boolean).sort();
  for (const doc of docs) {
    totalBuilds += doc.totalBuilds || 0;
    totalBilledUsd += doc.totalBilledUsd || 0;
    lossBuilds += doc.lossBuilds ?? 0;
    lossRealCostUsd += doc.lossRealCostUsd ?? 0;
    // A day written before the real cost was recorded carries no `realCostBuilds`, so it adds nothing
    // and raises no flag — which is exactly how a mixed window stays honest instead of averaging a
    // measured day with an unmeasured one and calling the result the month's spend.
    if ((doc.realCostBuilds ?? 0) > 0) anyRealCost = true;
    realCostUsd += doc.totalRealCostUsd ?? 0;
    sandboxUsd += doc.totalSandboxUsd ?? 0;
    realCostBuilds += doc.realCostBuilds ?? 0;
    lossSpendUsd += doc.lossSpendUsd ?? 0;
    for (const [key, u] of Object.entries(doc.byModelUsage ?? {})) {
      const slot = perModelTokens.get(key) ?? { builds: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
      slot.builds += u.builds || 0;
      slot.inputTokens += u.inputTokens || 0;
      slot.outputTokens += u.outputTokens || 0;
      slot.cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
      perModelTokens.set(key, slot);
    }
    for (const [depth, b] of Object.entries(doc.byLadderDepth ?? {})) {
      byLadderDepth[depth] = (byLadderDepth[depth] ?? 0) + (b?.builds || 0);
    }
    for (const [provider, u] of Object.entries(doc.byProviderUsage ?? {})) {
      const slot = perProviderTokens.get(provider) ?? { builds: 0, inputTokens: 0, outputTokens: 0 };
      slot.builds += u.builds || 0;
      slot.inputTokens += u.inputTokens || 0;
      slot.outputTokens += u.outputTokens || 0;
      perProviderTokens.set(provider, slot);
    }
  }
  const perProvider: UsageReportRow[] = [...perProviderTokens.entries()]
    .map(([provider, u]) => ({
      provider,
      builds: u.builds,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      baselineCostUsd: round6(baselineCostUsd({ inputTokens: u.inputTokens, outputTokens: u.outputTokens })),
    }))
    .sort((a, b) => b.baselineCostUsd - a.baselineCostUsd);
  const totalBaselineCostUsd = round6(perProvider.reduce((s, r) => s + r.baselineCostUsd, 0));
  return {
    fromDate: dates[0] ?? '',
    toDate: dates[dates.length - 1] ?? '',
    totalBuilds,
    totalBilledUsd: round6(totalBilledUsd),
    totalBaselineCostUsd,
    marginUsd: round6(totalBilledUsd - totalBaselineCostUsd),
    marginRatio: totalBaselineCostUsd > 0 ? round6(totalBilledUsd / totalBaselineCostUsd) : 0,
    lossBuilds,
    lossRealCostUsd: round6(lossRealCostUsd),
    perProvider,
    // `null` rather than 0 wherever nothing was measured — see the field docs. The distinction is the
    // whole point of this half of the report: a zero is a claim about our spend, and an unmeasured
    // window has no claim to make.
    totalRealCostUsd: anyRealCost ? round6(realCostUsd) : null,
    totalSandboxUsd: anyRealCost ? round6(sandboxUsd) : null,
    totalRealSpendUsd: anyRealCost ? round6(realCostUsd + sandboxUsd) : null,
    realMarginUsd: anyRealCost ? round6(totalBilledUsd - (realCostUsd + sandboxUsd)) : null,
    realCostBuilds,
    realCostCoverage: totalBuilds > 0 ? round6(realCostBuilds / totalBuilds) : 0,
    lossSpendUsd: anyRealCost ? round6(lossSpendUsd) : null,
    perModel: [...perModelTokens.entries()]
      .map(([key, u]) => {
        // The key is `PROVIDER|model`; a slice whose runner never named a model is stored with an
        // empty model half and is shown as 'unknown' rather than folded into a real rung's row.
        const bar = key.indexOf('|');
        const provider = bar >= 0 ? key.slice(0, bar) : key;
        const model = bar >= 0 ? key.slice(bar + 1) : '';
        return { provider, model: model || 'unknown', ...u };
      })
      .sort((a, b) => b.inputTokens - a.inputTokens),
    byLadderDepth,
  };
}

class AgentV3CostTelemetryStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private dayKey(): string {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  }

  /** Record one build's cost/quality telemetry into today's aggregate. Best-effort. */
  async record(entry: CostTelemetryEntry): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    const date = this.dayKey();
    try {
      const ref = db.collection('agentv3_cost_telemetry').doc(date);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as DailyCostTelemetryDoc) : null;
        tx.set(ref, foldCostTelemetry(existing, date, entry, Date.now()), { merge: false });
      });
    } catch { /* best-effort — never block a build */ }
  }

  /** Last N days of telemetry docs, newest first. Defaults to 30. */
  async list(days = 30): Promise<DailyCostTelemetryDoc[]> {
    const db = this.getDb();
    if (!db) return [];
    const n = Math.max(1, Math.min(365, Math.floor(days)));
    try {
      const snap = await db
        .collection('agentv3_cost_telemetry')
        .orderBy('date', 'desc')
        .limit(n)
        .get();
      return snap.docs.map(d => d.data() as DailyCostTelemetryDoc);
    } catch {
      return [];
    }
  }
}

export const agentV3CostTelemetry = new AgentV3CostTelemetryStore();
