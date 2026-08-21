// WHAT THE PREVIEW SAYS WHEN THERE IS NO APP YET (admin 2026-08-21).
//
// THE REPORTED BUG, verbatim: "jab koi app nahi ban rahi hai, user ne aise hi free me preview khole to,
// waha processing chal rahi hoti hai, pata nahi kon se app ki 😂".
//
// ROOT CAUSE, and it is the same one this codebase has now hit four times: THE EXISTENCE OF AN ARTIFACT
// STANDING IN FOR ITS VALIDITY. A workspaceId is derived from the session the moment the panel opens —
// before a single file exists — and everything downstream read "we have a workspaceId" as "this user has
// an app". So opening the preview fired a render request, showed "Getting your app ready… loading your
// files and compiling the preview" over a spinner, and then landed on a RED error offering to "Fix with
// AI" — an offer to repair an app that was never built.
//
// Neither of those states was true. "You have not built anything yet" is not a failure and it is not
// work in progress; it is a beginning, and the code had no state for it. This module is that state.
//
// PURE (no React, no I/O) so the wording is unit-testable and lives in one place rather than inline in
// a 1500-line component.

/** Which of the three genuinely-different things is the in-browser preview looking at? */
export type PreviewEmptyKind =
  /** No files have ever existed here — a first-time visitor, or someone who just opened the panel. */
  | 'no-app-yet'
  /** Files exist and are being fetched/compiled — real work, worth a spinner. */
  | 'loading'
  /** Something actually went wrong. */
  | 'error';

/**
 * Decide which state to show.
 *
 * The ORDER matters and is the fix. `knownEmpty` (the server's explicit "this workspace has no files")
 * outranks `loading`, because a request that is in flight only to be told "there is nothing here" must
 * not present itself as an app being prepared. And it outranks `error`, because the old code turned
 * "nothing built yet" into an error message and this is precisely what that produced.
 */
export function previewEmptyKind(s: {
  knownEmpty: boolean;
  loading: boolean;
  error: string;
  /**
   * Has this workspace EVER produced a rendered preview in this session?
   *
   * This is what removes the last of the reported bug. On a brand-new workspace the very first request
   * is in flight before anyone knows whether files exist, and showing the "Getting your app ready…"
   * spinner during that second is a claim we cannot support — it is the same spinner the admin saw and
   * asked whose app it belonged to. Until something has actually rendered, an in-flight request is
   * reported as the first-time screen with a quiet "checking…" note instead. Once the workspace HAS
   * rendered, a later reload is genuinely preparing a known app, and the spinner is honest again.
   */
  everRendered?: boolean;
}): PreviewEmptyKind {
  if (s.knownEmpty) return 'no-app-yet';
  if (s.loading) return s.everRendered ? 'loading' : 'no-app-yet';
  return s.error ? 'error' : 'no-app-yet';
}

/** The headline over the lion. Short, warm, and about THEIR app rather than about our machinery. */
export const WELCOME_HEADLINE = 'Your app will appear here';

/**
 * The rotating line under the headline.
 *
 * Rotating rather than fixed because this screen is the one a curious user sits on for a while, and a
 * single sentence read forty times becomes wallpaper. Each line does a different job: two invite the
 * first message, one says where the button is, one sets the expectation that it is fast. None of them
 * claims anything is happening — that claim was the bug.
 */
export const WELCOME_LINES: readonly string[] = [
  'Tell NavBharatAI what to build, and it shows up right here — live.',
  'Type your idea in the chat. A website, a shop, a game — anything.',
  'No setup, no installs. Just describe it in your own words.',
  'Hindi ya English — jo bhi likhein, app yahin ban kar dikhega.',
  'The moment your first file is written, this screen becomes your app.',
];

/** Which line to show for a given tick. Wraps forever; never throws on a negative or silly tick. */
export function welcomeLine(tick: number): string {
  const n = WELCOME_LINES.length;
  const i = ((Math.trunc(tick) % n) + n) % n;
  return WELCOME_LINES[i];
}

/** How long each line stays up. Long enough to read twice, short enough not to feel frozen. */
export const WELCOME_LINE_MS = 4200;
