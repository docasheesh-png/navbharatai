// historySurface — does the History button open a POPUP over the chat, or the full History tab?
//
// THE REQUEST (admin 2026-08-28): "NavBharatAI Pro v5 jaise history chat ke andar hi popup jaise
// khulti hai — NavBharatAI Free me bhi waisa hi ho." In v5 the History button drops a panel over the
// conversation you are already in; you glance, pick, and you are back. On the Free surface the same
// button switched the whole app to a separate History TAB — you left your conversation to look at a
// list of conversations, then had to find your way back.
//
// WHY THIS IS A MODULE AND NOT AN `if` IN App.tsx: the History button is ONE button shared by several
// surfaces (Free, the Professionals hub, the sidebar). Deciding in place would mean the rule lives
// inside a 4000-line component where the next person cannot see it, and where "which surfaces get the
// popup" drifts silently. Pure in, pure out, so the rule is visible and pinned by tests.
//
// 🔒 EVERY SURFACE EXCEPT THE ONES NAMED HERE KEEPS TODAY'S BEHAVIOUR BYTE-FOR-BYTE. The Professionals
// hub deliberately does NOT get the popup: it opens a professional-only history view of its own, and
// quietly replacing that with the Free surface's merged list would change what a different screen
// shows without anyone asking for it.

/**
 * The surfaces where History opens as a popup over the current conversation.
 *
 * Only the Free chat today. `nbi_pro_chat` is NOT here — Pro v5.0 already has its own in-panel
 * history dropdown (AgentV3Panel), which is the thing this is copying; routing it through here too
 * would give that surface two different history popups.
 */
export const HISTORY_POPUP_SURFACES = ['nbi_chat'] as const;

export type HistorySurface = 'popup' | 'tab';

/**
 * Where should the History button take the user, from `activeView`?
 *
 * @param activeView the view the user is looking at when they press History
 */
export function historySurfaceFor(activeView: string): HistorySurface {
  if (!activeView) return 'tab';
  return (HISTORY_POPUP_SURFACES as readonly string[]).includes(activeView) ? 'popup' : 'tab';
}

/**
 * Which rows should the list show, given where it was opened from?
 *
 * This mirrors the scoping the History TAB already applies (App.tsx), so the popup and the tab can
 * never disagree about what "Free history" means — the merged Free + Doctor + professionals list,
 * each row carrying its own mode tag (shipped 2026-08-25, PR #2687; the popup REUSES it rather than
 * rendering a second list).
 */
export function historyFilterFor(activeView: string): 'free' | 'professional' {
  return activeView === 'professionals' ? 'professional' : 'free';
}
