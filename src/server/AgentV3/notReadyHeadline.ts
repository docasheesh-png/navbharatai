/**
 * The platform's own not-ready headlines — written OVER the model's words when the readiness gate
 * says the app is not finished. Named so a later reader can tell OUR sentence from the model's
 * (see `isNotReadyHeadline`): a render that then proves the app works must not leave either one on a
 * successful, charged build (autopsy 6461025c).
 */
export const NOT_READY_HEADLINE = `⚠️ This app isn't fully working yet — a couple of things still need fixing before it's ready to use.`;
export const NOT_READY_HEADLINE_CONTINUE = `⚠️ This app isn't fully working yet — a couple of things still need fixing. Send another message and I'll keep going.`;

/** Is this summary one of the platform's not-ready headlines rather than the model's answer? PURE. */
export function isNotReadyHeadline(summary: string | null | undefined): boolean {
  const s = String(summary ?? '').trim();
  return s.startsWith(NOT_READY_HEADLINE) || s.startsWith(NOT_READY_HEADLINE_CONTINUE);
}
