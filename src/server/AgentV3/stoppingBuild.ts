// A STOPPED BUILD HOLDS ITS WORKSPACE UNTIL IT HAS ACTUALLY EXITED (autopsy 1219c639, 2026-10-01).
//
// Stop used to free the workspace the instant it was pressed: the build's signal fired, its streams were
// closed, and both locks — this instance's memory and the cross-instance lease — were released at once. But
// a signal only ASKS the build to stop. That build was sitting in a ten-minute wait for a key the user did
// not have; the wait did not listen to the signal, so the build body lived on. The user, shown "This build
// didn't finish", pressed "Continue building", and a second build started in the same app beside the first.
// Five minutes later the first one woke up and ran `npm install express openai …` into the app the second
// was writing (the second build's report then found `package.json` saved differently from what was running).
// And when the first build finally exited, its cleanup released the lock — the second build's lock, since
// both used the same key.
//
// The waits now listen to the signal (Approvals.ts), so a stopped build normally exits within moments. This
// module is the guarantee for the cases that do not: a new build in the same workspace waits briefly for the
// stopped one to finish leaving, is refused honestly if it has not, and is let through only once a stopped
// build has been stuck far longer than any of its steps can run. PURE decisions + a tiny wait helper.

/** How long a new build waits for a stopped build in its workspace to finish exiting before answering. */
export const STOP_DRAIN_WAIT_MS = 15_000;

/**
 * After this long a stopped build that has still not exited is treated as stuck, and its workspace is
 * reclaimed. Longer than any single step a build takes after a Stop (a command in flight is bounded by the
 * tool timeout), short enough that a stuck body can never lock a user out of their own app for long.
 */
export const STOP_DRAIN_MAX_MS = 3 * 60_000;

export const BUILD_STILL_STOPPING_CODE = 'BUILD_STILL_STOPPING';
export const BUILD_STILL_STOPPING_MESSAGE = 'Your previous build is still stopping — give it a few seconds, then send your message again.';

/** The slice of a running build this needs. */
export interface StoppingBuild {
  /** True once the build's own code has finished — not merely been asked to stop. */
  exited?: boolean;
  /** When Stop was pressed. */
  stoppedAt?: number;
  /** Callbacks to run once the build exits. */
  exitWaiters?: Array<() => void>;
}

export type StoppedBuildGate = 'proceed' | 'refuse' | 'reclaim';

/**
 * May a new build start in a workspace where a build was stopped?
 * - none stopped, or the stopped one has exited ⇒ `proceed`;
 * - it is still leaving, and has not been stuck for `maxMs` ⇒ `refuse` (an honest "still stopping");
 * - it has been stuck past `maxMs` ⇒ `reclaim` (a stuck body must never lock a user out).
 * PURE.
 */
export function stoppedBuildGate(entry: StoppingBuild | null | undefined, nowMs: number, maxMs: number = STOP_DRAIN_MAX_MS): StoppedBuildGate {
  if (!entry || entry.exited === true) return 'proceed';
  const stoppedAt = Number(entry.stoppedAt);
  if (!Number.isFinite(stoppedAt)) return 'reclaim';
  return nowMs - stoppedAt >= maxMs ? 'reclaim' : 'refuse';
}

/** Mark a build as exited and wake everyone waiting for it. Idempotent. */
export function markBuildExited(entry: StoppingBuild): void {
  if (entry.exited === true) return;
  entry.exited = true;
  const waiters = entry.exitWaiters ?? [];
  entry.exitWaiters = [];
  for (const w of waiters) { try { w(); } catch { /* a waiter must never break the exit */ } }
}

/** Wait up to `ms` for a build to exit. Resolves true if it did. */
export function waitForBuildExit(entry: StoppingBuild, ms: number = STOP_DRAIN_WAIT_MS): Promise<boolean> {
  if (entry.exited === true) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean): void => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => finish(entry.exited === true), Math.max(0, ms));
    (entry.exitWaiters ??= []).push(() => finish(true));
  });
}
