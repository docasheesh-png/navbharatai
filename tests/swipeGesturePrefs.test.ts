/**
 * THE SWIPE BELONGS TO THE USER.
 *
 * ADMIN REQUEST 2026-08-16: "left to right swipe par sidebar menu open ho jata hai … Accessibility se
 * isko bhi control karna. left-to-right swipe — selector (3-4 options) … swipe on/off bhi."
 *
 * WHY A PREFERENCE AT ALL, and it is not a matter of taste in the code: the horizontal swipe is a
 * SCARCE RESOURCE — there is exactly one — and two features have already lost a fight over it in
 * App.tsx. Its own comments record that this gesture "replaces the accidental browser back/forward",
 * and that a tab-switching swipe "was removed because it competed with the sidebar". Both uses were
 * reasonable; the conflict was never resolvable in code because it is a matter of preference. Letting
 * the user settle it hands BOTH removed behaviours back as choices.
 *
 * 🔒 EVERY RULE LIVES IN `decideSwipe`, WHICH IS PURE — so the behaviour is provable here rather than
 * needing a touchscreen and a human finger.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  readSwipeGesturePrefs,
  writeSwipeGesturePrefs,
  decideSwipe,
  isSwipeAction,
  SWIPE_GESTURE_DEFAULTS,
  SWIPE_GESTURE_STORAGE_KEY,
  SWIPE_GESTURE_EVENT,
  type SwipeGesturePrefs,
} from '../src/lib/swipeGesturePrefs';

const store = (seed?: string) => {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(SWIPE_GESTURE_STORAGE_KEY, seed);
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
};
const P = (p: Partial<SwipeGesturePrefs> = {}): SwipeGesturePrefs => ({ ...SWIPE_GESTURE_DEFAULTS, ...p });

describe('🔒 defaults — today’s behaviour, so nobody is surprised', () => {
  it('swipe ON, action = open the menu', () => {
    expect(SWIPE_GESTURE_DEFAULTS).toEqual({ enabled: true, action: 'menu' });
  });

  it('a user who never opens Settings gets exactly that', () => {
    expect(readSwipeGesturePrefs(store())).toEqual({ enabled: true, action: 'menu' });
  });

  it('and the default swipe still opens the menu', () => {
    expect(decideSwipe('ltr', SWIPE_GESTURE_DEFAULTS, false)).toBe('open-menu');
  });
});

describe('🔒 what a left→right swipe does — the selector', () => {
  it('each of the three actions is honoured', () => {
    expect(decideSwipe('ltr', P({ action: 'menu' }), false)).toBe('open-menu');
    expect(decideSwipe('ltr', P({ action: 'back' }), false)).toBe('go-back');
    expect(decideSwipe('ltr', P({ action: 'tab' }), false)).toBe('switch-tab');
  });

  it('🔒 OFF means genuinely nothing happens — in either direction', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      for (const action of ['menu', 'back', 'tab'] as const) {
        expect(decideSwipe(dir, P({ enabled: false, action }), false), `${dir}/${action}`).toBe('none');
      }
    }
  });

  it('🔒 …and OFF is respected even with the menu open — no hidden exception', () => {
    expect(decideSwipe('rtl', P({ enabled: false }), true)).toBe('none');
  });
});

describe('🔒 closing an open menu always wins', () => {
  it('whatever action is chosen, a swipe with the menu open closes it', () => {
    // Without this rule, choosing "Go back" would leave the menu open with no gesture able to dismiss
    // it — worse than having no preference at all. A drawer opened by swiping must close by swiping.
    for (const action of ['menu', 'back', 'tab'] as const) {
      expect(decideSwipe('rtl', P({ action }), true), action).toBe('close-menu');
      expect(decideSwipe('ltr', P({ action }), true), action).toBe('close-menu');
    }
  });

  it('right→left with nothing open is deliberately inert — never "forward"', () => {
    for (const action of ['menu', 'back', 'tab'] as const) {
      expect(decideSwipe('rtl', P({ action }), false), action).toBe('none');
    }
  });
});

describe('saving and reading back', () => {
  it('round-trips every enabled/action combination', () => {
    for (const enabled of [true, false]) {
      for (const action of ['menu', 'back', 'tab'] as const) {
        const s = store();
        writeSwipeGesturePrefs({ enabled, action }, s, null);
        expect(readSwipeGesturePrefs(s), `${enabled}/${action}`).toEqual({ enabled, action });
      }
    }
  });

  it('🔒 announces the change, or the live listener would never learn about it', () => {
    const emit = vi.fn();
    writeSwipeGesturePrefs(P({ action: 'back' }), store(), emit);
    expect(emit).toHaveBeenCalledWith(SWIPE_GESTURE_EVENT);
  });
});

describe('🔒 a broken value never disables the user’s gestures', () => {
  it('unreadable, empty or corrupt storage falls back to the defaults', () => {
    for (const seed of ['', 'not json', 'null', '[]', '"x"', '{']) {
      expect(readSwipeGesturePrefs(store(seed)), seed).toEqual(SWIPE_GESTURE_DEFAULTS);
    }
  });

  it('an UNKNOWN action falls back to the menu rather than doing nothing', () => {
    // A stored action from a future version, or a hand-edited value, must not leave the swipe dead.
    expect(readSwipeGesturePrefs(store('{"enabled":true,"action":"teleport"}')))
      .toEqual({ enabled: true, action: 'menu' });
  });

  it('a HALF-written value keeps the other field sane', () => {
    expect(readSwipeGesturePrefs(store('{"action":"back"}'))).toEqual({ enabled: true, action: 'back' });
    expect(readSwipeGesturePrefs(store('{"enabled":false}'))).toEqual({ enabled: false, action: 'menu' });
  });

  it('storage that THROWS on access is survived', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readSwipeGesturePrefs(throwing)).toEqual(SWIPE_GESTURE_DEFAULTS);
    expect(() => writeSwipeGesturePrefs(P(), throwing, null)).not.toThrow();
  });

  it('the action validator accepts only the three real actions', () => {
    for (const ok of ['menu', 'back', 'tab']) expect(isSwipeAction(ok), ok).toBe(true);
    for (const bad of ['', 'MENU', 'forward', 'none', 0, null, undefined, {}]) {
      expect(isSwipeAction(bad), String(bad)).toBe(false);
    }
  });
});
