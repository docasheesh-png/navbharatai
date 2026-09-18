// Admin — WHAT A BUILD REALLY COST vs WHAT IT BILLED, per tier and per app size. MEASURED, not estimated.
//
// WHY THIS EXISTS (admin 2026-09-14): asked what a simple / mid / full-stack app costs the user vs the
// platform on each of the three tiers, the honest answer was an ESTIMATE from assumed token counts —
// and the admin said "han banao": turn the estimate into a measurement. Every fact this card needs is
// already persisted in each build's diagnostics report; nothing here calls a provider or reads a wallet.
//
// WHERE EACH NUMBER COMES FROM, so nobody re-derives it:
//   • REAL COST  — `billing.realCostUsd`, the figure the settle priced with the SAME call that priced the
//     bill (persisted since 2026-09-14; `source: 'settled'`). For a report written BEFORE that, the cost
//     is recomputed from the stored `llmCalls` through the same rate card (`realRateFor` + `usageCostUsd`)
//     — and storage keeps only the newest `STORED_LLM_CALLS_MAX` calls, so a log that has hit that cap
//     is a LOWER BOUND (`source: 'call-log-capped'`, `measured: false`), never presented as the cost.
//     ⚠️ A call with no token counts cannot be priced. It is COUNTED as unmeasured and the row is marked
//     `measured: false` — never priced at zero, never estimated. Sandbox minutes are a separate figure
//     (`sandboxCostUsd`, 0 unless sandbox billing is configured) and are NOT folded into the token cost.
//   • BILL       — `billing.billedInr`, exactly what the user was charged (null when never settled, which
//     is a different fact from ₹0 — `zeroBillReason` says which).
//   • TIER       — `billing.powerLevel` through `toPowerLevel`, so a retired 'medium'/'max' reads as Strong.
//   • SIZE       — from the paths the build actually wrote (the manifest's file list, which carries EVERY
//     file; `generatedFiles` is capped at 20 and is only the fallback): full-stack when any path is a
//     backend/data-layer marker; otherwise by file count. Deterministic, and stated on the card.
//   • HEALS      — `counts.autoResolved`, the 50/50 law's red flag, carried so cost can be read beside it.
//
// PURE — no clock, no I/O, no env. The USD→INR rate is passed in.

import type { BuildDiagnosticsReport, LlmCallRecord } from '../AgentV3/BuildDiagnostics';
import { realRateFor, usageCostUsd } from '../AgentV3/providerRates';
import { toPowerLevel, type PowerLevel } from '../AgentV3/powerLevel';
import { tierDisplayName } from '../AgentV3/tierLadder';
import { STORED_LLM_CALLS_MAX } from '../AgentV3/DiagnosticsStore';

export type AppSize = 'simple' | 'mid' | 'full-stack' | 'unknown';

/** File-count boundaries for a FRONTEND-ONLY app. Stated on the card, so the reader can disagree. */
export const SIMPLE_MAX_FILES = 8;
export const MID_MAX_FILES = 20;

/**
 * A path that only a backend or data layer would have. Any one of these makes the app full-stack
 * whatever its file count — a 6-file Express + Prisma app is not "simple".
 */
const BACKEND_PATH = /(^|\/)(server|backend|api|prisma|supabase|functions|migrations|db|database)\/|(^|\/)(server|app|index)\.(js|ts|py|go)$|(^|\/)(Dockerfile|schema\.prisma|drizzle\.config\.[jt]s)$/i;
/** Frontend build tooling that lives at the root of every app — never a backend signal. */
const NOT_BACKEND = /(^|\/)(vite\.config|vitest\.config|tailwind\.config|postcss\.config|tsconfig|package)\.[a-z.]+$|(^|\/)src\/(main|index|app)\.(tsx?|jsx?)$/i;

export function classifyBuildSize(paths: readonly string[]): AppSize {
  const files = [...new Set(paths.map((p) => String(p || '').trim()).filter(Boolean))];
  if (files.length === 0) return 'unknown';
  if (files.some((p) => BACKEND_PATH.test(p) && !NOT_BACKEND.test(p))) return 'full-stack';
  if (files.length <= SIMPLE_MAX_FILES) return 'simple';
  if (files.length <= MID_MAX_FILES) return 'mid';
  return 'full-stack';
}

