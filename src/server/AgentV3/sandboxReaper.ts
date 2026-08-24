// Which abandoned sandboxes to pause — the DURABLE half of the idle sweep (admin 2026-07-28).
//
// THE LEAK THIS CLOSES. E2BActuator already pauses idle sandboxes, but it sweeps `this.sandboxes` —
// an IN-MEMORY map on one Cloud Run instance. Cloud Run runs several instances and recycles them, and
// NavBharatAI redeploys on every merge to main. The moment the instance that created a sandbox goes
// away, the replacement's map is empty, so the sweep can no longer see that sandbox and nothing pauses
// it. It then bills compute until E2B's own 60-minute lifetime expires. Every deploy orphans whatever
// was running at the time, and on a busy day that is most of them.
//
// So the reaper here works from the DURABLE record (`agentv3_sandboxes`, already written for warm
// resume) instead of from process memory. A sandbox is visible to it no matter which instance made it,
// or whether that instance still exists.
//
// THE DANGER, AND WHY THE THRESHOLD IS GENEROUS. Pausing a sandbox that a build is actively using would
// break that build — the one thing that must never happen. The durable record's `updatedAt` is stamped
// when a build takes the sandbox and again when it finishes, so a LIVE build always has a fresh stamp.
// The reaper's cut-off is nonetheless held clear of the longest a build may legally run
// (AGENTV3_MAX_BUILD_SECONDS) plus a wide margin, so even a build that somehow stopped refreshing its
// stamp finishes untouched. The in-memory sweep stays as the precise, fast path on the owning instance;
// this is the safety net beneath it, and it errs entirely on the side of letting a VM live.
//
// Pure — the caller supplies the records and `now`, and performs the pausing.

/** The shape the reaper needs from a durable sandbox record. */
export interface ReapableSandbox {
  workspaceId: string;
  sandboxId: string;
  /** Epoch ms a build last took or released this sandbox. */
  updatedAt: number;
  /**
   * Epoch ms the reaper last paused this sandbox, if ever. A paused sandbox costs no compute, so
   * pausing it again is pointless — and E2B refuses it anyway, which would make the sweep retry the
   * same dead record every two minutes forever. The record is kept (not deleted) because a returning
   * user resumes it by id.
   */
  pausedAt?: number;
}

/** Idle minutes before the in-memory sweep pauses a sandbox it can see. Env-tunable. */
export function idleLimitMs(env: NodeJS.ProcessEnv = process.env): number {
  const mins = Number(env.AGENTV3_SANDBOX_IDLE_MINUTES);
  // 5 minutes (admin decision 2026-08-13, from the measured bill).
  //
  // The history is the argument. It was 45: a typical build takes about five minutes, so that window
  // meant roughly nine times more idle VM than working VM, most of it for someone who had already
  // closed the tab. It went to 15, and the measured month still showed ~315 billed hours of pure idle
  // across 1,260 sandboxes — about 15% of the whole E2B bill. At 5 that falls to ~105 hours.
  //
  // ⚠️ THIS NUMBER IS ONLY SAFE BECAUSE THE SWEEP IS BUILD-AWARE. Idle is measured from the last
  // SANDBOX operation, and a long model call is not one — while the AI thinks, nothing touches the
  // sandbox, and at five minutes that silence would look exactly like an abandoned session. The sweep
  // skips workspaces with a build in flight (E2BActuator.setBuildActive), so it can only ever pause a
  // sandbox nobody is building in. Do NOT lower this further without checking that hold still exists.
  //
  // The accepted trade: a user who returns after six minutes meets a PAUSED sandbox and waits through
  // a resume. Nothing is lost — it resumes by id, with its files — it is slower, not broken.
  return Number.isFinite(mins) && mins > 0 ? Math.floor(mins * 60_000) : 5 * 60_000;
}

/** The longest a build may legally run, in ms — mirrors the route's own watchdog default. */
export function maxBuildMs(env: NodeJS.ProcessEnv = process.env): number {
  const secs = Number(env.AGENTV3_MAX_BUILD_SECONDS);
  return Number.isFinite(secs) && secs > 0 ? Math.floor(secs * 1000) : 1800 * 1000;
}

/**
 * How many consecutive durable touches a live build may miss before the reaper stops believing it.
 *
 * Three is the point where "Firestore is briefly unhappy" stops being the likely explanation: a live
 * build writes its stamp every `touchIntervalMs`, so missing three means fifteen minutes of failed
 * writes on a build that is otherwise running normally.
 */
export const MISSED_TOUCHES_BEFORE_REAP = 3;

