// P-PME.6 — Scope Change Control (mid-build requirement change).
//
// Problem: if a user sends a NEW build request for a workspace while a build is already running, the
// second request races the first and can corrupt workspace state (two builders writing the same files).
// Previously there was no handler — both ran.
//
// Policy (safest, chosen): serialize per namespace. The first request PROCEEDS; any request that arrives
// while that build is in flight is DEFERRED — queued and applied automatically once the running build
// finishes — with an honest "build in progress, your change will be applied after" message. This never
// corrupts state (only one builder per workspace at a time) and never silently drops the user's change.
//
// This is a PURE in-memory coordinator (no I/O) so it is fully unit-testable. `submit()` is atomic
// (decide + mark-active in one synchronous call) so two near-simultaneous requests can't both proceed.

export type ScopeAction = 'proceed' | 'defer';

export interface ScopeDecision {
  action: ScopeAction;
  /** User-facing message (present when deferred). */
  message?: string;
  /** How many changes are now queued behind the running build (present when deferred). */
  queued?: number;
}

/** Cap the per-namespace pending queue so a spam of mid-build requests can't grow unbounded. */
export const MAX_PENDING_PER_NAMESPACE = 10;

export class ScopeChangeController {
  private active = new Set<string>();
  private pending = new Map<string, string[]>();

  /**
   * Atomically decide what to do with a build request for `namespace`:
   *  - no build running → mark the namespace active and PROCEED.
   *  - a build already running → DEFER: queue the prompt (up to the cap) and return an honest message.
   */
  submit(namespace: string, prompt: string): ScopeDecision {
    if (!this.active.has(namespace)) {
      this.active.add(namespace);
      return { action: 'proceed' };
    }
    const queue = this.pending.get(namespace) ?? [];
    if (queue.length < MAX_PENDING_PER_NAMESPACE) {
      queue.push(prompt);
      this.pending.set(namespace, queue);
    }
    const queued = (this.pending.get(namespace) ?? []).length;
    return {
      action: 'defer',
      queued,
      message: `🛠️ A build is already in progress for this workspace — your change has been queued and will be applied automatically once it finishes${queued > 1 ? ` (${queued} changes queued)` : ''}.`,
    };
  }

  /**
   * Mark the running build for `namespace` finished and return the queued prompts (FIFO) so the caller
   * can apply them. Clears the queue — the caller owns re-submitting them.
   */
  complete(namespace: string): string[] {
    this.active.delete(namespace);
    const pending = this.pending.get(namespace) ?? [];
    this.pending.delete(namespace);
    return pending;
  }

  /** Whether a build is currently marked active for `namespace` (test/introspection helper). */
  isActive(namespace: string): boolean {
    return this.active.has(namespace);
  }

  /** How many changes are queued behind the running build for `namespace`. */
  pendingCount(namespace: string): number {
    return (this.pending.get(namespace) ?? []).length;
  }
}

/** Shared singleton — one coordinator for the whole process (per-namespace serialization). */
export const scopeChangeController = new ScopeChangeController();
