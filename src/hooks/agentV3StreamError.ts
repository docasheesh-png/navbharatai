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
