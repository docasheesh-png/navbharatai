// AgentV3 approvals registry (P4 — plan mode + permission prompts).
//
// The build streams events out over a long-lived NDJSON response; the user
// responds via a separate POST /api/agentv3/respond request. This module is the
// in-memory bridge between the two: the build awaits a promise keyed by a
// requestId, and the respond endpoint resolves it. Real gating — the build
// genuinely blocks until the user answers (or a timeout denies it).

interface Pending {
  resolve: (approved: boolean) => void;
}

const pending = new Map<string, Pending>();

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes, then auto-deny.

/** Wait for the user's approval of `requestId`. Resolves false on timeout. */
export function awaitApproval(requestId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(false);
    }, timeoutMs);
    pending.set(requestId, {
      resolve: (approved: boolean) => {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(approved);
      },
    });
  });
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
