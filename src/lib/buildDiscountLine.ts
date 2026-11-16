// The line the user reads under a discounted build, written once and rendered by both the server
// (appended to the summary) and the panel (the green line). PURE. No I/O.
//
// BR1996 (owner rule t362u: users see only the total charged; billing method, rates and fees are
// admin-only). The settle can add to the bill after the discount, so "price − discount" does not always
// reach the total. When the three figures do not reconcile (beyond one paisa of rounding), the line
// drops the worksheet and shows only the discount and the total. It never names what made the
// difference. When they reconcile, the line is byte-identical to before.

/** Integer paise of a rupee figure, or null when it is not a usable number. */
function paise(inr: number): number | null {
  return typeof inr === 'number' && Number.isFinite(inr) ? Math.round(inr * 100) : null;
}

/**
 * True when "list − discount" reaches "pay" within one paisa (each figure is rounded on its own).
 * Anything unusable answers true, so the line keeps today's form (fail-safe: unclear keeps main).
 */
export function discountWorksheetReconciles(d: { listInr: number; discountInr: number; payInr: number }): boolean {
  const list = paise(d.listInr);
  const off = paise(d.discountInr);
  const pay = paise(d.payInr);
  if (list === null || off === null || pay === null) return true;
  return Math.abs(list - off - pay) <= 1;
}

export function buildDiscountLine(d: { listInr: number; discountInr: number; payInr: number; pct: number }): string {
  if (!(d.discountInr > 0) || !(d.pct > 0)) return '';
  const tail = `Discount ${d.pct}% (−₹${d.discountInr.toFixed(2)}) · You pay ₹${d.payInr.toFixed(2)}`;
  if (!discountWorksheetReconciles(d)) return tail;
  return `Build price ₹${d.listInr.toFixed(2)} · ${tail}`;
}
