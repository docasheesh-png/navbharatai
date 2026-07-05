// AgentV3 build stream — the ONE decision for "is this stream error a real build failure the
// user must see?". Extracted as a pure function so both stream consumers (start()'s inline reader
// and resume()/pumpStream()) share ONE rule and can never drift, and so it is unit-testable in the
// node test env (the hook itself needs a DOM to render).
//
// ROOT CAUSE it fixes (2026-07-04, admin's imported-GitHub-app report — "network error after ✓ Done
// · 24 steps"): a v3.0 build emits its terminal `result` ("✓ Done · N steps"), and THEN the server
// holds the stream open for up to ~6 min of post-result work — a heavy import's local-Postgres
// provision + `npm install` + dev-server boot (see the `finally` in routes/agentv3.ts, which awaits
// `importPreviewBoot` AFTER the result is emitted, before `endBuild`). If the connection is severed
// during that window — a mobile blip, or Cloud Run's request timeout on the long-open stream — the
// reader throws. The old code surfaced that raw throw as a "network error" banner, making a build
// that had ALREADY SUCCEEDED look broken. A stream error after the terminal `result` is never a
// build failure: the result is in, and the post-result tail (import preview boot) is best-effort.

export interface StreamErrorContext {
  /** The fetch/stream throw was an intentional AbortError (stop, or navigate-away). */
  isAbort: boolean;
  /** The user navigated to another session while this stream was unwinding. */
  isStale: boolean;
  /** A terminal `result` event already arrived for this build (it succeeded / finished). */
  sawResult: boolean;
  /** We transparently re-attached to the still-running build — nothing actually failed. */
  reconnected: boolean;
}

/**
 * True ONLY when a stream error represents a genuine, user-visible build failure.
 *
 * False for: an intentional abort, a stale (abandoned) build the user left, a successful
 * transparent reconnect, or — the fix — ANY drop that happens AFTER the build's terminal
 * `result` already arrived. Pure + exported for unit testing.
 */
export function shouldSurfaceStreamError(ctx: StreamErrorContext): boolean {
  if (ctx.isAbort) return false;
  if (ctx.isStale) return false;
  if (ctx.reconnected) return false;
  if (ctx.sawResult) return false;
  return true;
}

// ── Reconnect (/attach) outcome — the ONE decision for what a re-attach RESULT means ────────────
//
// ROOT CAUSE it fixes (2026-07-05, admin's "internet off 30s → load fail → retry" report, IMG_5709):
// on a network drop the client took the 409-resumable path and OPTIMISTICALLY printed
// "Your build … was still running — I re-attached to it live below" BEFORE /attach had confirmed a
// live build. /attach then 404'd ("No running build to resume.") because the build had already ended
// (finished, or was torn down when the connection dropped) — an inherent race: /chat's 409 check and
// the separate /attach call are not atomic, so the build can end between them. The user saw TWO
// contradictory messages: "re-attached live" AND "no running build". The fix is honesty timing: the
// optimistic re-attach notice is emitted ONLY on a confirmed-live attach; a 404 is the authoritative,
// truthful final state and is presented calmly (never a red error, never paired with the promise).
//
// The four outcomes, decided purely from the attach response + whether a terminal result was already
// seen, so the hook can render exactly one coherent state:
export type ReconnectOutcome =
  /** Attach returned a live stream → replay it and (only now) show the "re-attached" notice. */
  | 'live'
  /** Build is gone AND its result was already seen → benign tail close; say nothing, just clean up. */
  | 'gone-silent'
  /** Build is gone mid-run (the drop ended it) → one honest "your files are safe, send again" line. */
  | 'gone-notice'
  /** An unexpected, non-404 failure (e.g. 5xx) → surface it honestly as an error. */
  | 'error';

/**
 * Classify a /attach reconnect result. Pure + exported for unit testing.
 * - ok            → 'live'
 * - 404 (no build) → 'gone-silent' if the build's result was already seen, else 'gone-notice'
 * - any other non-ok → 'error'
 * A 404 is NEVER an error here: it is the truthful "that build isn't running anymore", which the
 * caller shows without contradicting an earlier (now-suppressed) "re-attached live" promise.
 */
export function reconnectOutcome(input: { ok: boolean; status: number; resultAlreadySeen: boolean }): ReconnectOutcome {
  if (input.ok) return 'live';
  if (input.status === 404) return input.resultAlreadySeen ? 'gone-silent' : 'gone-notice';
  return 'error';
}
