/**
 * One way to print a USD amount in a report line (Q-2747, autopsy 05eb30ba, 2026-11-20).
 *
 * Thirteen report lines printed money with `toFixed(4)`. Builds that cost a fraction of a hundredth of a cent
 * (a cancelled turn, a cheap-tier probe) then read "$0.0000 instead of $0.0000": two different, non-zero
 * amounts printed as the same zero, so the line contradicted itself and hid what was billed.
 *
 * Amounts of at least $0.0001 keep four decimals exactly as before. A smaller non-zero amount keeps two
 * significant digits ($0.000037), so it never prints as zero. Zero prints as 0.0000. Never exponent notation.
 * Tests: tests/aSmallAmountIsNotPrintedAsZero.test.ts (including a census that fails on a new `toFixed(4)` amount).
 */
export function usdAmount(usd: number): string {
  if (!Number.isFinite(usd)) return '0.0000';
  const abs = Math.abs(usd);
  if (abs === 0) return '0.0000';
  if (abs >= 0.0001) return usd.toFixed(4);
  // Two significant digits: 0.000037 → 6 decimals; 0.0000004 → 7 decimals. Capped so a denormal never explodes.
  const decimals = Math.min(12, 1 - Math.floor(Math.log10(abs)));
  return usd.toFixed(decimals).replace(/(\.\d*?[1-9])0+$/, '$1');
}
