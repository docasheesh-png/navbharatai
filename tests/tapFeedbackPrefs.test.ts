/**
 * THE USER DECIDES WHETHER THEIR PHONE CLICKS AND BUZZES.
 *
 * ADMIN REQUEST 2026-08-16: "har touch par click sound ya vibration hota hai … Settings → General
 * Settings me option de do jisse user jab chahe on/off kar sake. default: sound=on, vibration=off."
 *
 * 🔒 THE DEFECT THIS DESIGN EXISTS TO PREVENT is a switch that looks right and does nothing. The tap
 * feedback is ONE delegated `pointerdown` listener installed once at boot, far outside React — so a
 * preference read at INSTALL time would be frozen there, and flipping the toggle would change
 * nothing until the app restarted. The listener therefore reads the preference on EVERY tap. These
 * tests pin that, because it is the difference between a real setting and a decorative one.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  readTapFeedbackPrefs,
  writeTapFeedbackPrefs,
  TAP_FEEDBACK_DEFAULTS,
  TAP_FEEDBACK_STORAGE_KEY,
  TAP_FEEDBACK_EVENT,
  shouldOpenMenuOnSwipe,
  MENU_SWIPE_EDGE_PX,
  type TapFeedbackPrefs,
} from '../src/lib/tapFeedbackPrefs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installTapHaptics } from '../src/lib/nativeShell';

/** An in-memory store, so these tests never depend on a real localStorage. */
const store = (seed?: string) => {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(TAP_FEEDBACK_STORAGE_KEY, seed);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    _raw: () => map.get(TAP_FEEDBACK_STORAGE_KEY),
  };
};

describe('🔒 the defaults the admin specified', () => {
  it('sound ON, vibration OFF', () => {
    expect(TAP_FEEDBACK_DEFAULTS).toEqual({ sound: true, vibration: false, swipeMenu: false });
  });

  it('a user who has never opened Settings gets exactly those', () => {
    expect(readTapFeedbackPrefs(store())).toEqual({ sound: true, vibration: false, swipeMenu: false });
  });
});

describe('saving and reading back', () => {
  it('round-trips every combination — all four must be reachable', () => {
    for (const p of [
      { sound: true, vibration: false, swipeMenu: false },
      { sound: false, vibration: true, swipeMenu: false },
      { sound: true, vibration: true, swipeMenu: true },
      { sound: false, vibration: false, swipeMenu: false },
    ]) {
      const s = store();
      writeTapFeedbackPrefs(p, s, null);
      expect(readTapFeedbackPrefs(s), JSON.stringify(p)).toEqual(p);
    }
  });

  it('🔒 announces the change, or the live listener would never learn about it', () => {
    const emit = vi.fn();
    writeTapFeedbackPrefs({ sound: false, vibration: false, swipeMenu: false }, store(), emit);
    expect(emit).toHaveBeenCalledWith(TAP_FEEDBACK_EVENT);
  });

  it('returns what it saved, so a caller never disagrees with storage', () => {
    expect(writeTapFeedbackPrefs({ sound: false, vibration: true, swipeMenu: false }, store(), null))
      .toEqual({ sound: false, vibration: true, swipeMenu: false });
  });
});

describe('🔒 a broken value never silences the app', () => {
  it('unreadable, empty or corrupt storage falls back to the defaults', () => {
    for (const seed of ['', 'not json', 'null', '[]', '"x"', '{']) {
      expect(readTapFeedbackPrefs(store(seed)), seed).toEqual(TAP_FEEDBACK_DEFAULTS);
    }
  });

  it('a HALF-written value keeps the other field sane', () => {
    expect(readTapFeedbackPrefs(store('{"vibration":true}'))).toEqual({ sound: true, vibration: true, swipeMenu: false });
    expect(readTapFeedbackPrefs(store('{"sound":false}'))).toEqual({ sound: false, vibration: false, swipeMenu: false });
  });

  it('a non-boolean field is ignored rather than coerced', () => {
    expect(readTapFeedbackPrefs(store('{"sound":"yes","vibration":1}'))).toEqual(TAP_FEEDBACK_DEFAULTS);
  });

  it('storage that THROWS on access is survived — Safari private mode does this', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readTapFeedbackPrefs(throwing)).toEqual(TAP_FEEDBACK_DEFAULTS);
    expect(() => writeTapFeedbackPrefs({ sound: false, vibration: false, swipeMenu: false }, throwing, null)).not.toThrow();
  });

  it('vibration and swipe-to-open are opt-IN: only an explicit true turns them on', () => {
    // The dangerous direction for BOTH: a stored `undefined` must never come back as enabled. Sound is
    // the opposite — anything not explicitly false stays on, because silence is the surprising state.
    const s = store();
    writeTapFeedbackPrefs({ vibration: undefined as never, sound: undefined as never, swipeMenu: undefined as never }, s, null);
    expect(readTapFeedbackPrefs(s)).toEqual({ sound: true, vibration: false, swipeMenu: false });
  });
});

