// PREVIEW PERSISTENCE (admin 2026-07-07): the v5.0 preview iframe must survive tab switches and
// collapsing back to chat. Same window semantics as v3SurfaceMount.ts, one level down: the panel's
// right workspace pane and PreviewSurface are hidden with CSS, never unmounted — unmounting tore
// down the iframe, so every Files/Terminal/chat detour destroyed the rendered preview ("preview
// gayab") and forced a full in-browser rebuild on return.
//
// The FIRST mount stays lazy: PreviewSurface auto-resumes sandboxes / compiles the in-browser
// preview on mount, so mounting it for a user who never opens Preview would spend real sandbox/
// compile cost for nothing. Once opened, it never unmounts for the rest of the session.

/** Is the preview pane the visible workspace surface right now? */
export function previewVisible(showWorkspace: boolean, tab: string): boolean {
  return showWorkspace && tab === 'preview';
}

/**
 * Should PreviewSurface be in the tree? True once the preview has EVER been opened this session
 * (keep-alive), or when it is becoming visible for the first time, or when it is being PRE-WARMED
 * (mounted off-screen after a build so opening Preview is instant). Pure + unit-testable.
 */
export function previewMounted(everOpened: boolean, showWorkspace: boolean, tab: string, prewarm = false): boolean {
  return everOpened || prewarm || previewVisible(showWorkspace, tab);
}

/**
 * Should the preview be PRE-WARMED — mounted and compiled OFF-SCREEN before the user ever clicks
 * Preview — so opening it is instant instead of a multi-minute cold compile? True once a build is
 * idle (neither the client nor the server build is running) and it produced files. The heavy cost
 * (the in-iframe whole-app transpile) then happens in the background during/after the build; the
 * existing reloadSignal keeps the mounted preview live-synced. Pure + unit-testable.
 */
export function shouldPrewarmPreview(clientBuildRunning: boolean, serverBuildRunning: boolean, hasFiles: boolean): boolean {
  return !clientBuildRunning && !serverBuildRunning && hasFiles;
}

/**
 * Should the Live tab's health watchdog be running right now?
 *
 * ── THE BUG THIS EXISTS FOR (admin 2026-08-17) ──────────────────────────────────────────────────
 * Admin: *"user ne app banaya, preview chala, fir koi aur chat open kar li, preview aise hi chor diya.
 * kya billing me add hota rahega?"* — and the answer was yes, to US.
 *
 * The keep-alive above is deliberate and correct: once opened, the preview pane is hidden with CSS and
 * NEVER unmounted, so a detour to chat does not tear down a rendered preview. But a mounted component
 * keeps its timers. The Live watchdog polls `/api/agentv3/preview-health` every 150s, that route runs a
 * real command inside the sandbox, and any sandbox command refreshes the idle clock.
 *
 * The arithmetic is the whole bug: the watchdog fires every **150s**, the idle sweep pauses a VM after
 * **300s**. The sweep could therefore never win — a Live preview left behind held a billed E2B VM
 * (~₹7/hour, measured) until the browser tab itself was closed. The user was not charged for it, because
 * sandbox billing is capped at the build's own duration, so NavBharatAI absorbed 100% of it.
 *
 * `probeAndMaybeHeal` already refused to run behind a HIDDEN BROWSER TAB. That guard is real but does
 * not cover this case: switching to chat inside NavBharatAI leaves `document.visibilityState` at
 * 'visible' while the pane sits at `display:none`. The missing fact — is this pane actually the surface
 * on screen? — was already being computed one line away for the CSS class, and simply never reached the
 * watchdog.
 *
 * PURE, so the rule is tested rather than trusted.
 */
export function shouldWatchLivePreview(o: {
  /** The panel is idle — the build is not driving the preview itself. */
  autoResume: boolean;
  /** 'live' is the only mode with a sandbox behind it; 'inbrowser' costs nothing and needs no watching. */
  mode: string;
  hasWorkspace: boolean;
  /** Is this pane the visible surface INSIDE the app? (previewVisible, threaded down.) */
  paneVisible: boolean;
  /** Is the browser tab itself hidden/backgrounded? */
  documentHidden: boolean;
}): boolean {
  return !!o.autoResume && o.mode === 'live' && !!o.hasWorkspace && !!o.paneVisible && !o.documentHidden;
}

/** Tailwind class for the keep-alive wrapper: hidden (display:none) keeps the iframe alive off-screen. */
export function previewWrapClass(showWorkspace: boolean, tab: string): string {
  return `flex-1 min-h-0 ${previewVisible(showWorkspace, tab) ? '' : 'hidden'}`;
}
