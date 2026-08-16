// What a left→right swipe does — the user's choice, not ours.
//
// ADMIN REQUEST 2026-08-16: "left to right finger swipe karne par sidebar menu open ho jata hai …
// Accessibility se isko bhi control karna. left-to-right swipe — selector (3-4 options) … swipe on/off bhi."
//
// WHY A SELECTOR AND NOT JUST AN ON/OFF: the horizontal swipe is a scarce resource — there is exactly
// one of it — and this codebase has already had two features lose a fight over it. `App.tsx` says the
// swipe "replaces the accidental browser back/forward", and a second comment records that a
// tab-switching swipe "was removed because it competed with the sidebar". Both were reasonable uses;
// the conflict was never resolvable in code because it is a matter of preference. So the honest fix is
// to let the user settle it — which also gives both removed behaviours back, as choices.
//
// THE THREE ACTIONS, and why exactly these three (each is a real thing the app already does, never an
// invented capability):
//   • 'menu' — open the sidebar. TODAY'S BEHAVIOUR and the default, so nobody is surprised.
//   • 'back' — go back one screen (`window.history.back()`, the SAME thing Android's hardware Back
//     and the app's own back handler do). This is the iOS system convention, so a large group of
//     users already expects it, and it is the behaviour the sidebar swipe originally displaced.
//   • 'tab'  — switch to the previously-used tab. The feature that was removed for competing with
//     the sidebar; a preference is what makes it possible to have back.
// A fourth "do nothing" option is deliberately ABSENT: that is what the on/off switch is for, and
// offering the same outcome in two places makes a settings screen harder to reason about, not richer.
//
// Persisted per DEVICE (localStorage) for the same reason as the touch-feedback preference: gestures
// are a physical habit tied to the phone in your hand, not to your account.

export type SwipeAction = 'menu' | 'back' | 'tab';

export interface SwipeGesturePrefs {
  /** Master switch. Off = the app ignores horizontal swipes entirely. */
  enabled: boolean;
  /** What a LEFT→RIGHT swipe does. Right→left always just closes an open menu — see below. */
  action: SwipeAction;
}

export const SWIPE_GESTURE_DEFAULTS: SwipeGesturePrefs = { enabled: true, action: 'menu' };

export const SWIPE_GESTURE_STORAGE_KEY = 'navbharat_swipe_gesture';
export const SWIPE_GESTURE_EVENT = 'navbharat:swipe-gesture-changed';

const ACTIONS: readonly SwipeAction[] = ['menu', 'back', 'tab'];

/** True for a value this module is willing to act on. Anything else falls back to the default. */
export function isSwipeAction(v: unknown): v is SwipeAction {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // a blocked-storage context throws on ACCESS, not only on write
  }
}

/**
 * Read the saved preference, falling back to the defaults.
 *
 * 🔒 EVERY FAILURE FALLS BACK TO "ENABLED, MENU" — never to disabled. A user whose storage is
 * unreadable must get the app's normal behaviour; silently switching their gestures off would look
 * exactly like the app breaking. Each field is validated on its own, so a half-written value still
 * yields something sane for the other.
 */
export function readSwipeGesturePrefs(store: StorageLike | null = storage()): SwipeGesturePrefs {
  try {
    const raw = store?.getItem(SWIPE_GESTURE_STORAGE_KEY);
    if (!raw) return { ...SWIPE_GESTURE_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SwipeGesturePrefs> | null;
    if (!parsed || typeof parsed !== 'object') return { ...SWIPE_GESTURE_DEFAULTS };
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : SWIPE_GESTURE_DEFAULTS.enabled,
      action: isSwipeAction(parsed.action) ? parsed.action : SWIPE_GESTURE_DEFAULTS.action,
    };
  } catch {
    return { ...SWIPE_GESTURE_DEFAULTS };
  }
}

/**
 * Save and announce. Returns what was saved so a caller sets its state from the same value rather
 * than re-reading storage and disagreeing with it.
 *
 * The announcement matters as much as the write: the swipe listener is installed once at app start
 * and holds no React state, so without this event it would keep using whatever it last read and the
 * setting would appear to do nothing.
 */
export function writeSwipeGesturePrefs(
  next: SwipeGesturePrefs,
  store: StorageLike | null = storage(),
  emit: ((name: string) => void) | null = defaultEmit,
): SwipeGesturePrefs {
  const clean: SwipeGesturePrefs = {
    enabled: next?.enabled !== false,                                      // anything but explicit false stays ON
    action: isSwipeAction(next?.action) ? next.action : SWIPE_GESTURE_DEFAULTS.action,
  };
  try { store?.setItem(SWIPE_GESTURE_STORAGE_KEY, JSON.stringify(clean)); } catch { /* unwritable storage must not break the toggle */ }
  try { emit?.(SWIPE_GESTURE_EVENT); } catch { /* a listener throwing must not break the save */ }
  return clean;
}

function defaultEmit(name: string): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(name));
    }
  } catch { /* best effort */ }
}

/** What a completed horizontal swipe should DO, given the gesture and the current state. PURE. */
export type SwipeOutcome = 'open-menu' | 'close-menu' | 'go-back' | 'switch-tab' | 'none';

/**
 * The single decision behind the gesture, kept pure so every rule is testable without a touchscreen.
 *
 * 🔒 CLOSING AN OPEN MENU ALWAYS WINS, whatever the chosen action. A drawer that opened by swiping
 * must close by swiping back — that is universal, and a user who has just opened the menu is not
 * asking to navigate. Without this rule, choosing 'back' would leave the menu open with no gesture to
 * dismiss it, which is worse than having no preference at all.
 */
export function decideSwipe(
  direction: 'ltr' | 'rtl',
  prefs: SwipeGesturePrefs,
  menuOpen: boolean,
): SwipeOutcome {
  if (!prefs.enabled) return 'none';
  if (menuOpen) return 'close-menu';   // both directions: get out of the drawer first
  if (direction === 'rtl') return 'none'; // right→left with nothing open: deliberately inert, never "forward"
  switch (prefs.action) {
    case 'back': return 'go-back';
    case 'tab': return 'switch-tab';
    default: return 'open-menu';
  }
}