describe('🔒 swipe-to-open the menu — the accidental gesture (admin 2026-08-28)', () => {
  const prefs = (over: Partial<TapFeedbackPrefs> = {}): TapFeedbackPrefs => ({ ...TAP_FEEDBACK_DEFAULTS, ...over });

  it('is OFF by default — the whole point of the report', () => {
    expect(TAP_FEEDBACK_DEFAULTS.swipeMenu).toBe(false);
    expect(shouldOpenMenuOnSwipe(0, TAP_FEEDBACK_DEFAULTS)).toBe(false);
    expect(shouldOpenMenuOnSwipe(5, TAP_FEEDBACK_DEFAULTS)).toBe(false);
  });

  it('when ON, opens only from the LEFT EDGE — not from the middle of the screen', () => {
    const on = prefs({ swipeMenu: true });
    expect(shouldOpenMenuOnSwipe(0, on)).toBe(true);
    expect(shouldOpenMenuOnSwipe(MENU_SWIPE_EDGE_PX, on)).toBe(true);
    // THE ACCIDENT: a sideways swipe that starts mid-screen — scrolling the preview toolbar, a code
    // block, a carousel — used to open the menu. It must not, even with the gesture enabled.
    expect(shouldOpenMenuOnSwipe(MENU_SWIPE_EDGE_PX + 1, on)).toBe(false);
    expect(shouldOpenMenuOnSwipe(200, on)).toBe(false);
  });

  it('a nonsense coordinate never opens it', () => {
    const on = prefs({ swipeMenu: true });
    expect(shouldOpenMenuOnSwipe(Number.NaN, on)).toBe(false);
    expect(shouldOpenMenuOnSwipe(Number.POSITIVE_INFINITY, on)).toBe(false);
  });

  it('the edge zone is thumb-reachable but cannot overlap mid-screen content', () => {
    expect(MENU_SWIPE_EDGE_PX).toBeGreaterThanOrEqual(24);
    expect(MENU_SWIPE_EDGE_PX).toBeLessThanOrEqual(48);
  });
});

describe('WIRING — the gesture reads the preference per touch, and Settings can flip it', () => {
  const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const panel = readFileSync(join(process.cwd(), 'src/components/panels/SettingsPanel.tsx'), 'utf8');

  it('the open branch is gated; the CLOSE branch deliberately is not', () => {
    expect(app).toContain('shouldOpenMenuOnSwipe(startX, readTapFeedbackPrefs())');
    // Closing only does anything while the menu already covers the screen — gating it would strand a
    // user who opened the menu by tapping and then swiped to dismiss it.
    expect(app).toContain('setIsMenuOpen(prev => (prev ? false : prev))');
  });

  it('the preference is read PER TOUCH, so the switch works without a restart', () => {
    // Reading it at mount would freeze the choice at boot — the "setting that does nothing" defect.
    const at = app.indexOf('shouldOpenMenuOnSwipe(startX, readTapFeedbackPrefs())');
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(0, at)).toContain('const onEnd = (e: TouchEvent) => {');
  });

  it('Settings → Touch feedback carries the switch', () => {
    expect(panel).toContain("key: 'swipeMenu'");
    expect(panel).toContain('Swipe to open menu');
  });
});

describe('🔒 the listener obeys the preference, on every tap', () => {
  const harness = (prefs: () => { sound: boolean; vibration: boolean }) => {
    const tick = vi.fn();
    const buzz = vi.fn();
    let handler: ((e: Event) => void) | null = null;
    const root = {
      addEventListener: (_t: string, cb: (e: Event) => void) => { handler = cb; },
      removeEventListener: () => {},
    };
    const ctx = { Capacitor: { isNativePlatform: () => true } } as never;
    let clock = 0;
    installTapHaptics(ctx, root, () => (clock += 1000), tick, prefs, buzz);
    const tap = () => handler?.({ target: { closest: () => ({}) } } as never as Event);
    return { tap, tick, buzz };
  };

  it('sound on, vibration off (the default) → tick only', () => {
    const h = harness(() => ({ sound: true, vibration: false }));
    h.tap();
    expect(h.tick).toHaveBeenCalledTimes(1);
    expect(h.buzz).not.toHaveBeenCalled();
  });

  it('sound off → silence, and the app still works', () => {
    const h = harness(() => ({ sound: false, vibration: false }));
    h.tap();
    expect(h.tick).not.toHaveBeenCalled();
    expect(h.buzz).not.toHaveBeenCalled();
  });

  it('vibration on → buzz, and at the GENTLEST strength', () => {
    const h = harness(() => ({ sound: false, vibration: true }));
    h.tap();
    expect(h.buzz).toHaveBeenCalledWith('light');
  });

  it('both on → both fire', () => {
    const h = harness(() => ({ sound: true, vibration: true }));
    h.tap();
    expect(h.tick).toHaveBeenCalledTimes(1);
    expect(h.buzz).toHaveBeenCalledTimes(1);
  });

  it('🔒 THE WHOLE POINT — a change mid-session takes effect on the very next tap', () => {
    let prefs = { sound: true, vibration: false };
    const h = harness(() => prefs);
    h.tap();
    expect(h.tick).toHaveBeenCalledTimes(1);
    prefs = { sound: false, vibration: true };   // the user just flipped both switches
    h.tap();
    expect(h.tick).toHaveBeenCalledTimes(1);      // still 1 — the tick did NOT fire again
    expect(h.buzz).toHaveBeenCalledTimes(1);
  });

  it('🔒 a preference that throws still leaves the app usable, on the defaults', () => {
    const h = harness(() => { throw new Error('storage gone'); });
    expect(() => h.tap()).not.toThrow();
    expect(h.tick).toHaveBeenCalledTimes(1);   // fell back to sound ON
    expect(h.buzz).not.toHaveBeenCalled();     // …and vibration OFF
  });

  it('a non-native shell installs nothing at all — this is a phone feature', () => {
    const tick = vi.fn();
    const root = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    installTapHaptics({} as never, root, () => 0, tick);
    expect(root.addEventListener).not.toHaveBeenCalled();
  });
});
