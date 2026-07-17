// AgentV3 — client-driven queue EXECUTOR decision (FIX #4.3).
//
// The serial executor is client-driven (admin choice A): while a v5.0 chat is open, whenever a build
// SETTLES and the app is idle, the client claims the next queued command and auto-submits it — so a
// user's queued roadmap (or the planner/advisor chats' enqueued work) runs one step at a time,
// hands-free. Closing the tab simply PAUSES the queue; it resumes on reopen (nothing is lost).
//
// This is the PURE decision the effect wires in, so the "when do we run the next item?" rule is
// unit-tested and can never drift into a double-submit or an infinite loop.

export interface RunNextInput {
  /** A build is currently running locally (never claim a second — the serial one-writer invariant). */
  running: boolean;
  /** The last build reached a terminal state (its `result`/`done` arrived) — safe to chain the next. */
  buildSettled: boolean;
  /** A plan/permission gate is open and awaiting the user — do NOT auto-advance past it. */
  pendingGate: boolean;
  /** The last build surfaced an error — PAUSE the queue (honest: the user decides retry/skip/stop). */
  hasError: boolean;
  /** True while a claim/submit is already in flight (guards against re-entrancy from rapid re-renders). */
  claimInFlight: boolean;
}

/**
 * Whether the client should now claim + run the next queued command. True ONLY when the app is fully
 * idle after a settled build, no gate is open, the last build did not error, and no claim is already
 * in flight. Pure — every guard is explicit so the executor can never double-submit or loop.
 */
export function shouldRunNextQueued(i: RunNextInput): boolean {
  if (i.running) return false;        // a build is live — one writer per app
  if (i.claimInFlight) return false;  // a claim/submit is already happening
  if (i.pendingGate) return false;    // waiting on the user's approval
  if (i.hasError) return false;       // pause the queue on a failure — never auto-chain past an error
  return i.buildSettled;              // only advance once the previous build has truly settled
}