/**
 * How stale a DURABLE record must be before the reaper will touch it.
 *
 * ⚠️ THIS CONSTANT WAS LEFT BEHIND BY ITS OWN FIX (found 2026-08-24, from the admin's E2B bill).
 *
 * It used to be `maxBuildMs + 10 minutes` — forty minutes with the default 30-minute build cap — and
 * the reason is written a few lines below, in `touchIntervalMs`'s own comment: the durable record USED
 * TO BE WRITTEN ONLY WHEN A BUILD FINISHED, so `updatedAt` meant "when the sandbox was last released"
 * and could not tell a running build from an abandoned one. With no way to see liveness, the only safe
 * cut-off was a whole build-length away.
 *
 * That was then fixed: a live build now refreshes the stamp every few minutes, and the comment says so
 * explicitly — "makes the timestamp mean what the reaper needs it to mean: last known activity". The
 * cut-off it existed to compensate for was never lowered afterwards.
 *
 * So an orphan — and every Cloud Run deploy makes them, because the instance that created a sandbox
 * disappears while the sandbox keeps billing — sat for FORTY minutes before anything could pause it,
 * on a machine costing $0.083/hour. Deriving the window from the TOUCH interval (the thing that now
 * actually signals liveness) instead of from the build cap (which no longer does) halves it to twenty,
 * with the same guarantee and a better reason behind it.
 *
 * The idle limit is still a floor, and the in-memory sweep — which skips anything this instance holds
 * and anything with a build in flight — remains the precise first line. This is only the net beneath.
 */
/**
 * How long the in-memory "a build is in flight" flag stays trusted.
 *
 * ⚠️ DELIBERATELY SEPARATE FROM `reapAfterMs`, AND THE TWO MUST NOT BE RE-MERGED. They were one
 * function until 2026-08-24, and shortening the orphan window would silently have shortened this too —
 * which is the one change in this file that can break a running build.
 *
 * The flag exists so the 5-minute in-memory sweep never pauses a sandbox a build is using. A long model
 * call performs NO sandbox operation, so a build can legitimately go quiet for many minutes; if the flag
 * expired first, the sweep would see an idle workspace and pause the machine mid-build. It therefore has
 * to outlast the LONGEST BUILD THAT MAY LEGALLY RUN, which is exactly what `maxBuildMs` means — and has
 * nothing to do with how quickly an ABANDONED sandbox should be reclaimed.
 *
 * It still expires, because a build that crashes between `setBuildActive(true)` and `(false)` would
 * otherwise pin its VM forever — a far more expensive bug than the one the flag prevents.
 */
export function buildFlagExpiryMs(env: NodeJS.ProcessEnv = process.env): number {
  return maxBuildMs(env) + 10 * 60_000;
}

export function reapAfterMs(env: NodeJS.ProcessEnv = process.env): number {
  const MARGIN_MS = 5 * 60_000;
  return Math.max(idleLimitMs(env), touchIntervalMs(env) * MISSED_TOUCHES_BEFORE_REAP + MARGIN_MS);
}

/**
 * Pick the sandboxes safe to pause. Pure.
 *
 * A record with a missing or unparseable timestamp is LEFT ALONE rather than reaped: the cost of
 * leaving one VM running is small and bounded by E2B's own lifetime, while pausing a live build is a
 * broken app for a real user.
 */
export function sandboxesToReap(
  records: ReapableSandbox[],
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): ReapableSandbox[] {
  const cutoff = now - reapAfterMs(env);
  return (records || []).filter((r) => {
    if (!r || typeof r.sandboxId !== 'string' || !r.sandboxId) return false;
    const at = Number(r.updatedAt);
    if (!Number.isFinite(at) || at <= 0) return false; // unknown age → never reap
    if (at >= cutoff) return false;
    // Already paused and not used since — there is nothing left to stop billing for.
    const paused = Number(r.pausedAt);
    if (Number.isFinite(paused) && paused > 0 && paused >= at) return false;
    return true;
  });
}

/**
 * How often a LIVE build refreshes its durable timestamp.
 *
 * The record used to be written only when a build FINISHED, which made `updatedAt` mean "when the
 * sandbox was last released" — useless for telling a running build apart from an abandoned one, and
 * the reason the safe cut-off has to sit a whole build-length away. Refreshing it while the build runs
 * makes the timestamp mean what the reaper needs it to mean: last known activity.
 *
 * Throttled, because the sandbox is touched on every file write and every command — one Firestore
 * write per build minute is plenty when the reaper's own window is measured in tens of minutes.
 */
export function touchIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const mins = Number(env.AGENTV3_SANDBOX_TOUCH_MINUTES);
  return Number.isFinite(mins) && mins > 0 ? Math.floor(mins * 60_000) : 5 * 60_000;
}

/** Whether a workspace is due another durable refresh. `lastTouchAt` null/absent = never touched. */
export function shouldTouchDurable(
  lastTouchAt: number | null | undefined,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const last = Number(lastTouchAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  if (last > now) return true; // clock went backwards — refresh rather than trust it
  return now - last >= touchIntervalMs(env);
}
