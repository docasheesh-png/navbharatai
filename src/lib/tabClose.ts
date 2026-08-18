// Tab-close computation (admin bug 2026-07-11): closing the Settings or Professionals tab from the
// header ✕ must ALSO close every option that was opened from inside it. Those options (Wallet, Voice,
// Bot Builder, the Professional AIs, …) open as their OWN sibling header tabs via toggleTab, so before
// this fix closing the parent left them dangling ("option band nahi hota, khula rahta hai").
//
// The App tracks, for each tab, which tab OPENED it (`openers[child] = parent`) — set only when a tab is
// launched while Settings/Professionals is active. This pure function turns a close request into the full
// set of tabs to remove (the tab itself + its children + their fixed companion tabs, e.g. the Pro chat's
// preview) and the next active view. Kept pure + string-typed so it is unit-testable with no React.

export interface TabCloseResult {
  /** Every tab id to remove: the closed tab, its child tabs, and any companion tabs. */
  closing: string[];
  /** openTabs after removal (order preserved). */
  nextTabs: string[];
  /** The view to switch to if the active view was closed; null ⇒ leave the active view unchanged. */
  nextActiveView: string | null;
}

/**
 * Compute the effect of closing `view`.
 *
 * @param view        the tab the user clicked ✕ on
 * @param openTabs    current open tab ids (header order)
 * @param activeView  the currently-focused view
 * @param openers     child→parent map: which tab opened each tab (only set for options launched from a parent)
 * @param companions  parent→[companion ids] that must close together with a tab (e.g. nbi_pro_chat → preview)
 * @param homeView    the always-present base view to fall back to when nothing is left (default 'home')
 * @param returnsHome views that always return to `homeView` when closed, instead of to the last
 *                    remaining tab — overlays you step out of rather than siblings (default: Settings)
 */
export function computeTabClose(
  view: string,
  openTabs: string[],
  activeView: string,
  openers: Record<string, string> = {},
  companions: Record<string, string[]> = {},
  homeView = 'home',
  returnsHome: string[] = ['settings'],
): TabCloseResult {
  const closing = new Set<string>([view]);

  // 1. Children opened from within `view` (Settings/Professionals → its options).
  for (const tab of openTabs) {
    if (openers[tab] === view) closing.add(tab);
  }
  // 2. Fixed companions of anything being closed (transitively, once — the maps are shallow).
  for (const v of [...closing]) {
    for (const companion of companions[v] || []) closing.add(companion);
  }

  const nextTabs = openTabs.filter((t) => !closing.has(t));
  // WHERE CLOSING LANDS YOU (admin 2026-08-18: "setting ko close karte hai to NavBharatAI FREE open ho
  // jata hai — yeh galat hai, home page khulna chahiye").
  //
  // The default rule — fall back to the LAST remaining tab — is right for an ordinary tab: close one
  // chat and you land on the chat next to it. It is wrong for an OVERLAY like Settings, which is not a
  // sibling of your work but a place you step into and back out of. Closing it dropped the user into
  // whichever tab happened to be last, so "close Settings" read as "open NavBharatAI FREE".
  //
  // `returnsHome` names the views that go back to base instead. Kept a parameter rather than a
  // hardcoded `view === 'settings'` so the rule is visible, testable, and extensible without editing
  // the algorithm.
  const nextActiveView = closing.has(activeView)
    ? returnsHome.includes(view)
      ? homeView
      : nextTabs.length > 0
        ? nextTabs[nextTabs.length - 1]
        : homeView
    : null;

  return { closing: [...closing], nextTabs, nextActiveView };
}
