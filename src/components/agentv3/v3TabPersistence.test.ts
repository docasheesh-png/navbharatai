import { describe, it, expect } from 'vitest';
import { restoreV3Tab, v3TabIsOpen, v3IsActive, V3_TAB_FLAG, V3_ACTIVE_FLAG, V3_VIEW } from './v3TabPersistence';

/**
 * REGRESSION (admin 2026-08-20): "v5 → Publish → Connect database → Settings opens (correct), BUT
 * Pro v5.0 closes, so the user has to come back to v5 and load their app all over again."
 *
 * Root cause: ONE flag, written from the ACTIVE VIEW, decided whether the v5.0 tab came back after a
 * page load. Switching to Settings erased it, so the Supabase consent redirect (a full page load)
 * returned with an EMPTY openTabs — the v5.0 tab did not exist, not merely inactive. These tests
 * encode the two questions as the two separate things they are.
 */
describe('v5.0 tab persistence — "tab is open" and "tab is active" are different questions', () => {
  it('THE EXACT BUG: the tab must be restored after a round trip that left v5.0 for another view', () => {
    // What the flags hold at the moment of the redirect: v5.0 TAB open, Settings ACTIVE.
    const tabFlag = v3TabIsOpen([V3_VIEW, 'settings']);
    const activeFlag = v3IsActive('settings');
    expect(tabFlag).toBe(true);
    expect(activeFlag).toBe(false);
    // The old single-flag logic restored from the ACTIVE flag alone → false → app gone.
    expect(restoreV3Tab(tabFlag, activeFlag)).toBe(true);
  });

  it('a ✕-closed v5.0 tab is NOT restored (closing stays the one deliberate way the chat ends)', () => {
    expect(restoreV3Tab(v3TabIsOpen(['settings', 'home']), v3IsActive('settings'))).toBe(false);
  });

  it('BACKWARD COMPATIBLE: a session that predates the split still restores from the legacy flag', () => {
    // Old browsers hold only `nbi_v3_open`. Treating it as "the tab was open" is correct — it was
    // active, so it was open — and stops the fix itself from closing someone's app mid-session.
    expect(restoreV3Tab(false, true)).toBe(true);
  });

  it('neither flag ⇒ no v5.0 tab (a fresh visit still lands on Home with nothing open)', () => {
    expect(restoreV3Tab(false, false)).toBe(false);
  });

  it('v3TabIsOpen reads membership, v3IsActive reads the front tab — they disagree exactly when they should', () => {
    expect(v3TabIsOpen([V3_VIEW])).toBe(true);
    expect(v3TabIsOpen([])).toBe(false);
    expect(v3IsActive(V3_VIEW)).toBe(true);
    expect(v3IsActive('settings')).toBe(false);
    // v5.0 open but Settings in front — the state the old logic could not represent.
    expect(v3TabIsOpen([V3_VIEW, 'settings']) && !v3IsActive('settings')).toBe(true);
  });

  it('the two storage keys are DISTINCT, and the active key keeps its original name', () => {
    expect(V3_TAB_FLAG).not.toBe(V3_ACTIVE_FLAG);
    // Reusing the original key for "active" is what guarantees a plain reload still lands where it did.
    expect(V3_ACTIVE_FLAG).toBe('nbi_v3_open');
  });
});
