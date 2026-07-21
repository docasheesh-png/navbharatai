// AgentV3 — per-path write lock (AP-4 parallel-build safety primitive).
//
// Toward safe frontend↔backend sub-agent PARALLELISM: two writing agents can only run concurrently
// without clobbering if writes to the SAME file path are serialized (there is no other locking layer —
// last writer wins today). This is that missing layer: a per-KEY (path) serializer. Calls with the SAME
// key run strictly one-after-another IN ORDER; calls with DIFFERENT keys run concurrently. A single-writer
// build (today's default) has no key contention, so every `run()` executes immediately — i.e. it is a
// provable no-op until parallelism is actually enabled, which is why it can be wired defensively without
// changing current behavior.
//
// Pure (no I/O, no globals beyond its own Map) and fully unit-testable. Deterministic ordering: the tail
// promise per key is the serialization point; a rejected task never breaks the chain (the next queued task
// for that key still runs), and empty chains are cleaned up so the Map cannot grow unbounded.

export class PathWriteLock {
  /** key → the promise that resolves when the LAST-queued task for that key settles. */
  private tails = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` exclusively for `key`: it starts only after every previously-queued task for the same key has
   * settled, and later same-key tasks wait for it. Different keys never wait on each other. Returns fn's
   * result (or rejects with its error) — an error is isolated to this task and does not stall the key's queue.
   */
  run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Chain AFTER prev regardless of whether prev resolved or rejected (so one failure can't wedge the queue).
    const result = prev.then(() => fn(), () => fn());
    // The new tail settles (ok or error) when THIS task is done — swallow to keep it a pure "barrier".
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    // Clean up once this is the last task for the key (prevents unbounded Map growth).
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** How many keys currently have an in-flight/queued chain (for tests/telemetry). */
  activeKeys(): number {
    return this.tails.size;
  }
}
