/**
 * AgentV3 — cost & quality telemetry (cost-ladder measurement layer).
 *
 * The cost-ladder (P2) routes simple apps to cheaper models. To PROVE that saves
 * money without hurting quality — and to satisfy the design doc's P8 gate
 * ("measure cheap-tier quality + fallback rate per task-type before cutover") —
 * every v3.0 build records a dimensioned telemetry row here: its task type, start
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
  /** Billing Phase 3 — per-provider token totals across the day (admin usage-report source). */
  byProviderUsage?: Record<string, ProviderUsageBreakdown>;
  /** Billing Phase 3 — builds zeroed after spending real tokens (a loss NavBharatAI absorbed). */
  lossBuilds?: number;
  /** Billing Phase 3 — Sonnet-equivalent baseline cost (USD) of all today's loss builds. */
  lossRealCostUsd?: number;
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
    byProviderUsage,
    lossBuilds: (doc.lossBuilds ?? 0) + (entry.wasLoss ? 1 : 0),
    lossRealCostUsd: round6((doc.lossRealCostUsd ?? 0) + (entry.wasLoss ? (entry.lossRealCostUsd ?? 0) : 0)),
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
  const dates = docs.map(d => d.date).filter(Boolean).sort();
  for (const doc of docs) {
    totalBuilds += doc.totalBuilds || 0;
    totalBilledUsd += doc.totalBilledUsd || 0;
    lossBuilds += doc.lossBuilds ?? 0;
    lossRealCostUsd += doc.lossRealCostUsd ?? 0;
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
