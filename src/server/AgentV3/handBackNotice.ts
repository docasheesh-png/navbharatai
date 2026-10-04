/**
 * WHAT THE USER IS TOLD WHEN THE PLATFORM HANDS A FINISHED-SOUNDING TURN BACK (autopsy 8f797751, 2026-10-01).
 *
 * 🔴 WHAT HAPPENED. At 4.6 min the model ended its turn with *"Your Math Solver app is ready … Open the
 * Preview tab to try it live."* That text is streamed to the user as it is written. The platform then
 * found 41 class names with no style rule and handed the turn back (`STYLE_RULES_RESUMED`) — the right
 * call — but said so only in the admin report. No preview existed yet: the dev server was started a
 * minute later. The user, told the app was ready and finding nothing to open, pressed Stop at 6.4 min,
 * six seconds after the dev server came up and before the preview was published.
 *
 * A hand-back after a claim the user has already read must correct that claim in the chat, in words,
 * the moment it happens. PURE.
 */

export type HandBackKind = 'style' | 'unfinished';

/** The line shown in the chat when a turn is handed back, or null when nothing needs correcting. */
export function handBackNotice(kind: HandBackKind, shownText: string | null | undefined): string | null {
  if (!String(shownText ?? '').trim()) return null; // nothing was claimed, so there is nothing to correct
  return kind === 'style'
    ? '⏳ Not finished yet — I am styling the screens before the preview opens. This takes a minute; please keep this open.'
    : '⏳ Not finished yet — a few things still need fixing, and I am continuing. Please keep this open.';
}
