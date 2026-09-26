// WHICH CONSOLE LINES MAY JUDGE A RENDER CHECK (autopsy 7d79254b, 2026-09-26).
//
// 🔴 WHAT HAPPENED. An EduHub build rendered in a real browser 229 s in (`IN_BUILD_GREEN`), passed its
// typecheck, its production build and 11/11 of its own tests — and was reported RED, "not ready to use",
// and billed ₹0. The only evidence against it was ONE console line:
//
//     …/node_modules/.vite/deps/react-dom-C2FHna43.js?v=fb0517f8 — net::ERR_ABORTED
//
// Two defects turned that line into a verdict, and either one alone would have done it:
//
//   1. **A CANCELLED request was read as a FAILED one.** `net::ERR_ABORTED` is what Chrome reports when
//      a request is abandoned: the page navigated or reloaded while it was in flight, or the app's own
//      AbortController cancelled it. Vite does exactly that when it re-optimises dependencies after
//      package.json changes — it drops the old pre-bundled chunk and reloads the page. Nothing failed.
//      If the app really did not come up, the DOM verdict says so on its own; this line adds nothing.
//
//   2. **Every render check judged THIS render by errors from the WHOLE build.** The verify loop, the
//      render rescue and the last-chance proof all read the console with `since = buildStartedAt`, and
//      the log is append-only. So a line recorded once — before a repair, during the model's own
//      browsing, anywhere in the build — condemned every later check. The repair pass cleared the Vite
//      cache, restarted the server, and its own `console_errors` call (a 120 s window) came back clean;
//      the next check re-read the same stale line — same chunk hash, same `v=` — and gave up.
//      **A repair could not succeed by construction.**
//
// 🔑 THE SIBLING ALREADY KNEW THE RULE. The runtime auto-fix loop reads an ADVANCING window, and says
// why in its own comment: *"so a repaired error logged before the fix is never re-detected and we cannot
// loop on it."* The three render verdicts never got it. This module is that rule, stated once, for all of
// them.
//
// PURE — no I/O. The actuator reads the log; this decides what part of it a check may use.

/** A request the browser ABANDONED rather than one that failed. Never evidence against an app. */
export const CANCELLED_REQUEST_RE = /net::ERR_ABORTED\b/;

/** True when a recorded console line is a cancelled request, not a failure. */
export function isCancelledRequest(text: unknown): boolean {
  return CANCELLED_REQUEST_RE.test(String(text ?? ''));
}

/**
 * How far before a check's own start its window opens. The log is stamped with the SANDBOX clock and
 * the check with the SERVER clock, so the window is widened by a margin that absorbs any drift between
 * them. Fifteen seconds is far more than NTP-synced machines drift, and far less than the minutes that
 * separate one render check from the next (a repair pass sits between them).
 */
export const RENDER_CHECK_CLOCK_SLACK_MS = 15_000;

/**
 * `AGENTV3_BROWSE_CONSOLE=off` — the no-deploy revert for the recorder `browseUrl` attaches to its own
 * page (lane C, 2026-09-21). Lives here, and E2BActuator re-exports it, so the recorder and the window
 * that depends on it read ONE switch and cannot disagree.
 */
export function browseConsoleCaptureEnabled(): boolean {
  return (process.env['AGENTV3_BROWSE_CONSOLE'] ?? '').trim().toLowerCase() !== 'off';
}

/**
 * The `since` a render check passes to `getConsoleErrors`.
 *
 * When `browseUrl` records its OWN page's console, the check has first-hand evidence, so it reads only
 * what arrived from its own start (less the clock slack). When it does not — the recorder switched off —
 * the only console evidence is whatever the build's other browser sessions left behind, and narrowing the
 * window would throw that away; the old whole-build window is kept exactly.
 */
export function renderCheckConsoleSince(opts: {
  checkStartedAt: number;
  buildStartedAt: number;
  checkRecordsConsole?: boolean;
}): number {
  const records = opts.checkRecordsConsole ?? browseConsoleCaptureEnabled();
  if (!records || !Number.isFinite(opts.checkStartedAt)) return opts.buildStartedAt;
  return Math.max(opts.buildStartedAt, opts.checkStartedAt - RENDER_CHECK_CLOCK_SLACK_MS);
}
