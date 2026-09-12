// THE +18 SETTING — what it actually changes, and the far larger list of what it does not.
//
// ADMIN 2026-09-12: "setting me NSFW (+18) ka option dedo default off, aur kis kis user ne on kiya
// hai, admin penal me dikhe."
//
// ── WHY THIS SETTING HAS TO EXIST BEFORE THE NUDITY DETECTION DOES ───────────────────────────────
// Phase 5 adds nudity to the publish scan. Without a setting, that scan would flag perfectly lawful
// apps — a dating app, an anatomy or medical-education app, a life-drawing reference tool, a mature
// game — and their creators would have no way to say "this is deliberate and I am an adult". A
// detector with no legitimate path is not safety; it is a bug that punishes honest users. So the
// toggle comes first, and Phase 5's detector is built knowing it exists.
//
// ── 🔒 THE LINE THIS TOGGLE MAY NEVER CROSS, AND IT IS ENFORCED, NOT DOCUMENTED ──────────────────
// Turning it ON means exactly one thing: *lawful adult content is allowed in MY OWN apps, and I want
// to see 18+ apps on App Mart.* It is an ACKNOWLEDGEMENT, not a permission slip. Every unlawful
// category — sexual content involving minors, non-consensual imagery, and the rest of the Terms'
// Acceptable-use list — stays refused for every account, in every state of this toggle, forever.
// `ALWAYS_REFUSED` below is what makes that true by construction: the gate takes the toggle AND the
// category, and an always-refused category ignores the toggle entirely.
//
// ── 🔒 WEB ONLY, AND THAT IS A DELIBERATE COMMERCIAL DECISION ────────────────────────────────────
// The Android app is distributed through Google Play, whose policy on sexual content is strict, and
// this developer account has ALREADY taken one policy hit (the medical-features rejection that
// `playCompliance.ts` exists for). Surfacing user-published 18+ content inside the Play build is
// exactly the kind of thing that costs an account, not just an update. So the toggle is hidden and
// inert in the native shell, the same shape as the medical gate — and for the same reason.
//
// PURE. No storage, no Capacitor, no network — every rule here is a function of its inputs.

/** How a piece of content is classified for this purpose. */
export type ContentClass =
  /** Ordinary content. Nothing here applies. */
  | 'general'
  /** Lawful adult content — nudity, sexual themes, mature violence. The toggle governs THIS, only. */
  | 'adult'
  /** Unlawful. Refused for everyone, always. The toggle is not consulted. */
  | 'illegal';

/**
 * The categories no setting can ever unlock.
 *
 * Kept as data rather than an `if` so the list is enumerable, testable, and impossible to widen by
 * accident — adding a category here tightens the gate; nothing in this module can loosen it.
 */
export const ALWAYS_REFUSED: readonly ContentClass[] = ['illegal'];

/** A user's stored choice. `false`/absent both mean OFF — there is no third state. */
export interface AdultPreference {
  optedIn: boolean;
  /** When they turned it on, ISO. '' when they never have. Kept because consent has a date. */
  optedInAt: string;
}

export const ADULT_PREF_OFF: AdultPreference = { optedIn: false, optedInAt: '' };

/** Read whatever storage gave us. Anything unreadable is OFF — the safe direction, always. */
export function adultPreferenceFrom(raw: unknown): AdultPreference {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { optedIn?: unknown; optedInAt?: unknown };
  const optedIn = o.optedIn === true;
  return {
    optedIn,
    optedInAt: optedIn && typeof o.optedInAt === 'string' ? o.optedInAt : '',
  };
}

/**
 * Is the +18 setting even offered to this user right now?
 *
 * Native shell ⇒ no. See the Play note in the header: this is not a UI preference, it is what keeps
 * the Play build's content declaration true.
 */
export function adultSettingAvailable(isNative: boolean): boolean {
  return isNative !== true;
}

/**
 * THE GATE. Everything about who may see or publish what goes through this one function.
 *
 * Note the argument order of the checks: the CLASS is examined before the preference, so an
 * always-refused category cannot be reached by any combination of user state. A future edit that
 * wants to let something through has to delete a line that says `ALWAYS_REFUSED`, in the open.
 */
export function adultAccessAllowed(
  contentClass: ContentClass,
  opts: { optedIn: boolean; isNative: boolean },
): boolean {
  if (ALWAYS_REFUSED.includes(contentClass)) return false;
  if (contentClass !== 'adult') return true;
  // Adult content is web-only AND opt-in. Both, not either.
  if (opts.isNative === true) return false;
  return opts.optedIn === true;
}

/** Should this app be hidden from this viewer's App Mart browsing? */
export function hiddenFromBrowse(
  app: { contentClass?: ContentClass | null },
  viewer: { optedIn: boolean; isNative: boolean },
): boolean {
  const cls = app?.contentClass ?? 'general';
  return !adultAccessAllowed(cls, viewer);
}

/** What the store card shows next to an 18+ app's name. '' for everything else. */
export function adultBadge(contentClass: ContentClass | null | undefined): string {
  return contentClass === 'adult' ? '18+' : '';
}

/**
 * The exact sentences the user ticks against before the toggle turns on.
 *
 * Generated here so the screen cannot promise something the gate does not do — the same discipline
 * the hosting agreement follows. Every line is enforced by `adultAccessAllowed` above.
 */
export const ADULT_CONFIRMATIONS: readonly string[] = [
  'I am 18 years old or older.',
  'I understand this only allows lawful adult content — nudity and mature themes — in apps I build and in what App Mart shows me.',
  'I understand that sexual content involving minors, non-consensual images, and everything else the Terms of Service prohibit stay blocked for every account, whatever this setting says.',
  'I understand apps I mark 18+ are hidden from anyone who has not turned this on, and are not shown in the Android app at all.',
];

/** One line for the admin list, so a reviewer reads a fact rather than a boolean. */
export function adultOptInSummary(pref: AdultPreference): string {
  if (!pref.optedIn) return 'Off';
  return pref.optedInAt ? `On since ${pref.optedInAt.slice(0, 10)}` : 'On';
}
