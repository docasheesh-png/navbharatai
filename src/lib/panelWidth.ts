// How wide is a full-page panel? One answer, in one place.
//
// ADMIN REPORT 2026-08-19: "setting ke andar account, your app, general setting — teeno me desktop par
// bhi mobile jaisa UI dikh raha hai." All three sat in a ~576px column with the rest of a 1920px screen
// empty beside them. They are three different files, and each had invented its own hard-coded cap:
// Settings sub-screens `max-w-xl`, the Account page `max-w-3xl`, the APK Builder its own. Nothing was
// shared, so nothing grew on a desktop, and the fourth screen written tomorrow would have invented a
// fourth cap. That missing rule is the root cause — not any one of the three numbers.
//
// TWO WIDTHS, BECAUSE THERE ARE GENUINELY TWO KINDS OF PAGE:
//
//   • CONTROLS (settings, account, builders) — the width is USEFUL. More room means more of the app's
//     options visible at once, which is exactly what "desktop jaisa" means.
//   • PROSE (the legal documents) — the width is HARMFUL. A line of text running the full 1920px is
//     genuinely harder to read; every publication on earth caps its measure for this reason. These
//     screens stay narrow ON PURPOSE, and that is not the bug being fixed here.
//
// WHY IT FOLLOWS THE APP'S VIEW MODE AND NOT A CSS BREAKPOINT. NavBharatAI has its own View Mode
// setting (Auto / Mobile / Tablet / Desktop — the first control in General Settings). A plain
// `lg:max-w-5xl` would key off the WINDOW, so a user on a big screen who deliberately chose "Mobile"
// would still be handed the wide desktop layout — the app quietly overruling a setting the user just
// changed. Taking the mode as an argument keeps the promise that View Mode actually decides.

export type DeviceMode = 'mobile' | 'tablet' | 'desktop';

/**
 * The container classes for a page of CONTROLS.
 *
 * Every class is a complete literal string, never composed — Tailwind's compiler only emits classes it
 * can SEE in the source, so a built-up `max-w-${size}` would compile to nothing and the page would
 * silently lose its width.
 */
export function panelWidth(mode: DeviceMode): string {
  switch (mode) {
    case 'desktop':
      return 'max-w-5xl';
    case 'tablet':
      return 'max-w-3xl';
    default:
      return 'max-w-xl';
  }
}

/** The container classes for a page of PROSE — a readable measure at every screen size. */
export const READING_WIDTH = 'max-w-xl';

/**
 * Should this page's section cards flow into COLUMNS?
 *
 * Widening the container alone is only half of "desktop jaisa": a single column of cards stretched to
 * 1024px looks worse than the narrow one, not better — a row with a label at the far left and a switch
 * at the far right is a page you have to sweep your eyes across. Flowing independent cards into two
 * columns is what actually fills a wide screen, and it is the same treatment the Settings ROOT screen
 * already uses, so this is one pattern applied consistently rather than a new invention.
 */
export function panelColumns(mode: DeviceMode): string {
  return mode === 'desktop' ? 'columns-2 gap-4 [&>*]:break-inside-avoid [&>*]:mb-4' : '';
}