/**
 * Where a row's real cost came from — shown on the card, because the three are not equally trustworthy:
 *   settled          — the figure the settle itself priced and persisted. Exact.
 *   call-log         — recomputed from a complete stored call log (older report). Exact for the calls seen.
 *   call-log-capped  — the stored log hit its cap, so calls are MISSING: the number is a lower bound.
 *   none             — nothing to price from.
 */
export type RealCostSource = 'settled' | 'call-log' | 'call-log-capped' | 'none';

export interface RealCost {
  /** USD across every call that carried token counts. */
  usd: number;
  measuredCalls: number;
  /** Calls with no usable token counts — they cost something we cannot see. */
  unmeasuredCalls: number;
  /** True only when at least one call was priced, none was skipped, and the log was not capped. */
  measured: boolean;
  /** True when the stored log is at the storage cap — older calls may have been dropped. */
  capped: boolean;
}

const tokens = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Recompute a build's real provider cost from its persisted per-call records. Pure. */
export function realCostFromCalls(calls: readonly LlmCallRecord[] | undefined): RealCost {
  let usd = 0; let measuredCalls = 0; let unmeasuredCalls = 0;
  for (const c of calls ?? []) {
    const inp = tokens(c?.inputTokens); const out = tokens(c?.outputTokens);
    if (inp === null && out === null) { unmeasuredCalls += 1; continue; }
    const rate = realRateFor(String(c.provider ?? 'other'), c.model);
    usd += usageCostUsd({ inputTokens: inp ?? 0, outputTokens: out ?? 0 }, rate);
    measuredCalls += 1;
  }
  const capped = (calls?.length ?? 0) >= STORED_LLM_CALLS_MAX;
  return { usd, measuredCalls, unmeasuredCalls, capped, measured: measuredCalls > 0 && unmeasuredCalls === 0 && !capped };
}

export interface BuildCostRow {
  workspaceId: string;
  startedAt: number;
  tier: PowerLevel;
  tierName: 'Weak' | 'Normal' | 'Strong';
  size: AppSize;
  files: number;
  ok: boolean | null;
  minutes: number | null;
  heals: number;
  /** ₹ the user was charged; null = never settled / not recorded (NOT zero). */
  billedInr: number | null;
  zeroBillReason: string | null;
  /** ₹ the providers really cost; null when nothing could be priced. A lower bound when `source` is capped. */
  realInr: number | null;
  realUsd: number | null;
  /** The sandbox VM's cost in ₹ (0 unless sandbox billing is configured); null on a pre-2026-09-14 report. */
  sandboxInr: number | null;
  measured: boolean;
  source: RealCostSource;
  unmeasuredCalls: number;
  /** billed − real, only when BOTH are known. */
  marginInr: number | null;
}

export interface StoredReport {
  workspaceId: string;
  savedAt?: number;
  report: BuildDiagnosticsReport | null | undefined;
}

const money = (v: number): number => Math.round(v * 100) / 100;

/** Every path the build wrote: the manifest's file list (complete) before `generatedFiles` (capped at 20). */
export function reportPaths(r: BuildDiagnosticsReport): string[] {
  const hashes = (r.manifest as { fileHashes?: Record<string, string> } | undefined)?.fileHashes;
  const fromManifest = hashes && typeof hashes === 'object' ? Object.keys(hashes) : [];
  if (fromManifest.length > 0) return fromManifest;
  return (r.generatedFiles ?? []).map((f) => f?.path).filter((p): p is string => typeof p === 'string');
}

