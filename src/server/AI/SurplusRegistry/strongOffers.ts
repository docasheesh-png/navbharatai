// Surplus × the shared model rule (modelChoice.ts, admin 2026-11-18: "Surplus par sirf filter").
//
// Surplus chooses among its reviewed offers by price, and that choice is tied to its receipts and accounting, so it is
// not replaced. What it gains is the shared rule's first gate: an offer outside the ten strongest CODING families is not
// chosen while a strong one is eligible. When no eligible offer is strong, the list is returned unchanged — this filter
// can narrow Surplus's choice, never take Surplus away from a build. PURE.
import { familyRank, modelChoiceEnabled } from '../../lib/modelChoice';

export function strongOffersOnly<T extends { model: string }>(offers: readonly T[], env: NodeJS.ProcessEnv = process.env): T[] {
  if (!modelChoiceEnabled(env)) return [...offers];
  const strong = offers.filter((o) => familyRank(o.model, 'coding') >= 0);
  return strong.length > 0 ? strong : [...offers];
}
