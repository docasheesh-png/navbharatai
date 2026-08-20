// Keeping the NavBharatAI Pro v5.0 TAB open across a full-page round trip.
//
// ── THE REPORT (admin 2026-08-20) ───────────────────────────────────────────────────────────────
// "v5 → Publish → Connect database → the Settings→Database page opens (correct!) — but Pro v5.0
//  CLOSES, so the user has to come back to v5 and load their app all over again. We HAVE a
//  multi-window/tab system: v5 → publish → database → new tab, and v5 should stay open."
//
// ── ROOT CAUSE ──────────────────────────────────────────────────────────────────────────────────
// v5.0 survives tab switches while the page lives (see v3SurfaceMount.ts — window semantics). What
// did NOT survive was a full PAGE LOAD, because the one flag that restores v5 was written from the
// ACTIVE VIEW:
//
//     if (activeView === 'nbi_pro_chat') set('nbi_v3_open') else remove('nbi_v3_open')
//
// So simply switching to Settings ERASED it. The Supabase consent is a same-tab redirect, so the
// app reloads on the way back — and with the flag already gone, `openTabs` came back EMPTY: the
// v5.0 tab was not merely inactive, it did not exist. The user's only way back was to open v5.0
// fresh from the menu and wait for the whole app to load again. Exactly the report.
//
// ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
// "Is the v5.0 TAB open?" and "is v5.0 the ACTIVE view?" are two different questions, and they need
// two different flags. A tab stays open until the user ✕-closes it (which is already the one
// deliberate way a v5.0 chat ends — closeTab clears the sticky session); which tab is in FRONT is a
// separate, ordinary piece of view state. Splitting them is what lets a round trip through another
// tab — Settings, the icon maker, the APK builder — come back to a v5.0 that is still there.
//
// Two flags rather than one repurposed flag is also what makes this safe to deploy: a browser that
// already holds the old `nbi_v3_open` from before this shipped still restores the tab (see
// `restoreV3Tab`), so nobody mid-session loses their app to the fix itself.

/** The v5.0 view id, re-exported so callers do not re-spell the string. */
export const V3_VIEW = 'nbi_pro_chat';

/** sessionStorage key: the v5.0 TAB is open (window semantics — survives switching to another tab). */
export const V3_TAB_FLAG = 'nbi_v3_tab';

/**
 * sessionStorage key: v5.0 is the ACTIVE view. Deliberately the ORIGINAL key name, with its original
 * meaning intact, so this change cannot alter where a plain reload lands.
 */
export const V3_ACTIVE_FLAG = 'nbi_v3_open';

/**
 * Should the v5.0 tab be restored into `openTabs` after a page load?
 *
 * `legacyActiveFlag` is the pre-split flag: a session that started before this shipped only ever
 * wrote that one, and treating it as "the tab was open" is correct (it was active, so it was open)
 * and prevents the fix from itself closing someone's app mid-session. PURE.
 */
export function restoreV3Tab(tabFlag: boolean, legacyActiveFlag: boolean): boolean {
  return tabFlag === true || legacyActiveFlag === true;
}

/** Is the v5.0 tab open right now? Drives the tab flag. PURE. */
export function v3TabIsOpen(openTabs: readonly string[]): boolean {
  return openTabs.includes(V3_VIEW);
}

/** Is v5.0 the active view right now? Drives the active flag. PURE. */
export function v3IsActive(activeView: string): boolean {
  return activeView === V3_VIEW;
}
