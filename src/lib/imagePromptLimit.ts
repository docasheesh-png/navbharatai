/**
 * The image prompt limit, met BEFORE the send rather than after it.
 *
 * Admin, 2026-09-23 (a 400 "Invalid request body" on a long pasted image brief): *"agar problem text
 * length ki hai, to 2000+ wala text se send button inactive kar do!!"*. The server refuses a
 * `prompt` over 2,000 characters on the image route (`routes/imageGen.ts`), and since #3272 it
 * says so in words — but a send that can only fail should not be pressable at all.
 *
 * 🔒 The number is the SERVER's, not a second opinion: `tests/theSendButtonKnowsTheLimit.test.ts`
 * asserts it equals the route schema's `max`, so the two can never drift apart.
 *
 * ⚠️ The free generator SENDS more than the user typed (the image type and colour tint are added
 * around the words), so the limit a person sees is what is left for THEIR words once that wrapping
 * is counted — otherwise the counter would say "1,990 / 2,000" and the send would still fail.
 */
export const IMAGE_PROMPT_MAX = 2_000;

export interface PromptLimit {
  /** Characters the person typed. */
  count: number;
  /** The most they may type, once anything added around their words is counted. */
  limit: number;
  /** Over the limit: the send button is off and the note says why. */
  over: boolean;
  /** Close enough (90%) that the counter is worth showing before it bites. */
  near: boolean;
}

/** `typed` is what is in the box; `sent` is the full prompt the request will carry (defaults to `typed`). */
export function imagePromptLimit(typed: string, sent: string = typed): PromptLimit {
  const count = typed.length;
  const wrapping = Math.max(0, sent.length - typed.length);
  const limit = Math.max(0, IMAGE_PROMPT_MAX - wrapping);
  const over = sent.length > IMAGE_PROMPT_MAX;
  return { count, limit, over, near: over || count >= Math.floor(limit * 0.9) };
}

/** The line under the box: a counter while near, and the reason the button is off once over. */
export function imagePromptLimitNote(l: PromptLimit): string {
  const n = (x: number) => x.toLocaleString('en-IN');
  if (l.over) return `${n(l.count)} / ${n(l.limit)} characters — too long to send. Please shorten it.`;
  return `${n(l.count)} / ${n(l.limit)} characters`;
}
