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
    updatedAt: now,
  };
}

class AgentV3CostTelemetryStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = admin.firestore();
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
