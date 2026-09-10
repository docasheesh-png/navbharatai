// WHICH APP IS THIS KEY FOR? — the decision, separated from the screen that renders it.
//
// 🔴 THE DEFECT THIS FIXES (admin 2026-09-08, from a v5 screenshot).
//
// The vault has one genuinely useful app dimension: a key saved for one app should not be written into
// every other app's `.env`. The screen exposed that as a single dropdown listing EVERY app the user has
// — and rendered the same dropdown in both places the vault opens from. In Settings that is right:
// choosing which app a key belongs to IS the job there.
//
// Inside a v5 build it is wrong, in three separate ways:
//
//  1. IT ASKS A QUESTION THAT IS ALREADY ANSWERED. The user is looking at one app, opened the sheet
//     from that app's own menu, and the picker is already set to it. The only thing the control can do
//     with the common answer is agree.
//
//  2. IT IS A FOOT-GUN, and this is the real harm rather than the clutter. The list also contains every
//     OTHER app, so one stray tap saves the key into a different app's `.env` — and nothing anywhere
//     says so. The build the user is watching then cannot see the key it just asked for, with no error
//     to explain it: the key IS saved, it IS valid, it is simply somewhere else. Nobody manages app Y's
//     credentials from inside app X's build sheet, so the control's entire downside had no upside.
//
//  3. IT NAMED THE APP BADLY. The option text is the workspace's effective name, which for an unnamed
//     app is its whole opening prompt — so the control read "Import this app from my GitHub repository
//     a…", clipped mid-word, and the sentence beneath repeated the same run-on in quotes.
//
// ⚠️ WHAT IS **NOT** REMOVED, and why deleting the whole control would have been the wrong fix: "all
// apps" is a real answer, not the absence of one. An `OPENAI_API_KEY` or a Stripe key that most of
// somebody's apps share belongs there — and there is no UI anywhere to change a key's scope after it is
// saved, so a v5 user with no way to say "shared" would have to delete the key and re-add it in
// Settings. So the one meaningful choice survives as a checkbox; only the meaningless-and-dangerous one
// (silently retargeting another app) is gone.
//
// PURE, so the rule is tested without React and both doors are guaranteed to reach the same decision.

/**
 * Which control the screen should show.
 *
 * Keyed on `defaultAppId` — "was this opened from inside an app?" — and deliberately NOT on `embedded`,
 * which the vault component states is about CHROME only. A future embedded surface opened without an
 * app would still, correctly, get the picker.
 */
export type ScopeControl =
  /** Opened from inside an app: name that app, and offer only "share with my other apps too". */
  | 'fixed'
  /** Opened from Settings with apps to choose between: the full picker, unchanged. */
  | 'picker'
  /** Nothing to choose between — no app context and no apps yet. Show no control at all. */
  | 'none';

export function scopeControl(defaultAppId: string | null | undefined, appCount: number): ScopeControl {
  if (String(defaultAppId ?? '').trim()) return 'fixed';
  return Number(appCount) > 0 ? 'picker' : 'none';
}

/**
 * The `workspace_id` a newly saved key is stored against. `null` means "every app".
 *
 * 🔒 IN FIXED MODE THE APP CANNOT BE ANYTHING BUT THE ONE ON SCREEN. That is the property that kills
 * defect 2 by construction rather than by carefulness: there is no code path from this screen to
 * another app's `.env`.
 */
export function saveScope(opts: {
  control: ScopeControl;
  defaultAppId?: string | null;
  pickerValue?: string | null;
  shareWithAll?: boolean;
}): string | null {
  if (opts.control === 'fixed') {
    if (opts.shareWithAll) return null;
    return String(opts.defaultAppId ?? '').trim() || null;
  }
  if (opts.control === 'picker') return String(opts.pickerValue ?? '').trim() || null;
  return null;
}

/** A long derived title is the app's whole opening prompt — clamp it before it reaches a label. */
export function shortAppName(name: string | null | undefined, max = 42): string {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The sentence under the control: where the key about to be typed will actually go.
 *
 * Always rendered, in every mode, because the answer matters most exactly when no control is on screen
 * to imply it.
 */
export function scopeSentence(opts: {
  control: ScopeControl;
  appName?: string | null;
  shareWithAll?: boolean;
  pickerTitle?: string | null;
  hasApps?: boolean;
}): string {
  if (opts.control === 'fixed') {
    const name = shortAppName(opts.appName);
    return opts.shareWithAll
      ? 'This key will go to every app you build, including this one.'
      : `This key goes only to ${name ? `“${name}”` : 'this app'}. Your other apps will not receive it.`;
  }
  if (opts.control === 'picker' && String(opts.pickerTitle ?? '').trim()) {
    return `A key you add now goes only to “${shortAppName(opts.pickerTitle)}” — your other apps will not receive it. `
      + 'Keys shared with all apps are listed here too, and every app still gets those.';
  }
  return 'A key you add now goes to every app you build.'
    + (opts.hasApps ? ' Pick an app above to keep a key out of your other apps.' : '');
}

/**
 * The badge beside a saved key saying who receives it.
 *
 * "All apps" is the one worth reading — it is the fact that matters most about a payment secret. Returns
 * '' when nothing truthful can be said, rather than guessing a name.
 */
export function secretOwnerLabel(opts: {
  workspaceId?: string | null;
  currentAppId?: string | null;
  titleOf?: (id: string) => string | undefined;
}): string {
  const wid = String(opts.workspaceId ?? '').trim();
  if (!wid) return 'All apps';
  const title = opts.titleOf?.(wid);
  if (title) return shortAppName(title, 28);
  // No title available (the app list failed, or the app was deleted) — say the relationship instead of
  // inventing a name.
  return wid === String(opts.currentAppId ?? '').trim() ? 'This app' : 'Another app';
}
