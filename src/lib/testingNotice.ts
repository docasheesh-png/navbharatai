// THE TESTING NOTICE — shown once per app open, on the home screen (admin 2026-09-14).
//
// Admin's ask, verbatim: *"home page par hi jab bhi user app open kare, 3 seconds ke liye ek popup
// aa jaye — 'abhi ham testing phase me hai, is liye failure ko please report kare, jisse ham aur
// strong ban sake. thanks!'"*, and then: *"isko aur acche se professionally likho. english me"*.
//
// 🔒 IT ASKS FOR SOMETHING, SO IT MUST HAND OVER THE WAY TO DO IT. A notice that says "please report
// failures" and leaves the person to find out how is the half-built state the second absolute rule
// forbids — the instruction is real, the means is missing. NavBharatAI already has a genuine,
// app-wide reporting sheet (`ReportSheet`, reachable from the sidebar's "Report a problem" and by
// shaking the phone, which attaches the screen, the device, the build and any recorded error by
// itself). So the notice carries a BUTTON that opens that exact sheet: one tap, not a scavenger hunt.
//
// ⚠️ THREE SECONDS IS SHORT FOR A MESSAGE THAT ASKS THE READER TO ACT, and that is worth saying
// plainly rather than quietly overriding. The admin asked for three, so three is the default — but
// the countdown PAUSES while the notice is hovered, touched or focused, so nobody who is actually
// reading it gets cut off mid-sentence, and nobody reaching for the button has it vanish under their
// finger. That keeps the instruction intact and removes its one sharp edge.
//
// Reduced motion needs no code here: `index.css` disables every animation and transition under
// `.nb-reduce-motion`, which Settings → General → Accessibility already toggles. Using a plain CSS
// animation rather than a JS one means the accessibility setting is honoured by construction.
//
// PURE — no clock, no DOM, no React.

/** How long the notice stays up when nobody is interacting with it. The admin's three seconds. */
export const TESTING_NOTICE_MS = 3000;

/**
 * One app OPEN, not one page view.
 *
 * `sessionStorage` is the right store precisely because it is emptied when the tab or the app
 * closes: a cold launch of the Android/iOS shell, a new tab, or a reload each begin a new session
 * and therefore show the notice again — which is what "whenever the user opens the app" means.
 * `localStorage` would have shown it once in the lifetime of the device, and a plain in-memory flag
 * would have re-shown it every time the user tapped Home, which is the annoying reading of the ask.
 */
export const TESTING_NOTICE_SESSION_KEY = 'nbai_testing_notice_shown';

/** The copy, in one place so a test can pin it and a translation never has to hunt for it. */
export const TESTING_NOTICE_COPY = {
  /** Short enough to land in a glance; the detail is in the body. */
  title: 'NavBharatAI is in active testing',
  body: "If something doesn't work, please report it — that's how we make it stronger. Thank you.",
  /** The exact label of the sheet this opens, so the notice and the menu entry name one thing. */
  action: 'Report a problem',
  dismiss: 'Dismiss',
} as const;

/**
 * Has this app-open already shown the notice?
 *
 * Storage can throw (private mode, blocked site data) and can come back empty. Both are treated as
 * "not shown yet": a notice that fails to appear is a worse outcome than one that appears twice, and
 * neither may ever break the home screen. PURE apart from the storage read, which is guarded.
 */
export function testingNoticeAlreadyShown(store?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const s = store ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    return s?.getItem(TESTING_NOTICE_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that this app-open has shown it. Never throws — forgetting only costs a second showing. */
export function markTestingNoticeShown(store?: Pick<Storage, 'setItem'> | null): void {
  try {
    const s = store ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    s?.setItem(TESTING_NOTICE_SESSION_KEY, '1');
  } catch { /* nothing to remember with — it simply shows again next time */ }
}

/**
 * Should the notice be shown right now?
 *
 * Home only (the admin asked for the home page), once per app open, and never while the app is
 * still deciding what to render. PURE.
 */
export function shouldShowTestingNotice(opts: {
  activeView: string;
  alreadyShown: boolean;
}): boolean {
  if (!opts || opts.alreadyShown) return false;
  return opts.activeView === 'home';
}
