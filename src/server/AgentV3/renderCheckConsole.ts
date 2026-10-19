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

// ── A RENDERED APP WITH ONE CONSOLE LINE IS LOOKED AT AGAIN BEFORE A REPAIR IS PAID FOR ───────────────
// (autopsy 12511a9c, 2026-09-30). A calculator rendered in a real browser (158 CSS rules, 20 of 20
// buttons styled) and its check still read "didn't render correctly" because of one line, "The script has
// an unsupported MIME type ('text/html')". That is Chrome's message for a service worker whose script came
// back as HTML: the production-defaults pass had just added `register('/sw.js')` to index.html, and the
// dev server did not serve the new public/sw.js yet. Seconds later /sw.js was served as JavaScript and the
// line never came back — but a repair pass (~90 s) and then a runtime auto-fix (~3 min, one 118 s model
// call) were spent on it, and billed.
//
// 🔑 THE CLASS: a console line from a moment the platform itself was changing files (a pass writing, Vite
// reloading, a worker registering) is read as a defect of the app. The cure is not to ignore console
// errors — a real one must still be repaired — but to ask whether it happens AGAIN on a fresh load. A
// look costs one browser open and no model call; a repair costs a model pass and can edit working code.

/**
 * Should this check look once more before a repair? Only when the app visibly RENDERED in a real browser
 * and the only evidence against it is its console, and only once per verify loop. PURE.
 */
export function recheckBeforeRepair(opts: {
  rendered: boolean;
  consoleErrorCount: number;
  source: 'browser' | 'curl' | undefined;
  recheckSpent: boolean;
}): boolean {
  if ((process.env['AGENTV3_CONSOLE_RECHECK'] ?? '').trim().toLowerCase() === 'off') return false;
  return opts.rendered && opts.consoleErrorCount > 0 && opts.source === 'browser' && !opts.recheckSpent;
}

/** The runtime auto-fix loop's look-back when no render check has come back clean. */
export const RUNTIME_AUTOFIX_LOOKBACK_MS = 180_000;

/**
 * Where the runtime auto-fix loop starts reading the console. A real-browser check that came back CLEAN
 * has already answered every line logged before it started, so those lines are not handed to a repair —
 * the same rule `renderCheckConsoleSince` gives the render checks, applied to the one reader that still
 * used a fixed three-minute window. PURE.
 */
export function runtimeAutofixSince(opts: { now: number; lastCleanBrowserCheckAt: number | null }): number {
  const fixed = opts.now - RUNTIME_AUTOFIX_LOOKBACK_MS;
  const clean = opts.lastCleanBrowserCheckAt;
  return clean != null && Number.isFinite(clean) ? Math.max(fixed, clean) : fixed;
}

/**
 * 🔴 A LOGGED-OUT PAGE BEING TOLD "NOT LOGGED IN" IS NOT A RENDER FAILURE (build d62bf22d, 2026-10-17).
 *
 * An imported app (Mitrify) booted cleanly — db:push ok, Express serving, 1,594 CSS rules, 19 styled
 * buttons on screen — and was recorded PREVIEW_NOT_RENDERED → OUTCOME_PREVIEW_FAILED, gate RED, ₹0.
 * The only evidence against it was ONE console line:
 *
 *     Failed to load resource: the server responded with a status of 401 (Unauthorized)
 *
 * That is Chromium's URL-less echo of an auth probe (`/api/auth/me`-style) answering a visitor who is
 * not signed in — which every render check is, because our browser never signs in. A 401/403 is the
 * app's server WORKING: it answered, and it answered correctly.
 *
 * Precise on purpose:
 *   • only 401 and 403, never 404/5xx (a missing asset or a crashing server stays evidence);
 *   • only the response-status echo — an uncaught error, a thrown fetch, a React crash still count;
 *   • it removes CONSOLE evidence only. If a refused request really kept the app from painting, the
 *     DOM verdict says "not rendered" on its own, exactly as it would with no console at all.
 */
export const AUTH_REFUSAL_ECHO_RE = /Failed to load resource: the server responded with a status of 40[13]\b/i;

