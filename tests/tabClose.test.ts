import { describe, it, expect } from 'vitest';
import { computeTabClose } from '../src/lib/tabClose';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('computeTabClose — closing a tab also closes its opened options + companions', () => {
  it('closes a plain leaf tab and switches away when it was active', () => {
    const r = computeTabClose('billing', ['home', 'settings', 'billing'], 'billing', {}, {});
    expect(r.closing).toEqual(['billing']);
    expect(r.nextTabs).toEqual(['home', 'settings']);
    expect(r.nextActiveView).toBe('settings'); // last remaining tab
  });

  it('leaves the active view unchanged (null) when closing a non-active tab', () => {
    const r = computeTabClose('billing', ['settings', 'billing'], 'settings', {}, {});
    expect(r.closing).toEqual(['billing']);
    expect(r.nextActiveView).toBeNull();
    expect(r.nextTabs).toEqual(['settings']);
  });

  it('falls back to home when the last tab is closed', () => {
    const r = computeTabClose('settings', ['settings'], 'settings', {}, {});
    expect(r.nextActiveView).toBe('home');
    expect(r.nextTabs).toEqual([]);
  });

  it('closing SETTINGS also closes the options opened from inside it', () => {
    const openTabs = ['settings', 'billing', 'voice', 'nbi_chat'];
    const openers = { billing: 'settings', voice: 'settings' }; // nbi_chat opened elsewhere
    const r = computeTabClose('settings', openTabs, 'billing', openers, {});
    expect(new Set(r.closing)).toEqual(new Set(['settings', 'billing', 'voice']));
    expect(r.nextTabs).toEqual(['nbi_chat']);          // the unrelated tab survives
    // CHANGED 2026-08-18 — this line used to expect 'nbi_chat', and that expectation was the bug the
    // admin reported ("close karte hai to NavBharatAI FREE open ho jata hai"), not an invariant. The
    // user was inside Billing, a Settings CHILD, so closing Settings tore down the whole overlay
    // group — landing them in an unrelated chat is the same surprise, reached from one step deeper.
    expect(r.nextActiveView).toBe('home');
  });

  it('closing PROFESSIONALS also closes the professional AIs opened from it (with their companions)', () => {
    const openTabs = ['professionals', 'teacher_ai', 'nbi_pro_chat', 'preview'];
    const openers = { teacher_ai: 'professionals', nbi_pro_chat: 'professionals' };
    const r = computeTabClose('professionals', openTabs, 'professionals', openers, { nbi_pro_chat: ['preview'] });
    expect(new Set(r.closing)).toEqual(new Set(['professionals', 'teacher_ai', 'nbi_pro_chat', 'preview']));
    expect(r.nextTabs).toEqual([]);
    expect(r.nextActiveView).toBe('home');
  });

  it('a child opened from a DIFFERENT parent is not swept up', () => {
    const openTabs = ['settings', 'billing', 'professionals', 'teacher_ai'];
    const openers = { billing: 'settings', teacher_ai: 'professionals' };
    const r = computeTabClose('settings', openTabs, 'home', openers, {});
    expect(new Set(r.closing)).toEqual(new Set(['settings', 'billing']));
    expect(r.nextTabs).toEqual(['professionals', 'teacher_ai']);
    expect(r.nextActiveView).toBeNull(); // 'home' wasn't in the closed set
  });

  it('closes the Pro chat companion (preview) when the Pro chat itself is closed directly', () => {
    const r = computeTabClose('nbi_pro_chat', ['nbi_pro_chat', 'preview'], 'preview', {}, { nbi_pro_chat: ['preview'] });
    expect(new Set(r.closing)).toEqual(new Set(['nbi_pro_chat', 'preview']));
    expect(r.nextActiveView).toBe('home'); // active 'preview' was a companion that closed
  });

  it('does not treat a tab as its own child (no infinite/self loop)', () => {
    const r = computeTabClose('settings', ['settings'], 'settings', { settings: 'settings' }, {});
    expect(r.closing).toEqual(['settings']);
  });
});

