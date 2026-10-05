// The image generator's price line, shared so it is testable without the screen. One generator since
// 2026-10-05: Free mode was removed (`src/server/lib/imageTier.ts`), so there is no mode line any more.

/**
 * The header's line (2026-09-30: 5 free images a day, then ₹1 each). Before the server
 * has reported a count it states the rule; after, it states what is left today. PURE.
 */
export function imageAllowanceLine(freeLeft: number | null): string {
  if (freeLeft === null) return '5 free images a day, then ₹1 each';
  if (freeLeft > 0) return `${freeLeft} free image${freeLeft === 1 ? '' : 's'} left today, then ₹1 each`;
  return 'Free images used for today · ₹1 per image';
}
