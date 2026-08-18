// AgentV3 — FAILOVER from a broken in-browser preview to the WORKING live server.
//
// ROOT CAUSE (admin report 2026-08-02, buildId 858f6d7b — "choti moti apps bhi nahi ban rahi"): a
// to-do app built successfully, `npm run dev` returned exit 0, the sandbox published
// https://5173-….e2b.app, and the engine verified in a real browser that it "renders correctly". The
// app was fine. But the Preview tab defaults to "In-browser" (A4 — the live URL dies on sandbox
// idle/recycle, so the deterministic in-browser render is the safer default), and the in-browser path
// resolves npm packages from a public CDN. esm.sh was unreachable from the user's browser, so the
// srcdoc iframe painted a red wall:
//     Could not load "react-dom/client" … Failed to fetch dynamically imported module: esm.sh/…
// The failure was reported up via postMessage and recorded into diagnostics — and then NOTHING acted
// on it. A perfectly working preview sat one unclicked button away while the user concluded the
// builder was broken.
//
// A4's default is still right (an ephemeral URL must not be the first thing a user depends on), so the
// fix is not "always start on live" — it is: the in-browser preview is never allowed to be a DEAD END
// when a live server exists. On a real in-browser failure we fail over to the live server, once, and
// say so honestly. PURE + unit-tested; the impure listener/effect lives in PreviewSurface.

export interface LiveFailoverSignals {
  /** The active preview mode — only an in-browser failure can fail over. */
  mode: 'live' | 'inbrowser';
  /** A live preview URL exists (this session's `url` or one recovered by Diagnose). */
  hasLiveUrl: boolean;
  /**
   * The server's REAL health verdict for that URL — `true` only when something is genuinely serving
   * there. `null` means the probe has not answered yet (never assume either way from silence).
   *
   * ROOT CAUSE (admin report 2026-08-13, build 79d0e3a4). The first version of this module gated the
   * failover on `hasLiveUrl` alone, and a preview URL is PERMANENT while the service behind it is
   * EPHEMERAL. So a broken in-browser preview handed the user to a live server that was serving
   * nothing — "Closed Port Error … Connection refused on port 3000" — while the notice claimed "that
   * is your app really running". The build's own release gate had already recorded "no live preview
   * was ever available": the system knew, and this screen contradicted it.
   *
   * Worse, that exact mistake was already written down in this codebase. `previewAutoReboot.ts` says:
   * "URL presence was being used as liveness. Liveness must come from the server's REAL health probe."
   * This field is that lesson applied here, where it should have been from the start.
   */
  liveHealthy: boolean | null;
  /** Which surface reported the error. A live-server error must never bounce back to live. */
  errorSource: 'in-browser' | 'live';
  /** The once-per-workspace guard — a failover must never fight the user or loop. */
  alreadyFailedOver: boolean;
  /**
   * The user explicitly chose In-browser after the preview loaded. Their choice wins over ours: we
   * still surface the error, we just don't yank the view out from under them.
   */
  userPickedInBrowser: boolean;
}

/**
 * TRUE when a broken in-browser preview should switch itself to the running live server.
 *
 * Deliberately conservative — every guard exists because the alternative is worse than the red wall:
 * failing over from `live` would ping-pong between two broken surfaces, failing over twice would loop,
 * and overriding an explicit user choice would make the toggle feel haunted.
 */
export function shouldFailoverToLive(s: LiveFailoverSignals): boolean {
  if (s.mode !== 'inbrowser') return false;
  if (s.errorSource !== 'in-browser') return false;
  if (!s.hasLiveUrl) return false;
  // A URL is not a running service. Move the user only when the server has CONFIRMED something is
  // serving there — an unanswered probe (null) is not a yes, and moving them to a second broken view
  // is worse than leaving them on the first, because it also costs them their trust in the switch.
  if (s.liveHealthy !== true) return false;
  if (s.alreadyFailedOver) return false;
  if (s.userPickedInBrowser) return false;
  return true;
}

/**
 * What to say when the in-browser preview failed and the live server CANNOT rescue it.
 *
 * The alternative — staying silent — leaves the user staring at a red wall with no idea whether
 * anything is wrong on our side or theirs. This states both facts plainly and points at the one action
 * that actually helps, without claiming anything that has not been verified.
 */
export function noLiveRescueNotice(): string {
  // WORDING FIXED 2026-08-17 along with the bug that made this line nearly unreachable. It used to end
  // "— nothing here means your files are lost", which parses as "there is nothing here, which means
  // your files are lost" — the exact opposite of the reassurance intended. It could stay unnoticed
  // while almost nobody saw it; now that the no-live case actually reaches it, it has to be right.
  return 'The in-browser preview could not load this app’s packages, and the live server is not running. Tap Diagnose to start it — none of this means your files are lost.';
}

/**
 * What to DO when the in-browser preview reports an error. One decision, so the caller cannot grow a
 * second, subtly different copy of it.
 *
 * ── THE BUG THIS EXISTS FOR (admin 2026-08-17) ──────────────────────────────────────────────────
 * Admin: *"jab koi user in-browser preview wali app ko 3 din baad open karta hai to preview chalta hi
 * nahi hai, e2b me chalta hai."*
 *
 * The rescue was gated on a live URL ALREADY EXISTING. That hid the failure behind a clock:
 *
 *   • **Right after a build** the sandbox is warm and the build has emitted a live URL. A broken
 *     in-browser preview failed over to it and the user saw their app. Everything looked fine.
 *   • **Days later** the sandbox has long been paused and there is no live URL, so the entire rescue
 *     block was skipped — no failover, and, worse, NOT EVEN THE NOTICE. The user got a blank or broken
 *     preview and no explanation, while the Diagnose button one tap away would have started a live
 *     server and worked.
 *
 * The giveaway that this was an oversight rather than a policy: `noLiveRescueNotice` was already
 * written FOR this exact case — it says the live server is not running and to tap Diagnose — and the
 * guard made it unreachable in precisely the situation it describes.
 *
 * 'check-live' means "a URL exists, go probe it and maybe fail over"; 'tell-user' means "there is
 * nothing to fail over to, so say so"; 'none' means stay quiet. PURE.
 */
export function rescueActionForPreviewError(s: {
  mode: string;
  errorSource: 'in-browser' | 'live';
  hasLiveUrl: boolean;
  alreadyFailedOver: boolean;
  userPickedInBrowser: boolean;
}): 'check-live' | 'tell-user' | 'none' {
  // A live-server error must never bounce back to live, and an error from a surface the user is not
  // looking at is not theirs to be interrupted by.
  if (s.mode !== 'inbrowser' || s.errorSource !== 'in-browser') return 'none';
  // Their explicit choice wins over ours — but they still deserve to know why the view is broken, so
  // this is 'tell-user', not 'none'. Being silent was the whole bug.
  if (s.userPickedInBrowser) return 'tell-user';
  if (!s.hasLiveUrl) return 'tell-user';
  if (s.alreadyFailedOver) return 'tell-user';
  return 'check-live';
}

/**
 * The honest one-line note shown after an automatic failover. It must state WHAT happened and WHY, so
 * the switch never looks like a glitch — the user's app is fine, our in-browser renderer was not.
 * White-Label Law: names no vendor/CDN, only what the user actually experiences.
 */
export function liveFailoverNotice(): string {
  return 'The in-browser preview could not load this app’s packages, so I switched you to the live server — that is your app really running.';
}
