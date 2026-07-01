// P-ORCH.3 — Saga / compensation for multi-step orchestration.
//
// TransactionCoordinator gives ACID-ish workspace-FILE transactions, but a multi-step pipeline
// (build → deploy → verify) had no saga: if a late step failed, earlier EXTERNAL effects weren't undone
// in order. This is a small, generic saga coordinator — register a compensation as each step's external
// effect lands, and on failure run the compensations in REVERSE (LIFO), best-effort. Pure control-flow
// (no I/O of its own), so it is fully unit-tested and reusable by any orchestrator/deployment flow.

export interface SagaStep<T = unknown> {
  name: string;
  execute: () => Promise<T> | T;
  /** Undo this step's external effect. Receives the step's own result. Best-effort — should not throw. */
  compensate?: (result: T | undefined) => Promise<void> | void;
}

export interface SagaResult {
  ok: boolean;
  completed: string[];
  failedStep?: string;
  error?: string;
  /** Steps whose compensation ran (reverse order) after a failure. */
  compensated: string[];
  compensationErrors: Array<{ step: string; error: string }>;
}

export class Saga {
  private readonly registered: Array<{ name: string; compensate: () => Promise<void> | void }> = [];

  /**
   * Register a compensation for a step whose external effect has ALREADY landed. Call this right after
   * the effect succeeds; on `compensate()` the registered handlers run in reverse (LIFO) order.
   */
  register(name: string, compensate: () => Promise<void> | void): void {
    this.registered.push({ name, compensate });
  }

  /** How many compensations are pending. */
  get size(): number {
    return this.registered.length;
  }

  /** Run all registered compensations in REVERSE order. Best-effort — every handler runs even if one throws. */
  async compensate(): Promise<{ compensated: string[]; compensationErrors: Array<{ step: string; error: string }> }> {
    const compensated: string[] = [];
    const compensationErrors: Array<{ step: string; error: string }> = [];
    for (let i = this.registered.length - 1; i >= 0; i--) {
      const { name, compensate } = this.registered[i];
      try {
        await compensate();
        compensated.push(name);
      } catch (e: any) {
        compensationErrors.push({ step: name, error: e?.message || String(e) });
      }
    }
    this.registered.length = 0;
    return { compensated, compensationErrors };
  }

  /**
   * Run a full list of steps forward; on the FIRST failure, compensate the already-completed steps in
   * reverse and return a structured result. Never throws — the failure is captured in `SagaResult`.
   */
  static async run(steps: Array<SagaStep<any>>): Promise<SagaResult> {
    const completed: string[] = [];
    const done: Array<{ name: string; result: unknown; compensate?: (r: unknown) => Promise<void> | void }> = [];
    for (const step of steps || []) {
      try {
        const result = await step.execute();
        completed.push(step.name);
        done.push({ name: step.name, result, compensate: step.compensate as any });
      } catch (e: any) {
        const compensated: string[] = [];
        const compensationErrors: Array<{ step: string; error: string }> = [];
        for (let i = done.length - 1; i >= 0; i--) {
          const d = done[i];
          if (!d.compensate) continue;
          try {
            await d.compensate(d.result);
            compensated.push(d.name);
          } catch (ce: any) {
            compensationErrors.push({ step: d.name, error: ce?.message || String(ce) });
          }
        }
        return { ok: false, completed, failedStep: step.name, error: e?.message || String(e), compensated, compensationErrors };
      }
    }
    return { ok: true, completed, compensated: [], compensationErrors: [] };
  }
}
