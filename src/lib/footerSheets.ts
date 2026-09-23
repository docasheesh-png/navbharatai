/**
 * ONE FOOTER SHEET AT A TIME (admin 2026-09-23).
 *
 * Admin, verbatim: *"navbharatai free ke andar footer ke Mode press karne ke baad History, AI, Settings
 * kisi par click karo, Mode hat ta hi nahi hai — jisse aisa feel hota hai ki switch hi nahi ho raha hai.
 * Footer me koi option open hai, aur 2nd footer option par click kiya jaye to, old wala hide ho jaye,
 * new click wala show ho!!"*
 *
 * 🔴 THE CAUSE. The bottom bar is `fixed bottom-0` at z-150, so it paints OVER the sheets it opens and
 * stays tappable while one is up. On the NavBharatAI Free footer the Mode button only ever OPENED its
 * sheet, and History / AI / Settings closed nothing. So the Mode sheet stayed over whatever the next tap
 * opened: Settings or the History list came up UNDERNEATH it, and the screen looked frozen. The same
 * gap ran the other way: with the History popup open, a tap on Mode stacked the Mode sheet on top.
 *
 * THE RULE, decided here and nowhere else: a footer tap first closes whatever sheet another footer item
 * opened. A second tap on the item whose sheet is open closes that sheet, exactly as Pro v5.0's own
 * footer already behaves (its History and More sheets live in one `mobileSheet` state for this reason).
 *
 * PURE: it reports what to close and whether to go on to the item's own action. App.tsx applies it.
 */

/** The sheets a footer item opens OVER the current screen (a navigation is not a sheet). */
export interface FooterSheetsOpen {
  mode: boolean;
  history: boolean;
}

/** The items of the NavBharatAI Free / Professionals footer. */
export type ModeFooterKey = 'history' | 'ai' | 'mode' | 'settings';

export interface FooterTapPlan {
  /** The sheets that must be shut before anything else happens. */
  close: ReadonlyArray<keyof FooterSheetsOpen>;
  /**
   * Whether the tapped item should then do its own thing (open its sheet, or navigate).
   * `false` only for a re-tap on the item whose sheet was open: that tap's whole job is to close it.
   */
  proceed: boolean;
}

export function footerTapPlan(key: ModeFooterKey, open: FooterSheetsOpen): FooterTapPlan {
  // Re-tap on the open item: close it and stop.
  if (key === 'mode' && open.mode) return { close: ['mode'], proceed: false };
  if (key === 'history' && open.history) return { close: ['history'], proceed: false };

  // Any other tap: close every OTHER open sheet, then carry on.
  const close: Array<keyof FooterSheetsOpen> = [];
  if (open.mode && key !== 'mode') close.push('mode');
  if (open.history && key !== 'history') close.push('history');
  return { close, proceed: true };
}
