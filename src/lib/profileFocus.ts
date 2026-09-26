// "Complete →" from the rewards checklist lands the user ON the Verifications card, not merely on the
// profile page (admin 2026-09-26: *"complete karne ke liye user profile par redirect button"*).
//
// Landing on the top of a long page and leaving the user to scroll for the thing they tapped is the
// dead end `settingsScreen` / `storeTab` already exist to avoid elsewhere in App.tsx. Two paths, because
// the profile may or may not be mounted when the button is pressed:
//   • not mounted → a one-shot sessionStorage flag the page reads on mount;
//   • already open → an event the page listens for.
// Either way the flag is consumed once, so a later visit to the profile does not jump on its own.

const FLAG = 'nbai.profile.focus';
export const PROFILE_FOCUS_EVENT = 'navbharat:profile-focus';
export const PROFILE_VERIFICATIONS_ID = 'profile-verifications';

/** Open the profile and bring the Verifications card into view. Safe anywhere; never throws. */
export function openProfileVerifications(): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(FLAG, 'verifications'); } catch { /* private mode: the event still works */ }
  window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'my_profile' } }));
  window.dispatchEvent(new CustomEvent(PROFILE_FOCUS_EVENT));
}

/** True exactly once after `openProfileVerifications` — read by the profile page on mount. */
export function consumeProfileFocus(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const want = window.sessionStorage.getItem(FLAG) === 'verifications';
    if (want) window.sessionStorage.removeItem(FLAG);
    return want;
  } catch {
    return false;
  }
}

/** Scroll the Verifications card into view, after the page has had a frame to lay out. */
export function scrollToProfileVerifications(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    document.getElementById(PROFILE_VERIFICATIONS_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}
