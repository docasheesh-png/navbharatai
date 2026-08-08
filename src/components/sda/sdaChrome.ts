// SDA chat — chrome (non-conversation UI) preferences.
//
// ADMIN REPORT 2026-08-08: "page ka space bina baat ki cheezo se ghira hua hai … quick tool hide bhi
// kar do na, fir bhi itna sara space occupy hai … mujhe visibility maximum chahiye."
//
// Two distinct problems hid behind one complaint:
//   1. Hiding Quick Tools did not STICK — `useState(true)` re-opened the panel on every mount, so the
//      doctor re-hid it every single visit. A preference the user expresses and the app forgets is a
//      broken control, not a layout question.
//   2. Even collapsed, the chrome ate a large share of a phone screen. That is fixed in the component
//      (rows merged, a duplicate hint row deleted); this module owns only the remembered preference.
//
// PURE + injectable storage so it is fully unit-testable and can never throw in a private-mode /
// storage-disabled browser (Safari private mode throws on setItem — that must never break the chat).

export const SDA_TOOLS_PREF_KEY = 'nbai.sda.quickTools.open';

/** The narrow-screen breakpoint (Tailwind `sm`). Below it, screen space is the scarce resource. */
export const SDA_NARROW_MAX_PX = 640;

/** A storage-like object (localStorage in the app, a fake in tests). */
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Should the Quick Tools panel start open?
 *
 * An explicit saved choice ALWAYS wins — that is the whole point of remembering it. With no saved
 * choice, the default is CLOSED on a phone (the doctor's first need is to read the conversation) and
 * OPEN on a wide screen (where the tools cost nothing). PURE; never throws.
 */
export function initialToolsOpen(storage: PrefStorage | null | undefined, viewportWidth: number): boolean {
  try {
    const saved = storage?.getItem(SDA_TOOLS_PREF_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch { /* storage unreadable (private mode / disabled) — fall through to the default */ }
  return viewportWidth > SDA_NARROW_MAX_PX;
}

/** Persist the choice. Best-effort: a storage failure must never break the chat. PURE-ish; never throws. */
export function saveToolsOpen(storage: PrefStorage | null | undefined, open: boolean): void {
  try {
    storage?.setItem(SDA_TOOLS_PREF_KEY, open ? '1' : '0');
  } catch { /* private mode / quota — the preference simply does not persist this session */ }
}
