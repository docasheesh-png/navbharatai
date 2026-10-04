/**
 * QUEUE Q-322 — the chat's markdown library breaks on iOS 15 – 16.3 when a message holds an email.
 *
 * `remark-gfm` turns `name@example.com` into a link through `mdast-util-gfm-autolink-literal`, whose
 * 2.0.1 release finds an email with a LOOKBEHIND: `/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@…/gu`. Safari
 * learned lookbehind in 16.4, and the regex is built while a message is being rendered, so on an
 * older iPhone every chat reply that went through markdown threw instead of appearing.
 *
 * The lookbehind is redundant there: the library's own `findEmail` already rejects a match whose
 * previous character is not the start, whitespace or punctuation (`previous(match, true)`). So the
 * build swaps in the same pattern without it (the form the library used before 2.0.1). The build
 * FAILS if the pattern is not found — an upgrade that changes it must be looked at, never silently
 * shipped with the lookbehind back in.
 */
export const AUTOLINK_EMAIL_WITH_LOOKBEHIND = String.raw`/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu`;
export const AUTOLINK_EMAIL_WITHOUT_LOOKBEHIND = String.raw`/([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu`;

/** The module this applies to. */
export function isAutolinkLiteralModule(id: string): boolean {
  return /[\\/]mdast-util-gfm-autolink-literal[\\/]lib[\\/]index\.js$/.test(id.split('?')[0]);
}

/** The library source with the email regex swapped, or null when the pattern is not there. Pure. */
export function patchAutolinkEmail(code: string): string | null {
  if (!code.includes(AUTOLINK_EMAIL_WITH_LOOKBEHIND)) return null;
  return code.split(AUTOLINK_EMAIL_WITH_LOOKBEHIND).join(AUTOLINK_EMAIL_WITHOUT_LOOKBEHIND);
}
