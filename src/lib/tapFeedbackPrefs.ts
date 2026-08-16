// Touch feedback preference — the click sound and the vibration, on or off, the user's choice.
//
// ADMIN REQUEST 2026-08-16: "har touch par click sound ya vibration hota hai … Settings → General
// Settings me aisa option de do jisse user jab chahe on/off kar sake. default: sound=on, vibration=off."
//
// 🔒 WHY A MODULE AND NOT TWO `useState`s: the toggles live in Settings, but the thing they control is
// ONE delegated `pointerdown` listener installed once at boot (`installTapHaptics`), far outside React.
// A preference read at install time would be frozen at boot — flipping the switch would do nothing
// until the app restarted, which is the classic "the setting exists but doesn't work" defect the second
// absolute rule forbids. So the listener reads THIS on every tap, and the toggle writes it. The change
// is audible on the very next touch.
//
// PERSISTENCE is localStorage: this is a per-DEVICE comfort setting, not per-account. The same person
// may want the tick on their phone and silence on a shared desktop, and a preference that needs a
// network round-trip before the first tap would be worse than no preference at all.
//
// DEFAULTS, exactly as specified: sound ON, vibration OFF. That also matches what the app does today,
// so a user who never opens Settings notices no change whatsoever — the switches only ever subtract
// surprise, never add it.

export interface TapFeedbackPrefs {
  /** The soft "tak" on every tap. */
  sound: boolean;
  /** The vibration motor on every tap. Off by default — on many Android phones it is a strong,
   *  whole-hand buzz, and at typing frequency it is irritating rather than reassuring (the reason
   *  vibration was removed from taps on 2026-08-09 in the first place). */
  vibration: boolean;
}

export const TAP_FEEDBACK_DEFAULTS: TapFeedbackPrefs = { sound: true, vibration: false };

export const TAP_FEEDBACK_STORAGE_KEY = 'navbharat_tap_feedback';

/** Fired after every save so the live listener (and any open Settings screen) picks the change up. */
export const TAP_FEEDBACK_EVENT = 'navbharat:tap-feedback-changed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // Safari private mode / a blocked-storage context throws on ACCESS, not just on write
  }
}

/**
 * Read the saved preference, falling back to the defaults.
 *
 * 🔒 EVERY FAILURE FALLS BACK TO THE DEFAULTS, never to silence. A user whose storage is unreadable
 * should get the app's normal behaviour, not an app that mysteriously stopped responding to touch.
 * Each field is validated on its own, so a half-written or hand-edited value still yields a sane
 * result for the other one.
 */
export function readTapFeedbackPrefs(store: StorageLike | null = storage()): TapFeedbackPrefs {
  try {
    const raw = store?.getItem(TAP_FEEDBACK_STORAGE_KEY);
    if (!raw) return { ...TAP_FEEDBACK_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TapFeedbackPrefs> | null;
    if (!parsed || typeof parsed !== 'object') return { ...TAP_FEEDBACK_DEFAULTS };
    return {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : TAP_FEEDBACK_DEFAULTS.sound,
      vibration: typeof parsed.vibration === 'boolean' ? parsed.vibration : TAP_FEEDBACK_DEFAULTS.vibration,
    };
  } catch {
    return { ...TAP_FEEDBACK_DEFAULTS };
  }
}

/**
 * Save the preference and announce it. Returns what was saved, so a caller can set its own state from
 * the same value rather than re-reading (and disagreeing with) storage.
 *
 * Announcing matters: the tap listener is installed once at boot and holds no React state, so without
 * this event it would keep using whatever it last read and the switch would appear to do nothing.
 */
export function writeTapFeedbackPrefs(
  next: TapFeedbackPrefs,
  store: StorageLike | null = storage(),
  emit: ((name: string) => void) | null = defaultEmit,
): TapFeedbackPrefs {
  const clean: TapFeedbackPrefs = {
    sound: next?.sound !== false,          // anything not explicitly false stays ON (the default)
    vibration: next?.vibration === true,   // vibration is opt-IN, so only an explicit true enables it
  };
  try { store?.setItem(TAP_FEEDBACK_STORAGE_KEY, JSON.stringify(clean)); } catch { /* unwritable storage must not break the toggle */ }
  try { emit?.(TAP_FEEDBACK_EVENT); } catch { /* an event listener throwing must not break the save */ }
  return clean;
}

function defaultEmit(name: string): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(name));
    }
  } catch { /* best effort */ }
}