export function buildCostRow(entry: StoredReport, usdInr: number): BuildCostRow | null {
  const r = entry?.report;
  if (!r || typeof r !== 'object') return null;
  const billing = (r as { billing?: { billedInr?: unknown; zeroBillReason?: unknown; powerLevel?: unknown; realCostUsd?: unknown; sandboxCostUsd?: unknown } }).billing;
  const tier = toPowerLevel(typeof billing?.powerLevel === 'string' ? billing.powerLevel : undefined);
  const paths = reportPaths(r);
  const rate = Number.isFinite(usdInr) && usdInr > 0 ? usdInr : 0;
  const billedInr = tokens(billing?.billedInr);
  // Settled figure first — it is what the bill was priced from. The call-log path exists only for
  // reports written before the settle recorded it.
  const settled = tokens(billing?.realCostUsd);
  const fromLog = settled === null ? realCostFromCalls(r.llmCalls) : null;
  const realUsd = settled !== null ? settled : fromLog && fromLog.measuredCalls > 0 ? fromLog.usd : null;
  const realKnown = realUsd !== null && rate > 0;
  const source: RealCostSource = settled !== null ? 'settled'
    : fromLog && fromLog.measuredCalls > 0 ? (fromLog.capped ? 'call-log-capped' : 'call-log') : 'none';
  const measured = settled !== null ? true : Boolean(fromLog?.measured);
  const sandboxUsd = tokens(billing?.sandboxCostUsd);
  const realInr = realKnown ? money((realUsd as number) * rate) : null;
  const started = Number(r.startedAt) || Number(entry.savedAt) || 0;
  const ended = Number(r.endedAt) || 0;
  return {
    workspaceId: String(entry.workspaceId ?? ''),
    startedAt: started,
    tier,
    tierName: tierDisplayName(tier),
    size: classifyBuildSize(paths),
    files: new Set(paths).size,
    ok: typeof r.ok === 'boolean' ? r.ok : null,
    minutes: started > 0 && ended > started ? Math.round(((ended - started) / 60_000) * 10) / 10 : null,
    heals: Math.max(0, Number(r.counts?.autoResolved) || 0),
    billedInr: billedInr === null ? null : money(billedInr),
    zeroBillReason: typeof billing?.zeroBillReason === 'string' && billing.zeroBillReason.trim() ? billing.zeroBillReason.trim() : null,
    realInr,
    realUsd: realKnown ? money(realUsd as number) : null,
    sandboxInr: sandboxUsd !== null && rate > 0 ? money(sandboxUsd * rate) : null,
    measured,
    source,
    unmeasuredCalls: fromLog?.unmeasuredCalls ?? 0,
    // A margin is only a fact when both sides are measured — a lower-bound cost would overstate it.
    marginInr: billedInr !== null && realInr !== null && measured ? money(billedInr - realInr) : null,
  };
}

export interface CostSummaryCell {
  tier: PowerLevel;
  tierName: 'Weak' | 'Normal' | 'Strong';
  size: AppSize;
  /** Builds in this cell. */
  n: number;
  /** Builds whose real cost could be priced end to end — the denominator of avgRealInr. */
  nMeasured: number;
  /** Builds with a recorded bill — the denominator of avgBilledInr. */
  nBilled: number;
  failed: number;
  avgRealInr: number | null;
  avgBilledInr: number | null;
  /** Mean of per-build margins, over builds where both sides are known. */
  avgMarginInr: number | null;
  nMargin: number;
  avgHeals: number | null;
  avgMinutes: number | null;
}

