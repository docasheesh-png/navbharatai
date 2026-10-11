// WHAT YOUR APP'S AI HAS COST, DAY BY DAY (admin 2026-10-11, Q-797: "an owner screen of their app's AI spend").
//
// An owner's app answers strangers with NavBharatAI's AI and each answer is charged to the owner's balance — and
// the only number the owner could see was TODAY's. A cost that grew over a week was invisible until the balance
// was. This is the history: the last 30 days, the published app and the preview apart, from the SAME counters the
// daily caps are enforced against (AppAiUsageStore), so the screen cannot show a number the cap did not use.
// PURE — shared by the route that sums it and the card that shows it.

/** How far back the owner's history goes. The counters are kept per day; 30 is one bill's worth. */
export const SPEND_HISTORY_DAYS = 30;

/** The last `n` UTC day keys (`YYYY-MM-DD`, the counters' own key), newest first. PURE. */
export function lastDayKeys(nowMs: number, n: number = SPEND_HISTORY_DAYS): string[] {
  const out: string[] = [];
  const count = Math.max(1, Math.min(90, Math.floor(n)));
  for (let i = 0; i < count; i++) out.push(new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export interface SpendDay { day: string; publishedInr: number; previewInr: number; calls: number }
export interface SpendHistory {
  days: SpendDay[];
  totalPublishedInr: number;
  totalPreviewInr: number;
  totalCalls: number;
}

type DayCounts = Record<string, { spentInr?: number; calls?: number } | undefined>;

const rupees = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
};
const count = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

/** The two counters, day by day, with totals. Rounded to paise once, here. PURE. */
export function spendHistory(days: readonly string[], preview: DayCounts, published: DayCounts): SpendHistory {
  const rows = days.map((day) => ({
    day,
    publishedInr: rupees(published[day]?.spentInr),
    previewInr: rupees(preview[day]?.spentInr),
    calls: count(published[day]?.calls) + count(preview[day]?.calls),
  }));
  const sum = (k: 'publishedInr' | 'previewInr') => Math.round(rows.reduce((t, r) => t + r[k], 0) * 100) / 100;
  return { days: rows, totalPublishedInr: sum('publishedInr'), totalPreviewInr: sum('previewInr'), totalCalls: rows.reduce((t, r) => t + r.calls, 0) };
}

/** Read the route's answer. A body that is not a history is not one — never an empty "₹0" by default. PURE. */
export function readSpendHistory(httpOk: boolean, body: unknown): (SpendHistory & { known: boolean }) | null {
  if (!httpOk || !body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.days)) return null;
  const days = (b.days as unknown[]).filter((d): d is SpendDay => !!d && typeof d === 'object' && typeof (d as SpendDay).day === 'string')
    .map((d) => ({ day: d.day, publishedInr: rupees(d.publishedInr), previewInr: rupees(d.previewInr), calls: count(d.calls) }));
  return {
    days,
    totalPublishedInr: rupees(b.totalPublishedInr),
    totalPreviewInr: rupees(b.totalPreviewInr),
    totalCalls: count(b.totalCalls),
    known: b.known === true,
  };
}
