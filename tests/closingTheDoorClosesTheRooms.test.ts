/**
 * Closing the door closes the rooms — admin 2026-09-20.
 *
 * *"navbharatai free me koi professional open ho, aur user header se 'navbharatai free' ki window
 * x(close)/band kar de! to navbharatai ke sare professional bhi band ho jane chahiye! (abhi nahi ho
 * rahe hai!)"*
 *
 * The one word that names the defect is **sare** — ALL of them. Closing Free took the FIRST
 * professional with it and left every one after that on screen.
 *
 * WHY, and it needed both halves to be wrong at once:
 *
 *   1. `openers` is a TREE, and `computeTabClose` read one level of it. It could answer "who are my
 *      children?" and nothing deeper.
 *   2. The tree had depth it should never have had. The Mode sheet opens from INSIDE a professional,
 *      so picking Teacher while Mentor was on screen recorded `teacher_ai → mentor_ai` — one
 *      professional as another's PARENT. Free → Mentor → Teacher, and the one-level walk stopped at
 *      Mentor.
 *
 * ⚠️ FIXING EITHER ALONE TRADES ONE BUG FOR ANOTHER, which is why both are here:
 *   • subtree close alone ⇒ ✕-closing MENTOR would take Teacher down with it. The user never entered
 *     Teacher through Mentor; they are siblings behind one door.
 *   • re-parenting alone ⇒ every genuine nesting elsewhere (Settings → an option → its own option)
 *     stays orphaned, because the walk is still one level deep.
 */
import { describe, it, expect } from 'vitest';
import { computeTabClose } from '../src/lib/tabClose';
import { parentForOpen, isChildSurface, shouldRecordOpener } from '../src/lib/tabParenting';

/**
 * Replays `toggleTab`'s opener bookkeeping for a sequence of opens, exactly as `App.tsx` does it —
 * so these cases describe what the app really records, not a convenient stand-in.
 */
function openSequence(start: string, picks: readonly string[]) {
  const openers: Record<string, string> = {};
  const openTabs: string[] = [start];
  let activeView = start;
  for (const view of picks) {
    if (!openTabs.includes(view)) {
      openTabs.push(view);
      const parent = parentForOpen(view, activeView, openers);
      if (parent) openers[view] = parent;
    }
    activeView = view;
  }
  return { openers, openTabs, activeView };
}

describe('the admin\'s own flow: Free → Mentor → Teacher → Doctor, then ✕ Free', () => {
  const { openers, openTabs, activeView } = openSequence('nbi_chat', ['mentor_ai', 'teacher_ai', 'sda_chat']);

  it('parents every professional to the door, not to the one before it', () => {
    // Was { mentor_ai: 'nbi_chat', teacher_ai: 'mentor_ai', sda_chat: 'teacher_ai' } — a chain.
    expect(openers).toEqual({ mentor_ai: 'nbi_chat', teacher_ai: 'nbi_chat', sda_chat: 'nbi_chat' });
  });

  it('closes ALL of them — "sare professional bhi band ho jane chahiye"', () => {
    const r = computeTabClose('nbi_chat', openTabs, activeView, openers, {});
    expect(new Set(r.closing)).toEqual(new Set(['nbi_chat', 'mentor_ai', 'teacher_ai', 'sda_chat']));
    expect(r.nextTabs).toEqual([]);
    expect(r.nextActiveView).toBe('home');
  });

  it('🔒 and ✕-closing ONE professional closes only that one', () => {
    // The bug the subtree close would have introduced on its own. Siblings, not a hierarchy.
    const r = computeTabClose('mentor_ai', openTabs, activeView, openers, {});
    expect(r.closing).toEqual(['mentor_ai']);
    expect(r.nextTabs).toEqual(['nbi_chat', 'teacher_ai', 'sda_chat']);
  });
});

describe('the subtree close, for the nesting that is real', () => {
  it('follows the opener tree to any depth', () => {
    // Settings → an option → an option of its own. One level could never reach the third.
    const openers = { billing: 'settings', voice: 'billing', bot_builder: 'voice' };
    const r = computeTabClose('settings', ['settings', 'billing', 'voice', 'bot_builder', 'nbi_chat'], 'bot_builder', openers, {});
    expect(new Set(r.closing)).toEqual(new Set(['settings', 'billing', 'voice', 'bot_builder']));
    expect(r.nextTabs).toEqual(['nbi_chat']); // an unrelated tab still survives
  });

  it('carries each closed tab\'s fixed companions with it, at any depth', () => {
    const openers = { deep: 'child', child: 'settings' };
    const r = computeTabClose('settings', ['settings', 'child', 'deep', 'preview'], 'settings', openers, { deep: ['preview'] });
    expect(new Set(r.closing)).toEqual(new Set(['settings', 'child', 'deep', 'preview']));
  });

  it('terminates on a cycle instead of hanging the header', () => {
    // Reachable for real: close a tab, reopen it from what used to be its own child.
    const openers = { a: 'b', b: 'a' };
    const r = computeTabClose('a', ['a', 'b'], 'a', openers, {});
    expect(new Set(r.closing)).toEqual(new Set(['a', 'b']));
  });
});

describe('🔒 what must NOT become a child, whoever opened it', () => {
  it('Settings opened from inside Free survives closing Free', () => {
    // The trap the 2026-08-25 note names: making Free a parent of everything would eat this tab.
    const { openers, openTabs } = openSequence('nbi_chat', ['settings']);
    expect(openers['settings']).toBeUndefined();
    expect(computeTabClose('nbi_chat', openTabs, 'settings', openers, {}).closing).toEqual(['nbi_chat']);
  });

  it('the v5.0 builder is never anybody\'s child — a running build must not be closed by a sibling', () => {
    expect(isChildSurface('nbi_pro_chat')).toBe(false);
    const { openers } = openSequence('nbi_chat', ['nbi_pro_chat']);
    expect(openers['nbi_pro_chat']).toBeUndefined();
  });

  it('a child surface is never recorded as a PARENT — the invariant that makes chains impossible', () => {
    // Every professional, opened from every other professional, must resolve to the shared door.
    const { openers } = openSequence('nbi_chat', ['mentor_ai', 'teacher_ai']);
    for (const parent of Object.values(openers)) {
      expect(isChildSurface(parent), `"${parent}" was recorded as a parent`).toBe(false);
    }
  });

  it('yields no parent at all when the walk cannot reach a real door', () => {
    // A professional on screen with no recorded opener is not a door either — better no link than a
    // sibling link, which is exactly what produced the chain.
    expect(parentForOpen('teacher_ai', 'mentor_ai', {})).toBeUndefined();
    // …and the ordinary case is untouched.
    expect(parentForOpen('teacher_ai', 'nbi_chat', {})).toBe('nbi_chat');
    expect(parentForOpen('billing', 'settings', {})).toBe('settings');
    expect(shouldRecordOpener('teacher_ai', 'teacher_ai')).toBe(false);
  });
});
