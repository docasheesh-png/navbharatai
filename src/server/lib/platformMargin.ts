// ONE PLATFORM MARGIN — revenue minus EVERY recorded AI cost, over one window (admin 2026-10-11, Q-114 (b)).
//
// The Business panel's margin used to be "revenue minus CHAT cost" and said so, because NavBharatAI keeps
// three separate cost records and the panel read one:
//   • chat turns      → `ai_usage_logs` rows (tokens, priced here with the same rate card a build uses);
//   • builds          → the cost telemetry day docs (`totalRealCostUsd` + `totalSandboxUsd`, the platform's
//                       own provider cost, priced by the code that billed the build);
//   • assistants      → the assistant spend day docs (`realUsd` — Professionals, Doctor AI, Other-AI tools).
// The queue row proposed reading `user_costs` for builds. That collection holds what the USER was BILLED,
// not what the build cost us, so a margin built on it would have subtracted revenue from revenue. The real
// build cost is in the telemetry day docs, which is what this reads.
//
// 🔒 ONE WINDOW FOR EVERY TERM. The day docs are kept for a bounded number of days and the logs are not, so
// mixing a lifetime revenue with a 30-day cost would print a margin for no period at all. Every term here
// is cut at the same first day.
//
// 🔒 A COST WE COULD NOT FULLY MEASURE IS A FLOOR. An unpriced chat call, an unmeasured assistant turn or a
// build that recorded no real cost leaves its source `complete: false`; the total is then "at least" and
// the margin "at most", and the screen must say so. PURE — the route reads the stores and passes rows in.
import { isRevenueRow } from './purchaseLedger';
import { summariseUsage, marginInr, type PriceUsage, type UsageLogRow } from './usageLedger';

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v: unknown): number => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The parts of a build cost day doc this reads (see AgentV3CostTelemetry.DailyCostTelemetryDoc). */
export interface BuildCostDay {
  date: string;
  totalBuilds?: number;
  realCostBuilds?: number;
  totalRealCostUsd?: number;
  totalSandboxUsd?: number;
}

/** The parts of an assistant spend day doc this reads (see assistantSpendRollup.AssistantSpendDay). */
export interface AssistantCostDay {
  date: string;
  turns?: number;
  unmeasuredTurns?: number;
  realUsd?: number;
}

export interface PlatformMarginInput {
  nowMs: number;
  days: number;
  transactions: readonly Record<string, unknown>[];
  chatLogs: readonly (UsageLogRow & { createdAt?: unknown })[];
  priceUsage: PriceUsage;
  buildDays: readonly BuildCostDay[];
  assistantDays: readonly AssistantCostDay[];
  usdToInr: (usd: number) => number;
}

export interface PlatformMarginWindow {
  days: number;
  /** The first calendar day counted (UTC, YYYY-MM-DD); today is the last. */
  fromDate: string;
  revenueInr: number;
  chat: { costInr: number; complete: boolean; calls: number; unpricedCalls: number };
  builds: { costInr: number; complete: boolean; builds: number; buildsWithRealCost: number };
  assistants: { costInr: number; complete: boolean; turns: number; unmeasuredTurns: number };
  costInr: number;
  /** True only when every cost source was fully measured — otherwise the margin is "at most". */
  complete: boolean;
  marginInr: number;
}

/** The first day of a window of `days` calendar days ending today (UTC). */
export function windowStartDate(nowMs: number, days: number): string {
  const n = Math.max(1, Math.floor(days));
  return new Date(nowMs - (n - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** An ISO timestamp or date's calendar day, or '' when it is not one. */
function dayOf(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

export function platformMarginWindow(input: PlatformMarginInput): PlatformMarginWindow {
  const days = Math.max(1, Math.floor(input.days));
  const fromDate = windowStartDate(input.nowMs, days);
  const today = new Date(input.nowMs).toISOString().slice(0, 10);
  const inWindow = (day: string): boolean => day !== '' && day >= fromDate && day <= today;

  const revenueInr = (input.transactions ?? [])
    .filter((tx) => tx && isRevenueRow(tx) && inWindow(dayOf(tx.createdAt)))
    .reduce((s, tx) => s + num(tx.amountPaid), 0);

  const chatRows = (input.chatLogs ?? []).filter((r) => r && inWindow(dayOf(r.createdAt)));
  const chatUsage = summariseUsage(chatRows, input.priceUsage);

  let buildUsd = 0; let builds = 0; let buildsWithRealCost = 0;
  for (const d of input.buildDays ?? []) {
    if (!d || !inWindow(String(d.date ?? ''))) continue;
    buildUsd += num(d.totalRealCostUsd) + num(d.totalSandboxUsd);
    builds += num(d.totalBuilds);
    buildsWithRealCost += num(d.realCostBuilds);
  }

  let assistantUsd = 0; let turns = 0; let unmeasuredTurns = 0;
  for (const d of input.assistantDays ?? []) {
    if (!d || !inWindow(String(d.date ?? ''))) continue;
    assistantUsd += num(d.realUsd);
    turns += num(d.turns);
    unmeasuredTurns += num(d.unmeasuredTurns);
  }

  const chat = { costInr: round2(input.usdToInr(chatUsage.costUsd)), complete: chatUsage.complete, calls: chatUsage.calls, unpricedCalls: chatUsage.unmeasuredCalls };
  const buildsPart = { costInr: round2(input.usdToInr(buildUsd)), complete: buildsWithRealCost >= builds, builds, buildsWithRealCost };
  const assistants = { costInr: round2(input.usdToInr(assistantUsd)), complete: unmeasuredTurns === 0, turns, unmeasuredTurns };
  const costInr = round2(chat.costInr + buildsPart.costInr + assistants.costInr);
  const complete = chat.complete && buildsPart.complete && assistants.complete;

  return {
    days, fromDate,
    revenueInr: round2(revenueInr),
    chat, builds: buildsPart, assistants,
    costInr, complete,
    marginInr: marginInr(revenueInr, costInr, complete).valueInr,
  };
}