/** True when a console line is only a 401/403 response echo. PURE. */
export function isAuthRefusalEcho(text: unknown): boolean {
  return AUTH_REFUSAL_ECHO_RE.test(String(text ?? ''));
}

/** Split render-check console lines into the ones that may judge the render and the 401/403 echoes. PURE. */
export function splitAuthRefusals(lines: readonly string[]): { kept: string[]; authRefusals: string[] } {
  const kept: string[] = [];
  const authRefusals: string[] = [];
  for (const l of Array.isArray(lines) ? lines : []) (isAuthRefusalEcho(l) ? authRefusals : kept).push(l);
  return { kept, authRefusals };
}

/**
 * 🔴 A MISSING STATIC ASSET IS NOT A RENDER FAILURE (build 19e5f6fb "Sonu online clases", 2026-10-18).
 *
 * The app rendered in a real browser at 551 s (PROD_BUILD_OK, typecheck clean, screenshot fine). Then
 * the production-defaults pass wrote index.html tags (manifest / icon / sw.js registration) and its
 * public/ files, and the next render check saw ONE console line:
 *
 *     Failed to load resource: the server responded with a status of 404 (Not Found)
 *
 * Every render check requires `consoleErrs.length === 0` (routes/agentv3.ts verify loop, render rescue,
 * last-chance proof), so that one line made a visibly rendered app PREVIEW_NOT_RENDERED →
 * OUTCOME_PREVIEW_FAILED → gate RED → ₹0. A repair could not fix it: the app code was never wrong.
 *
 * A 404 *response echo* is Chromium's report that some sub-resource (favicon, manifest, icon, font,
 * image, service worker) was not there. It cannot by itself stop a page from painting — a missing JS
 * module or a crash shows up as its own error, and if the page really did not paint the DOM verdict says
 * "not rendered" on its own. So the echo is dropped from the RENDER verdict only when it is:
 *   • URL-less (Chromium's usual form — it cannot be tied to app code), or
 *   • names a static asset (icon / manifest / sw.js / font / image / robots / css map).
 * A 404 naming a .js/.ts/.tsx module, every 5xx, uncaught errors and thrown fetches still count.
 *
 * `AGENTV3_ASSET_404_IGNORE=off` restores the old behaviour without a deploy.
 */
export const RESOURCE_404_ECHO_RE = /Failed to load resource: the server responded with a status of 404\b/i;
export const STATIC_ASSET_URL_RE =
  /(?:favicon[^\s]*|\/sw\.js|service-?worker\.js|manifest(?:\.webmanifest|\.json)|\.(?:ico|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|eot|webmanifest|map|txt|mp3|mp4|webm))(?:[?#][^\s]*)?(?:\s|$|\)|,)/i;
const MODULE_URL_RE = /https?:\/\/\S+\.(?:m?[jt]sx?|vue|svelte)(?:[?#]\S*)?/i;

function asset404IgnoreEnabled(): boolean {
  return (process.env['AGENTV3_ASSET_404_IGNORE'] ?? '').trim().toLowerCase() !== 'off';
}

/** True when a console line is only a 404 for a static asset (or a URL-less 404 echo). PURE. */
export function isStaticAssetMiss(text: unknown): boolean {
  const t = String(text ?? '');
  const is404Echo = RESOURCE_404_ECHO_RE.test(t) || /\b404\b.*\(Not Found\)/i.test(t) && /Failed to load resource/i.test(t);
  if (!is404Echo) return false;
  if (STATIC_ASSET_URL_RE.test(t + ' ')) return true; // icon / manifest / sw.js / font / image
  if (MODULE_URL_RE.test(t)) return false;               // a missing code module is real evidence
  return !/https?:\/\/|\s\/[\w.-]/.test(t);          // URL-less echo: cannot be tied to app code
}

/** Split render-check console lines into judging lines and static-asset 404 echoes. PURE. */
export function splitAssetMisses(lines: readonly string[]): { kept: string[]; assetMisses: string[] } {
  const kept: string[] = [];
  const assetMisses: string[] = [];
  const on = asset404IgnoreEnabled();
  for (const l of Array.isArray(lines) ? lines : []) (on && isStaticAssetMiss(l) ? assetMisses : kept).push(l);
  return { kept, assetMisses };
}