describe('closing Settings returns to Home, not to whatever tab was last', () => {
  /**
   * Admin 2026-08-18: *"jab setting ko close (x) karte hai to NavBharatAI FREE open ho jata hai. yeh
   * galat hai — home page khulna chahiye."*
   *
   * Two separate wrongs met here. The panel's own ✕ ran `toggleTab('nbi_chat')` — hardcoded, so it
   * neither closed Settings nor went anywhere the user asked for. And the tab bar's ✕ fell back to the
   * LAST REMAINING TAB, which with a FREE chat open is also NavBharatAI FREE. Fixing only the button
   * would have left the same surprise one click away.
   */
  it('lands on home even when other tabs are open', () => {
    const r = computeTabClose('settings', ['home', 'nbi_chat', 'settings'], 'settings');
    expect(r.nextActiveView).toBe('home');
    expect(r.nextTabs).toEqual(['home', 'nbi_chat']);
  });

  it('THE EXACT REPORTED CASE: a FREE chat sitting last no longer captures the close', () => {
    // 'nbi_chat' is last in the list, so the old last-tab rule chose it every time.
    const r = computeTabClose('settings', ['home', 'settings', 'nbi_chat'], 'settings');
    expect(r.nextActiveView).toBe('home');
    expect(r.nextActiveView).not.toBe('nbi_chat');
  });

  it('still closes the options Settings opened, and still lands home', () => {
    // The child-closing behaviour (admin bug 2026-07-11) must survive this change untouched.
    const r = computeTabClose(
      'settings',
      ['home', 'nbi_chat', 'settings', 'billing', 'voice'],
      'settings',
      { billing: 'settings', voice: 'settings' },
    );
    expect(new Set(r.closing)).toEqual(new Set(['settings', 'billing', 'voice']));
    expect(r.nextTabs).toEqual(['home', 'nbi_chat']);
    expect(r.nextActiveView).toBe('home');
  });

  it('ORDINARY tabs are unchanged — closing a chat still lands on the tab beside it', () => {
    // The last-tab rule is right for siblings; it was only ever wrong for an overlay you step out of.
    // Pinned so this fix cannot quietly turn every close into a trip home.
    const r = computeTabClose('nbi_pro_chat', ['home', 'nbi_chat', 'nbi_pro_chat'], 'nbi_pro_chat');
    expect(r.nextActiveView).toBe('nbi_chat');
  });

  it('closing Settings while looking at ANOTHER tab does not move the user', () => {
    // Only the active view being closed changes where you are. Yanking someone out of the chat they
    // are reading because a background tab closed would be its own bug.
    const r = computeTabClose('settings', ['home', 'nbi_chat', 'settings'], 'nbi_chat');
    expect(r.nextActiveView).toBeNull();
  });

  it('the home-returning set is a parameter, so the rule is visible rather than buried', () => {
    // Same call, different policy — proves the behaviour comes from a named rule and not from a
    // hardcoded `view === 'settings'` inside the algorithm.
    const asOverlay = computeTabClose('professionals', ['home', 'nbi_chat', 'professionals'], 'professionals', {}, {}, 'home', ['professionals']);
    expect(asOverlay.nextActiveView).toBe('home');
    const asSibling = computeTabClose('professionals', ['home', 'nbi_chat', 'professionals'], 'professionals');
    expect(asSibling.nextActiveView).toBe('nbi_chat');
  });
});

describe('the Settings panel ✕ runs a REAL close', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('no longer hardcodes a destination chat', () => {
    // The whole bug in one line: a button labelled "Close Settings" ran toggleTab('nbi_chat').
    const panel = read('src/components/panels/SettingsPanel.tsx');
    expect(panel).not.toContain("toggleTab('nbi_chat')");
    expect(panel).toContain('onClick={onCloseSettings}');
  });

  it('is wired to the SAME teardown the tab bar uses — not a second copy of it', () => {
    // A private close in the panel would have to re-implement children, companions and state reset,
    // and would drift from the tab bar's version the first time either changed.
    const app = read('src/App.tsx');
    expect(app).toContain("onCloseSettings={() => closeTab(undefined, 'settings')}");
    expect(app).toContain('const closeTab = useCallback((e: React.MouseEvent | undefined, view: ViewType)');
  });
});
