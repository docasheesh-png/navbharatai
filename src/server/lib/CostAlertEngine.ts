// U-5 — Per-user cost-alerting thresholds over the real monthly spend.
//
// A pure, dependency-free engine that compares a user's REAL month-to-date AI spend against their
// configured monthly budget and raises honest alerts as they approach / exceed it. The route
// converts the stored USD spend to INR (via the canonical UsdInrRate) and feeds this engine, so the
// comparison is always same-currency and the numbers are the user's real recorded spend.
//
// HONESTY: with no budget set (budget ≤ 0) there is nothing to compare against, so NO alert is
// invented — the report simply says budgetSet:false. Alerts fire only from real spend vs a real,
// user-chosen limit; nothing is projected.

export type CostAlertSeverity = 'warning' | 'critical';

export interface CostAlert {
  id: 'budget-approaching' | 'budget-exceeded';
  severity: CostAlertSeverity;
  title: string;
  detail: string;
}

export interface CostAlertReport {
  budgetSet: boolean;
  budgetInr: number;
  spendInr: number;
  remainingInr: number;
  /** spend / budget, 0..(>1). 0 when no budget is set. */
  usedPct: number;
  alerts: CostAlert[];
}

/** Fraction of budget at which the "approaching" warning fires. */
export const DEFAULT_WARN_PCT = 0.8;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compare month-to-date spend (INR) against the monthly budget (INR) and produce a report + alerts.
 * Pure. `warnAtPct` is clamped to (0, 1]; a non-positive budget means "no limit set" → no alerts.
 */
export function buildCostAlertReport(
  spendInr: number,
  budgetInr: number,
  warnAtPct: number = DEFAULT_WARN_PCT,
): CostAlertReport {
  const spend = Number.isFinite(spendInr) && spendInr > 0 ? spendInr : 0;
  const budget = Number.isFinite(budgetInr) && budgetInr > 0 ? budgetInr : 0;
  const warn = Number.isFinite(warnAtPct) && warnAtPct > 0 && warnAtPct <= 1 ? warnAtPct : DEFAULT_WARN_PCT;

  if (budget <= 0) {
    return { budgetSet: false, budgetInr: 0, spendInr: round2(spend), remainingInr: 0, usedPct: 0, alerts: [] };
  }

  const usedPct = spend / budget;
  const remainingInr = round2(Math.max(0, budget - spend));
  const alerts: CostAlert[] = [];

  if (usedPct >= 1) {
    alerts.push({
      id: 'budget-exceeded',
      severity: 'critical',
      title: 'Monthly AI budget exceeded',
      detail: `You've spent ₹${round2(spend)} this month — over your ₹${round2(budget)} budget (${Math.round(usedPct * 100)}%).`,
    });
  } else if (usedPct >= warn) {
    alerts.push({
      id: 'budget-approaching',
      severity: 'warning',
      title: 'Approaching your monthly AI budget',
      detail: `You've used ${Math.round(usedPct * 100)}% of your ₹${round2(budget)} budget (₹${round2(spend)} spent, ₹${remainingInr} left).`,
    });
  }

  return {
    budgetSet: true,
    budgetInr: round2(budget),
    spendInr: round2(spend),
    remainingInr,
    usedPct: Math.round(usedPct * 10000) / 10000,
    alerts,
  };
}
