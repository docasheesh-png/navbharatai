// The image generator's mode and price lines, shared so they are testable without the screen.

/** The two modes on the image screen (admin 2026-09-30: "free + paid dono"). */
export type ImageTier = 'free' | 'paid';

/** The server codes a Paid-mode press can answer (`src/server/lib/imageTier.ts`). */
const PAID_CAN_ANSWER = new Set(['free_busy', 'needs_paid']);

/**
 * The header's line for Paid mode (2026-09-30: 5 free images a day, then ₹1 each). Before the server
 * has reported a count it states the rule; after, it states what is left today. PURE.
 */
export function imageAllowanceLine(freeLeft: number | null): string {
  if (freeLeft === null) return '5 free images a day, then ₹1 each';
  if (freeLeft > 0) return `${freeLeft} free image${freeLeft === 1 ? '' : 's'} left today, then ₹1 each`;
  return 'Free images used for today · ₹1 per image';
}

/** The header's line for the mode on screen. PURE. */
export function imageTierLine(tier: ImageTier, freeLeft: number | null): string {
  return tier === 'free' ? 'Free for everyone, no daily limit' : `Paid · ${imageAllowanceLine(freeLeft)}`;
}

/** The server's code when switching to Paid mode would answer this failure, else ''. PURE. */
export function paidCanAnswer(body: unknown): string {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' && PAID_CAN_ANSWER.has(code) ? code : '';
}
