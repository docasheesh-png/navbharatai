// AgentV3 — what a pressed Stop means to code that is WAITING (autopsy 2720e553, 2026-09-27).
//
// 🔴 THE BUG THIS CLOSES. The Stop button, Unsend and a lease stop all end in `abortBuild(…, 'user-stop')`,
// which aborts the build's signal. The agentic loop read that signal only BETWEEN turns, and the fast
// lane — the path most small apps take — never read it at all. So a user who pressed Stop watched a
// build that had "stopped" keep calling models, keep repairing, keep starting a dev server, and the
// report recorded the stop only when the lane ran out of things to do: in that build, 143 ms after
// the preview address was published, 13.7 minutes in. Everything after the press was paid for —
// by the user at real cost, or by NavBharatAI on the free tier.
//
// 🔑 ONE ERROR, ONE MEANING. A stop is not a provider failure, not a timeout and not our budget
// ending. The provider chain must not bench a vendor for it, must not fall to the next rung for it,
// and must not count it as wasted provider time. `BuildStoppedError` is recognised by all of those
// before any of their own classification runs.
//
// PURE apart from the listener it registers, which every helper removes again: an AbortSignal lives
// for the whole build, and a listener left behind per model call is a leak Node warns about by the
// eleventh.

/** The wording every stopped wait reports. Deliberately names no provider — none failed. */
export const BUILD_STOPPED_MESSAGE = 'Stopped — the build was asked to stop. No provider failed.';

/** Thrown by any wait the build's own signal ended. */
export class BuildStoppedError extends Error {
  readonly buildStopped = true;
  constructor() {
    super(BUILD_STOPPED_MESSAGE);
    this.name = 'BuildStoppedError';
  }
}

/** Did this error come from a stop, rather than from anything that went wrong? */
export function isBuildStoppedError(err: unknown): boolean {
  if (err instanceof BuildStoppedError) return true;
  if (err && typeof err === 'object' && (err as { buildStopped?: unknown }).buildStopped === true) return true;
  return err instanceof Error && err.message === BUILD_STOPPED_MESSAGE;
}

/** Throw before starting work the build no longer wants. A missing signal never stops anything. */
export function throwIfStopped(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new BuildStoppedError();
}

/**
 * Run `cb` once when the signal aborts (at once if it already has). Returns the unsubscribe, which the
 * caller must call when it stops waiting — see the leak note at the top.
 */
export function onStop(signal: AbortSignal | null | undefined, cb: () => void): () => void {
  if (!signal) return () => { /* nothing registered */ };
  if (signal.aborted) {
    cb();
    return () => { /* already fired */ };
  }
  const listener = () => cb();
  signal.addEventListener('abort', listener, { once: true });
  return () => signal.removeEventListener('abort', listener);
}

/**
 * Wait for `work`, unless the build is stopped first — then reject with `BuildStoppedError` at once.
 *
 * Racing stops the WAITING; it cannot stop a call that has no cancel handle. `onLate` is handed the
 * value if the work finishes after the stop, so a caller holding something cancellable (a stream) can
 * close it; a late rejection is swallowed, because nobody is reading it any more.
 */
export function raceStop<T>(
  work: Promise<T>,
  signal?: AbortSignal | null,
  onLate?: (value: T) => void,
): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.then((v) => { try { onLate?.(v); } catch { /* best-effort */ } }, () => { /* abandoned */ });
    return Promise.reject(new BuildStoppedError());
  }
  return new Promise<T>((resolve, reject) => {
    let stopped = false;
    const off = onStop(signal, () => {
      stopped = true;
      reject(new BuildStoppedError());
    });
    work.then(
      (v) => {
        off();
        if (stopped) { try { onLate?.(v); } catch { /* best-effort */ } return; }
        resolve(v);
      },
      (e) => {
        off();
        if (!stopped) reject(e);
      },
    );
  });
}

/**
 * A runner whose every call carries the build's stop signal unless the caller passed its own.
 *
 * WHY AT THE FACTORY, NOT THE CALL SITE: the route has a dozen direct `runTurn` calls (planners,
 * post-build repairs, the fast lane), and a signal threaded by hand reaches only the ones somebody
 * remembered. Wrapping the factory makes the next call site correct without anyone remembering.
 */
export function withStopSignal<R extends { runTurn(params: P): Promise<T> }, P extends { signal?: AbortSignal }, T>(
  runner: R,
  signal: AbortSignal | null | undefined,
): R {
  if (!signal) return runner;
  return {
    ...runner,
    runTurn: (params: P) => runner.runTurn({ ...params, signal: params.signal ?? signal }),
  } as R;
}
