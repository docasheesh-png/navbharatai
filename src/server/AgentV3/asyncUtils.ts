// AgentV3 — small async utilities shared across the build pipeline.
//
// Two primitives the audit found missing in hot paths: bounded-concurrency mapping (so the
// readiness gate reads hundreds of files in parallel batches instead of one slow remote read at a
// time) and a labelled per-operation timeout (so a single stalled actuator/SDK call can't silently
// burn the whole build budget). Pure + dependency-free + fully unit-testable.

/**
 * Run `fn` over every item with at most `limit` promises in flight at once. Order-preserving:
 * `result[i]` corresponds to `items[i]`. A worker that throws rejects the whole call, so callers
 * that must never fail should make `fn` swallow its own errors (return a sentinel) — exactly how
 * the readiness-gate reads use it.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Resolve `p`, or REJECT with a labelled timeout error if it has not settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
