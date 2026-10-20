import type { RunningBuild } from './runningBuildRegistry';

/** A terminal response asks the body to stop; it does not establish that the body has exited. */
export function retainBuildUntilBodyExit(
  key: string, build: RunningBuild, stopping: Map<string, RunningBuild>, nowMs: number = Date.now(),
): void {
  if (build.exited) return;
  build.requiresBodyExit = true;
  build.stoppedAt ??= nowMs;
  const current = stopping.get(key);
  if (!current || current === build) stopping.set(key, build);
}

/** Close only this captured stream/registry entry, retaining its independent body-exit hold. */
export function closeDeadlineBuildStream(
  key: string, build: RunningBuild, running: Map<string, RunningBuild>, end: (build: RunningBuild) => void,
): void {
  if (running.get(key) === build) running.delete(key);
  end(build);
}

/** The timer and the actual finally must join the same finalizer, including its persistence work. */
export function createBuildDeadlineFinalization(opts: {
  build: { ended: boolean }; begin: () => void; finalize: () => Promise<void>; close: () => void;
}) {
  let pending: Promise<void> | undefined;
  const join = async (): Promise<void> => { if (pending) await Promise.allSettled([pending]); };
  return {
    run(): Promise<void> {
      if (pending) return pending;
      if (opts.build.ended) return Promise.resolve();
      pending = Promise.resolve().then(opts.finalize).finally(opts.close);
      // setTimeout does not consume a returned promise. The real finally still joins this failure.
      void pending.catch(() => {});
      opts.begin();
      return pending;
    },
    join,
  };
}

export type BuildDeadlineFinalization = ReturnType<typeof createBuildDeadlineFinalization>;

export async function joinBuildDeadlineFinalization(finalization: BuildDeadlineFinalization | undefined): Promise<void> {
  await finalization?.join();
}

// Keep the established message module as the single source for observed progress and retry wording.
export { deadlinePauseMessage as deadlineBodyExitMessage } from './DeadlinePause';
