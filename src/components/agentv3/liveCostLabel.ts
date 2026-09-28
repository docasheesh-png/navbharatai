// The words beside the live ₹ figure on the build strip (admin 2026-09-28). PURE.
//
// The number is the server's, priced by the same function as the final bill (liveBuildCost.ts). This
// only decides how it READS — and the one thing it must not do is let a running total pass for the
// final amount. So the text says "so far", and the explanation (shown on hover and read by a screen
// reader) says what can still change it and in which direction: more work adds to it, the rules at
// the end can only lower it, and a build that fails is free.

export interface LiveCostLabel {
  text: string;
  explanation: string;
}

/** Indian digit grouping, always two decimals — ₹1,234.50, never ₹1234.5. */
export function formatInr(inr: number): string {
  return `₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The label, or null when there is nothing honest to show (no figure, zero, or not a number). */
export function liveCostLabel(inr: number | null | undefined): LiveCostLabel | null {
  if (typeof inr !== 'number' || !Number.isFinite(inr) || inr <= 0) return null;
  const amount = formatInr(inr);
  return {
    text: `${amount} so far`,
    explanation: `This build has used ${amount} so far. More work adds to it; the checks made when it finishes can only lower it, and a build that fails is free.`,
  };
}
