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
  if (s.alreadyFailedOver) return false;
  if (s.userPickedInBrowser) return false;
  return true;
}

/**
 * The honest one-line note shown after an automatic failover. It must state WHAT happened and WHY, so
 * the switch never looks like a glitch — the user's app is fine, our in-browser renderer was not.
 * White-Label Law: names no vendor/CDN, only what the user actually experiences.
 */
export function liveFailoverNotice(): string {
  return 'The in-browser preview could not load this app’s packages, so I switched you to the live server — that is your app really running.';
}