const avg = (xs: number[]): number | null => (xs.length ? money(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Group rows by tier × size. Every average names its own sample size, and an empty sample is null, never 0. */
export function summarizeCosts(rows: readonly BuildCostRow[]): CostSummaryCell[] {
  const cells = new Map<string, BuildCostRow[]>();
  for (const r of rows) {
    const key = `${r.tier}|${r.size}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(r);
  }
  const order: Record<PowerLevel, number> = { weak: 0, off: 1, mini: 2 };
  const sizeOrder: Record<AppSize, number> = { simple: 0, mid: 1, 'full-stack': 2, unknown: 3 };
  return [...cells.values()].map((group) => {
    const first = group[0];
    const measured = group.filter((g) => g.measured && g.realInr !== null);
    const billed = group.filter((g) => g.billedInr !== null);
    const margin = group.filter((g) => g.marginInr !== null);
    const timed = group.filter((g) => g.minutes !== null);
    return {
      tier: first.tier, tierName: first.tierName, size: first.size,
      n: group.length,
      nMeasured: measured.length,
      nBilled: billed.length,
      failed: group.filter((g) => g.ok === false).length,
      avgRealInr: avg(measured.map((g) => g.realInr as number)),
      avgBilledInr: avg(billed.map((g) => g.billedInr as number)),
      avgMarginInr: avg(margin.map((g) => g.marginInr as number)),
      nMargin: margin.length,
      avgHeals: avg(group.map((g) => g.heals)),
      avgMinutes: avg(timed.map((g) => g.minutes as number)),
    };
  }).sort((a, b) => (order[a.tier] - order[b.tier]) || (sizeOrder[a.size] - sizeOrder[b.size]));
}

/**
 * 📉 ARE WE ACTUALLY GETTING BETTER? (admin 2026-09-18, verbatim: *"hame pata hi nahi lag raha ki ham
 * progress kar rahe ya nahi!!"*)
 *
 * The tier × size table answers "what does a build cost" and cannot answer "is it costing less than it
 * used to" — every cell is one average over the whole window, so a run of cheaper builds and a run of
 * dearer ones produce the same number. This splits the window in half by time and compares.
 *
 * 🔒 EVERY METRIC CARRIES ITS OWN DENOMINATOR, and a half without a real sample yields `null` rather
 * than a delta: with two builds on one side, "cost halved" is noise wearing a decimal point. Same rule
 * as `avgWithSample` on the card — this file never reports an average without the sample behind it.
 *
 * ⚠️ `successRate` is the ONE metric where higher is better; every other delta is an improvement when
 * it is NEGATIVE. The reader (`trendHeadline`) must not treat them alike.
 */
export const MIN_TREND_SAMPLE = 3;

export interface TrendMetric {
  recent: number | null;
  older: number | null;
  /** recent − older, only when BOTH halves cleared MIN_TREND_SAMPLE. */
  delta: number | null;
  nRecent: number;
  nOlder: number;
}

export interface CostTrend {
  /** Builds in the newer half / the older half. */
  nRecent: number;
  nOlder: number;
  /** The timestamp the halves were split at, or null when there was nothing to split. */
  splitAt: number | null;
  realInr: TrendMetric;
  billedInr: TrendMetric;
  minutes: TrendMetric;
  heals: TrendMetric;
  /** Share of builds that succeeded, 0..1. HIGHER is better here, unlike every other metric. */
  successRate: TrendMetric;
  /** True when at least one metric produced a real delta. */
  comparable: boolean;
}

const metric = (recent: readonly number[], older: readonly number[]): TrendMetric => {
  const r = avg([...recent]);
  const o = avg([...older]);
  const enough = recent.length >= MIN_TREND_SAMPLE && older.length >= MIN_TREND_SAMPLE;
  return {
    recent: r,
    older: o,
    delta: enough && r !== null && o !== null ? money(r - o) : null,
    nRecent: recent.length,
    nOlder: older.length,
  };
};

/** Newest half against the older half. Pure; input order does not matter. */
export function costTrend(rows: readonly BuildCostRow[]): CostTrend {
  const sorted = [...rows].filter((r) => r.startedAt > 0).sort((a, b) => b.startedAt - a.startedAt);
  const half = Math.floor(sorted.length / 2);
  const recent = sorted.slice(0, half);
  const older = sorted.slice(half, half * 2);
  const pick = (g: readonly BuildCostRow[], f: (r: BuildCostRow) => number | null): number[] =>
    g.map(f).filter((v): v is number => v !== null);
  const priced = (g: readonly BuildCostRow[]): number[] =>
    g.filter((r) => r.measured && r.realInr !== null).map((r) => r.realInr as number);
  const settled = (g: readonly BuildCostRow[]): number[] =>
    g.filter((r) => r.ok !== null).map((r) => (r.ok ? 1 : 0));

  const out: CostTrend = {
    nRecent: recent.length,
    nOlder: older.length,
    splitAt: recent.length > 0 ? recent[recent.length - 1].startedAt : null,
    realInr: metric(priced(recent), priced(older)),
    billedInr: metric(pick(recent, (r) => r.billedInr), pick(older, (r) => r.billedInr)),
    minutes: metric(pick(recent, (r) => r.minutes), pick(older, (r) => r.minutes)),
    heals: metric(recent.map((r) => r.heals), older.map((r) => r.heals)),
    successRate: metric(settled(recent), settled(older)),
    comparable: false,
  };
  out.comparable = [out.realInr, out.billedInr, out.minutes, out.heals, out.successRate].some((m) => m.delta !== null);
  return out;
}
