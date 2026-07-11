import { describe, it, expect } from 'vitest';
import { computeTabClose } from '../src/lib/tabClose';

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
    expect(r.nextActiveView).toBe('nbi_chat');          // active 'billing' was closed → switch
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
