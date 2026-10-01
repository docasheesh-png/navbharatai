// AgentV3 approvals registry (P4 — plan mode + permission prompts).
//
// The build streams events out over a long-lived NDJSON response; the user
// responds via a separate POST /api/agentv3/respond request. This module is the
// in-memory bridge between the two: the build awaits a promise keyed by a
// requestId, and the respond endpoint resolves it. Real gating — the build
// genuinely blocks until the user answers (or a timeout denies it).
//
// 🔴 A WAIT FOR THE USER MUST END WHEN THE BUILD ENDS (autopsy 1219c639, 2026-10-01). This wait used to
// know nothing about the build it belonged to. A user who did not have the Perplexity key the build asked
// for pressed Stop; the build's signal fired, and this promise kept waiting for its full ten minutes. The
// server had already freed the workspace for the next build, so "Continue building" started a second build
// beside the first. When the ten minutes ran out, the stopped build woke up, told the user "Skipped for
// now" (they had skipped nothing) and ran `npm install express openai …` into the app the second build was
// writing. A wait is now given the build's signal and ends the moment it fires, and its OUTCOME says which
// of the four things happened, so nobody downstream has to guess from a bare `false`.

interface Pending {
  resolve: (approved: boolean) => void;
}

const pending = new Map<string, Pending>();

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes, then auto-deny.

/** How a wait for the user ended. Only `approved` means yes. */
export type ApprovalOutcome = 'approved' | 'denied' | 'timed-out' | 'stopped';

export interface ApprovalWaitOptions {
  timeoutMs?: number;
  /** The build's stop signal. When it fires the wait ends at once with `stopped`. */
  signal?: AbortSignal;
}

/**
 * Wait for the user's answer to `requestId`, and say how the wait ended. A signal that has already fired
 * ends the wait before it starts — the request is never left registered.
 */
export function awaitApprovalOutcome(requestId: string, opts: ApprovalWaitOptions = {}): Promise<ApprovalOutcome> {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) > 0 ? (opts.timeoutMs as number) : DEFAULT_TIMEOUT_MS;
  const signal = opts.signal;
  if (signal?.aborted) return Promise.resolve('stopped');
  return new Promise<ApprovalOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ApprovalOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (pending.get(requestId) === entry) pending.delete(requestId);
      resolve(outcome);
    };
    const onAbort = (): void => finish('stopped');
    const timer = setTimeout(() => finish('timed-out'), timeoutMs);
    const entry: Pending = { resolve: (approved: boolean) => finish(approved ? 'approved' : 'denied') };
    pending.set(requestId, entry);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Wait for the user's approval of `requestId`. Resolves false on denial, timeout or stop. */
export function awaitApproval(requestId: string, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<boolean> {
  return awaitApprovalOutcome(requestId, { timeoutMs, signal }).then((o) => o === 'approved');
}

/** Resolve a pending approval. Returns false if no such request is waiting. */
export function resolveApproval(requestId: string, approved: boolean): boolean {
  const p = pending.get(requestId);
  if (!p) return false;
  p.resolve(approved);
  return true;
}

/** Number of approvals currently awaiting a response (tests/observability). */
export function pendingApprovalCount(): number {
  return pending.size;
}
